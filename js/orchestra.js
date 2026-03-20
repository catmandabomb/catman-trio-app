/**
 * orchestra.js — Orchestra management views
 *
 * Handles orchestra list, detail, member management, and settings.
 * Conductrs get full management UI; members see read-only orchestra info.
 *
 * @module orchestra
 */

import * as Store from './store.js?v=20.29';
import * as Auth from '../auth.js?v=20.29';
import * as Router from './router.js?v=20.29';
import * as Sync from './sync.js?v=20.29';
import { showToast } from './utils.js?v=20.29';

// ─── State ──────────────────────────────────────────────

let _orchestraDetail = null;
let _members = [];
let _conductrId = null;

// ─── API helpers ────────────────────────────────────────

async function _orchFetch(path, options = {}) {
  const token = Auth.getToken();
  if (!token) throw new Error('Not authenticated');
  const workerUrl = 'https://catman-api.catmandabomb.workers.dev';
  const resp = await fetch(workerUrl + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

// ─── Orchestra List View ────────────────────────────────

function renderOrchestraList(container) {
  const orchestras = Store.get('orchestras') || [];
  const activeId = Auth.getActiveOrchestraId();
  const canManage = Auth.canManageOrchestra();

  let html = '<div class="orchestra-list">';
  html += '<h2 class="section-title">My Orchestras</h2>';

  if (orchestras.length === 0) {
    html += '<div class="empty-state"><p>You\'re not in any orchestra yet.</p>';
    if (canManage) {
      html += '<button class="btn btn-gold" id="btn-create-orchestra">Create Orchestra</button>';
    }
    html += '</div>';
  } else {
    for (const orch of orchestras) {
      const isActive = orch.id === activeId;
      html += `<div class="orchestra-card ${isActive ? 'active' : ''}" data-id="${orch.id}" role="group" aria-label="${_esc(orch.name)}">
        <div class="orch-card-header">
          <h3>${_esc(orch.name)}</h3>
          ${isActive ? '<span class="badge badge-gold">Active</span>' : ''}
        </div>
        ${orch.description ? `<p class="orch-desc">${_esc(orch.description)}</p>` : ''}
        <div class="orch-card-actions">
          ${!isActive ? `<button class="btn btn-sm btn-outline" data-switch="${orch.id}">Switch</button>` : ''}
          ${canManage ? `<button class="btn btn-sm btn-outline" data-manage="${orch.id}">Manage</button>` : ''}
        </div>
      </div>`;
    }
    // Create button always available for conductrs with manage rights
    if (canManage && Auth.isConductr()) {
      html += '<button class="btn btn-gold" id="btn-create-orchestra" style="margin-top:12px;">Create Orchestra</button>';
    }
  }
  html += '</div>';
  container.innerHTML = html;

  // Event delegation
  container.addEventListener('click', async (e) => {
    const switchBtn = e.target.closest('[data-switch]');
    if (switchBtn) {
      const orchId = switchBtn.dataset.switch;
      switchBtn.disabled = true;
      switchBtn.textContent = 'Switching…';
      const result = await Sync.switchOrchestra(orchId);
      if (result.ok) {
        showToast('Switched orchestra');
        renderOrchestraList(container);
      } else {
        showToast(result.error || 'Switch failed', 'error');
        switchBtn.disabled = false;
        switchBtn.textContent = 'Switch';
      }
      return;
    }
    const manageBtn = e.target.closest('[data-manage]');
    if (manageBtn) {
      const orchId = manageBtn.dataset.manage;
      Store.set('currentRouteParams', { orchestraId: orchId });
      Router.navigateToRoute({ view: 'orchestra-detail', orchestraId: orchId });
      return;
    }
  });
}

// ─── Orchestra Detail / Management View ─────────────────

async function renderOrchestraDetail(container, params) {
  const orchId = params?.orchestraId;
  if (!orchId) { container.innerHTML = '<p>No orchestra selected</p>'; return; }

  container.innerHTML = '<div class="loading-spinner">Loading…</div>';

  try {
    const [orchRes, membersRes] = await Promise.all([
      _orchFetch(`/orchestras/${orchId}`),
      _orchFetch(`/orchestras/${orchId}/members`),
    ]);
    _orchestraDetail = orchRes.orchestra;
    _members = membersRes.members || [];
    _conductrId = membersRes.conductrId;
  } catch (e) {
    container.innerHTML = `<p class="error-msg">${_esc(e.message)}</p>`;
    return;
  }

  const user = Auth.getUser();
  const isConductr = _conductrId === user?.id || Auth.isOwnerOrAdmin();

  let html = '<div class="orchestra-detail">';
  html += `<h2>${_esc(_orchestraDetail.name)}</h2>`;
  if (_orchestraDetail.description) {
    html += `<p class="orch-desc">${_esc(_orchestraDetail.description)}</p>`;
  }
  if (_orchestraDetail.genres?.length) {
    html += '<div class="tag-pills">';
    for (const g of _orchestraDetail.genres) {
      html += `<span class="pill">${_esc(g)}</span>`;
    }
    html += '</div>';
  }

  // Members section
  html += '<div class="orch-section"><h3>Members <span class="count-badge">' + _members.length + '</span></h3>';
  if (isConductr) {
    html += '<div class="invite-bar"><input type="text" id="invite-username" placeholder="Username to invite…" maxlength="25"><button class="btn btn-sm btn-gold" id="btn-invite">Invite</button></div>';
  }
  html += '<div class="members-list">';
  for (const m of _members) {
    const isSelf = m.id === user?.id;
    const memberIsConductr = m.id === _conductrId;
    html += `<div class="member-row">
      <div class="member-info">
        <span class="member-name">${_esc(m.displayName || m.username)}</span>
        <span class="member-role">${memberIsConductr ? 'Conductr' : m.role}</span>
      </div>
      <div class="member-actions">
        ${isConductr && !memberIsConductr && !isSelf ? `<button class="btn btn-sm btn-danger" data-remove="${m.id}">Remove</button>` : ''}
        ${isSelf && !memberIsConductr ? `<button class="btn btn-sm btn-outline" data-leave="${orchId}">Leave</button>` : ''}
      </div>
    </div>`;
  }
  html += '</div></div>';

  // Settings section (conductr only)
  if (isConductr) {
    html += '<div class="orch-section"><h3>Settings</h3>';
    html += `<div class="form-group">
      <label>Orchestra Name</label>
      <input type="text" id="orch-name" value="${_esc(_orchestraDetail.name)}" maxlength="60">
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="orch-desc" rows="3" maxlength="500">${_esc(_orchestraDetail.description)}</textarea>
    </div>
    <button class="btn btn-gold" id="btn-save-orch">Save Changes</button>`;
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;

  // Event handling
  container.addEventListener('click', async (e) => {
    // Invite
    if (e.target.id === 'btn-invite') {
      const input = container.querySelector('#invite-username');
      const username = input?.value?.trim();
      if (!username) return;
      try {
        await _orchFetch(`/orchestras/${orchId}/members`, {
          method: 'POST',
          body: JSON.stringify({ username }),
        });
        showToast(`Invited ${username}`);
        renderOrchestraDetail(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }
    // Remove member
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const userId = removeBtn.dataset.remove;
      if (!confirm('Remove this member?')) return;
      try {
        await _orchFetch(`/orchestras/${orchId}/members/${userId}`, { method: 'DELETE' });
        showToast('Member removed');
        renderOrchestraDetail(container, params);
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }
    // Leave
    const leaveBtn = e.target.closest('[data-leave]');
    if (leaveBtn) {
      if (!confirm('Leave this orchestra?')) return;
      try {
        await _orchFetch(`/orchestras/${orchId}/members/${user.id}`, { method: 'DELETE' });
        showToast('Left orchestra');
        await Sync.loadOrchestras();
        Router.showView('orchestra');
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }
    // Save settings
    if (e.target.id === 'btn-save-orch') {
      const name = container.querySelector('#orch-name')?.value?.trim();
      const desc = container.querySelector('#orch-desc')?.value?.trim();
      if (!name) { showToast('Name required', 'error'); return; }
      try {
        await _orchFetch(`/orchestras/${orchId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, description: desc }),
        });
        showToast('Orchestra updated');
        await Sync.loadOrchestras();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }
  });
}

// ─── Helpers ────────────────────────────────────────────

function _esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Register routes at import time ─────────────────────

Router.register('orchestra', (route) => {
  const container = document.getElementById('orchestra-content');
  if (!container) return;
  Store.set('skipViewTransition', true);
  Router.showView('orchestra');
  Router.setTopbar('Orchestras', true);
  Router.pushNav(() => Router.navigateToRoute({ view: 'list' }));
  renderOrchestraList(container);
});

Router.register('orchestra-detail', (route) => {
  const container = document.getElementById('orchestra-content');
  if (!container) return;
  Store.set('currentRouteParams', { orchestraId: route.orchestraId });
  Store.set('skipViewTransition', true);
  Router.showView('orchestra');
  Router.setTopbar('Orchestra', true);
  Router.pushNav(() => Router.navigateToRoute({ view: 'orchestra' }));
  renderOrchestraDetail(container, route);
});

export { renderOrchestraList, renderOrchestraDetail };
