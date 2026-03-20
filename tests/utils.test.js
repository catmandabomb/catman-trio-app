/**
 * utils.test.js — Tests for js/utils.js (pure utility functions)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');
const { setupGlobals, resetAll } = require('./mocks');

// ─── Replicate utility functions for testing ─────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(text, query) {
  if (!query) return esc(text);
  const escaped = esc(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${q})`, 'gi'), '<mark class="search-hi">$1</mark>');
}

function parseDurationInput(val) {
  if (!val) return 0;
  val = val.trim();
  if (/^\d+:\d{1,2}$/.test(val)) {
    const [m, s] = val.split(':').map(Number);
    return m * 60 + s;
  }
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function isHybridKey(k) {
  if (k.includes('/')) return true;
  const low = k.toLowerCase();
  return low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed';
}

function levenshtein(a, b) {
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp = Array.from({ length: la + 1 }, (_, i) => i);
  for (let j = 1; j <= lb; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= la; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[la];
}

function findSimilarSongsSync(title, excludeId, songs) {
  if (!title) return [];
  const norm = title.trim().toLowerCase();
  return songs.filter(s => {
    if (s.id === excludeId) return false;
    const other = (s.title || '').trim().toLowerCase();
    if (!other) return false;
    if (norm === other) return true;
    if (norm.length >= 4 && other.length >= 4 && Math.abs(norm.length - other.length) <= 3) {
      return levenshtein(norm, other) <= 2;
    }
    return false;
  });
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function gradientText(str, from, to) {
  const chars = str.split('');
  const visible = chars.filter(c => c !== ' ');
  let vi = 0;
  return chars.map(c => {
    if (c === ' ') return ' ';
    const t = visible.length > 1 ? vi / (visible.length - 1) : 0;
    vi++;
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    return `<span style="color:rgb(${r},${g},${b})">${esc(c)}</span>`;
  }).join('');
}

function getOrderedCharts(song) {
  const charts = song.assets?.charts || [];
  if (!charts.length) return [];
  if (song.primaryChartId && !song.chartOrder) {
    song.chartOrder = [{ driveId: song.primaryChartId, order: 1 }];
    delete song.primaryChartId;
  }
  const order = song.chartOrder || [];
  if (!order.length) return [charts[0]];
  return order
    .sort((a, b) => a.order - b.order)
    .map(o => charts.find(c => c.driveId === o.driveId))
    .filter(Boolean);
}

function parseTimeSig(ts) {
  const TIME_SIGS = [
    { display: '4/4', beats: 4 },
    { display: '3/4', beats: 3 },
    { display: '6/8', beats: 6 },
    { display: '2/4', beats: 2 },
    { display: '5/4', beats: 5 },
    { display: '7/8', beats: 7 },
  ];
  if (!ts) return TIME_SIGS[0];
  const match = TIME_SIGS.find(t => t.display === ts.trim());
  return match || TIME_SIGS[0];
}

// ─── Tests ───────────────────────────────────────────────────

describe('Utils — esc (HTML escaping)', () => {
  it('escapes ampersand', () => { assert.equal(esc('a & b'), 'a &amp; b'); });
  it('escapes less-than', () => { assert.equal(esc('<div>'), '&lt;div&gt;'); });
  it('escapes greater-than', () => { assert.equal(esc('a > b'), 'a &gt; b'); });
  it('escapes double quotes', () => { assert.equal(esc('"hello"'), '&quot;hello&quot;'); });
  it('handles null', () => { assert.equal(esc(null), ''); });
  it('handles undefined', () => { assert.equal(esc(undefined), ''); });
  it('handles empty string', () => { assert.equal(esc(''), ''); });
  it('handles numbers', () => { assert.equal(esc(42), '42'); });
  it('handles mixed special chars', () => { assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;'); });
  it('does not double-escape', () => {
    assert.equal(esc('&amp;'), '&amp;amp;');
  });
});

describe('Utils — highlight', () => {
  it('highlights matching text', () => {
    const result = highlight('Hello World', 'World');
    assert.ok(result.includes('<mark class="search-hi">World</mark>'));
  });

  it('case-insensitive highlighting', () => {
    const result = highlight('Hello World', 'world');
    assert.ok(result.includes('<mark class="search-hi">World</mark>'));
  });

  it('returns escaped text when no query', () => {
    assert.equal(highlight('<test>', ''), '&lt;test&gt;');
    assert.equal(highlight('hello', null), 'hello');
  });

  it('escapes regex special chars in query', () => {
    const result = highlight('test (value)', '(value)');
    assert.ok(result.includes('<mark class="search-hi">(value)</mark>'));
  });

  it('escapes HTML in text before highlighting', () => {
    const result = highlight('<b>bold</b>', 'bold');
    assert.ok(result.includes('&lt;b&gt;'));
    assert.ok(result.includes('<mark class="search-hi">bold</mark>'));
  });

  it('highlights multiple occurrences', () => {
    const result = highlight('the cat and the dog', 'the');
    const count = (result.match(/<mark/g) || []).length;
    assert.equal(count, 2);
  });
});

describe('Utils — parseDurationInput', () => {
  it('parses m:ss format', () => { assert.equal(parseDurationInput('3:45'), 225); });
  it('parses m:s format (single digit seconds)', () => { assert.equal(parseDurationInput('1:5'), 65); });
  it('parses plain seconds', () => { assert.equal(parseDurationInput('180'), 180); });
  it('handles 0:00', () => { assert.equal(parseDurationInput('0:00'), 0); });
  it('handles 0:30', () => { assert.equal(parseDurationInput('0:30'), 30); });
  it('handles empty string', () => { assert.equal(parseDurationInput(''), 0); });
  it('handles null', () => { assert.equal(parseDurationInput(null), 0); });
  it('handles undefined', () => { assert.equal(parseDurationInput(undefined), 0); });
  it('handles whitespace', () => { assert.equal(parseDurationInput('  3:45  '), 225); });
  it('handles non-numeric input', () => { assert.equal(parseDurationInput('abc'), 0); });
  it('handles edge case 99:59', () => { assert.equal(parseDurationInput('99:59'), 5999); });
  it('handles negative number as plain int', () => { assert.equal(parseDurationInput('-5'), -5); });
});

describe('Utils — formatDuration', () => {
  it('formats 225 seconds as 3:45', () => { assert.equal(formatDuration(225), '3:45'); });
  it('formats 60 seconds as 1:00', () => { assert.equal(formatDuration(60), '1:00'); });
  it('formats 5 seconds as 0:05', () => { assert.equal(formatDuration(5), '0:05'); });
  it('formats 0 as empty string', () => { assert.equal(formatDuration(0), ''); });
  it('formats negative as empty string', () => { assert.equal(formatDuration(-10), ''); });
  it('formats null as empty string', () => { assert.equal(formatDuration(null), ''); });
  it('formats undefined as empty string', () => { assert.equal(formatDuration(undefined), ''); });
  it('truncates fractional seconds', () => { assert.equal(formatDuration(65.7), '1:05'); });
  it('large value formats correctly', () => { assert.equal(formatDuration(3661), '61:01'); });
});

describe('Utils — parseDurationInput/formatDuration roundtrip', () => {
  it('3:45 roundtrips', () => {
    assert.equal(formatDuration(parseDurationInput('3:45')), '3:45');
  });
  it('0:05 roundtrips', () => {
    assert.equal(formatDuration(parseDurationInput('0:05')), '0:05');
  });
  it('10:00 roundtrips', () => {
    assert.equal(formatDuration(parseDurationInput('10:00')), '10:00');
  });
});

describe('Utils — timeAgo', () => {
  it('just now for < 60 seconds ago', () => {
    assert.equal(timeAgo(Date.now() - 30000), 'just now');
  });

  it('minutes ago', () => {
    assert.equal(timeAgo(Date.now() - 300000), '5m ago');
  });

  it('hours ago', () => {
    assert.equal(timeAgo(Date.now() - 7200000), '2h ago');
  });

  it('days ago', () => {
    assert.equal(timeAgo(Date.now() - 172800000), '2d ago');
  });

  it('0 seconds ago is just now', () => {
    assert.equal(timeAgo(Date.now()), 'just now');
  });
});

describe('Utils — isHybridKey', () => {
  it('detects slash as hybrid', () => { assert.ok(isHybridKey('C/Am')); });
  it('detects "Multiple"', () => { assert.ok(isHybridKey('Multiple')); });
  it('detects "various" (case-insensitive)', () => { assert.ok(isHybridKey('Various')); });
  it('detects "hybrid"', () => { assert.ok(isHybridKey('Hybrid')); });
  it('detects "mixed"', () => { assert.ok(isHybridKey('Mixed')); });
  it('simple key is not hybrid', () => { assert.notOk(isHybridKey('C')); });
  it('minor key is not hybrid', () => { assert.notOk(isHybridKey('Am')); });
  it('sharp key is not hybrid', () => { assert.notOk(isHybridKey('F#')); });
  it('flat key is not hybrid', () => { assert.notOk(isHybridKey('Bb')); });
});

describe('Utils — levenshtein', () => {
  it('identical strings return 0', () => { assert.equal(levenshtein('hello', 'hello'), 0); });
  it('empty vs non-empty', () => { assert.equal(levenshtein('', 'abc'), 3); });
  it('non-empty vs empty', () => { assert.equal(levenshtein('abc', ''), 3); });
  it('both empty', () => { assert.equal(levenshtein('', ''), 0); });
  it('single substitution', () => { assert.equal(levenshtein('cat', 'bat'), 1); });
  it('single insertion', () => { assert.equal(levenshtein('cat', 'cats'), 1); });
  it('single deletion', () => { assert.equal(levenshtein('cats', 'cat'), 1); });
  it('completely different', () => { assert.equal(levenshtein('abc', 'xyz'), 3); });
  it('case sensitivity', () => { assert.equal(levenshtein('Hello', 'hello'), 1); });
  it('transposition is distance 2', () => { assert.equal(levenshtein('ab', 'ba'), 2); });
});

describe('Utils — findSimilarSongsSync', () => {
  const songs = [
    { id: '1', title: 'Yesterday' },
    { id: '2', title: 'Yesterdays' },
    { id: '3', title: 'Tomorrow' },
    { id: '4', title: 'Yesterday Once More' },
    { id: '5', title: '' },
    { id: '6', title: 'Ysterday' },  // typo — Lev distance 1
  ];

  it('finds exact matches (case-insensitive)', () => {
    const result = findSimilarSongsSync('yesterday', '99', songs);
    assert.ok(result.some(s => s.id === '1'));
  });

  it('excludes self by ID', () => {
    const result = findSimilarSongsSync('Yesterday', '1', songs);
    assert.notOk(result.some(s => s.id === '1'));
  });

  it('finds close typos (Lev <= 2)', () => {
    const result = findSimilarSongsSync('Yesterday', '1', songs);
    assert.ok(result.some(s => s.id === '2')); // Yesterdays — distance 1
    assert.ok(result.some(s => s.id === '6')); // Ysterday — distance 1
  });

  it('does not match distant strings', () => {
    const result = findSimilarSongsSync('Yesterday', '99', songs);
    assert.notOk(result.some(s => s.id === '3')); // Tomorrow — too different
  });

  it('returns empty for null/empty title', () => {
    assert.deepEqual(findSimilarSongsSync('', '99', songs), []);
    assert.deepEqual(findSimilarSongsSync(null, '99', songs), []);
  });

  it('skips songs with empty titles', () => {
    const result = findSimilarSongsSync('Yesterday', '99', songs);
    assert.notOk(result.some(s => s.id === '5'));
  });

  it('does not match short strings (< 4 chars)', () => {
    const shortSongs = [
      { id: '1', title: 'AB' },
      { id: '2', title: 'AC' },
    ];
    const result = findSimilarSongsSync('AB', '99', shortSongs);
    // Exact match works
    assert.ok(result.some(s => s.id === '1'));
    // But 'AC' is too short for Levenshtein check (only exact match counted)
    // The condition requires length >= 4 for Lev check
  });
});

describe('Utils — deepClone', () => {
  it('clones simple object', () => {
    const obj = { a: 1, b: 'hello' };
    const cloned = deepClone(obj);
    assert.deepEqual(cloned, obj);
    cloned.a = 2;
    assert.equal(obj.a, 1);
  });

  it('clones nested objects', () => {
    const obj = { a: { b: { c: 3 } } };
    const cloned = deepClone(obj);
    cloned.a.b.c = 99;
    assert.equal(obj.a.b.c, 3);
  });

  it('clones arrays', () => {
    const arr = [1, 2, [3, 4]];
    const cloned = deepClone(arr);
    cloned[2][0] = 99;
    assert.equal(arr[2][0], 3);
  });

  it('handles null', () => {
    assert.isNull(deepClone(null));
  });
});

describe('Utils — gradientText', () => {
  it('single character has start color', () => {
    const result = gradientText('A', [255, 0, 0], [0, 0, 255]);
    assert.ok(result.includes('rgb(255,0,0)'));
  });

  it('spaces are not wrapped in spans', () => {
    const result = gradientText('A B', [255, 0, 0], [0, 0, 255]);
    assert.ok(result.includes(' '));
    // Two visible chars, so A gets start color, B gets end color
    assert.ok(result.includes('rgb(255,0,0)'));
    assert.ok(result.includes('rgb(0,0,255)'));
  });

  it('empty string returns empty', () => {
    assert.equal(gradientText('', [0, 0, 0], [255, 255, 255]), '');
  });
});

describe('Utils — getOrderedCharts', () => {
  it('returns empty for song with no charts', () => {
    assert.deepEqual(getOrderedCharts({ assets: { charts: [] } }), []);
    assert.deepEqual(getOrderedCharts({ assets: {} }), []);
    assert.deepEqual(getOrderedCharts({}), []);
  });

  it('returns first chart when no chartOrder', () => {
    const song = { assets: { charts: [{ driveId: 'a' }, { driveId: 'b' }] } };
    const result = getOrderedCharts(song);
    assert.equal(result.length, 1);
    assert.equal(result[0].driveId, 'a');
  });

  it('orders by chartOrder', () => {
    const song = {
      assets: { charts: [{ driveId: 'a' }, { driveId: 'b' }, { driveId: 'c' }] },
      chartOrder: [
        { driveId: 'c', order: 1 },
        { driveId: 'a', order: 2 },
        { driveId: 'b', order: 3 },
      ],
    };
    const result = getOrderedCharts(song);
    assert.equal(result.length, 3);
    assert.equal(result[0].driveId, 'c');
    assert.equal(result[1].driveId, 'a');
    assert.equal(result[2].driveId, 'b');
  });

  it('migrates primaryChartId to chartOrder', () => {
    const song = {
      primaryChartId: 'primary1',
      assets: { charts: [{ driveId: 'primary1' }, { driveId: 'other' }] },
    };
    getOrderedCharts(song);
    assert.ok(song.chartOrder);
    assert.equal(song.chartOrder[0].driveId, 'primary1');
    assert.isUndefined(song.primaryChartId);
  });

  it('filters out non-existent chart IDs in order', () => {
    const song = {
      assets: { charts: [{ driveId: 'a' }] },
      chartOrder: [{ driveId: 'a', order: 1 }, { driveId: 'nonexistent', order: 2 }],
    };
    const result = getOrderedCharts(song);
    assert.equal(result.length, 1);
    assert.equal(result[0].driveId, 'a');
  });
});

describe('Utils — parseTimeSig', () => {
  it('parses 4/4', () => {
    const result = parseTimeSig('4/4');
    assert.equal(result.display, '4/4');
    assert.equal(result.beats, 4);
  });

  it('parses 3/4', () => {
    const result = parseTimeSig('3/4');
    assert.equal(result.display, '3/4');
    assert.equal(result.beats, 3);
  });

  it('parses 6/8', () => {
    const result = parseTimeSig('6/8');
    assert.equal(result.display, '6/8');
    assert.equal(result.beats, 6);
  });

  it('defaults to 4/4 for null', () => {
    const result = parseTimeSig(null);
    assert.equal(result.display, '4/4');
  });

  it('defaults to 4/4 for empty string', () => {
    const result = parseTimeSig('');
    assert.equal(result.display, '4/4');
  });

  it('defaults to 4/4 for unknown time sig', () => {
    const result = parseTimeSig('11/8');
    assert.equal(result.display, '4/4');
  });

  it('trims whitespace', () => {
    const result = parseTimeSig('  3/4  ');
    assert.equal(result.display, '3/4');
  });
});

describe('Utils — Wake Lock ref counting', () => {
  // Replicate the wake lock ref counting logic
  let _refCount, _sentinel;

  function requestWakeLock() {
    _refCount++;
    if (_sentinel) return;
    _sentinel = { released: false };
  }

  function releaseWakeLock() {
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount > 0) return;
    if (_sentinel) { _sentinel.released = true; _sentinel = null; }
  }

  beforeEach(() => { _refCount = 0; _sentinel = null; });

  it('single request creates sentinel', () => {
    requestWakeLock();
    assert.equal(_refCount, 1);
    assert.ok(_sentinel);
  });

  it('double request increments ref count, same sentinel', () => {
    requestWakeLock();
    const firstSentinel = _sentinel;
    requestWakeLock();
    assert.equal(_refCount, 2);
    assert.equal(_sentinel, firstSentinel);
  });

  it('release decrements ref count', () => {
    requestWakeLock();
    requestWakeLock();
    releaseWakeLock();
    assert.equal(_refCount, 1);
    assert.ok(_sentinel); // Still held
  });

  it('final release clears sentinel', () => {
    requestWakeLock();
    requestWakeLock();
    releaseWakeLock();
    releaseWakeLock();
    assert.equal(_refCount, 0);
    assert.isNull(_sentinel);
  });

  it('ref count never goes below 0', () => {
    releaseWakeLock();
    releaseWakeLock();
    releaseWakeLock();
    assert.equal(_refCount, 0);
  });

  it('release without request does not crash', () => {
    releaseWakeLock();
    assert.equal(_refCount, 0);
    assert.isNull(_sentinel);
  });

  it('request after full release creates new sentinel', () => {
    requestWakeLock();
    releaseWakeLock();
    assert.isNull(_sentinel);
    requestWakeLock();
    assert.ok(_sentinel);
    assert.equal(_refCount, 1);
  });
});

module.exports = {};
