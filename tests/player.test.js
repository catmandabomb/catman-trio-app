/**
 * player.test.js — Tests for player.js (speed logic, volume, format helpers)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');
const { setupGlobals } = require('./mocks');

// ─── Replicate player logic for testing ──────────────────────

const _speedSteps = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

function _formatTime(secs) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setVolume(currentVolume) {
  return (val) => Math.max(0, Math.min(1, val));
}

function getNextSpeedStep(currentSpeed) {
  const idx = _speedSteps.indexOf(currentSpeed);
  const nextIdx = (idx === -1 || idx >= _speedSteps.length - 1) ? 0 : idx + 1;
  return _speedSteps[nextIdx];
}

function shouldRestoreSpeed(songId, persistSpeed, savedValue) {
  if (!songId || !persistSpeed) return false;
  if (isNaN(savedValue) || savedValue <= 0 || savedValue > 1) return false;
  return _speedSteps.includes(savedValue);
}

// ─── Tests ───────────────────────────────────────────────────

describe('Player — _formatTime', () => {
  it('formats 0 as 0:00', () => { assert.equal(_formatTime(0), '0:00'); });
  it('formats 60 as 1:00', () => { assert.equal(_formatTime(60), '1:00'); });
  it('formats 65 as 1:05', () => { assert.equal(_formatTime(65), '1:05'); });
  it('formats 125 as 2:05', () => { assert.equal(_formatTime(125), '2:05'); });
  it('formats 3661 as 61:01', () => { assert.equal(_formatTime(3661), '61:01'); });
  it('handles NaN', () => { assert.equal(_formatTime(NaN), '0:00'); });
  it('handles Infinity', () => {
    // Infinity is not NaN, so it formats
    const result = _formatTime(Infinity);
    // Math.floor(Infinity) = Infinity, padStart still works on "NaN"
    // Just verify no crash
    assert.type(result, 'string');
  });
  it('handles fractional seconds', () => { assert.equal(_formatTime(65.7), '1:05'); });
  it('formats 59 as 0:59', () => { assert.equal(_formatTime(59), '0:59'); });
});

describe('Player — escHtml', () => {
  it('escapes all special chars', () => {
    assert.equal(escHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  });
  it('handles numbers', () => { assert.equal(escHtml(42), '42'); });
  it('handles empty string', () => { assert.equal(escHtml(''), ''); });
});

describe('Player — speed steps', () => {
  it('speed steps array is valid', () => {
    assert.equal(_speedSteps.length, 6);
    assert.equal(_speedSteps[0], 1);
    assert.equal(_speedSteps[_speedSteps.length - 1], 0.5);
  });

  it('all speed steps are between 0 and 1 inclusive', () => {
    _speedSteps.forEach(s => {
      assert.ok(s > 0, `${s} > 0`);
      assert.ok(s <= 1, `${s} <= 1`);
    });
  });

  it('speed steps are in descending order', () => {
    for (let i = 1; i < _speedSteps.length; i++) {
      assert.ok(_speedSteps[i] < _speedSteps[i - 1], `${_speedSteps[i]} < ${_speedSteps[i - 1]}`);
    }
  });

  it('cycling from 1x goes to 0.9x', () => {
    assert.equal(getNextSpeedStep(1), 0.9);
  });

  it('cycling from 0.9x goes to 0.8x', () => {
    assert.equal(getNextSpeedStep(0.9), 0.8);
  });

  it('cycling from 0.5x wraps to 1x', () => {
    assert.equal(getNextSpeedStep(0.5), 1);
  });

  it('unknown speed wraps to 1x', () => {
    assert.equal(getNextSpeedStep(0.75), 1);
    assert.equal(getNextSpeedStep(0.42), 1);
    assert.equal(getNextSpeedStep(2), 1);
  });

  it('full cycle returns to 1x', () => {
    let speed = 1;
    for (let i = 0; i < _speedSteps.length; i++) {
      speed = getNextSpeedStep(speed);
    }
    assert.equal(speed, 1);
  });
});

describe('Player — speed persistence gating', () => {
  it('restores valid speed with songId and persistSpeed', () => {
    assert.ok(shouldRestoreSpeed('song123', true, 0.8));
    assert.ok(shouldRestoreSpeed('song123', true, 0.5));
    assert.ok(shouldRestoreSpeed('song123', true, 1));
  });

  it('rejects when songId is missing', () => {
    assert.notOk(shouldRestoreSpeed(null, true, 0.8));
    assert.notOk(shouldRestoreSpeed('', true, 0.8));
  });

  it('rejects when persistSpeed is false', () => {
    assert.notOk(shouldRestoreSpeed('song123', false, 0.8));
  });

  it('rejects NaN saved value', () => {
    assert.notOk(shouldRestoreSpeed('song123', true, NaN));
  });

  it('rejects saved value <= 0', () => {
    assert.notOk(shouldRestoreSpeed('song123', true, 0));
    assert.notOk(shouldRestoreSpeed('song123', true, -0.5));
  });

  it('rejects saved value > 1', () => {
    assert.notOk(shouldRestoreSpeed('song123', true, 1.5));
    assert.notOk(shouldRestoreSpeed('song123', true, 2));
  });

  it('rejects non-standard speed step', () => {
    assert.notOk(shouldRestoreSpeed('song123', true, 0.75));
    assert.notOk(shouldRestoreSpeed('song123', true, 0.95));
    assert.notOk(shouldRestoreSpeed('song123', true, 0.42));
  });
});

describe('Player — volume clamping', () => {
  const clamp = setVolume(1);

  it('clamps minimum to 0', () => { assert.equal(clamp(-0.5), 0); });
  it('clamps maximum to 1', () => { assert.equal(clamp(1.5), 1); });
  it('preserves valid values', () => {
    assert.equal(clamp(0), 0);
    assert.equal(clamp(0.5), 0.5);
    assert.equal(clamp(1), 1);
  });
  it('increments by 0.1 clamped', () => {
    assert.closeTo(clamp(0.9 + 0.1), 1, 0.001);
  });
  it('decrements by 0.1 clamped', () => {
    assert.closeTo(clamp(0.1 - 0.1), 0, 0.001);
  });
});

describe('Player — volume localStorage', () => {
  let mocks;
  beforeEach(() => { mocks = setupGlobals(); });

  it('reads saved volume from localStorage', () => {
    localStorage.setItem('ct_volume', '0.7');
    const vol = parseFloat(localStorage.getItem('ct_volume') ?? 1);
    assert.closeTo(vol, 0.7, 0.001);
  });

  it('defaults to 1 when no saved volume', () => {
    const vol = parseFloat(localStorage.getItem('ct_volume') ?? 1);
    assert.equal(vol, 1);
  });

  it('defaults to 1 for invalid saved volume', () => {
    localStorage.setItem('ct_volume', 'abc');
    let vol = parseFloat(localStorage.getItem('ct_volume') ?? 1);
    if (isNaN(vol) || vol < 0 || vol > 1) vol = 1;
    assert.equal(vol, 1);
  });

  it('defaults to 1 for out-of-range saved volume', () => {
    localStorage.setItem('ct_volume', '5.0');
    let vol = parseFloat(localStorage.getItem('ct_volume') ?? 1);
    if (isNaN(vol) || vol < 0 || vol > 1) vol = 1;
    assert.equal(vol, 1);
  });
});

module.exports = {};
