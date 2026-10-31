/**
 * Suno Downloader Pro - Player Engine
 * Manages decrypted audio playback, stem previews, and waveform visualization
 */

import { AudioConverter } from './audio-converter.js?v=2026.4';

export class PlayerEngine {
  constructor() {
    this.currentSongUuid = null;
    this.currentTrackType = 'master'; // 'master' | 'vocals' | 'instrumental'
    this.isPlaying = false;
    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';

    this.audioCtx = null;
    this.sourceNode = null;
    this.analyser = null;
    this.freqData = null;

    this.activeCanvas = null;
    this.activeCanvasCtx = null;
    this.animationId = null;

    this.setupListeners();
  }

  setupListeners() {
    this.audioElement.addEventListener('timeupdate', () => {
      this.onTimeUpdate();
    });

    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
    });

    this.audioElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
    });

    this.audioElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayPauseUI();
    });
  }

  /**
   * Initializes Web Audio AnalyserNode for audio visualization
   */
  initWebAudio() {
    if (this.sourceNode) return;
    try {
      this.audioCtx = AudioConverter.getAudioContext();
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('Web Audio element already connected or restricted', e);
    }
  }

  /**
   * Plays a blob or URL
   * @param {string} uuid
   * @param {Blob|string} audioSource
   * @param {string} trackType
   * @param {HTMLCanvasElement} [canvasEl]
   */
  async play(uuid, audioSource, trackType = 'master', canvasEl = null) {
    this.initWebAudio();

    const srcUrl = typeof audioSource === 'string' ? audioSource : URL.createObjectURL(audioSource);

    if (this.currentSongUuid === uuid && this.currentTrackType === trackType && this.audioElement.src) {
      // Toggle play/pause
      if (this.isPlaying) {
        this.audioElement.pause();
      } else {
        await this.audioElement.play();
      }
      return;
    }

    this.currentSongUuid = uuid;
    this.currentTrackType = trackType;
    this.activeCanvas = canvasEl;
    if (canvasEl) {
      this.activeCanvasCtx = canvasEl.getContext('2d');
    }

    this.audioElement.src = srcUrl;
    await this.audioElement.play();
    this.isPlaying = true;
    this.updatePlayPauseUI();

    this.startWaveformLoop();
  }

  pause() {
    this.audioElement.pause();
    this.isPlaying = false;
    this.updatePlayPauseUI();
  }

  seek(seconds) {
    if (this.audioElement && !isNaN(seconds)) {
      this.audioElement.currentTime = seconds;
    }
  }

  setVolume(val) {
    if (this.audioElement) {
      this.audioElement.volume = Math.max(0, Math.min(1, val));
    }
  }

  onTimeUpdate() {
    const cur = this.audioElement.currentTime || 0;
    const dur = this.audioElement.duration || 0;

    const timeEl = document.getElementById(`time-cur-${this.currentSongUuid}`);
    const durEl = document.getElementById(`time-dur-${this.currentSongUuid}`);

    if (timeEl) timeEl.textContent = this.formatTime(cur);
    if (durEl && !isNaN(dur) && dur > 0) durEl.textContent = this.formatTime(dur);
  }

  updatePlayPauseUI() {
    const btn = document.getElementById(`btn-play-${this.currentSongUuid}`);
    if (btn) {
      btn.innerHTML = this.isPlaying ? '❚❚' : '▶';
    }
  }

  startWaveformLoop() {
    if (this.animationId) cancelAnimationFrame(this.animationId);

    const render = () => {
      if (this.isPlaying && this.analyser && this.activeCanvasCtx && this.activeCanvas) {
        this.analyser.getByteFrequencyData(this.freqData);
        this.drawWaveform();
      }
      this.animationId = requestAnimationFrame(render);
    };

    this.animationId = requestAnimationFrame(render);
  }

  drawWaveform() {
    const ctx = this.activeCanvasCtx;
    const canvas = this.activeCanvas;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const cur = this.audioElement.currentTime || 0;
    const dur = this.audioElement.duration || 1;
    const progress = cur / dur;

    // Draw background scrubber bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, 0, w, h);

    // Draw active progress highlight
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.fillRect(0, 0, w * progress, h);

    // Draw frequency bars
    const numBars = this.freqData.length;
    const barWidth = w / numBars;

    for (let i = 0; i < numBars; i++) {
      const val = this.freqData[i];
      const barH = (val / 255) * h;
      const x = i * barWidth;
      const y = (h - barH) / 2;

      ctx.fillStyle = (x / w <= progress) ? '#fbbf24' : '#64748b';
      ctx.fillRect(x + 1, y, barWidth - 2, barH);
    }
  }

  formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}
