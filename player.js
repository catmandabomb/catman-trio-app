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

  // Playback speed — persists across players within the session (not localStorage)
  const _speeds = [1, 0.75, 1.25, 1.5];
  let _speedIndex = 0; // default 1x

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
   * Create and mount an audio player into `container`.
   * @param {HTMLElement} container
   * @param {Object}      opts
   * @param {string}      opts.name      — display name (audio file name)
   * @param {string}      opts.blobUrl   — blob URL for the audio
   * @param {string}      [opts.songTitle] — song title for lock screen / Media Session
   */
  function create(container, { name, blobUrl, songTitle }) {
    if (!container) throw new Error('Player.create: container is null');
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    try { audio.volume = _volume; } catch (_) {} // iOS: volume is read-only
    audio.src = blobUrl;
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
          <input type="range" class="audio-progress" value="0" min="0" step="0.1" />
          <div class="audio-time">
            <span class="audio-current">0:00</span>
            <span class="audio-duration">0:00</span>
          </div>
        </div>
        <button class="audio-speed-btn" aria-label="Playback speed">${_speeds[_speedIndex]}x</button>
      </div>
    `;

    const playBtn  = el.querySelector('.audio-play-btn');
    const progress = el.querySelector('.audio-progress');
    const current  = el.querySelector('.audio-current');
    const duration = el.querySelector('.audio-duration');
    const speedBtn = el.querySelector('.audio-speed-btn');

    // Apply session speed to new player
    audio.playbackRate = _speeds[_speedIndex];

    // Speed button — cycle through speeds
    speedBtn.addEventListener('click', () => {
      _speedIndex = (_speedIndex + 1) % _speeds.length;
      const speed = _speeds[_speedIndex];
      audio.playbackRate = speed;
      speedBtn.textContent = speed + 'x';
      // Update all other players' speed buttons + rates
      _audioElements.forEach(a => {
        try { a.playbackRate = speed; } catch (_) {}
        const btn = a.parentElement?.querySelector('.audio-speed-btn');
        if (btn) btn.textContent = speed + 'x';
      });
    });

    // Duration when metadata loads
    audio.addEventListener('loadedmetadata', () => {
      progress.max = audio.duration;
      duration.textContent = _formatTime(audio.duration);
    });

    // Time update
    audio.addEventListener('timeupdate', () => {
      if (!audio.seeking) {
        progress.value = audio.currentTime;
      }
      current.textContent = _formatTime(audio.currentTime);
      // Colored progress fill
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      progress.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-4) ${pct}%)`;
      progress.style.borderRadius = '4px';
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
      el.classList.remove('playing');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
      progress.value = 0;
      progress.style.background = 'var(--bg-4)';
      current.textContent = '0:00';
      _active = null;
      _clearMediaSession();
    });

    // Error recovery — reset UI on audio errors
    audio.addEventListener('error', () => {
      el.classList.remove('playing');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
      if (_active === audio) { _active = null; _clearMediaSession(); }
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
        playBtn.innerHTML = pauseIcon();
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
        const mediaTitle = songTitle || name;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.then(() => {
            _playPending = false;
            _setMediaSession(mediaTitle, 'Catman Trio');
          }).catch(() => {
            // Play rejected (autoplay policy / audio not ready) — reset UI
            _playPending = false;
            el.classList.remove('playing');
            playBtn.innerHTML = playIcon();
            if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [playBtn] });
            if (_active === audio) _active = null;
          });
        } else {
          _playPending = false;
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
        const wasActive = (_active === audio);
        try {
          audio.pause();
          audio.removeAttribute('src');
          audio.load(); // Release resources
        } catch (_) {}
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
