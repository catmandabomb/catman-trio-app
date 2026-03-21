/**
 * songs.test.js — Tests for js/songs.js (search/filter logic, tag matching)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Key parsing (replicated from utils.js) ──────────────────

const CANONICAL_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const CANONICAL_MINOR = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const ALL_CANONICAL_KEYS = [...CANONICAL_MAJOR, ...CANONICAL_MINOR];

const _enharmonicMap = {
  'C#': 'Db', 'D#': 'Eb', 'E#': 'F', 'Fb': 'E', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb', 'B#': 'C', 'Cb': 'B',
  'C#m': 'C#m', 'Dbm': 'C#m', 'D#m': 'Ebm', 'Fbm': 'Em', 'Gbm': 'F#m', 'G#m': 'G#m', 'Abm': 'G#m', 'A#m': 'Bbm', 'B#m': 'Cm', 'Cbm': 'Bm', 'E#m': 'Fm',
};

function normalizeKey(raw) {
  let s = raw.trim();
  if (!s) return null;
  const rootMatch = s.match(/^([A-Ga-g][#b]?)/);
  if (!rootMatch) return null;
  let root = rootMatch[1];
  root = root.charAt(0).toUpperCase() + root.slice(1);
  const remainder = s.slice(rootMatch[0].length).toLowerCase().trim();
  let isMinor = false;
  if (remainder === 'm' || remainder === 'min' || remainder === 'minor' || remainder.startsWith('min')) {
    isMinor = true;
  }
  const key = isMinor ? root + 'm' : root;
  if (_enharmonicMap[key]) return _enharmonicMap[key];
  if (ALL_CANONICAL_KEYS.includes(key)) return key;
  return null;
}

function parseKeyField(keyField) {
  if (!keyField) return [];
  const s = keyField.trim();
  if (!s) return [];
  const low = s.toLowerCase();
  if (low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed' || low === 'n/a' || low === 'none') return [];
  const results = new Set();
  const majMinMatch = s.match(/^([A-Ga-g][#b]?)\s*maj(?:or)?\s*\/\s*min(?:or)?$/i);
  if (majMinMatch) {
    let root = majMinMatch[1];
    root = root.charAt(0).toUpperCase() + root.slice(1);
    const major = normalizeKey(root);
    const minor = normalizeKey(root + 'm');
    if (major) results.add(major);
    if (minor) results.add(minor);
    return [...results];
  }
  const parts = s.split('/');
  let lastRoot = null;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const qualOnly = trimmed.match(/^(min|minor|maj|major)$/i);
    if (qualOnly && lastRoot) {
      const isMinor = qualOnly[1].toLowerCase().startsWith('min');
      const key = normalizeKey(lastRoot + (isMinor ? 'min' : ''));
      if (key) results.add(key);
      continue;
    }
    const key = normalizeKey(trimmed);
    if (key) {
      results.add(key);
      const rm = trimmed.match(/^([A-Ga-g][#b]?)/);
      if (rm) lastRoot = rm[1].charAt(0).toUpperCase() + rm[1].slice(1);
    }
  }
  return [...results];
}

function songMatchesKey(songKey, filterKey) {
  return parseKeyField(songKey).includes(filterKey);
}

// ─── Replicate song filter logic for testing ─────────────────

function filteredSongs(songs, activeTags, activeKeys, searchText) {
  let list = [...songs];
  if (activeTags.length) list = list.filter(s => activeTags.every(t => (s.tags || []).includes(t)));
  if (activeKeys.length) list = list.filter(s => s.key && activeKeys.some(k => songMatchesKey(s.key, k)));
  if (searchText) {
    const q = searchText.toLowerCase();
    list = list.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.subtitle || '').toLowerCase().includes(q) ||
      (s.key || '').toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (s.notes || '').toLowerCase().includes(q)
    );
  }
  return list;
}

function getAllKeys(songs) {
  const counts = {};
  for (const k of ALL_CANONICAL_KEYS) counts[k] = 0;
  for (let i = 0; i < songs.length; i++) {
    const parsed = parseKeyField(songs[i].key);
    for (const k of parsed) {
      if (counts[k] !== undefined) counts[k]++;
    }
  }
  return [...ALL_CANONICAL_KEYS].sort((a, b) => {
    const diff = counts[b] - counts[a];
    if (diff !== 0) return diff;
    return ALL_CANONICAL_KEYS.indexOf(a) - ALL_CANONICAL_KEYS.indexOf(b);
  });
}

// ─── Test data ───────────────────────────────────────────────

const SONGS = [
  { id: '1', title: 'Yesterday', subtitle: 'The Beatles', key: 'F', tags: ['Classic', 'Ballad'], notes: 'Acoustic version' },
  { id: '2', title: 'Hotel California', subtitle: 'Eagles', key: 'Bm', tags: ['Classic', 'Rock'], notes: '' },
  { id: '3', title: 'Wonderwall', subtitle: 'Oasis', key: 'F#m', tags: ['Rock', '90s'], notes: 'Capo 2' },
  { id: '4', title: 'Hallelujah', subtitle: 'Leonard Cohen', key: 'C', tags: ['Ballad'], notes: '' },
  { id: '5', title: 'Bohemian Rhapsody', subtitle: 'Queen', key: 'Bb', tags: ['Rock', 'Classic'], notes: 'Full arrangement' },
  { id: '6', title: 'No Key Song', subtitle: '', key: '', tags: [], notes: '' },
  { id: '7', title: 'Multi Key', subtitle: '', key: 'C/Am', tags: ['Jazz'], notes: '' },
  { id: '8', title: 'Another C Song', subtitle: '', key: 'C', tags: ['Pop'], notes: '' },
];

// ─── Tests ───────────────────────────────────────────────────

describe('Songs — filteredSongs with no filters', () => {
  it('returns all songs when no filters active', () => {
    const result = filteredSongs(SONGS, [], [], '');
    assert.equal(result.length, SONGS.length);
  });
});

describe('Songs — tag filtering', () => {
  it('filters by single tag', () => {
    const result = filteredSongs(SONGS, ['Rock'], [], '');
    assert.equal(result.length, 3); // Hotel California, Wonderwall, Bohemian Rhapsody
  });

  it('filters by multiple tags (AND logic)', () => {
    const result = filteredSongs(SONGS, ['Classic', 'Rock'], [], '');
    assert.equal(result.length, 2); // Hotel California, Bohemian Rhapsody
  });

  it('no matches returns empty', () => {
    const result = filteredSongs(SONGS, ['NonExistentTag'], [], '');
    assert.equal(result.length, 0);
  });

  it('handles songs with no tags', () => {
    const result = filteredSongs(SONGS, ['Classic'], [], '');
    // Song 6 has no tags, should be excluded
    assert.notOk(result.some(s => s.id === '6'));
  });
});

describe('Songs — key filtering', () => {
  it('filters by single key', () => {
    const result = filteredSongs(SONGS, [], ['C'], '');
    assert.equal(result.length, 3); // Hallelujah, Another C Song, Multi Key (C/Am → C + Am)
  });

  it('filters by multiple keys', () => {
    const result = filteredSongs(SONGS, [], ['C', 'F'], '');
    assert.equal(result.length, 4); // Yesterday, Hallelujah, Another C Song, Multi Key
  });

  it('excludes songs with no key', () => {
    const result = filteredSongs(SONGS, [], ['C'], '');
    assert.notOk(result.some(s => s.id === '6'));
  });

  it('no matches returns empty', () => {
    const result = filteredSongs(SONGS, [], ['Eb'], '');
    assert.equal(result.length, 0);
  });

  it('multi-key song matches any of its keys', () => {
    const result = filteredSongs(SONGS, [], ['Am'], '');
    assert.ok(result.some(s => s.id === '7')); // C/Am → matches Am
  });
});

describe('Songs — search text filtering', () => {
  it('searches by title', () => {
    const result = filteredSongs(SONGS, [], [], 'yesterday');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('search is case-insensitive', () => {
    const result = filteredSongs(SONGS, [], [], 'YESTERDAY');
    assert.equal(result.length, 1);
  });

  it('searches by subtitle', () => {
    const result = filteredSongs(SONGS, [], [], 'Beatles');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('searches by key', () => {
    const result = filteredSongs(SONGS, [], [], 'Bm');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  it('searches by tag', () => {
    const result = filteredSongs(SONGS, [], [], 'Jazz');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '7');
  });

  it('searches by notes', () => {
    const result = filteredSongs(SONGS, [], [], 'Capo');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '3');
  });

  it('partial match works', () => {
    const result = filteredSongs(SONGS, [], [], 'wall');
    assert.equal(result.length, 1); // Wonderwall
  });

  it('empty search returns all', () => {
    const result = filteredSongs(SONGS, [], [], '');
    assert.equal(result.length, SONGS.length);
  });

  it('no matches returns empty', () => {
    const result = filteredSongs(SONGS, [], [], 'zzzzzzz');
    assert.equal(result.length, 0);
  });
});

describe('Songs — combined filters', () => {
  it('tag + search combined', () => {
    const result = filteredSongs(SONGS, ['Classic'], [], 'hotel');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  it('key + search combined', () => {
    const result = filteredSongs(SONGS, [], ['C'], 'hallelujah');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '4');
  });

  it('tag + key + search combined', () => {
    const result = filteredSongs(SONGS, ['Rock'], ['Bm'], 'hotel');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  it('conflicting filters return empty', () => {
    const result = filteredSongs(SONGS, ['Jazz'], ['F'], 'yesterday');
    assert.equal(result.length, 0);
  });
});

describe('Songs — getAllKeys (24 canonical)', () => {
  it('always returns exactly 24 keys', () => {
    const keys = getAllKeys(SONGS);
    assert.equal(keys.length, 24);
  });

  it('includes all major and minor keys', () => {
    const keys = getAllKeys(SONGS);
    assert.ok(keys.includes('C'));
    assert.ok(keys.includes('Am'));
    assert.ok(keys.includes('F#'));
    assert.ok(keys.includes('Ebm'));
  });

  it('parses multi-key fields into canonical keys', () => {
    const keys = getAllKeys(SONGS);
    // C/Am song contributes to both C and Am counts
    assert.ok(keys.includes('C'));
    assert.ok(keys.includes('Am'));
  });

  it('sorts by frequency (C has 3 songs, should be first)', () => {
    const keys = getAllKeys(SONGS);
    assert.equal(keys[0], 'C'); // Hallelujah, Another C Song, Multi Key (C/Am)
  });

  it('returns 24 even for empty songs list', () => {
    assert.equal(getAllKeys([]).length, 24);
  });

  it('returns 24 even for songs with no keys', () => {
    assert.equal(getAllKeys([{ id: '1', key: '' }]).length, 24);
  });
});

describe('Songs — key parsing', () => {
  it('parses simple major key', () => {
    assert.deepEqual(parseKeyField('C'), ['C']);
  });

  it('parses simple minor key', () => {
    assert.deepEqual(parseKeyField('Am'), ['Am']);
  });

  it('parses slash-separated keys', () => {
    const result = parseKeyField('C/Am');
    assert.ok(result.includes('C'));
    assert.ok(result.includes('Am'));
  });

  it('parses "E maj/min"', () => {
    const result = parseKeyField('E maj/min');
    assert.ok(result.includes('E'));
    assert.ok(result.includes('Em'));
  });

  it('parses "F#min/Ebmaj"', () => {
    const result = parseKeyField('F#min/Ebmaj');
    assert.ok(result.includes('F#m'));
    assert.ok(result.includes('Eb'));
  });

  it('normalizes enharmonics: C# → Db', () => {
    assert.deepEqual(parseKeyField('C#'), ['Db']);
  });

  it('normalizes enharmonics: Gb → F#', () => {
    assert.deepEqual(parseKeyField('Gb'), ['F#']);
  });

  it('rejects "Multiple"', () => {
    assert.deepEqual(parseKeyField('Multiple'), []);
  });

  it('rejects "Various"', () => {
    assert.deepEqual(parseKeyField('Various'), []);
  });

  it('rejects empty/null', () => {
    assert.deepEqual(parseKeyField(''), []);
    assert.deepEqual(parseKeyField(null), []);
  });

  it('songMatchesKey works for direct key', () => {
    assert.ok(songMatchesKey('C', 'C'));
    assert.notOk(songMatchesKey('C', 'Am'));
  });

  it('songMatchesKey works for multi-key', () => {
    assert.ok(songMatchesKey('C/Am', 'C'));
    assert.ok(songMatchesKey('C/Am', 'Am'));
    assert.notOk(songMatchesKey('C/Am', 'E'));
  });

  it('songMatchesKey works for maj/min', () => {
    assert.ok(songMatchesKey('E maj/min', 'E'));
    assert.ok(songMatchesKey('E maj/min', 'Em'));
  });
});

describe('Songs — edge cases', () => {
  it('handles songs with null tags', () => {
    const songs = [{ id: '1', title: 'Test', tags: null }];
    const result = filteredSongs(songs, ['Rock'], [], '');
    assert.equal(result.length, 0); // null tags treated as []
  });

  it('handles songs with undefined fields', () => {
    const songs = [{ id: '1' }];
    const result = filteredSongs(songs, [], [], 'test');
    assert.equal(result.length, 0);
  });

  it('search handles special regex chars in query', () => {
    const songs = [{ id: '1', title: 'Test (Live)', tags: [] }];
    const result = filteredSongs(songs, [], [], '(Live)');
    assert.equal(result.length, 1); // includes() doesn't use regex
  });

  it('trims key whitespace for matching', () => {
    const songs = [{ id: '1', title: 'Test', key: ' C ' }];
    const result = filteredSongs(songs, [], ['C'], '');
    assert.equal(result.length, 1); // parseKeyField trims whitespace
  });
});

module.exports = {};
