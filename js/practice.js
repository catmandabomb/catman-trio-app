/* ─── practice.js — Practice Lists module (flat, user-based) ────
 * Practice lists are a flat array: each list has a `createdBy` field
 * matching the logged-in user's ID. No persona nesting.
 *
 * Exports: renderPractice, renderPracticeListDetail,
 *   loadPracticeInstant, savePractice, migratePracticeData,
 *   enterPracticeMode, showPracticeListPicker, showBatchPracticeListPicker
 * ─────────────────────────────────────────────────────────────── */
import * as Store from './store.js?v=20.40';
import { esc, deepClone, showToast, haptic, parseTimeSig, isIOS, createDirtyTracker, trackFormInputs, requestWakeLock, releaseWakeLock } from './utils.js?v=20.40';
import * as Modal from './modal.js?v=20.40';
import * as Router from './router.js?v=20.40';
import * as Sync from './sync.js?v=20.40';
import * as Drive from '../drive.js?v=20.40';
import * as GitHub from '../github.js?v=20.40';
import * as Admin from '../admin.js?v=20.40';
import * as Auth from '../auth.js?v=20.40';
import * as Player from '../player.js?v=20.40';
import * as Metronome from '../metronome.js?v=20.40';
import * as PDFViewer from '../pdf-viewer.js?v=20.40';
import * as App from '../app.js?v=20.40';

// ─── Module state ─────────────────────────────────────────
let _practice              = [];
let _activePracticeList    = null;
let _editPracticeList      = null;
let _editPracticeListIsNew = false;
let _savingPractice        = false;
let _practiceList          = null;
let _bpmHoldTimer          = null;
let _practiceNoteTimer     = null;
let _practiceNoteFlush     = null;
const _accordionState      = new Map();

// ─── Tuning fork ─────────────────────────────────────────
let _tfCtx = null;   // AudioContext
let _tfOsc = null;   // OscillatorNode (active = sounding)
let _tfGain = null;  // GainNode

const _TF_PITCHES = [
  { freq: 440,    label: 'A440 (Standard)' },
  { freq: 329.63, label: 'E4 (Guitar)' },
  { freq: 442,    label: 'A442' },
  { freq: 445,    label: 'A445' },
  { freq: 435,    label: 'A435 (Verdi)' },
  { freq: 432,    label: 'A432' },
  { freq: 415,    label: 'A415 (Baroque)' },
];
let _tfPitchIdx = 0; // index into _TF_PITCHES, default A440

const _TUNING_FORK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v9a5 5 0 0 0 5 5 5 5 0 0 0 5-5V2"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>`;

async function _playTuningFork() {
  if (_tfOsc) { _stopTuningFork(); return; }

  if (!_tfCtx || _tfCtx.state === 'closed') _tfCtx = new (window.AudioContext || window.webkitAudioContext)();
  // Must await resume — browsers suspend AudioContext until user gesture
  if (_tfCtx.state === 'suspended') await _tfCtx.resume();

  const freq = _TF_PITCHES[_tfPitchIdx].freq;
  const now = _tfCtx.currentTime;
  _tfGain = _tfCtx.createGain();
  _tfGain.gain.setValueAtTime(0.4, now);
  _tfGain.gain.exponentialRampToValueAtTime(0.25, now + 0.5);
  _tfGain.gain.exponentialRampToValueAtTime(0.001, now + 8);

  _tfOsc = _tfCtx.createOscillator();
  _tfOsc.type = 'sine';
  _tfOsc.frequency.setValueAtTime(freq, now);
  _tfOsc.connect(_tfGain);
  _tfGain.connect(_tfCtx.destination);
  _tfOsc.start(now);
  _tfOsc.stop(now + 8);
  _tfOsc.onended = () => { _tfOsc = null; _tfGain = null; _updateTfBtn(false); };
  _updateTfBtn(true);
}

function _stopTuningFork() {
  if (_tfOsc) {
    try {
      const now = _tfCtx.currentTime;
      _tfGain.gain.cancelScheduledValues(now);
      _tfGain.gain.setValueAtTime(_tfGain.gain.value, now);
      _tfGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      _tfOsc.stop(now + 0.06);
    } catch (_) {
      try { _tfOsc.stop(); } catch (__) {}
      try { _tfGain.disconnect(); } catch (__) {} // guarantee silence on iOS
    }
    _tfOsc.onended = null; // prevent stale callback
    _tfOsc = null; _tfGain = null;
  }
  _updateTfBtn(false);
}

function _updateTfBtn(active) {
  const btn = document.getElementById('btn-tuning-fork');
  if (!btn) return;
  if (active) {
    btn.classList.remove('tf-active');
    void btn.offsetWidth;
    btn.title = `${_TF_PITCHES[_tfPitchIdx].label} — Playing`;
  } else {
    btn.title = `${_TF_PITCHES[_tfPitchIdx].label} Tuning Fork`;
  }
  btn.classList.toggle('tf-active', active);
}

function _updatePitchBtnLabel() {
  const pitchBtn = document.getElementById('btn-tuning-fork-pitch');
  if (!pitchBtn) return;
  const isDefault = _tfPitchIdx === 0;
  // Show short note label (e.g. "E4") only when non-default; chevron always visible
  const labelSpan = pitchBtn.querySelector('.tf-pitch-label');
  if (labelSpan) {
    const shortLabel = isDefault ? '' : _TF_PITCHES[_tfPitchIdx].label.split(' ')[0];
    labelSpan.textContent = shortLabel;
    labelSpan.style.display = isDefault ? 'none' : '';
  }
  pitchBtn.title = `Pitch: ${_TF_PITCHES[_tfPitchIdx].label}`;
}

function _togglePitchDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('tuning-fork-dropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  if (isOpen) { _closePitchDropdown(); return; }
  dd.innerHTML = _TF_PITCHES.map((p, i) =>
    `<button class="tuning-fork-dropdown-item${i === _tfPitchIdx ? ' active' : ''}" data-idx="${i}">${esc(p.label)}</button>`
  ).join('');
  dd.classList.add('open');
  document.addEventListener('click', _closePitchDropdown, { once: true, capture: true });
}

function _closePitchDropdown() {
  const dd = document.getElementById('tuning-fork-dropdown');
  if (dd) dd.classList.remove('open');
}

async function _selectPitch(e) {
  const item = e.target.closest('.tuning-fork-dropdown-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= _TF_PITCHES.length) return;
  const wasPlaying = !!_tfOsc;
  _tfPitchIdx = idx;
  _closePitchDropdown();
  _updatePitchBtnLabel();
  if (wasPlaying) {
    _stopTuningFork();
    await _playTuningFork();
  }
}

function _injectTuningForkBtn() {
  document.getElementById('tuning-fork-wrap')?.remove();
  // Read default pitch from user settings
  try {
    const saved = localStorage.getItem('ct_pref_tf_default_pitch');
    if (saved !== null) {
      const idx = parseInt(saved, 10);
      if (idx >= 0 && idx < _TF_PITCHES.length) _tfPitchIdx = idx;
    }
  } catch (_) {}
  const topbarRight = document.querySelector('.topbar-right');
  if (!topbarRight) return;

  const wrap = document.createElement('div');
  wrap.id = 'tuning-fork-wrap';
  wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;';

  const btn = document.createElement('button');
  btn.id = 'btn-tuning-fork';
  btn.className = 'icon-btn tuning-fork-btn';
  btn.title = `${_TF_PITCHES[_tfPitchIdx].label} Tuning Fork`;
  btn.setAttribute('aria-label', 'Tuning fork');
  btn.innerHTML = _TUNING_FORK_SVG;
  btn.addEventListener('click', _playTuningFork);

  const pitchBtn = document.createElement('button');
  pitchBtn.id = 'btn-tuning-fork-pitch';
  pitchBtn.className = 'icon-btn tuning-fork-pitch-btn';
  pitchBtn.title = 'Select pitch';
  pitchBtn.setAttribute('aria-label', 'Select tuning fork pitch');
  const isDefault = _tfPitchIdx === 0;
  const shortLabel = isDefault ? '' : _TF_PITCHES[_tfPitchIdx].label.split(' ')[0];
  // Use raw inline SVG for chevron — immune to lucide.createIcons() re-processing
  pitchBtn.innerHTML = `<span class="tf-pitch-label" style="${isDefault ? 'display:none' : ''}">${shortLabel}</span><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
  pitchBtn.addEventListener('click', _togglePitchDropdown);

  const dd = document.createElement('div');
  dd.id = 'tuning-fork-dropdown';
  dd.className = 'tuning-fork-dropdown';
  dd.addEventListener('click', _selectPitch);

  wrap.append(btn, pitchBtn, dd);
  topbarRight.prepend(wrap);
}

function _cleanupTuningFork() {
  _stopTuningFork();
  // Close the context entirely so a fresh one is created next time
  if (_tfCtx && _tfCtx.state !== 'closed') {
    _tfCtx.close().catch(() => {});
    _tfCtx = null;
  }
  document.getElementById('tuning-fork-wrap')?.remove();
}

// ─── Store sync helpers ───────────────────────────────────
function _syncFromStore() {
  _practice = Store.get('practice') || [];
}

function _syncToStore() {
  Store.set('practice', _practice);
}

// ─── Navigation helpers ───────────────────────────────────
function _showView(name)     { Store.set('skipViewTransition', true); Router.showView(name); }
function _setTopbar(t, back) { Router.setTopbar(t, back); }
function _pushNav(fn)        { Router.pushNav(fn); }
function _navigateBack()     { Router.navigateBack(); }
function _setRouteParams(p)  { Store.set('currentRouteParams', p); }

function _doSyncRefresh(afterCallback) {
  return Sync.doSyncRefresh(afterCallback).then(() => {
    _syncFromStore();
  });
}

function _injectTopbarActions(id, innerHtml, onReady) {
  // Inject synchronously so buttons are part of the View Transition "new" state.
  // Old double-rAF caused buttons to appear AFTER the crossfade, creating jitter.
  const topbarRight = document.querySelector('.topbar-right');
  if (!topbarRight) return;
  topbarRight.querySelector(`#${id}`)?.remove();
  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
  wrap.innerHTML = innerHtml;
  topbarRight.appendChild(wrap);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrap] });
  if (onReady) onReady(wrap);
}

// ─── Helpers ──────────────────────────────────────────────

/** Get the current user's ID, or null if not logged in */
function _userId() {
  if (!Auth.isLoggedIn()) return null;
  const u = Auth.getUser();
  return u ? u.id : null;
}

/** Filter practice lists to only those belonging to the current user */
function _myLists() {
  const uid = _userId();
  if (!uid) return [];
  return _practice.filter(pl => pl.createdBy === uid);
}

// ─── Practice data (delegated to Sync) ────────────────────

async function loadPracticeInstant() {
  await Sync.loadPracticeInstant();
  _syncFromStore();
}

function migratePracticeData() {
  _syncToStore();
  Sync.migratePracticeData();
  _syncFromStore();
}

async function savePractice(toastMsg) {
  _syncToStore();
  return Sync.savePractice(toastMsg);
}

// ─── Metronome helpers ────────────────────────────────────

function _metronomeHTML(bpm, timeSig) {
  if (!Metronome) return '';
  const b  = parseInt(bpm) || 120;
  const ts = parseTimeSig(timeSig);
  return `<div class="metronome-panel" id="metronome-panel">
    <button class="metronome-toggle" id="metronome-toggle" aria-label="Toggle metronome panel" aria-expanded="false">
      <i data-lucide="timer" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Metronome
      <i data-lucide="chevron-down" class="metronome-chevron" style="width:14px;height:14px;margin-left:auto;"></i>
    </button>
    <div class="metronome-body" id="metronome-body">
      <div class="metronome-bpm-row">
        <button class="metronome-bpm-btn" id="met-bpm-down" title="Decrease BPM">\u2212</button>
        <div class="metronome-bpm-display">
          <input type="number" id="met-bpm-input" class="metronome-bpm-input" min="20" max="300" value="${b}" />
          <span class="metronome-bpm-label">BPM</span>
        </div>
        <button class="metronome-bpm-btn" id="met-bpm-up" title="Increase BPM">+</button>
      </div>
      <div class="metronome-beats" id="met-beats">
        ${Array(ts.beats).fill(0).map((_, i) => '<div class="metronome-beat-dot' + (i === 0 ? ' accent-dot' : '') + '"></div>').join('')}
      </div>
      <div class="metronome-controls">
        <button class="metronome-ts-btn" id="met-ts" title="Time signature">${ts.display}</button>
        <button class="metronome-play-btn" id="met-play" title="Start/stop metronome" aria-label="Start metronome">
          <i data-lucide="play" style="width:20px;height:20px;"></i>
        </button>
        <button class="metronome-tap-btn" id="met-tap" title="Tap tempo">TAP</button>
      </div>
    </div>
  </div>`;
}

function _wireMetronome() {
  if (!Metronome) return;
  const panel = document.getElementById('metronome-panel');
  if (!panel) return;

  const toggle  = document.getElementById('metronome-toggle');
  const bpmInput = document.getElementById('met-bpm-input');
  const bpmDown = document.getElementById('met-bpm-down');
  const bpmUp   = document.getElementById('met-bpm-up');
  const playBtn = document.getElementById('met-play');
  const tapBtn  = document.getElementById('met-tap');
  const tsBtn   = document.getElementById('met-ts');
  const beatsEl = document.getElementById('met-beats');

  toggle.addEventListener('click', () => {
    panel.classList.toggle('expanded');
    toggle.setAttribute('aria-expanded', panel.classList.contains('expanded'));
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [panel] });
  });

  function adjustBpm(delta) {
    let val = parseInt(bpmInput.value) || 120;
    val = Math.max(20, Math.min(300, val + delta));
    bpmInput.value = val;
    if (Metronome.isPlaying()) Metronome.setBpm(val);
  }

  function startHold(delta) { adjustBpm(delta); _bpmHoldTimer = setInterval(() => adjustBpm(delta), 100); }
  function stopHold() { clearInterval(_bpmHoldTimer); _bpmHoldTimer = null; }

  bpmDown.addEventListener('pointerdown', (e) => { e.preventDefault(); startHold(-1); });
  bpmDown.addEventListener('pointerup', stopHold);
  bpmDown.addEventListener('pointerleave', stopHold);
  bpmUp.addEventListener('pointerdown', (e) => { e.preventDefault(); startHold(1); });
  bpmUp.addEventListener('pointerup', stopHold);
  bpmUp.addEventListener('pointerleave', stopHold);

  bpmInput.addEventListener('change', () => {
    let val = parseInt(bpmInput.value) || 120;
    val = Math.max(20, Math.min(300, val));
    bpmInput.value = val;
    if (Metronome.isPlaying()) Metronome.setBpm(val);
  });

  const BEATS_MAP = { '4/4': 4, '3/4': 3, '6/8': 6, '2/4': 2, '5/4': 5, '7/8': 7 };
  const TS_ORDER  = ['4/4', '3/4', '6/8', '2/4', '5/4', '7/8'];
  tsBtn.addEventListener('click', () => {
    const idx  = TS_ORDER.indexOf(tsBtn.textContent);
    const next = TS_ORDER[(idx + 1) % TS_ORDER.length];
    tsBtn.textContent = next;
    const beats = BEATS_MAP[next];
    beatsEl.innerHTML = Array(beats).fill(0).map((_, i) =>
      '<div class="metronome-beat-dot' + (i === 0 ? ' accent-dot' : '') + '"></div>'
    ).join('');
    if (Metronome.isPlaying()) Metronome.setTimeSignature(beats);
  });

  playBtn.addEventListener('click', () => {
    if (Metronome.isPlaying()) {
      Metronome.stop();
      playBtn.classList.remove('playing');
      playBtn.innerHTML = '<i data-lucide="play" style="width:20px;height:20px;"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [playBtn] });
      beatsEl.querySelectorAll('.metronome-beat-dot').forEach(d => d.classList.remove('active'));
    } else {
      const bpm   = parseInt(bpmInput.value) || 120;
      const beats = BEATS_MAP[tsBtn.textContent] || 4;
      playBtn.classList.add('playing');
      playBtn.innerHTML = '<i data-lucide="square" style="width:20px;height:20px;"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [playBtn] });
      Metronome.start(bpm, beats, (beat) => {
        const dots = beatsEl.querySelectorAll('.metronome-beat-dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === beat));
      });
    }
  });

  tapBtn.addEventListener('click', () => {
    const bpm = Metronome.tap();
    if (bpm !== null) {
      bpmInput.value = bpm;
      if (Metronome.isPlaying()) Metronome.setBpm(bpm);
    }
  });
}

// ─── Build embed HTML ─────────────────────────────────────

function _buildEmbedHTML(link) {
  const meta = {
    youtube:    { label: 'YouTube',     icon: '\u25B6', cls: 'youtube'    },
    spotify:    { label: 'Spotify',     icon: '\u266B', cls: 'spotify'    },
    applemusic: { label: 'Apple Music', icon: '\u266A', cls: 'applemusic' },
  };
  const m = meta[link.type] || { label: link.type, icon: '\uD83D\uDD17', cls: '' };

  let embedHTML = '';
  if (link.type === 'youtube' && link.embedId) {
    embedHTML = `<iframe src="https://www.youtube.com/embed/${esc(link.embedId)}" height="200"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen loading="lazy" style="display:block;width:100%;border:none;"></iframe>`;
  } else if (link.type === 'spotify' && link.embedId) {
    embedHTML = `<iframe src="https://open.spotify.com/embed/track/${esc(link.embedId)}?utm_source=generator&theme=0"
      height="80" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy" style="display:block;width:100%;border:none;"></iframe>`;
  } else if (link.type === 'applemusic' && link.embedId) {
    embedHTML = `<iframe src="https://embed.music.apple.com/us/album/${esc(link.embedId)}"
      height="150" allow="autoplay *; encrypted-media *; fullscreen *"
      sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
      loading="lazy" style="display:block;width:100%;border:none;"></iframe>`;
  }

  return `
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
      ${embedHTML ? `<div style="overflow:hidden;${embedHTML ? 'border-bottom:1px solid var(--border);' : ''}">${embedHTML}</div>` : ''}
      <div class="embed-external-row">
        <div class="embed-external-info">
          <div class="embed-platform-icon ${m.cls}">${m.icon}</div>
          <span class="embed-platform-name">${m.label}</span>
        </div>
        <a href="${esc(link.url)}" target="_blank" rel="noopener" class="embed-open-btn">Open \u2197</a>
      </div>
    </div>`;
}

// ─── PRACTICE — Main List View (flat, user-filtered) ──────

function renderPractice(skipNavReset) {
  if (!Auth.isLoggedIn()) {
    showToast('Log in to view practice lists');
    return;
  }
  _syncFromStore();
  _setRouteParams({});
  App.cleanupPlayers();
  if (!skipNavReset) {
    _pushNav(() => App.renderList());
  }
  _showView('practice');
  _setTopbar('Practice Lists', true);

  // Add "New List" to topbar right
  _injectTopbarActions('practice-topbar-actions',
    `<button class="btn-ghost topbar-nav-btn" id="btn-new-practice-list"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>New List</button>`,
    () => {
      document.getElementById('btn-new-practice-list')?.addEventListener('click', () => {
        const uid = _userId();
        if (!uid) { showToast('Log in to create practice lists'); return; }
        const newList = {
          id: Admin.generateId(_practice),
          name: '',
          songs: [],
          createdBy: uid,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        _practice.push(newList);
        _syncToStore();
        savePractice();
        _editPracticeList = deepClone(newList);
        _editPracticeListIsNew = true;
        _renderPracticeListEdit(newList, true);
      });
    });

  const container = document.getElementById('practice-list');
  const myLists = _myLists();
  const activeLists = myLists.filter(l => !l.archived);
  const archivedLists = myLists.filter(l => l.archived);

  let html = '';

  if (activeLists.length === 0) {
    html += `<div class="empty-state" style="padding:40px 20px">
      <p>No practice lists yet.</p>
      <p class="muted">Create one above to get started.</p>
    </div>`;
  } else {
    activeLists.forEach(pl => {
      const songCount = (pl.songs || []).length;
      html += `
        <div class="pl-card practice-list-card" data-practice-list-id="${esc(pl.id)}" tabindex="0" role="button" aria-label="${esc(pl.name || 'Untitled')}">
          <div class="pl-card-info" style="padding-left:4px">
            <div class="pl-card-title-row">
              <span class="pl-card-name">${esc(pl.name || 'Untitled')}</span>
            </div>
            <span class="pl-card-count">${songCount} song${songCount !== 1 ? 's' : ''}</span>
          </div>
        </div>`;
    });
  }

  // Archived section
  if (archivedLists.length > 0) {
    html += `<button class="btn-ghost practice-archive-toggle" id="btn-show-archived" style="width:100%;margin-top:16px;">
      <i data-lucide="archive" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Show Archived (${archivedLists.length})
    </button>`;
    html += `<div id="archived-practice-lists" class="hidden" style="margin-top:8px;">`;
    archivedLists.forEach(pl => {
      const songCount = (pl.songs || []).length;
      html += `
        <div class="pl-card practice-list-card practice-list-card-archived" data-practice-list-id="${esc(pl.id)}" tabindex="0" role="button" aria-label="${esc(pl.name || 'Untitled')}">
          <div class="pl-card-info" style="padding-left:4px">
            <div class="pl-card-title-row">
              <span class="pl-card-name" style="opacity:0.6">${esc(pl.name || 'Untitled')}</span>
            </div>
            <span class="pl-card-count">${songCount} song${songCount !== 1 ? 's' : ''} \u00B7 Archived</span>
          </div>
          <button class="practice-unarchive-btn" data-unarchive-id="${esc(pl.id)}" title="Unarchive" aria-label="Unarchive list"><i data-lucide="archive-restore"></i></button>
        </div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

  // "New List" button wired inside _injectTopbarActions callback above

  // Wire practice list card clicks
  container.querySelectorAll('.practice-list-card').forEach(card => {
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.practice-unarchive-btn')) return;
      const listId = card.dataset.practiceListId;
      const pl = _practice.find(l => l.id === listId);
      if (pl) renderPracticeListDetail(pl);
    });
  });

  // Wire unarchive buttons
  container.querySelectorAll('.practice-unarchive-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pl = _practice.find(l => l.id === btn.dataset.unarchiveId);
      if (pl) {
        pl.archived = false;
        await savePractice();
        renderPractice(true);
      }
    });
  });

  // Wire show archived toggle
  document.getElementById('btn-show-archived')?.addEventListener('click', () => {
    const section = document.getElementById('archived-practice-lists');
    const btn = document.getElementById('btn-show-archived');
    const isHidden = section.classList.contains('hidden');
    section.classList.toggle('hidden');
    btn.textContent = isHidden ? `Hide Archived (${archivedLists.length})` : `Show Archived (${archivedLists.length})`;
  });
}

// ─── PRACTICE — List Detail ───────────────────────────────

function renderPracticeListDetail(practiceList, skipNavPush) {
  _syncFromStore();
  App.cleanupPlayers();
  Player.stopAll();
  _activePracticeList = practiceList;
  Store.set('activePracticeList', practiceList);
  _setRouteParams({ practiceListId: practiceList.id });
  if (!skipNavPush) _pushNav(() => renderPractice());
  _showView('practice-edit');
  _setTopbar(practiceList.name || 'Practice List', true);

  // Topbar actions
  let plTopbarHtml = '';
  if (Admin.isEditMode()) {
    plTopbarHtml += `<button class="btn-ghost topbar-nav-btn btn-edit-practice-list"><i data-lucide="pencil" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Edit</button>`;
  }
  if (Admin.isEditMode() || _userId() === practiceList.createdBy) {
    plTopbarHtml += `<button class="btn-ghost topbar-nav-btn btn-delete-practice-list-top" style="color:#e87c6a;"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Delete</button>`;
  }
  _injectTopbarActions('practice-list-detail-topbar-actions', plTopbarHtml, (wrap) => {
    wrap.querySelector('.btn-edit-practice-list')?.addEventListener('click', () => {
      _renderPracticeListEdit(practiceList, false);
    });
    wrap.querySelector('.btn-delete-practice-list-top')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Practice List', `Permanently delete "${esc(practiceList.name || 'this practice list')}"?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        try {
          _practice = _practice.filter(l => l.id !== practiceList.id);
          await savePractice('Practice list deleted.');
          _activePracticeList = null;
          Store.set('activePracticeList', null);
          renderPractice(true);
        } catch (err) {
          console.error('Delete practice list failed', err);
          showToast('Delete failed.');
        } finally {
          _savingPractice = false;
        }
      });
    });
  });

  const container = document.getElementById('practice-edit-content');
  const songs = Store.get('songs') || [];
  const plSongs = practiceList.songs || [];

  let html = `<div class="detail-header">
    <div class="detail-title" style="margin-bottom:4px">${esc(practiceList.name)}</div>
    <div class="detail-subtitle">${plSongs.length} song${plSongs.length !== 1 ? 's' : ''}</div>
  </div>`;

  // Add song button
  html += `<button class="btn-ghost" id="btn-add-practice-song" style="width:100%;text-align:center;margin-bottom:16px;">
    <i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add Song
  </button>`;

  // Practice mode button
  if (plSongs.length > 0) {
    html += `<button class="btn-primary practice-enter-btn" id="btn-enter-practice-mode" style="width:100%;margin-bottom:20px;">
      <i data-lucide="play" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Enter Practice Mode
    </button>`;
  }

  if (plSongs.length === 0) {
    html += `<div class="empty-state" style="padding:40px 20px">
      <p>No songs yet.</p>
      <p class="muted">Add songs to this practice list.</p>
    </div>`;
  } else {
    html += `<div class="practice-song-list">`;
    plSongs.forEach((entry, i) => {
      const song = songs.find(s => s.id === entry.songId);
      if (song) {
        html += `
          <div class="setlist-song-row" data-song-id="${esc(song.id)}">
            <span class="setlist-song-num">${i + 1}</span>
            <div class="setlist-song-info">
              <span class="setlist-song-title">${esc(song.title)}</span>
              <span class="setlist-song-meta">
                ${song.key ? esc(song.key) : ''}${song.key && song.bpm ? ' \u00B7 ' : ''}${song.bpm ? esc(String(song.bpm)) + ' bpm' : ''}
              </span>
              ${entry.comment ? `<div class="practice-note-preview">${esc(entry.comment)}</div>` : ''}
            </div>
            <i data-lucide="chevron-right" class="file-item-arrow"></i>
          </div>`;
      }
    });
    html += `</div>`;
  }

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

  // Wire song clicks — tapping enters practice mode scrolled to that song
  container.querySelectorAll('.setlist-song-row').forEach(row => {
    row.addEventListener('click', () => {
      const song = songs.find(s => s.id === row.dataset.songId);
      if (song && plSongs.length > 0) {
        _enterPracticeMode(practiceList, song.id);
      } else if (song) {
        _pushNav(() => renderPracticeListDetail(practiceList));
        App.renderDetail(song, true);
      }
    });
  });

  // Edit + Delete buttons wired inside _injectTopbarActions callback above

  // Wire add song button
  document.getElementById('btn-add-practice-song')?.addEventListener('click', () => {
    _showPracticeSongPicker(practiceList);
  });

  // Wire practice mode
  document.getElementById('btn-enter-practice-mode')?.addEventListener('click', () => {
    _enterPracticeMode(practiceList);
  });

}

// ─── Song Picker (add songs to list) ──────────────────────

function _showPracticeSongPicker(practiceList) {
  const existing = document.getElementById('practice-picker-section');
  if (existing) {
    existing.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('practice-picker-search')?.focus();
    return;
  }
  const songs = Store.get('songs') || [];
  const container = document.getElementById('practice-edit-content');
  let pickerHtml = `<div class="edit-section" id="practice-picker-section">
    <div class="edit-section-title">Add Song</div>
    <div class="form-field">
      <input class="form-input" id="practice-picker-search" type="text" placeholder="Search songs\u2026" autocomplete="off" />
    </div>
    <div id="practice-picker-list" class="setlist-picker-list"></div>
    <button class="btn-secondary" id="practice-picker-close" style="margin-top:10px;width:100%">Close</button>
  </div>`;
  const div = document.createElement('div');
  div.innerHTML = pickerHtml;
  container.appendChild(div.firstElementChild);
  document.getElementById('practice-picker-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('practice-picker-search')?.focus(), 300);

  function renderPickerResults(search) {
    const existingIds = new Set((practiceList.songs || []).map(e => e.songId));
    const available = [...songs].filter(s => !existingIds.has(s.id)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    let filtered = available;
    if (search) {
      const q = search.toLowerCase();
      filtered = available.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.key || '').toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    const pickerList = document.getElementById('practice-picker-list');
    if (!filtered.length) {
      pickerList.innerHTML = `<div class="muted" style="font-size:13px;padding:8px 0">${search ? 'No matching songs.' : 'All songs added.'}</div>`;
      return;
    }
    pickerList.innerHTML = filtered.map(s => `
      <div class="setlist-picker-row" data-pick-id="${esc(s.id)}">
        <div class="setlist-picker-info">
          <span class="setlist-picker-title">${esc(s.title)}</span>
          <span class="setlist-picker-meta">${s.key ? esc(s.key) : ''}${s.key && s.bpm ? ' \u00B7 ' : ''}${s.bpm ? esc(String(s.bpm)) + ' bpm' : ''}</span>
        </div>
        <button class="btn-ghost sl-add-btn" data-pick-id="${esc(s.id)}">Add</button>
      </div>
    `).join('');
    pickerList.querySelectorAll('.sl-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        practiceList.songs = practiceList.songs || [];
        practiceList.songs.push({ songId: btn.dataset.pickId, comment: '', addedAt: new Date().toISOString() });
        const idx = _practice.findIndex(l => l.id === practiceList.id);
        if (idx > -1) _practice[idx] = practiceList;
        await savePractice();
        document.getElementById('practice-picker-section')?.remove();
        renderPracticeListDetail(practiceList, true);
      });
    });
  }

  renderPickerResults('');
  document.getElementById('practice-picker-search')?.addEventListener('input', (e) => {
    renderPickerResults(e.target.value.trim());
  });
  document.getElementById('practice-picker-close')?.addEventListener('click', () => {
    document.getElementById('practice-picker-section')?.remove();
  });
}

// ─── Practice List Edit ───────────────────────────────────

function _renderPracticeListEdit(practiceList, isNew) {
  App.cleanupPlayers();
  Player.stopAll();
  _editPracticeList = deepClone(practiceList);
  _editPracticeListIsNew = isNew;

  // New list: back goes to practice list; existing list: back goes to list detail
  _pushNav(isNew ? () => renderPractice(true) : () => renderPracticeListDetail(practiceList));
  _showView('practice-edit');
  _setTopbar(isNew ? 'New Practice List' : 'Edit Practice List', true);

  const container = document.getElementById('practice-edit-content');
  const pl = _editPracticeList;
  const songs = Store.get('songs') || [];
  if (!pl.songs) pl.songs = [];

  let html = `
    <div class="edit-section">
      <div class="edit-section-title">Practice List Info</div>
      <div class="form-field">
        <label class="form-label">Name</label>
        <input class="form-input" id="pl-name" type="text" value="${esc(pl.name)}" placeholder="e.g. Jazz Standards Set\u2026" maxlength="100" />
      </div>
    </div>

    <div class="edit-section">
      <div class="edit-section-title">Songs</div>
      <div id="pl-selected-songs" class="setlist-edit-selected"></div>
      <div class="setlist-empty-msg ${pl.songs.length ? 'hidden' : ''}" id="pl-empty-msg">No songs yet. Add songs from the list detail view.</div>
    </div>

    <div class="edit-form-actions">
      <button class="btn-primary" id="pl-save">Save</button>
      <button class="btn-secondary" id="pl-cancel">Cancel</button>
    </div>

    ${!isNew ? `<div class="delete-zone"><button class="btn-danger" id="pl-delete">Delete Practice List</button></div>` : ''}
  `;

  container.innerHTML = html;

  // Dirty tracking for unsaved changes confirmation
  const _practiceDirtyTracker = createDirtyTracker();
  trackFormInputs(container, _practiceDirtyTracker);

  let _sortablePL = null;
  function _renderPLSongs() {
    _practiceDirtyTracker.markDirty();
    const songContainer = document.getElementById('pl-selected-songs');
    document.getElementById('pl-empty-msg')?.classList.toggle('hidden', pl.songs.length > 0);

    songContainer.innerHTML = pl.songs.map((entry, i) => {
      const song = songs.find(s => s.id === entry.songId);
      const title = song ? esc(song.title) : '<em style="color:var(--text-3)">Song not found</em>';
      const key = song && song.key ? esc(song.key) : '';
      return `
        <div class="setlist-edit-row" data-idx="${i}">
          <div class="drag-handle"><i data-lucide="grip-vertical" style="width:16px;height:16px;"></i></div>
          <span class="setlist-song-num">${i + 1}</span>
          <div class="setlist-edit-row-info">
            <div class="setlist-edit-row-header">
              <span class="setlist-edit-row-title">${title}</span>
              ${key ? `<span class="setlist-edit-row-key">${key}</span>` : ''}
            </div>
            ${entry.comment ? `<div class="practice-note-preview" style="margin-top:4px">${esc(entry.comment)}</div>` : ''}
          </div>
          <div class="setlist-edit-row-actions">
            <button class="icon-btn sl-remove" data-idx="${i}" style="color:var(--red)" aria-label="Remove song"><i data-lucide="x"></i></button>
          </div>
        </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [songContainer] });

    if (_sortablePL) { try { _sortablePL.destroy(); } catch(_){} _sortablePL = null; }
    if (typeof Sortable !== 'undefined' && pl.songs.length > 1) {
      _sortablePL = Sortable.create(songContainer, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onStart: () => { haptic.light(); },
        onEnd: (evt) => {
          haptic.tap();
          const moved = pl.songs.splice(evt.oldIndex, 1)[0];
          pl.songs.splice(evt.newIndex, 0, moved);
          _renderPLSongs();
        }
      });
    }

    songContainer.querySelectorAll('.sl-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        pl.songs.splice(parseInt(btn.dataset.idx, 10), 1);
        _renderPLSongs();
      });
    });
  }

  _renderPLSongs();

  // Save
  document.getElementById('pl-save').addEventListener('click', async () => {
    if (_savingPractice) return;
    pl.name = document.getElementById('pl-name').value.trim();
    if (!pl.name) { showToast('Name is required.'); document.getElementById('pl-name').focus(); return; }
    _practiceDirtyTracker.reset();
    _savingPractice = true;
    try {
      pl.updatedAt = new Date().toISOString();
      const plIdx = _practice.findIndex(l => l.id === pl.id);
      if (plIdx > -1) {
        _practice[plIdx] = pl;
      }
      await savePractice();
      renderPracticeListDetail(pl, true);
    } catch (err) {
      console.error('Save practice list failed', err);
      showToast('Save failed.');
    } finally {
      _savingPractice = false;
    }
  });

  document.getElementById('pl-cancel').addEventListener('click', () => {
    _practiceDirtyTracker.confirmDiscard(() => _navigateBack());
  });

  document.getElementById('pl-delete')?.addEventListener('click', () => {
    if (_savingPractice) return;
    Admin.showConfirm('Delete Practice List', `Permanently delete "${esc(pl.name || 'this practice list')}"?`, async () => {
      if (_savingPractice) return;
      _savingPractice = true;
      try {
        _practice = _practice.filter(l => l.id !== pl.id);
        await savePractice();
        _activePracticeList = null;
        Store.set('activePracticeList', null);
        renderPractice(true);
      } catch (err) {
        console.error('Delete practice list failed', err);
        showToast('Delete failed.');
      } finally {
        _savingPractice = false;
      }
    });
  });
}

// ─── PRACTICE MODE ────────────────────────────────────────

function _enterPracticeMode(practiceList, scrollToSongId) {
  _practiceList = practiceList;
  App.cleanupPlayers();
  Player.stopAll();
  _pushNav(() => renderPracticeListDetail(practiceList));
  _showView('practice-detail');
  document.body.classList.add('practice-mode-active');
  requestWakeLock();
  _setTopbar('Practice Mode', true);

  const container = document.getElementById('practice-detail-content');
  const songs = Store.get('songs') || [];
  const plSongs = practiceList.songs || [];

  let html = `<div class="practice-mode-header">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
      <div>
        <div class="detail-title" style="font-size:22px;margin-bottom:0">${esc(practiceList.name)}</div>
        <div class="muted" style="font-size:12px">${plSongs.length} songs</div>
      </div>
    </div>
  </div>`;

  html += _metronomeHTML();

  html += `<div class="practice-accordion">`;
  plSongs.forEach((entry, i) => {
    const song = songs.find(s => s.id === entry.songId);
    if (!song) return;
    const a = song.assets || {};
    html += `
      <div class="practice-accordion-item" data-practice-idx="${i}">
        <div class="practice-accordion-header" data-toggle-idx="${i}" role="button" aria-expanded="false">
          <span class="setlist-song-num" style="font-size:12px;min-width:24px;height:24px;line-height:24px;">${i + 1}</span>
          <div style="flex:1;min-width:0">
            <span class="setlist-song-title">${esc(song.title)}</span>
            <span class="setlist-song-meta" style="display:block">${song.key ? esc(song.key) : ''}${song.key && song.bpm ? ' \u00B7 ' : ''}${song.bpm ? esc(String(song.bpm)) + ' bpm' : ''}</span>
          </div>
          <i data-lucide="chevron-down" class="accordion-chevron" style="width:16px;height:16px;flex-shrink:0;transition:transform 0.2s;"></i>
        </div>
        <div class="practice-accordion-body hidden">
          <textarea class="practice-note-input" data-practice-note-idx="${i}" rows="4" placeholder="Add practice notes\u2026">${esc(entry.comment || '')}</textarea>
          ${(a.charts || []).length ? `<div class="detail-section" style="margin-bottom:12px">
            <div class="detail-section-label">Charts</div>
            <div class="file-list">${(a.charts || []).map(c => `
              <div class="file-item-row"><button class="file-item" data-open-chart="${esc(c.r2FileId || c.driveId)}" data-name="${esc(c.name)}" data-song-bpm="${song.bpm || ''}" data-song-timesig="${song.timeSig || ''}" data-song-id="${esc(song.id)}">
                <div class="file-item-icon pdf"><i data-lucide="file-text"></i></div>
                <span class="file-item-name">${esc(c.name)}</span>
                <i data-lucide="chevron-right" class="file-item-arrow"></i>
              </button></div>`).join('')}
            </div>
          </div>` : ''}
          ${(a.audio || []).length ? `<div class="detail-section" style="margin-bottom:12px">
            <div class="detail-section-label">Audio</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${(a.audio || []).map(au => `<div data-audio-container="${esc(au.r2FileId || au.driveId)}" data-name="${esc(au.name)}" data-song-title="${esc(song.title || '')}"></div>`).join('')}
            </div>
          </div>` : ''}
          ${(a.links || []).length ? `<div class="detail-section" style="margin-bottom:12px">
            <div class="detail-section-label">Links</div>
            <div class="embed-list">${(a.links || []).map(l => _buildEmbedHTML(l)).join('')}</div>
          </div>` : ''}
        </div>
      </div>`;
  });
  html += `</div>`;

  // Jump-to-song sidebar
  if (plSongs.length > 1) {
    html += `<div class="practice-jump-bar" id="practice-jump-bar">`;
    plSongs.forEach((entry, i) => {
      const song = songs.find(s => s.id === entry.songId);
      if (!song) return;
      html += `<button class="practice-jump-dot" data-jump-idx="${i}" title="${esc(song.title)}">${i + 1}</button>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
  _wireMetronome();

  // Per-list accordion state
  const listKey = practiceList.id || practiceList.name || '';
  if (!_accordionState.has(listKey)) {
    _accordionState.set(listKey, { touched: false, openSet: new Set() });
  }
  const accState = _accordionState.get(listKey);

  // Prune stale songIds
  const validSongIds = new Set(plSongs.map(e => e.songId));
  for (const id of accState.openSet) {
    if (!validSongIds.has(id)) accState.openSet.delete(id);
  }

  // Wire jump-to-song sidebar
  container.querySelectorAll('.practice-jump-dot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      haptic.tap();
      const idx = parseInt(btn.dataset.jumpIdx, 10);
      const item = container.querySelector(`.practice-accordion-item[data-practice-idx="${idx}"]`);
      if (item) {
        const body = item.querySelector('.practice-accordion-body');
        const chevron = item.querySelector('.accordion-chevron');
        if (body && body.classList.contains('hidden')) {
          body.classList.remove('hidden');
          if (chevron) chevron.style.transform = 'rotate(180deg)';
          const entry = plSongs[idx];
          if (entry) { accState.openSet.add(entry.songId); accState.touched = true; }
        }
        requestAnimationFrame(() => {
          item.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        container.querySelectorAll('.practice-jump-dot').forEach(d => d.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // Restore accordion state
  if (accState.touched) {
    container.querySelectorAll('.practice-accordion-item').forEach(item => {
      const idx = parseInt(item.dataset.practiceIdx, 10);
      const entry = plSongs[idx];
      if (entry && accState.openSet.has(entry.songId)) {
        const body = item.querySelector('.practice-accordion-body');
        const chevron = item.querySelector('.accordion-chevron');
        const header = item.querySelector('.practice-accordion-header');
        if (body) body.classList.remove('hidden');
        if (header) header.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      }
    });
  }

  // Scroll to target song
  if (scrollToSongId) {
    const targetIdx = plSongs.findIndex(e => e.songId === scrollToSongId);
    if (targetIdx > -1) {
      const targetItem = container.querySelector(`.practice-accordion-item[data-practice-idx="${targetIdx}"]`);
      if (targetItem) {
        const body = targetItem.querySelector('.practice-accordion-body');
        if (body) {
          body.classList.remove('hidden');
          const targetHeader = targetItem.querySelector('.practice-accordion-header');
          if (targetHeader) targetHeader.setAttribute('aria-expanded', 'true');
          const chevron = targetItem.querySelector('.accordion-chevron');
          if (chevron) chevron.style.transform = 'rotate(180deg)';
          accState.openSet.add(scrollToSongId);
          accState.touched = true;
        }
        requestAnimationFrame(() => {
          targetItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  }

  // Pre-fetch chart PDFs
  plSongs.forEach(entry => {
    const song = songs.find(s => s.id === entry.songId);
    if (!song) return;
    (song.assets?.charts || []).forEach(c => {
      const fid = c.r2FileId || c.driveId;
      if (fid) App.getBlobUrl(fid).catch(() => {});
    });
  });

  // Load assets for accordion bodies
  function _loadAccordionAssets(body) {
    body.querySelectorAll('[data-audio-container]').forEach(async el => {
      if (el.dataset.loaded) return;
      const driveId = el.dataset.audioContainer;
      if (!driveId) return;
      el.dataset.loaded = 'true';
      el.innerHTML = `<div class="audio-player audio-skeleton">
        <div class="skeleton-text" style="width:40%;height:13px"></div>
        <div class="audio-controls"><div class="skeleton-circle"></div><div class="audio-progress-wrap"><div class="skeleton-bar"></div></div></div>
      </div>`;
      try {
        const url = (isIOS() && !Sync.useCloudflare()) ? Drive.getDirectUrl(driveId) : await App.getBlobUrl(driveId);
        if (!url) throw new Error('No audio URL');
        el.innerHTML = '';
        Player.create(el, { name: el.dataset.name || 'Audio', blobUrl: url, songTitle: el.dataset.songTitle || '', loopMode: true, songId: driveId, persistSpeed: true });
      } catch (err) { console.error('Practice audio load failed:', driveId, err); el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`; }
    });

    body.querySelectorAll('[data-open-chart]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = 'true';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const url = await App.getBlobUrl(btn.dataset.openChart);
          const pdfOpts = {};
          const songBpm = parseInt(btn.dataset.songBpm, 10);
          if (songBpm > 0) {
            pdfOpts.bpm = songBpm;
            const ts = btn.dataset.songTimesig;
            if (ts) { const n = parseInt(ts, 10); if (n > 0) pdfOpts.timeSig = n; }
          }
          // Pass song context for annotations
          if (btn.dataset.songId) {
            pdfOpts.songId = btn.dataset.songId;
            const song = Store.get('songs').find(s => s.id === btn.dataset.songId);
            if (song?.notes) pdfOpts.songNotes = song.notes;
          }
          PDFViewer.open(url, btn.dataset.name, pdfOpts);
        } catch (err) { console.error('Practice chart load failed:', btn.dataset.openChart, err); showToast('Failed to load chart.'); }
        finally { btn.disabled = false; }
      });
    });
  }

  // Pre-load all assets
  container.querySelectorAll('.practice-accordion-body').forEach(body => {
    _loadAccordionAssets(body);
  });

  // Wire accordion toggle
  // Single-expand mode: only one song open at a time (user/device pref)
  const _singleExpand = (() => { try { return localStorage.getItem('ct_pref_practice_single_expand') === '1'; } catch { return false; } })();

  container.querySelectorAll('.practice-accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      accState.touched = true;
      const item = header.closest('.practice-accordion-item');
      const idx = parseInt(item.dataset.practiceIdx, 10);
      const entry = plSongs[idx];
      const body = item.querySelector('.practice-accordion-body');
      const chevron = header.querySelector('.accordion-chevron');
      const isOpen = !body.classList.contains('hidden');

      // Single-expand: close all others first
      if (_singleExpand && !isOpen) {
        container.querySelectorAll('.practice-accordion-item').forEach(otherItem => {
          if (otherItem === item) return;
          const otherBody = otherItem.querySelector('.practice-accordion-body');
          const otherChevron = otherItem.querySelector('.accordion-chevron');
          const otherHeader = otherItem.querySelector('.practice-accordion-header');
          if (otherBody && !otherBody.classList.contains('hidden')) {
            otherBody.classList.add('hidden');
            if (otherChevron) otherChevron.style.transform = '';
            if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
            const otherIdx = parseInt(otherItem.dataset.practiceIdx, 10);
            const otherEntry = plSongs[otherIdx];
            if (otherEntry) accState.openSet.delete(otherEntry.songId);
          }
        });
      }

      body.classList.toggle('hidden');
      header.setAttribute('aria-expanded', String(!isOpen));
      if (chevron) {
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      }
      if (entry) {
        if (isOpen) accState.openSet.delete(entry.songId);
        else accState.openSet.add(entry.songId);
      }
      if (!isOpen) _loadAccordionAssets(body);
    });
  });

  // Wire practice notes — debounced auto-save
  _practiceNoteFlush = () => {
    const plIdx = _practice.findIndex(l => l.id === practiceList.id);
    if (plIdx > -1) _practice[plIdx] = practiceList;
    savePractice();
  };
  container.querySelectorAll('.practice-note-input').forEach(textarea => {
    textarea.addEventListener('click', (e) => e.stopPropagation());
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    });
    if (textarea.value.trim()) {
      requestAnimationFrame(() => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      });
    }
    textarea.addEventListener('input', () => {
      const idx = parseInt(textarea.dataset.practiceNoteIdx, 10);
      if (isNaN(idx) || !practiceList.songs[idx]) return;
      practiceList.songs[idx].comment = textarea.value.trim();
      clearTimeout(_practiceNoteTimer);
      _practiceNoteTimer = setTimeout(() => {
        _practiceNoteFlush();
        _practiceNoteTimer = null;
      }, 1500);
    });
  });

  // Inject tuning fork button into topbar-right
  _injectTuningForkBtn();
}

// ─── Practice list picker (from song detail) ──────────────

function _showPracticeListPicker(song) {
  _syncFromStore();
  const myLists = _myLists();
  if (!myLists.length) {
    showToast('No practice lists yet');
    return;
  }
  let rows = '';
  myLists.forEach((pl, i) => {
    const count = (pl.songs || []).length;
    rows += `<div class="setlist-pick-row" data-list-idx="${i}">
      <span class="setlist-pick-name">${esc(pl.name)}</span>
      <span class="setlist-pick-count">${count} song${count !== 1 ? 's' : ''}</span>
    </div>`;
  });

  const handle = Modal.create({
    id: 'practice-list-picker-overlay',
    cls: 'setlist-picker',
    content: `<h3>Add to Practice List</h3>${rows}<button class="setlist-picker-cancel">Cancel</button>`,
  });
  if (!handle) return;

  handle.overlay.querySelector('.setlist-picker-cancel').addEventListener('click', () => handle.hide());

  handle.overlay.querySelectorAll('.setlist-pick-row').forEach(row => {
    row.addEventListener('click', () => {
      const li = parseInt(row.dataset.listIdx, 10);
      const pl = myLists[li];
      if (!pl) return;

      const already = (pl.songs || []).some(e => e.songId === song.id);
      if (already) {
        showToast('Already in ' + pl.name);
        handle.hide();
        return;
      }

      if (!pl.songs) pl.songs = [];
      pl.songs.push({ songId: song.id, comment: '', addedAt: new Date().toISOString() });
      savePractice('Added to ' + pl.name);
      handle.hide();
    });
  });
}

function _showBatchPracticeListPicker(songIds) {
  _syncFromStore();
  const myLists = _myLists();
  if (!myLists.length) {
    showToast('No practice lists yet');
    return;
  }
  let rows = '';
  myLists.forEach((pl, i) => {
    const count = (pl.songs || []).length;
    rows += `<div class="setlist-pick-row" data-list-idx="${i}">
      <span class="setlist-pick-name">${esc(pl.name)}</span>
      <span class="setlist-pick-count">${count} song${count !== 1 ? 's' : ''}</span>
    </div>`;
  });
  const selCount = songIds.size || songIds.length;
  const handle = Modal.create({
    id: 'practice-list-picker-overlay',
    cls: 'setlist-picker',
    content: `<h3>Add ${selCount} song${selCount !== 1 ? 's' : ''} to Practice List</h3>${rows}<button class="setlist-picker-cancel">Cancel</button>`,
  });
  if (!handle) return;
  handle.overlay.querySelector('.setlist-picker-cancel').addEventListener('click', () => handle.hide());
  handle.overlay.querySelectorAll('.setlist-pick-row').forEach(row => {
    row.addEventListener('click', () => {
      const li = parseInt(row.dataset.listIdx, 10);
      const pl = myLists[li];
      if (!pl) return;
      if (!pl.songs) pl.songs = [];
      const existingIds = new Set(pl.songs.map(e => e.songId));
      let added = 0;
      songIds.forEach(songId => {
        if (!existingIds.has(songId)) {
          pl.songs.push({ songId, comment: '', addedAt: new Date().toISOString() });
          added++;
        }
      });
      if (added === 0) {
        showToast('All songs already in ' + pl.name);
      } else {
        savePractice('Added ' + added + ' song' + (added !== 1 ? 's' : '') + ' to ' + pl.name);
      }
      handle.hide();
    });
  });
}

/** Flush any pending debounced practice-note save immediately */
function _flushPendingNotesSave() {
  if (_practiceNoteTimer) {
    clearTimeout(_practiceNoteTimer);
    _practiceNoteTimer = null;
    if (_practiceNoteFlush) _practiceNoteFlush();
  }
}

function _exitPracticeMode() {
  _flushPendingNotesSave();
  _cleanupTuningFork();
  releaseWakeLock();
  document.body.classList.remove('practice-mode-active');
  document.getElementById('practice-jump-bar')?.remove();
  _practiceList = null;
  _navigateBack();
}

// ─── Route registrations ──────────────────────────────────

Router.register('practice', () => {
  renderPractice();
});

Router.register('practice-detail', (route) => {
  // Deep-link to a specific practice list by ID
  _syncFromStore();
  const pl = _practice.find(l => l.id === route.practiceListId);
  if (pl) {
    renderPracticeListDetail(pl);
  } else {
    // List not found (maybe not synced yet) — show practice list
    renderPractice();
  }
});

// ─── Cleanup hook ─────────────────────────────────────────
Router.registerHook('cleanupPractice', () => {
  if (_bpmHoldTimer) { clearInterval(_bpmHoldTimer); _bpmHoldTimer = null; }
  if (Metronome.isPlaying()) Metronome.stop();
  _cleanupTuningFork();
  releaseWakeLock();
});

// ─── Public API ───────────────────────────────────────────

export {
  renderPractice,
  renderPracticeListDetail,
  loadPracticeInstant,
  savePractice,
  migratePracticeData,
  _enterPracticeMode as enterPracticeMode,
  _showPracticeListPicker as showPracticeListPicker,
  _showBatchPracticeListPicker as showBatchPracticeListPicker,
  _syncFromStore as syncFromStore,
};
