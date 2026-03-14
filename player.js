/**
 * player.js — Custom HTML5 audio player
 *
 * Renders a styled player UI for a given audio file.
 * All rendering stays in-app; no external player ever opens.
 *
 * Usage:
 *   Player.create(containerEl, { name, blobUrl })
 *   Player.stopAll()   — stop any playing audio
 */

const Player = (() => {

  let _active = null; // currently playing HTMLAudioElement
  let _volume = parseFloat(localStorage.getItem('bb_volume') ?? 1);
  if (isNaN(_volume) || _volume < 0 || _volume > 1) _volume = 1;
  let _audioElements = [];

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
   * @param {string}      opts.name     — display name
   * @param {string}      opts.blobUrl  — blob URL for the audio
   */
  function create(container, { name, blobUrl }) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = _volume;
    audio.src = blobUrl;
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
      </div>
    `;

    const playBtn  = el.querySelector('.audio-play-btn');
    const progress = el.querySelector('.audio-progress');
    const current  = el.querySelector('.audio-current');
    const duration = el.querySelector('.audio-duration');

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
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
      progress.value = 0;
      progress.style.background = 'var(--bg-4)';
      current.textContent = '0:00';
      _active = null;
    });

    // Error recovery — reset UI on audio errors
    audio.addEventListener('error', () => {
      el.classList.remove('playing');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
      if (_active === audio) _active = null;
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
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.then(() => {
            _playPending = false;
          }).catch(() => {
            // Play rejected (autoplay policy / audio not ready) — reset UI
            _playPending = false;
            el.classList.remove('playing');
            playBtn.innerHTML = playIcon();
            if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
            if (_active === audio) _active = null;
          });
        } else {
          _playPending = false;
        }
      } else {
        audio.pause();
        el.classList.remove('playing');
        playBtn.innerHTML = playIcon();
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
        _active = null;
      }
    });

    audio.addEventListener('pause', () => {
      // Skip if play() promise is still pending — Android fires spurious pause
      // during play negotiation; the catch handler above will reset UI if needed
      if (_playPending) return;
      el.classList.remove('playing');
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
    });

    // Seek
    progress.addEventListener('input', () => {
      audio.currentTime = parseFloat(progress.value);
    });

    container.appendChild(el);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });

    return {
      el,
      audio,
      destroy() {
        audio.pause();
        audio.src = '';
        el.remove();
        if (_active === audio) _active = null;
        _audioElements = _audioElements.filter(a => a !== audio);
      }
    };
  }

  function stopAll() {
    if (_active) {
      _active.pause();
      _active = null;
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
    localStorage.setItem('bb_volume', _volume);
    _audioElements.forEach(a => { a.volume = _volume; });
  }

  function getVolume() { return _volume; }

  return { create, stopAll, setVolume, getVolume };

})();
