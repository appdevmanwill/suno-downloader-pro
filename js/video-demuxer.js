/**
 * NTK OmniStream Studio - In-Browser Video & Audio Demuxer
 * Extracts lossless PCM AudioBuffers and video frame poster artwork directly
 * in-browser from video containers (.mp4, .mov, .mkv, .webm, .avi) without external server uploads.
 */

import { AudioConverter } from './audio-converter.js?v=2026.5';

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
   * Demuxes audio and captures a poster frame from a local video File
   * @param {File} file
   * @param {Function} [onProgress]
   * @returns {Promise<{ audioBuffer: AudioBuffer, thumbnailDataUrl: string, duration: number, width: number, height: number }>}
   */
  static async demux(file, onProgress = () => {}) {
    onProgress(15, `Reading video file "${file.name}"...`);
    const arrayBuf = await file.arrayBuffer();

    onProgress(35, 'Decoding audio track from video stream...');
    let audioBuffer = null;
    try {
      audioBuffer = await AudioConverter.decodeAudioData(arrayBuf.slice(0));
    } catch (err) {
      throw new Error(`Failed to decode audio track from video: ${err.message}. Ensure the video has an audio stream.`);
    }

    onProgress(70, 'Capturing video snapshot thumbnail...');
    const meta = await VideoDemuxer.captureThumbnail(file);

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
      }, 5000);

      video.onloadedmetadata = () => {
        // Seek to 1 second or 15% into video for representative thumbnail
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
