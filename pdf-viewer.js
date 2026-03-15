/**
 * pdf-viewer.js — PDF.js-powered inline PDF viewer with zoom & pan
 *
 * Features:
 * - Pinch-to-zoom on touch devices (iPad-friendly)
 * - Mouse wheel zoom on desktop
 * - +/- zoom buttons & reset
 * - Double-tap to toggle fit/2x zoom
 * - Pan via drag when zoomed in
 * - Multi-page navigation
 * - Pre-fetchable: accepts blob URLs cached by caller
 */

const PDFViewer = (() => {

  // PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  let _pdfDoc     = null;
  let _pageNum    = 1;
  let _rendering  = false;
  let _blobUrl    = null;
  let _ownsBlobUrl = false;

  // Zoom/pan state
  let _zoom       = 1;
  let _panX       = 0;
  let _panY       = 0;
  let _fitScale   = 1;  // the scale that makes PDF fit container width
  const MIN_ZOOM  = 0.5;
  const MAX_ZOOM  = 5;

  // Touch tracking
  let _pinchStartDist = 0;
  let _pinchStartZoom = 1;
  let _isPinching     = false;
  let _dragStartX     = 0;
  let _dragStartY     = 0;
  let _dragStartPanX  = 0;
  let _dragStartPanY  = 0;
  let _isDragging     = false;
  let _lastTap        = 0;

  const modal     = () => document.getElementById('modal-pdf');
  const canvasEl  = () => document.getElementById('pdf-canvas');
  const container = () => document.getElementById('pdf-canvas-container');
  const pageInfo  = () => document.getElementById('pdf-page-info');
  const fileLabel = () => document.getElementById('pdf-filename');
  const zoomLabel = () => document.getElementById('pdf-zoom-level');

  function _updateNav() {
    document.getElementById('pdf-prev').disabled = _pageNum <= 1;
    document.getElementById('pdf-next').disabled = !_pdfDoc || _pageNum >= _pdfDoc.numPages;
    pageInfo().textContent = _pdfDoc ? `${_pageNum} / ${_pdfDoc.numPages}` : '1 / 1';
  }

  function _applyTransform() {
    const cvs = canvasEl();
    cvs.style.transform = `translate(${_panX}px, ${_panY}px) scale(${_zoom})`;
    cvs.style.transformOrigin = '0 0';
    const lbl = zoomLabel();
    if (lbl) lbl.textContent = Math.round(_zoom * 100) + '%';
    // Toggle cursor class
    const ctr = container();
    if (ctr) ctr.classList.toggle('zoomed', _zoom > 1.05);
  }

  function _clampPan() {
    const cvs = canvasEl();
    const ctr = container();
    if (!cvs || !ctr) return;

    const cw = parseFloat(cvs.style.width) || cvs.width;
    const ch = parseFloat(cvs.style.height) || cvs.height;
    const scaledW = cw * _zoom;
    const scaledH = ch * _zoom;
    const boxW = ctr.clientWidth;
    const boxH = ctr.clientHeight;

    if (scaledW <= boxW) {
      // Center horizontally when smaller than container
      _panX = (boxW - scaledW) / 2;
    } else {
      _panX = Math.min(0, Math.max(boxW - scaledW, _panX));
    }

    if (scaledH <= boxH) {
      _panY = (boxH - scaledH) / 2;
    } else {
      _panY = Math.min(0, Math.max(boxH - scaledH, _panY));
    }
  }

  function _setZoom(newZoom, originX, originY) {
    const old = _zoom;
    _zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));

    if (originX !== undefined && originY !== undefined) {
      // Zoom toward the point (originX, originY) in container coords
      const ratio = _zoom / old;
      _panX = originX - ratio * (originX - _panX);
      _panY = originY - ratio * (originY - _panY);
    }

    _clampPan();
    _applyTransform();
  }

  function _resetZoom() {
    _zoom = 1;
    _panX = 0;
    _panY = 0;
    _clampPan();
    _applyTransform();
  }

  async function _renderPage(num) {
    if (!_pdfDoc || _rendering) return;
    _rendering = true;
    try {
      const page = await _pdfDoc.getPage(num);
      const ctr = container();
      const containerWidth = ctr.clientWidth;

      const viewport = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;

      // Scale to fit container width
      _fitScale = containerWidth / viewport.width;
      const renderScale = Math.min(_fitScale * 2, 4); // render at 2x fit for crisp zoom
      const scaled = page.getViewport({ scale: renderScale });
      const cvs = canvasEl();
      cvs.width  = scaled.width;
      cvs.height = scaled.height;

      // Display size = fit scale (1x zoom fills width)
      const displayW = viewport.width * _fitScale;
      const displayH = viewport.height * _fitScale;
      cvs.style.width  = displayW + 'px';
      cvs.style.height = displayH + 'px';

      const ctx = cvs.getContext('2d');
      await page.render({
        canvasContext: ctx,
        viewport: scaled,
      }).promise;

      // Reset zoom/pan for new page
      _zoom = 1;
      _panX = 0;
      _panY = 0;
      _clampPan();
      _applyTransform();
      _updateNav();
    } catch (e) {
      console.error('PDF render error', e);
    } finally {
      _rendering = false;
    }
  }

  /**
   * Open the PDF viewer with a given blob URL or data URL.
   * @param {string} url     — blob URL or remote URL
   * @param {string} name    — display filename
   */
  async function open(url, name, opts) {
    _pdfDoc   = null;
    _pageNum  = 1;
    _blobUrl  = url;
    _ownsBlobUrl = opts?.ownsBlobUrl || false; // only revoke if we own it
    _zoom     = 1;
    _panX     = 0;
    _panY     = 0;

    fileLabel().textContent = name || 'Chart';
    modal().classList.remove('hidden');

    try {
      _pdfDoc = await pdfjsLib.getDocument(url).promise;
      _updateNav();
      await _renderPage(1);
    } catch (e) {
      console.error('PDF load error', e);
      App.showToast('Failed to load PDF.');
      close();
    }
  }

  function close() {
    modal().classList.add('hidden');
    if (_blobUrl && _ownsBlobUrl) { try { URL.revokeObjectURL(_blobUrl); } catch(_){} }
    _blobUrl = null;
    _ownsBlobUrl = false;
    _pdfDoc    = null;
    _pageNum   = 1;
    _rendering = false;
    _zoom = 1; _panX = 0; _panY = 0;
    const cvs = canvasEl();
    cvs.style.transform = '';
    cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
  }

  function prevPage() {
    if (_pageNum <= 1) return;
    _pageNum--;
    _renderPage(_pageNum);
  }

  function nextPage() {
    if (!_pdfDoc || _pageNum >= _pdfDoc.numPages) return;
    _pageNum++;
    _renderPage(_pageNum);
  }

  function zoomIn()  { _setZoom(_zoom * 1.25); }
  function zoomOut() { _setZoom(_zoom / 1.25); }

  // ─── Touch handlers ──────────────────────────────────────

  function _getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _onTouchStart(e) {
    if (e.touches.length === 2) {
      // Pinch start
      e.preventDefault();
      _isPinching = true;
      _isDragging = false;
      _pinchStartDist = _getTouchDist(e.touches[0], e.touches[1]);
      _pinchStartZoom = _zoom;
    } else if (e.touches.length === 1 && _zoom > 1.05) {
      // Pan start (only when zoomed in)
      _isDragging = true;
      _dragStartX = e.touches[0].clientX;
      _dragStartY = e.touches[0].clientY;
      _dragStartPanX = _panX;
      _dragStartPanY = _panY;
    }

    // Double-tap detection
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - _lastTap < 300) {
        e.preventDefault();
        // Toggle between fit and 2x
        if (_zoom > 1.05) {
          _resetZoom();
        } else {
          const rect = container().getBoundingClientRect();
          const ox = e.touches[0].clientX - rect.left;
          const oy = e.touches[0].clientY - rect.top;
          _setZoom(2, ox, oy);
        }
        _lastTap = 0;
      } else {
        _lastTap = now;
      }
    }
  }

  function _onTouchMove(e) {
    if (_isPinching && e.touches.length === 2) {
      e.preventDefault();
      const dist = _getTouchDist(e.touches[0], e.touches[1]);
      const newZoom = _pinchStartZoom * (dist / _pinchStartDist);
      const rect = container().getBoundingClientRect();
      const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
      const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
      _setZoom(newZoom, cx, cy);
    } else if (_isDragging && e.touches.length === 1) {
      e.preventDefault();
      _panX = _dragStartPanX + (e.touches[0].clientX - _dragStartX);
      _panY = _dragStartPanY + (e.touches[0].clientY - _dragStartY);
      _clampPan();
      _applyTransform();
    }
  }

  function _onTouchEnd(e) {
    if (e.touches.length < 2) _isPinching = false;
    if (e.touches.length === 0) _isDragging = false;
  }

  // ─── Mouse wheel zoom (desktop) ──────────────────────────

  function _onWheel(e) {
    e.preventDefault();
    const rect = container().getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    _setZoom(_zoom * delta, ox, oy);
  }

  // ─── Mouse drag (desktop) ────────────────────────────────

  let _mouseDown = false;
  function _onMouseDown(e) {
    if (_zoom <= 1.05) return;
    _mouseDown = true;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _dragStartPanX = _panX;
    _dragStartPanY = _panY;
    e.preventDefault();
  }

  function _onMouseMove(e) {
    if (!_mouseDown) return;
    _panX = _dragStartPanX + (e.clientX - _dragStartX);
    _panY = _dragStartPanY + (e.clientY - _dragStartY);
    _clampPan();
    _applyTransform();
  }

  function _onMouseUp() {
    _mouseDown = false;
  }

  // ─── Wire up controls ────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pdf-close').addEventListener('click', close);
    document.getElementById('pdf-prev').addEventListener('click', prevPage);
    document.getElementById('pdf-next').addEventListener('click', nextPage);

    const zoomInBtn  = document.getElementById('pdf-zoom-in');
    const zoomOutBtn = document.getElementById('pdf-zoom-out');
    const resetBtn   = document.getElementById('pdf-zoom-reset');
    if (zoomInBtn)  zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
    if (resetBtn)   resetBtn.addEventListener('click', _resetZoom);

    // Close on backdrop click
    modal().addEventListener('click', (e) => {
      if (e.target === modal()) close();
    });

    // Touch events on canvas container
    const ctr = container();
    ctr.addEventListener('touchstart', _onTouchStart, { passive: false });
    ctr.addEventListener('touchmove', _onTouchMove, { passive: false });
    ctr.addEventListener('touchend', _onTouchEnd, { passive: true });

    // Mouse events for desktop zoom/pan
    ctr.addEventListener('wheel', _onWheel, { passive: false });
    ctr.addEventListener('mousedown', _onMouseDown);
    window.addEventListener('mousemove', _onMouseMove);
    window.addEventListener('mouseup', _onMouseUp);

    // Keyboard shortcuts when modal is open
    document.addEventListener('keydown', (e) => {
      if (modal().classList.contains('hidden')) return;
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { prevPage(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { nextPage(); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') { zoomIn(); e.preventDefault(); }
      if (e.key === '-') { zoomOut(); e.preventDefault(); }
      if (e.key === '0') { _resetZoom(); e.preventDefault(); }
    });
  });

  return { open, close, prevPage, nextPage, zoomIn, zoomOut };

})();
