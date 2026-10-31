/**
 * Suno Downloader Pro - MP3 Encoder
 * High-performance, chunked in-browser MP3 encoder powered by lamejs (320kbps Studio Bitrate)
 */

export class Mp3Encoder {
  /**
   * Encodes an AudioBuffer into an MP3 Blob (320kbps CBR or 192/256kbps)
   *
   * @param {AudioBuffer} audioBuffer - Decoded audio buffer
   * @param {number} [kbps=320] - Target bitrate in kbps
   * @param {Function} [onProgress] - Optional progress callback (percent: number)
   * @returns {Promise<Blob>}
   */
  static async encode(audioBuffer, kbps = 320, onProgress = () => {}) {
    if (typeof window.lamejs === 'undefined') {
      throw new Error('MP3 Encoder library (lamejs) is not loaded.');
    }

    const numChannels = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    const encoder = new window.lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
    const mp3Chunks = [];

    // Extract channels and convert Float32 to Int16
    const leftFloat = audioBuffer.getChannelData(0);
    const rightFloat = numChannels > 1 ? audioBuffer.getChannelData(1) : leftFloat;

    const blockSize = 1152 * 8; // Process in chunks of 9216 samples
    const leftChunk = new Int16Array(blockSize);
    const rightChunk = new Int16Array(blockSize);

    let sampleIdx = 0;

    return new Promise((resolve, reject) => {
      const processNextChunk = () => {
        try {
          const startTime = performance.now();

          // Process multiple blocks per tick to balance speed and UI responsiveness
          while (sampleIdx < length && performance.now() - startTime < 35) {
            const remaining = length - sampleIdx;
            const currentBlockSize = Math.min(blockSize, remaining);

            for (let i = 0; i < currentBlockSize; i++) {
              const idx = sampleIdx + i;

              // Left sample
              let l = leftFloat[idx];
              l = Math.max(-1, Math.min(1, l));
              leftChunk[i] = l < 0 ? l * 0x8000 : l * 0x7FFF;

              // Right sample
              let r = rightFloat[idx];
              r = Math.max(-1, Math.min(1, r));
              rightChunk[i] = r < 0 ? r * 0x8000 : r * 0x7FFF;
            }

            let mp3buf;
            if (numChannels === 1) {
              mp3buf = encoder.encodeBuffer(leftChunk.subarray(0, currentBlockSize));
            } else {
              mp3buf = encoder.encodeBuffer(
                leftChunk.subarray(0, currentBlockSize),
                rightChunk.subarray(0, currentBlockSize)
              );
            }

            if (mp3buf.length > 0) {
              mp3Chunks.push(mp3buf);
            }

            sampleIdx += currentBlockSize;
          }

          const percent = Math.min(99, Math.floor((sampleIdx / length) * 100));
          onProgress(percent);

          if (sampleIdx < length) {
            setTimeout(processNextChunk, 0);
          } else {
            // Flush remaining buffer
            const finalBuf = encoder.flush();
            if (finalBuf.length > 0) {
              mp3Chunks.push(finalBuf);
            }

            onProgress(100);
            const blob = new Blob(mp3Chunks, { type: 'audio/mpeg' });
            resolve(blob);
          }
        } catch (err) {
          reject(err);
        }
      };

      processNextChunk();
    });
  }
}
