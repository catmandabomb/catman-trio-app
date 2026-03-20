/**
 * annotations.js — PDF drawing annotation system
 *
 * Canvas overlay for pen/highlighter/eraser drawing on PDF charts.
 * Supports pressure sensitivity (Apple Pencil, S-Pen), stores strokes
 * as normalized coordinates (0-1) for zoom-independent rendering.
 *
 * Storage: localStorage per page, keyed by songId + userId + pageNum.
 * D1 sync deferred to a future release.
 *
 * @module annotations
 */

import * as Auth from '../auth.js?v=20.31';

// ─── Constants ───────────────────────────────────────────────
const MAX_ANNOTATION_SIZE = 800 * 1024; // 800KB per song per user
const COLORS = ['#ff4444', '#4488ff', '#44cc66', '#ffdd44', '#ffffff'];
const PEN_SIZES = [2, 4, 8];
const HIGHLIGHTER_WIDTH = 20;
const HIGHLIGHTER_OPACITY = 0.4;

// ─── Module state ────────────────────────────────────────────
let _drawingMode = false;
let _activeTool = 'pen';     // 'pen' | 'highlighter' | 'eraser'
let _activeColor = COLORS[0];
let _activeSizeIdx = 1;      // index into PEN_SIZES
let _currentStroke = null;
let _paletteVisible = false;

// Context tracking
let _songId = null;
let _pageNum = 1;
let _totalPages = 1;
let _strokes = [];            // strokes for current page
let _overlayCanvas = null;
let _overlayCtx = null;
let _containerEl = null;
let _pdfCanvas = null;

// Undo stack: track stroke indices added in this session
let _undoStack = [];

// ─── Storage helpers ─────────────────────────────────────────

function _storageKey(songId, pageNum) {
  const user = Auth.getUser();
  const userId = user ? user.id : 'anon';
  return `ct_annotations_${songId}_${userId}_p${pageNum}`;
}

function _loadStrokes(songId, pageNum) {
  try {
    const raw = localStorage.getItem(_storageKey(songId, pageNum));
    if (!raw) return [];
    const data = JSON.parse(raw);
    return data.strokes || [];
  } catch (_) {
    return [];
  }
}

function _saveStrokes(songId, pageNum, strokes) {
  try {
    const data = {
      songId,
      userId: Auth.getUser()?.id || 'anon',
      pageNum,
      strokes,
      updatedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(data);

    // Size check: estimate total across all pages for this song
    let totalSize = json.length;
    const user = Auth.getUser();
    const userId = user ? user.id : 'anon';
    for (let p = 1; p <= _totalPages; p++) {
      if (p === pageNum) continue;
      const key = `ct_annotations_${songId}_${userId}_p${p}`;
      const existing = localStorage.getItem(key);
      if (existing) totalSize += existing.length;
    }

    if (totalSize > MAX_ANNOTATION_SIZE) {
      console.warn('Annotation size limit reached:', totalSize, 'bytes');
      return false;
    }
    localStorage.setItem(_storageKey(songId, pageNum), json);
    return true;
  } catch (e) {
    console.warn('Failed to save annotations:', e);
    return false;
  }
}

// ─── Overlay canvas management ───────────────────────────────

/**
 * Create or resize the annotation overlay canvas to match a PDF canvas.
 * @param {HTMLCanvasElement} pdfCanvas - The PDF canvas to overlay
 * @param {HTMLElement} containerEl - The container holding the PDF canvas
 * @returns {HTMLCanvasElement} The overlay canvas
 */
function _ensureOverlay(pdfCanvas, containerEl) {
  if (!pdfCanvas || !containerEl) return null;

  let overlay = containerEl.querySelector('.annotation-overlay');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.className = 'annotation-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    // Insert after the PDF canvas
    pdfCanvas.parentNode.insertBefore(overlay, pdfCanvas.nextSibling);
  }

  // Match the PDF canvas display dimensions
  const displayW = parseFloat(pdfCanvas.style.width) || pdfCanvas.clientWidth;
  const displayH = parseFloat(pdfCanvas.style.height) || pdfCanvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  overlay.style.width = displayW + 'px';
  overlay.style.height = displayH + 'px';
  overlay.width = Math.round(displayW * dpr);
  overlay.height = Math.round(displayH * dpr);

  // Position overlay exactly on top of PDF canvas
  overlay.style.position = 'absolute';
  overlay.style.left = pdfCanvas.offsetLeft + 'px';
  overlay.style.top = pdfCanvas.offsetTop + 'px';
  overlay.style.pointerEvents = _drawingMode ? 'auto' : 'none';
  overlay.style.touchAction = _drawingMode ? 'none' : 'auto';
  overlay.style.zIndex = '10';

  return overlay;
}

/**
 * Redraw all strokes for the current page onto the overlay canvas.
 */
function _redrawOverlay() {
  if (!_overlayCanvas || !_overlayCtx) return;
  const w = _overlayCanvas.width;
  const h = _overlayCanvas.height;
  _overlayCtx.clearRect(0, 0, w, h);

  for (const stroke of _strokes) {
    _drawStroke(_overlayCtx, stroke, w, h);
  }
}

/**
 * Draw a single stroke onto a canvas context.
 */
function _drawStroke(ctx, stroke, canvasW, canvasH) {
  if (!stroke.points || stroke.points.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = stroke.opacity ?? 1;

  if (stroke.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'multiply';
  }

  ctx.strokeStyle = stroke.color;

  // Draw with variable width based on pressure
  ctx.beginPath();
  const pts = stroke.points;
  const baseWidth = stroke.width;

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const x = pt.x * canvasW;
    const y = pt.y * canvasH;
    const pressure = pt.pressure ?? 0.5;
    const w = baseWidth * (0.5 + pressure);

    if (i === 0) {
      ctx.moveTo(x, y);
      ctx.lineWidth = w * (window.devicePixelRatio || 1);
    } else {
      // For smoother lines, use quadratic curve through midpoints
      if (i < pts.length - 1) {
        const nextPt = pts[i + 1];
        const mx = ((pt.x + nextPt.x) / 2) * canvasW;
        const my = ((pt.y + nextPt.y) / 2) * canvasH;
        ctx.quadraticCurveTo(x, y, mx, my);
      } else {
        ctx.lineTo(x, y);
      }
      ctx.lineWidth = w * (window.devicePixelRatio || 1);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// ─── Pointer event handlers ──────────────────────────────────

function _getPointerPos(e) {
  if (!_overlayCanvas) return null;
  const rect = _overlayCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
    pressure: e.pressure ?? 0.5,
  };
}

function _onPointerDown(e) {
  if (!_drawingMode || !_overlayCanvas) return;

  // Only handle primary pointer (finger, pen, left mouse button)
  if (e.button !== 0 && e.button !== undefined) return;

  e.preventDefault();
  e.stopPropagation();

  const pos = _getPointerPos(e);
  if (!pos) return;

  if (_activeTool === 'eraser') {
    _eraseAtPoint(pos);
    // Capture for continued erasing on move
    _overlayCanvas.setPointerCapture(e.pointerId);
    _currentStroke = { erasing: true };
    return;
  }

  _overlayCanvas.setPointerCapture(e.pointerId);

  const width = _activeTool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_SIZES[_activeSizeIdx];
  const opacity = _activeTool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1;

  _currentStroke = {
    points: [pos],
    color: _activeColor,
    width,
    opacity,
    tool: _activeTool,
  };
}

function _onPointerMove(e) {
  if (!_currentStroke || !_drawingMode) return;
  e.preventDefault();
  e.stopPropagation();

  const pos = _getPointerPos(e);
  if (!pos) return;

  if (_currentStroke.erasing) {
    _eraseAtPoint(pos);
    return;
  }

  _currentStroke.points.push(pos);

  // Live preview: draw the current in-progress stroke
  _redrawOverlay();
  if (_overlayCtx) {
    _drawStroke(_overlayCtx, _currentStroke, _overlayCanvas.width, _overlayCanvas.height);
  }
}

function _onPointerUp(e) {
  if (!_currentStroke) return;
  e.preventDefault();
  e.stopPropagation();

  if (_currentStroke.erasing) {
    _currentStroke = null;
    return;
  }

  // Only save strokes with at least 2 points
  if (_currentStroke.points.length >= 2) {
    _strokes.push(_currentStroke);
    _undoStack.push(_strokes.length - 1);
    _saveStrokes(_songId, _pageNum, _strokes);
  }
  _currentStroke = null;
  _redrawOverlay();
}

function _onPointerCancel(e) {
  _currentStroke = null;
  _redrawOverlay();
}

/**
 * Erase any stroke that passes near the given point.
 */
function _eraseAtPoint(pos) {
  const threshold = 0.03; // 3% of canvas dimension
  let erased = false;
  for (let i = _strokes.length - 1; i >= 0; i--) {
    const stroke = _strokes[i];
    for (const pt of stroke.points) {
      const dx = pt.x - pos.x;
      const dy = pt.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        _strokes.splice(i, 1);
        erased = true;
        break;
      }
    }
  }
  if (erased) {
    _saveStrokes(_songId, _pageNum, _strokes);
    _redrawOverlay();
  }
}

// ─── Attach / Detach to a canvas ─────────────────────────────

/**
 * Attach the annotation overlay to a PDF canvas within its container.
 * Call this after a PDF page is rendered.
 *
 * @param {HTMLCanvasElement} pdfCanvas
 * @param {HTMLElement} containerEl
 * @param {Object} opts
 * @param {string} opts.songId
 * @param {number} opts.pageNum - 1-based
 * @param {number} opts.totalPages
 */
function attach(pdfCanvas, containerEl, opts = {}) {
  if (!pdfCanvas || !containerEl) return;
  if (!Auth.isLoggedIn()) return; // annotations require login

  // Check if drawing overlay is enabled
  const showDrawings = localStorage.getItem('ct_pref_show_drawings');
  if (showDrawings === '0') return;

  _pdfCanvas = pdfCanvas;
  _containerEl = containerEl;
  _songId = opts.songId || null;
  _pageNum = opts.pageNum || 1;
  _totalPages = opts.totalPages || 1;

  // Load strokes for this page
  _strokes = _songId ? _loadStrokes(_songId, _pageNum) : [];
  _undoStack = [];

  // Create/resize overlay
  _overlayCanvas = _ensureOverlay(pdfCanvas, containerEl);
  if (!_overlayCanvas) return;
  _overlayCtx = _overlayCanvas.getContext('2d');

  // Detach old listeners (if re-attaching)
  _detachPointerListeners();
  _attachPointerListeners();

  // Draw existing strokes
  _redrawOverlay();
}

function _attachPointerListeners() {
  if (!_overlayCanvas) return;
  _overlayCanvas.addEventListener('pointerdown', _onPointerDown, { passive: false });
  _overlayCanvas.addEventListener('pointermove', _onPointerMove, { passive: false });
  _overlayCanvas.addEventListener('pointerup', _onPointerUp, { passive: false });
  _overlayCanvas.addEventListener('pointercancel', _onPointerCancel);
}

function _detachPointerListeners() {
  if (!_overlayCanvas) return;
  _overlayCanvas.removeEventListener('pointerdown', _onPointerDown);
  _overlayCanvas.removeEventListener('pointermove', _onPointerMove);
  _overlayCanvas.removeEventListener('pointerup', _onPointerUp);
  _overlayCanvas.removeEventListener('pointercancel', _onPointerCancel);
}

/**
 * Detach the annotation overlay completely.
 */
function detach() {
  _detachPointerListeners();
  if (_overlayCanvas && _overlayCanvas.parentNode) {
    _overlayCanvas.parentNode.removeChild(_overlayCanvas);
  }
  _overlayCanvas = null;
  _overlayCtx = null;
  _currentStroke = null;
  _strokes = [];
  _undoStack = [];
  _drawingMode = false;
  _paletteVisible = false;
  hidePalette();
}

/**
 * Resize the overlay to match current PDF canvas dimensions.
 * Call after zoom or orientation change.
 */
function resizeOverlay() {
  if (!_overlayCanvas || !_pdfCanvas) return;
  _overlayCanvas = _ensureOverlay(_pdfCanvas, _containerEl);
  if (_overlayCanvas) {
    _overlayCtx = _overlayCanvas.getContext('2d');
    _redrawOverlay();
  }
}

// ─── Drawing mode toggle ─────────────────────────────────────

function isDrawingMode() {
  return _drawingMode;
}

function toggleDrawingMode() {
  _drawingMode = !_drawingMode;
  if (_overlayCanvas) {
    _overlayCanvas.style.pointerEvents = _drawingMode ? 'auto' : 'none';
    _overlayCanvas.style.touchAction = _drawingMode ? 'none' : 'auto';
    _overlayCanvas.style.cursor = _drawingMode ? 'crosshair' : 'default';
  }
  if (!_drawingMode) {
    hidePalette();
  }
  return _drawingMode;
}

function setDrawingMode(on) {
  _drawingMode = !!on;
  if (_overlayCanvas) {
    _overlayCanvas.style.pointerEvents = _drawingMode ? 'auto' : 'none';
    _overlayCanvas.style.touchAction = _drawingMode ? 'none' : 'auto';
    _overlayCanvas.style.cursor = _drawingMode ? 'crosshair' : 'default';
  }
  if (!_drawingMode) {
    hidePalette();
  }
}

// ─── Tool palette ────────────────────────────────────────────

function isPaletteVisible() {
  return _paletteVisible;
}

/**
 * Show the floating annotation palette.
 * @param {HTMLElement} anchorEl - Element to position the palette relative to
 */
function showPalette(anchorEl) {
  _paletteVisible = true;
  let palette = document.getElementById('annotation-palette');
  if (!palette) {
    palette = _createPaletteEl();
    document.body.appendChild(palette);
  }
  _updatePaletteState(palette);
  palette.classList.remove('hidden');

  // Position near the anchor button
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const paletteW = 200;
    // Position above the button, aligned right
    palette.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    palette.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    palette.style.left = 'auto';
    palette.style.top = 'auto';
  }
}

function hidePalette() {
  _paletteVisible = false;
  const palette = document.getElementById('annotation-palette');
  if (palette) palette.classList.add('hidden');
}

function togglePalette(anchorEl) {
  if (_paletteVisible) {
    hidePalette();
  } else {
    showPalette(anchorEl);
  }
}

function _createPaletteEl() {
  const el = document.createElement('div');
  el.id = 'annotation-palette';
  el.className = 'annotation-palette hidden';

  el.innerHTML = `
    <div class="annot-tools">
      <button class="annot-tool-btn" data-tool="pen" title="Pen" aria-label="Pen">
        <i data-lucide="pen-line" style="width:16px;height:16px;"></i>
      </button>
      <button class="annot-tool-btn" data-tool="highlighter" title="Highlighter" aria-label="Highlighter">
        <i data-lucide="highlighter" style="width:16px;height:16px;"></i>
      </button>
      <button class="annot-tool-btn" data-tool="eraser" title="Eraser" aria-label="Eraser">
        <i data-lucide="eraser" style="width:16px;height:16px;"></i>
      </button>
      <div class="annot-divider"></div>
      <button class="annot-tool-btn annot-undo-btn" title="Undo" aria-label="Undo">
        <i data-lucide="undo-2" style="width:16px;height:16px;"></i>
      </button>
    </div>
    <div class="annot-sizes">
      <button class="annot-size-btn" data-size="0" title="Thin" aria-label="Thin"><span class="annot-size-dot annot-size-sm"></span></button>
      <button class="annot-size-btn" data-size="1" title="Medium" aria-label="Medium"><span class="annot-size-dot annot-size-md"></span></button>
      <button class="annot-size-btn" data-size="2" title="Thick" aria-label="Thick"><span class="annot-size-dot annot-size-lg"></span></button>
    </div>
    <div class="annot-colors">
      ${COLORS.map((c, i) => `<button class="annot-color-btn" data-color="${c}" title="${['Red','Blue','Green','Yellow','White'][i]}" aria-label="${['Red','Blue','Green','Yellow','White'][i]}" style="background:${c};"></button>`).join('')}
    </div>
  `;

  // Wire events
  el.querySelectorAll('.annot-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _activeTool = btn.dataset.tool;
      _updatePaletteState(el);
    });
  });

  el.querySelector('.annot-undo-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    undo();
  });

  el.querySelectorAll('.annot-size-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _activeSizeIdx = parseInt(btn.dataset.size, 10);
      _updatePaletteState(el);
    });
  });

  el.querySelectorAll('.annot-color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _activeColor = btn.dataset.color;
      _updatePaletteState(el);
    });
  });

  // Prevent palette clicks from bubbling to backdrop dismissers
  el.addEventListener('click', (e) => e.stopPropagation());
  el.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });

  return el;
}

function _updatePaletteState(palette) {
  if (!palette) return;

  // Tool selection
  palette.querySelectorAll('.annot-tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('annot-active', btn.dataset.tool === _activeTool);
  });

  // Size selection (hide for highlighter/eraser)
  const sizesRow = palette.querySelector('.annot-sizes');
  if (sizesRow) {
    sizesRow.style.display = _activeTool === 'pen' ? '' : 'none';
  }
  palette.querySelectorAll('.annot-size-btn').forEach(btn => {
    btn.classList.toggle('annot-active', parseInt(btn.dataset.size, 10) === _activeSizeIdx);
  });

  // Color selection (hide for eraser)
  const colorsRow = palette.querySelector('.annot-colors');
  if (colorsRow) {
    colorsRow.style.display = _activeTool === 'eraser' ? 'none' : '';
  }
  palette.querySelectorAll('.annot-color-btn').forEach(btn => {
    btn.classList.toggle('annot-active', btn.dataset.color === _activeColor);
  });
}

// ─── Undo ────────────────────────────────────────────────────

function undo() {
  if (_strokes.length === 0) return;
  _strokes.pop();
  _saveStrokes(_songId, _pageNum, _strokes);
  _redrawOverlay();
}

// ─── Page change helper ──────────────────────────────────────

/**
 * Switch to a different page. Saves current, loads new.
 * @param {number} newPageNum - 1-based
 * @param {HTMLCanvasElement} pdfCanvas - Updated PDF canvas reference
 */
function switchPage(newPageNum, pdfCanvas) {
  if (!_songId) return;

  // Save current strokes (already saved on each stroke end, but just in case)
  _saveStrokes(_songId, _pageNum, _strokes);

  _pageNum = newPageNum;
  _pdfCanvas = pdfCanvas || _pdfCanvas;

  // Load strokes for new page
  _strokes = _loadStrokes(_songId, _pageNum);
  _undoStack = [];

  // Resize and redraw
  if (_pdfCanvas && _containerEl) {
    _overlayCanvas = _ensureOverlay(_pdfCanvas, _containerEl);
    if (_overlayCanvas) {
      _overlayCtx = _overlayCanvas.getContext('2d');
      _redrawOverlay();
    }
  }
}

// ─── Text notes overlay ──────────────────────────────────────

/**
 * Show a text notes overlay on the PDF container.
 * @param {HTMLElement} containerEl
 * @param {string} notes - The song's notes text
 */
function showTextOverlay(containerEl, notes) {
  if (!containerEl || !notes) return;
  const showText = localStorage.getItem('ct_pref_show_text_overlay');
  if (showText === '0') return;

  hideTextOverlay(containerEl);

  const overlay = document.createElement('div');
  overlay.className = 'annotation-text-overlay';
  overlay.innerHTML = `
    <div class="annot-text-content">${_escHtml(notes)}</div>
    <button class="annot-text-dismiss" aria-label="Dismiss notes">&times;</button>
  `;
  overlay.querySelector('.annot-text-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
  });
  containerEl.appendChild(overlay);
}

function hideTextOverlay(containerEl) {
  if (!containerEl) return;
  const existing = containerEl.querySelector('.annotation-text-overlay');
  if (existing) existing.remove();
}

function _escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

// ─── Live Mode support ───────────────────────────────────────

/**
 * Attach annotation overlay to a live mode slide canvas.
 * Lighter weight — no palette, just renders existing strokes.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} chartArea
 * @param {string} songId
 * @param {number} pageNum
 */
function attachLiveMode(canvas, chartArea, songId, pageNum) {
  if (!canvas || !chartArea) return;
  if (!Auth.isLoggedIn()) return;
  const showDrawings = localStorage.getItem('ct_pref_show_drawings');
  if (showDrawings === '0') return;

  const strokes = _loadStrokes(songId, pageNum);
  if (strokes.length === 0) return;

  let overlay = chartArea.querySelector('.annotation-overlay-lm');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.className = 'annotation-overlay-lm';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.pointerEvents = 'none';
    overlay.style.position = 'absolute';
    overlay.style.zIndex = '10';
    chartArea.appendChild(overlay);
  }

  const displayW = parseFloat(canvas.style.width) || canvas.clientWidth;
  const displayH = parseFloat(canvas.style.height) || canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  overlay.style.width = displayW + 'px';
  overlay.style.height = displayH + 'px';
  overlay.style.left = canvas.offsetLeft + 'px';
  overlay.style.top = canvas.offsetTop + 'px';
  overlay.width = Math.round(displayW * dpr);
  overlay.height = Math.round(displayH * dpr);

  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  for (const stroke of strokes) {
    _drawStroke(ctx, stroke, overlay.width, overlay.height);
  }
}

// ─── Public API ──────────────────────────────────────────────

export {
  attach,
  detach,
  resizeOverlay,
  switchPage,
  isDrawingMode,
  toggleDrawingMode,
  setDrawingMode,
  isPaletteVisible,
  showPalette,
  hidePalette,
  togglePalette,
  undo,
  showTextOverlay,
  hideTextOverlay,
  attachLiveMode,
};
