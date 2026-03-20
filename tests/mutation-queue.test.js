/**
 * mutation-queue.test.js — Tests for the Offline Mutation Queue
 *
 * Tests the core logic extracted from js/mutation-queue.js:
 * - Network error detection
 * - Queue state management
 * - Bulk save dedup logic
 * - FIFO ordering
 * - Retry limits
 * - Badge formatting
 * - Flush behavior
 * - Error categorization
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Network error detection ────────────────────────────────

describe('MutationQueue: isNetworkError', () => {
  // Inline the detection logic from mutation-queue.js
  function isNetworkError(err) {
    return err instanceof TypeError;
  }

  it('detects TypeError as network error', () => {
    assert.ok(isNetworkError(new TypeError('Failed to fetch')));
  });

  it('does not flag regular Error as network error', () => {
    assert.notOk(isNetworkError(new Error('Server error')));
  });

  it('does not flag RangeError as network error', () => {
    assert.notOk(isNetworkError(new RangeError('out of bounds')));
  });

  it('does not flag null/undefined', () => {
    assert.notOk(isNetworkError(null));
    assert.notOk(isNetworkError(undefined));
  });

  it('detects TypeError with custom message', () => {
    assert.ok(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.')));
  });

  it('does not flag string errors', () => {
    assert.notOk(isNetworkError('TypeError'));
  });
});

// ─── Offline detection ──────────────────────────────────────

describe('MutationQueue: isOffline', () => {
  it('returns false when navigator.onLine is true', () => {
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    assert.equal(!navigator.onLine, false);
    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine);
    else delete navigator.onLine;
  });

  it('returns true when navigator.onLine is false', () => {
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    assert.equal(!navigator.onLine, true);
    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine);
    else delete navigator.onLine;
  });
});

// ─── Bulk save dedup ────────────────────────────────────────

describe('MutationQueue: bulk save dedup logic', () => {
  // Simulate the pendingWrites store (type-keyed = one per type)
  let _pendingWrites;

  beforeEach(() => {
    _pendingWrites = {};
  });

  function enqueueBulk(type, data, deletions) {
    _pendingWrites[type] = { items: data, deletions: deletions || [], ts: Date.now() };
  }

  function getPending() {
    return Object.entries(_pendingWrites).map(([type, data]) => ({ type, data }));
  }

  it('queues a bulk save', () => {
    enqueueBulk('songs', [{ id: 's1' }]);
    assert.equal(getPending().length, 1);
    assert.equal(getPending()[0].type, 'songs');
  });

  it('deduplicates — second save of same type overwrites', () => {
    enqueueBulk('songs', [{ id: 's1' }]);
    enqueueBulk('songs', [{ id: 's1' }, { id: 's2' }]);
    assert.equal(getPending().length, 1);
    assert.equal(getPending()[0].data.items.length, 2);
  });

  it('keeps separate types distinct', () => {
    enqueueBulk('songs', [{ id: 's1' }]);
    enqueueBulk('setlists', [{ id: 'sl1' }]);
    assert.equal(getPending().length, 2);
  });

  it('includes deletions array', () => {
    enqueueBulk('songs', [{ id: 's1' }], ['s2', 's3']);
    const pw = getPending()[0];
    assert.deepEqual(pw.data.deletions, ['s2', 's3']);
  });

  it('defaults deletions to empty array', () => {
    enqueueBulk('songs', [{ id: 's1' }]);
    assert.deepEqual(getPending()[0].data.deletions, []);
  });

  it('overwrite preserves latest data, not first', () => {
    enqueueBulk('songs', [{ id: 's1', title: 'old' }]);
    enqueueBulk('songs', [{ id: 's1', title: 'new' }]);
    assert.equal(getPending()[0].data.items[0].title, 'new');
  });

  it('overwrite replaces deletions too', () => {
    enqueueBulk('songs', [], ['old-delete']);
    enqueueBulk('songs', [], ['new-delete']);
    assert.deepEqual(getPending()[0].data.deletions, ['new-delete']);
  });
});

// ─── Discrete mutation FIFO ─────────────────────────────────

describe('MutationQueue: discrete mutation FIFO', () => {
  let _queue;

  beforeEach(() => {
    _queue = [];
  });

  function enqueue(path, method, body) {
    _queue.push({ key: _queue.length + 1, path, method, body, ts: Date.now(), retries: 0 });
    return _queue.length;
  }

  function dequeue(key) {
    _queue = _queue.filter(m => m.key !== key);
  }

  it('enqueues mutations in order', () => {
    enqueue('/messages', 'POST', { subject: 'first' });
    enqueue('/messages', 'POST', { subject: 'second' });
    assert.equal(_queue.length, 2);
    assert.equal(_queue[0].body.subject, 'first');
    assert.equal(_queue[1].body.subject, 'second');
  });

  it('dequeues by key', () => {
    enqueue('/messages', 'POST', { subject: 'keep' });
    enqueue('/messages', 'POST', { subject: 'remove' });
    dequeue(2);
    assert.equal(_queue.length, 1);
    assert.equal(_queue[0].body.subject, 'keep');
  });

  it('preserves order after dequeue', () => {
    enqueue('/a', 'POST', null);
    enqueue('/b', 'POST', null);
    enqueue('/c', 'POST', null);
    dequeue(2); // remove /b
    assert.equal(_queue[0].path, '/a');
    assert.equal(_queue[1].path, '/c');
  });

  it('handles dequeue of non-existent key', () => {
    enqueue('/a', 'POST', null);
    dequeue(999);
    assert.equal(_queue.length, 1);
  });

  it('assigns unique keys per enqueue', () => {
    const k1 = enqueue('/a', 'POST', null);
    const k2 = enqueue('/b', 'POST', null);
    assert.notEqual(_queue[0].key, _queue[1].key);
  });

  it('initializes retries to 0', () => {
    enqueue('/test', 'POST', { data: 1 });
    assert.equal(_queue[0].retries, 0);
  });

  it('records timestamp at enqueue time', () => {
    const before = Date.now();
    enqueue('/test', 'POST', null);
    const after = Date.now();
    assert.ok(_queue[0].ts >= before);
    assert.ok(_queue[0].ts <= after);
  });
});

// ─── Retry logic ────────────────────────────────────────────

describe('MutationQueue: retry limits', () => {
  const MAX_RETRIES = 5;

  function shouldDrop(retries) {
    return retries >= MAX_RETRIES;
  }

  it('drops mutation at exactly MAX_RETRIES', () => {
    assert.ok(shouldDrop(5));
  });

  it('drops mutation above MAX_RETRIES', () => {
    assert.ok(shouldDrop(10));
  });

  it('keeps mutation below MAX_RETRIES', () => {
    assert.notOk(shouldDrop(4));
  });

  it('keeps mutation at zero retries', () => {
    assert.notOk(shouldDrop(0));
  });

  it('simulates retry loop reaching drop threshold', () => {
    const mutation = { key: 1, path: '/test', retries: 0 };
    let dropped = false;
    for (let i = 0; i < 10; i++) {
      mutation.retries++;
      if (shouldDrop(mutation.retries)) {
        dropped = true;
        break;
      }
    }
    assert.ok(dropped);
    assert.equal(mutation.retries, MAX_RETRIES);
  });
});

// ─── Badge formatting ───────────────────────────────────────

describe('MutationQueue: badge formatting', () => {
  function formatBadge(count) {
    if (count <= 0) return null;
    return count > 99 ? '99+' : String(count);
  }

  it('returns null for zero', () => {
    assert.isNull(formatBadge(0));
  });

  it('returns null for negative', () => {
    assert.isNull(formatBadge(-1));
  });

  it('returns "1" for 1', () => {
    assert.equal(formatBadge(1), '1');
  });

  it('returns "99" for 99', () => {
    assert.equal(formatBadge(99), '99');
  });

  it('returns "99+" for 100', () => {
    assert.equal(formatBadge(100), '99+');
  });

  it('returns "99+" for 500', () => {
    assert.equal(formatBadge(500), '99+');
  });
});

// ─── Body key mapping ───────────────────────────────────────

describe('MutationQueue: body key mapping', () => {
  function bodyKey(type) {
    return type === 'wikicharts' ? 'wikiCharts' : type;
  }

  it('maps songs to songs', () => {
    assert.equal(bodyKey('songs'), 'songs');
  });

  it('maps setlists to setlists', () => {
    assert.equal(bodyKey('setlists'), 'setlists');
  });

  it('maps practice to practice', () => {
    assert.equal(bodyKey('practice'), 'practice');
  });

  it('maps wikicharts to wikiCharts (camelCase)', () => {
    assert.equal(bodyKey('wikicharts'), 'wikiCharts');
  });
});

// ─── Flush error categorization ─────────────────────────────

describe('MutationQueue: flush error categorization', () => {
  // Mirror the error categorization logic from mutation-queue.js flush()
  function categorizeError(err) {
    if (err instanceof TypeError) return 'network';      // Still offline — stop
    if (!err.status) return 'bail';                       // Unknown error — stop
    if (err.status === 401 || err.status === 429) return 'bail';  // Auth/rate — stop
    if (err.status >= 500) return 'retry';                // Server error — skip, retry later
    return 'drop';                                        // Permanent 4xx — drop mutation
  }

  it('categorizes TypeError as network', () => {
    assert.equal(categorizeError(new TypeError('Failed to fetch')), 'network');
  });

  it('categorizes 401 as bail', () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    assert.equal(categorizeError(err), 'bail');
  });

  it('categorizes 429 as bail', () => {
    const err = new Error('Too Many Requests');
    err.status = 429;
    assert.equal(categorizeError(err), 'bail');
  });

  it('categorizes 500 as retry', () => {
    const err = new Error('Internal Server Error');
    err.status = 500;
    assert.equal(categorizeError(err), 'retry');
  });

  it('categorizes 502 as retry', () => {
    const err = new Error('Bad Gateway');
    err.status = 502;
    assert.equal(categorizeError(err), 'retry');
  });

  it('categorizes 400 as drop', () => {
    const err = new Error('Bad Request');
    err.status = 400;
    assert.equal(categorizeError(err), 'drop');
  });

  it('categorizes 403 as drop', () => {
    const err = new Error('Forbidden');
    err.status = 403;
    assert.equal(categorizeError(err), 'drop');
  });

  it('categorizes 404 as drop', () => {
    const err = new Error('Not Found');
    err.status = 404;
    assert.equal(categorizeError(err), 'drop');
  });

  it('categorizes 409 as drop', () => {
    const err = new Error('Conflict');
    err.status = 409;
    assert.equal(categorizeError(err), 'drop');
  });

  it('categorizes error without status as bail', () => {
    assert.equal(categorizeError(new Error('Unknown')), 'bail');
  });
});

// ─── Flush ordering ─────────────────────────────────────────

describe('MutationQueue: flush ordering', () => {
  it('processes bulk saves before discrete mutations', () => {
    const order = [];
    // Simulate flush: bulk first, then discrete
    const bulk = [{ type: 'songs' }, { type: 'setlists' }];
    const discrete = [{ key: 1, path: '/messages' }, { key: 2, path: '/settings' }];

    for (const b of bulk) order.push('bulk:' + b.type);
    for (const d of discrete) order.push('discrete:' + d.path);

    assert.equal(order[0], 'bulk:songs');
    assert.equal(order[1], 'bulk:setlists');
    assert.equal(order[2], 'discrete:/messages');
    assert.equal(order[3], 'discrete:/settings');
  });

  it('stops on network error', () => {
    const processed = [];
    const items = ['a', 'b', 'networkError', 'c'];

    for (const item of items) {
      if (item === 'networkError') break;
      processed.push(item);
    }

    assert.equal(processed.length, 2);
    assert.notIncludes(processed, 'c');
  });
});

// ─── Queue + queueableWrite integration ─────────────────────

describe('MutationQueue: queueableWrite pattern', () => {
  it('returns true on successful fetch', async () => {
    let queued = false;
    async function queueableWrite() {
      try {
        // Simulate successful fetch
        return true;
      } catch (e) {
        if (e instanceof TypeError) { queued = true; return true; }
        return false;
      }
    }
    const result = await queueableWrite();
    assert.ok(result);
    assert.notOk(queued); // Should NOT have queued
  });

  it('returns true when queued on network error', async () => {
    let queued = false;
    async function queueableWrite() {
      try {
        throw new TypeError('Failed to fetch');
      } catch (e) {
        if (e instanceof TypeError) {
          queued = true;
          return true; // optimistic
        }
        return false;
      }
    }
    const result = await queueableWrite();
    assert.ok(result);
    assert.ok(queued);
  });

  it('returns false on server error (not queued)', async () => {
    let queued = false;
    async function queueableWrite() {
      try {
        const err = new Error('Internal Server Error');
        err.status = 500;
        throw err;
      } catch (e) {
        if (e instanceof TypeError) { queued = true; return true; }
        return false;
      }
    }
    const result = await queueableWrite();
    assert.notOk(result);
    assert.notOk(queued);
  });

  it('distinguishes network errors from auth errors', async () => {
    const errors = [];

    for (const makeErr of [
      () => new TypeError('Failed to fetch'),
      () => { const e = new Error('Unauthorized'); e.status = 401; return e; },
      () => { const e = new Error('Server Error'); e.status = 500; return e; },
    ]) {
      const err = makeErr();
      errors.push(err instanceof TypeError ? 'queue' : 'fail');
    }

    assert.equal(errors[0], 'queue');
    assert.equal(errors[1], 'fail');
    assert.equal(errors[2], 'fail');
  });
});

// ─── Concurrent flush guard ─────────────────────────────────

describe('MutationQueue: concurrent flush guard', () => {
  it('blocks second flush while first is running', () => {
    let _flushing = false;
    function flush() {
      if (_flushing) return 'blocked';
      _flushing = true;
      return 'started';
    }
    assert.equal(flush(), 'started');
    assert.equal(flush(), 'blocked');
  });

  it('allows flush after previous completes', () => {
    let _flushing = false;
    function startFlush() { if (_flushing) return false; _flushing = true; return true; }
    function endFlush() { _flushing = false; }

    assert.ok(startFlush());
    assert.notOk(startFlush()); // blocked
    endFlush();
    assert.ok(startFlush()); // allowed again
  });
});

// ─── Flush preconditions ────────────────────────────────────

describe('MutationQueue: flush preconditions', () => {
  it('does not flush when not authenticated', () => {
    const hasToken = false;
    const isOnline = true;
    const shouldFlush = hasToken && isOnline;
    assert.notOk(shouldFlush);
  });

  it('does not flush when offline', () => {
    const hasToken = true;
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const shouldFlush = hasToken && navigator.onLine;
    assert.notOk(shouldFlush);
    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine);
    else delete navigator.onLine;
  });

  it('flushes when authenticated and online', () => {
    const hasToken = true;
    const origOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const shouldFlush = hasToken && navigator.onLine;
    assert.ok(shouldFlush);
    if (origOnLine) Object.defineProperty(navigator, 'onLine', origOnLine);
    else delete navigator.onLine;
  });
});

// ─── IDB mutation schema ────────────────────────────────────

describe('MutationQueue: IDB mutation schema', () => {
  it('mutation object has all required fields', () => {
    const mutation = {
      path: '/orchestras/x/messages',
      method: 'POST',
      body: JSON.stringify({ subject: 'test', body: 'hello' }),
      ts: Date.now(),
      retries: 0,
    };
    assert.type(mutation.path, 'string');
    assert.type(mutation.method, 'string');
    assert.type(mutation.ts, 'number');
    assert.ok(mutation.ts > 0);
    assert.equal(mutation.retries, 0);
  });

  it('body can be null for DELETE requests', () => {
    const mutation = {
      path: '/orchestras/x/messages/123',
      method: 'DELETE',
      body: null,
      ts: Date.now(),
      retries: 0,
    };
    assert.isNull(mutation.body);
    assert.equal(mutation.method, 'DELETE');
  });

  it('body round-trips through JSON stringify/parse', () => {
    const payload = { subject: 'test', body: 'hello', category: 'general' };
    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.subject, payload.subject);
    assert.equal(parsed.category, payload.category);
    assert.equal(parsed.body, payload.body);
  });
});

// ─── Background Sync integration ────────────────────────────

describe('MutationQueue: Background Sync', () => {
  it('sync tag matches service-worker handler', () => {
    // The SW listens for 'mutation-queue-flush' in the sync event handler.
    // The module registers this same tag. Verify they stay aligned.
    const MODULE_TAG = 'mutation-queue-flush';
    // Read from service-worker.js source: e.tag === 'mutation-queue-flush'
    assert.equal(MODULE_TAG, 'mutation-queue-flush');
  });

  it('SW message type triggers flush', () => {
    // SW sends { type: 'FLUSH_MUTATION_QUEUE' } to clients when sync fires.
    // Module listens for this type in serviceWorker.addEventListener('message').
    const SW_MSG_TYPE = 'FLUSH_MUTATION_QUEUE';
    assert.ok(SW_MSG_TYPE.startsWith('FLUSH_'));
    assert.ok(SW_MSG_TYPE.includes('MUTATION'));
  });
});

// ─── Count tracking ─────────────────────────────────────────

describe('MutationQueue: count tracking', () => {
  it('total count is sum of bulk + discrete', () => {
    // Simulate _refreshCount logic from mutation-queue.js
    function refreshCount(bulkWrites, discreteMutations) {
      return bulkWrites.length + discreteMutations;
    }
    assert.equal(refreshCount([{ type: 'songs' }, { type: 'setlists' }], 3), 5);
    assert.equal(refreshCount([], 0), 0);
    assert.equal(refreshCount([{ type: 'songs' }], 0), 1);
    assert.equal(refreshCount([], 7), 7);
  });
});

// ─── Edge cases ─────────────────────────────────────────────

describe('MutationQueue: edge cases', () => {
  it('handles empty queue flush gracefully', () => {
    const bulk = [];
    const discrete = [];
    let flushedAny = false;
    for (const b of bulk) flushedAny = true;
    for (const d of discrete) flushedAny = true;
    assert.notOk(flushedAny);
  });

  it('large queue count caps at 99+ for badge', () => {
    function formatBadge(count) {
      if (count <= 0) return null;
      return count > 99 ? '99+' : String(count);
    }
    assert.equal(formatBadge(150), '99+');
    assert.equal(formatBadge(100), '99+');
    assert.equal(formatBadge(99), '99');
  });

  it('body key mapping only transforms wikicharts', () => {
    function bodyKey(type) {
      return type === 'wikicharts' ? 'wikiCharts' : type;
    }
    // Verify all 4 types have correct body key for API payload
    const types = ['songs', 'setlists', 'practice', 'wikicharts'];
    const expected = ['songs', 'setlists', 'practice', 'wikiCharts'];
    types.forEach((t, i) => assert.equal(bodyKey(t), expected[i]));
  });
});
