/**
 * router.test.js — Tests for js/router.js (hash parsing, route matching, navigation)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate router logic for testing ─────────────────────

function viewToHash(viewName, params) {
  switch (viewName) {
    case 'list': return '#';
    case 'detail': return params?.songId ? `#song/${params.songId}` : '#';
    case 'setlists': return '#setlists';
    case 'setlist-detail': return params?.setlistId ? `#setlist/${params.setlistId}` : '#setlists';
    case 'practice': return '#practice';
    case 'practice-detail': return params?.practiceListId ? `#practice/${params.practiceListId}` : '#practice';
    case 'practice-edit': return params?.practiceListId ? `#practice/${params.practiceListId}` : '#practice';
    case 'dashboard': return '#dashboard';
    case 'account': return '#account';
    case 'settings': return '#settings';
    case 'messages': return '#messages';
    case 'wikicharts': return '#wikicharts';
    case 'wikichart-detail': return params?.wikiChartId ? `#wikichart/${params.wikiChartId}` : '#wikicharts';
    case 'orchestra': return '#orchestra';
    case 'orchestra-detail': return params?.orchestraId ? `#orchestra/${params.orchestraId}` : '#orchestra';
    default: return '#';
  }
}

function resolveHash(hash) {
  if (!hash || hash === '#' || hash === '') return { view: 'list' };
  const raw = hash.replace(/^#/, '');
  const [routePart, queryPart] = raw.split('?');
  const params = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }
  const parts = routePart.split('/');
  switch (parts[0]) {
    case 'song': return { view: 'detail', songId: parts[1] };
    case 'setlists': return { view: 'setlists' };
    case 'setlist': return { view: 'setlist-detail', setlistId: parts[1] };
    case 'practice':
      return parts[1] ? { view: 'practice-detail', practiceListId: parts[1] } : { view: 'practice' };
    case 'messages': return { view: 'messages' };
    case 'dashboard': return { view: 'dashboard' };
    case 'account': return { view: 'account' };
    case 'settings': return { view: 'settings' };
    case 'wikicharts': return { view: 'wikicharts' };
    case 'wikichart': return { view: 'wikichart-detail', wikiChartId: parts[1] };
    case 'reset-password': return { view: 'reset-password', token: params.token };
    case 'verify-email': return { view: 'verify-email', token: params.token };
    case 'orchestra': return parts[1] ? { view: 'orchestra-detail', orchestraId: parts[1] } : { view: 'orchestra' };
    default: return { view: 'list' };
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe('Router — resolveHash basics', () => {
  it('empty string resolves to list', () => {
    assert.equal(resolveHash('').view, 'list');
  });

  it('null resolves to list', () => {
    assert.equal(resolveHash(null).view, 'list');
  });

  it('undefined resolves to list', () => {
    assert.equal(resolveHash(undefined).view, 'list');
  });

  it('# resolves to list', () => {
    assert.equal(resolveHash('#').view, 'list');
  });

  it('#setlists resolves to setlists', () => {
    assert.equal(resolveHash('#setlists').view, 'setlists');
  });

  it('#practice resolves to practice', () => {
    assert.equal(resolveHash('#practice').view, 'practice');
  });

  it('#dashboard resolves to dashboard', () => {
    assert.equal(resolveHash('#dashboard').view, 'dashboard');
  });

  it('#account resolves to account', () => {
    assert.equal(resolveHash('#account').view, 'account');
  });

  it('#settings resolves to settings', () => {
    assert.equal(resolveHash('#settings').view, 'settings');
  });

  it('#wikicharts resolves to wikicharts', () => {
    assert.equal(resolveHash('#wikicharts').view, 'wikicharts');
  });

  it('#orchestra resolves to orchestra', () => {
    assert.equal(resolveHash('#orchestra').view, 'orchestra');
  });
});

describe('Router — resolveHash with IDs', () => {
  it('#song/abc1 resolves to detail with songId', () => {
    const r = resolveHash('#song/abc1');
    assert.equal(r.view, 'detail');
    assert.equal(r.songId, 'abc1');
  });

  it('#setlist/sl42 resolves to setlist-detail with setlistId', () => {
    const r = resolveHash('#setlist/sl42');
    assert.equal(r.view, 'setlist-detail');
    assert.equal(r.setlistId, 'sl42');
  });

  it('#wikichart/wc_abcd1234 resolves to wikichart-detail', () => {
    const r = resolveHash('#wikichart/wc_abcd1234');
    assert.equal(r.view, 'wikichart-detail');
    assert.equal(r.wikiChartId, 'wc_abcd1234');
  });

  it('#orchestra/orch123 resolves to orchestra-detail', () => {
    const r = resolveHash('#orchestra/orch123');
    assert.equal(r.view, 'orchestra-detail');
    assert.equal(r.orchestraId, 'orch123');
  });

  it('#song with no ID returns undefined songId', () => {
    const r = resolveHash('#song');
    assert.equal(r.view, 'detail');
    assert.isUndefined(r.songId);
  });

  it('#setlist with no ID returns undefined setlistId', () => {
    const r = resolveHash('#setlist');
    assert.equal(r.view, 'setlist-detail');
    assert.isUndefined(r.setlistId);
  });
});

describe('Router — resolveHash with query params', () => {
  it('reset-password with token', () => {
    const r = resolveHash('#reset-password?token=abc123def');
    assert.equal(r.view, 'reset-password');
    assert.equal(r.token, 'abc123def');
  });

  it('verify-email with token', () => {
    const r = resolveHash('#verify-email?token=verify456');
    assert.equal(r.view, 'verify-email');
    assert.equal(r.token, 'verify456');
  });

  it('reset-password with URL-encoded token', () => {
    const r = resolveHash('#reset-password?token=abc%20def');
    assert.equal(r.token, 'abc def');
  });

  it('multiple query params parsed correctly', () => {
    const r = resolveHash('#reset-password?token=abc&extra=val');
    assert.equal(r.token, 'abc');
  });

  it('query param with no value gives empty string', () => {
    const r = resolveHash('#reset-password?token=');
    assert.equal(r.token, '');
  });
});

describe('Router — resolveHash edge cases', () => {
  it('unknown route falls back to list', () => {
    assert.equal(resolveHash('#unknown-route').view, 'list');
  });

  it('random gibberish falls back to list', () => {
    assert.equal(resolveHash('#asdfghjkl').view, 'list');
  });

  it('double hash handled (strips first #)', () => {
    // Input: ##setlists — after replace(/^#/, '') = '#setlists', parts[0] = '#setlists'
    // This would fall through to default = list. This is expected edge-case behavior.
    const r = resolveHash('##setlists');
    assert.equal(r.view, 'list');
  });

  it('hash with trailing slash', () => {
    const r = resolveHash('#song/abc1/');
    // parts = ['song', 'abc1', ''] — songId is abc1
    assert.equal(r.view, 'detail');
    assert.equal(r.songId, 'abc1');
  });

  it('hash with only slash', () => {
    const r = resolveHash('#/');
    // parts[0] = '' → default case → list
    assert.equal(r.view, 'list');
  });

  it('practice with no ID resolves to practice', () => {
    assert.equal(resolveHash('#practice').view, 'practice');
  });

  it('#practice/:id resolves to practice-detail with practiceListId', () => {
    const route = resolveHash('#practice/pl_abc123');
    assert.equal(route.view, 'practice-detail');
    assert.equal(route.practiceListId, 'pl_abc123');
  });

  it('#messages resolves to messages', () => {
    assert.equal(resolveHash('#messages').view, 'messages');
  });
});

describe('Router — viewToHash', () => {
  it('list maps to #', () => {
    assert.equal(viewToHash('list'), '#');
  });

  it('detail with songId maps to #song/id', () => {
    assert.equal(viewToHash('detail', { songId: 'abc1' }), '#song/abc1');
  });

  it('detail without songId maps to #', () => {
    assert.equal(viewToHash('detail'), '#');
    assert.equal(viewToHash('detail', {}), '#');
  });

  it('setlists maps to #setlists', () => {
    assert.equal(viewToHash('setlists'), '#setlists');
  });

  it('setlist-detail with setlistId maps to #setlist/id', () => {
    assert.equal(viewToHash('setlist-detail', { setlistId: 'sl1' }), '#setlist/sl1');
  });

  it('setlist-detail without setlistId maps to #setlists', () => {
    assert.equal(viewToHash('setlist-detail'), '#setlists');
  });

  it('practice maps to #practice', () => {
    assert.equal(viewToHash('practice'), '#practice');
  });

  it('practice-detail with ID maps to #practice/:id', () => {
    assert.equal(viewToHash('practice-detail', { practiceListId: 'pl_abc' }), '#practice/pl_abc');
  });

  it('practice-detail without ID maps to #practice', () => {
    assert.equal(viewToHash('practice-detail'), '#practice');
  });

  it('practice-edit with ID maps to #practice/:id', () => {
    assert.equal(viewToHash('practice-edit', { practiceListId: 'pl_xyz' }), '#practice/pl_xyz');
  });

  it('messages maps to #messages', () => {
    assert.equal(viewToHash('messages'), '#messages');
  });

  it('wikichart-detail with ID maps correctly', () => {
    assert.equal(viewToHash('wikichart-detail', { wikiChartId: 'wc_123' }), '#wikichart/wc_123');
  });

  it('wikichart-detail without ID maps to #wikicharts', () => {
    assert.equal(viewToHash('wikichart-detail'), '#wikicharts');
  });

  it('orchestra-detail with ID maps correctly', () => {
    assert.equal(viewToHash('orchestra-detail', { orchestraId: 'o1' }), '#orchestra/o1');
  });

  it('orchestra-detail without ID maps to #orchestra', () => {
    assert.equal(viewToHash('orchestra-detail'), '#orchestra');
  });

  it('unknown view maps to #', () => {
    assert.equal(viewToHash('nonexistent'), '#');
  });

  it('dashboard maps to #dashboard', () => {
    assert.equal(viewToHash('dashboard'), '#dashboard');
  });

  it('account maps to #account', () => {
    assert.equal(viewToHash('account'), '#account');
  });

  it('settings maps to #settings', () => {
    assert.equal(viewToHash('settings'), '#settings');
  });
});

describe('Router — viewToHash/resolveHash roundtrip', () => {
  it('list roundtrips', () => {
    const hash = viewToHash('list');
    assert.equal(resolveHash(hash).view, 'list');
  });

  it('setlists roundtrips', () => {
    const hash = viewToHash('setlists');
    assert.equal(resolveHash(hash).view, 'setlists');
  });

  it('detail with songId roundtrips', () => {
    const hash = viewToHash('detail', { songId: 'ff01' });
    const r = resolveHash(hash);
    assert.equal(r.view, 'detail');
    assert.equal(r.songId, 'ff01');
  });

  it('setlist-detail with setlistId roundtrips', () => {
    const hash = viewToHash('setlist-detail', { setlistId: 'sl99' });
    const r = resolveHash(hash);
    assert.equal(r.view, 'setlist-detail');
    assert.equal(r.setlistId, 'sl99');
  });

  it('wikichart-detail roundtrips', () => {
    const hash = viewToHash('wikichart-detail', { wikiChartId: 'wc_abc' });
    const r = resolveHash(hash);
    assert.equal(r.view, 'wikichart-detail');
    assert.equal(r.wikiChartId, 'wc_abc');
  });

  it('dashboard roundtrips', () => {
    assert.equal(resolveHash(viewToHash('dashboard')).view, 'dashboard');
  });

  it('practice roundtrips', () => {
    assert.equal(resolveHash(viewToHash('practice')).view, 'practice');
  });

  it('practice-detail with ID roundtrips', () => {
    const hash = viewToHash('practice-detail', { practiceListId: 'pl_abc' });
    const route = resolveHash(hash);
    assert.equal(route.view, 'practice-detail');
    assert.equal(route.practiceListId, 'pl_abc');
  });

  it('messages roundtrips', () => {
    assert.equal(resolveHash(viewToHash('messages')).view, 'messages');
  });
});

describe('Router — navStack logic', () => {
  it('push and pop work correctly', () => {
    const stack = [];
    const fn1 = () => 'a';
    const fn2 = () => 'b';
    stack.push(fn1);
    stack.push(fn2);
    assert.equal(stack.length, 2);
    const popped = stack.pop();
    assert.equal(popped(), 'b');
    assert.equal(stack.length, 1);
  });

  it('stack is capped at 20 entries', () => {
    const stack = [];
    for (let i = 0; i < 25; i++) stack.push(() => i);
    if (stack.length > 20) stack.splice(0, stack.length - 20);
    assert.equal(stack.length, 20);
  });

  it('empty stack pop returns undefined', () => {
    const stack = [];
    const result = stack.pop();
    assert.isUndefined(result);
  });
});

module.exports = {};
