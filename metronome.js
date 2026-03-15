/**
 * metronome.js — Web Audio lookahead scheduler metronome
 * IIFE: const Metronome
 */
const Metronome = (() => {
  let _audioCtx = null;
  let _isPlaying = false;
  let _bpm = 120;
  let _beatsPerMeasure = 4;
  let _currentBeat = 0;
  let _nextNoteTime = 0;
  let _timerID = null;
  let _onBeat = null;

  const LOOKAHEAD = 25.0;      // ms
  const SCHEDULE_AHEAD = 0.1;  // seconds

  function _getCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

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

    if (_onBeat) {
      const delay = Math.max(0, (time - ctx.currentTime) * 1000);
      setTimeout(() => { if (_isPlaying && _onBeat) _onBeat(beat, _beatsPerMeasure); }, delay);
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

  async function start(bpm, beatsPerMeasure, onBeat) {
    if (_isPlaying) stop();
    _bpm = bpm || 120;
    _beatsPerMeasure = beatsPerMeasure || 4;
    _onBeat = onBeat || null;
    _currentBeat = 0;
    const ctx = _getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    _nextNoteTime = ctx.currentTime + 0.05;
    _isPlaying = true;
    _scheduler();
    _timerID = setInterval(_scheduler, LOOKAHEAD);
  }

  function stop() {
    if (_timerID) { clearInterval(_timerID); _timerID = null; }
    _isPlaying = false;
    _currentBeat = 0;
    _onBeat = null;
    if (_audioCtx && _audioCtx.state === 'running') _audioCtx.suspend();
  }

  function setBpm(bpm) { _bpm = Math.max(20, Math.min(300, bpm)); }
  function setTimeSignature(beats) { _beatsPerMeasure = Math.max(1, Math.min(12, beats)); }
  function isPlaying() { return _isPlaying; }
  function getBpm() { return _bpm; }
  function getBeatsPerMeasure() { return _beatsPerMeasure; }

  // Tap tempo
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

  return { start, stop, setBpm, setTimeSignature, isPlaying, getBpm, getBeatsPerMeasure, tap };
})();
