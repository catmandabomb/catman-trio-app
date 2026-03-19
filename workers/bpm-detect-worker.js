/**
 * bpm-detect-worker.js — Detect BPM from audio using onset detection + autocorrelation
 *
 * Receives: { type: 'DETECT', samples: Float32Array, sampleRate: number }
 * Returns:  { type: 'RESULT', bpm: number, confidence: number }
 *
 * Algorithm:
 * 1. Compute spectral flux (onset detection function)
 * 2. Peak-pick the onset function to find beat candidates
 * 3. Autocorrelation on onset signal to find dominant period
 * 4. Convert period to BPM
 */

self.addEventListener('message', (e) => {
  if (e.data.type !== 'DETECT') return;
  const { samples, sampleRate } = e.data;

  try {
    const bpmResult = detectBPM(samples, sampleRate);
    self.postMessage({ type: 'RESULT', bpm: bpmResult.bpm, confidence: bpmResult.confidence });
  } catch (err) {
    self.postMessage({ type: 'ERROR', error: err.message });
  }
});

function detectBPM(samples, sampleRate) {
  // Work with mono — if stereo was passed, it's already mixed down by the caller
  const hopSize = 512;
  const fftSize = 1024;
  const numFrames = Math.floor((samples.length - fftSize) / hopSize);

  if (numFrames < 10) {
    return { bpm: 0, confidence: 0 };
  }

  // Step 1: Compute energy envelope (simple RMS per frame)
  const envelope = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let sum = 0;
    for (let j = 0; j < fftSize; j++) {
      const s = samples[start + j] || 0;
      sum += s * s;
    }
    envelope[i] = Math.sqrt(sum / fftSize);
  }

  // Step 2: Onset detection — first-order difference (spectral flux)
  const onset = new Float32Array(numFrames);
  for (let i = 1; i < numFrames; i++) {
    onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  }

  // Step 3: Normalize onset
  let maxOnset = 0;
  for (let i = 0; i < onset.length; i++) {
    if (onset[i] > maxOnset) maxOnset = onset[i];
  }
  if (maxOnset > 0) {
    for (let i = 0; i < onset.length; i++) onset[i] /= maxOnset;
  }

  // Step 4: Autocorrelation on onset signal
  // BPM range: 50-200 BPM
  const framesPerSecond = sampleRate / hopSize;
  const minLag = Math.floor(framesPerSecond * 60 / 200); // 200 BPM
  const maxLag = Math.floor(framesPerSecond * 60 / 50);  // 50 BPM
  const clampedMaxLag = Math.min(maxLag, numFrames - 1);

  if (minLag >= clampedMaxLag) {
    return { bpm: 0, confidence: 0 };
  }

  const acf = new Float32Array(clampedMaxLag + 1);
  let acfMax = 0;

  for (let lag = minLag; lag <= clampedMaxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < numFrames; i++) {
      sum += onset[i] * onset[i + lag];
      count++;
    }
    acf[lag] = count > 0 ? sum / count : 0;
    if (acf[lag] > acfMax) acfMax = acf[lag];
  }

  // Step 5: Find the peak lag
  let bestLag = minLag;
  let bestVal = 0;

  for (let lag = minLag; lag <= clampedMaxLag; lag++) {
    // Weight towards musically common tempos (80-160 BPM range gets a slight boost)
    const bpmAtLag = (framesPerSecond * 60) / lag;
    let weight = 1.0;
    if (bpmAtLag >= 80 && bpmAtLag <= 160) weight = 1.15;

    const weighted = acf[lag] * weight;
    if (weighted > bestVal) {
      bestVal = weighted;
      bestLag = lag;
    }
  }

  // Step 6: Parabolic interpolation around the peak for sub-frame accuracy
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < clampedMaxLag) {
    const y0 = acf[bestLag - 1];
    const y1 = acf[bestLag];
    const y2 = acf[bestLag + 1];
    const denom = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(denom) > 1e-10) {
      refinedLag = bestLag + (y0 - y2) / denom;
    }
  }

  const bpm = Math.round((framesPerSecond * 60) / refinedLag);
  const confidence = acfMax > 0 ? Math.min(1, bestVal / acfMax) : 0;

  return { bpm: Math.max(30, Math.min(300, bpm)), confidence: Math.round(confidence * 100) / 100 };
}
