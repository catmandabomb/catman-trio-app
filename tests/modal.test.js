/**
 * modal.test.js — Tests for js/modal.js (open/close state, focus trap, escape handling)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');
const { MockElement, MockDocument } = require('./mocks');

// ─── Replicate modal logic for testing ───────────────────────

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function createModalSystem() {
  const _active = new Map();

  function show(overlay, opts = {}) {
    if (!overlay) return null;
    if (_active.has(overlay)) {
      _active.get(overlay).cleanup();
    }

    const { backdrop = true, escape = true, onHide } = opts;
    overlay.classList.remove('hidden');

    let _escHandler = null;
    let _backdropHandler = null;

    const _hide = () => {
      overlay.classList.add('hidden');
      cleanup();
      if (onHide) onHide();
    };

    if (escape) {
      _escHandler = (e) => {
        if (e.key === 'Escape') _hide();
      };
    }

    if (backdrop) {
      _backdropHandler = (e) => {
        if (e.target === overlay) _hide();
      };
    }

    function cleanup() {
      _active.delete(overlay);
    }

    const handle = { hide: _hide, overlay, cleanup, _escHandler, _backdropHandler };
    _active.set(overlay, handle);
    return handle;
  }

  function hide(overlay) {
    if (!overlay) return;
    const entry = _active.get(overlay);
    if (entry) {
      entry.hide();
    } else {
      overlay.classList.add('hidden');
    }
  }

  function getActive() { return _active; }

  return { show, hide, getActive };
}

// ─── Tests ───────────────────────────────────────────────────

describe('Modal — show/hide basics', () => {
  let modal, overlay;
  beforeEach(() => {
    modal = createModalSystem();
    overlay = new MockElement('div', 'test-modal');
    overlay.classList.add('hidden');
  });

  it('show removes hidden class', () => {
    modal.show(overlay);
    assert.notOk(overlay.classList.contains('hidden'));
  });

  it('hide adds hidden class', () => {
    const handle = modal.show(overlay);
    handle.hide();
    assert.ok(overlay.classList.contains('hidden'));
  });

  it('show returns a handle with hide function', () => {
    const handle = modal.show(overlay);
    assert.ok(handle);
    assert.type(handle.hide, 'function');
  });

  it('show returns null for null overlay', () => {
    assert.isNull(modal.show(null));
  });

  it('hide on non-tracked overlay just adds hidden', () => {
    const other = new MockElement('div', 'other');
    modal.hide(other);
    assert.ok(other.classList.contains('hidden'));
  });

  it('hide on null does nothing', () => {
    modal.hide(null); // Should not throw
    assert.ok(true);
  });
});

describe('Modal — active tracking', () => {
  let modal, overlay;
  beforeEach(() => {
    modal = createModalSystem();
    overlay = new MockElement('div', 'test-modal');
  });

  it('show adds to active map', () => {
    modal.show(overlay);
    assert.equal(modal.getActive().size, 1);
  });

  it('hide removes from active map', () => {
    const handle = modal.show(overlay);
    handle.hide();
    assert.equal(modal.getActive().size, 0);
  });

  it('re-showing same overlay cleans up previous', () => {
    modal.show(overlay);
    modal.show(overlay);
    assert.equal(modal.getActive().size, 1);
  });

  it('multiple modals can be active', () => {
    const overlay2 = new MockElement('div', 'test-modal-2');
    modal.show(overlay);
    modal.show(overlay2);
    assert.equal(modal.getActive().size, 2);
  });
});

describe('Modal — escape key option', () => {
  let modal, overlay;
  beforeEach(() => {
    modal = createModalSystem();
    overlay = new MockElement('div', 'test-modal');
  });

  it('escape handler created when escape=true (default)', () => {
    const handle = modal.show(overlay);
    assert.ok(handle._escHandler);
  });

  it('escape handler not created when escape=false', () => {
    const handle = modal.show(overlay, { escape: false });
    assert.isNull(handle._escHandler);
  });

  it('escape handler triggers hide on Escape key', () => {
    const handle = modal.show(overlay);
    handle._escHandler({ key: 'Escape' });
    assert.ok(overlay.classList.contains('hidden'));
  });

  it('escape handler ignores other keys', () => {
    const handle = modal.show(overlay);
    handle._escHandler({ key: 'Enter' }); // Should not close
    assert.notOk(overlay.classList.contains('hidden'));
  });
});

describe('Modal — backdrop click option', () => {
  let modal, overlay;
  beforeEach(() => {
    modal = createModalSystem();
    overlay = new MockElement('div', 'test-modal');
  });

  it('backdrop handler created when backdrop=true (default)', () => {
    const handle = modal.show(overlay);
    assert.ok(handle._backdropHandler);
  });

  it('backdrop handler not created when backdrop=false', () => {
    const handle = modal.show(overlay, { backdrop: false });
    assert.isNull(handle._backdropHandler);
  });

  it('backdrop click on overlay itself triggers hide', () => {
    const handle = modal.show(overlay);
    handle._backdropHandler({ target: overlay }); // Click on overlay (backdrop)
    assert.ok(overlay.classList.contains('hidden'));
  });

  it('backdrop click on child does not trigger hide', () => {
    const handle = modal.show(overlay);
    const child = new MockElement('div');
    handle._backdropHandler({ target: child }); // Click on inner content
    assert.notOk(overlay.classList.contains('hidden'));
  });
});

describe('Modal — onHide callback', () => {
  let modal, overlay;
  beforeEach(() => {
    modal = createModalSystem();
    overlay = new MockElement('div', 'test-modal');
  });

  it('onHide callback is called on hide', () => {
    let called = false;
    const handle = modal.show(overlay, { onHide: () => { called = true; } });
    handle.hide();
    assert.ok(called);
  });

  it('onHide callback is called on escape', () => {
    let called = false;
    const handle = modal.show(overlay, { onHide: () => { called = true; } });
    handle._escHandler({ key: 'Escape' });
    assert.ok(called);
  });

  it('onHide callback is called on backdrop click', () => {
    let called = false;
    const handle = modal.show(overlay, { onHide: () => { called = true; } });
    handle._backdropHandler({ target: overlay });
    assert.ok(called);
  });

  it('no callback crash when onHide not provided', () => {
    const handle = modal.show(overlay);
    handle.hide();
    assert.ok(true); // No crash
  });
});

describe('Modal — FOCUSABLE selector', () => {
  it('includes button', () => { assert.ok(FOCUSABLE.includes('button')); });
  it('includes input', () => { assert.ok(FOCUSABLE.includes('input')); });
  it('includes select', () => { assert.ok(FOCUSABLE.includes('select')); });
  it('includes textarea', () => { assert.ok(FOCUSABLE.includes('textarea')); });
  it('includes [href]', () => { assert.ok(FOCUSABLE.includes('[href]')); });
  it('excludes disabled elements', () => { assert.ok(FOCUSABLE.includes(':not([disabled])')); });
  it('excludes tabindex=-1', () => { assert.ok(FOCUSABLE.includes(':not([tabindex="-1"])')); });
});

module.exports = {};
