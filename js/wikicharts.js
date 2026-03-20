/**
 * wikicharts.js — Text-based chord chart creation & display
 *
 * Full WikiChart system: list, detail, create/edit views with
 * transposition, Nashville numbers, auto-scroll teleprompter,
 * chord diagrams, and more.
 *
 * Permissions: ALL logged-in users can create/edit/delete their own WikiCharts.
 * Admins can edit/delete any WikiChart.
 * Only admins can link WikiCharts to setlist freetext entries.
 *
 * @module wikicharts
 */

import * as Store from './store.js?v=20.21';
import { esc, showToast, haptic, deepClone, safeRender } from './utils.js?v=20.21';
import * as Modal from './modal.js?v=20.21';
import * as Router from './router.js?v=20.21';
import * as Admin from '../admin.js?v=20.21';
import * as Auth from '../auth.js?v=20.21';
import * as Sync from './sync.js?v=20.21';

// ─── Constants ──────────────────────────────────────────────

const SECTION_TYPES = ['INTRO', 'VERSE', 'PRE-CHORUS', 'CHORUS', 'BRIDGE', 'SOLO', 'OUTRO', 'INTERLUDE', 'TAG', 'TURNAROUND', 'BREAK', 'VAMP', 'CODA'];
const SECTION_COLORS = {
  'INTRO':       'var(--wc-intro)',
  'VERSE':       'var(--wc-verse)',
  'PRE-CHORUS':  'var(--wc-prechorus)',
  'CHORUS':      'var(--wc-chorus)',
  'BRIDGE':      'var(--wc-bridge)',
  'SOLO':        'var(--wc-solo)',
  'OUTRO':       'var(--wc-outro)',
  'INTERLUDE':   'var(--wc-interlude)',
  'TAG':         'var(--wc-tag)',
  'TURNAROUND':  'var(--wc-turnaround)',
  'BREAK':       'var(--wc-break)',
  'VAMP':        'var(--wc-vamp)',
  'CODA':        'var(--wc-coda)',
};

const STRUCTURE_TAGS = [
  'Verse-Chorus', 'AABA', '12-Bar Blues', 'Through-Composed',
  'Rondo', 'Strophic', 'Binary', 'Ternary', 'Free Form',
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ENHARMONIC = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'E#': 'F', 'B#': 'C' };
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

const NASHVILLE = ['1', '#1/b2', '2', '#2/b3', '3', '4', '#4/b5', '5', '#5/b6', '6', '#6/b7', '7'];

const PROGRESSION_LIBRARY = [
  { name: 'I - V - vi - IV', chords: ['I', 'V', 'vi', 'IV'], genre: 'Pop' },
  { name: 'I - IV - V - I', chords: ['I', 'IV', 'V', 'I'], genre: 'Folk/Country' },
  { name: 'ii - V - I', chords: ['ii', 'V', 'I'], genre: 'Jazz' },
  { name: 'I - vi - IV - V', chords: ['I', 'vi', 'IV', 'V'], genre: '50s/Doo-wop' },
  { name: '12-Bar Blues', chords: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'], genre: 'Blues' },
  { name: 'vi - IV - I - V', chords: ['vi', 'IV', 'I', 'V'], genre: 'Pop/Rock' },
  { name: 'I - V - vi - iii - IV - I - IV - V', chords: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], genre: 'Pachelbel Canon' },
  { name: 'i - bVI - bIII - bVII', chords: ['i', 'bVI', 'bIII', 'bVII'], genre: 'Minor Pop' },
  { name: 'I - bVII - IV - I', chords: ['I', 'bVII', 'IV', 'I'], genre: 'Rock/Mixolydian' },
];

// Common guitar chord diagrams: [fret positions from low E to high E, -1=mute, 0=open]
const CHORD_DIAGRAMS = {
  'C': { frets: [-1,3,2,0,1,0], fingers: [0,3,2,0,1,0], baseFret: 1 },
  'D': { frets: [-1,-1,0,2,3,2], fingers: [0,0,0,1,3,2], baseFret: 1 },
  'E': { frets: [0,2,2,1,0,0], fingers: [0,2,3,1,0,0], baseFret: 1 },
  'F': { frets: [1,3,3,2,1,1], fingers: [1,3,4,2,1,1], baseFret: 1 },
  'G': { frets: [3,2,0,0,0,3], fingers: [2,1,0,0,0,3], baseFret: 1 },
  'A': { frets: [-1,0,2,2,2,0], fingers: [0,0,1,2,3,0], baseFret: 1 },
  'B': { frets: [-1,2,4,4,4,2], fingers: [0,1,2,3,4,1], baseFret: 1 },
  'Am': { frets: [-1,0,2,2,1,0], fingers: [0,0,2,3,1,0], baseFret: 1 },
  'Dm': { frets: [-1,-1,0,2,3,1], fingers: [0,0,0,2,3,1], baseFret: 1 },
  'Em': { frets: [0,2,2,0,0,0], fingers: [0,2,3,0,0,0], baseFret: 1 },
  'Fm': { frets: [1,3,3,1,1,1], fingers: [1,3,4,1,1,1], baseFret: 1 },
  'Gm': { frets: [3,5,5,3,3,3], fingers: [1,3,4,1,1,1], baseFret: 3 },
  'Bm': { frets: [-1,2,4,4,3,2], fingers: [0,1,3,4,2,1], baseFret: 1 },
  'C7': { frets: [-1,3,2,3,1,0], fingers: [0,3,2,4,1,0], baseFret: 1 },
  'D7': { frets: [-1,-1,0,2,1,2], fingers: [0,0,0,2,1,3], baseFret: 1 },
  'E7': { frets: [0,2,0,1,0,0], fingers: [0,2,0,1,0,0], baseFret: 1 },
  'G7': { frets: [3,2,0,0,0,1], fingers: [3,2,0,0,0,1], baseFret: 1 },
  'A7': { frets: [-1,0,2,0,2,0], fingers: [0,0,2,0,3,0], baseFret: 1 },
  'B7': { frets: [-1,2,1,2,0,2], fingers: [0,2,1,3,0,4], baseFret: 1 },
  'Cmaj7': { frets: [-1,3,2,0,0,0], fingers: [0,3,2,0,0,0], baseFret: 1 },
  'Fmaj7': { frets: [-1,-1,3,2,1,0], fingers: [0,0,3,2,1,0], baseFret: 1 },
  'Am7': { frets: [-1,0,2,0,1,0], fingers: [0,0,2,0,1,0], baseFret: 1 },
  'Dm7': { frets: [-1,-1,0,2,1,1], fingers: [0,0,0,2,1,1], baseFret: 1 },
  'Em7': { frets: [0,2,0,0,0,0], fingers: [0,2,0,0,0,0], baseFret: 1 },
};

// ─── Local state ────────────────────────────────────────────

let _wikiCharts = [];
let _activeWikiChart = null;
let _scrollRaf = null;
let _scrollSpeed = (() => { try { return parseFloat(localStorage.getItem('ct_pref_wc_scroll_speed')) || 1; } catch (_) { return 1; } })();
let _scrolling = false;

// Persist transpose/nashville state across back-forward nav for same chart
let _detailState = { chartId: null, transposeSemitones: 0, showNashville: false };

// Feature 17: Condensed view toggle
let _condensedView = (() => { try { return localStorage.getItem('ct_pref_wc_condensed') === 'true'; } catch (_) { return false; } })();

// Feature 24: Slash notation toggle
let _showSlashes = (() => { try { return localStorage.getItem('ct_pref_wc_slashes') === 'true'; } catch (_) { return false; } })();

// Feature 21: Section highlighting (IntersectionObserver)
let _sectionObserver = null;

// Feature 21: Metronome state
let _metronomeActive = false;
let _metronomeAudioCtx = null;
let _metronomeNextTime = 0;
let _metronomeTimerId = null;
let _metronomeBeatCount = 0;

// Playback engine state
let _playbackActive = false;
let _playbackAudioCtx = null;
let _playbackTimerId = null;
let _playbackNextTime = 0;
let _playbackBarIndex = 0;
let _playbackBars = [];       // resolved flat bar sequence from form resolution
let _playbackSectionMap = []; // maps each bar in _playbackBars to { sectionIdx, barIdx }
let _playbackChart = null;
let _playbackLastVoicing = null;
let _playbackMuteMetro = (() => { try { return localStorage.getItem('ct_pref_wc_playback_mute_metro') === 'true'; } catch (_) { return false; } })();
let _playbackRenderCallback = null; // re-render detail view

// Section loop state
let _loopSectionIdx = -1; // -1 = no loop active

// ─── ID generation ──────────────────────────────────────────

function _generateId() {
  const existing = new Set((_wikiCharts || []).map(c => c.id));
  let attempts = 0;
  while (attempts < 1000) {
    const id = 'wc_' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
    if (!existing.has(id)) return id;
    attempts++;
  }
  throw new Error('Could not generate unique WikiChart ID');
}

function _generateSectionId() {
  return 's' + Math.random().toString(36).slice(2, 8);
}

// ─── State helpers ──────────────────────────────────────────

function _syncFromStore() {
  _wikiCharts = Store.get('wikiCharts') || [];
}

function _syncToStore() {
  Store.set('wikiCharts', _wikiCharts);
}

async function _saveWikiCharts(toastMsg) {
  _syncToStore();
  return Sync.saveWikiCharts(toastMsg);
}

// ─── Transposition engine ───────────────────────────────────

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
  // Handle slash chords: G/B → transpose both
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

function _transposeSection(section, semitones, useFlats) {
  return {
    ...section,
    bars: (section.bars || []).map(bar => ({
      ...bar,
      chord: _transposeChord(bar.chord, semitones, useFlats),
    })),
  };
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
  // Suffix: m → lowercase roman, 7 → superscript, etc.
  let suffix = parsed.suffix;
  let prefix = nashNum;
  if (suffix.startsWith('m') && !suffix.startsWith('maj')) {
    // minor chord — lowercase
    prefix = prefix.toLowerCase();
    suffix = suffix.slice(1);
  }
  return prefix + suffix;
}

// _capoKey() — PARKED. See CLAUDE/parked-capo-code.js for full implementation.

// ─── Diatonic chord suggestions ─────────────────────────────

const DIATONIC_MAJOR = [0, 2, 4, 5, 7, 9, 11]; // I ii iii IV V vi vii°
const DIATONIC_SUFFIXES = ['', 'm', 'm', '', '', 'm', 'dim'];

function _getDiatonicChords(key) {
  if (!key) return [];
  const parsed = _parseChordRoot(key);
  if (!parsed) return [];
  const keyIdx = _rootToIndex(parsed.root);
  if (keyIdx < 0) return [];
  const isMinor = key.includes('m') && !key.includes('maj');
  const useFlats = FLAT_KEYS.has(key);
  // For minor keys, rotate intervals
  const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : DIATONIC_MAJOR;
  const suffixes = isMinor ? ['m', 'dim', '', 'm', 'm', '', ''] : DIATONIC_SUFFIXES;
  return intervals.map((interval, i) => {
    const noteIdx = ((keyIdx + interval) % 12 + 12) % 12;
    return _indexToRoot(noteIdx, useFlats) + suffixes[i];
  });
}

// ─── UG/Text parser ─────────────────────────────────────────

function _parseChordText(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;
  const sectionRe = /^\[?(INTRO|VERSE|PRE[- ]?CHORUS|CHORUS|BRIDGE|SOLO|OUTRO|INTERLUDE|TAG|TURNAROUND|BREAK|VAMP|CODA)\s*\d*\]?\s*$/i;
  const chordLineRe = /^[\s]*([A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13|6|\d|\/[A-G][#b]?)*[\s]*){1,}/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for section header
    const secMatch = trimmed.match(sectionRe);
    if (secMatch) {
      if (currentSection) sections.push(currentSection);
      const type = secMatch[1].toUpperCase().replace(/[- ]/, '-');
      const matchedType = SECTION_TYPES.find(t => t === type || t.startsWith(type.slice(0, 3)));
      currentSection = {
        id: _generateSectionId(),
        type: matchedType || 'VERSE',
        label: trimmed.replace(/[\[\]]/g, ''),
        repeat: 1,
        bars: [],
        cues: [],
      };
      continue;
    }

    // Check if line looks like chords
    if (chordLineRe.test(trimmed)) {
      if (!currentSection) {
        currentSection = {
          id: _generateSectionId(),
          type: 'VERSE',
          label: 'Verse',
          repeat: 1,
          bars: [],
          cues: [],
        };
      }
      // Extract chord tokens
      const tokens = trimmed.split(/\s+/).filter(t => /^[A-G]/.test(t) || t === '/' || t === '%' || t === 'N.C.');
      for (const token of tokens) {
        currentSection.bars.push({ chord: token, beats: 4 });
      }
    }
  }
  if (currentSection) sections.push(currentSection);
  return sections;
}

// ─── ASCII export ───────────────────────────────────────────

function _exportAscii(chart) {
  const lines = [];
  lines.push(chart.title || 'Untitled');
  const meta = [];
  if (chart.key) meta.push('Key: ' + chart.key);
  if (chart.bpm) meta.push('BPM: ' + chart.bpm);
  if (chart.timeSig) meta.push(chart.timeSig);
  if (chart.feel) meta.push(chart.feel);
  if (meta.length) lines.push(meta.join(' | '));
  lines.push('');

  for (const section of (chart.sections || [])) {
    lines.push('[' + (section.label || section.type) + ']' + (section.repeat > 1 ? ' x' + section.repeat : ''));
    // Format bars in groups of 4
    const bars = section.bars || [];
    for (let i = 0; i < bars.length; i += 4) {
      const group = bars.slice(i, i + 4).map(b => {
        if (b.chord === '/' || !b.chord) return '/ / / /';
        return b.chord;
      });
      lines.push('| ' + group.join(' | ') + ' |');
    }
    // Cues
    for (const cue of (section.cues || [])) {
      lines.push('  ^ ' + cue.text + (cue.barIdx !== undefined ? ' (bar ' + (cue.barIdx + 1) + ')' : ''));
    }
    lines.push('');
  }

  if (chart.notes) {
    lines.push('Notes: ' + chart.notes);
  }
  return lines.join('\n');
}

// ─── ChordPro export ────────────────────────────────────────

function _exportChordPro(chart) {
  const lines = [];
  lines.push(`{title: ${chart.title || 'Untitled'}}`);
  if (chart.key) lines.push(`{key: ${chart.key}}`);
  if (chart.bpm) lines.push(`{tempo: ${chart.bpm}}`);
  if (chart.timeSig) lines.push(`{time: ${chart.timeSig}}`);
  if (chart.feel) lines.push(`{comment: ${chart.feel}}`);
  lines.push('');

  for (const section of (chart.sections || [])) {
    const label = section.label || section.type;
    lines.push(`{comment: ${label}${section.repeat > 1 ? ' x' + section.repeat : ''}}`);
    // Group bars into rows of 4
    const bars = section.bars || [];
    for (let i = 0; i < bars.length; i += 4) {
      const group = bars.slice(i, i + 4).map(b => {
        const ch = b.chord && b.chord !== '/' ? b.chord : '';
        return ch ? `[${ch}]` : '[]';
      });
      lines.push(group.join(' '));
    }
    lines.push('');
  }

  if (chart.notes) {
    lines.push(`{comment: Notes: ${chart.notes}}`);
  }
  return lines.join('\n');
}

// ─── Condensed text export ──────────────────────────────────

function _exportCondensed(chart) {
  const lines = [];
  lines.push(chart.title || 'Untitled');
  const meta = [];
  if (chart.key) meta.push('Key: ' + chart.key);
  if (chart.bpm) meta.push('BPM: ' + chart.bpm);
  if (chart.timeSig) meta.push(chart.timeSig);
  if (chart.feel) meta.push(chart.feel);
  if (meta.length) lines.push(meta.join(' | '));
  lines.push('');

  for (const section of (chart.sections || [])) {
    const label = section.label || section.type;
    const bars = section.bars || [];
    const chords = bars.map(b => (b.chord && b.chord !== '/') ? b.chord : '/').join(' | ');
    const repeat = section.repeat > 1 ? ', x' + section.repeat : '';
    lines.push(`${label}: ${chords} (${bars.length} bar${bars.length !== 1 ? 's' : ''}${repeat})`);
  }

  if (chart.notes) {
    lines.push('');
    lines.push('Notes: ' + chart.notes);
  }
  return lines.join('\n');
}

// ─── Version history helpers ────────────────────────────────

function _saveVersion(chart) {
  if (!chart.versions) chart.versions = [];
  // Deep clone current state (without versions array to avoid recursion)
  const snapshot = deepClone(chart);
  delete snapshot.versions;
  snapshot._savedAt = new Date().toISOString();
  chart.versions.unshift(snapshot);
  // Keep max 5 versions
  if (chart.versions.length > 5) chart.versions = chart.versions.slice(0, 5);
}

// ─── Navigation helpers ─────────────────────────────────────

function _showView(name) { Store.set('skipViewTransition', true); Router.showView(name); }
function _setTopbar(title, showBack) { Router.setTopbar(title, showBack); }
function _pushNav(fn) { Router.pushNav(fn); }
function _setRouteParams(p) { Store.set('currentRouteParams', p); }

// ─── Permission helpers ─────────────────────────────────────

function _canEdit(chart) {
  if (!Auth.isLoggedIn()) return false;
  // Admins can edit any chart
  if (Auth.canEditSongs()) return true;
  // Standard users can edit their own charts
  const user = Auth.getUser();
  return user && chart.createdBy === user.id;
}

function _canDelete(chart) {
  return _canEdit(chart);
}

// ═══════════════════════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════════════════════

function renderWikiChartsList(opts) {
  _syncFromStore();
  _showView('wikicharts');
  _setTopbar('WikiCharts', true);
  _setRouteParams({});
  _pushNav(() => {
    // Back goes to song list
    Router.showView('list');
    Router.setTopbar('', false, false, true);
  });

  const container = document.getElementById('wikicharts-list');
  if (!container) return;

  // Inject topbar action buttons synchronously (matches setlists/practice pattern)
  document.getElementById('wikicharts-topbar-actions')?.remove();
  const topbar = document.querySelector('.topbar-right');
  if (topbar && Auth.isLoggedIn()) {
    const actionsWrap = document.createElement('span');
    actionsWrap.id = 'wikicharts-topbar-actions';
    actionsWrap.innerHTML = `<button id="btn-add-wikichart" class="icon-btn" aria-label="New WikiChart" title="New WikiChart"><i data-lucide="plus"></i></button>`;
    topbar.prepend(actionsWrap);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [actionsWrap] });
    actionsWrap.querySelector('#btn-add-wikichart').addEventListener('click', () => {
      _renderCreateEdit(null);
    });
  }

  // Search/filter state
  let searchText = '';
  let activeTag = '';

  function _render() {
    let charts = [..._wikiCharts].sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    if (searchText) {
      const q = searchText.toLowerCase();
      charts = charts.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.key || '').toLowerCase().includes(q) ||
        (c.structureTag || '').toLowerCase().includes(q)
      );
    }
    if (activeTag) {
      charts = charts.filter(c => c.structureTag === activeTag);
    }

    let html = `
      <div class="wc-search-bar">
        <div class="search-input-wrap">
          <i data-lucide="search" class="search-icon"></i>
          <input type="text" id="wc-search" placeholder="Search charts…" value="${esc(searchText)}" autocomplete="off" maxlength="100" />
        </div>
      </div>
    `;

    // Structure tag filter chips
    const usedTags = [...new Set(_wikiCharts.map(c => c.structureTag).filter(Boolean))].sort();
    if (usedTags.length) {
      html += `<div class="wc-tag-bar">`;
      for (const tag of usedTags) {
        const isActive = tag === activeTag;
        html += `<button class="wc-tag-chip ${isActive ? 'active' : ''}" data-tag="${esc(tag)}">${esc(tag)}</button>`;
      }
      html += `</div>`;
    }

    if (charts.length === 0) {
      html += `<div class="empty-state"><p>${searchText || activeTag ? 'No matching charts.' : 'No WikiCharts yet.'}</p><p class="muted">${Auth.isLoggedIn() ? 'Tap + to create your first chord chart.' : 'Log in to create chord charts.'}</p></div>`;
    } else {
      html += `<div class="wc-list">`;
      for (const chart of charts) {
        const meta = [];
        if (chart.key) meta.push(chart.key);
        if (chart.bpm) meta.push(chart.bpm + ' BPM');
        if (chart.timeSig) meta.push(chart.timeSig);
        if (chart.feel) meta.push(chart.feel);
        const sectionCount = (chart.sections || []).length;
        html += `
          <div class="wc-list-row" data-id="${esc(chart.id)}">
            <div class="wc-list-info">
              <span class="wc-list-title">${esc(chart.title || 'Untitled')}</span>
              ${meta.length ? `<span class="wc-list-meta">${meta.map(m => esc(m)).join(' · ')}</span>` : ''}
              ${chart.structureTag ? `<span class="wc-list-tag">${esc(chart.structureTag)}</span>` : ''}
            </div>
            <span class="wc-list-sections">${sectionCount} section${sectionCount !== 1 ? 's' : ''}</span>
          </div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire search
    const searchInput = container.querySelector('#wc-search');
    searchInput?.addEventListener('input', () => {
      searchText = searchInput.value;
      _render();
    });

    // Wire tag chips
    container.querySelectorAll('.wc-tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTag = activeTag === btn.dataset.tag ? '' : btn.dataset.tag;
        _render();
      });
    });

    // Wire row clicks
    container.querySelectorAll('.wc-list-row').forEach(row => {
      row.addEventListener('click', () => {
        const chart = _wikiCharts.find(c => c.id === row.dataset.id);
        if (chart) renderWikiChartDetail(chart);
      });
    });
  }

  _render();
}

// ═══════════════════════════════════════════════════════════
// DETAIL VIEW
// ═══════════════════════════════════════════════════════════

function renderWikiChartDetail(chart, opts) {
  _syncFromStore();
  // Refresh chart reference from store
  const freshChart = _wikiCharts.find(c => c.id === chart.id);
  if (!freshChart) { showToast('Chart not found.'); renderWikiChartsList(); return; }
  chart = freshChart;

  _activeWikiChart = chart;
  Store.set('activeWikiChart', chart);
  _showView('wikichart-detail');
  _setTopbar(chart.title || 'WikiChart', true);
  _setRouteParams({ wikiChartId: chart.id });
  _pushNav(() => renderWikiChartsList());

  const container = document.getElementById('wikichart-detail-content');
  if (!container) return;

  // State — restore from module cache if same chart, else reset
  if (_detailState.chartId !== chart.id) {
    _detailState = { chartId: chart.id, transposeSemitones: 0, showNashville: false };
  }
  let transposeSemitones = _detailState.transposeSemitones;
  let showNashville = _detailState.showNashville;
  let fontSize = parseInt(localStorage.getItem('ct_pref_wc_fontsize') || '18', 10);

  // Inject topbar actions synchronously (matches setlists/practice pattern)
  document.getElementById('wikichart-detail-topbar-actions')?.remove();
  const topbar = document.querySelector('.topbar-right');
  if (topbar) {
    const actionsWrap = document.createElement('span');
    actionsWrap.id = 'wikichart-detail-topbar-actions';
    let btns = '';
    if (_canEdit(chart)) {
      btns += `<button id="wc-btn-edit" class="icon-btn" aria-label="Edit" title="Edit"><i data-lucide="pencil" style="width:16px;height:16px;"></i></button>`;
    }
    btns += `<span class="wc-export-wrap" style="position:relative;display:inline-block;">
      <button id="wc-btn-export" class="icon-btn" aria-label="Export" title="Export"><i data-lucide="download" style="width:16px;height:16px;"></i></button>
      <div id="wc-export-menu" class="wc-export-menu hidden">
        <button class="wc-export-opt" data-fmt="ascii">ASCII (grid)</button>
        <button class="wc-export-opt" data-fmt="chordpro">ChordPro</button>
        <button class="wc-export-opt" data-fmt="condensed">Condensed text</button>
      </div>
    </span>`;
    btns += `<button id="wc-btn-duplicate" class="icon-btn" aria-label="Duplicate" title="Duplicate"><i data-lucide="copy" style="width:16px;height:16px;"></i></button>`;
    if (_canEdit(chart) && chart.versions && chart.versions.length) {
      btns += `<button id="wc-btn-history" class="icon-btn" aria-label="History" title="Version history"><i data-lucide="history" style="width:16px;height:16px;"></i></button>`;
    }
    actionsWrap.innerHTML = btns;
    topbar.prepend(actionsWrap);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [actionsWrap] });

    actionsWrap.querySelector('#wc-btn-edit')?.addEventListener('click', () => _renderCreateEdit(chart));
    // Export menu toggle
    actionsWrap.querySelector('#wc-btn-export')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = actionsWrap.querySelector('#wc-export-menu');
      if (menu) menu.classList.toggle('hidden');
    });
    actionsWrap.querySelectorAll('.wc-export-opt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fmt = btn.dataset.fmt;
        actionsWrap.querySelector('#wc-export-menu')?.classList.add('hidden');
        _exportToClipboard(chart, transposeSemitones, fmt);
      });
    });
    // Close export menu on outside click
    document.addEventListener('click', () => {
      actionsWrap.querySelector('#wc-export-menu')?.classList.add('hidden');
    }, { once: false });
    actionsWrap.querySelector('#wc-btn-duplicate')?.addEventListener('click', () => _duplicateChart(chart));
    actionsWrap.querySelector('#wc-btn-history')?.addEventListener('click', () => _showVersionHistory(chart));
  }

  function _render() {
    const useFlats = FLAT_KEYS.has(chart.key || 'C');
    const displayKey = transposeSemitones !== 0 ? _transposeChord(chart.key, transposeSemitones, useFlats) : chart.key;
    let html = `<div class="wc-detail" style="--wc-font-size: ${fontSize}px">`;

    // Header
    html += `<div class="wc-header">`;
    html += `<h2 class="wc-title">${esc(chart.title || 'Untitled')}</h2>`;
    const meta = [];
    if (displayKey) meta.push('<span class="wc-key">Key: ' + esc(displayKey) + '</span>');
    if (chart.bpm) meta.push(esc(chart.bpm) + ' BPM');
    if (chart.timeSig) meta.push(esc(chart.timeSig));
    if (chart.feel) meta.push(esc(chart.feel));
    if (meta.length) html += `<div class="wc-meta">${meta.join(' · ')}</div>`;
    if (chart.structureTag) html += `<span class="wc-structure-tag">${esc(chart.structureTag)}</span>`;
    html += `</div>`;

    // Controls bar
    html += `<div class="wc-controls">`;
    html += `<div class="wc-transpose">
      <button class="btn-ghost wc-ctrl-btn" id="wc-transpose-down" title="Transpose down">-1</button>
      <span class="wc-transpose-label">${transposeSemitones === 0 ? 'Original' : (transposeSemitones > 0 ? '+' : '') + transposeSemitones}</span>
      <button class="btn-ghost wc-ctrl-btn" id="wc-transpose-up" title="Transpose up">+1</button>
    </div>`;
    html += `<button class="btn-ghost wc-ctrl-btn ${showNashville ? 'active' : ''}" id="wc-nashville" title="Nashville numbers">Nash.</button>`;
    html += `<div class="wc-font-ctrl">
      <label class="wc-ctrl-label">Font</label>
      <input type="range" id="wc-font-slider" min="14" max="32" value="${fontSize}" class="wc-slider" />
    </div>`;
    // Condensed view toggle (Feature 17)
    html += `<button class="btn-ghost wc-ctrl-btn ${_condensedView ? 'active' : ''}" id="wc-condensed" title="Condensed view">Compact</button>`;
    // Slash notation toggle (Feature 24)
    html += `<button class="btn-ghost wc-ctrl-btn ${_showSlashes ? 'active' : ''}" id="wc-slashes" title="Show beat slashes">Slashes</button>`;
    // Auto-scroll
    html += `<button class="btn-ghost wc-ctrl-btn" id="wc-autoscroll" title="Auto-scroll teleprompter">
      <i data-lucide="${_scrolling ? 'pause' : 'play'}" style="width:14px;height:14px;"></i>
    </button>`;
    // Metronome (Feature 21)
    html += `<button class="btn-ghost wc-ctrl-btn ${_metronomeActive ? 'active' : ''}" id="wc-metronome" title="Metronome">
      <span class="wc-metro-icon"><i data-lucide="timer" style="width:14px;height:14px;"></i></span>
      <span class="wc-metro-dot" id="wc-metro-dot"></span>
    </button>`;
    // Playback engine controls
    html += `<span class="wc-playback-group">`;
    html += `<button class="btn-ghost wc-ctrl-btn wc-playback-btn ${_playbackActive ? 'active' : ''}" id="wc-playback" title="${_playbackActive ? 'Stop playback' : 'Play chords'}">
      <i data-lucide="${_playbackActive ? 'stop-circle' : 'play-circle'}" style="width:14px;height:14px;"></i>
    </button>`;
    if (_playbackActive) {
      html += `<button class="btn-ghost wc-ctrl-btn wc-mute-metro ${_playbackMuteMetro ? 'active' : ''}" id="wc-mute-metro" title="${_playbackMuteMetro ? 'Unmute metronome' : 'Mute metronome'}">
        <i data-lucide="${_playbackMuteMetro ? 'volume-x' : 'volume-2'}" style="width:14px;height:14px;"></i>
      </button>`;
    }
    html += `</span>`;
    html += `</div>`;

    // Sections grid
    const _showSectionColors = (() => { try { return localStorage.getItem('ct_pref_wc_section_colors') !== '0'; } catch (_) { return true; } })();
    html += `<div class="wc-sections" id="wc-sections-container">`;
    const _allSections = chart.sections || [];
    for (let _si = 0; _si < _allSections.length; _si++) {
      const section = _allSections[_si];
      const displaySection = transposeSemitones !== 0 ? _transposeSection(section, transposeSemitones, useFlats) : section;
      const color = _showSectionColors ? (SECTION_COLORS[section.type] || 'var(--wc-verse)') : 'var(--border)';
      const hasEndings = section.endings && section.endings.length > 0;
      const hasRepeat = section.repeat > 1;
      const isLooping = _loopSectionIdx === _si;

      if (_condensedView) {
        // ─── Condensed: one-liner per section ───
        const bars = displaySection.bars || [];
        const chords = bars.map(b => {
          let ch = b.chord || '/';
          if (showNashville && chart.key) {
            const keyRoot = _parseChordRoot(chart.key)?.root || chart.key;
            ch = _chordToNashville(b.chord, keyRoot);
          }
          return ch;
        });
        const label = section.label || section.type;
        const repeat = hasRepeat ? `, x${section.repeat}` : '';
        html += `<div class="wc-section wc-section-condensed ${isLooping ? 'wc-section-looping' : ''}" data-section-idx="${_si}" style="border-left-color: ${color}">`;
        html += `<span class="wc-section-type wc-condensed-label" style="color: ${color}">${esc(label)}:</span> `;
        html += `<span class="wc-condensed-chords">${chords.map(c => esc(c)).join(' | ')}</span>`;
        html += `<span class="wc-condensed-meta">(${bars.length} bar${bars.length !== 1 ? 's' : ''}${repeat})</span>`;
        html += `</div>`;
      } else {
        // ─── Expanded: full grid (default) ───
        html += `<div class="wc-section ${hasEndings ? 'wc-section-with-endings' : ''} ${isLooping ? 'wc-section-looping' : ''}" data-section-idx="${_si}" style="border-left-color: ${color}">`;
        html += `<div class="wc-section-header">
          <span class="wc-section-type" style="color: ${color}">${esc(section.label || section.type)}</span>
          ${hasRepeat ? `<span class="wc-section-repeat">×${section.repeat}</span>` : ''}
          <button class="wc-loop-btn ${isLooping ? 'active' : ''}" data-si="${_si}" title="${isLooping ? 'Stop loop' : 'Loop this section'}" aria-label="${isLooping ? 'Stop loop' : 'Loop this section'}">
            <i data-lucide="repeat" style="width:13px;height:13px;"></i>
          </button>
        </div>`;

        // Repeat start sign (if section repeats)
        if (hasRepeat) {
          html += `<div class="wc-repeat-start" aria-hidden="true"><span class="wc-repeat-line-thick"></span><span class="wc-repeat-line-thin"></span><span class="wc-repeat-dots"><span></span><span></span></span></div>`;
        }

        // Ending brackets (rendered above the bars grid)
        if (hasEndings) {
          html += `<div class="wc-endings-container">`;
          const barCount = (displaySection.bars || []).length;
          for (const ending of section.endings) {
            const startPct = ((ending.barStart - 1) / barCount) * 100;
            const widthPct = ((ending.barEnd - ending.barStart + 1) / barCount) * 100;
            html += `<div class="wc-ending-bracket ending-${ending.number}" style="left:${startPct}%;width:${widthPct}%">
              <span class="wc-ending-label">${ending.number}.</span>
            </div>`;
          }
          html += `</div>`;
        }

        // Bars grid
        html += `<div class="wc-bars">`;
        for (let bi = 0; bi < (displaySection.bars || []).length; bi++) {
          const bar = displaySection.bars[bi];
          let chordDisplay = bar.chord || '';
          if (showNashville && chart.key) {
            const keyRoot = _parseChordRoot(chart.key)?.root || chart.key;
            chordDisplay = _chordToNashville(bar.chord, keyRoot);
          }
          // Slash notation (Feature 24)
          let slashHtml = '';
          if (_showSlashes) {
            const beats = bar.beats || 4;
            const slashes = beats > 1 ? ' <span class="wc-slashes">' + '/ '.repeat(beats - 1).trim() + '</span>' : '';
            slashHtml = slashes;
          }
          // Check for cues on this bar
          const cue = (section.cues || []).find(c => c.barIdx === bi);
          html += `<div class="wc-bar ${cue ? 'has-cue' : ''}" data-chord="${esc(bar.chord || '')}" title="Click for chord diagram">`;
          html += `<span class="wc-chord">${esc(chordDisplay)}${slashHtml}</span>`;
          if (cue) {
            html += `<span class="wc-cue" style="${cue.color ? 'background:' + cue.color : ''}">${esc(cue.text)}</span>`;
          }
          html += `</div>`;
        }
        html += `</div>`;

        // Repeat end sign
        if (hasRepeat) {
          html += `<div class="wc-repeat-end" aria-hidden="true"><span class="wc-repeat-dots"><span></span><span></span></span><span class="wc-repeat-line-thin"></span><span class="wc-repeat-line-thick"></span></div>`;
        }

        html += `</div>`;
      }
    }
    html += `</div>`;

    // Notes
    if (chart.notes) {
      html += `<div class="wc-notes"><strong>Notes:</strong> ${esc(chart.notes)}</div>`;
    }

    // Reference Links
    if (chart.referenceLinks && chart.referenceLinks.length) {
      html += `<div class="wc-ref-links">`;
      html += `<div class="wc-ref-links-toggle" id="wc-ref-toggle">
        <span>Reference Links (${chart.referenceLinks.length})</span>
        <i data-lucide="chevron-down" style="width:16px;height:16px;"></i>
      </div>`;
      html += `<div class="wc-ref-links-list">`;
      for (const link of chart.referenceLinks) {
        const iconName = link.type === 'youtube' ? 'play-circle' : link.type === 'spotify' ? 'music' : link.type === 'apple' ? 'smartphone' : 'link';
        html += `<div class="wc-ref-link-row">
          <span class="wc-ref-link-icon ${esc(link.type || 'other')}"><i data-lucide="${iconName}" style="width:16px;height:16px;"></i></span>
          <span class="wc-ref-link-label"><a href="${esc(link.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(link.label || link.url || 'Link')}</a></span>
          <span class="wc-ref-link-type">${esc(link.type || 'other')}</span>
        </div>`;
      }
      html += `</div></div>`;
    }

    // Delete button
    if (_canDelete(chart)) {
      html += `<div class="wc-danger-zone"><button class="btn-danger" id="wc-btn-delete">Delete Chart</button></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire controls
    container.querySelector('#wc-transpose-down')?.addEventListener('click', () => { transposeSemitones--; _detailState.transposeSemitones = transposeSemitones; _render(); });
    container.querySelector('#wc-transpose-up')?.addEventListener('click', () => { transposeSemitones++; _detailState.transposeSemitones = transposeSemitones; _render(); });
    container.querySelector('#wc-nashville')?.addEventListener('click', () => { showNashville = !showNashville; _detailState.showNashville = showNashville; _render(); });
    container.querySelector('#wc-condensed')?.addEventListener('click', () => {
      _condensedView = !_condensedView;
      try { localStorage.setItem('ct_pref_wc_condensed', String(_condensedView)); } catch (_) {}
      _render();
    });
    container.querySelector('#wc-slashes')?.addEventListener('click', () => {
      _showSlashes = !_showSlashes;
      try { localStorage.setItem('ct_pref_wc_slashes', String(_showSlashes)); } catch (_) {}
      _render();
    });
    container.querySelector('#wc-font-slider')?.addEventListener('input', (e) => {
      fontSize = parseInt(e.target.value, 10) || 18;
      const detail = container.querySelector('.wc-detail');
      if (detail) detail.style.setProperty('--wc-font-size', fontSize + 'px');
      try { localStorage.setItem('ct_pref_wc_fontsize', String(fontSize)); } catch (_) {}
    });
    container.querySelector('#wc-autoscroll')?.addEventListener('click', () => {
      _scrolling = !_scrolling;
      if (_scrolling) _startAutoScroll(chart);
      else _stopAutoScroll();
      _render();
    });
    container.querySelector('#wc-metronome')?.addEventListener('click', () => {
      if (_metronomeActive) _stopMetronome();
      else _startMetronome(chart);
      _render();
    });
    container.querySelector('#wc-playback')?.addEventListener('click', () => {
      if (_playbackActive) { _stopPlayback(); _stopMetronome(); }
      else _startPlayback(chart, _render);
      _render();
    });
    container.querySelector('#wc-mute-metro')?.addEventListener('click', () => {
      _playbackMuteMetro = !_playbackMuteMetro;
      try { localStorage.setItem('ct_pref_wc_playback_mute_metro', String(_playbackMuteMetro)); } catch (_) {}
      // Restart playback to apply change
      if (_playbackActive) {
        _stopPlayback();
        _startPlayback(chart, _render);
      }
      _render();
    });
    // Wire loop buttons
    container.querySelectorAll('.wc-loop-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const si = parseInt(btn.dataset.si, 10);
        _toggleLoopSection(si, chart, _render);
      });
    });
    container.querySelector('#wc-btn-delete')?.addEventListener('click', () => _deleteChart(chart));

    // Wire reference links toggle
    container.querySelector('#wc-ref-toggle')?.addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('open');
    });

    // Wire chord diagram popups
    container.querySelectorAll('.wc-bar[data-chord]').forEach(barEl => {
      barEl.addEventListener('click', () => {
        const chord = barEl.dataset.chord;
        if (chord && chord !== '/' && chord !== '%' && chord !== 'N.C.') {
          _showChordDiagram(chord);
        }
      });
    });
  }

  _render();
}

// ─── Auto-scroll teleprompter ───────────────────────────────

function _startAutoScroll(chart) {
  _stopAutoScroll();
  _scrolling = true;
  // Re-read speed multiplier from settings
  try { _scrollSpeed = parseFloat(localStorage.getItem('ct_pref_wc_scroll_speed')) || 1; } catch (_) { _scrollSpeed = 1; }
  const bpm = parseInt(chart.bpm, 10) || 120;
  // Pixels per frame at 60fps, scaled by BPM
  const baseSpeed = (bpm / 120) * 1.5;

  // Start section highlighting observer
  _startSectionObserver();

  function step() {
    if (!_scrolling) return;
    const container = document.getElementById('wc-sections-container');
    if (container) {
      const parent = container.closest('.view');
      if (parent) parent.scrollTop += baseSpeed * _scrollSpeed;
    }
    _scrollRaf = requestAnimationFrame(step);
  }
  _scrollRaf = requestAnimationFrame(step);
}

function _stopAutoScroll() {
  _scrolling = false;
  if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = null; }
  _stopSectionObserver();
}

// ─── Section highlighting (IntersectionObserver) ─────────────

function _startSectionObserver() {
  _stopSectionObserver();
  const sectionsContainer = document.getElementById('wc-sections-container');
  if (!sectionsContainer) return;
  const viewEl = sectionsContainer.closest('.view');
  if (!viewEl) return;

  const ratios = new Map();

  _sectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      ratios.set(entry.target, entry.intersectionRatio);
    }
    // Find the section with highest visibility
    let best = null;
    let bestRatio = 0;
    for (const [el, ratio] of ratios) {
      if (ratio > bestRatio) { bestRatio = ratio; best = el; }
    }
    // Apply active class
    sectionsContainer.querySelectorAll('.wc-section, .wc-section-condensed').forEach(el => {
      el.classList.toggle('wc-section-active', el === best && bestRatio > 0);
    });
  }, {
    root: viewEl,
    threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
  });

  sectionsContainer.querySelectorAll('.wc-section, .wc-section-condensed').forEach(el => {
    _sectionObserver.observe(el);
  });
}

function _stopSectionObserver() {
  if (_sectionObserver) {
    _sectionObserver.disconnect();
    _sectionObserver = null;
  }
  // Remove all active highlights
  document.querySelectorAll('.wc-section-active').forEach(el => el.classList.remove('wc-section-active'));
}

// ─── Metronome (Web Audio API) ───────────────────────────────

function _getMetroVolume() {
  try { return (parseInt(localStorage.getItem('ct_pref_wc_metro_vol') || '50', 10)) / 100; } catch (_) { return 0.5; }
}

function _getMetroSound() {
  try { return localStorage.getItem('ct_pref_wc_metro_sound') || 'click'; } catch (_) { return 'click'; }
}

function _playClick(audioCtx, time, isAccent) {
  const vol = _getMetroVolume();
  const sound = _getMetroSound();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  // Different sounds
  if (sound === 'woodblock') {
    osc.frequency.value = isAccent ? 1200 : 900;
    osc.type = 'triangle';
  } else if (sound === 'hihat') {
    // White-noise-like via detuned square wave
    osc.frequency.value = isAccent ? 6000 : 5000;
    osc.type = 'square';
  } else {
    // Default click
    osc.frequency.value = isAccent ? 1200 : 1000;
    osc.type = 'sine';
  }

  const peakVol = vol * (isAccent ? 0.4 : 0.3);
  gain.gain.setValueAtTime(peakVol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.start(time);
  osc.stop(time + 0.05);
}

function _startMetronome(chart) {
  _stopMetronome();
  _metronomeActive = true;

  const bpm = parseInt(chart.bpm, 10) || 120;
  const timeSig = chart.timeSig || '4/4';
  const beatsPerMeasure = parseInt(timeSig.split('/')[0], 10) || 4;
  const interval = 60 / bpm; // seconds per beat

  // Create or resume AudioContext
  if (!_metronomeAudioCtx || _metronomeAudioCtx.state === 'closed') {
    _metronomeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_metronomeAudioCtx.state === 'suspended') {
    _metronomeAudioCtx.resume();
  }

  _metronomeBeatCount = 0;
  _metronomeNextTime = _metronomeAudioCtx.currentTime + 0.05; // slight initial delay

  // Scheduler: look-ahead 100ms, schedule 50ms ahead
  function scheduler() {
    while (_metronomeNextTime < _metronomeAudioCtx.currentTime + 0.1) {
      const isAccent = (_metronomeBeatCount % beatsPerMeasure) === 0;
      _playClick(_metronomeAudioCtx, _metronomeNextTime, isAccent);

      // Schedule visual beat flash
      const beatTime = _metronomeNextTime;
      const delay = (beatTime - _metronomeAudioCtx.currentTime) * 1000;
      setTimeout(() => {
        const dot = document.getElementById('wc-metro-dot');
        if (dot) {
          dot.classList.add('flash');
          setTimeout(() => dot.classList.remove('flash'), 80);
        }
      }, Math.max(0, delay));

      _metronomeBeatCount++;
      _metronomeNextTime += interval;
    }
  }

  _metronomeTimerId = setInterval(scheduler, 25);
  scheduler(); // kick off immediately
}

function _stopMetronome() {
  _metronomeActive = false;
  if (_metronomeTimerId) {
    clearInterval(_metronomeTimerId);
    _metronomeTimerId = null;
  }
  _metronomeBeatCount = 0;
  // Remove visual flash
  const dot = document.getElementById('wc-metro-dot');
  if (dot) dot.classList.remove('flash');
}

// ─── Piano Chord Playback Engine ────────────────────────────

// MIDI note to frequency
function _midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

// Root note name to MIDI number (octave 4 = middle C region)
const _ROOT_MIDI = { 'C': 60, 'C#': 61, 'Db': 61, 'D': 62, 'D#': 63, 'Eb': 63, 'E': 64, 'Fb': 64, 'F': 65, 'F#': 66, 'Gb': 66, 'G': 67, 'G#': 68, 'Ab': 68, 'A': 69, 'A#': 70, 'Bb': 70, 'B': 71, 'Cb': 71, 'E#': 65, 'B#': 60 };

// Chord quality to intervals (semitones from root)
const _CHORD_INTERVALS = {
  '':       [0,4,7],       // major
  'm':      [0,3,7],       // minor
  '7':      [0,4,7,10],    // dominant 7
  'maj7':   [0,4,7,11],    // major 7
  'm7':     [0,3,7,10],    // minor 7
  'dim':    [0,3,6],       // diminished
  'dim7':   [0,3,6,9],     // diminished 7
  'aug':    [0,4,8],        // augmented
  'sus4':   [0,5,7],       // sus4
  'sus2':   [0,2,7],       // sus2
  '6':      [0,4,7,9],     // major 6
  'm6':     [0,3,7,9],     // minor 6
  '9':      [0,4,7,10,14], // dominant 9
  'add9':   [0,4,7,14],    // add9
  'm9':     [0,3,7,10,14], // minor 9
  'maj9':   [0,4,7,11,14], // major 9
  '7b5':    [0,4,6,10],    // dominant 7 flat 5
  'm7b5':   [0,3,6,10],    // half-diminished
  'aug7':   [0,4,8,10],    // augmented 7
  '7#9':    [0,4,7,10,15], // dominant 7 sharp 9
  '7b9':    [0,4,7,10,13], // dominant 7 flat 9
  '11':     [0,4,7,10,14,17], // dominant 11
  '13':     [0,4,7,10,14,21], // dominant 13
  'sus':    [0,5,7],       // alias for sus4
  'min':    [0,3,7],       // alias for m
  'min7':   [0,3,7,10],    // alias for m7
};

/**
 * Parse a chord symbol into root MIDI + intervals.
 * Returns { rootMidi, intervals } or null.
 */
function _chordToMidi(chordSymbol) {
  if (!chordSymbol || chordSymbol === '/' || chordSymbol === '%' || chordSymbol === 'N.C.') return null;
  // Handle slash chords — use the main chord, ignore bass note for voicing
  const slashIdx = chordSymbol.indexOf('/');
  const mainChord = slashIdx > 0 ? chordSymbol.slice(0, slashIdx) : chordSymbol;
  const parsed = _parseChordRoot(mainChord);
  if (!parsed) return null;
  const rootMidi = _ROOT_MIDI[parsed.root];
  if (rootMidi === undefined) return null;

  // Match the quality suffix, trying longest match first
  let quality = '';
  let suffix = parsed.suffix;
  // Normalize: remove parentheses
  suffix = suffix.replace(/[()]/g, '');
  // Try exact match first, then progressively shorter
  const sortedKeys = Object.keys(_CHORD_INTERVALS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (key && suffix.startsWith(key)) { quality = key; break; }
  }
  // If suffix is not empty and no quality matched, use the full suffix as-is if available
  if (!quality && suffix && _CHORD_INTERVALS[suffix]) quality = suffix;

  const intervals = _CHORD_INTERVALS[quality] || _CHORD_INTERVALS[''];
  return { rootMidi, intervals };
}

/**
 * Build a voicing (array of MIDI notes) for a chord, applying voice leading
 * from the previous voicing to minimize movement.
 */
function _buildVoicing(chordSymbol, prevVoicing) {
  const parsed = _chordToMidi(chordSymbol);
  if (!parsed) return prevVoicing || [60, 64, 67]; // fallback to C major
  const { rootMidi, intervals } = parsed;

  // Build root-position voicing
  const rootPos = intervals.map(i => rootMidi + i);

  if (!prevVoicing || prevVoicing.length === 0) {
    // First chord — center around middle C area
    return rootPos;
  }

  // Voice leading: try all inversions and pick the one closest to prevVoicing
  const noteCount = rootPos.length;
  const prevCenter = prevVoicing.reduce((a, b) => a + b, 0) / prevVoicing.length;
  let bestVoicing = rootPos;
  let bestDist = Infinity;

  // Generate inversions by rotating and octave-shifting
  for (let inv = 0; inv < noteCount; inv++) {
    // Build this inversion
    const voicing = [];
    for (let j = 0; j < noteCount; j++) {
      let note = rootPos[(j + inv) % noteCount];
      // Shift up if needed to maintain ascending order
      while (voicing.length > 0 && note <= voicing[voicing.length - 1]) note += 12;
      voicing.push(note);
    }
    // Try in different octave positions
    for (let octShift = -1; octShift <= 1; octShift++) {
      const shifted = voicing.map(n => n + octShift * 12);
      const center = shifted.reduce((a, b) => a + b, 0) / shifted.length;
      const dist = Math.abs(center - prevCenter);
      // Prefer voicings in a comfortable range (48-84 = C3 to C6)
      const inRange = shifted.every(n => n >= 48 && n <= 84);
      const penalty = inRange ? 0 : 24;
      if (dist + penalty < bestDist) {
        bestDist = dist + penalty;
        bestVoicing = shifted;
      }
    }
  }
  return bestVoicing;
}

/**
 * Play a piano-like chord using Web Audio API.
 * Uses layered oscillators with ADSR envelope for a warm piano tone.
 */
function _playChord(audioCtx, voicing, time, duration, velocity = 0.5) {
  // Layer 2 slightly detuned oscillators per note for chorus richness
  const detuneCents = [0, 6]; // main + slightly sharp
  const attackTime = 0.01;
  const decayTime = 0.15;
  const sustainLevel = 0.35 * velocity;
  const releaseTime = Math.min(0.3, duration * 0.3);

  for (const midi of voicing) {
    const freq = _midiToFreq(midi);
    for (const detune of detuneCents) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();

      // Piano-like: triangle wave through low-pass filter
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;

      // Low-pass filter for warmth
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(freq * 4, 8000);
      filter.Q.value = 0.7;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);

      // ADSR envelope
      const peakGain = (velocity * 0.15) / (voicing.length * detuneCents.length);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(peakGain, time + attackTime);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(peakGain * sustainLevel, 0.0001),
        time + attackTime + decayTime
      );
      // Sustain until release
      const releaseStart = time + duration - releaseTime;
      if (releaseStart > time + attackTime + decayTime) {
        gain.gain.setValueAtTime(Math.max(peakGain * sustainLevel, 0.0001), releaseStart);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      osc.start(time);
      osc.stop(time + duration + 0.05);
    }
  }
}

/**
 * Resolve chart form into a flat sequence of bars, handling repeats + endings.
 * Returns { bars: [{chord, sectionIdx, barIdx}], sectionMap: [...] }
 */
function _resolveForm(chart, loopSectionIdx = -1) {
  const resolved = [];
  const sections = chart.sections || [];

  // If looping a specific section, only process that section
  const sectionsToProcess = loopSectionIdx >= 0 && sections[loopSectionIdx]
    ? [{ section: sections[loopSectionIdx], idx: loopSectionIdx }]
    : sections.map((s, i) => ({ section: s, idx: i }));

  for (const { section, idx } of sectionsToProcess) {
    const bars = section.bars || [];
    const repeatCount = Math.max(1, section.repeat || 1);
    const endings = section.endings || [];
    const ending1 = endings.find(e => e.number === 1);
    const ending2 = endings.find(e => e.number === 2);

    for (let rep = 0; rep < repeatCount; rep++) {
      const isLastRepeat = rep === repeatCount - 1;

      for (let bi = 0; bi < bars.length; bi++) {
        const barNum = bi + 1; // 1-based for ending comparison

        // Skip 1st ending bars on last repeat (use 2nd ending instead)
        if (isLastRepeat && ending1 && ending2 && barNum >= ending1.barStart && barNum <= ending1.barEnd) {
          continue;
        }
        // Skip 2nd ending bars on non-last repeats
        if (!isLastRepeat && ending2 && barNum >= ending2.barStart && barNum <= ending2.barEnd) {
          continue;
        }

        resolved.push({
          chord: bars[bi].chord,
          beats: bars[bi].beats || 4,
          sectionIdx: idx,
          barIdx: bi,
        });
      }
    }
  }

  return resolved;
}

/**
 * Start chord playback through the chart.
 */
function _startPlayback(chart, renderCallback) {
  _stopPlayback();
  _playbackActive = true;
  _playbackChart = chart;
  _playbackRenderCallback = renderCallback;

  const bpm = parseInt(chart.bpm, 10) || 120;
  const timeSig = chart.timeSig || '4/4';
  const beatsPerMeasure = parseInt(timeSig.split('/')[0], 10) || 4;
  const barDuration = (60 / bpm) * beatsPerMeasure; // seconds per bar

  // Resolve form
  _playbackBars = _resolveForm(chart, _loopSectionIdx);
  if (_playbackBars.length === 0) { _stopPlayback(); return; }

  _playbackBarIndex = 0;
  _playbackLastVoicing = null;

  // Create or resume AudioContext
  if (!_playbackAudioCtx || _playbackAudioCtx.state === 'closed') {
    _playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_playbackAudioCtx.state === 'suspended') {
    _playbackAudioCtx.resume();
  }

  // Also start metronome clicks if not muted
  if (!_playbackMuteMetro) {
    if (!_metronomeAudioCtx || _metronomeAudioCtx.state === 'closed') {
      _metronomeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_metronomeAudioCtx.state === 'suspended') {
      _metronomeAudioCtx.resume();
    }
  }

  _playbackNextTime = _playbackAudioCtx.currentTime + 0.05;
  let _metroBeatNext = _playbackNextTime;
  let _metroBeatCount = 0;
  const beatInterval = 60 / bpm;

  function scheduler() {
    if (!_playbackActive) return;

    // Schedule chord bars
    while (_playbackBarIndex < _playbackBars.length && _playbackNextTime < _playbackAudioCtx.currentTime + 0.2) {
      const bar = _playbackBars[_playbackBarIndex];

      // Build voicing with voice leading
      const voicing = _buildVoicing(bar.chord, _playbackLastVoicing);
      if (bar.chord && bar.chord !== '/' && bar.chord !== '%' && bar.chord !== 'N.C.') {
        _playChord(_playbackAudioCtx, voicing, _playbackNextTime, barDuration * 0.95);
        _playbackLastVoicing = voicing;
      }

      // Schedule visual playhead update
      const barTime = _playbackNextTime;
      const barIdx = bar.barIdx;
      const sectionIdx = bar.sectionIdx;
      const delay = (barTime - _playbackAudioCtx.currentTime) * 1000;
      setTimeout(() => {
        _updatePlayhead(sectionIdx, barIdx);
      }, Math.max(0, delay));

      _playbackBarIndex++;
      _playbackNextTime += barDuration;
    }

    // Schedule metronome clicks alongside playback
    if (!_playbackMuteMetro && _metronomeAudioCtx) {
      while (_metroBeatNext < _playbackAudioCtx.currentTime + 0.2) {
        if (_metroBeatNext >= _playbackAudioCtx.currentTime - 0.01) {
          const isAccent = (_metroBeatCount % beatsPerMeasure) === 0;
          _playClick(_metronomeAudioCtx, _metroBeatNext, isAccent);
        }
        _metroBeatCount++;
        _metroBeatNext += beatInterval;
      }
    }

    // Check if playback complete
    if (_playbackBarIndex >= _playbackBars.length) {
      if (_loopSectionIdx >= 0) {
        // Loop: reset bar index
        _playbackBarIndex = 0;
        _playbackBars = _resolveForm(chart, _loopSectionIdx);
      } else {
        // End of chart — schedule stop after last bar finishes
        const endTime = _playbackNextTime;
        const stopDelay = (endTime - _playbackAudioCtx.currentTime) * 1000;
        setTimeout(() => {
          _stopPlayback();
          if (_playbackRenderCallback) _playbackRenderCallback();
        }, Math.max(0, stopDelay));
        clearInterval(_playbackTimerId);
        _playbackTimerId = null;
        return;
      }
    }
  }

  _playbackTimerId = setInterval(scheduler, 25);
  scheduler();
}

function _stopPlayback() {
  _playbackActive = false;
  if (_playbackTimerId) {
    clearInterval(_playbackTimerId);
    _playbackTimerId = null;
  }
  _playbackBarIndex = 0;
  _playbackBars = [];
  _playbackLastVoicing = null;
  _clearPlayhead();
}

function _updatePlayhead(sectionIdx, barIdx) {
  _clearPlayhead();
  const container = document.getElementById('wc-sections-container');
  if (!container) return;
  const sections = container.querySelectorAll('.wc-section:not(.wc-section-condensed)');
  if (sections[sectionIdx]) {
    const bars = sections[sectionIdx].querySelectorAll('.wc-bar');
    if (bars[barIdx]) {
      bars[barIdx].classList.add('wc-bar-playing');
      // Scroll into view if needed
      bars[barIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function _clearPlayhead() {
  document.querySelectorAll('.wc-bar-playing').forEach(el => el.classList.remove('wc-bar-playing'));
}

function _toggleLoopSection(sectionIdx, chart, renderCallback) {
  if (_loopSectionIdx === sectionIdx) {
    // Exit loop
    _loopSectionIdx = -1;
    if (_playbackActive) {
      _stopPlayback();
    }
  } else {
    // Enter loop on this section
    _loopSectionIdx = sectionIdx;
    // Start (or restart) playback in loop mode
    _startPlayback(chart, renderCallback);
  }
  if (renderCallback) renderCallback();
}

// ─── Chord diagram popup ────────────────────────────────────

function _showChordDiagram(chord) {
  // Normalize chord name — look up with and without suffix variations
  const parsed = _parseChordRoot(chord);
  if (!parsed) return;
  const lookups = [chord, parsed.root + parsed.suffix, parsed.root];
  let diagram = null;
  for (const key of lookups) {
    if (CHORD_DIAGRAMS[key]) { diagram = CHORD_DIAGRAMS[key]; break; }
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let content;
  if (diagram) {
    content = `
      <div class="modal wc-chord-modal">
        <h3>${esc(chord)}</h3>
        <div class="wc-chord-diagram">${_renderChordSVG(chord, diagram)}</div>
        <button class="btn-secondary wc-chord-close">Close</button>
      </div>`;
  } else {
    content = `
      <div class="modal wc-chord-modal">
        <h3>${esc(chord)}</h3>
        <p class="muted">No diagram available for this chord.</p>
        <button class="btn-secondary wc-chord-close">Close</button>
      </div>`;
  }
  overlay.innerHTML = content;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  const closeBtn = overlay.querySelector('.wc-chord-close');
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // Focus management — move focus into modal
  requestAnimationFrame(() => closeBtn.focus());
}

function _renderChordSVG(name, diagram) {
  const { frets, baseFret } = diagram;
  const w = 120, h = 150;
  const startX = 20, startY = 30, stringSpacing = 16, fretSpacing = 24;
  let svg = `<svg viewBox="0 0 ${w} ${h}" class="wc-chord-svg" aria-label="${esc(name)} chord diagram">`;

  // Fret indicator
  if (baseFret > 1) {
    svg += `<text x="${startX - 8}" y="${startY + fretSpacing / 2 + 4}" font-size="10" fill="currentColor" text-anchor="end">${baseFret}fr</text>`;
  } else {
    svg += `<line x1="${startX}" y1="${startY}" x2="${startX + stringSpacing * 5}" y2="${startY}" stroke="currentColor" stroke-width="3"/>`;
  }

  // Fret lines
  for (let f = 0; f <= 4; f++) {
    const y = startY + f * fretSpacing;
    svg += `<line x1="${startX}" y1="${y}" x2="${startX + stringSpacing * 5}" y2="${y}" stroke="currentColor" stroke-width="1" opacity="0.3"/>`;
  }
  // String lines
  for (let s = 0; s < 6; s++) {
    const x = startX + s * stringSpacing;
    svg += `<line x1="${x}" y1="${startY}" x2="${x}" y2="${startY + fretSpacing * 4}" stroke="currentColor" stroke-width="1" opacity="0.3"/>`;
  }

  // Dots
  for (let s = 0; s < 6; s++) {
    const fret = frets[s];
    const x = startX + s * stringSpacing;
    if (fret === -1) {
      svg += `<text x="${x}" y="${startY - 8}" font-size="12" fill="currentColor" text-anchor="middle">×</text>`;
    } else if (fret === 0) {
      svg += `<circle cx="${x}" cy="${startY - 8}" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
    } else {
      const adjustedFret = baseFret > 1 ? fret - baseFret + 1 : fret;
      const y = startY + (adjustedFret - 0.5) * fretSpacing;
      svg += `<circle cx="${x}" cy="${y}" r="6" fill="currentColor"/>`;
    }
  }

  svg += `</svg>`;
  return svg;
}

// ─── Clipboard export ───────────────────────────────────────

async function _exportToClipboard(chart, transposeSemitones, fmt) {
  let exportChart = chart;
  if (transposeSemitones !== 0) {
    const useFlats = FLAT_KEYS.has(chart.key || 'C');
    exportChart = {
      ...chart,
      key: _transposeChord(chart.key, transposeSemitones, useFlats),
      sections: (chart.sections || []).map(s => _transposeSection(s, transposeSemitones, useFlats)),
    };
  }
  const formatLabels = { ascii: 'ASCII', chordpro: 'ChordPro', condensed: 'Condensed' };
  let text;
  if (fmt === 'chordpro') text = _exportChordPro(exportChart);
  else if (fmt === 'condensed') text = _exportCondensed(exportChart);
  else text = _exportAscii(exportChart);

  try {
    await navigator.clipboard.writeText(text);
    showToast(`${formatLabels[fmt] || 'Chart'} copied to clipboard.`);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(`${formatLabels[fmt] || 'Chart'} copied to clipboard.`);
  }
}

// Keep legacy alias for any external callers
async function _copyToClipboard(chart, transposeSemitones) {
  return _exportToClipboard(chart, transposeSemitones, 'ascii');
}

// ─── Duplicate ──────────────────────────────────────────────

function _duplicateChart(chart) {
  _syncFromStore();
  const clone = deepClone(chart);
  clone.id = _generateId();
  clone.title = (chart.title || 'Untitled') + ' (copy)';
  clone.versions = [];
  clone.createdAt = new Date().toISOString();
  clone.updatedAt = new Date().toISOString();
  const user = Auth.getUser();
  if (user) clone.createdBy = user.id;
  _wikiCharts.push(clone);
  _saveWikiCharts('Chart duplicated.');
  _renderCreateEdit(clone, { skipVersionSave: true });
}

// ─── Delete ─────────────────────────────────────────────────

function _deleteChart(chart) {
  Modal.confirm('Delete WikiChart', `Delete "${esc(chart.title || 'Untitled')}"? This cannot be undone.`, () => {
    _syncFromStore();
    const idx = _wikiCharts.findIndex(c => c.id === chart.id);
    if (idx >= 0) {
      _wikiCharts.splice(idx, 1);
      _saveWikiCharts('Chart deleted.');
      renderWikiChartsList();
    }
  });
}

// ─── Version history ────────────────────────────────────────

function _showVersionHistory(chart) {
  if (!chart.versions || !chart.versions.length) { showToast('No version history.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let html = `<div class="modal wc-history-modal">
    <h2>Version History</h2>
    <div class="wc-version-list">`;

  chart.versions.forEach((ver, i) => {
    const date = ver._savedAt ? new Date(ver._savedAt).toLocaleString() : 'Unknown date';
    const sectionCount = (ver.sections || []).length;
    html += `<div class="wc-version-row" data-idx="${i}">
      <div class="wc-version-info">
        <span class="wc-version-date">${esc(date)}</span>
        <span class="wc-version-meta">${sectionCount} sections · Key: ${esc(ver.key || '?')}</span>
      </div>
      <button class="btn-ghost wc-version-restore" data-idx="${i}">Restore</button>
    </div>`;
  });

  html += `</div>
    <div class="modal-actions">
      <button class="btn-secondary" id="wc-history-close">Close</button>
    </div>
  </div>`;

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.querySelector('#wc-history-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelectorAll('.wc-version-restore').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const ver = chart.versions[idx];
      if (!ver) return;
      Modal.confirm('Restore Version', 'Restore this version? Current chart will be saved to history first.', () => {
        _saveVersion(chart);
        // Restore fields from version
        chart.title = ver.title;
        chart.key = ver.key;
        chart.bpm = ver.bpm;
        chart.timeSig = ver.timeSig;
        chart.feel = ver.feel;
        chart.sections = deepClone(ver.sections || []);
        chart.structureTag = ver.structureTag;
        chart.notes = ver.notes;
        chart.updatedAt = new Date().toISOString();
        chart._ts = Date.now();
        _saveWikiCharts('Version restored.');
        close();
        renderWikiChartDetail(chart);
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════
// CREATE / EDIT VIEW
// ═══════════════════════════════════════════════════════════

function _renderCreateEdit(chart, opts) {
  _syncFromStore();
  const isNew = !chart;
  const user = Auth.getUser();

  if (isNew) {
    chart = {
      id: _generateId(),
      title: '',
      key: '',
      bpm: '',
      timeSig: '4/4',
      feel: '',
      sections: [],
      structureTag: '',
      notes: '',
      referenceLinks: [],
      versions: [],
      createdBy: user ? user.id : 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Save version before editing (for existing charts, skip for fresh duplicates)
  if (!isNew && !opts?.skipVersionSave) _saveVersion(chart);

  const editChart = deepClone(chart);

  _showView('wikichart-detail');
  _setTopbar(isNew ? 'New WikiChart' : 'Edit WikiChart', true);
  _pushNav(() => {
    if (isNew) renderWikiChartsList();
    else renderWikiChartDetail(chart);
  });

  const container = document.getElementById('wikichart-detail-content');
  if (!container) return;

  // Remove any topbar actions during edit
  document.getElementById('wikichart-detail-topbar-actions')?.remove();

  // Edit mode: grid mode vs text paste mode
  let editMode = 'grid';

  function _renderForm() {
    let html = `<div class="wc-edit-form">`;

    // Metadata
    html += `
      <div class="form-field">
        <label class="form-label" for="wce-title">Title</label>
        <input class="form-input" id="wce-title" type="text" value="${esc(editChart.title)}" placeholder="Song title" maxlength="200" />
      </div>
      <div class="wc-edit-row">
        <div class="form-field wc-field-sm">
          <label class="form-label" for="wce-key">Key</label>
          <input class="form-input" id="wce-key" type="text" value="${esc(editChart.key)}" placeholder="e.g. G" maxlength="10" />
        </div>
        <div class="form-field wc-field-sm">
          <label class="form-label" for="wce-bpm">BPM</label>
          <input class="form-input" id="wce-bpm" type="number" value="${editChart.bpm || ''}" placeholder="120" min="20" max="400" />
        </div>
        <div class="form-field wc-field-sm">
          <label class="form-label" for="wce-timesig">Time Sig</label>
          <select class="form-input wc-select" id="wce-timesig">
            ${['4/4','3/4','6/8','2/4','5/4','7/8'].map(ts => `<option value="${ts}" ${editChart.timeSig === ts ? 'selected' : ''}>${ts}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="wc-edit-row">
        <div class="form-field wc-field-md">
          <label class="form-label" for="wce-feel">Feel</label>
          <input class="form-input" id="wce-feel" type="text" value="${esc(editChart.feel || '')}" placeholder="e.g. Straight Rock, Swing" maxlength="50" />
        </div>
        <div class="form-field wc-field-md">
          <label class="form-label" for="wce-structure">Structure</label>
          <select class="form-input wc-select" id="wce-structure">
            <option value="">None</option>
            ${STRUCTURE_TAGS.map(tag => `<option value="${tag}" ${editChart.structureTag === tag ? 'selected' : ''}>${tag}</option>`).join('')}
          </select>
        </div>
      </div>
    `;

    // Mode toggle
    html += `<div class="wc-mode-toggle">
      <button class="btn-ghost wc-ctrl-btn ${editMode === 'grid' ? 'active' : ''}" id="wce-mode-grid">Grid Mode</button>
      <button class="btn-ghost wc-ctrl-btn ${editMode === 'text' ? 'active' : ''}" id="wce-mode-text">Paste Text</button>
    </div>`;

    if (editMode === 'text') {
      html += `
        <div class="form-field">
          <label class="form-label" for="wce-paste">Paste chords (from Ultimate Guitar, etc.)</label>
          <textarea class="form-input wc-paste-area" id="wce-paste" rows="12" placeholder="[Verse 1]\nG  C  G  D\nEm C  D  G\n\n[Chorus]\nC  G  D  Em"></textarea>
        </div>
        <button class="btn-secondary" id="wce-parse-btn">Parse & Import</button>`;
    } else {
      // Grid mode — section editor
      html += `<div class="wc-sections-edit" id="wce-sections">`;
      editChart.sections.forEach((section, si) => {
        html += _renderSectionEditor(section, si);
      });
      html += `</div>`;
      html += `<div class="wc-add-section-bar">
        <button class="btn-ghost" id="wce-add-section">+ Add Section</button>
        <button class="btn-ghost" id="wce-add-progression">Insert Progression</button>
      </div>`;

      // Chord autocomplete area
      if (editChart.key) {
        const diatonic = _getDiatonicChords(editChart.key);
        if (diatonic.length) {
          html += `<div class="wc-diatonic-hint">
            <span class="wc-ctrl-label">Diatonic chords in ${esc(editChart.key)}:</span>
            <div class="wc-diatonic-chips">${diatonic.map(c => `<span class="wc-diatonic-chip">${esc(c)}</span>`).join('')}</div>
          </div>`;
        }
      }
    }

    // Notes
    html += `
      <div class="form-field">
        <label class="form-label" for="wce-notes">Notes</label>
        <textarea class="form-input" id="wce-notes" rows="3" maxlength="2000" placeholder="Arrangement notes, performance instructions…">${esc(editChart.notes || '')}</textarea>
      </div>
    `;

    // Reference Links
    if (!editChart.referenceLinks) editChart.referenceLinks = [];
    html += `<div class="form-field">
      <label class="form-label">Reference Links</label>
      <div class="wc-ref-links-edit" id="wce-ref-links">`;
    editChart.referenceLinks.forEach((link, li) => {
      html += `<div class="wc-ref-link-edit">
        <input class="form-input wc-ref-link-label-input" data-li="${li}" type="text" value="${esc(link.label || '')}" placeholder="Label" maxlength="100" />
        <input class="form-input wc-ref-link-url-input" data-li="${li}" type="url" value="${esc(link.url || '')}" placeholder="https://..." maxlength="500" />
        <select class="form-input wc-select wc-ref-link-type-select" data-li="${li}">
          ${['spotify', 'apple', 'youtube', 'other'].map(t => `<option value="${t}" ${link.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <button class="icon-btn wc-ref-link-delete" data-li="${li}" title="Remove link"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
      </div>`;
    });
    html += `</div>`;
    if (editChart.referenceLinks.length < 5) {
      html += `<button class="btn-ghost" id="wce-add-ref-link" style="margin-top:4px">+ Add Link</button>`;
    }
    html += `</div>`;

    // Actions
    html += `<div class="wc-edit-actions">
      <button class="btn-secondary" id="wce-cancel">Cancel</button>
      <button class="btn-primary" id="wce-save">Save</button>
    </div>`;

    html += `</div>`;
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Sync form inputs back to model before any re-render
    function _syncFormToModel() {
      editChart.title = container.querySelector('#wce-title')?.value.trim() || editChart.title;
      editChart.key = container.querySelector('#wce-key')?.value.trim() || editChart.key;
      const bpmVal = parseInt(container.querySelector('#wce-bpm')?.value, 10);
      if (bpmVal > 0 && bpmVal <= 400) editChart.bpm = bpmVal;
      editChart.timeSig = container.querySelector('#wce-timesig')?.value || editChart.timeSig;
      editChart.feel = container.querySelector('#wce-feel')?.value.trim() ?? editChart.feel;
      editChart.structureTag = container.querySelector('#wce-structure')?.value ?? editChart.structureTag;
      editChart.notes = container.querySelector('#wce-notes')?.value.trim() ?? editChart.notes;
    }

    // Wire mode toggle
    container.querySelector('#wce-mode-grid')?.addEventListener('click', () => { _syncFormToModel(); editMode = 'grid'; _renderForm(); });
    container.querySelector('#wce-mode-text')?.addEventListener('click', () => { _syncFormToModel(); editMode = 'text'; _renderForm(); });

    // Wire text parse
    container.querySelector('#wce-parse-btn')?.addEventListener('click', () => {
      _syncFormToModel();
      const text = container.querySelector('#wce-paste')?.value || '';
      if (!text.trim()) { showToast('Paste some chord text first.'); return; }
      const parsed = _parseChordText(text);
      if (parsed.length === 0) { showToast('Could not parse any sections.'); return; }
      editChart.sections = [...editChart.sections, ...parsed];
      editMode = 'grid';
      _renderForm();
      showToast(`Imported ${parsed.length} section${parsed.length !== 1 ? 's' : ''}.`);
    });

    // Wire add section
    container.querySelector('#wce-add-section')?.addEventListener('click', () => {
      _syncFormToModel();
      editChart.sections.push({
        id: _generateSectionId(),
        type: 'VERSE',
        label: 'Verse ' + (editChart.sections.filter(s => s.type === 'VERSE').length + 1),
        repeat: 1,
        bars: [{ chord: '', beats: 4 }, { chord: '', beats: 4 }, { chord: '', beats: 4 }, { chord: '', beats: 4 }],
        cues: [],
      });
      _renderForm();
    });

    // Wire progression library
    container.querySelector('#wce-add-progression')?.addEventListener('click', () => { _syncFormToModel(); _showProgressionPicker(editChart, _renderForm); });

    // Wire section editors (wrap rerender to sync form first)
    _wireSectionEditors(container, editChart, () => { _syncFormToModel(); _renderForm(); });

    // Wire reference link editors
    container.querySelectorAll('.wc-ref-link-label-input').forEach(input => {
      input.addEventListener('input', () => {
        const li = parseInt(input.dataset.li, 10);
        if (editChart.referenceLinks[li]) editChart.referenceLinks[li].label = input.value;
      });
    });
    container.querySelectorAll('.wc-ref-link-url-input').forEach(input => {
      input.addEventListener('input', () => {
        const li = parseInt(input.dataset.li, 10);
        if (editChart.referenceLinks[li]) editChart.referenceLinks[li].url = input.value;
      });
    });
    container.querySelectorAll('.wc-ref-link-type-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const li = parseInt(sel.dataset.li, 10);
        if (editChart.referenceLinks[li]) editChart.referenceLinks[li].type = sel.value;
      });
    });
    container.querySelectorAll('.wc-ref-link-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const li = parseInt(btn.dataset.li, 10);
        editChart.referenceLinks.splice(li, 1);
        _syncFormToModel();
        _renderForm();
      });
    });
    container.querySelector('#wce-add-ref-link')?.addEventListener('click', () => {
      _syncFormToModel();
      if (!editChart.referenceLinks) editChart.referenceLinks = [];
      if (editChart.referenceLinks.length >= 5) { showToast('Maximum 5 links allowed.'); return; }
      editChart.referenceLinks.push({ label: '', url: '', type: 'other' });
      _renderForm();
    });

    // Wire save/cancel
    container.querySelector('#wce-cancel')?.addEventListener('click', () => {
      if (isNew) renderWikiChartsList();
      else renderWikiChartDetail(chart);
    });

    container.querySelector('#wce-save')?.addEventListener('click', () => {
      // Collect form data
      editChart.title = container.querySelector('#wce-title')?.value.trim() || '';
      editChart.key = container.querySelector('#wce-key')?.value.trim() || '';
      const bpmVal = parseInt(container.querySelector('#wce-bpm')?.value, 10);
      editChart.bpm = (bpmVal > 0 && bpmVal <= 400) ? bpmVal : '';
      editChart.timeSig = container.querySelector('#wce-timesig')?.value || '4/4';
      editChart.feel = container.querySelector('#wce-feel')?.value.trim() || '';
      editChart.structureTag = container.querySelector('#wce-structure')?.value || '';
      editChart.notes = container.querySelector('#wce-notes')?.value.trim() || '';

      if (!editChart.title) { showToast('Title is required.'); container.querySelector('#wce-title')?.focus(); return; }

      editChart.updatedAt = new Date().toISOString();
      editChart._ts = Date.now();

      // Upsert into store
      const existingIdx = _wikiCharts.findIndex(c => c.id === editChart.id);
      if (existingIdx >= 0) {
        _wikiCharts[existingIdx] = editChart;
      } else {
        _wikiCharts.push(editChart);
      }
      _saveWikiCharts(isNew ? 'Chart created.' : 'Chart saved.');
      renderWikiChartDetail(editChart);
    });
  }

  _renderForm();
}

function _renderSectionEditor(section, si) {
  const color = SECTION_COLORS[section.type] || 'var(--wc-verse)';
  let html = `<div class="wc-section-edit" data-section-idx="${si}" style="border-left-color: ${color}">`;

  html += `<div class="wc-section-edit-header">
    <select class="wc-select wc-section-type-select" data-si="${si}">
      ${SECTION_TYPES.map(t => `<option value="${t}" ${section.type === t ? 'selected' : ''}>${t}</option>`).join('')}
    </select>
    <input class="form-input wc-section-label-input" data-si="${si}" type="text" value="${esc(section.label || '')}" placeholder="Label" maxlength="50" />
    <div class="wc-section-repeat-ctrl">
      <label class="wc-ctrl-label">×</label>
      <input class="form-input wc-section-repeat-input" data-si="${si}" type="number" value="${section.repeat || 1}" min="1" max="16" style="width:50px" />
    </div>
    <button class="icon-btn wc-section-delete" data-si="${si}" title="Remove section" aria-label="Remove section"><i data-lucide="trash-2" style="width:14px;height:14px;color:var(--red)"></i></button>
  </div>`;

  // Bars
  html += `<div class="wc-bars-edit" data-si="${si}">`;
  (section.bars || []).forEach((bar, bi) => {
    html += `<div class="wc-bar-edit">
      <input class="form-input wc-chord-input" data-si="${si}" data-bi="${bi}" type="text" value="${esc(bar.chord || '')}" placeholder="chord" maxlength="20" />
    </div>`;
  });
  html += `</div>`;
  html += `<div class="wc-bar-actions">
    <button class="btn-ghost wc-add-bar" data-si="${si}">+ Bar</button>
    <button class="btn-ghost wc-remove-bar" data-si="${si}">- Bar</button>
    <button class="btn-ghost wc-add-cue" data-si="${si}">+ Cue</button>
  </div>`;

  // Cues
  if (section.cues && section.cues.length) {
    html += `<div class="wc-cues-edit">`;
    section.cues.forEach((cue, ci) => {
      html += `<div class="wc-cue-edit">
        <input class="form-input wc-cue-text" data-si="${si}" data-ci="${ci}" type="text" value="${esc(cue.text || '')}" placeholder="Cue text" maxlength="50" />
        <input class="form-input wc-cue-bar" data-si="${si}" data-ci="${ci}" type="number" value="${(cue.barIdx || 0) + 1}" min="1" max="${(section.bars || []).length}" style="width:50px" title="Bar #" />
        <input class="form-input wc-cue-color" data-si="${si}" data-ci="${ci}" type="color" value="${cue.color || '#e74c3c'}" style="width:36px;height:30px;padding:2px" />
        <button class="icon-btn wc-cue-delete" data-si="${si}" data-ci="${ci}" title="Remove cue"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
      </div>`;
    });
    html += `</div>`;
  }

  // Endings (1st / 2nd)
  const endings = section.endings || [];
  if (endings.length) {
    html += `<div class="wc-endings-edit">`;
    endings.forEach((ending, ei) => {
      const barMax = (section.bars || []).length;
      html += `<div class="wc-ending-edit">
        <span class="wc-ending-edit-label">${ending.number === 1 ? '1st' : '2nd'}:</span>
        <label class="wc-ctrl-label">from bar</label>
        <input class="form-input wc-ending-start" data-si="${si}" data-ei="${ei}" type="number" value="${ending.barStart || 1}" min="1" max="${barMax}" />
        <label class="wc-ctrl-label">to bar</label>
        <input class="form-input wc-ending-end" data-si="${si}" data-ei="${ei}" type="number" value="${ending.barEnd || barMax}" min="1" max="${barMax}" />
        <button class="icon-btn wc-ending-delete" data-si="${si}" data-ei="${ei}" title="Remove ending"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
      </div>`;
    });
    html += `</div>`;
  }
  if (endings.length < 2) {
    const nextNum = endings.length === 0 ? 1 : (endings.some(e => e.number === 1) ? 2 : 1);
    html += `<div class="wc-bar-actions" style="margin-top:4px">
      <button class="btn-ghost wc-add-ending" data-si="${si}" data-num="${nextNum}">+ ${nextNum === 1 ? '1st' : '2nd'} Ending</button>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function _wireSectionEditors(container, editChart, rerender) {
  // Section type change
  container.querySelectorAll('.wc-section-type-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const si = parseInt(sel.dataset.si, 10);
      if (editChart.sections[si]) editChart.sections[si].type = sel.value;
    });
  });

  // Section label change
  container.querySelectorAll('.wc-section-label-input').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      if (editChart.sections[si]) editChart.sections[si].label = input.value;
    });
  });

  // Section repeat change
  container.querySelectorAll('.wc-section-repeat-input').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const val = parseInt(input.value, 10);
      if (editChart.sections[si]) editChart.sections[si].repeat = (val > 0 && val <= 16) ? val : 1;
    });
  });

  // Chord input change
  container.querySelectorAll('.wc-chord-input').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const bi = parseInt(input.dataset.bi, 10);
      if (editChart.sections[si]?.bars?.[bi]) {
        editChart.sections[si].bars[bi].chord = input.value.trim();
      }
    });
    // Slash notation support: typing / fills a slash beat
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        // Move to next chord input
        const allInputs = [...container.querySelectorAll('.wc-chord-input')];
        const idx = allInputs.indexOf(input);
        if (idx >= 0 && idx < allInputs.length - 1) {
          e.preventDefault();
          allInputs[idx + 1].focus();
        }
      }
    });
  });

  // Delete section
  container.querySelectorAll('.wc-section-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      editChart.sections.splice(si, 1);
      rerender();
    });
  });

  // Add bar
  container.querySelectorAll('.wc-add-bar').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      if (editChart.sections[si]) {
        editChart.sections[si].bars.push({ chord: '', beats: 4 });
        rerender();
      }
    });
  });

  // Remove bar
  container.querySelectorAll('.wc-remove-bar').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      if (editChart.sections[si]?.bars?.length > 1) {
        editChart.sections[si].bars.pop();
        rerender();
      }
    });
  });

  // Add cue
  container.querySelectorAll('.wc-add-cue').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      if (editChart.sections[si]) {
        if (!editChart.sections[si].cues) editChart.sections[si].cues = [];
        editChart.sections[si].cues.push({ barIdx: 0, text: '', color: '#e74c3c' });
        rerender();
      }
    });
  });

  // Cue edits
  container.querySelectorAll('.wc-cue-text').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const ci = parseInt(input.dataset.ci, 10);
      if (editChart.sections[si]?.cues?.[ci]) editChart.sections[si].cues[ci].text = input.value;
    });
  });
  container.querySelectorAll('.wc-cue-bar').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const ci = parseInt(input.dataset.ci, 10);
      const val = parseInt(input.value, 10);
      if (editChart.sections[si]?.cues?.[ci]) editChart.sections[si].cues[ci].barIdx = (val > 0 ? val - 1 : 0);
    });
  });
  container.querySelectorAll('.wc-cue-color').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const ci = parseInt(input.dataset.ci, 10);
      if (editChart.sections[si]?.cues?.[ci]) editChart.sections[si].cues[ci].color = input.value;
    });
  });
  container.querySelectorAll('.wc-cue-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      const ci = parseInt(btn.dataset.ci, 10);
      if (editChart.sections[si]?.cues) {
        editChart.sections[si].cues.splice(ci, 1);
        rerender();
      }
    });
  });

  // Ending start bar
  container.querySelectorAll('.wc-ending-start').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const ei = parseInt(input.dataset.ei, 10);
      const val = parseInt(input.value, 10);
      if (editChart.sections[si]?.endings?.[ei] && val > 0) {
        editChart.sections[si].endings[ei].barStart = val;
      }
    });
  });

  // Ending end bar
  container.querySelectorAll('.wc-ending-end').forEach(input => {
    input.addEventListener('input', () => {
      const si = parseInt(input.dataset.si, 10);
      const ei = parseInt(input.dataset.ei, 10);
      const val = parseInt(input.value, 10);
      if (editChart.sections[si]?.endings?.[ei] && val > 0) {
        editChart.sections[si].endings[ei].barEnd = val;
      }
    });
  });

  // Delete ending
  container.querySelectorAll('.wc-ending-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      const ei = parseInt(btn.dataset.ei, 10);
      if (editChart.sections[si]?.endings) {
        editChart.sections[si].endings.splice(ei, 1);
        rerender();
      }
    });
  });

  // Add ending
  container.querySelectorAll('.wc-add-ending').forEach(btn => {
    btn.addEventListener('click', () => {
      const si = parseInt(btn.dataset.si, 10);
      const num = parseInt(btn.dataset.num, 10);
      if (editChart.sections[si]) {
        if (!editChart.sections[si].endings) editChart.sections[si].endings = [];
        if (editChart.sections[si].endings.length >= 2) return;
        const barCount = (editChart.sections[si].bars || []).length;
        editChart.sections[si].endings.push({
          number: num,
          barStart: Math.max(1, barCount - 1),
          barEnd: barCount,
        });
        // Sort so 1st always comes before 2nd
        editChart.sections[si].endings.sort((a, b) => a.number - b.number);
        rerender();
      }
    });
  });
}

// ─── Progression library picker ─────────────────────────────

function _showProgressionPicker(editChart, rerender) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let html = `<div class="modal wc-progression-modal">
    <h2>Insert Progression</h2>
    <div class="wc-progression-list">`;

  PROGRESSION_LIBRARY.forEach((prog, i) => {
    html += `<div class="wc-progression-row" data-idx="${i}">
      <div class="wc-progression-info">
        <span class="wc-progression-name">${esc(prog.name)}</span>
        <span class="wc-progression-genre">${esc(prog.genre)}</span>
      </div>
      <span class="wc-progression-chords">${prog.chords.join(' - ')}</span>
    </div>`;
  });

  html += `</div>
    <div class="modal-actions">
      <button class="btn-secondary" id="wc-prog-close">Cancel</button>
    </div>
  </div>`;

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.querySelector('#wc-prog-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelectorAll('.wc-progression-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx, 10);
      const prog = PROGRESSION_LIBRARY[idx];
      if (!prog) return;

      // Convert roman numerals to actual chords based on key
      const key = editChart.key || 'C';
      const bars = _romanToChords(prog.chords, key);

      editChart.sections.push({
        id: _generateSectionId(),
        type: 'VERSE',
        label: prog.name,
        repeat: 1,
        bars: bars.map(chord => ({ chord, beats: 4 })),
        cues: [],
      });

      close();
      rerender();
      showToast(`Added: ${prog.name}`);
    });
  });
}

function _romanToChords(romanNumerals, key) {
  const parsed = _parseChordRoot(key);
  if (!parsed) return romanNumerals;
  const keyIdx = _rootToIndex(parsed.root);
  if (keyIdx < 0) return romanNumerals;
  const useFlats = FLAT_KEYS.has(key);

  const romanMap = {
    'I': 0, 'i': 0, 'II': 2, 'ii': 2, 'III': 4, 'iii': 4,
    'IV': 4 + 1, 'iv': 5, 'V': 7, 'v': 7, 'VI': 9, 'vi': 9,
    'VII': 11, 'vii': 11, 'bII': 1, 'bIII': 3, 'bVI': 8, 'bVII': 10,
    'biii': 3, 'bvi': 8, 'bvii': 10, '#IV': 6, '#iv': 6,
  };
  // Fix IV mapping (was 5, not 4+1):
  romanMap['IV'] = 5;

  return romanNumerals.map(roman => {
    // Strip suffixes like °, dim, etc
    const isMinor = roman === roman.toLowerCase() && !roman.startsWith('b');
    const baseRoman = roman.replace(/[°ø+]$/, '');
    const interval = romanMap[baseRoman];
    if (interval === undefined) return roman; // can't resolve
    const noteIdx = ((keyIdx + interval) % 12 + 12) % 12;
    const root = _indexToRoot(noteIdx, useFlats);
    return root + (isMinor ? 'm' : '') + (roman.endsWith('°') ? 'dim' : '');
  });
}

// ═══════════════════════════════════════════════════════════
// CHORD GRID RENDERER (for setlist detail + live mode)
// ═══════════════════════════════════════════════════════════

/**
 * Render a WikiChart as an HTML chord grid for embedding.
 * Used by setlist detail and live mode.
 * @param {Object} chart - WikiChart object
 * @param {Object} [opts] - { keyOverride, annotations, fontSize }
 * @returns {string} HTML string
 */
function renderChordGrid(chart, opts = {}) {
  if (!chart || !chart.sections) return '';
  const transposeSemitones = opts.keyOverride ? _getSemitonesForKeyChange(chart.key, opts.keyOverride) : 0;
  const useFlats = FLAT_KEYS.has(opts.keyOverride || chart.key || 'C');
  const fontSize = opts.fontSize || parseInt(localStorage.getItem('ct_pref_wc_fontsize') || '18', 10);

  let html = `<div class="wc-grid-embed" style="--wc-font-size: ${fontSize}px">`;
  // Header
  html += `<div class="wc-grid-header">
    <span class="wc-grid-title">${esc(chart.title || '')}</span>`;
  const displayKey = transposeSemitones !== 0 ? _transposeChord(chart.key, transposeSemitones, useFlats) : chart.key;
  const meta = [];
  if (displayKey) meta.push(displayKey);
  if (chart.bpm) meta.push(chart.bpm + ' BPM');
  if (chart.timeSig) meta.push(chart.timeSig);
  if (meta.length) html += `<span class="wc-grid-meta">${meta.map(m => esc(m)).join(' · ')}</span>`;
  html += `</div>`;

  for (const section of chart.sections) {
    const displaySection = transposeSemitones !== 0 ? _transposeSection(section, transposeSemitones, useFlats) : section;
    const color = SECTION_COLORS[section.type] || 'var(--wc-verse)';
    html += `<div class="wc-grid-section" style="border-left-color: ${color}">`;
    html += `<span class="wc-grid-section-label" style="color: ${color}">${esc(section.label || section.type)}${section.repeat > 1 ? ' ×' + section.repeat : ''}</span>`;
    html += `<div class="wc-grid-bars">`;
    for (const bar of (displaySection.bars || [])) {
      html += `<span class="wc-grid-bar">${esc(bar.chord || '/')}</span>`;
    }
    html += `</div></div>`;
  }

  // Annotations
  if (opts.annotations && opts.annotations.length) {
    html += `<div class="wc-grid-annotations">`;
    for (const ann of opts.annotations) {
      html += `<div class="wc-grid-annotation">${esc(ann.text || '')}</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function _getSemitonesForKeyChange(fromKey, toKey) {
  if (!fromKey || !toKey) return 0;
  const fromParsed = _parseChordRoot(fromKey);
  const toParsed = _parseChordRoot(toKey);
  if (!fromParsed || !toParsed) return 0;
  const fromIdx = _rootToIndex(fromParsed.root);
  const toIdx = _rootToIndex(toParsed.root);
  if (fromIdx < 0 || toIdx < 0) return 0;
  return ((toIdx - fromIdx) % 12 + 12) % 12;
}

// ═══════════════════════════════════════════════════════════
// ROUTER REGISTRATION
// ═══════════════════════════════════════════════════════════

Router.register('wikicharts', (route) => {
  renderWikiChartsList(route);
});

Router.register('wikichart-detail', (route) => {
  _syncFromStore();
  if (route?.wikiChartId) {
    const chart = _wikiCharts.find(c => c.id === route.wikiChartId);
    if (chart) { renderWikiChartDetail(chart); return; }
  }
  renderWikiChartsList();
});

// ─── Cleanup hook (stop auto-scroll + metronome when navigating away) ───
Router.registerHook('cleanupWikiCharts', () => {
  _stopAutoScroll();
  _stopMetronome();
  _stopPlayback();
  _loopSectionIdx = -1;
});

// ─── Public API ─────────────────────────────────────────────

export { renderWikiChartsList, renderWikiChartDetail, renderChordGrid, loadWikiCharts };

async function loadWikiCharts() {
  return Sync.loadWikiChartsInstant();
}
