/**
 * player.js — Custom HTML5 audio player
 *
 * Renders a styled player UI for a given audio file.
 * All rendering stays in-app; no external player ever opens.
 *
 * Usage:
 *   Player.create(containerEl, { name, blobUrl, songTitle })
 *   Player.stopAll()   — stop any playing audio
 */

const Player = (() => {

  let _active = null; // currently playing HTMLAudioElement
  let _volume = parseFloat(localStorage.getItem('bb_volume') ?? 1);
  if (isNaN(_volume) || _volume < 0 || _volume > 1) _volume = 1;
  let _audioElements = [];

  // 2A: iOS Safari detection — blob URLs can fail silently on iOS Safari.
  // Use service worker audio proxy as a workaround.
  // Excludes: standalone PWA mode (doesn't need proxy), Chrome/Firefox/Edge on iOS
  const _isIOSSafari = !navigator.standalone
    && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(navigator.userAgent);
  let _audioProxyCounter = 0;

  // Playback speed steps — per-player (each audio file has independent speed)
  // Tap cycles: 1.0 → 0.9 → 0.8 → 0.7 → 0.6 → 0.5 → 1.0
  // Long-press: reset to 1x immediately.
  const _speedSteps = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

  // ─── Media Session (lock screen / notification controls) ───
  const _hasMediaSession = ('mediaSession' in navigator);

  function _setMediaSession(title, artist) {
    if (!_hasMediaSession) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Audio',
        artist: artist || 'Catman Trio',
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch (_) {}
  }

  function _updateMediaSessionState(state) {
    if (!_hasMediaSession) return;
    try { navigator.mediaSession.playbackState = state; } catch (_) {}
  }

  function _clearMediaSession() {
    if (!_hasMediaSession) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch (_) {}
  }

  function _formatTime(secs) {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  /**
   * Auto-populate the edit form's duration field when audio metadata loads,
   * but only if the field is empty (song has no duration yet). Does NOT auto-save.
   */
  function _tryAutoPopulateDuration(audioDuration) {
    if (!audioDuration || !isFinite(audioDuration)) return;
    try {
      const input = window._editSongDurationInput;
      if (!input || !document.body.contains(input)) return;
      // Only populate if the field is currently empty
      if (input.value.trim()) return;
      const secs = Math.round(audioDuration);
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      input.value = m + ':' + String(s).padStart(2, '0');
    } catch (_) {}
  }

  /**
   * 2A: Register a blob with the service worker for iOS Safari audio proxy.
   * Returns a proxy URL that the SW will intercept and serve the blob from.
   */
  async function _registerAudioProxy(blob) {
    if (!navigator.serviceWorker?.controller) return null;
    const proxyId = `audio-proxy-${++_audioProxyCounter}-${Date.now()}`;
    const proxyUrl = `/audio-proxy/${proxyId}`;
    navigator.serviceWorker.controller.postMessage({
      type: 'REGISTER_AUDIO', id: proxyId, blob
    });
    // Small delay to ensure SW processes the message before fetch
    await new Promise(r => setTimeout(r, 50));
    return proxyUrl;
  }

  /**
   * Create and mount an audio player into `container`.
   * @param {HTMLElement} container
   * @param {Object}      opts
   * @param {string}      opts.name      — display name (audio file name)
   * @param {string}      opts.blobUrl   — blob URL for the audio
   * @param {string}      [opts.songTitle] — song title for lock screen / Media Session
   * @param {string}      [opts.songId]  — song ID for persisting audio preferences
   */
  function create(container, { name, blobUrl, songTitle, loopMode, songId }) {
    if (!container) throw new Error('Player.create: container is null');
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    try { audio.volume = _volume; } catch (_) {} // iOS: volume is read-only

    // 2A: iOS Safari audio proxy — blob: URLs can fail silently on some iOS versions.
    // Convert blob URL to a service-worker-proxied URL for reliable playback.
    // Only applies to blob: URLs — direct https: URLs already work fine on iOS.
    // IMPORTANT: Set audio.src immediately as fallback so play() never finds an empty source.
    let _proxyUrl = null;
    audio.src = blobUrl; // set immediately — proxy will update if available
    if (_isIOSSafari && blobUrl && blobUrl.startsWith('blob:') && navigator.serviceWorker?.controller) {
      (async () => {
        try {
          const resp = await fetch(blobUrl);
          const blob = await resp.blob();
          const url = await _registerAudioProxy(blob);
          if (url) {
            _proxyUrl = url;
            // Only update src if audio isn't currently playing (avoid interrupting playback)
            if (audio.paused) {
              audio.src = url;
            }
          }
        } catch (_) {
          // Fallback already set — no action needed
        }
      })();
    }

    audio.style.display = 'none';
    _audioElements.push(audio);

    const el = document.createElement('div');
    el.className = 'audio-player';
    el.innerHTML = `
      <div class="audio-player-title">${escHtml(name)}</div>
      <div class="audio-controls">
        <button class="audio-play-btn" aria-label="Play/Pause">
          ${playIcon()}
        </button>
        <div class="audio-progress-wrap">
          <input type="range" class="audio-progress" value="0" min="0" step="0.1" aria-label="Audio progress" />
          <div class="audio-time">
            <span class="audio-current">0:00</span>
            <span class="audio-duration">0:00</span>
          </div>
        </div>
        <button class="audio-speed-btn" aria-label="Playback speed">1x</button>
      </div>
    `;

    // ─── A/B Loop (practice mode only) ───────────────────
    let loopA = null, loopB = null, loopCount = 0, loopActive = false;

    let _loopTimeUpdate = null, _loopEnded = null;

    if (loopMode) {
      const loopSection = document.createElement('div');
      loopSection.className = 'loop-section';
      loopSection.innerHTML = `
        <button class="loop-toggle-btn" aria-label="Toggle A/B Loop">
          <i data-lucide="repeat" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"></i>A/B Loop
        </button>
        <div class="loop-controls hidden">
          <div class="loop-points">
            <div class="loop-point">
              <span class="loop-label">A</span>
              <button class="loop-nudge" data-target="a" data-dir="-1">−</button>
              <span class="loop-time loop-time-a">—</span>
              <button class="loop-nudge" data-target="a" data-dir="1">+</button>
              <button class="loop-set-btn" data-point="a">Set A</button>
            </div>
            <div class="loop-point">
              <span class="loop-label">B</span>
              <button class="loop-nudge" data-target="b" data-dir="-1">−</button>
              <span class="loop-time loop-time-b">—</span>
              <button class="loop-nudge" data-target="b" data-dir="1">+</button>
              <button class="loop-set-btn" data-point="b">Set B</button>
            </div>
          </div>
          <div class="loop-status hidden">
            <span class="loop-count-label">Loops: <strong class="loop-count-val">0</strong></span>
            <button class="loop-clear-btn">Clear</button>
          </div>
        </div>
      `;
      el.appendChild(loopSection);

      const loopToggleBtn = loopSection.querySelector('.loop-toggle-btn');
      const loopControlsDiv = loopSection.querySelector('.loop-controls');
      const loopTimeA = loopSection.querySelector('.loop-time-a');
      const loopTimeB = loopSection.querySelector('.loop-time-b');
      const loopStatusDiv = loopSection.querySelector('.loop-status');
      const loopCountVal = loopSection.querySelector('.loop-count-val');
      const loopClearBtn = loopSection.querySelector('.loop-clear-btn');

      function _roundT(t) { return Math.round(t * 10) / 10; }
      function _fmtT(t) { return t === null ? '—' : t.toFixed(1) + 's'; }

      function _updateLoopUI() {
        loopTimeA.textContent = _fmtT(loopA);
        loopTimeB.textContent = _fmtT(loopB);
        loopActive = loopA !== null && loopB !== null && loopA < loopB;
        loopStatusDiv.classList.toggle('hidden', !loopActive);
        loopCountVal.textContent = loopCount;

        // Update progress bar overlay
        const progressEl = el.querySelector('.audio-progress');
        if (loopActive && audio.duration) {
          const aPct = (loopA / audio.duration) * 100;
          const bPct = (loopB / audio.duration) * 100;
          const curPct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
          const playPct = Math.min(curPct, bPct);
          progressEl.style.background = `linear-gradient(to right, var(--bg-4) 0%, var(--bg-4) ${aPct}%, rgba(100,160,255,0.2) ${aPct}%, var(--accent) ${aPct}%, var(--accent) ${playPct}%, rgba(100,160,255,0.2) ${playPct}%, rgba(100,160,255,0.2) ${bPct}%, var(--bg-4) ${bPct}%)`;
        } else if (!loopActive) {
          // Reset to default when loop cleared
          const progressEl2 = el.querySelector('.audio-progress');
          if (progressEl2 && audio.duration) {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressEl2.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-4) ${pct}%)`;
          }
        }
      }

      // Toggle controls visibility
      loopToggleBtn.addEventListener('click', () => {
        const isHidden = loopControlsDiv.classList.contains('hidden');
        loopControlsDiv.classList.toggle('hidden');
        loopToggleBtn.classList.toggle('loop-toggle-active', isHidden);
      });

      // Set A / Set B buttons
      loopSection.querySelectorAll('.loop-set-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!audio.duration || !isFinite(audio.duration)) return; // audio not loaded
          const t = _roundT(audio.currentTime);
          if (btn.dataset.point === 'a') {
            loopA = t;
            if (loopB !== null && loopA >= loopB) loopB = null;
          } else {
            loopB = t;
            if (loopA !== null && loopB <= loopA) loopA = null;
          }
          loopCount = 0;
          _updateLoopUI();
        });
      });

      // Nudge buttons (+/- 0.1s)
      loopSection.querySelectorAll('.loop-nudge').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.target;
          const dir = parseInt(btn.dataset.dir);
          if (target === 'a' && loopA !== null) {
            loopA = _roundT(Math.max(0, loopA + dir * 0.1));
            if (loopB !== null && loopA >= loopB) loopA = _roundT(loopB - 0.1);
            if (loopA < 0) loopA = 0;
          } else if (target === 'b' && loopB !== null) {
            const maxT = audio.duration || 9999;
            loopB = _roundT(Math.min(maxT, loopB + dir * 0.1));
            if (loopA !== null && loopB <= loopA) loopB = _roundT(loopA + 0.1);
          }
          _updateLoopUI();
        });
      });

      // Clear button
      loopClearBtn.addEventListener('click', () => {
        loopA = null;
        loopB = null;
        loopCount = 0;
        loopActive = false;
        _updateLoopUI();
      });

      // Loop enforcement now runs in the rAF loop (_updateProgress) for ~16ms precision.
      // Keep a lightweight timeupdate fallback for when rAF is throttled (e.g. background tab).
      _loopTimeUpdate = () => {
        if (loopActive && !audio.seeking && audio.currentTime >= loopB) {
          audio.currentTime = loopA;
          loopCount++;
          _updateLoopUI();
        }
      };
      // Hook into ended — if loop active and B is near end, loop back
      _loopEnded = () => {
        if (loopActive && loopB >= audio.duration - 0.5) {
          audio.currentTime = loopA;
          loopCount++;
          _updateLoopUI();
          audio.play().catch(() => {});
        }
      };
      audio.addEventListener('timeupdate', _loopTimeUpdate);
      audio.addEventListener('ended', _loopEnded);
    }

    const playBtn  = el.querySelector('.audio-play-btn');
    const progress = el.querySelector('.audio-progress');
    const current  = el.querySelector('.audio-current');
    const duration = el.querySelector('.audio-duration');
    const speedBtn = el.querySelector('.audio-speed-btn');

    // Per-player speed (independent per audio file)
    // 2C: Restore saved speed for this song if available
    let _playerSpeed = 1;
    if (songId) {
      try {
        const saved = parseFloat(localStorage.getItem(`bb_audio_speed_${songId}`));
        if (!isNaN(saved) && saved > 0 && saved <= 1 && _speedSteps.includes(saved)) _playerSpeed = saved;
      } catch (_) {}
    }

    // Smooth speed ramp — avoids audio decoder choke on instant rate change
    let _rampRaf = null;
    function _rampRate(targetAudio, from, to, step, steps) {
      if (step >= steps) { try { targetAudio.playbackRate = to; } catch (_) {} return; }
      try { targetAudio.playbackRate = from + (to - from) * (step / steps); } catch (_) {}
      _rampRaf = requestAnimationFrame(() => _rampRate(targetAudio, from, to, step + 1, steps));
    }

    // 2C: debounce speed persistence to avoid localStorage thrash
    let _speedSaveTimer = null;
    function _persistSpeed(speed) {
      if (!songId) return;
      if (_speedSaveTimer) clearTimeout(_speedSaveTimer);
      _speedSaveTimer = setTimeout(() => {
        try {
          if (speed === 1) localStorage.removeItem(`bb_audio_speed_${songId}`);
          else localStorage.setItem(`bb_audio_speed_${songId}`, speed);
        } catch (_) {}
      }, 500);
    }

    function _applySpeed(speed) {
      const prev = _playerSpeed;
      _playerSpeed = speed;
      const label = speed === 1 ? '1x' : speed.toFixed(1) + 'x';
      if (speedBtn) {
        speedBtn.textContent = label;
        speedBtn.classList.toggle('speed-active', speed !== 1);
      }
      // Ensure pitch is preserved across all browsers when changing speed
      try { audio.preservesPitch = true; } catch (_) {}
      try { audio.mozPreservesPitch = true; } catch (_) {}
      try { audio.webkitPreservesPitch = true; } catch (_) {}
      // Ramp this player's rate smoothly over ~6 frames (~100ms)
      if (_rampRaf) cancelAnimationFrame(_rampRaf);
      _rampRate(audio, prev, speed, 0, 6);
      // 2C: persist speed preference
      _persistSpeed(speed);
    }

    // Tap: cycle 1.0→0.9→0.8→0.75→0.5→1.0. Long-press: reset to 1x.
    if (speedBtn) {
      let _speedTimer = null;
      let _speedLongPressed = false;
      speedBtn.addEventListener('pointerdown', (e) => {
        _speedLongPressed = false;
        _speedTimer = setTimeout(() => {
          _speedLongPressed = true;
          _applySpeed(1);
        }, 500);
      });
      speedBtn.addEventListener('pointerup', () => {
        clearTimeout(_speedTimer);
        if (_speedLongPressed) return;
        const idx = _speedSteps.indexOf(_playerSpeed);
        const nextIdx = (idx === -1 || idx >= _speedSteps.length - 1) ? 0 : idx + 1;
        _applySpeed(_speedSteps[nextIdx]);
      });
      speedBtn.addEventListener('pointerleave', () => {
        clearTimeout(_speedTimer);
      });
      // Keyboard: Enter/Space cycles speed, same as tap
      speedBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const idx = _speedSteps.indexOf(_playerSpeed);
          const nextIdx = (idx === -1 || idx >= _speedSteps.length - 1) ? 0 : idx + 1;
          _applySpeed(_speedSteps[nextIdx]);
        }
      });
    }

    // Duration when metadata loads
    audio.addEventListener('loadedmetadata', () => {
      progress.max = audio.duration;
      duration.textContent = _formatTime(audio.duration);
      // Auto-populate duration in edit form if song has no duration set
      _tryAutoPopulateDuration(audio.duration);
      // 2C: apply restored speed after metadata loads (playbackRate ignored before this)
      if (_playerSpeed !== 1) {
        try { audio.playbackRate = _playerSpeed; } catch (_) {}
        const label = _playerSpeed.toFixed(1) + 'x';
        if (speedBtn) {
          speedBtn.textContent = label;
          speedBtn.classList.toggle('speed-active', true);
        }
      }
    });

    // Smooth progress bar via rAF (timeupdate fires ~4Hz, too choppy)
    // A/B loop check also runs here (~60fps precision vs ~250ms on timeupdate)
    let _rafId = null;
    function _updateProgress() {
      if (!audio.paused && !audio.ended) {
        // A/B loop enforcement at rAF precision (~16ms vs ~250ms on timeupdate)
        if (loopActive && !audio.seeking && audio.currentTime >= loopB) {
          audio.currentTime = loopA;
          loopCount++;
          _updateLoopUI();
        }
        if (!audio.seeking) {
          progress.value = audio.currentTime;
        }
        current.textContent = _formatTime(audio.currentTime);
        if (loopActive && audio.duration) {
          const aPct = (loopA / audio.duration) * 100;
          const bPct = (loopB / audio.duration) * 100;
          const curPct = (audio.currentTime / audio.duration) * 100;
          const playPct = Math.min(curPct, bPct);
          progress.style.background = `linear-gradient(to right, var(--bg-4) 0%, var(--bg-4) ${aPct}%, var(--accent) ${aPct}%, var(--accent) ${playPct}%, rgba(100,160,255,0.2) ${playPct}%, rgba(100,160,255,0.2) ${bPct}%, var(--bg-4) ${bPct}%)`;
        } else {
          const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
          progress.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-4) ${pct}%)`;
        }
        _rafId = requestAnimationFrame(_updateProgress);
      }
    }
    function _startRaf() {
      if (_rafId) cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(_updateProgress);
    }
    function _stopRaf() {
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      // Sync final position
      if (!audio.seeking) progress.value = audio.currentTime;
      current.textContent = _formatTime(audio.currentTime);
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      progress.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-4) ${pct}%)`;
    }
    audio.addEventListener('play', _startRaf);
    audio.addEventListener('pause', _stopRaf);
    audio.addEventListener('seeking', () => {
      // Update display immediately on seek even when paused
      current.textContent = _formatTime(audio.currentTime);
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      progress.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-4) ${pct}%)`;
    });

    // Safari can reset playbackRate to 1.0 after a seek — re-apply our speed
    audio.addEventListener('seeked', () => {
      if (_playerSpeed !== 1 && audio.playbackRate !== _playerSpeed) {
        try { audio.playbackRate = _playerSpeed; } catch (_) {}
      }
    });

    // Also update duration if it wasn't available at loadedmetadata
    audio.addEventListener('durationchange', () => {
      if (audio.duration && isFinite(audio.duration)) {
        progress.max = audio.duration;
        duration.textContent = _formatTime(audio.duration);
      }
    });

    // Ended
    audio.addEventListener('ended', () => {
      // If A/B loop is active near end, the loop handler will re-seek — skip reset
      if (loopActive && loopB >= audio.duration - 0.5) return;
      _stopRaf();
      el.classList.remove('playing', 'buffering');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
      progress.value = 0;
      progress.style.background = 'var(--bg-4)';
      current.textContent = '0:00';
      _active = null;
      _clearMediaSession();
    });

    // iOS buffering — show loading state while waiting for data
    audio.addEventListener('waiting', () => {
      el.classList.add('buffering');
    });
    audio.addEventListener('playing', () => {
      el.classList.remove('buffering');
    });
    audio.addEventListener('canplay', () => {
      el.classList.remove('buffering');
    });

    // Error recovery — reset UI on audio errors with user feedback
    audio.addEventListener('error', () => {
      el.classList.remove('playing', 'buffering');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
      if (_active === audio) { _active = null; _clearMediaSession(); }
      // Brief inline error indicator
      el.classList.add('audio-error');
      setTimeout(() => el.classList.remove('audio-error'), 3000);
    });

    // Play/Pause button — handles Android autoplay policy gracefully
    let _playPending = false;

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        if (_active && _active !== audio) {
          _active.pause();
        }
        _playPending = true;
        _active = audio;
        el.classList.add('playing');
        // Show buffering indicator if audio data isn't ready yet (common on iOS)
        if (audio.readyState < 3) el.classList.add('buffering');
        playBtn.innerHTML = pauseIcon();
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
        const mediaTitle = songTitle || name;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.then(() => {
            _playPending = false;
            el.classList.remove('buffering');
            _setMediaSession(mediaTitle, 'Catman Trio');
          }).catch(() => {
            // Play rejected (autoplay policy / audio not ready) — reset UI
            _playPending = false;
            el.classList.remove('playing', 'buffering');
            playBtn.innerHTML = playIcon();
            if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
            if (_active === audio) _active = null;
          });
        } else {
          _playPending = false;
          el.classList.remove('buffering');
          _setMediaSession(mediaTitle, 'Catman Trio');
        }
      } else {
        audio.pause();
        el.classList.remove('playing');
        playBtn.innerHTML = playIcon();
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
        _active = null;
        _updateMediaSessionState('paused');
      }
    });

    audio.addEventListener('pause', () => {
      // Skip if play() promise is still pending — Android fires spurious pause
      // during play negotiation; the catch handler above will reset UI if needed
      if (_playPending) return;
      el.classList.remove('playing');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
      _updateMediaSessionState('paused');
    });

    // Seek
    progress.addEventListener('input', () => {
      try { audio.currentTime = parseFloat(progress.value); } catch (_) {}
    });

    // Media Session action handlers — so lock screen play/pause/stop work
    if (_hasMediaSession) {
      const _msPlay = () => { if (audio.paused && _active === audio) playBtn.click(); };
      const _msPause = () => { if (!audio.paused && _active === audio) playBtn.click(); };
      const _msStop = () => {
        if (_active === audio) {
          audio.pause();
          audio.currentTime = 0;
          el.classList.remove('playing');
          playBtn.innerHTML = playIcon();
          if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
          _active = null;
          _clearMediaSession();
        }
      };

      // Register handlers when this player starts, so they target the active audio
      audio.addEventListener('play', () => {
        try {
          navigator.mediaSession.setActionHandler('play', _msPlay);
          navigator.mediaSession.setActionHandler('pause', _msPause);
          navigator.mediaSession.setActionHandler('stop', _msStop);
        } catch (_) {}
      });
    }

    container.appendChild(audio);  // Audio element must be in DOM for iOS
    container.appendChild(el);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [el] });

    return {
      el,
      audio,
      destroy() {
        _stopRaf();
        if (_rampRaf) cancelAnimationFrame(_rampRaf);
        if (_speedSaveTimer) clearTimeout(_speedSaveTimer);
        if (_loopTimeUpdate) audio.removeEventListener('timeupdate', _loopTimeUpdate);
        if (_loopEnded) audio.removeEventListener('ended', _loopEnded);
        const wasActive = (_active === audio);
        try {
          audio.pause();
          audio.removeAttribute('src');
          audio.load(); // Release resources
        } catch (_) {}
        // 2A: tell SW to release the audio proxy blob
        if (_proxyUrl && navigator.serviceWorker?.controller) {
          const proxyId = _proxyUrl.replace('/audio-proxy/', '');
          navigator.serviceWorker.controller.postMessage({ type: 'RELEASE_AUDIO', id: proxyId });
        }
        try { audio.remove(); } catch (_) {}
        try { el.remove(); } catch (_) {}
        if (wasActive) { _active = null; _clearMediaSession(); }
        _audioElements = _audioElements.filter(a => a !== audio);
      }
    };
  }

  function stopAll() {
    if (_active) {
      try { _active.pause(); } catch (_) {}
      _active = null;
      _clearMediaSession();
    }
  }

  function playIcon() {
    return `<i data-lucide="play" style="width:16px;height:16px;fill:currentColor;"></i>`;
  }

  function pauseIcon() {
    return `<i data-lucide="pause" style="width:16px;height:16px;fill:currentColor;"></i>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setVolume(val) {
    _volume = Math.max(0, Math.min(1, val));
    try { localStorage.setItem('bb_volume', _volume); } catch (_) {}
    _audioElements.forEach(a => { try { a.volume = _volume; } catch (_) {} });
  }

  function getVolume() { return _volume; }

  return { create, stopAll, setVolume, getVolume };

})();
