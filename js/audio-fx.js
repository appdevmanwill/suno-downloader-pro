/**
 * Suno Downloader Pro - Waveform Audio Trimmer & Mastering FX Engine
 * High-speed OfflineAudioContext mastering, trimming, fades, normalization, and creative FX presets.
 */

import { AudioConverter } from './audio-converter.js?v=2026.2';

export class AudioFXEngine {
  static PRESETS = [
    { id: 'clean', label: 'Original Clean', desc: 'Bit-clean trim & fades', rate: 1.0 },
    { id: 'warm_master', label: 'Studio Master', desc: 'Warm EQ + Glue Compression', rate: 1.0 },
    { id: 'slowed_reverb', label: 'Slowed + Reverb', desc: '0.86x Tape Pitch + Lush Hall', rate: 0.86 },
    { id: 'nightcore', label: 'Nightcore', desc: '1.20x Pitch/Tempo + Air Boost', rate: 1.20 },
    { id: 'bass_boost', label: '808 Bass Boost', desc: '+6.5 dB Sub Punch + Limiter', rate: 1.0 },
    { id: 'lofi_vinyl', label: 'Lo-Fi Radio', desc: 'Warm 3.9 kHz Filter + Tape Saturation', rate: 0.96 }
  ];

  /**
   * Generates a procedural stereo hall impulse response for ConvolverNode reverb
   */
  static createHallImpulse(offlineCtx, durationSec = 2.3, decay = 2.6) {
    const sr = offlineCtx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const impulse = offlineCtx.createBuffer(2, len, sr);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    // Deterministic PRNG for repeatable offline bounces
    let seed = 133742;
    const nextRand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 1073741823.5) - 1.0;
    };

    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      left[i] = nextRand() * env * 0.55;
      right[i] = nextRand() * env * 0.55;
    }
    return impulse;
  }

  /**
   * Creates a gentle analog tape saturation curve
   */
  static createTapeCurve(drive = 1.6) {
    const n = 2048;
    const curve = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  /**
   * Renders a trimmed and FX-processed AudioBuffer via OfflineAudioContext
   *
   * @param {AudioBuffer} sourceBuffer
   * @param {Object} opts
   * @param {number} [opts.startSec=0]
   * @param {number} [opts.endSec]
   * @param {number} [opts.fadeInSec=0]
   * @param {number} [opts.fadeOutSec=0]
   * @param {boolean} [opts.normalize=true]
   * @param {string} [opts.preset='clean']
   * @returns {Promise<AudioBuffer>}
   */
  static async process(sourceBuffer, opts = {}) {
    const sr = sourceBuffer.sampleRate;
    const totalDur = sourceBuffer.duration;

    const startSec = Math.max(0, Math.min(totalDur - 0.1, Number(opts.startSec) || 0));
    const endSec = Math.max(startSec + 0.1, Math.min(totalDur, Number(opts.endSec) || totalDur));
    const sliceDur = endSec - startSec;

    const presetId = opts.preset || 'clean';
    const presetMeta = AudioFXEngine.PRESETS.find(p => p.id === presetId) || AudioFXEngine.PRESETS[0];
    const rate = presetMeta.rate || 1.0;

    const scaledDur = sliceDur / rate;
    const reverbTail = presetId === 'slowed_reverb' ? 1.8 : 0;
    const outDur = scaledDur + reverbTail;
    const outSamples = Math.max(256, Math.ceil(outDur * sr));

    const offlineCtx = new OfflineAudioContext(2, outSamples, sr);

    const src = offlineCtx.createBufferSource();
    src.buffer = sourceBuffer;
    src.playbackRate.setValueAtTime(rate, 0);

    // Master Fade Envelope Node
    const fadeGain = offlineCtx.createGain();
    const fadeIn = Math.max(0, Math.min(scaledDur * 0.48, Number(opts.fadeInSec) || 0));
    const fadeOut = Math.max(0, Math.min(scaledDur * 0.48, Number(opts.fadeOutSec) || 0));

    if (fadeIn > 0.01) {
      fadeGain.gain.setValueAtTime(0.0001, 0);
      fadeGain.gain.linearRampToValueAtTime(1.0, fadeIn);
    } else {
      fadeGain.gain.setValueAtTime(1.0, 0);
    }

    if (fadeOut > 0.01) {
      fadeGain.gain.setValueAtTime(1.0, Math.max(fadeIn, scaledDur - fadeOut));
      fadeGain.gain.linearRampToValueAtTime(0.0001, scaledDur);
    }

    let currentNode = src;

    if (presetId === 'warm_master') {
      const lowShelf = offlineCtx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 95;
      lowShelf.gain.value = 2.4;

      const presence = offlineCtx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 3200;
      presence.Q.value = 0.9;
      presence.gain.value = 1.4;

      const air = offlineCtx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 10500;
      air.gain.value = 2.0;

      const comp = offlineCtx.createDynamicsCompressor();
      comp.threshold.value = -15;
      comp.knee.value = 18;
      comp.ratio.value = 2.6;
      comp.attack.value = 0.008;
      comp.release.value = 0.18;

      currentNode.connect(lowShelf);
      lowShelf.connect(presence);
      presence.connect(air);
      air.connect(comp);
      currentNode = comp;
    } else if (presetId === 'slowed_reverb') {
      const dryGain = offlineCtx.createGain();
      dryGain.gain.value = 0.78;

      const wetGain = offlineCtx.createGain();
      wetGain.gain.value = 0.34;

      const convolver = offlineCtx.createConvolver();
      convolver.buffer = AudioFXEngine.createHallImpulse(offlineCtx, 2.3, 2.5);

      const wetDamp = offlineCtx.createBiquadFilter();
      wetDamp.type = 'lowpass';
      wetDamp.frequency.value = 5200;

      const sumGain = offlineCtx.createGain();
      sumGain.gain.value = 1.0;

      currentNode.connect(dryGain);
      dryGain.connect(sumGain);

      currentNode.connect(convolver);
      convolver.connect(wetDamp);
      wetDamp.connect(wetGain);
      wetGain.connect(sumGain);

      currentNode = sumGain;
    } else if (presetId === 'nightcore') {
      const sparkle = offlineCtx.createBiquadFilter();
      sparkle.type = 'highshelf';
      sparkle.frequency.value = 8200;
      sparkle.gain.value = 2.2;

      const punch = offlineCtx.createBiquadFilter();
      punch.type = 'lowshelf';
      punch.frequency.value = 115;
      punch.gain.value = 2.0;

      currentNode.connect(punch);
      punch.connect(sparkle);
      currentNode = sparkle;
    } else if (presetId === 'bass_boost') {
      const subBoost = offlineCtx.createBiquadFilter();
      subBoost.type = 'lowshelf';
      subBoost.frequency.value = 85;
      subBoost.gain.value = 6.5;

      const limiter = offlineCtx.createDynamicsCompressor();
      limiter.threshold.value = -4.0;
      limiter.knee.value = 4.0;
      limiter.ratio.value = 12.0;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;

      currentNode.connect(subBoost);
      subBoost.connect(limiter);
      currentNode = limiter;
    } else if (presetId === 'lofi_vinyl') {
      const hp = offlineCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 155;

      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3900;
      lp.Q.value = 0.85;

      const shaper = offlineCtx.createWaveShaper();
      shaper.curve = AudioFXEngine.createTapeCurve(1.45);
      shaper.oversample = '2x';

      currentNode.connect(hp);
      hp.connect(lp);
      lp.connect(shaper);
      currentNode = shaper;
    }

    currentNode.connect(fadeGain);
    fadeGain.connect(offlineCtx.destination);

    src.start(0, startSec, sliceDur);

    const rendered = await offlineCtx.startRendering();

    if (opts.normalize !== false) {
      AudioConverter.normalize(rendered, 0.945);
    }

    return rendered;
  }
}
