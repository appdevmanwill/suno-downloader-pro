/**
 * Suno Downloader Pro - Suno API & Stream Resolver
 * Handles UUID parsing, metadata resolution, rights retrieval, and CloudFront streaming
 */

export class SunoAPI {
  static UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  static UUID_GLOBAL_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  static LOCAL_PROXY_URL = 'http://127.0.0.1:8899';
  static SUNO_RIGHTS_ENDPOINT = 'https://studio-api.prod.suno.com/api/mango/rights';
  static SUNO_CLIP_ENDPOINT = 'https://studio-api.prod.suno.com/api/clip/';
  static CLOUDFRONT_STREAM_BASE = 'https://d2lwuy8qc234o3.cloudfront.net/1/clip/';

  /**
   * Extracts UUIDs from arbitrary input string
   * @param {string} input
   * @returns {string[]}
   */
  static extractUuids(input) {
    if (!input) return [];
    const matches = input.match(SunoAPI.UUID_GLOBAL_REGEX);
    if (!matches) return [];
    // Deduplicate and lower-case
    return [...new Set(matches.map(m => m.toLowerCase().trim()))];
  }

  /**
   * Probes whether the local Python helper proxy is running on port 8899
   * @returns {Promise<boolean>}
   */
  static async checkLocalProxy() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${SunoAPI.LOCAL_PROXY_URL}/api/mango/rights`, {
        method: 'OPTIONS',
        signal: controller.signal
      });
      clearTimeout(timer);
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Fetches metadata for a Suno song (title, prompt, lyrics, duration, cover art, video URL, stem info)
   *
   * @param {string} uuid
   * @returns {Promise<Object>}
   */
  static async fetchMetadata(uuid) {
    const cleanUuid = uuid.toLowerCase().trim();
    let meta = {
      uuid: cleanUuid,
      title: `Suno_Song_${cleanUuid.slice(0, 8)}`,
      prompt: '',
      tags: '',
      duration: 0,
      imageLarge: `https://cdn2.suno.ai/image_large_${cleanUuid}.jpeg`,
      imageThumb: `https://cdn1.suno.ai/image_${cleanUuid}.jpeg`,
      videoUrl: '',
      model: 'chirp-v3.5',
      hasStem: false,
      isStem: false,
      stemType: null, // 'vocals' | 'instrumental'
      parentClipId: null,
      streamUrl: `${SunoAPI.CLOUDFRONT_STREAM_BASE}${cleanUuid}.m4a`,
      sunoUrl: `https://suno.com/song/${cleanUuid}`,
      embedUrl: `https://suno.com/embed/${cleanUuid}`
    };

    // Attempt 1: Suno Studio Clip API
    try {
      const clipResp = await fetch(`${SunoAPI.SUNO_CLIP_ENDPOINT}${cleanUuid}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (clipResp.ok) {
        const data = await clipResp.json();
        if (data.title) meta.title = data.title;
        if (data.image_large_url) meta.imageLarge = data.image_large_url;
        if (data.image_url) meta.imageThumb = data.image_url;
        if (data.video_url) meta.videoUrl = data.video_url;
        if (data.duration) meta.duration = data.duration;
        if (data.model_name) meta.model = data.model_name;

        const m = data.metadata || {};
        if (m.prompt) meta.prompt = m.prompt;
        if (m.tags) meta.tags = m.tags;
        if (m.has_stem) meta.hasStem = true;
        if (m.stem_from_id) {
          meta.isStem = true;
          meta.parentClipId = m.stem_from_id;
          if (m.stem_type) meta.stemType = m.stem_type;
        }

        // Title-based stem inference fallback
        if (meta.title.toLowerCase().includes('vocals')) {
          meta.isStem = true;
          meta.stemType = 'vocals';
        } else if (meta.title.toLowerCase().includes('instrumental')) {
          meta.isStem = true;
          meta.stemType = 'instrumental';
        }

        return meta;
      }
    } catch (e) {
      // Fallback to CORS-safe Microlink API
    }

    // Attempt 2: Microlink OpenGraph scraper fallback
    try {
      const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(`https://suno.com/song/${cleanUuid}`)}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const json = await res.json();
        if (json && json.status === 'success' && json.data) {
          const d = json.data;
          if (d.title && d.title.toLowerCase() !== 'suno') {
            meta.title = d.title.replace(/\s*[|-]\s*Suno.*$/i, '').trim();
          }
          if (d.image && d.image.url) {
            meta.imageLarge = d.image.url;
          }
          if (d.description) {
            meta.tags = d.description;
          }
        }
      }
    } catch (e) {
      // Use defaults
    }

    return meta;
  }

  /**
   * Fetches Mango DRM playback rights with multi-tier fallback
   *
   * @param {string} uuid
   * @returns {Promise<Object>} Object containing { glt, key, iv }
   */
  static async fetchRights(uuid) {
    const cleanUuid = uuid.toLowerCase().trim();
    const payload = JSON.stringify({
      content_params: {
        content_id: cleanUuid,
        content_type: 'clip'
      }
    });

    // Tier 1: Try Local Helper Proxy on port 8899
    try {
      const localResp = await fetch(`${SunoAPI.LOCAL_PROXY_URL}/api/mango/rights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (localResp.ok) {
        const rights = await localResp.json();
        if (rights.key && rights.iv && rights.glt) return rights;
      }
    } catch (e) {}

    // Tier 2: Try Direct POST to Suno studio API (works in same-origin, extension, or bookmarklet context)
    try {
      const directResp = await fetch(SunoAPI.SUNO_RIGHTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (directResp.ok) {
        const rights = await directResp.json();
        if (rights.key && rights.iv && rights.glt) return rights;
      }
    } catch (e) {}

    // Tier 3: Try Public CORS Proxy
    const corsProxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(SunoAPI.SUNO_RIGHTS_ENDPOINT)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(SunoAPI.SUNO_RIGHTS_ENDPOINT)}`
    ];

    for (const proxyUrl of corsProxies) {
      try {
        const proxyResp = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        if (proxyResp.ok) {
          const rights = await proxyResp.json();
          if (rights.key && rights.iv && rights.glt) return rights;
        }
      } catch (e) {}
    }

    throw new Error(
      'Could not acquire Mango DRM rights from external host due to browser CORS policies. Please use the 1-Click Bookmarklet on suno.com or launch the Python helper with: python suno_downloader.py --serve'
    );
  }

  /**
   * Downloads the encrypted CloudFront audio stream with chunked progress reporting
   *
   * @param {string} uuid
   * @param {Function} [onProgress] - (percent: number, loadedBytes: number, totalBytes: number)
   * @returns {Promise<ArrayBuffer>}
   */
  static async downloadEncryptedStream(uuid, onProgress = () => {}) {
    const cleanUuid = uuid.toLowerCase().trim();
    const url = `${SunoAPI.CLOUDFRONT_STREAM_BASE}${cleanUuid}.m4a`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CloudFront audio stream returned HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body || !totalBytes) {
      // Fallback to standard arrayBuffer if streaming API is unsupported
      const buffer = await response.arrayBuffer();
      onProgress(100, buffer.byteLength, buffer.byteLength);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.length;

      const percent = Math.min(100, Math.floor((receivedBytes / totalBytes) * 100));
      onProgress(percent, receivedBytes, totalBytes);
    }

    // Merge chunks into single ArrayBuffer
    const fullBuffer = new Uint8Array(receivedBytes);
    let position = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, position);
      position += chunk.length;
    }

    return fullBuffer.buffer;
  }
}
