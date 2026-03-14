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
    const audio = new Audio(blobUrl);
    audio.preload = 'metadata';

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

    // Ended
    audio.addEventListener('ended', () => {
      playBtn.innerHTML = playIcon();
      if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
      progress.value = 0;
      progress.style.background = 'var(--bg-4)';
      current.textContent = '0:00';
      _active = null;
    });

    // Play/Pause button
    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        if (_active && _active !== audio) {
          _active.pause();
          // Reset other player's button — handled by their own pause listener
        }
        audio.play();
        _active = audio;
        playBtn.innerHTML = pauseIcon();
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
      } else {
        audio.pause();
        playBtn.innerHTML = playIcon();
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide' });
        _active = null;
      }
    });

    audio.addEventListener('pause', () => {
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

  return { create, stopAll };

})();
