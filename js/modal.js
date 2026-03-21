/**
 * modal.js — Consolidated modal system with Popover API progressive enhancement
 *
 * Uses native Popover API (popover="manual") where supported for:
 *   - Top-layer rendering (above all z-index stacking)
 *   - Browser-native Escape key handling
 *   - Proper focus management
 * Falls back to the classic overlay approach on older browsers.
 *
 * All modals go through this module for consistent UX.
 */

import { haptic } from './utils.js?v=20.42';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

// Feature detect: does the browser support the Popover API?
const _supportsPopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

// Track active modals for cleanup
const _active = new Map(); // overlayEl -> { trap, cleanup, hide }

// ─── Focus Trap ─────────────────────────────────────────────

/**
 * Trap Tab/Shift+Tab within a modal element.
 * Auto-focuses first focusable element.
 * Returns { release() } to teardown.
 */
function trapFocus(modalEl) {
  if (!modalEl) return null;
  const previousFocus = document.activeElement;
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...modalEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  modalEl.addEventListener('keydown', handler);
  const firstFocusable = modalEl.querySelector(FOCUSABLE);
  if (firstFocusable) setTimeout(() => firstFocusable.focus(), 50);
  return {
    release() {
      modalEl.removeEventListener('keydown', handler);
      if (previousFocus && previousFocus.focus) {
        try { previousFocus.focus(); } catch (_) {}
      }
    }
  };
}

// ─── Popover API helpers ────────────────────────────────────

/**
 * Upgrade an overlay element to use the Popover API.
 * Sets popover="manual" so we control show/hide programmatically.
 */
function _upgradeToPopover(overlay) {
  if (!_supportsPopover) return false;
  if (overlay.getAttribute('popover') != null) return true; // already upgraded
  overlay.setAttribute('popover', 'manual');
  return true;
}

// ─── Show / Hide ────────────────────────────────────────────

/**
 * Show an existing overlay element as a modal.
 * Sets up focus trap, Escape key, and optional backdrop click.
 * Progressively enhanced with Popover API where available.
 *
 * @param {HTMLElement|string} overlayOrId - overlay element or its ID
 * @param {Object} [opts]
 * @param {boolean} [opts.backdrop=true] - close on backdrop click
 * @param {boolean} [opts.escape=true] - close on Escape key
 * @param {Function} [opts.onHide] - callback when modal is hidden
 * @returns {{ hide: Function, overlay: HTMLElement }}
 */
function show(overlayOrId, opts = {}) {
  const overlay = typeof overlayOrId === 'string'
    ? document.getElementById(overlayOrId)
    : overlayOrId;
  if (!overlay) return null;

  // Clean up prior instance on same overlay
  if (_active.has(overlay)) {
    _active.get(overlay).cleanup();
  }

  const { backdrop = true, escape = true, onHide } = opts;
  const usePopover = _upgradeToPopover(overlay);

  // Show the overlay
  if (usePopover) {
    try { overlay.showPopover(); } catch (_) {}
  }
  overlay.classList.remove('hidden');

  const trap = trapFocus(overlay);

  const _hide = () => {
    if (usePopover) {
      try { overlay.hidePopover(); } catch (_) {}
    }
    overlay.classList.add('hidden');
    if (trap) trap.release();
    cleanup();
    if (onHide) onHide();
  };

  // Escape key — Popover API handles this for popover="auto", but we use "manual"
  // so we still need our own handler for consistent behavior
  const _onKey = (e) => {
    if (escape && e.key === 'Escape') {
      e.stopImmediatePropagation();
      _hide();
    }
  };

  const _onBackdrop = (e) => {
    if (backdrop && e.target === overlay) _hide();
  };

  // Popover toggle event — browser-initiated dismiss (e.g. popover stacking)
  const _onToggle = (e) => {
    if (e.newState === 'closed') _hide();
  };

  document.addEventListener('keydown', _onKey);
  overlay.addEventListener('click', _onBackdrop);
  if (usePopover) overlay.addEventListener('toggle', _onToggle);

  function cleanup() {
    document.removeEventListener('keydown', _onKey);
    overlay.removeEventListener('click', _onBackdrop);
    if (usePopover) overlay.removeEventListener('toggle', _onToggle);
    _active.delete(overlay);
  }

  const handle = { hide: _hide, overlay, cleanup };
  _active.set(overlay, handle);
  return handle;
}

/**
 * Hide a specific modal by element or ID.
 */
function hide(overlayOrId) {
  const overlay = typeof overlayOrId === 'string'
    ? document.getElementById(overlayOrId)
    : overlayOrId;
  if (!overlay) return;
  const entry = _active.get(overlay);
  if (entry) {
    entry.hide();
  } else {
    if (_supportsPopover && overlay.getAttribute('popover') != null) {
      try { overlay.hidePopover(); } catch (_) {}
    }
    overlay.classList.add('hidden');
  }
}

// ─── Confirm ────────────────────────────────────────────────

/**
 * Show the shared confirm modal.
 * Uses the existing #modal-confirm overlay in index.html.
 *
 * @param {string} title
 * @param {string} message
 * @param {Function} onConfirm - called on OK
 * @param {Object} [opts]
 * @param {string} [opts.okLabel='Delete']
 * @param {boolean} [opts.danger=true]
 */
function confirm(title, message, onConfirm, opts = {}) {
  const { okLabel = 'Delete', danger = true } = opts;
  const overlay = document.getElementById('modal-confirm');
  const okBtn = document.getElementById('btn-confirm-ok');

  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  okBtn.textContent = okLabel;
  okBtn.className = danger ? 'btn-danger' : 'btn-primary';

  const handle = show(overlay, { backdrop: true, escape: true });
  if (!handle) return;

  const _ok = () => {
    handle.hide();
    haptic.heavy();
    onConfirm();
  };

  const _cancel = () => {
    handle.hide();
  };

  const _onEnter = (e) => {
    if (e.key === 'Enter') _ok();
  };

  okBtn.addEventListener('click', _ok);
  document.getElementById('btn-confirm-cancel').addEventListener('click', _cancel);
  document.addEventListener('keydown', _onEnter);

  // Extend cleanup to remove confirm-specific listeners
  const origCleanup = handle.cleanup;
  handle.cleanup = () => {
    okBtn.removeEventListener('click', _ok);
    document.getElementById('btn-confirm-cancel').removeEventListener('click', _cancel);
    document.removeEventListener('keydown', _onEnter);
    origCleanup();
  };
}

// ─── Create (dynamic modals) ────────────────────────────────

/**
 * Create and show a dynamic modal overlay.
 * Returns a handle with { hide(), overlay }.
 *
 * @param {Object} opts
 * @param {string} opts.id - overlay element ID (for cleanup)
 * @param {string} opts.content - inner HTML for the modal card
 * @param {string} [opts.cls] - additional CSS class for the card
 * @param {boolean} [opts.backdrop=true]
 * @param {boolean} [opts.escape=true]
 * @param {Function} [opts.onHide]
 * @returns {{ hide: Function, overlay: HTMLElement }}
 */
function create(opts) {
  const { id, content, cls = '', backdrop = true, escape = true, onHide } = opts;

  // Remove any prior instance
  document.getElementById(id)?.remove();

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="modal ${cls}">${content}</div>`;
  document.body.appendChild(overlay);

  // Auto-discover heading for aria-labelledby
  const heading = overlay.querySelector('h2, h3, h4');
  if (heading) {
    if (!heading.id) heading.id = id + '-title';
    overlay.setAttribute('aria-labelledby', heading.id);
  }

  const handle = show(overlay, {
    backdrop,
    escape,
    onHide: () => {
      overlay.remove();
      if (onHide) onHide();
    },
  });

  return handle;
}

// ─── Public API ─────────────────────────────────────────────

export { trapFocus, show, hide, confirm, create };
