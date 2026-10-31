/**
 * Suno Downloader Pro - Audio Converter & Buffer Utilities
 * Handles AudioContext decoding, hardware OfflineAudioContext resampling,
 * Lossless 16-bit RIFF WAV encoding, multi-stem summing, and waveform peak extraction.
 */

export class AudioConverter {
  /**
   * Lazily initialized shared AudioContext
   * @returns {AudioContext}
   */
  static getAudioContext() {
    if (!AudioConverter._audioCtx || AudioConverter._audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      AudioConverter._audioCtx = new AudioCtxClass();
    }
    if (AudioConverter._audioCtx.state === 'suspended') {
      AudioConverter._audioCtx.resume().catch(() => {});
    }
    return AudioConverter._audioCtx;
  }

  /**
   * Decodes an ArrayBuffer (M4A / AAC / MP3 / WAV) into a Web Audio API AudioBuffer
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<AudioBuffer>}
   */
  static async decodeAudioData(arrayBuffer) {
    const ctx = AudioConverter.getAudioContext();
    const bufferCopy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(bufferCopy);
  }

  /**
   * Resamples an AudioBuffer to targetSampleRate (e.g. 44100 Hz for HTDemucs) using OfflineAudioContext
   * @param {AudioBuffer} sourceBuffer
   * @param {number} [targetSampleRate=44100]
   * @returns {Promise<AudioBuffer>}
   */
  static async resampleToStereo(sourceBuffer, targetSampleRate = 44100) {
    if (sourceBuffer.sampleRate === targetSampleRate && sourceBuffer.numberOfChannels === 2) {
      return sourceBuffer;
    }

    const targetLength = Math.max(1, Math.round(sourceBuffer.duration * targetSampleRate));
    const offlineCtx = new OfflineAudioContext(2, targetLength, targetSampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = sourceBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    return await offlineCtx.startRendering();
  }

  /**
   * Creates a stereo AudioBuffer from raw left/right Float32Arrays
   * @param {Float32Array} left
   * @param {Float32Array} right
   * @param {number} [sampleRate=44100]
   * @returns {AudioBuffer}
   */
  static channelsToAudioBuffer(left, right, sampleRate = 44100) {
    const ctx = AudioConverter.getAudioContext();
    const length = left.length;
    const buf = ctx.createBuffer(2, length, sampleRate);
    buf.copyToChannel(left, 0);
    buf.copyToChannel(right || left, 1);
    return buf;
  }

  /**
   * Encodes an AudioBuffer into a Lossless 16-bit PCM RIFF WAV ArrayBuffer
   * @param {AudioBuffer} audioBuffer
   * @returns {ArrayBuffer}
   */
  static encodeWavArrayBuffer(audioBuffer) {
    const numChannels = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const totalSize = 44 + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF Header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');

    // fmt subchunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);

    // data subchunk
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = numChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

    let offset = 44;
    if (numChannels === 2) {
      for (let i = 0; i < numSamples; i++) {
        let s0 = ch0[i];
        s0 = s0 < -1 ? -1 : (s0 > 1 ? 1 : s0);
        view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF, true);

        let s1 = ch1[i];
        s1 = s1 < -1 ? -1 : (s1 > 1 ? 1 : s1);
        view.setInt16(offset + 2, s1 < 0 ? s1 * 0x8000 : s1 * 0x7FFF, true);

        offset += 4;
      }
    } else {
      for (let i = 0; i < numSamples; i++) {
        let s0 = ch0[i];
        s0 = s0 < -1 ? -1 : (s0 > 1 ? 1 : s0);
        view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF, true);
        offset += 2;
      }
    }

    return buffer;
  }

  /**
   * Encodes an AudioBuffer into a Lossless 16-bit PCM RIFF WAV Blob
   * @param {AudioBuffer} audioBuffer
   * @returns {Blob}
   */
  static encodeWav(audioBuffer) {
    return new Blob([AudioConverter.encodeWavArrayBuffer(audioBuffer)], { type: 'audio/wav' });
  }

  /**
   * Mixes multiple stem AudioBuffers with custom per-stem linear gains (e.g. Instrumental = Drums + Bass + Other)
   * @param {Object} stems - { vocals, drums, bass, other } AudioBuffers
   * @param {Object} gains - { vocals: number, drums: number, bass: number, other: number }
   * @param {boolean} [preventClipping=true]
   * @returns {AudioBuffer}
   */
  static mixStems(stems, gains = { vocals: 1, drums: 1, bass: 1, other: 1 }, preventClipping = true) {
    const refBuf = stems.vocals || stems.drums || stems.bass || stems.other;
    if (!refBuf) throw new Error('No stem buffers available to mix.');

    const ctx = AudioConverter.getAudioContext();
    const length = refBuf.length;
    const sampleRate = refBuf.sampleRate;
    const mixed = ctx.createBuffer(2, length, sampleRate);

    const outL = mixed.getChannelData(0);
    const outR = mixed.getChannelData(1);

    const keys = ['vocals', 'drums', 'bass', 'other'];
    for (const key of keys) {
      const buf = stems[key];
      const g = typeof gains[key] === 'number' ? gains[key] : 0;
      if (!buf || g === 0) continue;

      const inL = buf.getChannelData(0);
      const inR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : inL;
      const copyLen = Math.min(length, buf.length);

      for (let i = 0; i < copyLen; i++) {
        outL[i] += inL[i] * g;
        outR[i] += inR[i] * g;
      }
    }

    if (preventClipping) {
      let peak = 0;
      for (let i = 0; i < length; i++) {
        const aL = Math.abs(outL[i]);
        const aR = Math.abs(outR[i]);
        if (aL > peak) peak = aL;
        if (aR > peak) peak = aR;
      }
      if (peak > 0.99) {
        const scale = 0.985 / peak;
        for (let i = 0; i < length; i++) {
          outL[i] *= scale;
          outR[i] *= scale;
        }
      }
    }

    return mixed;
  }

  /**
   * Computes normalized waveform peak envelope (0..1) for waveform canvas rendering & trimming
   * @param {AudioBuffer} audioBuffer
   * @param {number} [buckets=220]
   * @returns {Float32Array}
   */
  static computePeaks(audioBuffer, buckets = 220) {
    const peaks = new Float32Array(buckets);
    if (!audioBuffer || audioBuffer.length === 0) return peaks;

    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    const blockSize = Math.max(1, Math.floor(audioBuffer.length / buckets));

    let globalMax = 0.001;
    for (let b = 0; b < buckets; b++) {
      const start = b * blockSize;
      const end = Math.min(audioBuffer.length, start + blockSize);
      let max = 0;
      // Sample with small stride for instant speed even on 8-minute tracks
      const step = Math.max(1, Math.floor((end - start) / 128));
      for (let i = start; i < end; i += step) {
        const v = (Math.abs(ch0[i]) + Math.abs(ch1[i])) * 0.5;
        if (v > max) max = v;
      }
      peaks[b] = max;
      if (max > globalMax) globalMax = max;
    }

    for (let b = 0; b < buckets; b++) {
      peaks[b] = Math.min(1, peaks[b] / globalMax);
    }

    return peaks;
  }

  /**
   * Normalizes an AudioBuffer in place to target peak (default -0.5 dBFS = 0.944)
   * @param {AudioBuffer} buffer
   * @param {number} [targetPeak=0.95]
   */
  static normalize(buffer, targetPeak = 0.95) {
    const numChannels = buffer.numberOfChannels;
    let maxAmp = 0;

    for (let c = 0; c < numChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxAmp) maxAmp = abs;
      }
    }

    if (maxAmp > 0.0001) {
      const gain = targetPeak / maxAmp;
      for (let c = 0; c < numChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          data[i] *= gain;
        }
      }
    }
  }
}
