/**
 * pdf-viewer.js — PDF.js-powered inline PDF viewer
 *
 * Uses a modal canvas to render PDFs entirely in-app.
 * No browser PDF viewer, no new tabs.
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

  const modal     = () => document.getElementById('modal-pdf');
  const canvas    = () => document.getElementById('pdf-canvas');
  const pageInfo  = () => document.getElementById('pdf-page-info');
  const filename  = () => document.getElementById('pdf-filename');

  function _updateNav() {
    document.getElementById('pdf-prev').disabled = _pageNum <= 1;
    document.getElementById('pdf-next').disabled = !_pdfDoc || _pageNum >= _pdfDoc.numPages;
    pageInfo().textContent = _pdfDoc ? `${_pageNum} / ${_pdfDoc.numPages}` : '1 / 1';
  }

  async function _renderPage(num) {
    if (!_pdfDoc || _rendering) return;
    _rendering = true;

    const page = await _pdfDoc.getPage(num);
    const container = document.getElementById('pdf-canvas-container');
    const containerWidth = container.clientWidth - 24; // 12px padding each side

    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(containerWidth / viewport.width, 2.5);
    const scaled = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    const cvs = canvas();
    cvs.width  = scaled.width * dpr;
    cvs.height = scaled.height * dpr;
    cvs.style.width  = scaled.width + 'px';
    cvs.style.height = scaled.height + 'px';

    const ctx = cvs.getContext('2d');
    ctx.scale(dpr, dpr);

    await page.render({
      canvasContext: ctx,
      viewport: scaled,
    }).promise;

    _rendering = false;
    _updateNav();
  }

  /**
   * Open the PDF viewer with a given blob URL or data URL.
   * @param {string} url     — blob URL or remote URL
   * @param {string} name    — display filename
   */
  async function open(url, name) {
    _pdfDoc   = null;
    _pageNum  = 1;
    _blobUrl  = url;

    filename().textContent = name || 'Chart';
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
    _pdfDoc    = null;
    _pageNum   = 1;
    _rendering = false;
    // Clear canvas
    const cvs = canvas();
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

  // Wire up modal controls
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pdf-close').addEventListener('click', close);
    document.getElementById('pdf-prev').addEventListener('click', prevPage);
    document.getElementById('pdf-next').addEventListener('click', nextPage);

    // Close on backdrop click
    modal().addEventListener('click', (e) => {
      if (e.target === modal()) close();
    });
  });

  return { open, close, prevPage, nextPage };

})();
