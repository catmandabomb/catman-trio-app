/**
 * metronome-processor.js — AudioWorklet processor for sample-accurate metronome
 * Runs on the audio render thread (~2.9ms intervals), immune to UI jank.
 */
class MetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._playing = false;
    this._bpm = 120;
    this._beatsPerMeasure = 4;
    this._sampleIndex = 0;
    this._beat = 0;
    this._samplesPerBeat = 0;
    this._clickDuration = 0;
    this._fadeDuration = 0;
    this._clickSampleIndex = 0;
    this._recalc();

    this.port.onmessage = (e) => {
      const { type, bpm, beatsPerMeasure } = e.data;
      if (type === 'start') {
        this._playing = true;
        this._sampleIndex = 0;
        this._beat = 0;
        if (bpm !== undefined) this._bpm = Math.max(20, Math.min(300, bpm));
        if (beatsPerMeasure !== undefined) this._beatsPerMeasure = Math.max(1, Math.min(12, beatsPerMeasure));
        this._recalc();
        // Fire initial beat immediately
        this.port.postMessage({ type: 'beat', beat: 0, beatsPerMeasure: this._beatsPerMeasure });
      } else if (type === 'stop') {
        this._playing = false;
      } else if (type === 'setBpm') {
        this._bpm = Math.max(20, Math.min(300, bpm));
        this._recalc();
        this._sampleIndex = 0;
      } else if (type === 'setTimeSignature') {
        this._beatsPerMeasure = Math.max(1, Math.min(12, beatsPerMeasure));
        if (this._beat >= this._beatsPerMeasure) this._beat = 0;
      }
    };
  }

  _recalc() {
    this._samplesPerBeat = Math.round((60 / this._bpm) * sampleRate);
    this._clickDuration = Math.round(0.05 * sampleRate);  // 50ms click
    this._fadeDuration = Math.round(0.01 * sampleRate);    // 10ms fade-out
  }

  process(inputs, outputs) {
    if (!this._playing) return true;

    const output = outputs[0];
    const channel = output[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const posInBeat = this._sampleIndex % this._samplesPerBeat;

      // Check if we just crossed a beat boundary (but not the initial one at sample 0 which was already sent)
      if (posInBeat === 0 && this._sampleIndex > 0) {
        this._beat = (this._beat + 1) % this._beatsPerMeasure;
        this.port.postMessage({ type: 'beat', beat: this._beat, beatsPerMeasure: this._beatsPerMeasure });
      }
      if (posInBeat === 0) {
        this._clickSampleIndex = 0;
      }

      // Generate click sound within click duration
      if (posInBeat < this._clickDuration) {
        const freq = this._beat === 0 ? 1000 : 800;
        const amplitude = this._beat === 0 ? 1.0 : 0.5;
        const t = this._clickSampleIndex / sampleRate;
        let sample = Math.sin(2 * Math.PI * freq * t) * amplitude;

        // Apply fade-out in the last 10ms of the click
        const fadeStart = this._clickDuration - this._fadeDuration;
        if (posInBeat >= fadeStart) {
          const fadeProgress = (posInBeat - fadeStart) / this._fadeDuration;
          sample *= (1 - fadeProgress);
        }

        channel[i] = sample;
        this._clickSampleIndex++;
      } else {
        channel[i] = 0;
      }

      this._sampleIndex++;
    }

    return true;
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
