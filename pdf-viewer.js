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
 * - Page render cache with LRU eviction (Phase 1)
 * - OffscreenCanvas background rendering when available (Phase 2)
 * - Progressive rendering: fast low-res then sharp high-res on cache miss (Phase 3)
 * - rAF-batched transforms for smooth zoom/pan (Phase 5)
 *
 * Public API for live mode reuse:
 * - renderToCanvas(pdfDoc, pageNum, canvas, containerEl) — render a page to any canvas
 * - renderToCanvasCached(pdfDoc, pageNum, canvas, containerEl) — cached version with pre-rendering
 * - preRenderPage(pdfDoc, pageNum, containerWidth) — pre-render a page to cache
 * - clearRenderCache(pdfId) — clear render cache (all or by pdfDoc)
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

  // ─── Phase 1: Page Render Cache ───────────────────────────
  // Cache stores pre-rendered canvases keyed by `${pdfId}-${pageNum}`
  const _renderCache = new Map(); // key: `${pdfId}-${pageNum}` → { canvas, displayW, displayH }
  const MAX_RENDER_CACHE = 12;

  // Assign stable IDs to pdfDoc objects via WeakMap (they have no built-in ID)
  const _pdfIdMap = new WeakMap();
  let _pdfIdCounter = 0;

  function _getPdfId(pdfDoc) {
    if (!pdfDoc) return null;
    let id = _pdfIdMap.get(pdfDoc);
    if (id === undefined) {
      id = ++_pdfIdCounter;
      _pdfIdMap.set(pdfDoc, id);
    }
    return id;
  }

  // ─── Phase 2: OffscreenCanvas feature detection ───────────
  const _hasOffscreen = typeof OffscreenCanvas !== 'undefined';

  // ─── requestIdleCallback with Safari fallback ─────────────
  const _rIC = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 1);

  // ─── Modal viewer state ─────────────────────────────────
  let _pdfDoc      = null;
  let _pageNum     = 1;
  let _rendering   = false;
  let _pendingPage = null;
  let _blobUrl     = null;
  let _ownsBlobUrl = false;
  let _zpHandle    = null;  // zoom/pan handle for modal
  let _openGen     = 0;     // generation counter for rapid open/close race
  let _focusTrap   = null;  // focus trap handle for modal

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
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return; // null/destroyed guard
    if (!Number.isFinite(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return; // page validation
    const page = await pdfDoc.getPage(pageNum);
    const containerWidth = containerEl.clientWidth;
    if (containerWidth <= 0) return; // container not laid out yet

    const viewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / viewport.width;
    const dpr = window.devicePixelRatio || 1;
    const renderScale = Math.min(fitScale * Math.max(dpr, 2), 6);
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

  // ─── Phase 1: Pre-render a page into the cache ────────────

  /**
   * Pre-render a PDF page to an offscreen canvas and store in _renderCache.
   * Uses OffscreenCanvas when available (Phase 2), regular canvas otherwise.
   * Fire-and-forget by caller — returns a promise.
   *
   * @param {PDFDocumentProxy} pdfDoc
   * @param {number} pageNum — 1-based
   * @param {number} containerWidth — width to fit to
   * @returns {Promise<void>}
   */
  async function preRenderPage(pdfDoc, pageNum, containerWidth) {
    // Guards
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return;
    if (!Number.isFinite(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return;
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) return;

    const pdfId = _getPdfId(pdfDoc);
    const cacheKey = `${pdfId}-${pageNum}`;

    // Compute target dimensions to check if already cached at same size
    let page;
    try {
      page = await pdfDoc.getPage(pageNum);
    } catch (e) {
      // pdfDoc may have been destroyed between call and await
      return;
    }

    const viewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / viewport.width;
    const dpr = window.devicePixelRatio || 1;
    const renderScale = Math.min(fitScale * Math.max(dpr, 2), 6);
    const scaled = page.getViewport({ scale: renderScale });

    const displayW = viewport.width * fitScale;
    const displayH = viewport.height * fitScale;

    // Skip if already cached at same dimensions
    const existing = _renderCache.get(cacheKey);
    if (existing && existing.displayW === displayW && existing.displayH === displayH) {
      return;
    }

    // Create the offscreen canvas — Phase 2: use OffscreenCanvas when available
    let offCanvas;
    let ctx;
    if (_hasOffscreen) {
      offCanvas = new OffscreenCanvas(scaled.width, scaled.height);
      ctx = offCanvas.getContext('2d');
    } else {
      offCanvas = document.createElement('canvas');
      offCanvas.width = scaled.width;
      offCanvas.height = scaled.height;
      ctx = offCanvas.getContext('2d');
    }

    // Render the page
    try {
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    } catch (e) {
      // Render can fail if doc was destroyed — silently bail
      return;
    }

    // LRU eviction: if cache is full, delete the oldest entry (first inserted)
    if (_renderCache.size >= MAX_RENDER_CACHE) {
      const oldestKey = _renderCache.keys().next().value;
      _renderCache.delete(oldestKey);
    }

    // Store in cache (re-insert to maintain insertion order for LRU)
    _renderCache.delete(cacheKey);
    _renderCache.set(cacheKey, { canvas: offCanvas, displayW, displayH });
  }

  // ─── Phase 1 + 2 + 3: Cached render with progressive fallback ─

  /**
   * Render a PDF page to a visible canvas, using the render cache when possible.
   * On cache hit: copies the pre-rendered canvas (sub-millisecond).
   * On cache miss: does progressive rendering (Phase 3) — fast 1x then sharp 2x.
   * After render, schedules pre-render of adjacent pages via requestIdleCallback.
   *
   * @param {PDFDocumentProxy} pdfDoc
   * @param {number} pageNum — 1-based
   * @param {HTMLCanvasElement} canvas — visible on-screen canvas
   * @param {HTMLElement} containerEl
   * @returns {Promise<void>}
   */
  async function renderToCanvasCached(pdfDoc, pageNum, canvas, containerEl) {
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return;
    if (!Number.isFinite(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return;
    const containerWidth = containerEl.clientWidth;
    if (containerWidth <= 0) return;

    const pdfId = _getPdfId(pdfDoc);
    const cacheKey = `${pdfId}-${pageNum}`;
    const cached = _renderCache.get(cacheKey);

    if (cached) {
      // ─── Cache HIT: check dimensions match ───
      // Compute expected display dimensions
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const fitScale = containerWidth / viewport.width;
      const expectedW = viewport.width * fitScale;
      const expectedH = viewport.height * fitScale;

      if (cached.displayW === expectedW && cached.displayH === expectedH) {
        // Dimensions match — blit from cache
        const cachedCanvas = cached.canvas;

        // Set visible canvas dimensions to match the cached render
        canvas.width = cachedCanvas.width;
        canvas.height = cachedCanvas.height;
        canvas.style.width = cached.displayW + 'px';
        canvas.style.height = cached.displayH + 'px';

        // Blit cached canvas — always use drawImage (transferToImageBitmap is destructive
        // and would empty the cached OffscreenCanvas, breaking future cache hits)
        const ctx = canvas.getContext('2d');
        ctx.drawImage(cachedCanvas, 0, 0);

        // Re-insert to refresh LRU position
        _renderCache.delete(cacheKey);
        _renderCache.set(cacheKey, cached);
      } else {
        // Dimensions changed (resize) — fall through to full render
        _renderCache.delete(cacheKey);
        await _renderCacheMiss(pdfDoc, pageNum, canvas, containerEl, containerWidth);
      }
    } else {
      // ─── Cache MISS: progressive rendering (Phase 3) ───
      await _renderCacheMiss(pdfDoc, pageNum, canvas, containerEl, containerWidth);
    }

    // Schedule pre-render of adjacent pages (pageNum ± 1)
    const totalPages = pdfDoc.numPages;
    const docRef = pdfDoc; // capture reference
    const cw = containerWidth;

    _rIC(() => {
      if (pageNum + 1 <= totalPages) {
        preRenderPage(docRef, pageNum + 1, cw).catch(() => {});
      }
    });
    _rIC(() => {
      if (pageNum - 1 >= 1) {
        preRenderPage(docRef, pageNum - 1, cw).catch(() => {});
      }
    });
  }

  /**
   * Internal: handle a cache miss with progressive rendering (Phase 3).
   * 1. Render at 1x fitScale (fast, visible immediately)
   * 2. Then schedule a 2x sharp render via requestIdleCallback
   */
  async function _renderCacheMiss(pdfDoc, pageNum, canvas, containerEl, containerWidth) {
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return;

    let page;
    try {
      page = await pdfDoc.getPage(pageNum);
    } catch (e) {
      return; // doc destroyed
    }

    const viewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / viewport.width;
    const displayW = viewport.width * fitScale;
    const displayH = viewport.height * fitScale;

    // Step 1: Fast 1x render (visible immediately)
    const dpr = window.devicePixelRatio || 1;
    const lowScale = Math.min(fitScale * dpr, 4);
    const lowVP = page.getViewport({ scale: lowScale });

    canvas.width = lowVP.width;
    canvas.height = lowVP.height;
    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';

    const ctx = canvas.getContext('2d');
    try {
      await page.render({ canvasContext: ctx, viewport: lowVP }).promise;
    } catch (e) {
      return; // render failed (doc destroyed, etc.)
    }

    // Step 2: Schedule sharp 2x render in idle time (Phase 3)
    const pdfId = _getPdfId(pdfDoc);
    const cacheKey = `${pdfId}-${pageNum}`;
    const docRef = pdfDoc;

    // Tag canvas with what we just rendered — so idle callback can detect staleness
    canvas.dataset.renderKey = cacheKey;

    _rIC(async () => {
      // Stale canvas guard: if the canvas is now showing a different page, skip the swap
      // (still do the render to populate cache, just don't write to the visible canvas)
      const isStale = canvas.dataset.renderKey !== cacheKey;

      // Re-check that pdfDoc is still valid
      if (!docRef || typeof docRef.getPage !== 'function') return;

      let hiPage;
      try {
        hiPage = await docRef.getPage(pageNum);
      } catch (e) {
        return;
      }

      const hiDpr = window.devicePixelRatio || 1;
      const hiScale = Math.min(fitScale * Math.max(hiDpr, 2), 6);
      const hiVP = hiPage.getViewport({ scale: hiScale });

      // Create offscreen canvas for the high-res render
      let hiCanvas, hiCtx;
      if (_hasOffscreen) {
        hiCanvas = new OffscreenCanvas(hiVP.width, hiVP.height);
        hiCtx = hiCanvas.getContext('2d');
      } else {
        hiCanvas = document.createElement('canvas');
        hiCanvas.width = hiVP.width;
        hiCanvas.height = hiVP.height;
        hiCtx = hiCanvas.getContext('2d');
      }

      try {
        await hiPage.render({ canvasContext: hiCtx, viewport: hiVP }).promise;
      } catch (e) {
        return;
      }

      // Only swap onto visible canvas if it's still showing the same page
      if (!isStale) {
        canvas.width = hiVP.width;
        canvas.height = hiVP.height;
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';

        const swapCtx = canvas.getContext('2d');
        swapCtx.drawImage(hiCanvas, 0, 0);
      }

      // Store the sharp render in cache (with LRU eviction)
      if (_renderCache.size >= MAX_RENDER_CACHE) {
        const oldestKey = _renderCache.keys().next().value;
        _renderCache.delete(oldestKey);
      }
      _renderCache.delete(cacheKey);
      _renderCache.set(cacheKey, { canvas: hiCanvas, displayW, displayH });
    });
  }

  // ─── Phase 1: Clear render cache ──────────────────────────

  /**
   * Clear the render cache.
   * @param {PDFDocumentProxy} [pdfDoc] — if given, only clear entries for that doc.
   *   If omitted, clears the entire cache.
   */
  function clearRenderCache(pdfDoc) {
    if (pdfDoc) {
      const pdfId = _getPdfId(pdfDoc);
      if (pdfId === null) return;
      const prefix = `${pdfId}-`;
      for (const key of [..._renderCache.keys()]) {
        if (key.startsWith(prefix)) {
          _renderCache.delete(key);
        }
      }
    } else {
      _renderCache.clear();
    }
  }

  // ─── Reusable: attach zoom/pan handlers to any canvas ───

  /**
   * Attach pinch-zoom, wheel-zoom, drag-pan, and double-tap handlers.
   * Phase 5: continuous event handlers use rAF batching for smooth transforms.
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

    // Phase 5: rAF batching for continuous transform updates
    let _rafPending = false;
    function scheduleTransform() {
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        applyTransform();
        _rafPending = false;
      });
    }

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

    // setZoom is used by discrete events (buttons, double-tap) — calls applyTransform directly
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
      applyTransform(); // direct — discrete event
    }

    function resetZoom() {
      zoom = 1; panX = 0; panY = 0;
      clampPan();
      applyTransform(); // direct — discrete event
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
            resetZoom(); // discrete — direct applyTransform
          } else {
            const rect = containerEl.getBoundingClientRect();
            setZoom(2, e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top); // discrete
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
        // Pinch zoom: update state and use rAF batching (continuous)
        const old = zoom;
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
        if (cx !== undefined && cy !== undefined) {
          const ratio = zoom / old;
          panX = cx - ratio * (cx - panX);
          panY = cy - ratio * (cy - panY);
        }
        if (isNaN(panX)) panX = 0;
        if (isNaN(panY)) panY = 0;
        clampPan();
        scheduleTransform(); // rAF batched — continuous event
      } else if (isDragging && e.touches.length === 1) {
        e.preventDefault();
        panX = dragStartPanX + (e.touches[0].clientX - dragStartX);
        panY = dragStartPanY + (e.touches[0].clientY - dragStartY);
        clampPan();
        scheduleTransform(); // rAF batched — continuous event
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
      // Wheel zoom: update state inline and use rAF batching (continuous)
      const old = zoom;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * delta));
      zoom = newZoom;
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const ratio = zoom / old;
      panX = ox - ratio * (ox - panX);
      panY = oy - ratio * (oy - panY);
      if (isNaN(panX)) panX = 0;
      if (isNaN(panY)) panY = 0;
      clampPan();
      scheduleTransform(); // rAF batched — continuous event
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
      scheduleTransform(); // rAF batched — continuous event
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

    let _destroyed = false;

    function destroy() {
      _destroyed = true;
      containerEl.removeEventListener('touchstart', onTouchStart);
      containerEl.removeEventListener('touchmove', onTouchMove);
      containerEl.removeEventListener('touchend', onTouchEnd);
      containerEl.removeEventListener('wheel', onWheel);
      containerEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    }

    function zoomInFn()  { if (!_destroyed) setZoom(zoom * 1.25); }
    function zoomOutFn() { if (!_destroyed) setZoom(zoom / 1.25); }

    return { destroy, resetZoom: () => { if (!_destroyed) resetZoom(); }, getZoom: () => zoom, zoomIn: zoomInFn, zoomOut: zoomOutFn };
  }

  // ─── Modal-specific render (uses renderToCanvas + pending page) ──

  async function _renderPage(num) {
    if (!_pdfDoc) return;
    if (_rendering) { _pendingPage = num; return; }
    _rendering = true;
    try {
      await renderToCanvasCached(_pdfDoc, num, canvasEl(), container());
      if (!_pdfDoc) return; // closed while rendering
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
    const gen = ++_openGen; // track this open generation

    fileLabel().textContent = name || 'Chart';
    modal().classList.remove('hidden');
    // Feature 4: Focus trap for PDF modal
    if (typeof Admin !== 'undefined' && Admin._trapFocus) {
      _focusTrap = Admin._trapFocus(modal());
    } else {
      // Inline minimal focus trap if Admin._trapFocus not exposed
      _focusTrap = null;
    }

    // Attach zoom/pan to modal canvas
    if (_zpHandle) _zpHandle.destroy();
    _zpHandle = attachZoomPan(canvasEl(), container(), {
      onZoomChange: (z) => {
        const lbl = zoomLabel();
        if (lbl) lbl.textContent = Math.round(z * 100) + '%';
      },
    });

    try {
      const doc = await pdfjsLib.getDocument(url).promise;
      if (gen !== _openGen) { doc.destroy(); return; } // stale — user already opened another or closed
      _pdfDoc = doc;
      _updateNav();
      await _renderPage(1);
    } catch (e) {
      if (gen !== _openGen) return; // stale
      console.error('PDF load error', e);
      if (typeof App !== 'undefined') App.showToast('Failed to load PDF.');
      close();
    }
  }

  function close() {
    modal().classList.add('hidden');
    if (_focusTrap) { _focusTrap.release(); _focusTrap = null; }
    if (_blobUrl && _ownsBlobUrl) { try { URL.revokeObjectURL(_blobUrl); } catch(_){} }
    _blobUrl = null;
    _ownsBlobUrl = false;
    // Clear cache for the closing doc before nulling the reference
    if (_pdfDoc) clearRenderCache(_pdfDoc);
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

    // Tap zones for page turning
    container().addEventListener('click', (e) => {
      if (modal().classList.contains('hidden')) return;
      if (_zpHandle && _zpHandle.getZoom() > 1.05) return;
      // Don't trigger on button/control clicks
      if (e.target.closest('button, .pdf-toolbar')) return;

      const rect = container().getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;

      if (x >= 0.45) {        // right 55%
        nextPage();
      } else if (x <= 0.30) { // left 30%
        prevPage();
      }
      // middle 15% = dead zone, no action
    });
  });

  return { open, close, prevPage, nextPage, zoomIn, zoomOut, renderToCanvas, renderToCanvasCached, preRenderPage, clearRenderCache, attachZoomPan };

})();
