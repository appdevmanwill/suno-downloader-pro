/**
 * Suno Downloader Pro - Video Generator & Karaoke Visualizer Studio
 * Renders 1080p audio-visualizer videos with synchronized Karaoke Lyrics Burn-In,
 * 3 Visualizer Modes (Bars, Wave, Radial Ring), and 4 Color Themes.
 */

import { AudioConverter } from './audio-converter.js?v=2026.2';
import { LyricsUtils } from './lyrics-utils.js?v=2026.2';

export class VideoGenerator {
  static THEMES = {
    sunset: { primary: '#fbbf24', secondary: '#f43f5e', glow: '245, 158, 11' },
    cyber: { primary: '#22d3ee', secondary: '#a855f7', glow: '34, 211, 238' },
    emerald: { primary: '#34d399', secondary: '#06b6d4', glow: '52, 211, 153' },
    mono: { primary: '#f8fafc', secondary: '#94a3b8', glow: '248, 250, 252' }
  };

  constructor(options = {}) {
    this.canvas = options.canvas;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.aspectRatio = options.aspectRatio || '1:1'; // '1:1' | '16:9' | '9:16'
    this.visualStyle = options.visualStyle || 'bars'; // 'bars' | 'wave' | 'circular'
    this.theme = options.theme || 'sunset';
    this.showLyrics = options.showLyrics !== false;

    this.coverImage = null;
    this.audioBuffer = null;
    this.songMeta = options.songMeta || null;
    this.lyricCues = [];

    this.isRecording = false;
    this.isPreviewing = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.animationFrameId = null;

    this.analyser = null;
    this.sourceNode = null;
    this.audioCtx = null;
  }

  setSongMeta(meta, durationOverride = 0) {
    this.songMeta = meta;
    const dur = durationOverride || (meta && meta.duration) || 180;
    this.lyricCues = LyricsUtils.getTimedCues((meta && meta.prompt) || '', dur);
  }

  updateCanvasDimensions() {
    if (!this.canvas) return;
    if (this.aspectRatio === '16:9') {
      this.canvas.width = 1920;
      this.canvas.height = 1080;
    } else if (this.aspectRatio === '9:16') {
      this.canvas.width = 1080;
      this.canvas.height = 1920;
    } else {
      this.canvas.width = 1080;
      this.canvas.height = 1080;
    }
  }

  async loadCoverImage(url) {
    return new Promise((resolve) => {
      if (!url) {
        this.coverImage = this._makePlaceholderImage();
        resolve(this.coverImage);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.coverImage = img;
        resolve(img);
      };
      img.onerror = () => {
        this.coverImage = this._makePlaceholderImage();
        resolve(this.coverImage);
      };
      img.src = url;
    });
  }

  _makePlaceholderImage() {
    const placeholder = document.createElement('canvas');
    placeholder.width = 500;
    placeholder.height = 500;
    const pctx = placeholder.getContext('2d');
    const pal = VideoGenerator.THEMES[this.theme] || VideoGenerator.THEMES.sunset;
    const grad = pctx.createLinearGradient(0, 0, 500, 500);
    grad.addColorStop(0, pal.primary);
    grad.addColorStop(1, pal.secondary);
    pctx.fillStyle = grad;
    pctx.fillRect(0, 0, 500, 500);
    pctx.fillStyle = '#0a0c13';
    pctx.font = 'bold 140px Inter, sans-serif';
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    pctx.fillText('♪', 250, 250);

    const fallbackImg = new Image();
    fallbackImg.src = placeholder.toDataURL();
    return fallbackImg;
  }

  /**
   * Word-wraps a lyric string to maxPixelWidth
   */
  _wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let current = '';

    for (const w of words) {
      const test = current ? `${current} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 2);
  }

  /**
   * Draws a single 1080p frame onto the canvas
   * @param {Uint8Array} freqData
   * @param {number} currentTime
   * @param {number} [totalDuration=0]
   */
  drawFrame(freqData, currentTime = 0, totalDuration = 0) {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pal = VideoGenerator.THEMES[this.theme] || VideoGenerator.THEMES.sunset;
    const isVertical = this.aspectRatio === '9:16';
    const isLandscape = this.aspectRatio === '16:9';

    ctx.clearRect(0, 0, w, h);

    // 1. Deep Studio Obsidian Background
    const bgGrad = ctx.createRadialGradient(w / 2, h * 0.4, 40, w / 2, h / 2, Math.max(w, h) * 0.9);
    bgGrad.addColorStop(0, '#191d2d');
    bgGrad.addColorStop(0.55, '#0d1019');
    bgGrad.addColorStop(1, '#06080d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Compute bass energy (0..1)
    let energy = 0;
    if (freqData && freqData.length > 0) {
      let sum = 0;
      const count = Math.min(16, freqData.length);
      for (let i = 0; i < count; i++) sum += freqData[i];
      energy = sum / count / 255;
    }

    // 2. Ambient Cover Art Blur Layer
    if (this.coverImage) {
      ctx.save();
      ctx.globalAlpha = 0.24 + energy * 0.08;
      ctx.filter = 'blur(64px)';
      const scale = 1.25 + energy * 0.04;
      const bw = w * scale;
      const bh = h * scale;
      ctx.drawImage(this.coverImage, (w - bw) / 2, (h - bh) / 2, bw, bh);
      ctx.restore();
    }

    // Layout anchors
    const cx = isLandscape && this.showLyrics ? w * 0.30 : w / 2;
    const cy = isVertical ? h * 0.31 : (isLandscape ? h * 0.44 : h * 0.36);
    const baseCoverSize = Math.min(w, h) * (isVertical ? 0.54 : (isLandscape ? 0.46 : 0.38));
    const currentCoverSize = baseCoverSize * (1 + energy * 0.035);

    // 3A. Circular Halo Visualizer (drawn around the cover card if style === 'circular')
    if (this.visualStyle === 'circular' && freqData && freqData.length > 0) {
      ctx.save();
      const radius = currentCoverSize * 0.58;
      const spokes = 72;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(4, Math.floor(Math.min(w, h) * 0.006));

      for (let i = 0; i < spokes; i++) {
        const angle = (i / spokes) * Math.PI * 2 - Math.PI / 2;
        const mirrorIdx = i < spokes / 2 ? i : spokes - i;
        const bin = Math.floor((mirrorIdx / (spokes / 2)) * (freqData.length * 0.65));
        const amp = (freqData[bin] || 0) / 255;
        const barLen = 10 + amp * (baseCoverSize * 0.28);

        const x1 = cx + Math.cos(angle) * radius;
        const y1 = cy + Math.sin(angle) * radius;
        const x2 = cx + Math.cos(angle) * (radius + barLen);
        const y2 = cy + Math.sin(angle) * (radius + barLen);

        ctx.strokeStyle = i % 2 === 0 ? pal.primary : pal.secondary;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3B. Central Artwork Card
    ctx.save();
    ctx.shadowColor = `rgba(${pal.glow}, ${0.32 + energy * 0.38})`;
    ctx.shadowBlur = 38 + energy * 28;
    ctx.shadowOffsetY = 14;

    const cornerRadius = this.visualStyle === 'circular' ? currentCoverSize / 2 : 28;
    ctx.beginPath();
    ctx.roundRect(
      cx - currentCoverSize / 2,
      cy - currentCoverSize / 2,
      currentCoverSize,
      currentCoverSize,
      cornerRadius
    );
    ctx.fillStyle = '#11141f';
    ctx.fill();

    if (this.coverImage) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(
        this.coverImage,
        cx - currentCoverSize / 2,
        cy - currentCoverSize / 2,
        currentCoverSize,
        currentCoverSize
      );
      ctx.restore();
    }

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.stroke();
    ctx.restore();

    // 4. Linear Visualizer ('bars' or 'wave')
    const vizCenterX = isLandscape && this.showLyrics ? w * 0.66 : w / 2;
    const vizWidth = isLandscape && this.showLyrics ? w * 0.54 : w * 0.76;
    const vizBaseY = isVertical ? h * 0.63 : (isLandscape ? h * 0.42 : h * 0.67);
    const maxVizHeight = isVertical ? 140 : 115;

    if (freqData && freqData.length > 0 && this.visualStyle !== 'circular') {
      ctx.save();
      const startX = vizCenterX - vizWidth / 2;

      if (this.visualStyle === 'wave') {
        const waveGrad = ctx.createLinearGradient(startX, 0, startX + vizWidth, 0);
        waveGrad.addColorStop(0, pal.secondary);
        waveGrad.addColorStop(0.5, pal.primary);
        waveGrad.addColorStop(1, pal.secondary);

        ctx.strokeStyle = waveGrad;
        ctx.lineWidth = 6;
        ctx.shadowColor = pal.primary;
        ctx.shadowBlur = 18;
        ctx.beginPath();

        const points = 64;
        for (let i = 0; i <= points; i++) {
          const bin = Math.min(freqData.length - 1, Math.floor((i / points) * freqData.length * 0.65));
          const amp = ((freqData[bin] || 0) / 255);
          const waveOffset = Math.sin(i * 0.45 + currentTime * 7) * amp * (maxVizHeight * 0.65);
          const px = startX + (i / points) * vizWidth;
          const py = vizBaseY - maxVizHeight * 0.35 + waveOffset;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else {
        // Default: Spectrum Bars
        const numBars = 52;
        const barWidth = vizWidth / numBars;
        const barGrad = ctx.createLinearGradient(0, vizBaseY - maxVizHeight, 0, vizBaseY);
        barGrad.addColorStop(0, pal.secondary);
        barGrad.addColorStop(0.5, pal.primary);
        barGrad.addColorStop(1, `rgba(${pal.glow}, 0.22)`);
        ctx.fillStyle = barGrad;

        for (let i = 0; i < numBars; i++) {
          const binIndex = Math.floor(Math.pow(i / numBars, 1.35) * (freqData.length * 0.65));
          const val = freqData[binIndex] || 0;
          const barH = Math.max(6, (val / 255) * maxVizHeight);
          const bx = startX + i * barWidth;
          const by = vizBaseY - barH;
          ctx.beginPath();
          ctx.roundRect(bx + 2, by, Math.max(2, barWidth - 4), barH, 4);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 5. Karaoke Lyrics Overlay (if enabled & lyrics exist)
    const textCenterX = isLandscape && this.showLyrics ? w * 0.66 : w / 2;
    const hasCues = this.showLyrics && this.lyricCues && this.lyricCues.length > 0;

    if (hasCues) {
      let activeIdx = -1;
      for (let i = 0; i < this.lyricCues.length; i++) {
        if (currentTime >= this.lyricCues[i].start && currentTime < this.lyricCues[i].end) {
          activeIdx = i;
          break;
        }
      }
      if (activeIdx === -1 && currentTime >= (this.lyricCues[this.lyricCues.length - 1]?.end || 0)) {
        activeIdx = this.lyricCues.length - 1;
      }

      const activeCue = activeIdx >= 0 ? this.lyricCues[activeIdx] : null;
      const nextCue = (activeIdx + 1 < this.lyricCues.length) ? this.lyricCues[activeIdx + 1] : null;

      const lyricBoxY = isVertical ? h * 0.72 : (isLandscape ? h * 0.56 : h * 0.74);
      const maxTextW = isLandscape ? w * 0.50 : w * 0.80;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const mainFontPx = Math.floor(Math.min(w, h) * (isVertical ? 0.038 : 0.032));
      ctx.font = `800 ${mainFontPx}px Inter, system-ui, sans-serif`;

      if (activeCue) {
        const wrapped = this._wrapText(ctx, activeCue.text, maxTextW);
        const pillH = wrapped.length * (mainFontPx * 1.32) + (nextCue ? mainFontPx * 1.25 : 24) + 24;
        const pillW = maxTextW + 48;

        ctx.fillStyle = 'rgba(10, 12, 19, 0.62)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(textCenterX - pillW / 2, lyricBoxY - 22, pillW, pillH, 22);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = activeCue.isSection ? pal.primary : '#ffffff';
        ctx.shadowColor = `rgba(${pal.glow}, 0.45)`;
        ctx.shadowBlur = 14;

        wrapped.forEach((line, idx) => {
          ctx.fillText(line, textCenterX, lyricBoxY + 14 + idx * (mainFontPx * 1.28));
        });

        ctx.shadowBlur = 0;
        if (nextCue) {
          const subPx = Math.floor(mainFontPx * 0.72);
          ctx.font = `600 ${subPx}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
          const nextShort = nextCue.text.length > 56 ? nextCue.text.slice(0, 54) + '...' : nextCue.text;
          ctx.fillText(nextShort, textCenterX, lyricBoxY + 18 + wrapped.length * (mainFontPx * 1.28));
        }
      }
      ctx.restore();
    }

    // 6. Song Title & Timestamp Footer
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const titleY = isVertical
      ? h * 0.89
      : (isLandscape && this.showLyrics ? h * 0.22 : h * 0.90);

    const titleFontPx = Math.floor(Math.min(w, h) * 0.036);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${titleFontPx}px Inter, system-ui, sans-serif`;
    const displayTitle = (this.songMeta && this.songMeta.title) ? this.songMeta.title : 'Suno AI Song';
    ctx.fillText(displayTitle.slice(0, 42), textCenterX, titleY);

    const subFontPx = Math.floor(Math.min(w, h) * 0.020);
    ctx.fillStyle = pal.primary;
    ctx.font = `600 ${subFontPx}px Inter, system-ui, sans-serif`;
    const durLabel = totalDuration > 0
      ? `${this.formatTime(currentTime)} / ${this.formatTime(totalDuration)}`
      : this.formatTime(currentTime);
    ctx.fillText(`Suno Studio • ${durLabel}`, textCenterX, titleY + Math.floor(titleFontPx * 0.92));

    // Bottom Progress Accent Line
    if (totalDuration > 0) {
      const ratio = Math.max(0, Math.min(1, currentTime / totalDuration));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, h - 8, w, 8);
      const pGrad = ctx.createLinearGradient(0, 0, w * ratio, 0);
      pGrad.addColorStop(0, pal.primary);
      pGrad.addColorStop(1, pal.secondary);
      ctx.fillStyle = pGrad;
      ctx.fillRect(0, h - 8, w * ratio, 8);
    }
    ctx.restore();
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  /**
   * Starts live audio + canvas preview inside Video Studio modal without recording
   */
  startPreview(audioBuffer, songMeta) {
    this.stop();
    this.audioBuffer = audioBuffer;
    this.setSongMeta(songMeta, audioBuffer.duration);
    this.updateCanvasDimensions();

    this.audioCtx = AudioConverter.getAudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = audioBuffer;
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.isPreviewing = true;
    const freqData = new Uint8Array(this.analyser.frequencyBinCount);
    const startWall = performance.now();
    const totalDur = audioBuffer.duration;

    this.sourceNode.onended = () => {
      this.isPreviewing = false;
    };
    this.sourceNode.start(0);

    const loop = () => {
      if (!this.isPreviewing) return;
      const elapsed = (performance.now() - startWall) / 1000;
      this.analyser.getByteFrequencyData(freqData);
      this.drawFrame(freqData, elapsed, totalDur);
      if (elapsed < totalDur) {
        this.animationFrameId = requestAnimationFrame(loop);
      } else {
        this.isPreviewing = false;
      }
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Renders and exports video using MediaRecorder and AudioBuffer
   */
  async exportVideo(audioBuffer, songMeta, coverUrl, onProgress = () => {}) {
    this.stop();
    this.audioBuffer = audioBuffer;
    this.setSongMeta(songMeta, audioBuffer.duration);
    this.updateCanvasDimensions();

    onProgress(2, 'Loading album artwork...');
    await this.loadCoverImage(coverUrl);

    onProgress(5, 'Initializing Web Audio DSP...');
    this.audioCtx = AudioConverter.getAudioContext();

    const dest = this.audioCtx.createMediaStreamDestination();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = audioBuffer;
    this.sourceNode.connect(this.analyser);
    this.sourceNode.connect(dest);

    const canvasStream = this.canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    let mimeType = 'video/webm; codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1,mp4a.40.2"')) {
      mimeType = 'video/mp4; codecs="avc1,mp4a.40.2"';
    }

    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 6000000
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    return new Promise((resolve, reject) => {
      const totalDuration = audioBuffer.duration;
      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      const startWallTime = performance.now();

      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        if (this.sourceNode) {
          try { this.sourceNode.stop(); } catch (e) {}
        }
        cancelAnimationFrame(this.animationFrameId);
        onProgress(100, 'Packaging video file...');
        const videoBlob = new Blob(this.recordedChunks, { type: mimeType });
        resolve(videoBlob);
      };

      this.mediaRecorder.onerror = (err) => {
        this.isRecording = false;
        cancelAnimationFrame(this.animationFrameId);
        reject(err);
      };

      this.isRecording = true;
      this.mediaRecorder.start(200);
      this.sourceNode.start(0);

      const render = () => {
        if (!this.isRecording) return;

        const elapsedSec = (performance.now() - startWallTime) / 1000;
        this.analyser.getByteFrequencyData(freqData);
        this.drawFrame(freqData, elapsedSec, totalDuration);

        const percent = Math.min(99, Math.floor((elapsedSec / totalDuration) * 100));
        onProgress(percent, `Rendering frame: ${this.formatTime(elapsedSec)} / ${this.formatTime(totalDuration)} (${percent}%)`);

        if (elapsedSec >= totalDuration) {
          this.mediaRecorder.stop();
        } else {
          this.animationFrameId = requestAnimationFrame(render);
        }
      };

      this.animationFrameId = requestAnimationFrame(render);
    });
  }

  stop() {
    this.isRecording = false;
    this.isPreviewing = false;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (e) {}
    }
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (e) {}
      try { this.sourceNode.disconnect(); } catch (e) {}
      this.sourceNode = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
