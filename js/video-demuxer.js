/**
 * NTK OmniStream Studio - In-Browser Video & Audio Demuxer
 * High-performance, non-blocking video to PCM audio & poster frame extractor.
 * Processes local video files (.mp4, .mov, .mkv, .webm, .avi) without freezing the UI or uploading data.
 */

import { AudioConverter } from './audio-converter.js?v=2026.8';

export class VideoDemuxer {
  /**
   * Checks if a file or MIME type is a video
   * @param {File|string} fileOrMime
   * @returns {boolean}
   */
  static isVideo(fileOrMime) {
    if (!fileOrMime) return false;
    const nameOrType = typeof fileOrMime === 'string' ? fileOrMime : (fileOrMime.name || fileOrMime.type || '');
    return /\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv|ts)$/i.test(nameOrType) || nameOrType.startsWith('video/');
  }

  /**
   * Non-blocking video demuxer: concurrently extracts poster frame and decodes audio track.
   * @param {File} file
   * @param {Function} [onProgress]
   * @returns {Promise<{ audioBuffer: AudioBuffer, thumbnailDataUrl: string, duration: number, width: number, height: number }>}
   */
  static async demux(file, onProgress = () => {}) {
    onProgress(10, `Reading "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);
    
    // Concurrently trigger thumbnail capture to minimize wait time
    const thumbPromise = VideoDemuxer.captureThumbnail(file);

    // Yield to main thread so UI stays fluid
    await new Promise((r) => setTimeout(r, 10));

    onProgress(30, 'Reading video stream buffer...');
    const arrayBuf = await file.arrayBuffer();

    await new Promise((r) => setTimeout(r, 10));
    onProgress(50, 'Decoding lossless audio track via Web Audio engine...');

    let audioBuffer = null;
    try {
      audioBuffer = await AudioConverter.decodeAudioData(arrayBuf);
    } catch (err) {
      throw new Error(`Failed to decode audio track from video: ${err.message}. Ensure the video has an audio stream.`);
    }

    onProgress(85, 'Finalizing video poster artwork...');
    const meta = await thumbPromise;

    onProgress(100, 'Video demuxing complete!');
    return {
      audioBuffer,
      thumbnailDataUrl: meta.thumbnailDataUrl,
      duration: audioBuffer.duration || meta.duration,
      width: meta.width,
      height: meta.height
    };
  }

  /**
   * Generates a high-quality video frame thumbnail from a video File
   * @param {File} file
   * @returns {Promise<{ thumbnailDataUrl: string, duration: number, width: number, height: number }>}
   */
  static captureThumbnail(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.src = url;

      const fallback = {
        thumbnailDataUrl: '',
        duration: 0,
        width: 1920,
        height: 1080
      };

      const cleanup = () => {
        try { URL.revokeObjectURL(url); } catch (e) {}
        video.remove();
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(fallback);
      }, 6000);

      video.onloadedmetadata = () => {
        const seekTime = Math.min(1.5, (video.duration || 5) * 0.15);
        video.currentTime = seekTime;
      };

      video.onseeked = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          let w = video.videoWidth || 1280;
          let h = video.videoHeight || 720;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          cleanup();
          resolve({
            thumbnailDataUrl: dataUrl,
            duration: video.duration || 0,
            width: video.videoWidth || 1280,
            height: video.videoHeight || 720
          });
        } catch (e) {
          cleanup();
          resolve(fallback);
        }
      };

      video.onerror = () => {
        clearTimeout(timer);
        cleanup();
        resolve(fallback);
      };
    });
  }
}
