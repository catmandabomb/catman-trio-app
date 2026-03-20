/**
 * mocks.js — Browser API mocks for Node.js test environment
 *
 * Provides mock implementations of localStorage, navigator, document,
 * fetch, and other browser APIs that the app modules depend on.
 */

// ─── localStorage mock ──────────────────────────────────────

class MockLocalStorage {
  constructor() { this._store = {}; this._throwOnAccess = false; }
  getItem(key) {
    if (this._throwOnAccess) throw new Error('localStorage is not available');
    return this._store[key] ?? null;
  }
  setItem(key, val) {
    if (this._throwOnAccess) throw new Error('localStorage is not available');
    this._store[key] = String(val);
  }
  removeItem(key) {
    if (this._throwOnAccess) throw new Error('localStorage is not available');
    delete this._store[key];
  }
  clear() {
    if (this._throwOnAccess) throw new Error('localStorage is not available');
    this._store = {};
  }
  get length() { return Object.keys(this._store).length; }
  key(i) { return Object.keys(this._store)[i] || null; }

  // Test helpers
  _simulateUnavailable() { this._throwOnAccess = true; }
  _simulateAvailable() { this._throwOnAccess = false; }
  _reset() { this._store = {}; this._throwOnAccess = false; }
}

// ─── fetch mock ─────────────────────────────────────────────

class MockFetch {
  constructor() {
    this._responses = [];
    this._defaultResponse = { ok: true, status: 200, body: {} };
    this._calls = [];
  }

  _setResponse(response) {
    this._responses.push(response);
  }

  _setDefault(response) {
    this._defaultResponse = response;
  }

  _reset() {
    this._responses = [];
    this._calls = [];
    this._defaultResponse = { ok: true, status: 200, body: {} };
  }

  async call(url, options) {
    this._calls.push({ url, options });
    const resp = this._responses.shift() || this._defaultResponse;
    return {
      ok: resp.ok !== undefined ? resp.ok : true,
      status: resp.status || 200,
      headers: {
        get: (name) => (resp.headers || {})[name] || null,
      },
      json: async () => resp.body || {},
      text: async () => JSON.stringify(resp.body || {}),
      clone: function() { return this; },
    };
  }
}

// ─── Wake Lock mock ─────────────────────────────────────────

class MockWakeLockSentinel {
  constructor() {
    this._released = false;
    this._listeners = {};
  }
  addEventListener(event, fn) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(fn);
  }
  release() {
    this._released = true;
    (this._listeners['release'] || []).forEach(fn => fn());
  }
}

class MockWakeLock {
  constructor() {
    this._shouldFail = false;
    this._sentinels = [];
  }
  async request(type) {
    if (this._shouldFail) throw new Error('Wake lock request failed');
    const sentinel = new MockWakeLockSentinel();
    this._sentinels.push(sentinel);
    return sentinel;
  }
  _reset() {
    this._shouldFail = false;
    this._sentinels = [];
  }
}

// ─── Document mock ──────────────────────────────────────────

class MockElement {
  constructor(tag, id) {
    this.tagName = tag?.toUpperCase() || 'DIV';
    this.id = id || '';
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      toggle(cls, force) {
        if (force !== undefined) {
          if (force) this._classes.add(cls);
          else this._classes.delete(cls);
        } else {
          if (this._classes.has(cls)) this._classes.delete(cls);
          else this._classes.add(cls);
        }
      },
      contains(cls) { return this._classes.has(cls); },
    };
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this._attrs = {};
    this._listeners = {};
    this.children = [];
    this.offsetParent = {};
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] ?? null; }
  removeAttribute(k) { delete this._attrs[k]; }
  hasAttribute(k) { return k in this._attrs; }
  addEventListener(evt, fn) {
    this._listeners[evt] = this._listeners[evt] || [];
    this._listeners[evt].push(fn);
  }
  removeEventListener(evt, fn) {
    if (this._listeners[evt]) {
      this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
    }
  }
  querySelector(sel) { return null; }
  querySelectorAll(sel) { return []; }
  focus() {}
  remove() {}
  appendChild(child) { this.children.push(child); }
}

class MockDocument {
  constructor() {
    this._elements = {};
    this._listeners = {};
    this.activeElement = null;
    this.body = new MockElement('body');
    this.documentElement = new MockElement('html');
    this.visibilityState = 'visible';
  }
  getElementById(id) { return this._elements[id] || null; }
  querySelector(sel) { return null; }
  querySelectorAll(sel) { return []; }
  createElement(tag) { return new MockElement(tag); }
  addEventListener(evt, fn) {
    this._listeners[evt] = this._listeners[evt] || [];
    this._listeners[evt].push(fn);
  }
  removeEventListener(evt, fn) {
    if (this._listeners[evt]) {
      this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
    }
  }
  _registerElement(id, el) { this._elements[id] = el; }
  _reset() { this._elements = {}; this._listeners = {}; }
}

// ─── Setup globals ──────────────────────────────────────────

function setupGlobals() {
  const ls = new MockLocalStorage();
  const mockFetch = new MockFetch();
  const mockWakeLock = new MockWakeLock();
  const doc = new MockDocument();

  global.localStorage = ls;
  global.fetch = (url, opts) => mockFetch.call(url, opts);
  global.document = doc;
  global.window = {
    localStorage: ls,
    matchMedia: (q) => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    innerWidth: 1024,
    innerHeight: 768,
    navigator: { standalone: false },
    MSStream: undefined,
  };
  global.navigator = {
    userAgent: 'Mozilla/5.0 (Node.js Test)',
    platform: 'Linux',
    maxTouchPoints: 0,
    wakeLock: mockWakeLock,
    vibrate: () => true,
    serviceWorker: null,
    deviceMemory: 8,
    storage: { estimate: async () => ({ quota: 100_000_000, usage: 0 }) },
  };
  global.location = { hash: '', pathname: '/', search: '', origin: 'http://localhost' };
  global.history = {
    pushState: () => {},
    replaceState: () => {},
    back: () => {},
  };
  global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  global.setTimeout = global.setTimeout;
  global.clearTimeout = global.clearTimeout;
  global.URL = URL;
  global.Response = class MockResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.headers = init.headers || {};
    }
  };
  global.Request = class MockRequest {
    constructor(url) { this.url = url; }
  };
  global.MediaMetadata = class { constructor(opts) { Object.assign(this, opts); } };
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));

  return { localStorage: ls, mockFetch, mockWakeLock, document: doc };
}

function resetAll(mocks) {
  mocks.localStorage._reset();
  mocks.mockFetch._reset();
  mocks.mockWakeLock._reset();
  mocks.document._reset();
}

module.exports = { MockLocalStorage, MockFetch, MockWakeLock, MockWakeLockSentinel, MockElement, MockDocument, setupGlobals, resetAll };
