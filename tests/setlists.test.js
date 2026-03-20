/**
 * setlists.test.js — Tests for js/setlists.js (key distance, jarring transitions, last-played formatting)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate setlist intelligence logic ────────────────────

const _KEY_SEMITONES = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

const _JARRING_INTERVALS = new Set([1, 4, 6]);

function _keyToSemitone(keyStr) {
  if (!keyStr) return null;
  const root = keyStr.replace(/\s*(m|min|maj|dim|aug|sus|7|9|11|13|add|\/.*$).*/i, '').trim();
  return _KEY_SEMITONES[root] ?? null;
}

function _keyDistance(key1, key2) {
  const s1 = _keyToSemitone(key1), s2 = _keyToSemitone(key2);
  if (s1 === null || s2 === null) return null;
  const d = Math.abs(s1 - s2);
  return Math.min(d, 12 - d);
}

function _isJarringTransition(key1, key2) {
  const d = _keyDistance(key1, key2);
  return d !== null && _JARRING_INTERVALS.has(d);
}

function _formatLastPlayed(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Tests ───────────────────────────────────────────────────

describe('Setlists — _keyToSemitone', () => {
  it('maps C to 0', () => { assert.equal(_keyToSemitone('C'), 0); });
  it('maps D to 2', () => { assert.equal(_keyToSemitone('D'), 2); });
  it('maps B to 11', () => { assert.equal(_keyToSemitone('B'), 11); });
  it('maps C# to 1', () => { assert.equal(_keyToSemitone('C#'), 1); });
  it('maps Db to 1 (enharmonic)', () => { assert.equal(_keyToSemitone('Db'), 1); });
  it('maps Bb to 10', () => { assert.equal(_keyToSemitone('Bb'), 10); });
  it('maps A# to 10 (enharmonic)', () => { assert.equal(_keyToSemitone('A#'), 10); });
  it('maps Fb to 4 (enharmonic of E)', () => { assert.equal(_keyToSemitone('Fb'), 4); });
  it('maps E# to 5 (enharmonic of F)', () => { assert.equal(_keyToSemitone('E#'), 5); });
  it('maps Cb to 11 (enharmonic of B)', () => { assert.equal(_keyToSemitone('Cb'), 11); });
  it('maps Gb to 6', () => { assert.equal(_keyToSemitone('Gb'), 6); });
  it('maps F# to 6', () => { assert.equal(_keyToSemitone('F#'), 6); });

  it('strips minor suffix', () => { assert.equal(_keyToSemitone('Am'), 9); });
  it('strips min suffix', () => { assert.equal(_keyToSemitone('Amin'), 9); });
  it('strips maj suffix', () => { assert.equal(_keyToSemitone('Cmaj'), 0); });
  it('strips dim suffix', () => { assert.equal(_keyToSemitone('Bdim'), 11); });
  it('strips 7 suffix', () => { assert.equal(_keyToSemitone('G7'), 7); });
  it('strips slash chord suffix', () => { assert.equal(_keyToSemitone('C/G'), 0); });
  it('strips complex suffix', () => { assert.equal(_keyToSemitone('Dm7add9'), 2); });

  it('returns null for empty string', () => { assert.isNull(_keyToSemitone('')); });
  it('returns null for null', () => { assert.isNull(_keyToSemitone(null)); });
  it('returns null for undefined', () => { assert.isNull(_keyToSemitone(undefined)); });
  it('returns null for invalid key', () => { assert.isNull(_keyToSemitone('X')); });
  it('returns null for bare number', () => { assert.isNull(_keyToSemitone('7')); });
});

describe('Setlists — _keyDistance', () => {
  it('same key = 0', () => { assert.equal(_keyDistance('C', 'C'), 0); });
  it('C to D = 2', () => { assert.equal(_keyDistance('C', 'D'), 2); });
  it('C to G = 5 (perfect fifth)', () => { assert.equal(_keyDistance('C', 'G'), 5); });
  it('C to F = 5 (perfect fourth)', () => { assert.equal(_keyDistance('C', 'F'), 5); });
  it('C to F# = 6 (tritone)', () => { assert.equal(_keyDistance('C', 'F#'), 6); });
  it('C to Gb = 6 (tritone, enharmonic)', () => { assert.equal(_keyDistance('C', 'Gb'), 6); });

  it('B to C = 1 (wrapping around)', () => {
    assert.equal(_keyDistance('B', 'C'), 1);
  });

  it('C to B = 1 (wrapping, reverse)', () => {
    assert.equal(_keyDistance('C', 'B'), 1);
  });

  it('wraps to minimum distance: E to C = 4 (not 8)', () => {
    assert.equal(_keyDistance('E', 'C'), 4);
  });

  it('Bb to C# = 3', () => {
    // Bb=10, C#=1. |10-1|=9, min(9,3)=3
    assert.equal(_keyDistance('Bb', 'C#'), 3);
  });

  it('enharmonic equivalents have distance 0', () => {
    assert.equal(_keyDistance('C#', 'Db'), 0);
    assert.equal(_keyDistance('F#', 'Gb'), 0);
    assert.equal(_keyDistance('A#', 'Bb'), 0);
  });

  it('returns null when either key is null', () => {
    assert.isNull(_keyDistance(null, 'C'));
    assert.isNull(_keyDistance('C', null));
    assert.isNull(_keyDistance(null, null));
  });

  it('returns null for invalid keys', () => {
    assert.isNull(_keyDistance('X', 'C'));
    assert.isNull(_keyDistance('C', 'X'));
  });

  it('distance with minor keys uses root', () => {
    // Am (A=9) to C (C=0): |9-0|=9, min(9,3)=3
    assert.equal(_keyDistance('Am', 'C'), 3);
  });

  it('maximum distance is 6 (tritone)', () => {
    // Any key to its tritone is 6
    assert.equal(_keyDistance('C', 'F#'), 6);
    assert.equal(_keyDistance('D', 'Ab'), 6);
    assert.equal(_keyDistance('E', 'Bb'), 6);
  });
});

describe('Setlists — _isJarringTransition', () => {
  it('half step (1) is jarring', () => {
    assert.ok(_isJarringTransition('C', 'C#'));
    assert.ok(_isJarringTransition('B', 'C'));
    assert.ok(_isJarringTransition('E', 'F'));
  });

  it('major third (4) is jarring', () => {
    assert.ok(_isJarringTransition('C', 'E'));
    assert.ok(_isJarringTransition('G', 'B'));
  });

  it('tritone (6) is jarring', () => {
    assert.ok(_isJarringTransition('C', 'F#'));
    assert.ok(_isJarringTransition('D', 'Ab'));
  });

  it('unison (0) is not jarring', () => {
    assert.notOk(_isJarringTransition('C', 'C'));
  });

  it('whole step (2) is not jarring', () => {
    assert.notOk(_isJarringTransition('C', 'D'));
  });

  it('minor third (3) is not jarring', () => {
    assert.notOk(_isJarringTransition('C', 'Eb'));
  });

  it('perfect fifth (5) is not jarring', () => {
    assert.notOk(_isJarringTransition('C', 'G'));
  });

  it('null key returns false (not jarring)', () => {
    assert.notOk(_isJarringTransition(null, 'C'));
    assert.notOk(_isJarringTransition('C', null));
  });
});

describe('Setlists — _formatLastPlayed', () => {
  it('returns empty for null', () => { assert.equal(_formatLastPlayed(null), ''); });
  it('returns empty for undefined', () => { assert.equal(_formatLastPlayed(undefined), ''); });
  it('returns empty for empty string', () => { assert.equal(_formatLastPlayed(''), ''); });

  it('returns Today for today', () => {
    const today = new Date().toISOString();
    assert.equal(_formatLastPlayed(today), 'Today');
  });

  it('returns Yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    assert.equal(_formatLastPlayed(yesterday), 'Yesterday');
  });

  it('returns days ago for < 7 days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    assert.equal(_formatLastPlayed(threeDaysAgo), '3d ago');
  });

  it('returns weeks ago for < 30 days', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    assert.equal(_formatLastPlayed(twoWeeksAgo), '2w ago');
  });

  it('returns months ago for < 365 days', () => {
    const threeMonthsAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    assert.equal(_formatLastPlayed(threeMonthsAgo), '3mo ago');
  });

  it('returns years ago for >= 365 days', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString();
    assert.equal(_formatLastPlayed(twoYearsAgo), '2y ago');
  });

  it('boundary: exactly 7 days shows 1w ago', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    assert.equal(_formatLastPlayed(sevenDaysAgo), '1w ago');
  });
});

describe('Setlists — key distance comprehensive (circle of fifths)', () => {
  // Walk the circle of fifths: each step should be 5 or 7 semitones (min distance 5)
  const fifths = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

  it('adjacent keys in circle of fifths are distance 5', () => {
    for (let i = 0; i < fifths.length - 1; i++) {
      const d = _keyDistance(fifths[i], fifths[i + 1]);
      assert.equal(d, 5, `${fifths[i]} to ${fifths[i + 1]}`);
    }
  });

  it('opposite keys in circle of fifths are distance 6 (tritone)', () => {
    assert.equal(_keyDistance('C', 'F#'), 6);
    assert.equal(_keyDistance('G', 'Db'), 6);
  });
});

module.exports = {};
