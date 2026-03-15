/**
 * pdf-render-worker.js — Off-main-thread PDF page renderer
 * Uses OffscreenCanvas + pdf.js to render pages, returns ImageBitmap via transferable (zero-copy).
 * Falls back gracefully — main thread catches errors and uses existing rendering.
 */

/* global pdfjsLib */
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');

// Disable pdf.js nested worker — we already imported the worker code
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

// Cache PDFDocumentProxy objects by URL
const _docCache = new Map();
const MAX_DOC_CACHE = 5;

async function _getDoc(pdfUrl) {
  if (_docCache.has(pdfUrl)) return _docCache.get(pdfUrl);
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
    // Destroy cached doc for this URL
    if (pdfUrl && _docCache.has(pdfUrl)) {
      try { _docCache.get(pdfUrl).destroy(); } catch (_) {}
      _docCache.delete(pdfUrl);
    }
    return;
  }

  if (type === 'render') {
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

      const bitmap = canvas.transferToImageBitmap();
      const displayW = viewport.width * fitScale;
      const displayH = viewport.height * fitScale;

      self.postMessage({ id, bitmap, displayW, displayH }, [bitmap]);
    } catch (err) {
      self.postMessage({ id, error: err.message || String(err) });
    }
  }
};
