/**
 * practice.test.js — Tests for js/practice.js (list management, archive behavior)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate practice list management logic ────────────────

function createPracticeList(name, createdBy, existingIds) {
  const idSet = new Set(existingIds || []);
  let id;
  let attempts = 0;
  while (attempts < 1000) {
    id = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
    if (!idSet.has(id)) break;
    attempts++;
  }
  return {
    id,
    name: name || 'New Practice List',
    createdBy: createdBy || 'unknown',
    songs: [],
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function toggleArchive(list) {
  return { ...list, archived: !list.archived, updatedAt: new Date().toISOString() };
}

function addSongToList(list, songId) {
  if (list.songs.some(s => (typeof s === 'string' ? s : s.id) === songId)) return list;
  return {
    ...list,
    songs: [...list.songs, { id: songId }],
    updatedAt: new Date().toISOString(),
  };
}

function removeSongFromList(list, songId) {
  return {
    ...list,
    songs: list.songs.filter(s => (typeof s === 'string' ? s : s.id) !== songId),
    updatedAt: new Date().toISOString(),
  };
}

function filterPracticeLists(lists, showArchived) {
  if (showArchived) return lists;
  return lists.filter(l => !l.archived);
}

function migratePracticeData(practice) {
  const isOldFormat = practice.some(item => item.practiceLists || item.lists);
  if (!isOldFormat) return practice;

  const flat = [];
  practice.forEach(persona => {
    if (persona.lists && !persona.practiceLists) {
      persona.practiceLists = [{
        id: 'migrated_' + Math.random().toString(36).slice(2, 6),
        name: 'Practice List',
        archived: false,
        createdAt: new Date().toISOString(),
        songs: persona.lists,
      }];
    }
    (persona.practiceLists || []).forEach(pl => {
      flat.push({
        id: pl.id,
        name: pl.name || 'Untitled',
        songs: pl.songs || [],
        archived: !!pl.archived,
        createdAt: pl.createdAt || new Date().toISOString(),
        updatedAt: pl.updatedAt || new Date().toISOString(),
        createdBy: 'unknown',
      });
    });
  });
  return flat;
}

// ─── Tests ───────────────────────────────────────────────────

describe('Practice — createPracticeList', () => {
  it('creates a list with given name', () => {
    const list = createPracticeList('My Practice', 'user1', []);
    assert.equal(list.name, 'My Practice');
    assert.equal(list.createdBy, 'user1');
  });

  it('creates a list with default name when none provided', () => {
    const list = createPracticeList('', 'user1', []);
    assert.equal(list.name, 'New Practice List');
  });

  it('creates a list with default creator when none provided', () => {
    const list = createPracticeList('Test', '', []);
    assert.equal(list.createdBy, 'unknown');
  });

  it('generates unique ID', () => {
    const list = createPracticeList('Test', 'user1', []);
    assert.ok(list.id);
    assert.type(list.id, 'string');
    assert.equal(list.id.length, 4);
  });

  it('avoids existing IDs', () => {
    const existingIds = ['0001', '0002', '0003'];
    const list = createPracticeList('Test', 'user1', existingIds);
    assert.notOk(existingIds.includes(list.id));
  });

  it('starts with empty songs array', () => {
    const list = createPracticeList('Test', 'user1', []);
    assert.deepEqual(list.songs, []);
  });

  it('starts unarchived', () => {
    const list = createPracticeList('Test', 'user1', []);
    assert.equal(list.archived, false);
  });

  it('has createdAt and updatedAt timestamps', () => {
    const list = createPracticeList('Test', 'user1', []);
    assert.ok(list.createdAt);
    assert.ok(list.updatedAt);
    // Should be valid ISO date
    assert.notEqual(new Date(list.createdAt).toString(), 'Invalid Date');
  });
});

describe('Practice — toggleArchive', () => {
  it('archives an unarchived list', () => {
    const list = { id: '1', name: 'Test', archived: false, updatedAt: '' };
    const result = toggleArchive(list);
    assert.ok(result.archived);
  });

  it('unarchives an archived list', () => {
    const list = { id: '1', name: 'Test', archived: true, updatedAt: '' };
    const result = toggleArchive(list);
    assert.notOk(result.archived);
  });

  it('updates updatedAt timestamp', () => {
    const list = { id: '1', name: 'Test', archived: false, updatedAt: '2020-01-01T00:00:00Z' };
    const result = toggleArchive(list);
    assert.notEqual(result.updatedAt, list.updatedAt);
  });

  it('does not mutate original', () => {
    const list = { id: '1', name: 'Test', archived: false, updatedAt: '' };
    toggleArchive(list);
    assert.equal(list.archived, false);
  });
});

describe('Practice — addSongToList', () => {
  it('adds a song to empty list', () => {
    const list = { id: '1', songs: [], updatedAt: '' };
    const result = addSongToList(list, 'song1');
    assert.equal(result.songs.length, 1);
    assert.equal(result.songs[0].id, 'song1');
  });

  it('does not add duplicate song', () => {
    const list = { id: '1', songs: [{ id: 'song1' }], updatedAt: '' };
    const result = addSongToList(list, 'song1');
    assert.equal(result.songs.length, 1);
  });

  it('appends to existing songs', () => {
    const list = { id: '1', songs: [{ id: 'song1' }], updatedAt: '' };
    const result = addSongToList(list, 'song2');
    assert.equal(result.songs.length, 2);
  });

  it('does not mutate original', () => {
    const list = { id: '1', songs: [], updatedAt: '' };
    addSongToList(list, 'song1');
    assert.equal(list.songs.length, 0);
  });
});

describe('Practice — removeSongFromList', () => {
  it('removes an existing song', () => {
    const list = { id: '1', songs: [{ id: 'song1' }, { id: 'song2' }], updatedAt: '' };
    const result = removeSongFromList(list, 'song1');
    assert.equal(result.songs.length, 1);
    assert.equal(result.songs[0].id, 'song2');
  });

  it('no-op when song not in list', () => {
    const list = { id: '1', songs: [{ id: 'song1' }], updatedAt: '' };
    const result = removeSongFromList(list, 'song99');
    assert.equal(result.songs.length, 1);
  });

  it('handles empty songs array', () => {
    const list = { id: '1', songs: [], updatedAt: '' };
    const result = removeSongFromList(list, 'song1');
    assert.equal(result.songs.length, 0);
  });

  it('does not mutate original', () => {
    const list = { id: '1', songs: [{ id: 'song1' }], updatedAt: '' };
    removeSongFromList(list, 'song1');
    assert.equal(list.songs.length, 1);
  });
});

describe('Practice — filterPracticeLists', () => {
  const lists = [
    { id: '1', name: 'Active List', archived: false },
    { id: '2', name: 'Archived List', archived: true },
    { id: '3', name: 'Another Active', archived: false },
  ];

  it('hides archived lists by default', () => {
    const result = filterPracticeLists(lists, false);
    assert.equal(result.length, 2);
    assert.notOk(result.some(l => l.id === '2'));
  });

  it('shows all lists when showArchived=true', () => {
    const result = filterPracticeLists(lists, true);
    assert.equal(result.length, 3);
  });

  it('returns empty for all-archived lists when not showing archived', () => {
    const allArchived = [{ id: '1', archived: true }, { id: '2', archived: true }];
    const result = filterPracticeLists(allArchived, false);
    assert.equal(result.length, 0);
  });
});

describe('Practice — migratePracticeData', () => {
  it('no-op for already-flat format', () => {
    const flat = [
      { id: '1', name: 'List 1', songs: [], archived: false },
      { id: '2', name: 'List 2', songs: [], archived: false },
    ];
    const result = migratePracticeData(flat);
    assert.deepEqual(result, flat);
  });

  it('flattens persona-based format', () => {
    const old = [
      {
        name: 'Persona 1',
        practiceLists: [
          { id: 'pl1', name: 'Piano Practice', songs: [{ id: 's1' }], archived: false },
          { id: 'pl2', name: 'Guitar Practice', songs: [{ id: 's2' }], archived: true },
        ],
      },
    ];
    const result = migratePracticeData(old);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'pl1');
    assert.equal(result[0].name, 'Piano Practice');
    assert.equal(result[1].archived, true);
  });

  it('handles ancient format (persona.lists)', () => {
    const ancient = [
      {
        name: 'Old Persona',
        lists: [{ id: 's1' }, { id: 's2' }],
      },
    ];
    const result = migratePracticeData(ancient);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Practice List');
  });

  it('handles empty practice array', () => {
    const result = migratePracticeData([]);
    assert.deepEqual(result, []);
  });

  it('sets default name for unnamed lists', () => {
    const old = [
      {
        practiceLists: [
          { id: 'pl1', songs: [] },
        ],
      },
    ];
    const result = migratePracticeData(old);
    assert.equal(result[0].name, 'Untitled');
  });

  it('preserves archived state', () => {
    const old = [
      {
        practiceLists: [
          { id: 'pl1', name: 'Test', songs: [], archived: true },
        ],
      },
    ];
    const result = migratePracticeData(old);
    assert.ok(result[0].archived);
  });
});

module.exports = {};
