/**
 * Suno Downloader Pro - 4-Track Synchronized Multi-Stem Console Mixer
 * Sample-accurate Web Audio multi-track playback with Mute, Solo, Volume Faders, and Live Meters.
 */

import { AudioConverter } from './audio-converter.js?v=2026.4';

export class StemMixer {
  static STANDARD_TRACKS = ['vocals', 'drums', 'bass', 'other'];
  static SPLIT_TRACKS = ['lead_vocals', 'backing_vocals', 'drums', 'bass', 'other'];
  static TRACK_KEYS = ['vocals', 'lead_vocals', 'backing_vocals', 'drums', 'bass', 'other'];

  constructor(onTick = () => {}) {
    this.stems = null; // { vocals, lead_vocals, backing_vocals, drums, bass, other, instrumental }
    this.duration = 0;
    this.isPlaying = false;
    this.offsetSec = 0;
    this.startCtxTime = 0;
    this.onTick = onTick;
    this.isVocalSplit = false;

    this.state = {
      vocals: { volume: 1.0, muted: false, solo: false },
      lead_vocals: { volume: 1.0, muted: false, solo: false },
      backing_vocals: { volume: 1.0, muted: false, solo: false },
      drums: { volume: 1.0, muted: false, solo: false },
      bass: { volume: 1.0, muted: false, solo: false },
      other: { volume: 1.0, muted: false, solo: false }
    };

    this.sources = {};
    this.gains = {};
    this.analysers = {};
    this._rafId = null;
  }

  getActiveTrackKeys() {
    if (this.isVocalSplit && this.stems && this.stems.lead_vocals && this.stems.backing_vocals) {
      return StemMixer.SPLIT_TRACKS;
    }
    return StemMixer.STANDARD_TRACKS;
  }

  setVocalSplit(active) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.isVocalSplit = Boolean(active);
    this.syncLiveGains();
    if (wasPlaying) this.play();
  }

  /**
   * Loads a multi-stem bundle into the console
   * @param {Object} stemBundle - { vocals, lead_vocals, backing_vocals, drums, bass, other }
   */
  loadStems(stemBundle) {
    this.stop();
    this.stems = stemBundle;
    const ref = stemBundle.vocals || stemBundle.lead_vocals || stemBundle.drums || stemBundle.bass || stemBundle.other;
    this.duration = ref ? ref.duration : 0;
    this.offsetSec = 0;
    this.isVocalSplit = Boolean(stemBundle.lead_vocals && stemBundle.backing_vocals);

    const allKeys = ['vocals', 'lead_vocals', 'backing_vocals', 'drums', 'bass', 'other'];
    for (const k of allKeys) {
      this.state[k] = { volume: 1.0, muted: false, solo: false };
    }
  }

  /**
   * Computes effective linear gain for each stem considering Solo & Mute logic
   */
  getEffectiveGains() {
    const activeKeys = this.getActiveTrackKeys();
    const anySolo = activeKeys.some((k) => this.state[k] && this.state[k].solo);
    const out = {};

    for (const k of activeKeys) {
      const st = this.state[k] || { volume: 1.0, muted: false, solo: false };
      if (anySolo) {
        out[k] = st.solo && !st.muted ? st.volume : 0;
      } else {
        out[k] = st.muted ? 0 : st.volume;
      }
    }
    return out;
  }

  /**
   * Applies current gains smoothly to live GainNodes
   */
  syncLiveGains() {
    const ctx = AudioConverter.getAudioContext();
    const eff = this.getEffectiveGains();
    const activeKeys = this.getActiveTrackKeys();
    for (const k of activeKeys) {
      const gainNode = this.gains[k];
      if (gainNode) {
        gainNode.gain.setTargetAtTime(eff[k] || 0, ctx.currentTime, 0.015);
      }
    }
  }

  setVolume(track, val) {
    if (!this.state[track]) return;
    this.state[track].volume = Math.max(0, Math.min(1.5, Number(val)));
    this.syncLiveGains();
  }

  toggleMute(track) {
    if (!this.state[track]) return;
    this.state[track].muted = !this.state[track].muted;
    if (this.state[track].muted) {
      this.state[track].solo = false;
    }
    this.syncLiveGains();
    return this.state[track];
  }

  toggleSolo(track) {
    if (!this.state[track]) return;
    this.state[track].solo = !this.state[track].solo;
    if (this.state[track].solo) {
      this.state[track].muted = false;
    }
    this.syncLiveGains();
    return this.state[track];
  }

  /**
   * Applies a quick studio preset
   * @param {'full'|'acapella'|'karaoke'|'drumless'|'rhythm'} preset
   */
  applyPreset(preset) {
    const activeKeys = this.getActiveTrackKeys();
    for (const k of activeKeys) {
      this.state[k].volume = 1.0;
      this.state[k].muted = false;
      this.state[k].solo = false;
    }

    if (preset === 'acapella') {
      if (this.isVocalSplit) {
        this.state.lead_vocals.solo = true;
        this.state.backing_vocals.solo = true;
      } else {
        this.state.vocals.solo = true;
      }
    } else if (preset === 'karaoke') {
      if (this.isVocalSplit) {
        this.state.lead_vocals.muted = true;
        this.state.backing_vocals.muted = true;
      } else {
        this.state.vocals.muted = true;
      }
    } else if (preset === 'drumless') {
      this.state.drums.muted = true;
    } else if (preset === 'rhythm') {
      if (this.isVocalSplit) {
        this.state.lead_vocals.muted = true;
        this.state.backing_vocals.muted = true;
      } else {
        this.state.vocals.muted = true;
      }
      this.state.other.muted = true;
    }

    this.syncLiveGains();
  }

  /**
   * Starts sample-locked playback from current offsetSec
   */
  play() {
    if (!this.stems || this.isPlaying) return;

    const ctx = AudioConverter.getAudioContext();
    if (this.offsetSec >= this.duration - 0.05) {
      this.offsetSec = 0;
    }

    const eff = this.getEffectiveGains();
    const startAt = ctx.currentTime + 0.025;
    this.startCtxTime = startAt - this.offsetSec;

    this.sources = {};
    this.gains = {};
    this.analysers = {};

    const activeKeys = this.getActiveTrackKeys();
    for (const k of activeKeys) {
      const buf = this.stems[k];
      if (!buf) continue;

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(eff[k], startAt);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;

      src.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);

      src.start(startAt, this.offsetSec);
      this.sources[k] = src;
      this.gains[k] = gain;
      this.analysers[k] = analyser;
    }

    this.isPlaying = true;
    this._startLoop();
  }

  pause() {
    if (!this.isPlaying) return;
    const ctx = AudioConverter.getAudioContext();
    this.offsetSec = Math.min(this.duration, Math.max(0, ctx.currentTime - this.startCtxTime));
    this._teardownNodes();
    this.isPlaying = false;
    this._emitTick();
  }

  stop() {
    this._teardownNodes();
    this.isPlaying = false;
    this.offsetSec = 0;
    this._emitTick();
  }

  seek(targetSeconds) {
    const clamped = Math.max(0, Math.min(this.duration, Number(targetSeconds) || 0));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this._teardownNodes();
      this.isPlaying = false;
    }
    this.offsetSec = clamped;
    if (wasPlaying) {
      this.play();
    } else {
      this._emitTick();
    }
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.offsetSec;
    const ctx = AudioConverter.getAudioContext();
    return Math.min(this.duration, Math.max(0, ctx.currentTime - this.startCtxTime));
  }

  /**
   * Renders the current fader/mute/solo console mix into a stereo AudioBuffer
   * @returns {AudioBuffer}
   */
  renderCustomMixBuffer() {
    if (!this.stems) throw new Error('Stems are not loaded.');
    return AudioConverter.mixStems(this.stems, this.getEffectiveGains(), true);
  }

  _teardownNodes() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    for (const k of StemMixer.TRACK_KEYS) {
      if (this.sources[k]) {
        try { this.sources[k].stop(); } catch (e) {}
        try { this.sources[k].disconnect(); } catch (e) {}
      }
      if (this.gains[k]) {
        try { this.gains[k].disconnect(); } catch (e) {}
      }
      if (this.analysers[k]) {
        try { this.analysers[k].disconnect(); } catch (e) {}
      }
    }
    this.sources = {};
    this.gains = {};
    this.analysers = {};
  }

  _startLoop() {
    const tempBuf = new Uint8Array(32);

    const step = () => {
      if (!this.isPlaying) return;
      const cur = this.getCurrentTime();
      if (cur >= this.duration - 0.02) {
        this.stop();
        return;
      }

      const levels = {};
      const activeKeys = this.getActiveTrackKeys();
      for (const k of activeKeys) {
        const an = this.analysers[k];
        if (an) {
          an.getByteTimeDomainData(tempBuf);
          let peak = 0;
          for (let i = 0; i < tempBuf.length; i++) {
            const amp = Math.abs(tempBuf[i] - 128) / 128;
            if (amp > peak) peak = amp;
          }
          levels[k] = Math.min(1, peak * 1.6);
        } else {
          levels[k] = 0;
        }
      }

      this.onTick({
        currentTime: cur,
        duration: this.duration,
        isPlaying: this.isPlaying,
        levels,
        isVocalSplit: this.isVocalSplit
      });

      this._rafId = requestAnimationFrame(step);
    };

    this._rafId = requestAnimationFrame(step);
  }

  _emitTick() {
    const levels = {};
    for (const k of this.getActiveTrackKeys()) {
      levels[k] = 0;
    }
    this.onTick({
      currentTime: this.offsetSec,
      duration: this.duration,
      isPlaying: this.isPlaying,
      levels,
      isVocalSplit: this.isVocalSplit
    });
  }
}
