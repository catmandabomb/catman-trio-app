/**
 * messages.js — Member-to-Conductr messaging
 *
 * Lightweight internal messaging scoped to orchestras.
 * Members see their own threads; conductrs see all.
 *
 * @module messages
 */

import * as Store from './store.js?v=20.29';
import * as Auth from '../auth.js?v=20.29';
import * as Router from './router.js?v=20.29';
import * as Sync from './sync.js?v=20.29';
import { showToast } from './utils.js?v=20.29';

// ─── State ──────────────────────────────────────────────

let _messages = [];
let _activeThread = null;
let _filterStatus = 'open';
let _filterCategory = 'all';
let _subView = 'list'; // 'list' | 'compose' | 'thread'
let _unreadCount = 0;
let _unreadTimer = null;

// ─── Helpers ────────────────────────────────────────────

function _esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function _timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

const _categoryLabels = {
  general: 'General',
  song_request: 'Song Request',
  schedule: 'Schedule',
  feedback: 'Feedback',
  other: 'Other',
};

const _categoryIcons = {
  general: 'message-circle',
  song_request: 'music',
  schedule: 'calendar',
  feedback: 'message-square',
  other: 'help-circle',
};

const _statusColors = {
  open: '#d4b478',
  read: '#888',
  resolved: '#4caf50',
  archived: '#555',
};

// ─── Permission checks ─────────────────────────────────

function _canManageMessages() {
  const role = Auth.getRole?.() || 'guest';
  return ['owner', 'admin', 'conductr'].includes(role);
}

function _canSendMessages() {
  const role = Auth.getRole?.() || 'guest';
  return ['owner', 'admin', 'conductr', 'member'].includes(role);
}

// ─── List View ──────────────────────────────────────────

async function _renderList(container) {
  _subView = 'list';
  const isManager = _canManageMessages();

  // Topbar actions
  const actionsHtml = `<div id="messages-topbar-actions" class="topbar-actions-group">
    ${_canSendMessages() ? '<button class="icon-btn" id="msg-btn-compose" title="New message" aria-label="New message"><i data-lucide="plus"></i></button>' : ''}
  </div>`;
  const topbarActions = document.getElementById('topbar-actions');
  if (topbarActions) {
    const existing = document.getElementById('messages-topbar-actions');
    if (existing) existing.remove();
    topbarActions.insertAdjacentHTML('afterbegin', actionsHtml);
  }

  // Build filter pills
  let html = '<div class="msg-filters">';
  // Category filter
  const categories = [
    { key: 'all', label: 'All' },
    { key: 'song_request', label: 'Songs' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'feedback', label: 'Feedback' },
    { key: 'general', label: 'General' },
  ];
  html += '<div class="msg-filter-row">';
  for (const c of categories) {
    html += `<button class="msg-filter-pill ${_filterCategory === c.key ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`;
  }
  html += '</div>';

  // Status filter (conductr only)
  if (isManager) {
    html += '<div class="msg-filter-row">';
    for (const s of ['open', 'resolved', 'all']) {
      html += `<button class="msg-filter-pill ${_filterStatus === s ? 'active' : ''}" data-status="${s}">${s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}</button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Loading state
  html += '<div id="msg-list-content"><div class="msg-loading">Loading messages...</div></div>';
  container.innerHTML = html;

  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

  // Wire filter events
  container.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filterCategory = btn.dataset.cat;
      _renderList(container);
    });
  });
  container.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filterStatus = btn.dataset.status;
      _renderList(container);
    });
  });

  // Compose button
  document.getElementById('msg-btn-compose')?.addEventListener('click', () => {
    _renderCompose(container);
  });

  // Fetch messages
  _messages = await Sync.loadMessages({ status: _filterStatus, category: _filterCategory });
  const listEl = document.getElementById('msg-list-content');
  if (!listEl) return;

  if (_messages.length === 0) {
    listEl.innerHTML = '<div class="msg-empty"><p>No messages</p></div>';
    return;
  }

  let listHtml = '';
  for (const msg of _messages) {
    const isUnread = !msg.is_read && msg.status === 'open';
    const catIcon = _categoryIcons[msg.category] || 'message-circle';
    const statusColor = _statusColors[msg.status] || '#888';
    listHtml += `<div class="msg-card ${isUnread ? 'msg-unread' : ''}" data-msg-id="${msg.id}" role="button" tabindex="0">
      <div class="msg-card-left" style="border-left-color:${statusColor}">
        <i data-lucide="${catIcon}" class="msg-cat-icon"></i>
      </div>
      <div class="msg-card-body">
        <div class="msg-card-header">
          <span class="msg-sender">${_esc(msg.sender_username)}</span>
          <span class="msg-time">${_timeAgo(msg.created_at)}</span>
        </div>
        <div class="msg-subject${isUnread ? ' msg-subject-unread' : ''}">${_esc(msg.subject)}</div>
        <div class="msg-preview">${_esc(msg.body?.substring(0, 80))}${(msg.body?.length || 0) > 80 ? '...' : ''}</div>
        <div class="msg-card-footer">
          <span class="msg-badge" style="background:${statusColor}">${msg.status}</span>
          <span class="msg-cat-label">${_categoryLabels[msg.category] || msg.category}</span>
          ${msg.reply_count ? `<span class="msg-replies"><i data-lucide="message-circle" style="width:12px;height:12px"></i> ${msg.reply_count}</span>` : ''}
        </div>
      </div>
    </div>`;
  }
  listEl.innerHTML = listHtml;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [listEl] });

  // Wire click events
  listEl.querySelectorAll('[data-msg-id]').forEach(card => {
    card.addEventListener('click', () => _renderThread(container, card.dataset.msgId));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') _renderThread(container, card.dataset.msgId); });
  });
}

// ─── Compose View ───────────────────────────────────────

function _renderCompose(container) {
  _subView = 'compose';
  Router.setTopbar('New Message', true);
  Router.pushNav(() => {
    _subView = 'list';
    renderMessages();
  });

  let html = '<div class="msg-compose">';
  html += '<div class="msg-field"><label for="msg-subject">Subject</label><input type="text" id="msg-subject" maxlength="200" placeholder="What\'s this about?" autocomplete="off" /></div>';
  html += '<div class="msg-field"><label for="msg-category">Category</label><select id="msg-category">';
  for (const [key, label] of Object.entries(_categoryLabels)) {
    html += `<option value="${key}">${label}</option>`;
  }
  html += '</select></div>';
  html += '<div class="msg-field"><label for="msg-body">Message</label><textarea id="msg-body" maxlength="2000" rows="6" placeholder="Type your message..."></textarea><div class="msg-char-count"><span id="msg-char">0</span>/2000</div></div>';
  html += '<div class="msg-compose-actions"><button class="btn btn-gold" id="msg-send">Send</button><button class="btn btn-outline" id="msg-cancel">Cancel</button></div>';
  html += '</div>';

  container.innerHTML = html;

  // Char counter
  const bodyEl = document.getElementById('msg-body');
  const charEl = document.getElementById('msg-char');
  bodyEl?.addEventListener('input', () => {
    if (charEl) charEl.textContent = bodyEl.value.length;
  });

  // Send
  document.getElementById('msg-send')?.addEventListener('click', async () => {
    const subject = document.getElementById('msg-subject')?.value?.trim();
    const body = document.getElementById('msg-body')?.value?.trim();
    const category = document.getElementById('msg-category')?.value || 'general';
    if (!subject || !body) {
      showToast('Subject and message are required');
      return;
    }
    const btn = document.getElementById('msg-send');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    const ok = await Sync.sendMessage(subject, body, category);
    if (ok) {
      showToast('Message sent');
      _subView = 'list';
      renderMessages();
    } else {
      showToast('Failed to send message');
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    }
  });

  // Cancel
  document.getElementById('msg-cancel')?.addEventListener('click', () => {
    _subView = 'list';
    renderMessages();
  });
}

// ─── Thread View ────────────────────────────────────────

async function _renderThread(container, messageId) {
  _subView = 'thread';
  Router.setTopbar('Message', true);
  Router.pushNav(() => {
    _subView = 'list';
    renderMessages();
  });

  container.innerHTML = '<div class="msg-loading">Loading thread...</div>';

  const data = await Sync.getMessageThread(messageId);
  if (!data || !data.message) {
    container.innerHTML = '<div class="msg-empty"><p>Message not found</p></div>';
    return;
  }

  _activeThread = data;
  const msg = data.message;
  const replies = data.replies || [];
  const isManager = _canManageMessages();
  const currentUserId = Auth.getUserId?.() || '';

  let html = '<div class="msg-thread">';

  // Original message
  html += `<div class="msg-bubble msg-bubble-original">
    <div class="msg-bubble-header">
      <span class="msg-sender">${_esc(msg.sender_username)}</span>
      <span class="msg-time">${_timeAgo(msg.created_at)}</span>
    </div>
    <div class="msg-bubble-subject">${_esc(msg.subject)}</div>
    <div class="msg-bubble-body">${_esc(msg.body)}</div>
    <div class="msg-bubble-meta">
      <span class="msg-badge" style="background:${_statusColors[msg.status]}">${msg.status}</span>
      <span class="msg-cat-label">${_categoryLabels[msg.category] || msg.category}</span>
    </div>
  </div>`;

  // Replies
  for (const reply of replies) {
    const isSelf = reply.sender_id === currentUserId;
    html += `<div class="msg-bubble ${isSelf ? 'msg-bubble-self' : 'msg-bubble-other'}">
      <div class="msg-bubble-header">
        <span class="msg-sender">${_esc(reply.sender_username)}</span>
        <span class="msg-time">${_timeAgo(reply.created_at)}</span>
      </div>
      <div class="msg-bubble-body">${_esc(reply.body)}</div>
    </div>`;
  }

  // Reply input
  if (_canSendMessages()) {
    html += `<div class="msg-reply-box">
      <textarea id="msg-reply-body" maxlength="2000" rows="3" placeholder="Type a reply..."></textarea>
      <button class="btn btn-gold btn-sm" id="msg-reply-send">Reply</button>
    </div>`;
  }

  // Manager actions
  if (isManager) {
    html += '<div class="msg-actions">';
    if (msg.status === 'open') {
      html += '<button class="btn btn-sm btn-outline" data-set-status="read">Mark Read</button>';
      html += '<button class="btn btn-sm btn-outline" data-set-status="resolved">Resolve</button>';
    } else if (msg.status === 'read') {
      html += '<button class="btn btn-sm btn-outline" data-set-status="resolved">Resolve</button>';
    } else if (msg.status === 'resolved') {
      html += '<button class="btn btn-sm btn-outline" data-set-status="archived">Archive</button>';
      html += '<button class="btn btn-sm btn-outline" data-set-status="open">Reopen</button>';
    } else if (msg.status === 'archived') {
      html += '<button class="btn btn-sm btn-outline" data-set-status="open">Reopen</button>';
    }
    html += `<button class="btn btn-sm btn-danger" id="msg-delete">Delete</button>`;
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;

  // Reply send
  document.getElementById('msg-reply-send')?.addEventListener('click', async () => {
    const bodyEl = document.getElementById('msg-reply-body');
    const text = bodyEl?.value?.trim();
    if (!text) { showToast('Reply cannot be empty'); return; }
    const btn = document.getElementById('msg-reply-send');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    const ok = await Sync.replyToMessage(messageId, text);
    if (ok) {
      showToast('Reply sent');
      _renderThread(container, messageId);
    } else {
      showToast('Failed to send reply');
      if (btn) { btn.disabled = false; btn.textContent = 'Reply'; }
    }
  });

  // Status updates
  container.querySelectorAll('[data-set-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await Sync.updateMessageStatus(messageId, btn.dataset.setStatus);
      if (ok) {
        showToast('Status updated');
        _renderThread(container, messageId);
      } else {
        showToast('Failed to update status');
      }
    });
  });

  // Delete
  document.getElementById('msg-delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this message and all replies?')) return;
    const ok = await Sync.deleteMessage(messageId);
    if (ok) {
      showToast('Message deleted');
      _subView = 'list';
      renderMessages();
    } else {
      showToast('Failed to delete');
    }
  });
}

// ─── Main render ────────────────────────────────────────

function renderMessages() {
  const container = document.getElementById('messages-content');
  if (!container) return;
  Store.set('skipViewTransition', true);
  Router.showView('messages');
  Router.setTopbar('Messages', true);
  Router.pushNav(() => Router.navigateToRoute({ view: 'list' }));
  _renderList(container);
}

// ─── Unread badge polling ───────────────────────────────

async function refreshUnreadBadge() {
  if (!Auth.isLoggedIn?.() || Auth.getRole?.() === 'guest') {
    _updateBadge(0);
    return;
  }
  try {
    _unreadCount = await Sync.getUnreadMessageCount();
    _updateBadge(_unreadCount);
  } catch { /* ignore */ }
}

function _updateBadge(count) {
  const badge = document.getElementById('msg-unread-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function startUnreadPolling() {
  stopUnreadPolling();
  refreshUnreadBadge();
  _unreadTimer = setInterval(() => {
    if (!document.hidden) refreshUnreadBadge();
  }, 60000);
}

function stopUnreadPolling() {
  if (_unreadTimer) { clearInterval(_unreadTimer); _unreadTimer = null; }
}

// ─── Register route ─────────────────────────────────────

Router.register('messages', () => {
  renderMessages();
  // Refresh badge when entering (clears stale count)
  refreshUnreadBadge();
});

export { renderMessages, refreshUnreadBadge, startUnreadPolling, stopUnreadPolling };
