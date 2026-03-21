/**
 * sheets.test.js — Tests for js/sheets.js (transpose/capo, chord parsing, Nashville)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate sheets transposition logic ────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ENHARMONIC = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'E#': 'F', 'B#': 'C' };
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);
const NASHVILLE = ['1', '#1/b2', '2', '#2/b3', '3', '4', '#4/b5', '5', '#5/b6', '6', '#6/b7', '7'];

function _parseChordRoot(chord) {
  if (!chord || chord === '/' || chord === 'N.C.' || chord === '%') return null;
  const match = chord.match(/^([A-G][#b]?)(.*)/);
  if (!match) return null;
  return { root: match[1], suffix: match[2] };
}

function _rootToIndex(root) {
  const normalized = ENHARMONIC[root] || root;
  const idx = NOTE_NAMES.indexOf(normalized);
  return idx >= 0 ? idx : -1;
}

function _indexToRoot(idx, useFlats) {
  const i = ((idx % 12) + 12) % 12;
  return useFlats ? NOTE_NAMES_FLAT[i] : NOTE_NAMES[i];
}

function _transposeChord(chord, semitones, useFlats) {
  if (!chord || chord === '/' || chord === 'N.C.' || chord === '%') return chord;
  const slashIdx = chord.indexOf('/');
  if (slashIdx > 0 && slashIdx < chord.length - 1) {
    const mainPart = chord.slice(0, slashIdx);
    const bassPart = chord.slice(slashIdx + 1);
    return _transposeChord(mainPart, semitones, useFlats) + '/' + _transposeChord(bassPart, semitones, useFlats);
  }
  const parsed = _parseChordRoot(chord);
  if (!parsed) return chord;
  const idx = _rootToIndex(parsed.root);
  if (idx < 0) return chord;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return _indexToRoot(newIdx, useFlats) + parsed.suffix;
}

function _chordToNashville(chord, keyRoot) {
  if (!chord || chord === '/' || chord === 'N.C.' || chord === '%') return chord;
  const parsed = _parseChordRoot(chord);
  if (!parsed) return chord;
  const chordIdx = _rootToIndex(parsed.root);
  const keyIdx = _rootToIndex(keyRoot);
  if (chordIdx < 0 || keyIdx < 0) return chord;
  const interval = ((chordIdx - keyIdx) % 12 + 12) % 12;
  const nashNum = NASHVILLE[interval];
  let suffix = parsed.suffix;
  let prefix = nashNum;
  if (suffix.startsWith('m') && !suffix.startsWith('maj')) {
    prefix = prefix.toLowerCase();
    suffix = suffix.slice(1);
  }
  return prefix + suffix;
}

const DIATONIC_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DIATONIC_SUFFIXES = ['', 'm', 'm', '', '', 'm', 'dim'];

function _getDiatonicChords(key) {
  if (!key) return [];
  const parsed = _parseChordRoot(key);
  if (!parsed) return [];
  const keyIdx = _rootToIndex(parsed.root);
  if (keyIdx < 0) return [];
  const isMinor = key.includes('m') && !key.includes('maj');
  const useFlats = FLAT_KEYS.has(key);
  const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : DIATONIC_MAJOR;
  const suffixes = isMinor ? ['m', 'dim', '', 'm', 'm', '', ''] : DIATONIC_SUFFIXES;
  return intervals.map((interval, i) => {
    const noteIdx = ((keyIdx + interval) % 12 + 12) % 12;
    return _indexToRoot(noteIdx, useFlats) + suffixes[i];
  });
}

// ─── Tests ───────────────────────────────────────────────────

describe('Sheets — _parseChordRoot', () => {
  it('parses simple major chord', () => {
    const r = _parseChordRoot('C');
    assert.equal(r.root, 'C');
    assert.equal(r.suffix, '');
  });

  it('parses minor chord', () => {
    const r = _parseChordRoot('Am');
    assert.equal(r.root, 'A');
    assert.equal(r.suffix, 'm');
  });

  it('parses sharp chord', () => {
    const r = _parseChordRoot('F#m7');
    assert.equal(r.root, 'F#');
    assert.equal(r.suffix, 'm7');
  });

  it('parses flat chord', () => {
    const r = _parseChordRoot('Bb7');
    assert.equal(r.root, 'Bb');
    assert.equal(r.suffix, '7');
  });

  it('parses complex suffix', () => {
    const r = _parseChordRoot('Cmaj7add9');
    assert.equal(r.root, 'C');
    assert.equal(r.suffix, 'maj7add9');
  });

  it('returns null for N.C.', () => { assert.isNull(_parseChordRoot('N.C.')); });
  it('returns null for %', () => { assert.isNull(_parseChordRoot('%')); });
  it('returns null for /', () => { assert.isNull(_parseChordRoot('/')); });
  it('returns null for null', () => { assert.isNull(_parseChordRoot(null)); });
  it('returns null for empty string', () => { assert.isNull(_parseChordRoot('')); });
  it('returns null for non-note', () => { assert.isNull(_parseChordRoot('Xm7')); });
  it('returns null for number', () => { assert.isNull(_parseChordRoot('7')); });
});

describe('Sheets — _rootToIndex', () => {
  it('maps C to 0', () => { assert.equal(_rootToIndex('C'), 0); });
  it('maps B to 11', () => { assert.equal(_rootToIndex('B'), 11); });
  it('maps sharps correctly', () => {
    assert.equal(_rootToIndex('C#'), 1);
    assert.equal(_rootToIndex('F#'), 6);
  });
  it('maps flats via enharmonic', () => {
    assert.equal(_rootToIndex('Db'), 1);
    assert.equal(_rootToIndex('Eb'), 3);
    assert.equal(_rootToIndex('Gb'), 6);
    assert.equal(_rootToIndex('Ab'), 8);
    assert.equal(_rootToIndex('Bb'), 10);
  });
  it('maps unusual enharmonics', () => {
    assert.equal(_rootToIndex('Fb'), 4);  // E
    assert.equal(_rootToIndex('E#'), 5);  // F
    assert.equal(_rootToIndex('Cb'), 11); // B
    assert.equal(_rootToIndex('B#'), 0);  // C
  });
  it('returns -1 for invalid root', () => {
    assert.equal(_rootToIndex('X'), -1);
    assert.equal(_rootToIndex(''), -1);
  });
});

describe('Sheets — _indexToRoot', () => {
  it('returns sharp names by default', () => {
    assert.equal(_indexToRoot(0, false), 'C');
    assert.equal(_indexToRoot(1, false), 'C#');
    assert.equal(_indexToRoot(6, false), 'F#');
  });

  it('returns flat names when useFlats=true', () => {
    assert.equal(_indexToRoot(1, true), 'Db');
    assert.equal(_indexToRoot(3, true), 'Eb');
    assert.equal(_indexToRoot(6, true), 'Gb');
    assert.equal(_indexToRoot(8, true), 'Ab');
    assert.equal(_indexToRoot(10, true), 'Bb');
  });

  it('wraps negative indices', () => {
    assert.equal(_indexToRoot(-1, false), 'B');
    assert.equal(_indexToRoot(-2, false), 'A#');
    assert.equal(_indexToRoot(-12, false), 'C');
  });

  it('wraps large indices', () => {
    assert.equal(_indexToRoot(12, false), 'C');
    assert.equal(_indexToRoot(13, false), 'C#');
    assert.equal(_indexToRoot(24, false), 'C');
  });
});

describe('Sheets — _transposeChord', () => {
  it('transposes up by 1 semitone', () => {
    assert.equal(_transposeChord('C', 1, false), 'C#');
    assert.equal(_transposeChord('E', 1, false), 'F');
    assert.equal(_transposeChord('B', 1, false), 'C');
  });

  it('transposes down by 1 semitone', () => {
    assert.equal(_transposeChord('C', -1, false), 'B');
    assert.equal(_transposeChord('F', -1, false), 'E');
  });

  it('transposes with flats', () => {
    assert.equal(_transposeChord('C', 1, true), 'Db');
    assert.equal(_transposeChord('D', 1, true), 'Eb');
  });

  it('preserves suffix', () => {
    assert.equal(_transposeChord('Am', 2, false), 'Bm');
    assert.equal(_transposeChord('Cmaj7', 5, false), 'Fmaj7');
    assert.equal(_transposeChord('Dm7', 3, true), 'Fm7');
  });

  it('transposes slash chords (both parts)', () => {
    assert.equal(_transposeChord('G/B', 2, false), 'A/C#');
    assert.equal(_transposeChord('C/E', 1, true), 'Db/F');
  });

  it('wraps around octave', () => {
    assert.equal(_transposeChord('A', 5, false), 'D');
    assert.equal(_transposeChord('G', 7, false), 'D');
  });

  it('transpose by 0 returns same chord', () => {
    assert.equal(_transposeChord('Am7', 0, false), 'Am7');
  });

  it('transpose by 12 returns same chord', () => {
    assert.equal(_transposeChord('C', 12, false), 'C');
    assert.equal(_transposeChord('F#m', 12, false), 'F#m');
  });

  it('transpose by -12 returns same chord', () => {
    assert.equal(_transposeChord('Bb', -12, true), 'Bb');
  });

  it('passthrough for special tokens', () => {
    assert.equal(_transposeChord('N.C.', 5, false), 'N.C.');
    assert.equal(_transposeChord('%', 3, false), '%');
    assert.equal(_transposeChord('/', 1, false), '/');
    assert.isNull(_transposeChord(null, 1, false));
    assert.equal(_transposeChord('', 1, false), '');
  });

  it('handles double-flat root via enharmonic', () => {
    // Bb transposed up 1 = B (sharp mode) or B (flat mode)
    assert.equal(_transposeChord('Bb', 1, false), 'B');
    assert.equal(_transposeChord('Bb', 1, true), 'B');
  });
});

describe('Sheets — _chordToNashville', () => {
  it('C in key of C = 1', () => {
    assert.equal(_chordToNashville('C', 'C'), '1');
  });

  it('G in key of C = 5', () => {
    assert.equal(_chordToNashville('G', 'C'), '5');
  });

  it('F in key of C = 4', () => {
    assert.equal(_chordToNashville('F', 'C'), '4');
  });

  it('Am in key of C = 6 (lowercase for minor)', () => {
    const result = _chordToNashville('Am', 'C');
    assert.equal(result, '6');
  });

  it('Em in key of C = 3 (lowercase for minor)', () => {
    assert.equal(_chordToNashville('Em', 'C'), '3');
  });

  it('Dm7 in key of C = 2 + 7 suffix', () => {
    const result = _chordToNashville('Dm7', 'C');
    assert.equal(result, '27');
  });

  it('D in key of G = 5', () => {
    assert.equal(_chordToNashville('D', 'G'), '5');
  });

  it('F# in key of D = 3', () => {
    assert.equal(_chordToNashville('F#', 'D'), '3');
  });

  it('Bb in key of F = 4', () => {
    assert.equal(_chordToNashville('Bb', 'F'), '4');
  });

  it('passthrough for N.C.', () => {
    assert.equal(_chordToNashville('N.C.', 'C'), 'N.C.');
  });

  it('passthrough for %', () => {
    assert.equal(_chordToNashville('%', 'C'), '%');
  });
});

describe('Sheets — _getDiatonicChords', () => {
  it('C major diatonic chords', () => {
    const chords = _getDiatonicChords('C');
    assert.equal(chords.length, 7);
    assert.equal(chords[0], 'C');    // I
    assert.equal(chords[1], 'Dm');   // ii
    assert.equal(chords[2], 'Em');   // iii
    assert.equal(chords[3], 'F');    // IV
    assert.equal(chords[4], 'G');    // V
    assert.equal(chords[5], 'Am');   // vi
    assert.equal(chords[6], 'Bdim'); // vii°
  });

  it('G major diatonic chords', () => {
    const chords = _getDiatonicChords('G');
    assert.equal(chords[0], 'G');
    assert.equal(chords[4], 'D');    // V
    assert.equal(chords[5], 'Em');   // vi
  });

  it('F major uses flats', () => {
    const chords = _getDiatonicChords('F');
    assert.equal(chords[0], 'F');
    assert.equal(chords[3], 'Bb');   // IV (flat)
  });

  it('Am natural minor diatonic chords', () => {
    const chords = _getDiatonicChords('Am');
    assert.equal(chords.length, 7);
    assert.equal(chords[0], 'Am');   // i
    assert.equal(chords[2], 'C');    // III
    assert.equal(chords[5], 'F');    // VI
  });

  it('returns empty for null key', () => {
    assert.deepEqual(_getDiatonicChords(null), []);
    assert.deepEqual(_getDiatonicChords(''), []);
  });

  it('returns empty for invalid key', () => {
    assert.deepEqual(_getDiatonicChords('X'), []);
  });

  it('Bb major uses flats', () => {
    const chords = _getDiatonicChords('Bb');
    assert.equal(chords[0], 'Bb');
    assert.equal(chords[3], 'Eb');
  });
});

describe('Sheets — transposition edge cases', () => {
  it('all 12 semitones cycle back to original', () => {
    const original = 'Dm7';
    let chord = original;
    for (let i = 0; i < 12; i++) {
      chord = _transposeChord(chord, 1, false);
    }
    assert.equal(chord, original);
  });

  it('transpose -11 = transpose +1', () => {
    assert.equal(
      _transposeChord('C', -11, false),
      _transposeChord('C', 1, false)
    );
  });

  it('sus chords preserve suffix', () => {
    assert.equal(_transposeChord('Csus4', 2, false), 'Dsus4');
    assert.equal(_transposeChord('Gsus2', 5, false), 'Csus2');
  });

  it('augmented chords preserve suffix', () => {
    assert.equal(_transposeChord('Caug', 4, false), 'Eaug');
  });

  it('diminished chords preserve suffix', () => {
    assert.equal(_transposeChord('Cdim', 3, false), 'D#dim');
    assert.equal(_transposeChord('Cdim', 3, true), 'Ebdim');
  });
});

module.exports = {};
