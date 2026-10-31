/**
 * Suno Downloader Pro - World-Class Video Generator & Karaoke Visualizer Studio
 * Renders 1080p Full HD audio-visualizer videos with synchronized Karaoke Lyrics Burn-In,
 * 6 Kinetic Animation Templates (CapCut Spring Pop, Viral Highlighter, Liquid Wipe, Floating Wave, Glitch, Classic),
 * Custom Album Artwork & Spinning Vinyl Record Center Label, Custom Cinema Backdrops,
 * Audio-Reactive Particles, 4 Visualizer Engines, and 60 FPS Export.
 */

import { AudioConverter } from './audio-converter.js?v=2026.4';
import { LyricsUtils } from './lyrics-utils.js?v=2026.4';

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
    this.visualStyle = options.visualStyle || 'bars'; // 'bars' | 'wave' | 'circular' | 'mirrored_bars' | 'none'
    this.showVisualizer = options.showVisualizer !== false;
    this.vizPosition = options.vizPosition || 'below_artwork'; // 'below_artwork' | 'center_screen' | 'bottom_dock' | 'around_artwork' | 'split_side'
    this.vizWidthPercent = options.vizWidthPercent || 0.74; // 0.25 .. 0.98
    this.vizMaxHeight = options.vizMaxHeight || 120; // 40 .. 260
    this.theme = options.theme || 'sunset';
    this.customColors = options.customColors || null; // { primary, secondary, glow }
    this.showLyrics = options.showLyrics !== false;

    // Custom Freeform Component Drag Positions (Normalized 0..1 coordinates)
    this.customPositions = options.customPositions ? { ...options.customPositions } : {
      artwork: null,
      visualizer: null,
      lyrics: null,
      title: null
    };
    this.lastComponentBoxes = {};
    this.activeDragComponent = null;
    this.hoveredComponent = null;
    this.dragOffset = { dx: 0, dy: 0 };
    this.showDragGuides = true;
    this.lastRenderTime = 0;

    // Studio & Brand Customization
    this.studioName = options.studioName || 'NTK Hub';
    this.studioSubtitle = options.studioSubtitle || 'Official Visualizer';
    this.watermarkPos = options.watermarkPos || 'top-left'; // 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    this.showFooter = options.showFooter !== false;

    // Cinema Background Customization
    this.backgroundImage = null;
    this.customBgDataUrl = options.customBgDataUrl || null;
    this.bgFitMode = options.bgFitMode || 'cover'; // 'cover' | 'contain'
    this.bgDimOpacity = options.bgDimOpacity !== undefined ? options.bgDimOpacity : 0.40; // 0.0 .. 1.0
    this.bgBlurPx = options.bgBlurPx !== undefined ? options.bgBlurPx : 20; // 0 .. 80
    this.bgMotion = options.bgMotion || 'ken-burns'; // 'ken-burns' | 'pulse' | 'static'

    // Atmospheric Particle Field
    this.showParticles = options.showParticles !== false;
    this.particles = this._initParticles(55);

    // Artwork & Vinyl Presentation Mode
    this.artMode = options.artMode || 'card'; // 'card' | 'vinyl' | 'none'
    this.artSizeScale = options.artSizeScale || 0.44; // 0.30 .. 0.70
    this.artCornerRadius = options.artCornerRadius !== undefined ? options.artCornerRadius : 28; // number or 'circle'
    this.artGlowIntensity = options.artGlowIntensity !== undefined ? options.artGlowIntensity : 0.7;
    this.customCoverDataUrl = options.customCoverDataUrl || null;
    this.customCoverImage = null;

    // Typography & Animated Lyrics
    this.fontFamily = options.fontFamily || 'Inter'; // 'Inter' | 'Playfair Display' | 'Montserrat' | 'Orbitron'
    this.lyricPosition = options.lyricPosition || 'lower-third'; // 'lower-third' | 'center' | 'top'
    this.lyricAnimation = options.lyricAnimation || 'capcut_bounce'; // 'capcut_bounce' | 'highlighter' | 'karaoke_wipe' | 'floating_wave' | 'glitch_pulse' | 'classic'

    // Video Export Quality
    this.fps = options.fps || 60; // 30 | 60
    this.bitrateMbps = options.bitrateMbps || 12; // 4 .. 16

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

  _initParticles(count) {
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        size: 1.5 + Math.random() * 3.5,
        speed: 0.02 + Math.random() * 0.06,
        opacity: 0.25 + Math.random() * 0.65,
        colorType: i % 3 // 0: primary, 1: secondary, 2: white
      });
    }
    return particles;
  }

  getActivePalette() {
    if (this.customColors && this.customColors.primary) {
      return {
        primary: this.customColors.primary,
        secondary: this.customColors.secondary || this.customColors.primary,
        glow: this.customColors.glow || '245, 158, 11'
      };
    }
    return VideoGenerator.THEMES[this.theme] || VideoGenerator.THEMES.sunset;
  }

  setSongMeta(meta, durationOverride = 0) {
    this.songMeta = meta;
    const dur = durationOverride || (meta && meta.duration) || 180;
    this.lyricCues = LyricsUtils.getTimedCues((meta && meta.prompt) || '', dur);
  }

  setCustomLyrics(rawLyrics, durationOverride = 0) {
    const dur = durationOverride || (this.songMeta && this.songMeta.duration) || 180;
    this.lyricCues = LyricsUtils.getTimedCues(rawLyrics, dur);
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

  async loadCustomCover(urlOrBase64) {
    return new Promise((resolve) => {
      if (!urlOrBase64) {
        this.customCoverImage = null;
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.customCoverImage = img;
        resolve(img);
      };
      img.onerror = () => {
        this.customCoverImage = null;
        resolve(null);
      };
      img.src = urlOrBase64;
    });
  }

  setCustomCover(dataUrl) {
    this.customCoverDataUrl = dataUrl;
    if (dataUrl) {
      return this.loadCustomCover(dataUrl);
    } else {
      this.customCoverImage = null;
      return Promise.resolve(null);
    }
  }

  async loadBackgroundImage(urlOrBase64) {
    return new Promise((resolve) => {
      if (!urlOrBase64) {
        this.backgroundImage = null;
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.backgroundImage = img;
        resolve(img);
      };
      img.onerror = () => {
        this.backgroundImage = null;
        resolve(null);
      };
      img.src = urlOrBase64;
    });
  }

  setCustomBackground(dataUrl) {
    this.customBgDataUrl = dataUrl;
    if (dataUrl) {
      return this.loadBackgroundImage(dataUrl);
    } else {
      this.backgroundImage = null;
      return Promise.resolve(null);
    }
  }

  _makePlaceholderImage() {
    const placeholder = document.createElement('canvas');
    placeholder.width = 500;
    placeholder.height = 500;
    const pctx = placeholder.getContext('2d');
    const pal = this.getActivePalette();
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

  _wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
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
   * Generates a 2D clipping and border path for any card geometry
   */
  _createCardPath(ctx, cx, cy, size, shape) {
    ctx.beginPath();
    const half = size / 2;
    const x = cx - half;
    const y = cy - half;

    if (shape === 'circle') {
      ctx.arc(cx, cy, half, 0, Math.PI * 2);
    } else if (shape === 'stadium') {
      ctx.roundRect(x, y, size, size, half);
    } else if (shape === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + half * Math.cos(a);
        const py = cy + half * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (shape === 'diamond') {
      ctx.moveTo(cx, y);
      ctx.lineTo(x + size, cy);
      ctx.lineTo(cx, y + size);
      ctx.lineTo(x, cy);
      ctx.closePath();
    } else if (shape === 'chamfer') {
      const c = size * 0.15;
      ctx.moveTo(x + c, y);
      ctx.lineTo(x + size - c, y);
      ctx.lineTo(x + size, y + c);
      ctx.lineTo(x + size, y + size - c);
      ctx.lineTo(x + size - c, y + size);
      ctx.lineTo(x + c, y + size);
      ctx.lineTo(x, y + size - c);
      ctx.lineTo(x, y + c);
      ctx.closePath();
    } else {
      const radius = typeof shape === 'number' ? Math.max(0, shape) : (Number(shape) || 0);
      ctx.roundRect(x, y, size, size, radius);
    }
  }

  /**
   * Draws a single 1080p frame onto the canvas
   */
  drawFrame(freqData, currentTime = 0, totalDuration = 0) {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pal = this.getActivePalette();
    const isVertical = this.aspectRatio === '9:16';
    const isLandscape = this.aspectRatio === '16:9';

    ctx.clearRect(0, 0, w, h);

    // Compute audio bass energy (0..1)
    let energy = 0;
    if (freqData && freqData.length > 0) {
      let sum = 0;
      const count = Math.min(16, freqData.length);
      for (let i = 0; i < count; i++) sum += freqData[i];
      energy = sum / count / 255;
    }

    // 1. Deep Obsidian Base
    ctx.fillStyle = '#06080d';
    ctx.fillRect(0, 0, w, h);

    // 2. Cinema Background (Custom Image or Ambient Artwork)
    const activeCover = this.customCoverImage || this.coverImage;
    const activeBgImg = this.backgroundImage || activeCover;

    if (activeBgImg) {
      ctx.save();

      // Motion: Camera Motion calculation
      let scale = 1.0;
      let offsetX = 0;
      let offsetY = 0;
      let angle = 0;

      const progress = totalDuration > 0 ? (currentTime / totalDuration) : 0;

      if (this.bgMotion === 'ken-burns') {
        // 1. Cinematic Zoom-In & Drift (Slow Zoom + Pan)
        const drift = 1.05 + progress * 0.12;
        scale = drift * (1.0 + energy * 0.02);
        offsetX = Math.sin(progress * Math.PI) * w * 0.025;
        offsetY = Math.cos(progress * Math.PI) * h * 0.015;
      } else if (this.bgMotion === 'zoom_out') {
        // 2. Reverse Zoom-Out (Dramatic Reveal)
        const drift = 1.22 - progress * 0.15;
        scale = drift * (1.0 + energy * 0.02);
        offsetX = -Math.sin(progress * Math.PI) * w * 0.02;
      } else if (this.bgMotion === 'pan_drift') {
        // 3. Fluid Orbital Pan (Smooth Horizontal Sweep)
        scale = 1.15 * (1.0 + energy * 0.015);
        offsetX = Math.sin(currentTime * 0.25) * w * 0.04;
        offsetY = Math.cos(currentTime * 0.18) * h * 0.02;
      } else if (this.bgMotion === 'pulse') {
        // 4. Pure Bass Subwoofer Pump
        scale = 1.0 + energy * 0.065;
      } else if (this.bgMotion === 'handheld') {
        // 5. Organic Handheld Cam
        scale = 1.08;
        offsetX = (Math.sin(currentTime * 0.8) * 0.012 + Math.sin(currentTime * 1.9) * 0.006) * w;
        offsetY = (Math.cos(currentTime * 0.6) * 0.012 + Math.cos(currentTime * 1.7) * 0.006) * h;
        angle = Math.sin(currentTime * 0.7) * 0.006;
      } else if (this.bgMotion === 'hyperspace') {
        // 6. 3D Parallax & Dutch Angle Roll
        scale = 1.12 + Math.sin(currentTime * 0.45) * 0.035 + energy * 0.03;
        angle = Math.sin(currentTime * 0.35) * 0.02;
        offsetX = Math.sin(currentTime * 0.6) * w * 0.02;
      } else if (this.bgMotion === 'heartbeat') {
        // 7. Double-Pump Heartbeat Pulse
        const beatCycle = (currentTime * 2.2) % 1.0;
        const pump1 = Math.exp(-beatCycle * 18) * 0.045;
        const pump2 = (beatCycle > 0.22) ? Math.exp(-(beatCycle - 0.22) * 18) * 0.03 : 0;
        scale = 1.04 + pump1 + pump2 + energy * 0.025;
      } else {
        // 8. Lock-Off Static
        scale = 1.0;
      }

      if (this.bgBlurPx > 0) {
        ctx.filter = `blur(${this.bgBlurPx}px)`;
      }

      // Draw background with aspect cover centered with transforms
      const imgRatio = (activeBgImg.naturalWidth || activeBgImg.width || 1) / (activeBgImg.naturalHeight || activeBgImg.height || 1);
      const canvasRatio = w / h;
      let drawW, drawH;

      if (canvasRatio > imgRatio) {
        drawW = w * scale;
        drawH = (w / imgRatio) * scale;
      } else {
        drawH = h * scale;
        drawW = (h * imgRatio) * scale;
      }

      ctx.translate(w / 2 + offsetX, h / 2 + offsetY);
      if (angle) ctx.rotate(angle);
      ctx.drawImage(activeBgImg, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }

    // 3. Dimming Scrim Layer & Cinematic Vignette
    if (this.bgDimOpacity > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(5, 7, 12, ${this.bgDimOpacity})`;
      ctx.fillRect(0, 0, w, h);

      // Radial Vignette
      const vigGrad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.85);
      vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vigGrad.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 4. Atmospheric Audio-Reactive Particle Field
    if (this.showParticles) {
      ctx.save();
      for (const p of this.particles) {
        // Drift upward, pulsing with bass energy
        p.y -= p.speed * 0.003 * (1 + energy * 2.2);
        if (p.y < -0.05) {
          p.y = 1.05;
          p.x = Math.random();
        }

        const px = p.x * w;
        const py = p.y * h;
        const curSize = p.size * (1 + energy * 0.5);

        ctx.beginPath();
        ctx.arc(px, py, curSize, 0, Math.PI * 2);
        let pColor = '#ffffff';
        if (p.colorType === 0) pColor = pal.primary;
        else if (p.colorType === 1) pColor = pal.secondary;

        ctx.fillStyle = pColor;
        ctx.globalAlpha = p.opacity * (0.35 + energy * 0.65);
        ctx.shadowColor = pColor;
        ctx.shadowBlur = 8;
        ctx.fill();
      }
      ctx.restore();
    }

    // Layout Anchors (Symmetrical Balance vs. Cinema Split View)
    const hasLyricsActive = this.showLyrics && this.lyricCues && this.lyricCues.length > 0;
    const isSplit = isLandscape && this.vizPosition === 'split_side';
    let cx = isSplit ? w * 0.30 : w / 2;
    let cy = isVertical
      ? h * 0.31
      : (isLandscape
          ? (isSplit ? h * 0.50 : (hasLyricsActive ? h * 0.28 : h * 0.36))
          : h * 0.36);

    if (this.customPositions && this.customPositions.artwork) {
      cx = this.customPositions.artwork.x * w;
      cy = this.customPositions.artwork.y * h;
    }

    const baseCoverSize = Math.min(w, h) * (isVertical ? this.artSizeScale * 1.15 : (isLandscape && !isSplit ? (hasLyricsActive ? this.artSizeScale * 0.72 : this.artSizeScale * 0.88) : this.artSizeScale));
    const currentCoverSize = baseCoverSize * (1 + energy * 0.035);

    if (this.artMode !== 'none') {
      this.lastComponentBoxes.artwork = {
        id: 'artwork',
        name: this.artMode === 'vinyl' ? 'Vinyl Turntable' : 'Album Artwork',
        x: cx - currentCoverSize / 2,
        y: cy - currentCoverSize / 2,
        w: currentCoverSize,
        h: currentCoverSize,
        cx,
        cy
      };
    } else {
      this.lastComponentBoxes.artwork = null;
    }

    // 5. Artwork Presentation: Glass Card vs. Spinning Vinyl Record
    if (this.artMode === 'vinyl') {
      // --- SPINNING VINYL RECORD DISC ---
      ctx.save();
      const vinylRadius = currentCoverSize * 0.56;
      const spinAngle = currentTime * 2.2; // Continuous turntable rotation

      // Vinyl Drop Shadow
      ctx.shadowColor = `rgba(${pal.glow}, ${0.35 + energy * 0.45})`;
      ctx.shadowBlur = 32 + energy * 24;
      ctx.shadowOffsetY = 12;

      // Base Vinyl Disc
      ctx.beginPath();
      ctx.arc(cx, cy, vinylRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0c11';
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Concentric Vinyl Grooves
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spinAngle);

      for (let r = vinylRadius * 0.48; r < vinylRadius * 0.98; r += 4) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = (Math.round(r) % 8 === 0) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Vinyl Specular Sheen (2 opposite lighting wedges)
      const sheenGrad = ctx.createLinearGradient(-vinylRadius, -vinylRadius, vinylRadius, vinylRadius);
      sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      sheenGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.0)');
      sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
      ctx.fillStyle = sheenGrad;
      ctx.beginPath();
      ctx.arc(0, 0, vinylRadius, 0, Math.PI * 2);
      ctx.fill();

      // Center Album Label
      const labelRadius = vinylRadius * 0.44;
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
      ctx.clip();

      if (activeCover && activeCover !== this.coverImage) {
        // User uploaded custom artwork / label
        ctx.drawImage(activeCover, -labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
      } else if (this.coverImage && this.songMeta && this.songMeta.imageLarge) {
        // Online song artwork
        ctx.drawImage(this.coverImage, -labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
      } else {
        // Authentic Vinyl Record Label Print (Classy Retro Disc)
        const lGrad = ctx.createLinearGradient(-labelRadius, -labelRadius, labelRadius, labelRadius);
        lGrad.addColorStop(0, pal.primary);
        lGrad.addColorStop(1, pal.secondary);
        ctx.fillStyle = lGrad;
        ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);

        ctx.fillStyle = '#0a0d14';
        ctx.font = `bold ${Math.floor(labelRadius * 0.22)}px "${this.fontFamily}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelText = (this.songMeta && this.songMeta.title) ? this.songMeta.title.slice(0, 16) : 'NTK HUB';
        ctx.fillText(labelText, 0, -labelRadius * 0.30);

        ctx.font = `700 ${Math.floor(labelRadius * 0.13)}px "${this.fontFamily}", sans-serif`;
        ctx.fillText('33⅓ RPM • STEREO', 0, labelRadius * 0.35);
      }
      ctx.restore();

      // Label Ring & Spindle Hole
      ctx.beginPath();
      ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.stroke();

      // Metallic Spindle Ring
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#06080d';
      ctx.fill();

      ctx.restore(); // Restore spin
      ctx.restore(); // Restore vinyl base
    } else if (this.artMode === 'card') {
      // --- MODERN GLASS ARTWORK CARD ---
      ctx.save();
      ctx.shadowColor = `rgba(${pal.glow}, ${(0.28 + energy * 0.38) * this.artGlowIntensity})`;
      ctx.shadowBlur = (34 + energy * 26) * this.artGlowIntensity;
      ctx.shadowOffsetY = 14;

      this._createCardPath(ctx, cx, cy, currentCoverSize, this.artCornerRadius);
      ctx.fillStyle = '#11141f';
      ctx.fill();

      if (activeCover) {
        ctx.save();
        this._createCardPath(ctx, cx, cy, currentCoverSize, this.artCornerRadius);
        ctx.clip();
        ctx.drawImage(
          activeCover,
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
      this._createCardPath(ctx, cx, cy, currentCoverSize, this.artCornerRadius);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Visualizer Engine
    const isVisualizerEnabled = this.showVisualizer !== false && this.visualStyle !== 'none';

    if (isVisualizerEnabled && freqData && freqData.length > 0) {
      // 6A. Circular Halo
      if (this.visualStyle === 'circular' || this.vizPosition === 'around_artwork') {
        let haloCx = cx;
        let haloCy = cy;
        if (this.customPositions && this.customPositions.visualizer) {
          haloCx = this.customPositions.visualizer.x * w;
          haloCy = this.customPositions.visualizer.y * h;
        }

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

          const x1 = haloCx + Math.cos(angle) * radius;
          const y1 = haloCy + Math.sin(angle) * radius;
          const x2 = haloCx + Math.cos(angle) * (radius + barLen);
          const y2 = haloCy + Math.sin(angle) * (radius + barLen);

          ctx.strokeStyle = i % 2 === 0 ? pal.primary : pal.secondary;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.restore();

        const maxHaloSpoke = baseCoverSize * 0.28 + 16;
        this.lastComponentBoxes.visualizer = {
          id: 'visualizer',
          name: 'Radial Halo Visualizer',
          x: haloCx - radius - maxHaloSpoke,
          y: haloCy - radius - maxHaloSpoke,
          w: (radius + maxHaloSpoke) * 2,
          h: (radius + maxHaloSpoke) * 2,
          cx: haloCx,
          cy: haloCy
        };
      }

      // 6B. Linear Visualizers (bars, wave, mirrored_bars)
      if (this.visualStyle !== 'circular' && this.vizPosition !== 'around_artwork') {
        let vizCenterX = w / 2;
        let vizBaseY = h * 0.65;
        const vizWidth = w * (this.vizWidthPercent || 0.74);
        const maxVizHeight = this.vizMaxHeight || 120;

        if (this.vizPosition === 'split_side' || isSplit) {
          vizCenterX = w * 0.70;
          vizBaseY = isLandscape ? h * 0.80 : h * 0.65;
        } else if (this.vizPosition === 'center_screen') {
          vizCenterX = w / 2;
          vizBaseY = h * 0.50;
        } else if (this.vizPosition === 'bottom_dock') {
          vizCenterX = w / 2;
          vizBaseY = h * 0.94;
        } else { // 'below_artwork'
          vizCenterX = w / 2;
          const cardBottom = cy + currentCoverSize / 2;
          vizBaseY = isVertical
            ? Math.max(h * 0.58, cardBottom + 65)
            : (isLandscape
                ? (hasLyricsActive ? Math.min(h * 0.53, cardBottom + 48) : Math.min(h * 0.66, cardBottom + 55))
                : Math.min(h * 0.72, cardBottom + 55));
        }

        if (this.customPositions && this.customPositions.visualizer) {
          vizCenterX = this.customPositions.visualizer.x * w;
          vizBaseY = this.customPositions.visualizer.y * h;
        }

        const vizBoxH = this.visualStyle === 'mirrored_bars' ? maxVizHeight * 2 : maxVizHeight;
        const vizBoxY = this.visualStyle === 'mirrored_bars' ? vizBaseY - maxVizHeight : vizBaseY - maxVizHeight;
        this.lastComponentBoxes.visualizer = {
          id: 'visualizer',
          name: this.visualStyle === 'wave' ? 'Wave Visualizer' : 'Spectrum Bars',
          x: vizCenterX - vizWidth / 2,
          y: vizBoxY,
          w: vizWidth,
          h: vizBoxH,
          cx: vizCenterX,
          cy: vizBaseY
        };

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
        } else if (this.visualStyle === 'mirrored_bars') {
          // Mirrored Dual Bars (Extending both UP and DOWN)
          const numBars = 48;
          const barWidth = vizWidth / numBars;
          const barGrad = ctx.createLinearGradient(0, vizBaseY - maxVizHeight, 0, vizBaseY + maxVizHeight);
          barGrad.addColorStop(0, pal.secondary);
          barGrad.addColorStop(0.5, pal.primary);
          barGrad.addColorStop(1, pal.secondary);
          ctx.fillStyle = barGrad;

          for (let i = 0; i < numBars; i++) {
            const binIndex = Math.floor(Math.pow(i / numBars, 1.35) * (freqData.length * 0.65));
            const val = freqData[binIndex] || 0;
            const halfH = Math.max(4, (val / 255) * (maxVizHeight * 0.58));
            const bx = startX + i * barWidth;
            ctx.beginPath();
            ctx.roundRect(bx + 2, vizBaseY - halfH, Math.max(2, barWidth - 4), halfH * 2, 4);
            ctx.fill();
          }
        } else {
          // Standard Spectrum Bars
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
    }

    // 7. Synchronized Kinetic Karaoke Lyrics
    let textCenterX = isSplit ? w * 0.70 : w / 2;
    const hasCues = this.showLyrics && this.lyricCues && this.lyricCues.length > 0;

    if (hasCues) {
      let activeIdx = -1;
      for (let i = 0; i < this.lyricCues.length; i++) {
        if (currentTime >= this.lyricCues[i].start && currentTime < this.lyricCues[i].end) {
          activeIdx = i;
          break;
        }
      }
      // Show first sung cue when paused at 0:00 so user can inspect style & drag-position lyrics
      if (activeIdx === -1 && !this.isPreviewing && !this.isRecording && currentTime < 0.05 && this.lyricCues.length > 0) {
        activeIdx = 0;
      }

      const activeCue = activeIdx >= 0 ? this.lyricCues[activeIdx] : null;
      const nextCue = (activeIdx >= 0 && activeIdx + 1 < this.lyricCues.length) ? this.lyricCues[activeIdx + 1] : null;

      let lyricBoxY = isVertical ? h * 0.72 : (isLandscape ? (isSplit ? h * 0.48 : h * 0.70) : h * 0.74);
      if (this.lyricPosition === 'center') {
        lyricBoxY = isLandscape && !isSplit ? h * 0.62 : h * 0.50;
      } else if (this.lyricPosition === 'top') {
        lyricBoxY = isVertical ? h * 0.16 : (isLandscape && isSplit ? h * 0.28 : h * 0.16);
      }

      if (this.customPositions && this.customPositions.lyrics) {
        textCenterX = this.customPositions.lyrics.x * w;
        lyricBoxY = this.customPositions.lyrics.y * h;
      }

      const maxTextW = isLandscape ? (isSplit ? w * 0.46 : w * 0.58) : w * 0.80;

      ctx.save();
      const mainFontPx = Math.floor(Math.min(w, h) * (isVertical ? 0.038 : 0.032));
      ctx.font = `800 ${mainFontPx}px "${this.fontFamily}", system-ui, sans-serif`;

      if (activeCue) {
        const wrapped = this._wrapText(ctx, activeCue.text, maxTextW);
        const pillH = wrapped.length * (mainFontPx * 1.34) + (nextCue ? mainFontPx * 1.25 : 24) + 24;
        const pillW = maxTextW + 48;

        this.lastComponentBoxes.lyrics = {
          id: 'lyrics',
          name: 'Kinetic Lyrics',
          x: textCenterX - pillW / 2,
          y: lyricBoxY - 22,
          w: pillW,
          h: pillH,
          cx: textCenterX,
          cy: lyricBoxY + pillH / 2 - 22
        };

        // Container Scrim
        ctx.fillStyle = 'rgba(10, 12, 19, 0.68)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(textCenterX - pillW / 2, lyricBoxY - 22, pillW, pillH, 22);
        ctx.fill();
        ctx.stroke();

        const cueDuration = Math.max(0.4, activeCue.end - activeCue.start);

        // Render Animated Words Per Line
        wrapped.forEach((lineText, lineIdx) => {
          const words = lineText.split(/\s+/).filter(Boolean);
          if (words.length === 0) return;

          const wordWidths = words.map((wd) => ctx.measureText(wd + ' ').width);
          const lineTotalW = wordWidths.reduce((a, b) => a + b, 0);
          let wordX = textCenterX - lineTotalW / 2;
          const lineY = lyricBoxY + 14 + lineIdx * (mainFontPx * 1.32);

          words.forEach((wd, wIdx) => {
            const wdW = wordWidths[wIdx];
            const wordStartRatio = wIdx / words.length;
            const wordEndRatio = (wIdx + 1) / words.length;
            const wordStartTime = activeCue.start + wordStartRatio * cueDuration;
            const wordEndTime = activeCue.start + wordEndRatio * cueDuration;

            const isActive = currentTime >= wordStartTime && currentTime < wordEndTime;
            const isPast = currentTime >= wordEndTime;
            const isFuture = currentTime < wordStartTime;
            const wordProgress = isActive ? Math.max(0, Math.min(1, (currentTime - wordStartTime) / Math.max(0.01, wordEndTime - wordStartTime))) : 0;

            ctx.save();

            if (this.lyricAnimation === 'capcut_bounce') {
              // --- 1. CAPCUT BOUNCY POP ---
              if (isActive) {
                const spring = Math.sin(wordProgress * Math.PI) * 0.32;
                const lift = -Math.sin(wordProgress * Math.PI) * 12;
                ctx.translate(wordX + wdW / 2, lineY + lift);
                ctx.scale(1 + spring, 1 + spring);
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(${pal.glow}, 0.95)`;
                ctx.shadowBlur = 28;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(wd, 0, 0);
              } else if (isPast) {
                ctx.fillStyle = '#ffffff';
                ctx.shadowBlur = 0;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(wd, wordX, lineY);
              } else {
                ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
                ctx.shadowBlur = 0;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'highlighter') {
              // --- 2. VIRAL SHORTS HIGHLIGHT PILL ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              if (isActive) {
                const bounce = Math.sin(wordProgress * Math.PI) * 4;
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(${pal.glow}, 0.85)`;
                ctx.shadowBlur = 20;
                ctx.beginPath();
                ctx.roundRect(wordX - 4, lineY - mainFontPx * 0.82 - bounce, wdW + 8, mainFontPx * 1.34, 10);
                ctx.fill();

                ctx.fillStyle = '#0a0d14'; // High-contrast black on neon
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY - bounce);
              } else if (isPast) {
                ctx.fillStyle = '#ffffff';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              } else {
                ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'karaoke_wipe') {
              // --- 3. LIQUID KARAOKE WIPE ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = 'rgba(148, 163, 184, 0.40)';
              ctx.fillText(wd, wordX, lineY);

              if (isPast) {
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(${pal.glow}, 0.70)`;
                ctx.shadowBlur = 14;
                ctx.fillText(wd, wordX, lineY);
              } else if (isActive) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(wordX - 2, lineY - mainFontPx, wdW * wordProgress + 4, mainFontPx * 2);
                ctx.clip();
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(${pal.glow}, 0.90)`;
                ctx.shadowBlur = 20;
                ctx.fillText(wd, wordX, lineY);
                ctx.restore();
              }
            } else if (this.lyricAnimation === 'floating_wave') {
              // --- 4. KINETIC FLOATING WAVE & SHIMMER ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              const waveLift = Math.sin(currentTime * 4.5 + wIdx * 0.85) * 8;
              const isLit = isActive || Math.sin(currentTime * 3.5 - wIdx * 0.6) > 0.4;
              ctx.fillStyle = isActive ? pal.primary : (isLit ? '#ffffff' : pal.secondary);
              ctx.shadowColor = `rgba(${pal.glow}, ${isActive ? 0.95 : 0.4})`;
              ctx.shadowBlur = isActive ? 24 : 8;
              ctx.fillText(wd, wordX, lineY + waveLift);
            } else if (this.lyricAnimation === 'glitch_pulse') {
              // --- 5. CYBERPUNK GLITCH PULSE ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              if (isActive) {
                const shake = (Math.random() - 0.5) * 4 * (1 + energy);
                ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
                ctx.fillText(wd, wordX - 3 + shake, lineY);
                ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
                ctx.fillText(wd, wordX + 3 + shake, lineY);
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = pal.primary;
                ctx.shadowBlur = 18;
                ctx.fillText(wd, wordX + shake, lineY);
              } else {
                ctx.fillStyle = isPast ? '#ffffff' : 'rgba(148, 163, 184, 0.45)';
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'typewriter') {
              // --- 6. TERMINAL TYPEWRITER & BLINKING CURSOR ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              if (isFuture) {
                // Future words remain unrevealed
              } else if (isActive) {
                const charsToShow = Math.max(1, Math.ceil(wd.length * wordProgress));
                const partial = wd.slice(0, charsToShow);
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(${pal.glow}, 0.85)`;
                ctx.shadowBlur = 18;
                ctx.fillText(partial, wordX, lineY);

                if (Math.floor(currentTime * 4) % 2 === 0) {
                  const partialWidth = ctx.measureText(partial).width;
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(wordX + partialWidth + 3, lineY - mainFontPx * 0.45, 3.5, mainFontPx * 0.9);
                }
              } else {
                ctx.fillStyle = '#ffffff';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'zoom_impact') {
              // --- 7. BEAST MODE STOMP (KINETIC SLAM & FLASH) ---
              if (isActive) {
                const slam = Math.max(0, 1 - wordProgress);
                const scale = 1.0 + Math.pow(slam, 2) * 0.90;
                ctx.translate(wordX + wdW / 2, lineY);
                ctx.scale(scale, scale);
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(255, 255, 255, ${0.45 + slam * 0.55})`;
                ctx.shadowBlur = 18 + slam * 26;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(wd, 0, 0);
              } else {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isPast ? '#ffffff' : 'rgba(148, 163, 184, 0.40)';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'neon_flicker') {
              // --- 8. TOKYO NEON SIGN (ELECTRIC TUBE FLICKER) ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              if (isActive) {
                const flicker = (Math.sin(currentTime * 28 + wIdx * 2.3) > -0.25) ? 1.0 : 0.35;
                ctx.lineWidth = 3.5;
                ctx.strokeStyle = pal.secondary;
                ctx.shadowColor = `rgba(${pal.glow}, ${0.95 * flicker})`;
                ctx.shadowBlur = 24 * flicker;
                ctx.strokeText(wd, wordX, lineY);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(wd, wordX, lineY);
              } else if (isPast) {
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = `rgba(${pal.glow}, 0.60)`;
                ctx.strokeText(wd, wordX, lineY);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(wd, wordX, lineY);
              } else {
                ctx.fillStyle = 'rgba(100, 116, 139, 0.35)';
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'color_cascade') {
              // --- 9. CHROMATIC COLOR CASCADE ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              if (isActive) {
                const hue = (currentTime * 160 + wIdx * 45) % 360;
                const hop = Math.sin(wordProgress * Math.PI) * 6;
                ctx.fillStyle = `hsl(${hue}, 95%, 68%)`;
                ctx.shadowColor = `hsl(${hue}, 95%, 50%)`;
                ctx.shadowBlur = 22;
                ctx.fillText(wd, wordX, lineY - hop);
              } else {
                ctx.fillStyle = isPast ? '#ffffff' : 'rgba(148, 163, 184, 0.40)';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'fade_slide_up') {
              // --- 10. CINEMATIC VERTICAL LIFT & GLOW ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              if (isActive) {
                const lift = (1 - Math.min(1, wordProgress * 2.2)) * 14;
                const alpha = Math.min(1, wordProgress * 2.8);
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(${pal.glow}, ${0.85 * alpha})`;
                ctx.shadowBlur = 20 * alpha;
                ctx.fillText(wd, wordX, lineY + lift);
              } else if (isPast) {
                ctx.fillStyle = '#ffffff';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              } else {
                ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              }
            } else if (this.lyricAnimation === 'spotlight_scale') {
              // --- 11. FOCUS SPOTLIGHT (DEPTH BLUR) ---
              if (isActive) {
                ctx.translate(wordX + wdW / 2, lineY);
                ctx.scale(1.26, 1.26);
                ctx.fillStyle = pal.primary;
                ctx.shadowColor = `rgba(255, 255, 255, 0.95)`;
                ctx.shadowBlur = 26;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(wd, 0, 0);
              } else {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isPast ? 'rgba(255, 255, 255, 0.65)' : 'rgba(148, 163, 184, 0.28)';
                ctx.shadowBlur = 0;
                ctx.fillText(wd, wordX, lineY);
              }
            } else {
              // --- 12. CLASSIC BROADCAST LINE ---
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = activeCue.isSection ? pal.primary : '#ffffff';
              ctx.shadowColor = `rgba(${pal.glow}, 0.50)`;
              ctx.shadowBlur = 14;
              ctx.fillText(wd, wordX, lineY);
            }

            ctx.restore();
            wordX += wdW;
          });
        });

        // Subtitle / Next Line Preview
        if (nextCue) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const subPx = Math.floor(mainFontPx * 0.72);
          ctx.font = `600 ${subPx}px "${this.fontFamily}", system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(148, 163, 184, 0.82)';
          const nextShort = nextCue.text.length > 56 ? nextCue.text.slice(0, 54) + '...' : nextCue.text;
          ctx.fillText(nextShort, textCenterX, lyricBoxY + 18 + wrapped.length * (mainFontPx * 1.32));
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 8. Song Title & Studio Metadata Footer
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let titleX = isSplit ? w * 0.70 : w / 2;
    let titleY = isVertical
      ? h * 0.89
      : (isSplit ? h * 0.18 : (hasCues && this.lyricPosition === 'lower-third' ? h * 0.91 : h * 0.89));

    if (this.customPositions && this.customPositions.title) {
      titleX = this.customPositions.title.x * w;
      titleY = this.customPositions.title.y * h;
    }

    const titleFontPx = Math.floor(Math.min(w, h) * 0.036);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${titleFontPx}px "${this.fontFamily}", system-ui, sans-serif`;
    const displayTitle = (this.songMeta && this.songMeta.title) ? this.songMeta.title : 'Suno AI Song';
    ctx.fillText(displayTitle.slice(0, 42), titleX, titleY);

    if (this.showFooter !== false) {
      const subFontPx = Math.floor(Math.min(w, h) * 0.019);
      ctx.fillStyle = pal.primary;
      ctx.font = `600 ${subFontPx}px "${this.fontFamily}", system-ui, sans-serif`;
      const durLabel = totalDuration > 0
        ? `${this.formatTime(currentTime)} / ${this.formatTime(totalDuration)}`
        : this.formatTime(currentTime);

      const brandLine = `${this.studioName} • ${this.studioSubtitle} • ${durLabel}`;
      ctx.fillText(brandLine, titleX, titleY + Math.floor(titleFontPx * 0.92));
    }

    const titleBoxW = Math.max(340, w * 0.44);
    const titleBoxH = titleFontPx * 2.8;
    this.lastComponentBoxes.title = {
      id: 'title',
      name: 'Title & Footer',
      x: titleX - titleBoxW / 2,
      y: titleY - titleFontPx * 1.1,
      w: titleBoxW,
      h: titleBoxH,
      cx: titleX,
      cy: titleY
    };

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

    // 9. Broadcast Watermark Badge (Corner Brand Pill)
    if (this.watermarkPos && this.watermarkPos !== 'none') {
      ctx.save();
      const badgeText = `✦ ${this.studioName.toUpperCase()}`;
      const badgeFontPx = Math.floor(Math.min(w, h) * 0.018);
      ctx.font = `800 ${badgeFontPx}px "${this.fontFamily}", system-ui, sans-serif`;
      const textW = ctx.measureText(badgeText).width;
      const badgeW = textW + 28;
      const badgeH = badgeFontPx * 2.1;
      const margin = 36;

      let bx = margin;
      let by = margin;

      if (this.watermarkPos === 'top-right') {
        bx = w - margin - badgeW;
        by = margin;
      } else if (this.watermarkPos === 'bottom-left') {
        bx = margin;
        by = h - margin - badgeH;
      } else if (this.watermarkPos === 'bottom-right') {
        bx = w - margin - badgeW;
        by = h - margin - badgeH;
      }

      ctx.fillStyle = 'rgba(15, 23, 42, 0.74)';
      ctx.strokeStyle = `rgba(${pal.glow}, 0.38)`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(bx, by, badgeW, badgeH, badgeH / 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pal.primary;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx + badgeW / 2, by + badgeH / 2 + 1);
      ctx.restore();
    }

    // 10. Interactive Drag-and-Drop Guides (Studio Preview Only, Never in Exported Video)
    if (!this.isRecording && this.showDragGuides !== false) {
      const activeId = this.activeDragComponent;
      const hoverId = this.hoveredComponent;
      const targetId = activeId || hoverId;

      if (targetId && this.lastComponentBoxes && this.lastComponentBoxes[targetId]) {
        const b = this.lastComponentBoxes[targetId];
        ctx.save();

        // Alignment Snap Guide Lines
        if (activeId) {
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([8, 8]);

          // Center-X alignment guide
          if (Math.abs(b.cx - w / 2) < 8) {
            ctx.beginPath();
            ctx.moveTo(w / 2, 0);
            ctx.lineTo(w / 2, h);
            ctx.stroke();
          }

          // Center-Y alignment guide
          if (Math.abs(b.cy - h / 2) < 8) {
            ctx.beginPath();
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
            ctx.stroke();
          }
        }

        // Bounding Selection Box
        const pad = 8;
        const boxX = b.x - pad;
        const boxY = b.y - pad;
        const boxW = b.w + pad * 2;
        const boxH = b.h + pad * 2;

        ctx.strokeStyle = activeId ? '#38bdf8' : 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = activeId ? 3.5 : 2;
        ctx.setLineDash(activeId ? [] : [6, 6]);

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 10);
        ctx.stroke();

        // 4 Corner Drag Grips
        if (activeId) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          const handleSize = 12;
          const corners = [
            [boxX - handleSize / 2, boxY - handleSize / 2],
            [boxX + boxW - handleSize / 2, boxY - handleSize / 2],
            [boxX - handleSize / 2, boxY + boxH - handleSize / 2],
            [boxX + boxW - handleSize / 2, boxY + boxH - handleSize / 2]
          ];
          for (const [hx, hy] of corners) {
            ctx.fillRect(hx, hy, handleSize, handleSize);
            ctx.strokeRect(hx, hy, handleSize, handleSize);
          }
        }

        // Floating Tag Badge
        const badgeLabel = `✥ ${b.name} (${Math.round((b.cx / w) * 100)}%, ${Math.round((b.cy / h) * 100)}%)`;
        ctx.font = '700 18px system-ui, sans-serif';
        const textMetrics = ctx.measureText(badgeLabel);
        const tagW = textMetrics.width + 24;
        const tagH = 30;
        const tagX = Math.max(12, Math.min(w - tagW - 12, boxX));
        const tagY = Math.max(12, boxY - tagH - 8);

        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = activeId ? '#38bdf8' : '#0284c7';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(tagX, tagY, tagW, tagH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = activeId ? '#38bdf8' : '#e0f2fe';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeLabel, tagX + tagW / 2, tagY + tagH / 2);

        ctx.restore();
      }
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  /**
   * Hit test to find which interactive canvas component is under pointer
   */
  getHitComponent(canvasX, canvasY) {
    const boxes = this.lastComponentBoxes;
    if (!boxes) return null;

    const checkOrder = ['lyrics', 'artwork', 'visualizer', 'title'];
    for (const key of checkOrder) {
      const b = boxes[key];
      if (b) {
        const pad = 14;
        if (
          canvasX >= b.x - pad &&
          canvasX <= b.x + b.w + pad &&
          canvasY >= b.y - pad &&
          canvasY <= b.y + b.h + pad
        ) {
          return b;
        }
      }
    }
    return null;
  }

  /**
   * Sets up pointer drag interaction on canvas
   */
  setupDragInteraction(canvas, onPositionChange) {
    if (!canvas) return;
    this.canvas = canvas;
    this.onPositionChange = onPositionChange;

    const getCanvasCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const onPointerDown = (e) => {
      if (this.isRecording) return;
      const coords = getCanvasCoords(e);
      const hit = this.getHitComponent(coords.x, coords.y);
      if (hit) {
        this.activeDragComponent = hit.id;
        this.dragOffset = {
          dx: coords.x - hit.cx,
          dy: coords.y - hit.cy
        };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (err) {}
        canvas.style.cursor = 'grabbing';
        if (!this.isPreviewing) {
          this.renderStaticAtTime(this.lastRenderTime || 0);
        }
      }
    };

    const onPointerMove = (e) => {
      if (this.isRecording) return;
      const coords = getCanvasCoords(e);
      const w = canvas.width;
      const h = canvas.height;

      if (this.activeDragComponent) {
        let newCx = coords.x - this.dragOffset.dx;
        let newCy = coords.y - this.dragOffset.dy;

        // Smart snap to center axes (+/- 2.5% threshold)
        if (Math.abs(newCx - w / 2) < w * 0.025) newCx = w / 2;
        if (Math.abs(newCy - h / 2) < h * 0.025) newCy = h / 2;

        newCx = Math.max(w * 0.05, Math.min(w * 0.95, newCx));
        newCy = Math.max(h * 0.05, Math.min(h * 0.95, newCy));

        if (!this.customPositions) {
          this.customPositions = { artwork: null, visualizer: null, lyrics: null, title: null };
        }
        this.customPositions[this.activeDragComponent] = {
          x: Math.round((newCx / w) * 1000) / 1000,
          y: Math.round((newCy / h) * 1000) / 1000
        };

        if (this.onPositionChange) {
          this.onPositionChange(this.activeDragComponent, this.customPositions[this.activeDragComponent]);
        }
        if (!this.isPreviewing) {
          this.renderStaticAtTime(this.lastRenderTime || 0);
        }
      } else {
        const hit = this.getHitComponent(coords.x, coords.y);
        const newHoverId = hit ? hit.id : null;
        if (newHoverId !== this.hoveredComponent) {
          this.hoveredComponent = newHoverId;
          canvas.style.cursor = hit ? 'grab' : 'default';
          if (!this.isPreviewing) {
            this.renderStaticAtTime(this.lastRenderTime || 0);
          }
        }
      }
    };

    const onPointerUp = (e) => {
      if (this.activeDragComponent) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {}
        this.activeDragComponent = null;
        canvas.style.cursor = this.hoveredComponent ? 'grab' : 'default';
        if (!this.isPreviewing) {
          this.renderStaticAtTime(this.lastRenderTime || 0);
        }
        if (this.onPositionChange) {
          this.onPositionChange('saved', this.customPositions);
        }
      }
    };

    const onPointerLeave = () => {
      if (!this.activeDragComponent && this.hoveredComponent) {
        this.hoveredComponent = null;
        canvas.style.cursor = 'default';
        if (!this.isPreviewing) {
          this.renderStaticAtTime(this.lastRenderTime || 0);
        }
      }
    };

    if (this._pointerDownHandler) {
      canvas.removeEventListener('pointerdown', this._pointerDownHandler);
      canvas.removeEventListener('pointermove', this._pointerMoveHandler);
      canvas.removeEventListener('pointerup', this._pointerUpHandler);
      canvas.removeEventListener('pointercancel', this._pointerUpHandler);
      canvas.removeEventListener('pointerleave', this._pointerLeaveHandler);
    }

    this._pointerDownHandler = onPointerDown;
    this._pointerMoveHandler = onPointerMove;
    this._pointerUpHandler = onPointerUp;
    this._pointerLeaveHandler = onPointerLeave;

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
  }

  resetCustomPositions(comp = null) {
    if (comp) {
      if (this.customPositions) this.customPositions[comp] = null;
    } else {
      this.customPositions = {
        artwork: null,
        visualizer: null,
        lyrics: null,
        title: null
      };
    }
    this.renderStaticAtTime(this.lastRenderTime || 0);
  }

  /**
   * Static scrub renderer for instant timeline inspection without playing audio
   */
  renderStaticAtTime(currentTimeSec, totalDuration = 0) {
    this.lastRenderTime = currentTimeSec;
    const dur = totalDuration || (this.songMeta && this.songMeta.duration) || 180;
    const fakeFreq = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
      fakeFreq[i] = Math.round(90 + Math.sin(i * 0.25 + currentTimeSec) * 65 + Math.cos(i * 0.11) * 40);
    }
    this.drawFrame(fakeFreq, currentTimeSec, dur);
  }

  /**
   * Starts live audio + canvas preview inside Video Studio modal without recording
   */
  startPreview(audioBuffer, songMeta, startOffset = 0, onTick = null) {
    this.stop();
    this.audioBuffer = audioBuffer;
    this.setSongMeta(songMeta, audioBuffer.duration);
    this.updateCanvasDimensions();
    this.onTick = onTick;

    this.audioCtx = AudioConverter.getAudioContext();
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this._startSourceAt(startOffset);
  }

  _startSourceAt(offsetSec = 0) {
    if (!this.audioBuffer || !this.audioCtx) return;
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {}
    }

    const totalDur = this.audioBuffer.duration;
    const clampedOffset = Math.max(0, Math.min(totalDur - 0.05, offsetSec));

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.previewStartAudioTime = this.audioCtx.currentTime;
    this.previewStartOffset = clampedOffset;
    this.isPreviewing = true;

    this.sourceNode.onended = () => {
      if (this.isPreviewing && (this.getCurrentPreviewTime() >= totalDur - 0.25)) {
        this.stop();
        if (this.onPreviewEnded) this.onPreviewEnded();
      }
    };

    this.sourceNode.start(0, clampedOffset);

    if (!this.animationFrameId) {
      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      const loop = () => {
        if (!this.isPreviewing) {
          this.animationFrameId = null;
          return;
        }
        const currentSec = this.getCurrentPreviewTime();
        this.lastRenderTime = currentSec;
        this.analyser.getByteFrequencyData(freqData);
        this.drawFrame(freqData, currentSec, totalDur);

        if (this.onTick) {
          this.onTick(currentSec, totalDur);
        }

        if (currentSec < totalDur) {
          this.animationFrameId = requestAnimationFrame(loop);
        } else {
          this.stop();
          if (this.onPreviewEnded) this.onPreviewEnded();
        }
      };
      this.animationFrameId = requestAnimationFrame(loop);
    }
  }

  getCurrentPreviewTime() {
    if (!this.audioCtx || !this.previewStartAudioTime) return this.previewStartOffset || 0;
    const elapsed = this.audioCtx.currentTime - this.previewStartAudioTime;
    const totalDur = (this.audioBuffer && this.audioBuffer.duration) || 180;
    return Math.min(totalDur, (this.previewStartOffset || 0) + Math.max(0, elapsed));
  }

  seekPreview(seekSec) {
    if (this.isPreviewing && this.audioBuffer) {
      this._startSourceAt(seekSec);
    } else {
      this.renderStaticAtTime(seekSec);
    }
  }

  stop() {
    this.isPreviewing = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
    if (this.canvas) {
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Renders and exports 1080p video using MediaRecorder and AudioBuffer at chosen FPS & bitrate
   */
  async exportVideo(audioBuffer, songMeta, coverUrl, onProgress = () => {}) {
    this.stop();
    this.audioBuffer = audioBuffer;
    this.setSongMeta(songMeta, audioBuffer.duration);
    this.updateCanvasDimensions();

    onProgress(2, 'Loading album artwork & label...');
    await this.loadCoverImage(coverUrl);

    if (this.customCoverDataUrl) {
      await this.loadCustomCover(this.customCoverDataUrl);
    }

    if (this.customBgDataUrl) {
      onProgress(4, 'Loading custom cinema background...');
      await this.loadBackgroundImage(this.customBgDataUrl);
    }

    onProgress(6, 'Initializing Web Audio stream...');
    this.audioCtx = AudioConverter.getAudioContext();

    const dest = this.audioCtx.createMediaStreamDestination();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = audioBuffer;
    this.sourceNode.connect(this.analyser);
    this.sourceNode.connect(dest);

    const streamFps = this.fps || 60;
    const canvasStream = this.canvas.captureStream(streamFps);
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

    const bitRate = (this.bitrateMbps || 12) * 1000000;
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: bitRate
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
        onProgress(100, 'Packaging 1080p video file...');
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
