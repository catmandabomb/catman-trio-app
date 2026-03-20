/**
 * audio-converter.js — Web Worker for background audio conversion
 *
 * Receives an audio ArrayBuffer, decodes it via OfflineAudioContext,
 * re-encodes to WebM/Opus via MediaRecorder, and posts back the result.
 *
 * Messages IN:
 *   { type: 'CONVERT', buffer: ArrayBuffer, targetFormat: 'opus', fileId: string }
 *
 * Messages OUT:
 *   { type: 'RESULT', ok: true, blob: Blob, fileId: string }
 *   { type: 'RESULT', ok: false, error: string, fileId: string }
 *   { type: 'PROGRESS', stage: string, fileId: string }
 */

self.addEventListener('message', async (e) => {
  if (e.data?.type !== 'CONVERT') return;

  const { buffer, targetFormat, fileId } = e.data;

  try {
    // ─── Feature detection ──────────────────────────────────
    if (typeof OfflineAudioContext === 'undefined') {
      throw new Error('OfflineAudioContext not available in this worker');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder not available in this worker');
    }

    // Check MediaRecorder Opus support
    const opusMime = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(opusMime)) {
      throw new Error('MediaRecorder does not support audio/webm;codecs=opus');
    }

    self.postMessage({ type: 'PROGRESS', stage: 'decoding', fileId });

    // ─── Decode the source audio ────────────────────────────
    // Create a temporary AudioContext just for decoding
    // We need to know sample rate and channels first, so decode with default context
    const tempCtx = new OfflineAudioContext(1, 1, 44100);
    let audioBuffer;
    try {
      audioBuffer = await tempCtx.decodeAudioData(buffer.slice(0));
    } catch (decodeErr) {
      throw new Error('Failed to decode audio: ' + (decodeErr.message || 'unsupported format'));
    }

    const sampleRate = Math.min(audioBuffer.sampleRate, 48000); // Cap at 48kHz for Opus
    const channels = Math.min(audioBuffer.numberOfChannels, 2); // Stereo max
    const duration = audioBuffer.duration;
    const totalSamples = Math.ceil(duration * sampleRate);

    if (totalSamples === 0 || !isFinite(duration)) {
      throw new Error('Audio has zero duration or invalid length');
    }

    self.postMessage({ type: 'PROGRESS', stage: 'encoding', fileId });

    // ─── Create OfflineAudioContext for rendering ───────────
    const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);

    // Copy audio data into the offline context
    const offlineBuffer = offlineCtx.createBuffer(channels, totalSamples, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const srcData = audioBuffer.getChannelData(ch);
      const destData = offlineBuffer.getChannelData(ch);
      // Resample if needed (simple copy if same rate, or truncate/pad)
      if (audioBuffer.sampleRate === sampleRate) {
        destData.set(srcData.subarray(0, totalSamples));
      } else {
        // Linear resampling
        const ratio = audioBuffer.sampleRate / sampleRate;
        for (let i = 0; i < totalSamples; i++) {
          const srcIdx = i * ratio;
          const lo = Math.floor(srcIdx);
          const hi = Math.min(lo + 1, srcData.length - 1);
          const frac = srcIdx - lo;
          destData[i] = srcData[lo] * (1 - frac) + srcData[hi] * frac;
        }
      }
    }

    const source = offlineCtx.createBufferSource();
    source.buffer = offlineBuffer;

    // Create a MediaStreamDestination to pipe audio through MediaRecorder
    // Note: OfflineAudioContext doesn't support createMediaStreamDestination.
    // We must render to buffer first, then use a real AudioContext + MediaRecorder.

    // Render the offline context to get the final buffer
    source.connect(offlineCtx.destination);
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();

    self.postMessage({ type: 'PROGRESS', stage: 'compressing', fileId });

    // ─── Encode via MediaRecorder ───────────────────────────
    // We need a real AudioContext with MediaStreamDestination.
    // In a Worker, we can use AudioContext if available (Chrome 116+).
    // If not available, we fall back to manual WebM/Opus encoding.

    // Try using AudioContext in Worker (modern browsers)
    if (typeof AudioContext === 'undefined') {
      throw new Error('AudioContext not available in Worker — cannot encode');
    }

    const realCtx = new AudioContext({ sampleRate });
    const streamDest = realCtx.createMediaStreamDestination();

    // Create a buffer source from the rendered audio
    const playbackBuffer = realCtx.createBuffer(channels, renderedBuffer.length, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      playbackBuffer.getChannelData(ch).set(renderedBuffer.getChannelData(ch));
    }

    const playbackSource = realCtx.createBufferSource();
    playbackSource.buffer = playbackBuffer;
    playbackSource.connect(streamDest);

    // Set up MediaRecorder
    const recorder = new MediaRecorder(streamDest.stream, {
      mimeType: opusMime,
      audioBitsPerSecond: 128000, // 128kbps — good quality for music
    });

    const chunks = [];
    const encodingDone = new Promise((resolve, reject) => {
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => resolve();
      recorder.onerror = (ev) => reject(new Error('MediaRecorder error: ' + (ev.error?.message || 'unknown')));
    });

    recorder.start(100); // Collect data every 100ms
    playbackSource.start(0);

    // Wait for playback to finish
    await new Promise((resolve) => {
      playbackSource.onended = resolve;
      // Safety timeout: duration + 2 seconds
      setTimeout(resolve, (duration + 2) * 1000);
    });

    recorder.stop();
    await encodingDone;

    // Clean up AudioContext
    try { await realCtx.close(); } catch (_) {}

    if (chunks.length === 0) {
      throw new Error('MediaRecorder produced no data');
    }

    const blob = new Blob(chunks, { type: opusMime });

    // Sanity check: converted file should not be empty
    if (blob.size < 100) {
      throw new Error('Converted file is suspiciously small (' + blob.size + ' bytes)');
    }

    self.postMessage({ type: 'RESULT', ok: true, blob, fileId });

  } catch (err) {
    self.postMessage({
      type: 'RESULT',
      ok: false,
      error: err.message || 'Conversion failed',
      fileId,
    });
  }
});
