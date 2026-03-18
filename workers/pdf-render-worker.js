/**
 * pdf-render-worker.js — Off-main-thread PDF page renderer
 * Uses OffscreenCanvas + pdf.js to render pages, returns ImageBitmap via transferable (zero-copy).
 * Falls back gracefully — main thread catches errors and uses existing rendering.
 */

/* global pdfjsLib */

// Early capability check — OffscreenCanvas 2D + transferToImageBitmap required
// Safari exposes OffscreenCanvas but doesn't support 2D context or transferToImageBitmap
try {
  const _test = new OffscreenCanvas(1, 1);
  const _ctx = _test.getContext('2d');
  if (!_ctx) throw new Error('OffscreenCanvas 2D not supported');
  if (typeof _test.transferToImageBitmap !== 'function') throw new Error('transferToImageBitmap not supported');
} catch (e) {
  // Signal failure to main thread and shut down
  self.postMessage({ id: null, error: 'capability-check: ' + e.message });
  self.close();
  throw e; // also fires onerror on main thread
}

try {
  importScripts('../lib/pdf.min.js');
  importScripts('../lib/pdf.worker.min.js');
} catch (e) {
  self.postMessage({ id: null, error: 'importScripts failed: ' + e.message });
  self.close();
  throw e;
}

// Cache PDFDocumentProxy objects by URL (LRU via delete+re-insert)
const _docCache = new Map();
const MAX_DOC_CACHE = 5;

async function _getDoc(pdfUrl) {
  if (_docCache.has(pdfUrl)) {
    const doc = _docCache.get(pdfUrl);
    // Refresh LRU position
    _docCache.delete(pdfUrl);
    _docCache.set(pdfUrl, doc);
    return doc;
  }
  const doc = await pdfjsLib.getDocument({ url: pdfUrl, disableWorker: true }).promise;
  _docCache.set(pdfUrl, doc);
  if (_docCache.size > MAX_DOC_CACHE) {
    const oldest = _docCache.keys().next().value;
    try { _docCache.get(oldest).destroy(); } catch (_) {}
    _docCache.delete(oldest);
  }
  return doc;
}

self.onmessage = async (e) => {
  const { id, type, pdfUrl, pageNum, containerWidth, dpr } = e.data;

  if (type === 'evict') {
    if (pdfUrl && _docCache.has(pdfUrl)) {
      try { _docCache.get(pdfUrl).destroy(); } catch (_) {}
      _docCache.delete(pdfUrl);
    }
    return;
  }

  if (type === 'render') {
    if (!pdfUrl || !pageNum || !containerWidth || containerWidth <= 0) {
      self.postMessage({ id, error: 'Invalid render params' });
      return;
    }
    try {
      const doc = await _getDoc(pdfUrl);
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const fitScale = containerWidth / viewport.width;
      const renderScale = Math.min(fitScale * Math.max(dpr || 2, 2), 6);
      const scaled = page.getViewport({ scale: renderScale });

      const canvas = new OffscreenCanvas(Math.round(scaled.width), Math.round(scaled.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      page.cleanup();

      const bitmap = canvas.transferToImageBitmap();
      const displayW = viewport.width * fitScale;
      const displayH = viewport.height * fitScale;

      self.postMessage({ id, bitmap, displayW, displayH }, [bitmap]);
    } catch (err) {
      self.postMessage({ id, error: err.message || String(err) });
    }
    return;
  }

  // Unknown message type
  if (id != null) {
    self.postMessage({ id, error: 'Unknown message type: ' + type });
  }
};
