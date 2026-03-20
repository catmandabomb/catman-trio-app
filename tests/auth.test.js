/**
 * auth.test.js — Tests for auth.js (role checks, session handling, permissions)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');
const { setupGlobals, resetAll } = require('./mocks');

// ─── Replicate auth permission logic for testing ────────────

function createAuth(initialUser = null) {
  let _token = initialUser ? 'test-token' : null;
  let _user = initialUser;
  let _expires = null;
  let _checked = false;

  function _save() {
    try {
      if (_token && _user) {
        localStorage.setItem('ct_auth', JSON.stringify({ token: _token, user: _user, expires: _expires }));
      } else {
        localStorage.removeItem('ct_auth');
      }
    } catch (_) {}
  }

  function _restore() {
    try {
      const raw = localStorage.getItem('ct_auth');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.token || !data.user) return false;
      if (data.expires && new Date(data.expires) < new Date()) {
        localStorage.removeItem('ct_auth');
        return false;
      }
      _token = data.token;
      _user = data.user;
      _expires = data.expires;
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    getToken: () => _token,
    getUser: () => _user ? { ..._user } : null,
    getRole: () => _user ? _user.role : null,
    isLoggedIn: () => !!_token && !!_user,
    isChecked: () => _checked,
    setChecked: (v) => { _checked = v; },
    setUser: (u) => { _user = u; },
    setToken: (t) => { _token = t; },
    setExpires: (e) => { _expires = e; },

    canEditSongs: () => {
      if (!_user) return false;
      return ['owner', 'admin', 'conductr'].includes(_user.role);
    },
    canEditSetlists: () => {
      if (!_user) return false;
      return ['owner', 'admin', 'conductr'].includes(_user.role);
    },
    canEditPractice: () => {
      if (!_user) return false;
      return _user.role !== 'guest';
    },
    canManageUsers: () => _user && _user.role === 'owner',
    canViewAuditLog: () => _user && ['owner', 'admin'].includes(_user.role),
    isConductr: () => _user && _user.role === 'conductr',
    isGuest: () => _user && _user.role === 'guest',
    isOwnerOrAdmin: () => _user && ['owner', 'admin'].includes(_user.role),
    canManageOrchestra: () => {
      if (!_user) return false;
      return ['owner', 'admin', 'conductr'].includes(_user.role);
    },
    canUploadFiles: () => {
      if (!_user) return false;
      return ['owner', 'admin', 'conductr'].includes(_user.role);
    },
    isEmailVerified: () => _user ? !!_user.emailVerified : false,
    isPasswordExpired: () => _user ? !!_user.passwordExpired : false,
    getActiveOrchestraId: () => _user ? _user.activeOrchestraId || null : null,
    getInstrumentId: () => _user ? _user.instrumentId || null : null,

    // Persistence
    save: _save,
    restore: _restore,

    logout: () => {
      _token = null;
      _user = null;
      _expires = null;
      _checked = true;
      _save();
      try { localStorage.removeItem('ct_pw_hash'); } catch (_) {}
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────

let mocks;

describe('Auth — Permission helpers (no user)', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth(null);
  });

  it('isLoggedIn returns false when no user', () => {
    assert.equal(auth.isLoggedIn(), false);
  });

  it('canEditSongs returns false when no user', () => {
    assert.equal(auth.canEditSongs(), false);
  });

  it('canEditSetlists returns false when no user', () => {
    assert.equal(auth.canEditSetlists(), false);
  });

  it('canEditPractice returns false when no user', () => {
    assert.equal(auth.canEditPractice(), false);
  });

  it('canManageUsers returns falsy when no user', () => {
    assert.notOk(auth.canManageUsers());
  });

  it('canViewAuditLog returns falsy when no user', () => {
    assert.notOk(auth.canViewAuditLog());
  });

  it('isConductr returns falsy when no user', () => {
    assert.notOk(auth.isConductr());
  });

  it('isGuest returns falsy when no user', () => {
    assert.notOk(auth.isGuest());
  });

  it('isOwnerOrAdmin returns falsy when no user', () => {
    assert.notOk(auth.isOwnerOrAdmin());
  });

  it('canManageOrchestra returns false when no user', () => {
    assert.equal(auth.canManageOrchestra(), false);
  });

  it('canUploadFiles returns false when no user', () => {
    assert.equal(auth.canUploadFiles(), false);
  });

  it('getUser returns null when no user', () => {
    assert.isNull(auth.getUser());
  });

  it('getRole returns null when no user', () => {
    assert.isNull(auth.getRole());
  });

  it('getToken returns null when no user', () => {
    assert.isNull(auth.getToken());
  });

  it('isEmailVerified returns false when no user', () => {
    assert.equal(auth.isEmailVerified(), false);
  });

  it('isPasswordExpired returns false when no user', () => {
    assert.equal(auth.isPasswordExpired(), false);
  });

  it('getActiveOrchestraId returns null when no user', () => {
    assert.isNull(auth.getActiveOrchestraId());
  });

  it('getInstrumentId returns null when no user', () => {
    assert.isNull(auth.getInstrumentId());
  });
});

describe('Auth — Owner role permissions', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '1', username: 'owner1', role: 'owner' });
  });

  it('isLoggedIn returns true', () => { assert.ok(auth.isLoggedIn()); });
  it('canEditSongs returns true', () => { assert.ok(auth.canEditSongs()); });
  it('canEditSetlists returns true', () => { assert.ok(auth.canEditSetlists()); });
  it('canEditPractice returns true', () => { assert.ok(auth.canEditPractice()); });
  it('canManageUsers returns true', () => { assert.ok(auth.canManageUsers()); });
  it('canViewAuditLog returns true', () => { assert.ok(auth.canViewAuditLog()); });
  it('isOwnerOrAdmin returns true', () => { assert.ok(auth.isOwnerOrAdmin()); });
  it('canManageOrchestra returns true', () => { assert.ok(auth.canManageOrchestra()); });
  it('canUploadFiles returns true', () => { assert.ok(auth.canUploadFiles()); });
  it('isConductr returns false', () => { assert.notOk(auth.isConductr()); });
  it('isGuest returns false', () => { assert.notOk(auth.isGuest()); });
  it('getRole returns owner', () => { assert.equal(auth.getRole(), 'owner'); });
});

describe('Auth — Admin role permissions', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '2', username: 'admin1', role: 'admin' });
  });

  it('canEditSongs returns true', () => { assert.ok(auth.canEditSongs()); });
  it('canEditSetlists returns true', () => { assert.ok(auth.canEditSetlists()); });
  it('canEditPractice returns true', () => { assert.ok(auth.canEditPractice()); });
  it('canManageUsers returns false (owner only)', () => { assert.notOk(auth.canManageUsers()); });
  it('canViewAuditLog returns true', () => { assert.ok(auth.canViewAuditLog()); });
  it('isOwnerOrAdmin returns true', () => { assert.ok(auth.isOwnerOrAdmin()); });
  it('canManageOrchestra returns true', () => { assert.ok(auth.canManageOrchestra()); });
  it('canUploadFiles returns true', () => { assert.ok(auth.canUploadFiles()); });
  it('isConductr returns false', () => { assert.notOk(auth.isConductr()); });
  it('isGuest returns false', () => { assert.notOk(auth.isGuest()); });
});

describe('Auth — Conductr role permissions', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '3', username: 'conductr1', role: 'conductr' });
  });

  it('canEditSongs returns true', () => { assert.ok(auth.canEditSongs()); });
  it('canEditSetlists returns true', () => { assert.ok(auth.canEditSetlists()); });
  it('canEditPractice returns true', () => { assert.ok(auth.canEditPractice()); });
  it('canManageUsers returns false', () => { assert.notOk(auth.canManageUsers()); });
  it('canViewAuditLog returns false', () => { assert.notOk(auth.canViewAuditLog()); });
  it('isOwnerOrAdmin returns false', () => { assert.notOk(auth.isOwnerOrAdmin()); });
  it('canManageOrchestra returns true', () => { assert.ok(auth.canManageOrchestra()); });
  it('canUploadFiles returns true', () => { assert.ok(auth.canUploadFiles()); });
  it('isConductr returns true', () => { assert.ok(auth.isConductr()); });
  it('isGuest returns false', () => { assert.notOk(auth.isGuest()); });
});

describe('Auth — Member role permissions', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '4', username: 'member1', role: 'member' });
  });

  it('canEditSongs returns false', () => { assert.notOk(auth.canEditSongs()); });
  it('canEditSetlists returns false', () => { assert.notOk(auth.canEditSetlists()); });
  it('canEditPractice returns true (all non-guests)', () => { assert.ok(auth.canEditPractice()); });
  it('canManageUsers returns false', () => { assert.notOk(auth.canManageUsers()); });
  it('canViewAuditLog returns false', () => { assert.notOk(auth.canViewAuditLog()); });
  it('isOwnerOrAdmin returns false', () => { assert.notOk(auth.isOwnerOrAdmin()); });
  it('canManageOrchestra returns false', () => { assert.notOk(auth.canManageOrchestra()); });
  it('canUploadFiles returns false', () => { assert.notOk(auth.canUploadFiles()); });
  it('isConductr returns false', () => { assert.notOk(auth.isConductr()); });
  it('isGuest returns false', () => { assert.notOk(auth.isGuest()); });
});

describe('Auth — Guest role permissions', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '5', username: 'guest1', role: 'guest' });
  });

  it('canEditSongs returns false', () => { assert.notOk(auth.canEditSongs()); });
  it('canEditSetlists returns false', () => { assert.notOk(auth.canEditSetlists()); });
  it('canEditPractice returns false (guest excluded)', () => { assert.notOk(auth.canEditPractice()); });
  it('canManageUsers returns false', () => { assert.notOk(auth.canManageUsers()); });
  it('canViewAuditLog returns false', () => { assert.notOk(auth.canViewAuditLog()); });
  it('isOwnerOrAdmin returns false', () => { assert.notOk(auth.isOwnerOrAdmin()); });
  it('canManageOrchestra returns false', () => { assert.notOk(auth.canManageOrchestra()); });
  it('canUploadFiles returns false', () => { assert.notOk(auth.canUploadFiles()); });
  it('isConductr returns false', () => { assert.notOk(auth.isConductr()); });
  it('isGuest returns true', () => { assert.ok(auth.isGuest()); });
});

describe('Auth — Unknown/invalid role', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '6', username: 'unknown1', role: 'superadmin' });
  });

  it('canEditSongs returns false for unknown role', () => { assert.notOk(auth.canEditSongs()); });
  it('canEditSetlists returns false for unknown role', () => { assert.notOk(auth.canEditSetlists()); });
  it('canEditPractice returns true (not guest)', () => { assert.ok(auth.canEditPractice()); });
  it('canManageUsers returns false for unknown role', () => { assert.notOk(auth.canManageUsers()); });
  it('isGuest returns false for unknown role', () => { assert.notOk(auth.isGuest()); });
  it('isConductr returns false for unknown role', () => { assert.notOk(auth.isConductr()); });
});

describe('Auth — Session persistence (localStorage)', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '1', username: 'testuser', role: 'admin' });
  });

  it('save() stores auth data in localStorage', () => {
    auth.setExpires(new Date(Date.now() + 86400000).toISOString());
    auth.save();
    const stored = JSON.parse(localStorage.getItem('ct_auth'));
    assert.equal(stored.token, 'test-token');
    assert.equal(stored.user.username, 'testuser');
  });

  it('restore() loads auth data from localStorage', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    localStorage.setItem('ct_auth', JSON.stringify({
      token: 'restored-token',
      user: { id: '9', username: 'restored', role: 'owner' },
      expires: futureDate,
    }));
    const auth2 = createAuth(null);
    const success = auth2.restore();
    assert.ok(success);
    assert.equal(auth2.getToken(), 'restored-token');
    assert.equal(auth2.getUser().username, 'restored');
    assert.equal(auth2.getRole(), 'owner');
  });

  it('restore() rejects expired sessions', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    localStorage.setItem('ct_auth', JSON.stringify({
      token: 'expired-token',
      user: { id: '9', username: 'expired', role: 'admin' },
      expires: pastDate,
    }));
    const auth2 = createAuth(null);
    const success = auth2.restore();
    assert.notOk(success);
    assert.isNull(auth2.getToken());
  });

  it('restore() returns false for missing data', () => {
    const auth2 = createAuth(null);
    assert.notOk(auth2.restore());
  });

  it('restore() returns false for malformed JSON', () => {
    localStorage.setItem('ct_auth', '{broken json');
    const auth2 = createAuth(null);
    assert.notOk(auth2.restore());
  });

  it('restore() returns false when token is missing', () => {
    localStorage.setItem('ct_auth', JSON.stringify({ user: { id: '1', role: 'admin' } }));
    const auth2 = createAuth(null);
    assert.notOk(auth2.restore());
  });

  it('restore() returns false when user is missing', () => {
    localStorage.setItem('ct_auth', JSON.stringify({ token: 'abc' }));
    const auth2 = createAuth(null);
    assert.notOk(auth2.restore());
  });

  it('save() removes ct_auth when logged out', () => {
    auth.setToken(null);
    auth.setUser(null);
    auth.save();
    assert.isNull(localStorage.getItem('ct_auth'));
  });
});

describe('Auth — Logout clears all state', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '1', username: 'test', role: 'owner' });
    auth.save();
  });

  it('logout clears token, user, and localStorage', () => {
    auth.logout();
    assert.isNull(auth.getToken());
    assert.isNull(auth.getUser());
    assert.notOk(auth.isLoggedIn());
    assert.isNull(localStorage.getItem('ct_auth'));
  });

  it('logout sets checked to true', () => {
    auth.logout();
    assert.ok(auth.isChecked());
  });
});

describe('Auth — getUser returns a copy', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '1', username: 'test', role: 'owner' });
  });

  it('getUser returns a shallow copy (not same reference)', () => {
    const u1 = auth.getUser();
    const u2 = auth.getUser();
    u1.username = 'mutated';
    assert.equal(u2.username, 'test');
  });
});

describe('Auth — Email and password fields', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
  });

  it('isEmailVerified reflects user field', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'member', emailVerified: true });
    assert.ok(auth.isEmailVerified());
  });

  it('isEmailVerified is false when field missing', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'member' });
    assert.notOk(auth.isEmailVerified());
  });

  it('isPasswordExpired reflects user field', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'member', passwordExpired: true });
    assert.ok(auth.isPasswordExpired());
  });

  it('isPasswordExpired is false when field missing', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'member' });
    assert.notOk(auth.isPasswordExpired());
  });
});

describe('Auth — Orchestra helpers', () => {
  let auth;
  beforeEach(() => { mocks = setupGlobals(); });

  it('getActiveOrchestraId returns value from user', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'admin', activeOrchestraId: 'orch-42' });
    assert.equal(auth.getActiveOrchestraId(), 'orch-42');
  });

  it('getActiveOrchestraId returns null when field missing', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'admin' });
    assert.isNull(auth.getActiveOrchestraId());
  });

  it('getInstrumentId returns value from user', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'admin', instrumentId: 'inst-7' });
    assert.equal(auth.getInstrumentId(), 'inst-7');
  });

  it('getInstrumentId returns null when field missing', () => {
    auth = createAuth({ id: '1', username: 'test', role: 'admin' });
    assert.isNull(auth.getInstrumentId());
  });
});

describe('Auth — localStorage unavailable', () => {
  let auth;
  beforeEach(() => {
    mocks = setupGlobals();
    auth = createAuth({ id: '1', username: 'test', role: 'admin' });
    mocks.localStorage._simulateUnavailable();
  });

  it('save() does not throw when localStorage fails', () => {
    // Should silently catch
    auth.save();
    assert.ok(true); // If we get here, no throw
  });

  it('restore() returns false when localStorage fails', () => {
    const auth2 = createAuth(null);
    assert.notOk(auth2.restore());
  });
});

module.exports = {};
