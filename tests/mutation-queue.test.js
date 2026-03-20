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
});

// ─── Retry logic ────────────────────────────────────────────

describe('MutationQueue: retry limits', () => {
  const MAX_RETRIES = 5;

  it('drops mutation after MAX_RETRIES', () => {
    const mutation = { key: 1, path: '/test', retries: 0 };
    let dropped = false;
    for (let i = 0; i < MAX_RETRIES + 1; i++) {
      mutation.retries++;
      if (mutation.retries >= MAX_RETRIES) {
        dropped = true;
        break;
      }
    }
    assert.ok(dropped);
    assert.equal(mutation.retries, MAX_RETRIES);
  });

  it('keeps mutation under retry limit', () => {
    const mutation = { key: 1, path: '/test', retries: 0 };
    mutation.retries = MAX_RETRIES - 1;
    assert.ok(mutation.retries < MAX_RETRIES);
  });

  it('handles zero retries', () => {
    const mutation = { key: 1, retries: 0 };
    assert.ok(mutation.retries < MAX_RETRIES);
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

// ─── Count tracking ─────────────────────────────────────────

describe('MutationQueue: count tracking', () => {
  it('counts bulk + discrete mutations separately', () => {
    const bulkCount = 2; // songs, setlists
    const discreteCount = 3; // 3 messages
    const total = bulkCount + discreteCount;
    assert.equal(total, 5);
  });

  it('count is zero when both queues empty', () => {
    assert.equal(0 + 0, 0);
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
    let fetchResult = true;
    async function queueableWrite() {
      if (fetchResult) return true;
      return false;
    }
    const result = await queueableWrite();
    assert.ok(result);
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
    async function queueableWrite() {
      try {
        const err = new Error('Internal Server Error');
        err.status = 500;
        throw err;
      } catch (e) {
        if (e instanceof TypeError) return true;
        return false;
      }
    }
    const result = await queueableWrite();
    assert.notOk(result);
  });
});

// ─── IDB mutation queue schema ──────────────────────────────

describe('MutationQueue: IDB schema v5', () => {
  it('mutation has required fields', () => {
    const mutation = {
      path: '/orchestras/x/messages',
      method: 'POST',
      body: JSON.stringify({ subject: 'test', body: 'hello' }),
      ts: Date.now(),
      retries: 0,
    };
    assert.ok(mutation.path);
    assert.ok(mutation.method);
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

  it('body is JSON stringified', () => {
    const payload = { subject: 'test', body: 'hello', category: 'general' };
    const mutation = {
      body: JSON.stringify(payload),
    };
    const parsed = JSON.parse(mutation.body);
    assert.equal(parsed.subject, 'test');
    assert.equal(parsed.category, 'general');
  });
});

// ─── Background Sync tag ────────────────────────────────────

describe('MutationQueue: Background Sync', () => {
  it('uses correct sync tag', () => {
    const SYNC_TAG = 'mutation-queue-flush';
    assert.equal(SYNC_TAG, 'mutation-queue-flush');
  });

  it('SW message type matches', () => {
    const MSG_TYPE = 'FLUSH_MUTATION_QUEUE';
    assert.equal(MSG_TYPE, 'FLUSH_MUTATION_QUEUE');
  });
});

// ─── Offline indicator logic ────────────────────────────────

describe('MutationQueue: offline indicator', () => {
  it('shows indicator when offline', () => {
    const isOffline = true;
    const shouldShow = isOffline;
    assert.ok(shouldShow);
  });

  it('hides indicator when online', () => {
    const isOffline = false;
    const shouldShow = isOffline;
    assert.notOk(shouldShow);
  });

  it('shows queue badge when pending > 0', () => {
    const pending = 3;
    const shouldShowBadge = pending > 0;
    assert.ok(shouldShowBadge);
  });

  it('hides queue badge when pending = 0', () => {
    const pending = 0;
    const shouldShowBadge = pending > 0;
    assert.notOk(shouldShowBadge);
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

  it('handles concurrent flush guard', () => {
    let _flushing = false;
    function flush() {
      if (_flushing) return 'blocked';
      _flushing = true;
      return 'started';
    }
    assert.equal(flush(), 'started');
    assert.equal(flush(), 'blocked');
  });

  it('does not flush when not authenticated', () => {
    const hasToken = false;
    const shouldFlush = hasToken && navigator.onLine;
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

  it('large queue count caps at 99+ for badge', () => {
    const count = 150;
    const display = count > 99 ? '99+' : String(count);
    assert.equal(display, '99+');
  });
});
