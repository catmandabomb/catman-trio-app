/* ─── practice.js — Practice Lists module ─────────────────────
 * Extracted from app.js practice section.
 * IIFE exposing: renderPractice, renderPracticeDetail,
 *   renderPracticeListDetail, renderPracticeEdit,
 *   loadPracticeInstant, savePractice, migratePracticeData,
 *   enterPracticeMode
 * Dependencies (available at load): Store, Utils, Modal, Router,
 *   Sync, Drive, GitHub, Admin, Player, Metronome, PDFViewer
 * App.* is referenced at call-time only (safe).
 * ─────────────────────────────────────────────────────────────── */
const Practice = (() => {
  'use strict';

  // ─── Utility aliases ──────────────────────────────────────
  const esc            = Utils.esc;
  const deepClone      = Utils.deepClone;
  const showToast      = Utils.showToast;
  const haptic         = Utils.haptic;
  const hslFromName    = Utils.hslFromName;
  const safeColor      = Utils.safeColor;
  const personaInitials = Utils.personaInitials;
  const parseTimeSig   = Utils.parseTimeSig;
  const isIOS          = Utils.isIOS;

  // ─── Module state ─────────────────────────────────────────
  let _practice              = [];
  let _activePersona         = null;
  let _editPersona           = null;
  let _editPersonaIsNew      = false;
  let _activePracticeList    = null;
  let _editPracticeList      = null;
  let _editPracticeListIsNew = false;
  let _savingPractice        = false;
  let _practicePersona       = null;
  let _practiceList          = null;
  let _bpmHoldTimer          = null; // module-scope for cleanup on view exit
  let _practiceNoteTimer     = null; // module-scope so exit can flush pending saves
  let _practiceNoteFlush     = null; // callback to execute pending note save
  const _accordionState      = new Map(); // listKey → { touched: bool, openSet: Set<songId> }

  // ─── Store sync helpers ───────────────────────────────────
  function _syncFromStore() {
    _practice = Store.get('practice') || [];
  }

  function _syncToStore() {
    Store.set('practice', _practice);
  }

  // ─── Navigation helpers (delegate to Router / App) ────────
  function _showView(name)     { Router.showView(name); }
  function _setTopbar(t, back) { Router.setTopbar(t, back); }
  function _pushNav(fn)        { Router.pushNav(fn); }
  function _navigateBack()     { Router.navigateBack(); }
  function _setRouteParams(p)  { Store.set('currentRouteParams', p); }

  function _doSyncRefresh(afterCallback) {
    return Sync.doSyncRefresh(afterCallback).then(() => {
      _syncFromStore();
    });
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
    if (typeof Metronome === 'undefined') return '';
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
    if (typeof Metronome === 'undefined') return;
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

    // Collapse/expand
    toggle.addEventListener('click', () => {
      panel.classList.toggle('expanded');
      toggle.setAttribute('aria-expanded', panel.classList.contains('expanded'));
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [panel] });
    });

    // BPM adjustment with hold-to-repeat
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

    // Time signature cycling
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

    // Play/stop
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

    // Tap tempo
    tapBtn.addEventListener('click', () => {
      const bpm = Metronome.tap();
      if (bpm !== null) {
        bpmInput.value = bpm;
        if (Metronome.isPlaying()) Metronome.setBpm(bpm);
      }
    });
  }

  // ─── Build embed HTML (replicated from app.js) ────────────

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

  // ─── PRACTICE -- Persona List View ────────────────────────

  function renderPractice(skipNavReset) {
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) {
      if (typeof showToast !== 'undefined') showToast('Log in to view practice lists');
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

    const container = document.getElementById('practice-list');

    // Collect all practice lists across all personas (flattened)
    const allLists = [];
    _practice.forEach(p => {
      (p.practiceLists || []).filter(l => !l.archived).forEach(pl => {
        allLists.push({ ...pl, _personaId: p.id, _personaName: p.name });
      });
    });

    let html = `<div class="view-refresh-row">
      <button class="icon-btn view-refresh-btn" id="btn-refresh-practice" title="Sync from Drive" aria-label="Refresh">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>`;

    // "Create Practice List" button for authenticated users
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      html += `<button class="btn-ghost setlist-add-btn" id="btn-new-practice-list">+ Create Practice List</button>`;
    }

    if (allLists.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No practice lists yet.</p>
        <p class="muted">${(typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? 'Create one above to get started.' : 'Log in to create practice lists.'}</p>
      </div>`;
    } else {
      allLists.forEach(pl => {
        const songCount = (pl.songs || []).length;
        html += `
          <div class="persona-card practice-list-card" data-practice-list-id="${esc(pl.id)}" data-persona-id="${esc(pl._personaId)}">
            <div class="persona-card-info" style="padding-left:4px">
              <div class="persona-card-title-row">
                <span class="persona-card-name">${esc(pl.name || 'Untitled')}</span>
              </div>
              <span class="persona-card-count">${songCount} song${songCount !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
      });
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire refresh
    document.getElementById('btn-refresh-practice')?.addEventListener('click', () => {
      _doSyncRefresh(() => renderPractice(true));
    });

    // Wire "Create Practice List" — creates under first persona or new one
    document.getElementById('btn-new-practice-list')?.addEventListener('click', () => {
      // If no personas exist yet, create a default one
      if (_practice.length === 0) {
        const user = (typeof Auth !== 'undefined' && Auth.getUser()) || {};
        _practice.push({
          id: Admin.generateId(_practice),
          name: user.displayName || user.username || 'My Practice',
          color: '',
          practiceLists: [],
        });
        _syncToStore();
      }
      const persona = _practice[0];
      const newList = {
        id: Admin.generateId(persona.practiceLists || []),
        name: '',
        songs: [],
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!persona.practiceLists) persona.practiceLists = [];
      persona.practiceLists.push(newList);
      _syncToStore();
      savePractice();
      _editPracticeList = deepClone(newList);
      _editPracticeListIsNew = true;
      _activePersona = persona;
      _renderPracticeListEdit(persona, newList, true);
    });

    // Wire practice list card clicks
    container.querySelectorAll('.practice-list-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const personaId = card.dataset.personaId;
        const listId = card.dataset.practiceListId;
        const persona = _practice.find(x => x.id === personaId);
        if (!persona) return;
        const pl = (persona.practiceLists || []).find(l => l.id === listId);
        if (pl) {
          _activePersona = persona;
          renderPracticeListDetail(persona, pl);
        }
      });
    });

    container.querySelectorAll('.persona-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = _practice.find(x => x.id === btn.dataset.editPersona);
        if (p) renderPracticeEdit(p, false);
      });
    });

    container.querySelectorAll('.persona-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_savingPractice) return;
        const p = _practice.find(x => x.id === btn.dataset.deletePersona);
        if (!p) return;
        Admin.showConfirm('Delete Persona', `Permanently delete "${esc(p.name || 'this persona')}" and all their practice lists?`, async () => {
          if (_savingPractice) return;
          _savingPractice = true;
          if (GitHub.isConfigured()) GitHub.trackDeletion('practice', p.id);
          const backup = [..._practice];
          try {
            _practice = _practice.filter(x => x.id !== p.id);
            await savePractice('Persona deleted.');
            _activePersona = null;
            Store.set('activePersona', null);
            renderPractice(true);
          } catch (err) {
            console.error('Delete persona failed', err);
            _practice = backup;
            showToast('Delete failed.');
            renderPractice(true);
          } finally {
            _savingPractice = false;
          }
        });
      });
    });

    document.getElementById('btn-new-persona')?.addEventListener('click', () => {
      const newP = {
        id: Admin.generateId(_practice),
        name: '',
        color: '',
        practiceLists: [],
      };
      renderPracticeEdit(newP, true);
    });
  }

  // ─── PRACTICE -- Persona Practice Lists Selection ─────────

  function renderPracticeDetail(persona, skipNavPush) {
    _syncFromStore();
    _setRouteParams({ personaId: persona?.id });
    App.cleanupPlayers();
    Player.stopAll();
    _activePersona = persona;
    Store.set('activePersona', persona);
    _activePracticeList = null;
    Store.set('activePracticeList', null);
    if (!skipNavPush) _pushNav(() => renderPractice());
    _showView('practice-detail');
    _setTopbar(persona.name || 'Persona', true);

    const container = document.getElementById('practice-detail-content');
    const color = safeColor(persona.color || hslFromName(persona.name));
    const allLists = persona.practiceLists || [];
    const activeLists = allLists.filter(l => !l.archived);
    const archivedLists = allLists.filter(l => l.archived);

    let html = `<div class="view-refresh-row">
      <button class="icon-btn view-refresh-btn" id="btn-refresh-practice-detail" title="Sync from Drive" aria-label="Refresh">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>`;
    html += `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-persona">Edit Persona</button></div>` : ''}
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
        <div class="persona-avatar persona-avatar-lg" style="background:${color}">${personaInitials(persona.name)}</div>
        <div class="detail-title" style="margin-bottom:0">${esc(persona.name) || 'Unnamed'}</div>
      </div>
      <div class="detail-subtitle">${activeLists.length} practice list${activeLists.length !== 1 ? 's' : ''}</div>
    </div>`;

    // New Practice List button -- NOT admin-gated
    html += `<button class="btn-ghost setlist-add-btn" id="btn-new-practice-list">
      <i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>New Practice List
    </button>`;

    // Active practice lists
    if (activeLists.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No practice lists yet.</p>
        <p class="muted">Create one above to get started.</p>
      </div>`;
    } else {
      activeLists.forEach(pl => {
        const songCount = (pl.songs || []).length;
        const created = pl.createdAt ? new Date(pl.createdAt).toLocaleDateString() : '';
        html += `
          <div class="practice-list-card" data-pl-id="${esc(pl.id)}">
            <div class="practice-list-card-info">
              <span class="practice-list-card-name">${esc(pl.name)}</span>
              <span class="practice-list-card-meta">${songCount} song${songCount !== 1 ? 's' : ''}${created ? ' \u00B7 ' + created : ''}</span>
            </div>
            <button class="practice-archive-btn" data-archive-id="${esc(pl.id)}" title="Archive" aria-label="Archive list"><i data-lucide="archive"></i></button>
            <i data-lucide="chevron-right" class="file-item-arrow"></i>
          </div>`;
      });
    }

    // Archived section
    if (archivedLists.length > 0) {
      html += `<button class="btn-ghost practice-archive-toggle" id="btn-show-archived" style="width:100%;margin-top:16px;">
        Show Archived (${archivedLists.length})
      </button>`;
      html += `<div id="archived-practice-lists" class="hidden" style="margin-top:8px;">`;
      archivedLists.forEach(pl => {
        const songCount = (pl.songs || []).length;
        html += `
          <div class="practice-list-card practice-list-card-archived" data-pl-id="${esc(pl.id)}">
            <div class="practice-list-card-info">
              <span class="practice-list-card-name" style="opacity:0.6">${esc(pl.name)}</span>
              <span class="practice-list-card-meta">${songCount} song${songCount !== 1 ? 's' : ''} \u00B7 Archived</span>
            </div>
            <button class="practice-unarchive-btn" data-unarchive-id="${esc(pl.id)}" title="Unarchive" aria-label="Unarchive list"><i data-lucide="archive-restore"></i></button>
          </div>`;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire refresh
    document.getElementById('btn-refresh-practice-detail')?.addEventListener('click', () => {
      _doSyncRefresh(() => {
        _syncFromStore();
        const updated = _practice.find(p => p.id === persona.id);
        if (updated) renderPracticeDetail(updated, true);
        else renderPractice(true);
      });
    });

    // Wire practice list card clicks
    container.querySelectorAll('.practice-list-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.practice-archive-btn') || e.target.closest('.practice-unarchive-btn')) return;
        const pl = allLists.find(l => l.id === card.dataset.plId);
        if (pl) renderPracticeListDetail(persona, pl);
      });
    });

    // Wire archive buttons
    container.querySelectorAll('.practice-archive-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pl = allLists.find(l => l.id === btn.dataset.archiveId);
        if (pl) {
          Admin.showConfirm('Archive Practice List',
            `Are you sure you want to archive "${pl.name}"? You can unarchive it later.`,
            async () => {
              pl.archived = true;
              const idx = _practice.findIndex(p => p.id === persona.id);
              if (idx > -1) _practice[idx] = persona;
              await savePractice();
              renderPracticeDetail(persona, true);
            }, 'Archive');
        }
      });
    });

    // Wire unarchive buttons
    container.querySelectorAll('.practice-unarchive-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pl = allLists.find(l => l.id === btn.dataset.unarchiveId);
        if (pl) {
          pl.archived = false;
          const idx = _practice.findIndex(p => p.id === persona.id);
          if (idx > -1) _practice[idx] = persona;
          await savePractice();
          renderPracticeDetail(persona, true);
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

    // Wire edit persona button
    container.querySelector('.btn-edit-persona')?.addEventListener('click', () => {
      renderPracticeEdit(persona, false);
    });

    // Wire new practice list button -- shows name prompt
    document.getElementById('btn-new-practice-list')?.addEventListener('click', () => {
      _showNewPracticeListPrompt(persona);
    });
  }

  function _showNewPracticeListPrompt(persona) {
    const container = document.getElementById('practice-detail-content');
    // Remove existing prompt if any
    document.getElementById('new-pl-prompt')?.remove();

    const div = document.createElement('div');
    div.id = 'new-pl-prompt';
    div.className = 'edit-section';
    div.style.marginTop = '12px';
    div.innerHTML = `
      <div class="edit-section-title">New Practice List</div>
      <div class="form-field">
        <input class="form-input" id="new-pl-name" type="text" placeholder="Practice list name\u2026" autocomplete="off" maxlength="100" />
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn-primary" id="new-pl-create" style="flex:1">Create</button>
        <button class="btn-secondary" id="new-pl-cancel" style="flex:1">Cancel</button>
      </div>
    `;
    container.appendChild(div);
    document.getElementById('new-pl-name').focus();

    document.getElementById('new-pl-create').addEventListener('click', async () => {
      const name = document.getElementById('new-pl-name').value.trim();
      if (!name) { showToast('Name is required.'); document.getElementById('new-pl-name').focus(); return; }
      if (!persona.practiceLists) persona.practiceLists = [];
      const newPL = {
        id: Admin.generateId(persona.practiceLists),
        name,
        archived: false,
        createdAt: new Date().toISOString(),
        songs: []
      };
      persona.practiceLists.push(newPL);
      const idx = _practice.findIndex(p => p.id === persona.id);
      if (idx > -1) _practice[idx] = persona;
      await savePractice();
      renderPracticeDetail(persona, true);
    });

    document.getElementById('new-pl-cancel').addEventListener('click', () => {
      div.remove();
    });
  }

  // ─── PRACTICE -- Practice List Detail ─────────────────────

  function renderPracticeListDetail(persona, practiceList, skipNavPush) {
    _syncFromStore();
    App.cleanupPlayers();
    Player.stopAll();
    _activePersona = persona;
    Store.set('activePersona', persona);
    _activePracticeList = practiceList;
    Store.set('activePracticeList', practiceList);
    if (!skipNavPush) _pushNav(() => renderPracticeDetail(persona));
    _showView('practice-edit');
    _setTopbar(practiceList.name || 'Practice List', true);

    const container = document.getElementById('practice-edit-content');
    const songs = Store.get('songs') || [];
    const plSongs = practiceList.songs || [];

    let html = `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar" style="display:flex;gap:8px;align-items:center;">
        <button class="btn-ghost btn-edit-practice-list">Edit List</button>
        <button class="btn-ghost btn-delete-practice-list-top" style="color:#e87c6a;">Delete List</button>
      </div>` : `<div class="detail-edit-bar" style="display:flex;gap:8px;align-items:center;">
        <button class="btn-ghost btn-delete-practice-list-top" style="color:#e87c6a;">Delete List</button>
      </div>`}
      <div class="detail-title" style="margin-bottom:4px">${esc(practiceList.name)}</div>
      <div class="detail-subtitle">${plSongs.length} song${plSongs.length !== 1 ? 's' : ''}</div>
    </div>`;

    // FEAT-24: Metronome moved to practice mode (below)

    // Add song button (all users)
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

    // FEAT-25: Delete button moved next to Edit List (above)

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire song clicks — FEAT-22: tapping enters practice mode scrolled to that song
    container.querySelectorAll('.setlist-song-row').forEach(row => {
      row.addEventListener('click', () => {
        const song = songs.find(s => s.id === row.dataset.songId);
        if (song && plSongs.length > 0) {
          _enterPracticeMode(persona, practiceList, song.id);
        } else if (song) {
          _pushNav(() => renderPracticeListDetail(persona, practiceList));
          App.renderDetail(song, true);
        }
      });
    });

    // Wire edit button (admin only)
    container.querySelector('.btn-edit-practice-list')?.addEventListener('click', () => {
      _renderPracticeListEdit(persona, practiceList, false);
    });

    // Wire add song button -- shows picker
    document.getElementById('btn-add-practice-song')?.addEventListener('click', () => {
      _showPracticeSongPicker(persona, practiceList);
    });

    // Wire practice mode
    document.getElementById('btn-enter-practice-mode')?.addEventListener('click', () => {
      _enterPracticeMode(persona, practiceList);
    });

    // FEAT-25: Wire delete practice list (moved next to edit button)
    container.querySelector('.btn-delete-practice-list-top')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Practice List', `Permanently delete "${esc(practiceList.name || 'this practice list')}"?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        try {
          const pIdx = _practice.findIndex(p => p.id === persona.id);
          if (pIdx > -1) {
            _practice[pIdx].practiceLists = (_practice[pIdx].practiceLists || []).filter(l => l.id !== practiceList.id);
          }
          await savePractice('Practice list deleted.');
          _activePracticeList = null;
          Store.set('activePracticeList', null);
          const updated = _practice.find(p => p.id === persona.id);
          if (updated) {
            renderPracticeDetail(updated, true);
          } else {
            _navigateBack();
          }
        } catch (err) {
          console.error('Delete practice list failed', err);
          showToast('Delete failed.');
        } finally {
          _savingPractice = false;
        }
      });
    });
  }

  function _showPracticeSongPicker(persona, practiceList) {
    // Prevent duplicate pickers -- if one is already open, just scroll to it
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
    // Scroll the picker into view and focus search
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
          const idx = _practice.findIndex(p => p.id === persona.id);
          if (idx > -1) _practice[idx] = persona;
          await savePractice();
          document.getElementById('practice-picker-section')?.remove();
          renderPracticeListDetail(persona, practiceList, true);
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

  // ─── PRACTICE -- Persona Edit View ────────────────────────

  function renderPracticeEdit(persona, isNew) {
    _syncFromStore();
    App.cleanupPlayers();
    Player.stopAll();
    _editPersona = deepClone(persona);
    _editPersonaIsNew = isNew;
    if (!_editPersona.practiceLists) _editPersona.practiceLists = [];

    if (isNew) {
      _pushNav(() => renderPractice());
    } else {
      _pushNav(() => renderPracticeDetail(persona));
    }
    _showView('practice-edit');
    _setTopbar(isNew ? 'New Persona' : 'Edit Persona', true);

    const container = document.getElementById('practice-edit-content');
    const p = _editPersona;

    let html = `
      <div class="edit-section">
        <div class="edit-section-title">Persona Info</div>
        <div class="form-field">
          <label class="form-label">Name</label>
          <input class="form-input" id="pf-name" type="text" value="${esc(p.name)}" placeholder="e.g. Cat, Marc, Jeff\u2026" maxlength="100" />
        </div>
      </div>

      <div class="edit-form-actions">
        <button class="btn-primary" id="pf-save">Save</button>
        <button class="btn-secondary" id="pf-cancel">Cancel</button>
      </div>

      ${!isNew ? `<div class="delete-zone"><button class="btn-danger" id="pf-delete">Delete Persona</button></div>` : ''}
    `;

    container.innerHTML = html;

    // Save
    document.getElementById('pf-save').addEventListener('click', async () => {
      if (_savingPractice) return;
      p.name = document.getElementById('pf-name').value.trim();
      if (!p.name) { showToast('Name is required.'); document.getElementById('pf-name').focus(); return; }
      _savingPractice = true;
      try {
        p._ts = Date.now();
        p.color = p.color || hslFromName(p.name);
        const creating = _editPersonaIsNew;
        if (creating) {
          _practice.push(p);
        } else {
          const idx = _practice.findIndex(x => x.id === p.id);
          if (idx > -1) _practice[idx] = p;
        }
        await savePractice(creating ? 'Persona created.' : 'Persona saved.');
        _activePersona = null;
        Store.set('activePersona', null);
        renderPractice();
      } catch (err) {
        console.error('Save persona failed', err);
        showToast('Save failed.');
      } finally {
        _savingPractice = false;
      }
    });

    document.getElementById('pf-cancel').addEventListener('click', () => _navigateBack());

    document.getElementById('pf-delete')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Persona', `Permanently delete "${p.name || 'this persona'}" and all their practice lists?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        const backup = [..._practice];
        try {
          if (GitHub.isConfigured()) GitHub.trackDeletion('practice', p.id);
          _practice = _practice.filter(x => x.id !== p.id);
          await savePractice();
          _activePersona = null;
          Store.set('activePersona', null);
          renderPractice();
        } catch (err) {
          console.error('Delete persona failed', err);
          _practice = backup;
          showToast('Delete failed.');
        } finally {
          _savingPractice = false;
        }
      });
    });
  }

  // ─── PRACTICE -- Practice List Edit ───────────────────────

  function _renderPracticeListEdit(persona, practiceList, isNew) {
    App.cleanupPlayers();
    Player.stopAll();
    _editPracticeList = deepClone(practiceList);
    _editPracticeListIsNew = isNew;

    _pushNav(() => renderPracticeListDetail(persona, practiceList));
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

    let _sortablePL = null;
    function _renderPLSongs() {
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
      _savingPractice = true;
      try {
        // Update the practice list inside the persona
        const pIdx = _practice.findIndex(p => p.id === persona.id);
        if (pIdx > -1) {
          const plIdx = (_practice[pIdx].practiceLists || []).findIndex(l => l.id === pl.id);
          if (plIdx > -1) {
            _practice[pIdx].practiceLists[plIdx] = pl;
          }
        }
        await savePractice();
        // Navigate back to the updated list detail
        const updatedPersona = _practice.find(p => p.id === persona.id) || persona;
        const updatedPL = (updatedPersona.practiceLists || []).find(l => l.id === pl.id) || pl;
        renderPracticeListDetail(updatedPersona, updatedPL, true);
      } catch (err) {
        console.error('Save practice list failed', err);
        showToast('Save failed.');
      } finally {
        _savingPractice = false;
      }
    });

    document.getElementById('pl-cancel').addEventListener('click', () => _navigateBack());

    document.getElementById('pl-delete')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Practice List', `Permanently delete "${pl.name || 'this practice list'}"?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        try {
          const pIdx = _practice.findIndex(p => p.id === persona.id);
          if (pIdx > -1) {
            _practice[pIdx].practiceLists = (_practice[pIdx].practiceLists || []).filter(l => l.id !== pl.id);
          }
          await savePractice();
          _activePracticeList = null;
          Store.set('activePracticeList', null);
          renderPracticeDetail(_practice.find(p => p.id === persona.id) || persona);
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

  function _enterPracticeMode(persona, practiceList, scrollToSongId) {
    _practicePersona = persona;
    _practiceList = practiceList;
    App.cleanupPlayers();
    Player.stopAll();
    _pushNav(() => renderPracticeListDetail(persona, practiceList));
    _showView('practice-detail');
    document.body.classList.add('practice-mode-active');
    _setTopbar('Practice Mode', true);

    const container = document.getElementById('practice-detail-content');
    const songs = Store.get('songs') || [];
    const plSongs = practiceList.songs || [];

    let html = `<div class="practice-mode-header">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div class="persona-avatar" style="background:${safeColor(persona.color || hslFromName(persona.name))}">${personaInitials(persona.name)}</div>
        <div>
          <div class="detail-title" style="font-size:22px;margin-bottom:0">${esc(practiceList.name)}</div>
          <div class="muted" style="font-size:12px">${esc(persona.name)} \u00B7 ${plSongs.length} songs</div>
        </div>
      </div>
      <button class="btn-secondary" id="btn-exit-practice-mode" style="width:100%;margin-bottom:16px;">Exit Practice Mode</button>
    </div>`;

    // FEAT-24: Metronome at top of practice mode
    html += _metronomeHTML();

    html += `<div class="practice-accordion">`;
    plSongs.forEach((entry, i) => {
      const song = songs.find(s => s.id === entry.songId);
      if (!song) return;
      const a = song.assets || {};
      html += `
        <div class="practice-accordion-item" data-practice-idx="${i}">
          <div class="practice-accordion-header" data-toggle-idx="${i}">
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
                <div class="file-item-row"><button class="file-item" data-open-chart="${esc(c.driveId)}" data-name="${esc(c.name)}">
                  <div class="file-item-icon pdf"><i data-lucide="file-text"></i></div>
                  <span class="file-item-name">${esc(c.name)}</span>
                  <i data-lucide="chevron-right" class="file-item-arrow"></i>
                </button></div>`).join('')}
              </div>
            </div>` : ''}
            ${(a.audio || []).length ? `<div class="detail-section" style="margin-bottom:12px">
              <div class="detail-section-label">Audio</div>
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${(a.audio || []).map(au => `<div data-audio-container="${esc(au.driveId)}" data-name="${esc(au.name)}" data-song-title="${esc(song.title || '')}"></div>`).join('')}
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

    // Numbered jump-to-song sidebar (circled numbers for quick navigation)
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
    // FEAT-24: Wire metronome in practice mode
    _wireMetronome();

    // Wire jump-to-song sidebar
    container.querySelectorAll('.practice-jump-dot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        haptic.tap();
        const idx = parseInt(btn.dataset.jumpIdx, 10);
        const item = container.querySelector(`.practice-accordion-item[data-practice-idx="${idx}"]`);
        if (item) {
          // Auto-expand the target accordion item
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
          // Highlight active dot
          container.querySelectorAll('.practice-jump-dot').forEach(d => d.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // Per-list accordion state (persists across re-renders within session)
    const listKey = (persona.id || '') + '/' + (practiceList.id || practiceList.name || '');
    if (!_accordionState.has(listKey)) {
      _accordionState.set(listKey, { touched: false, openSet: new Set() });
    }
    const accState = _accordionState.get(listKey);

    // Prune stale songIds that no longer exist in the current practice list
    const validSongIds = new Set(plSongs.map(e => e.songId));
    for (const id of accState.openSet) {
      if (!validSongIds.has(id)) accState.openSet.delete(id);
    }

    // Restore accordion state if user has previously interacted with this list
    if (accState.touched) {
      container.querySelectorAll('.practice-accordion-item').forEach(item => {
        const idx = parseInt(item.dataset.practiceIdx, 10);
        const entry = plSongs[idx];
        if (entry && accState.openSet.has(entry.songId)) {
          const body = item.querySelector('.practice-accordion-body');
          const chevron = item.querySelector('.accordion-chevron');
          if (body) body.classList.remove('hidden');
          if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
      });
    }

    // FEAT-22: Scroll to and auto-expand the target song
    if (scrollToSongId) {
      const targetIdx = plSongs.findIndex(e => e.songId === scrollToSongId);
      if (targetIdx > -1) {
        const targetItem = container.querySelector(`.practice-accordion-item[data-practice-idx="${targetIdx}"]`);
        if (targetItem) {
          const body = targetItem.querySelector('.practice-accordion-body');
          if (body) {
            body.classList.remove('hidden');
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

    // Pre-fetch all chart PDFs eagerly (prevents Drive contention with audio)
    plSongs.forEach(entry => {
      const song = songs.find(s => s.id === entry.songId);
      if (!song) return;
      (song.assets?.charts || []).forEach(c => {
        if (c.driveId) App.getBlobUrl(c.driveId).catch(() => {});
      });
    });

    // Auto-load all audio/charts since all items are expanded
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
          const url = isIOS() ? Drive.getDirectUrl(driveId) : await App.getBlobUrl(driveId);
          if (!url) throw new Error('No audio URL');
          el.innerHTML = '';
          Player.create(el, { name: el.dataset.name || 'Audio', blobUrl: url, songTitle: el.dataset.songTitle || '', loopMode: true, songId: driveId });
        } catch (err) { console.error('Practice audio load failed:', driveId, err); el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`; }
      });

      body.querySelectorAll('[data-open-chart]').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = 'true';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const url = await App.getBlobUrl(btn.dataset.openChart);
            PDFViewer.open(url, btn.dataset.name);
          } catch (err) { console.error('Practice chart load failed:', btn.dataset.openChart, err); showToast('Failed to load chart.'); }
          finally { btn.disabled = false; }
        });
      });
    }

    // Pre-load all assets immediately so everything is ready when user expands
    container.querySelectorAll('.practice-accordion-body').forEach(body => {
      _loadAccordionAssets(body);
    });

    // Wire accordion toggle (collapse/expand)
    container.querySelectorAll('.practice-accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        accState.touched = true;
        const item = header.closest('.practice-accordion-item');
        const idx = parseInt(item.dataset.practiceIdx, 10);
        const entry = plSongs[idx];
        const body = item.querySelector('.practice-accordion-body');
        const chevron = header.querySelector('.accordion-chevron');
        const isOpen = !body.classList.contains('hidden');
        body.classList.toggle('hidden');
        if (chevron) {
          chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        }
        // Persist accordion state by songId
        if (entry) {
          if (isOpen) accState.openSet.delete(entry.songId);
          else accState.openSet.add(entry.songId);
        }

        // Load assets when expanding
        if (!isOpen) _loadAccordionAssets(body);
      });
    });

    // Wire practice notes -- debounced auto-save (uses module-scope _practiceNoteTimer)
    _practiceNoteFlush = () => {
      const pIdx = _practice.findIndex(p => p.id === persona.id);
      if (pIdx > -1) _practice[pIdx] = persona;
      savePractice();
    };
    container.querySelectorAll('.practice-note-input').forEach(textarea => {
      // Prevent accordion toggle when interacting with textarea
      textarea.addEventListener('click', (e) => e.stopPropagation());
      // Auto-expand textarea as user types
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      });
      // Auto-size on initial load if there's content
      if (textarea.value.trim()) {
        requestAnimationFrame(() => {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
        });
      }
      // Debounced save on input
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

    // Wire exit
    document.getElementById('btn-exit-practice-mode')?.addEventListener('click', () => {
      _flushPendingNotesSave();
      _exitPracticeMode();
    });
  }

  // FEAT-26: Practice list picker — called from song detail
  function _showPracticeListPicker(song) {
    _syncFromStore();
    if (!_practice.length) {
      showToast('No practice personas yet');
      return;
    }
    // Build persona → practice list hierarchy
    let rows = '';
    _practice.forEach((persona, pi) => {
      const lists = persona.practiceLists || [];
      if (!lists.length) return;
      rows += `<div class="practice-picker-persona" style="font-size:11px;color:var(--text-3);font-weight:600;padding:8px 0 4px;border-top:1px solid var(--border);">${esc(persona.name)}</div>`;
      lists.forEach((pl, li) => {
        const count = (pl.songs || []).length;
        rows += `<div class="setlist-pick-row" data-persona-idx="${pi}" data-list-idx="${li}">
          <span class="setlist-pick-name">${esc(pl.name)}</span>
          <span class="setlist-pick-count">${count} song${count !== 1 ? 's' : ''}</span>
        </div>`;
      });
    });
    if (!rows) {
      showToast('No practice lists yet');
      return;
    }

    const handle = Modal.create({
      id: 'practice-list-picker-overlay',
      cls: 'setlist-picker',
      content: `<h3>Add to Practice List</h3>${rows}<button class="setlist-picker-cancel">Cancel</button>`,
    });
    if (!handle) return;

    handle.overlay.querySelector('.setlist-picker-cancel').addEventListener('click', () => handle.hide());

    handle.overlay.querySelectorAll('.setlist-pick-row').forEach(row => {
      row.addEventListener('click', () => {
        const pi = parseInt(row.dataset.personaIdx, 10);
        const li = parseInt(row.dataset.listIdx, 10);
        const persona = _practice[pi];
        if (!persona) return;
        const pl = (persona.practiceLists || [])[li];
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
    if (!_practice.length) {
      showToast('No practice personas yet');
      return;
    }
    let rows = '';
    _practice.forEach((persona, pi) => {
      const lists = persona.practiceLists || [];
      if (!lists.length) return;
      rows += `<div class="practice-picker-persona" style="font-size:11px;color:var(--text-3);font-weight:600;padding:8px 0 4px;border-top:1px solid var(--border);">${esc(persona.name)}</div>`;
      lists.forEach((pl, li) => {
        const count = (pl.songs || []).length;
        rows += `<div class="setlist-pick-row" data-persona-idx="${pi}" data-list-idx="${li}">
          <span class="setlist-pick-name">${esc(pl.name)}</span>
          <span class="setlist-pick-count">${count} song${count !== 1 ? 's' : ''}</span>
        </div>`;
      });
    });
    if (!rows) {
      showToast('No practice lists yet');
      return;
    }
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
        const pi = parseInt(row.dataset.personaIdx, 10);
        const li = parseInt(row.dataset.listIdx, 10);
        const persona = _practice[pi];
        if (!persona) return;
        const pl = (persona.practiceLists || [])[li];
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
    document.body.classList.remove('practice-mode-active');
    document.getElementById('practice-jump-bar')?.remove();
    _practicePersona = null;
    _practiceList = null;
    _navigateBack();
  }

  // ─── Cleanup hook: clear BPM hold timer on view exit ──────
  Router.registerHook('cleanupPractice', () => {
    if (_bpmHoldTimer) { clearInterval(_bpmHoldTimer); _bpmHoldTimer = null; }
    if (typeof Metronome !== 'undefined' && Metronome.isPlaying()) Metronome.stop();
  });

  // ─── Public API ───────────────────────────────────────────

  return {
    renderPractice,
    renderPracticeDetail,
    renderPracticeListDetail,
    renderPracticeEdit,
    loadPracticeInstant,
    savePractice,
    migratePracticeData,
    enterPracticeMode: _enterPracticeMode,
    showPracticeListPicker: _showPracticeListPicker,
    showBatchPracticeListPicker: _showBatchPracticeListPicker,
    // Allow app.js to sync local _practice after external refresh
    syncFromStore: _syncFromStore,
  };
})();
