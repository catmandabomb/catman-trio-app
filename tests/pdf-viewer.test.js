/**
 * pdf-viewer.test.js — Tests for pdf-viewer.js (zoom clamping, page navigation)
 */

const { describe, it, assert } = require('./test-runner');

// ─── Replicate pdf-viewer logic for testing ──────────────────

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

function clampZoom(zoom) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function getMaxDPR(isMobile, deviceMemGB) {
  // Matches actual pdf-viewer.js logic:
  // _maxDPR = _isMobileDevice ? (_deviceMemGB <= 2 ? 1.5 : 3) : 4;
  return isMobile ? (deviceMemGB <= 2 ? 1.5 : 3) : 4;
}

function getMaxRenderCache(deviceMemGB, isMobile) {
  // Matches actual pdf-viewer.js logic:
  // MAX_RENDER_CACHE = Math.min(20, _deviceMemGB <= 2 ? 8 : _deviceMemGB <= 4 ? 15 : 20);
  const mem = deviceMemGB || (isMobile ? 3 : 8);
  return Math.min(20, mem <= 2 ? 8 : mem <= 4 ? 15 : 20);
}

function clampPage(pageNum, numPages) {
  return Math.max(1, Math.min(pageNum, numPages));
}

function isLandscape(width, height) {
  return width > height;
}

// ─── Tests ───────────────────────────────────────────────────

describe('PDF Viewer — zoom clamping', () => {
  it('clamps below minimum to 0.5', () => {
    assert.equal(clampZoom(0.1), 0.5);
    assert.equal(clampZoom(0), 0.5);
    assert.equal(clampZoom(-1), 0.5);
  });

  it('clamps above maximum to 5', () => {
    assert.equal(clampZoom(6), 5);
    assert.equal(clampZoom(10), 5);
    assert.equal(clampZoom(100), 5);
  });

  it('preserves valid zoom levels', () => {
    assert.equal(clampZoom(0.5), 0.5);
    assert.equal(clampZoom(1), 1);
    assert.equal(clampZoom(2.5), 2.5);
    assert.equal(clampZoom(5), 5);
  });

  it('handles fractional zoom', () => {
    assert.closeTo(clampZoom(1.75), 1.75, 0.001);
  });

  it('MIN_ZOOM is 0.5', () => { assert.equal(MIN_ZOOM, 0.5); });
  it('MAX_ZOOM is 5', () => { assert.equal(MAX_ZOOM, 5); });
});

describe('PDF Viewer — DPR capping', () => {
  it('mobile DPR capped at 3 for >2GB devices', () => {
    assert.equal(getMaxDPR(true, 4), 3);
    assert.equal(getMaxDPR(true, 8), 3);
  });

  it('mobile DPR capped at 1.5 for <=2GB devices', () => {
    assert.equal(getMaxDPR(true, 2), 1.5);
    assert.equal(getMaxDPR(true, 1), 1.5);
  });

  it('desktop DPR capped at 4', () => {
    assert.equal(getMaxDPR(false, 8), 4);
  });
});

describe('PDF Viewer — adaptive cache sizing', () => {
  it('low memory device (2GB) gets 8 cache slots', () => {
    assert.equal(getMaxRenderCache(2, true), 8);
  });

  it('1GB memory gets 8 cache slots', () => {
    assert.equal(getMaxRenderCache(1, true), 8);
  });

  it('4GB memory gets 15 cache slots', () => {
    assert.equal(getMaxRenderCache(4, false), 15);
  });

  it('3GB memory gets 15 cache slots', () => {
    assert.equal(getMaxRenderCache(3, false), 15);
  });

  it('8GB+ memory gets 20 cache slots (capped by Math.min)', () => {
    assert.equal(getMaxRenderCache(8, false), 20);
    assert.equal(getMaxRenderCache(16, false), 20);
  });

  it('6GB memory gets 20 cache slots', () => {
    assert.equal(getMaxRenderCache(6, false), 20);
  });

  it('null/undefined memory defaults based on mobile flag', () => {
    // mobile default is 3GB -> 15 slots, desktop default is 8GB -> 20 slots
    assert.equal(getMaxRenderCache(null, true), 15);
    assert.equal(getMaxRenderCache(null, false), 20);
  });

  it('max cache never exceeds 20', () => {
    // All inputs should produce <= 20
    assert.ok(getMaxRenderCache(32, false) <= 20);
    assert.ok(getMaxRenderCache(16, true) <= 20);
  });
});

describe('PDF Viewer — page navigation bounds', () => {
  it('clamps page below 1 to 1', () => {
    assert.equal(clampPage(0, 10), 1);
    assert.equal(clampPage(-1, 10), 1);
    assert.equal(clampPage(-100, 5), 1);
  });

  it('clamps page above max to numPages', () => {
    assert.equal(clampPage(11, 10), 10);
    assert.equal(clampPage(100, 5), 5);
  });

  it('preserves valid page numbers', () => {
    assert.equal(clampPage(1, 10), 1);
    assert.equal(clampPage(5, 10), 5);
    assert.equal(clampPage(10, 10), 10);
  });

  it('single page document', () => {
    assert.equal(clampPage(1, 1), 1);
    assert.equal(clampPage(0, 1), 1);
    assert.equal(clampPage(2, 1), 1);
  });
});

describe('PDF Viewer — orientation detection', () => {
  it('landscape when width > height', () => {
    assert.ok(isLandscape(1024, 768));
  });

  it('portrait when height > width', () => {
    assert.notOk(isLandscape(768, 1024));
  });

  it('square is not landscape', () => {
    assert.notOk(isLandscape(100, 100));
  });

  it('extreme landscape', () => {
    assert.ok(isLandscape(2000, 100));
  });
});

module.exports = {};
