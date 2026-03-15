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
 *
 * Public API for live mode reuse:
 * - renderToCanvas(pdfDoc, pageNum, canvas, containerEl) — render a page to any canvas
 * - attachZoomPan(canvas, containerEl) — attach zoom/pan handlers, returns { destroy, resetZoom, getZoom }
 */

const PDFViewer = (() => {

  // PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5;

  // ─── Modal viewer state ─────────────────────────────────
  let _pdfDoc      = null;
  let _pageNum     = 1;
  let _rendering   = false;
  let _pendingPage = null;
  let _blobUrl     = null;
  let _ownsBlobUrl = false;
  let _zpHandle    = null;  // zoom/pan handle for modal

  const modal     = () => document.getElementById('modal-pdf');
  const canvasEl  = () => document.getElementById('pdf-canvas');
  const container = () => document.getElementById('pdf-canvas-container');
  const pageInfo  = () => document.getElementById('pdf-page-info');
  const fileLabel = () => document.getElementById('pdf-filename');
  const zoomLabel = () => document.getElementById('pdf-zoom-level');

  function _updateNav() {
    const prev = document.getElementById('pdf-prev');
    const next = document.getElementById('pdf-next');
    if (prev) prev.disabled = _pageNum <= 1;
    if (next) next.disabled = !_pdfDoc || _pageNum >= _pdfDoc.numPages;
    const pi = pageInfo();
    if (pi) pi.textContent = _pdfDoc ? `${_pageNum} / ${_pdfDoc.numPages}` : '1 / 1';
  }

  // ─── Reusable: render a PDF page to any canvas ──────────

  /**
   * Render a single PDF page onto a canvas, fit-to-width of containerEl.
   * @param {PDFDocumentProxy} pdfDoc
   * @param {number} pageNum — 1-based
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} containerEl
   * @returns {Promise<void>}
   */
  async function renderToCanvas(pdfDoc, pageNum, canvas, containerEl) {
    const page = await pdfDoc.getPage(pageNum);
    const containerWidth = containerEl.clientWidth;
    if (containerWidth <= 0) return; // container not laid out yet

    const viewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / viewport.width;
    const renderScale = Math.min(fitScale * 2, 4); // render at 2x fit for crisp zoom
    const scaled = page.getViewport({ scale: renderScale });

    canvas.width  = scaled.width;
    canvas.height = scaled.height;

    const displayW = viewport.width * fitScale;
    const displayH = viewport.height * fitScale;
    canvas.style.width  = displayW + 'px';
    canvas.style.height = displayH + 'px';

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  }

  // ─── Reusable: attach zoom/pan handlers to any canvas ───

  /**
   * Attach pinch-zoom, wheel-zoom, drag-pan, and double-tap handlers.
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} containerEl
   * @returns {{ destroy: Function, resetZoom: Function, getZoom: Function }}
   */
  function attachZoomPan(canvas, containerEl, opts) {
    const onZoomChange = opts?.onZoomChange || null;
    let zoom = 1, panX = 0, panY = 0;
    let pinchStartDist = 0, pinchStartZoom = 1;
    let isPinching = false, isDragging = false;
    let dragStartX = 0, dragStartY = 0, dragStartPanX = 0, dragStartPanY = 0;
    let lastTap = 0, lastPinchEnd = 0;
    let mouseDown = false;

    function clampPan() {
      const cw = parseFloat(canvas.style.width) || canvas.width;
      const ch = parseFloat(canvas.style.height) || canvas.height;
      const scaledW = cw * zoom;
      const scaledH = ch * zoom;
      const boxW = containerEl.clientWidth;
      const boxH = containerEl.clientHeight;

      if (scaledW <= boxW) {
        panX = (boxW - scaledW) / 2;
      } else {
        panX = Math.min(0, Math.max(boxW - scaledW, panX));
      }
      if (scaledH <= boxH) {
        panY = (boxH - scaledH) / 2;
      } else {
        panY = Math.min(0, Math.max(boxH - scaledH, panY));
      }
    }

    function applyTransform() {
      canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      canvas.style.transformOrigin = '0 0';
      containerEl.classList.toggle('zoomed', zoom > 1.05);
      if (onZoomChange) onZoomChange(zoom);
    }

    function setZoom(newZoom, originX, originY) {
      const old = zoom;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
      if (originX !== undefined && originY !== undefined) {
        const ratio = zoom / old;
        panX = originX - ratio * (originX - panX);
        panY = originY - ratio * (originY - panY);
      }
      if (isNaN(panX)) panX = 0;
      if (isNaN(panY)) panY = 0;
      clampPan();
      applyTransform();
    }

    function resetZoom() {
      zoom = 1; panX = 0; panY = 0;
      clampPan();
      applyTransform();
    }

    function getTouchDist(t1, t2) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e) {
      if (e.touches.length > 2) { isPinching = false; isDragging = false; return; }
      if (e.touches.length === 2) {
        e.preventDefault();
        isPinching = true;
        isDragging = false;
        pinchStartDist = getTouchDist(e.touches[0], e.touches[1]);
        if (pinchStartDist < 1) { isPinching = false; return; }
        pinchStartZoom = zoom;
      } else if (e.touches.length === 1 && zoom > 1.05) {
        isDragging = true;
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
        dragStartPanX = panX;
        dragStartPanY = panY;
      }
      // Double-tap detection
      if (e.touches.length === 1) {
        if (Date.now() - lastPinchEnd < 400) { lastTap = 0; return; }
        const now = Date.now();
        if (now - lastTap < 300) {
          e.preventDefault();
          if (zoom > 1.05) {
            resetZoom();
          } else {
            const rect = containerEl.getBoundingClientRect();
            setZoom(2, e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
          }
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }
    }

    function onTouchMove(e) {
      if (isPinching && e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches[0], e.touches[1]);
        const newZoom = pinchStartZoom * (dist / pinchStartDist);
        const rect = containerEl.getBoundingClientRect();
        const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
        const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        setZoom(newZoom, cx, cy);
      } else if (isDragging && e.touches.length === 1) {
        e.preventDefault();
        panX = dragStartPanX + (e.touches[0].clientX - dragStartX);
        panY = dragStartPanY + (e.touches[0].clientY - dragStartY);
        clampPan();
        applyTransform();
      }
    }

    function onTouchEnd(e) {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        lastPinchEnd = Date.now();
      }
      if (e.touches.length === 0) isDragging = false;
    }

    function onWheel(e) {
      e.preventDefault();
      const rect = containerEl.getBoundingClientRect();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(zoom * delta, e.clientX - rect.left, e.clientY - rect.top);
    }

    function onMouseDown(e) {
      if (zoom <= 1.05) return;
      mouseDown = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartPanX = panX;
      dragStartPanY = panY;
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!mouseDown) return;
      panX = dragStartPanX + (e.clientX - dragStartX);
      panY = dragStartPanY + (e.clientY - dragStartY);
      clampPan();
      applyTransform();
    }

    function onMouseUp() { mouseDown = false; }
    function onBlur() { mouseDown = false; }

    containerEl.addEventListener('touchstart', onTouchStart, { passive: false });
    containerEl.addEventListener('touchmove', onTouchMove, { passive: false });
    containerEl.addEventListener('touchend', onTouchEnd, { passive: true });
    containerEl.addEventListener('wheel', onWheel, { passive: false });
    containerEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);

    function destroy() {
      containerEl.removeEventListener('touchstart', onTouchStart);
      containerEl.removeEventListener('touchmove', onTouchMove);
      containerEl.removeEventListener('touchend', onTouchEnd);
      containerEl.removeEventListener('wheel', onWheel);
      containerEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    }

    function zoomInFn()  { setZoom(zoom * 1.25); }
    function zoomOutFn() { setZoom(zoom / 1.25); }

    return { destroy, resetZoom, getZoom: () => zoom, zoomIn: zoomInFn, zoomOut: zoomOutFn };
  }

  // ─── Modal-specific render (uses renderToCanvas + pending page) ──

  async function _renderPage(num) {
    if (!_pdfDoc) return;
    if (_rendering) { _pendingPage = num; return; }
    _rendering = true;
    try {
      await renderToCanvas(_pdfDoc, num, canvasEl(), container());
      if (_zpHandle) _zpHandle.resetZoom();
      const lbl = zoomLabel();
      if (lbl) lbl.textContent = '100%';
      _updateNav();
    } catch (e) {
      console.error('PDF render error', e);
    } finally {
      _rendering = false;
      if (_pendingPage !== null) {
        const p = _pendingPage;
        _pendingPage = null;
        _renderPage(p);
      }
    }
  }

  async function open(url, name, opts) {
    _pdfDoc      = null;
    _pageNum     = 1;
    _pendingPage = null;
    _blobUrl     = url;
    _ownsBlobUrl = opts?.ownsBlobUrl || false;

    fileLabel().textContent = name || 'Chart';
    modal().classList.remove('hidden');

    // Attach zoom/pan to modal canvas
    if (_zpHandle) _zpHandle.destroy();
    _zpHandle = attachZoomPan(canvasEl(), container(), {
      onZoomChange: (z) => {
        const lbl = zoomLabel();
        if (lbl) lbl.textContent = Math.round(z * 100) + '%';
      },
    });

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
    _pendingPage = null;
    if (_zpHandle) { _zpHandle.destroy(); _zpHandle = null; }
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

  function zoomIn()  { if (_zpHandle) _zpHandle.zoomIn(); }
  function zoomOut() { if (_zpHandle) _zpHandle.zoomOut(); }

  // ─── Wire up modal controls ─────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pdf-close').addEventListener('click', close);
    document.getElementById('pdf-prev').addEventListener('click', prevPage);
    document.getElementById('pdf-next').addEventListener('click', nextPage);

    const zoomInBtn  = document.getElementById('pdf-zoom-in');
    const zoomOutBtn = document.getElementById('pdf-zoom-out');
    const resetBtn   = document.getElementById('pdf-zoom-reset');
    if (zoomInBtn)  zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
    if (resetBtn)   resetBtn.addEventListener('click', () => { if (_zpHandle) _zpHandle.resetZoom(); });

    // Close on backdrop click
    modal().addEventListener('click', (e) => {
      if (e.target === modal()) close();
    });

    // Keyboard shortcuts when modal is open
    document.addEventListener('keydown', (e) => {
      if (modal().classList.contains('hidden')) return;
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp')  { prevPage(); e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { nextPage(); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') { zoomIn(); e.preventDefault(); }
      if (e.key === '-') { zoomOut(); e.preventDefault(); }
      if (e.key === '0') { if (_zpHandle) _zpHandle.resetZoom(); e.preventDefault(); }
    });
  });

  return { open, close, prevPage, nextPage, zoomIn, zoomOut, renderToCanvas, attachZoomPan };

})();
