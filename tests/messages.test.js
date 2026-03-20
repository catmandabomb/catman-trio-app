/**
 * messages.test.js — Tests for js/messages.js (permissions, helpers, data structures)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate messages.js pure logic for testing ──────────

function _canManageMessages(role) {
  const r = role || 'guest';
  return ['owner', 'admin', 'conductr'].includes(r);
}

function _canSendMessages(role) {
  const r = role || 'guest';
  return ['owner', 'admin', 'conductr', 'member'].includes(r);
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

const VALID_CATEGORIES = ['general', 'song_request', 'schedule', 'feedback', 'other'];
const VALID_STATUSES = ['open', 'read', 'resolved', 'archived'];

// Replicate isPrivileged check from worker
function _isPrivileged(role, userOrchestraId, targetOrchestraId) {
  return ['owner', 'admin'].includes(role) ||
    (role === 'conductr' && userOrchestraId === targetOrchestraId);
}

// ─── Permission Tests ───────────────────────────────────────

describe('Messages — _canManageMessages', () => {
  it('owner can manage messages', () => {
    assert.ok(_canManageMessages('owner'));
  });

  it('admin can manage messages', () => {
    assert.ok(_canManageMessages('admin'));
  });

  it('conductr can manage messages', () => {
    assert.ok(_canManageMessages('conductr'));
  });

  it('member cannot manage messages', () => {
    assert.notOk(_canManageMessages('member'));
  });

  it('guest cannot manage messages', () => {
    assert.notOk(_canManageMessages('guest'));
  });

  it('null role defaults to guest (cannot manage)', () => {
    assert.notOk(_canManageMessages(null));
  });

  it('undefined role defaults to guest (cannot manage)', () => {
    assert.notOk(_canManageMessages(undefined));
  });

  it('unknown role cannot manage messages', () => {
    assert.notOk(_canManageMessages('superadmin'));
  });

  it('empty string role defaults to guest (cannot manage)', () => {
    assert.notOk(_canManageMessages(''));
  });
});

describe('Messages — _canSendMessages', () => {
  it('owner can send messages', () => {
    assert.ok(_canSendMessages('owner'));
  });

  it('admin can send messages', () => {
    assert.ok(_canSendMessages('admin'));
  });

  it('conductr can send messages', () => {
    assert.ok(_canSendMessages('conductr'));
  });

  it('member can send messages', () => {
    assert.ok(_canSendMessages('member'));
  });

  it('guest cannot send messages', () => {
    assert.notOk(_canSendMessages('guest'));
  });

  it('null role defaults to guest (cannot send)', () => {
    assert.notOk(_canSendMessages(null));
  });

  it('undefined role defaults to guest (cannot send)', () => {
    assert.notOk(_canSendMessages(undefined));
  });

  it('unknown role cannot send messages', () => {
    assert.notOk(_canSendMessages('superadmin'));
  });

  it('empty string role defaults to guest (cannot send)', () => {
    assert.notOk(_canSendMessages(''));
  });
});

// ─── Privileged check (worker-side logic) ───────────────────

describe('Messages — isPrivileged (worker)', () => {
  it('owner is always privileged', () => {
    assert.ok(_isPrivileged('owner', 'orch_001', 'orch_002'));
  });

  it('admin is always privileged', () => {
    assert.ok(_isPrivileged('admin', 'orch_001', 'orch_002'));
  });

  it('conductr is privileged for own orchestra', () => {
    assert.ok(_isPrivileged('conductr', 'orch_001', 'orch_001'));
  });

  it('conductr is NOT privileged for different orchestra', () => {
    assert.notOk(_isPrivileged('conductr', 'orch_001', 'orch_002'));
  });

  it('member is never privileged', () => {
    assert.notOk(_isPrivileged('member', 'orch_001', 'orch_001'));
  });

  it('guest is never privileged', () => {
    assert.notOk(_isPrivileged('guest', 'orch_001', 'orch_001'));
  });
});

// ─── _timeAgo Tests ─────────────────────────────────────────

describe('Messages — _timeAgo', () => {
  it('returns empty string for null', () => {
    assert.equal(_timeAgo(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(_timeAgo(undefined), '');
  });

  it('returns empty string for empty string', () => {
    assert.equal(_timeAgo(''), '');
  });

  it('returns "just now" for current time', () => {
    assert.equal(_timeAgo(new Date().toISOString()), 'just now');
  });

  it('returns minutes ago for recent timestamps', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    assert.equal(_timeAgo(fiveMinAgo), '5m ago');
  });

  it('returns hours ago for multi-hour timestamps', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
    assert.equal(_timeAgo(threeHoursAgo), '3h ago');
  });

  it('returns days ago for multi-day timestamps', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    assert.equal(_timeAgo(twoDaysAgo), '2d ago');
  });

  it('returns locale date for 30+ day old timestamps', () => {
    const oldDate = new Date(Date.now() - 45 * 86400000).toISOString();
    const result = _timeAgo(oldDate);
    // Should NOT be 'd ago' format
    assert.notOk(result.endsWith('d ago'));
    // Should be a date string
    assert.ok(result.length > 0);
  });

  it('boundary: 59 minutes shows as minutes', () => {
    const time = new Date(Date.now() - 59 * 60000).toISOString();
    assert.equal(_timeAgo(time), '59m ago');
  });

  it('boundary: 60 minutes shows as 1h ago', () => {
    const time = new Date(Date.now() - 60 * 60000).toISOString();
    assert.equal(_timeAgo(time), '1h ago');
  });

  it('boundary: 23 hours shows as hours', () => {
    const time = new Date(Date.now() - 23 * 3600000).toISOString();
    assert.equal(_timeAgo(time), '23h ago');
  });

  it('boundary: 24 hours shows as 1d ago', () => {
    const time = new Date(Date.now() - 24 * 3600000).toISOString();
    assert.equal(_timeAgo(time), '1d ago');
  });

  it('boundary: 29 days shows as days', () => {
    const time = new Date(Date.now() - 29 * 86400000).toISOString();
    assert.equal(_timeAgo(time), '29d ago');
  });
});

// ─── Category/Status Constants Tests ────────────────────────

describe('Messages — category labels', () => {
  it('all valid categories have labels', () => {
    for (const cat of VALID_CATEGORIES) {
      assert.ok(_categoryLabels[cat], `Missing label for ${cat}`);
    }
  });

  it('all valid categories have icons', () => {
    for (const cat of VALID_CATEGORIES) {
      assert.ok(_categoryIcons[cat], `Missing icon for ${cat}`);
    }
  });

  it('label map has exactly 5 entries', () => {
    assert.equal(Object.keys(_categoryLabels).length, 5);
  });

  it('icon map has exactly 5 entries', () => {
    assert.equal(Object.keys(_categoryIcons).length, 5);
  });
});

describe('Messages — status colors', () => {
  it('all valid statuses have colors', () => {
    for (const s of VALID_STATUSES) {
      assert.ok(_statusColors[s], `Missing color for ${s}`);
    }
  });

  it('status color map has exactly 4 entries', () => {
    assert.equal(Object.keys(_statusColors).length, 4);
  });

  it('open status uses gold accent', () => {
    assert.equal(_statusColors.open, '#d4b478');
  });
});

// ─── Validation Logic (worker-side) ─────────────────────────

describe('Messages — category validation (worker logic)', () => {
  function validateCategory(input) {
    const validCategories = ['general', 'song_request', 'schedule', 'feedback', 'other'];
    return validCategories.includes(input) ? input : 'general';
  }

  it('accepts general', () => { assert.equal(validateCategory('general'), 'general'); });
  it('accepts song_request', () => { assert.equal(validateCategory('song_request'), 'song_request'); });
  it('accepts schedule', () => { assert.equal(validateCategory('schedule'), 'schedule'); });
  it('accepts feedback', () => { assert.equal(validateCategory('feedback'), 'feedback'); });
  it('accepts other', () => { assert.equal(validateCategory('other'), 'other'); });
  it('defaults invalid category to general', () => { assert.equal(validateCategory('invalid'), 'general'); });
  it('defaults empty string to general', () => { assert.equal(validateCategory(''), 'general'); });
  it('defaults null to general', () => { assert.equal(validateCategory(null), 'general'); });
  it('defaults undefined to general', () => { assert.equal(validateCategory(undefined), 'general'); });
});

describe('Messages — status validation (worker logic)', () => {
  function validateStatus(input) {
    const validStatuses = ['open', 'read', 'resolved', 'archived'];
    return validStatuses.includes(input) ? input : null;
  }

  it('accepts open', () => { assert.equal(validateStatus('open'), 'open'); });
  it('accepts read', () => { assert.equal(validateStatus('read'), 'read'); });
  it('accepts resolved', () => { assert.equal(validateStatus('resolved'), 'resolved'); });
  it('accepts archived', () => { assert.equal(validateStatus('archived'), 'archived'); });
  it('rejects invalid status', () => { assert.isNull(validateStatus('invalid')); });
  it('rejects empty string', () => { assert.isNull(validateStatus('')); });
  it('rejects null', () => { assert.isNull(validateStatus(null)); });
  it('rejects undefined', () => { assert.isNull(validateStatus(undefined)); });
  it('rejects capitalized status', () => { assert.isNull(validateStatus('Open')); });
});

describe('Messages — createMessage input validation (worker logic)', () => {
  function validateCreateMessage(body) {
    if (!body || !body.subject?.trim() || !body.body?.trim()) {
      return { valid: false, error: 'subject and body required' };
    }
    const validCategories = ['general', 'song_request', 'schedule', 'feedback', 'other'];
    const category = validCategories.includes(body.category) ? body.category : 'general';
    return {
      valid: true,
      subject: body.subject.trim().substring(0, 200),
      body: body.body.trim().substring(0, 2000),
      category,
    };
  }

  it('rejects null body', () => {
    assert.notOk(validateCreateMessage(null).valid);
  });

  it('rejects undefined body', () => {
    assert.notOk(validateCreateMessage(undefined).valid);
  });

  it('rejects empty object', () => {
    assert.notOk(validateCreateMessage({}).valid);
  });

  it('rejects missing subject', () => {
    assert.notOk(validateCreateMessage({ body: 'hello' }).valid);
  });

  it('rejects missing body text', () => {
    assert.notOk(validateCreateMessage({ subject: 'test' }).valid);
  });

  it('rejects whitespace-only subject', () => {
    assert.notOk(validateCreateMessage({ subject: '   ', body: 'hello' }).valid);
  });

  it('rejects whitespace-only body', () => {
    assert.notOk(validateCreateMessage({ subject: 'test', body: '   ' }).valid);
  });

  it('accepts valid input', () => {
    const result = validateCreateMessage({ subject: 'Test', body: 'Hello world', category: 'general' });
    assert.ok(result.valid);
    assert.equal(result.subject, 'Test');
    assert.equal(result.body, 'Hello world');
    assert.equal(result.category, 'general');
  });

  it('trims subject and body', () => {
    const result = validateCreateMessage({ subject: '  Test  ', body: '  Hello  ', category: 'general' });
    assert.equal(result.subject, 'Test');
    assert.equal(result.body, 'Hello');
  });

  it('truncates subject to 200 chars', () => {
    const longSubject = 'A'.repeat(300);
    const result = validateCreateMessage({ subject: longSubject, body: 'test', category: 'general' });
    assert.equal(result.subject.length, 200);
  });

  it('truncates body to 2000 chars', () => {
    const longBody = 'B'.repeat(3000);
    const result = validateCreateMessage({ subject: 'test', body: longBody, category: 'general' });
    assert.equal(result.body.length, 2000);
  });

  it('defaults invalid category to general', () => {
    const result = validateCreateMessage({ subject: 'test', body: 'hello', category: 'invalid' });
    assert.equal(result.category, 'general');
  });

  it('defaults missing category to general', () => {
    const result = validateCreateMessage({ subject: 'test', body: 'hello' });
    assert.equal(result.category, 'general');
  });
});

describe('Messages — replyToMessage input validation (worker logic)', () => {
  function validateReply(body) {
    if (!body || !body.body?.trim()) {
      return { valid: false, error: 'body required' };
    }
    return {
      valid: true,
      body: body.body.trim().substring(0, 2000),
    };
  }

  it('rejects null body', () => {
    assert.notOk(validateReply(null).valid);
  });

  it('rejects missing body text', () => {
    assert.notOk(validateReply({}).valid);
  });

  it('rejects whitespace-only body', () => {
    assert.notOk(validateReply({ body: '   ' }).valid);
  });

  it('accepts valid reply', () => {
    const result = validateReply({ body: 'Great idea!' });
    assert.ok(result.valid);
    assert.equal(result.body, 'Great idea!');
  });

  it('trims reply body', () => {
    const result = validateReply({ body: '  trimmed  ' });
    assert.equal(result.body, 'trimmed');
  });

  it('truncates reply body to 2000 chars', () => {
    const result = validateReply({ body: 'C'.repeat(3000) });
    assert.equal(result.body.length, 2000);
  });
});

// ─── Status Transition Logic (from thread view) ────────────

describe('Messages — status transition UI logic', () => {
  function getAvailableActions(status) {
    const actions = [];
    if (status === 'open') {
      actions.push('read', 'resolved');
    } else if (status === 'read') {
      actions.push('resolved');
    } else if (status === 'resolved') {
      actions.push('archived', 'open');
    } else if (status === 'archived') {
      actions.push('open');
    }
    return actions;
  }

  it('open message can be marked read or resolved', () => {
    const actions = getAvailableActions('open');
    assert.includes(actions, 'read');
    assert.includes(actions, 'resolved');
    assert.equal(actions.length, 2);
  });

  it('read message can be resolved', () => {
    const actions = getAvailableActions('read');
    assert.includes(actions, 'resolved');
    assert.equal(actions.length, 1);
  });

  it('resolved message can be archived or reopened', () => {
    const actions = getAvailableActions('resolved');
    assert.includes(actions, 'archived');
    assert.includes(actions, 'open');
    assert.equal(actions.length, 2);
  });

  it('archived message can be reopened', () => {
    const actions = getAvailableActions('archived');
    assert.includes(actions, 'open');
    assert.equal(actions.length, 1);
  });

  it('unknown status has no actions', () => {
    assert.equal(getAvailableActions('unknown').length, 0);
  });
});

// ─── Unread Badge Logic ─────────────────────────────────────

describe('Messages — unread badge formatting', () => {
  function formatBadge(count) {
    if (count <= 0) return null;
    return count > 99 ? '99+' : String(count);
  }

  it('returns null for zero', () => {
    assert.isNull(formatBadge(0));
  });

  it('returns null for negative', () => {
    assert.isNull(formatBadge(-1));
  });

  it('returns string number for small count', () => {
    assert.equal(formatBadge(5), '5');
  });

  it('returns string number for 99', () => {
    assert.equal(formatBadge(99), '99');
  });

  it('returns 99+ for 100', () => {
    assert.equal(formatBadge(100), '99+');
  });

  it('returns 99+ for large numbers', () => {
    assert.equal(formatBadge(999), '99+');
  });

  it('returns "1" for single unread', () => {
    assert.equal(formatBadge(1), '1');
  });
});

// ─── Message card display helpers ───────────────────────────

describe('Messages — isUnread detection', () => {
  function isUnread(msg) {
    return !msg.is_read && msg.status === 'open';
  }

  it('unread open message is detected', () => {
    assert.ok(isUnread({ is_read: false, status: 'open' }));
    assert.ok(isUnread({ is_read: 0, status: 'open' }));
  });

  it('read open message is not unread', () => {
    assert.notOk(isUnread({ is_read: true, status: 'open' }));
    assert.notOk(isUnread({ is_read: 1, status: 'open' }));
  });

  it('unread resolved message is not unread (status matters)', () => {
    assert.notOk(isUnread({ is_read: false, status: 'resolved' }));
  });

  it('unread archived message is not unread', () => {
    assert.notOk(isUnread({ is_read: false, status: 'archived' }));
  });
});

// ─── Message preview truncation ─────────────────────────────

describe('Messages — body preview truncation', () => {
  function getPreview(body) {
    if (!body) return '';
    const text = body.substring(0, 80);
    return body.length > 80 ? text + '...' : text;
  }

  it('returns empty string for null', () => {
    assert.equal(getPreview(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(getPreview(undefined), '');
  });

  it('returns full text for short messages', () => {
    assert.equal(getPreview('Hello world'), 'Hello world');
  });

  it('returns exactly 80 chars for 80-char message', () => {
    const msg = 'A'.repeat(80);
    assert.equal(getPreview(msg), msg);
  });

  it('truncates and adds ellipsis for long messages', () => {
    const msg = 'B'.repeat(100);
    const result = getPreview(msg);
    assert.equal(result.length, 83); // 80 + '...'
    assert.ok(result.endsWith('...'));
  });

  it('returns empty string for empty body', () => {
    assert.equal(getPreview(''), '');
  });
});

// ─── Filter query building (sync.js logic) ──────────────────

describe('Messages — filter query params', () => {
  function buildFilterParams(filters) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.category) params.set('category', filters.category);
    return params.toString();
  }

  it('empty filters produce empty params', () => {
    assert.equal(buildFilterParams({}), '');
  });

  it('status only', () => {
    assert.equal(buildFilterParams({ status: 'open' }), 'status=open');
  });

  it('category only', () => {
    assert.equal(buildFilterParams({ category: 'feedback' }), 'category=feedback');
  });

  it('both filters', () => {
    const result = buildFilterParams({ status: 'open', category: 'schedule' });
    assert.ok(result.includes('status=open'));
    assert.ok(result.includes('category=schedule'));
  });

  it('falsy status is excluded', () => {
    assert.equal(buildFilterParams({ status: '', category: 'general' }), 'category=general');
  });

  it('falsy category is excluded', () => {
    assert.equal(buildFilterParams({ status: 'open', category: '' }), 'status=open');
  });
});

module.exports = {};
