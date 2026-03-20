/**
 * songs.test.js — Tests for js/songs.js (search/filter logic, tag matching)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate song filter logic for testing ─────────────────

function isHybridKey(k) {
  if (k.includes('/')) return true;
  const low = k.toLowerCase();
  return low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed';
}

function filteredSongs(songs, activeTags, activeKeys, searchText) {
  let list = [...songs];
  if (activeTags.length) list = list.filter(s => activeTags.every(t => (s.tags || []).includes(t)));
  if (activeKeys.length) list = list.filter(s => s.key && activeKeys.includes(s.key.trim()));
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
  for (let i = 0; i < songs.length; i++) {
    const k = (songs[i].key || '').trim();
    if (k && !isHybridKey(k)) counts[k] = (counts[k] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
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
    assert.equal(result.length, 2); // Hallelujah, Another C Song
  });

  it('filters by multiple keys', () => {
    const result = filteredSongs(SONGS, [], ['C', 'F'], '');
    assert.equal(result.length, 3); // Yesterday, Hallelujah, Another C Song
  });

  it('excludes songs with no key', () => {
    const result = filteredSongs(SONGS, [], ['C'], '');
    assert.notOk(result.some(s => s.id === '6'));
  });

  it('no matches returns empty', () => {
    const result = filteredSongs(SONGS, [], ['Eb'], '');
    assert.equal(result.length, 0);
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

describe('Songs — getAllKeys', () => {
  it('extracts unique keys', () => {
    const keys = getAllKeys(SONGS);
    assert.ok(keys.includes('C'));
    assert.ok(keys.includes('F'));
    assert.ok(keys.includes('Bm'));
    assert.ok(keys.includes('Bb'));
  });

  it('excludes hybrid keys', () => {
    const keys = getAllKeys(SONGS);
    assert.notOk(keys.includes('C/Am'));
  });

  it('excludes empty keys', () => {
    const keys = getAllKeys(SONGS);
    assert.notOk(keys.includes(''));
  });

  it('sorts by frequency then alphabetically', () => {
    const keys = getAllKeys(SONGS);
    // C appears twice, should be first
    assert.equal(keys[0], 'C');
  });

  it('returns empty for no songs', () => {
    assert.deepEqual(getAllKeys([]), []);
  });

  it('returns empty for songs with no keys', () => {
    assert.deepEqual(getAllKeys([{ id: '1', key: '' }]), []);
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
    assert.equal(result.length, 1);
  });
});

module.exports = {};
