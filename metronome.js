/**
 * metronome.js — Dual-mode metronome: AudioWorklet (preferred) or setInterval fallback
 *
 * AudioWorklet runs on the audio render thread (~2.9ms intervals), immune to UI jank.
 * Falls back to main-thread setInterval scheduler if AudioWorklet is unavailable.
 */
let _audioCtx = null;
let _isPlaying = false;
let _bpm = 120;
let _beatsPerMeasure = 4;
let _currentBeat = 0;
let _nextNoteTime = 0;
let _timerID = null;
let _onBeat = null;

// Dual-mode state
let _mode = null;          // 'worklet' | 'fallback' — set after first start()
let _workletNode = null;
let _workletReady = false;
let _workletInitPromise = null;
let _startGen = 0;

// Fallback scheduler constants
const LOOKAHEAD = 25.0;      // ms
const SCHEDULE_AHEAD = 0.1;  // seconds

function _getCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

// --- AudioWorklet initialization --------------------------------------

// Safari/iOS AudioWorklet has bugs where process() output doesn't route to speakers.
// Detect WebKit-based browsers and skip worklet to use reliable OscillatorNode fallback.
function _isWebKit() {
  return /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
}

async function _initWorklet() {
  if (_workletInitPromise) return _workletInitPromise;
  _workletInitPromise = (async () => {
    try {
      if (_isWebKit()) throw new Error('Safari/WebKit — skip worklet for reliable audio');
      const ctx = _getCtx();
      if (!ctx.audioWorklet) throw new Error('AudioWorklet not supported');
      await ctx.audioWorklet.addModule('workers/metronome-processor.js');
      _workletNode = new AudioWorkletNode(ctx, 'metronome-processor');
      _workletNode.connect(ctx.destination);
      _workletNode.port.onmessage = (e) => {
        if (e.data.type === 'beat' && _isPlaying && _onBeat) {
          _onBeat(e.data.beat, e.data.beatsPerMeasure);
        }
      };
      _workletReady = true;
      _mode = 'worklet';
      console.info('Metronome: AudioWorklet mode active');
    } catch (e) {
      console.warn('Metronome: AudioWorklet unavailable, using fallback scheduler', e.message);
      _workletReady = false;
      _workletNode = null;
      _mode = 'fallback';
      _workletInitPromise = null; // Allow retry on next start
    }
  })();
  return _workletInitPromise;
}

// --- Fallback scheduler (current setInterval approach) ----------------

function _scheduleNote(time, beat) {
  const ctx = _getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (beat === 0) {
    osc.frequency.value = 1000; // accent beat
    gain.gain.value = 1.0;
  } else {
    osc.frequency.value = 800;
    gain.gain.value = 0.5;
  }

  osc.start(time);
  osc.stop(time + 0.05);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };

  if (_onBeat) {
    const delay = Math.max(0, (time - ctx.currentTime) * 1000);
    const g = _startGen;
    setTimeout(() => { if (g === _startGen && _isPlaying && _onBeat) _onBeat(beat, _beatsPerMeasure); }, delay);
  }
}

function _scheduler() {
  const ctx = _getCtx();
  while (_nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    _scheduleNote(_nextNoteTime, _currentBeat);
    _currentBeat = (_currentBeat + 1) % _beatsPerMeasure;
    _nextNoteTime += 60.0 / _bpm;
  }
}

// --- Public API -------------------------------------------------------

async function start(bpm, beatsPerMeasure, onBeat) {
  const gen = ++_startGen;
  if (_isPlaying) stop();
  _bpm = bpm || 120;
  _beatsPerMeasure = beatsPerMeasure || 4;
  _onBeat = onBeat || null;
  _currentBeat = 0;
  _isPlaying = true;  // Set early for API consistency

  const ctx = _getCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  if (gen !== _startGen) { _isPlaying = false; return; }

  // Initialize worklet on first start (or use cached result)
  if (_mode === null) {
    await _initWorklet();
  }
  if (gen !== _startGen) { _isPlaying = false; return; }

  if (_mode === 'worklet' && _workletReady && _workletNode) {
    // Track if worklet actually responds — auto-fallback if silent
    let gotBeat = false;
    const origHandler = _workletNode.port.onmessage;
    _workletNode.port.onmessage = (e) => {
      gotBeat = true;
      _workletNode.port.onmessage = origHandler; // restore original
      if (origHandler) origHandler(e);
    };
    _workletNode.port.postMessage({
      type: 'start',
      bpm: _bpm,
      beatsPerMeasure: _beatsPerMeasure,
    });
    // If no beat arrives within 500ms, worklet is broken — switch to fallback
    const fallbackGen = gen;
    setTimeout(() => {
      if (!gotBeat && fallbackGen === _startGen && _isPlaying && _mode === 'worklet') {
        console.warn('Metronome: worklet produced no beats, switching to fallback');
        _workletNode.port.postMessage({ type: 'stop' });
        _mode = 'fallback';
        _workletReady = false;
        _workletInitPromise = null;
        _nextNoteTime = ctx.currentTime + 0.05;
        _scheduler();
        _timerID = setInterval(_scheduler, LOOKAHEAD);
      }
    }, 500);
  } else {
    // Fallback scheduler
    _nextNoteTime = ctx.currentTime + 0.05;
    _scheduler();
    _timerID = setInterval(_scheduler, LOOKAHEAD);
  }
}

function stop() {
  if (_mode === 'worklet' && _workletReady && _workletNode) {
    _workletNode.port.postMessage({ type: 'stop' });
  }
  if (_timerID) { clearInterval(_timerID); _timerID = null; }
  _isPlaying = false;
  _currentBeat = 0;
  _onBeat = null;
  if (_audioCtx && _audioCtx.state === 'running' && _mode !== 'worklet') _audioCtx.suspend();
}

function setBpm(bpm) {
  _bpm = Math.max(20, Math.min(300, bpm));
  if (_mode === 'worklet' && _workletReady && _workletNode && _isPlaying) {
    _workletNode.port.postMessage({ type: 'setBpm', bpm: _bpm });
  }
}

function setTimeSignature(beats) {
  _beatsPerMeasure = Math.max(1, Math.min(12, beats));
  if (_mode === 'worklet' && _workletReady && _workletNode && _isPlaying) {
    _workletNode.port.postMessage({ type: 'setTimeSignature', beatsPerMeasure: _beatsPerMeasure });
  }
}

function isPlaying() { return _isPlaying; }
function getBpm() { return _bpm; }
function getBeatsPerMeasure() { return _beatsPerMeasure; }

// Tap tempo (main-thread only — unchanged)
const _tapTimes = [];
function tap() {
  const now = performance.now();
  if (_tapTimes.length && now - _tapTimes[_tapTimes.length - 1] > 2000) _tapTimes.length = 0;
  _tapTimes.push(now);
  if (_tapTimes.length > 8) _tapTimes.shift();
  if (_tapTimes.length < 2) return null;
  let total = 0;
  for (let i = 1; i < _tapTimes.length; i++) total += _tapTimes[i] - _tapTimes[i - 1];
  const avg = total / (_tapTimes.length - 1);
  return Math.max(20, Math.min(300, Math.round(60000 / avg)));
}

export { start, stop, setBpm, setTimeSignature, isPlaying, getBpm, getBeatsPerMeasure, tap };
