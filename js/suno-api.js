/**
 * Suno Downloader Pro - Suno API & Stream Resolver
 * Handles UUID parsing, metadata resolution, rights retrieval, and CloudFront streaming
 */

export class SunoAPI {
  static UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  static UUID_GLOBAL_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  static PLAYLIST_URL_REGEX = /(?:suno\.com\/playlist\/|[?&]playlist=)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  static LOCAL_PROXY_URL = 'http://127.0.0.1:8899';
  static SUNO_RIGHTS_ENDPOINT = 'https://studio-api.prod.suno.com/api/mango/rights';
  static SUNO_CLIP_ENDPOINT = 'https://studio-api.prod.suno.com/api/clip/';
  static CLOUDFRONT_STREAM_BASE = 'https://d2lwuy8qc234o3.cloudfront.net/1/clip/';

  /**
   * Checks if an input string is or contains a Suno playlist link
   * @param {string} input
   * @returns {boolean}
   */
  static isPlaylistUrl(input) {
    if (!input) return false;
    return SunoAPI.PLAYLIST_URL_REGEX.test(input) || input.toLowerCase().includes('/playlist/');
  }

  /**
   * Parses arbitrary input text (multiple URLs, newlines, commas) and categorizes
   * playlist UUIDs and individual song UUIDs.
   * @param {string} input
   * @returns {{ songUuids: string[], playlistUuids: string[] }}
   */
  static parseBatchInput(input) {
    if (!input) return { songUuids: [], playlistUuids: [] };
    const text = String(input);
    const playlistUuids = [];
    const songUuids = [];

    const tokens = text.split(/[\r\n,;\s]+/);
    for (const token of tokens) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const plMatch = trimmed.match(SunoAPI.PLAYLIST_URL_REGEX);
      if (plMatch && plMatch[1]) {
        playlistUuids.push(plMatch[1].toLowerCase());
      } else {
        const uMatch = trimmed.match(SunoAPI.UUID_REGEX);
        if (uMatch) {
          if (trimmed.toLowerCase().includes('/playlist/')) {
            playlistUuids.push(uMatch[0].toLowerCase());
          } else {
            songUuids.push(uMatch[0].toLowerCase());
          }
        }
      }
    }

    return {
      playlistUuids: [...new Set(playlistUuids)],
      songUuids: [...new Set(songUuids)]
    };
  }

  /**
   * Fetches an entire Suno playlist (all tracks, name, artwork) via local proxy or direct API
   * @param {string} playlistId
   * @returns {Promise<{ id: string, name: string, description: string, image_url: string, num_total_results: number, clips: Array<Object> }>}
   */
  static async fetchPlaylist(playlistId) {
    const cleanId = playlistId.toLowerCase().trim();

    // Tier 1: Local Proxy Server (highest reliability, bypasses CORS, automatic pagination)
    try {
      const resp = await fetch(`${SunoAPI.LOCAL_PROXY_URL}/api/suno/playlist/${cleanId}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.clips)) {
          return data;
        }
      }
    } catch (e) {}

    // Tier 2: Direct Studio API (for same-origin / extension / open contexts)
    try {
      const resp = await fetch(`https://studio-api.prod.suno.com/api/playlist/${cleanId}/?page=1`);
      if (resp.ok) {
        const data = await resp.json();
        const clips = (data.playlist_clips || []).map((item) => {
          const c = item.clip || {};
          const cid = (c.id || '').toLowerCase().trim();
          return {
            uuid: cid,
            title: c.title || `Suno_Song_${cid.slice(0, 8)}`,
            imageLarge: c.image_large_url || `https://cdn2.suno.ai/image_large_${cid}.jpeg`,
            imageThumb: c.image_url || `https://cdn1.suno.ai/image_${cid}.jpeg`,
            videoUrl: c.video_url || `https://cdn1.suno.ai/${cid}.mp4`,
            duration: c.duration || 0,
            prompt: (c.metadata || {}).prompt || '',
            tags: (c.metadata || {}).tags || '',
            streamUrl: `${SunoAPI.CLOUDFRONT_STREAM_BASE}${cid}.m4a`,
            sunoUrl: `https://suno.com/song/${cid}`,
            model: c.model_name || 'chirp-v3.5',
            playerMode: 'custom',
            hasStem: true
          };
        });
        return {
          id: cleanId,
          name: data.name || `Suno_Playlist_${cleanId.slice(0, 8)}`,
          description: data.description || '',
          image_url: data.image_url || '',
          num_total_results: data.num_total_results || clips.length,
          clips
        };
      }
    } catch (e) {}

    throw new Error(`Unable to fetch playlist ${cleanId}. Make sure the local helper proxy is running on port 8899.`);
  }

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
    // Tier 0: Same-Origin Laravel Backend
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch('/api/health', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch (e) {}

    // Tier 1: Local Python helper on port 8899
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

    // Attempt 1: Local Helper Proxy on port 8899 (Extracts exact Next.js RSC lyrics & true title)
    try {
      const localResp = await fetch(`${SunoAPI.LOCAL_PROXY_URL}/api/suno/song/${cleanUuid}`);
      if (localResp.ok) {
        const localData = await localResp.json();
        if (localData && (localData.title || localData.prompt)) {
          if (localData.title) meta.title = localData.title;
          if (localData.prompt) meta.prompt = localData.prompt;
          if (localData.tags) meta.tags = localData.tags;
          if (localData.duration) meta.duration = localData.duration;
          if (localData.imageLarge) meta.imageLarge = localData.imageLarge;
          if (localData.imageThumb) meta.imageThumb = localData.imageThumb;
          if (localData.videoUrl) meta.videoUrl = localData.videoUrl;
          if (localData.model) meta.model = localData.model;
          if (localData.artist) meta.artist = localData.artist;
          return meta;
        }
      }
    } catch (e) {}

    // Attempt 2: Suno Studio Clip API
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
      // Fallback to CORS proxies
    }

    // Attempt 3: Public CORS proxy page fetch + Next.js RSC parser
    try {
      const corsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://suno.com/song/${cleanUuid}`)}`;
      const pageResp = await fetch(corsUrl);
      if (pageResp.ok) {
        const html = await pageResp.text();
        const parsed = SunoAPI.parseNextRscHtml(html, cleanUuid);
        if (parsed.title) meta.title = parsed.title;
        if (parsed.prompt) meta.prompt = parsed.prompt;
        if (parsed.tags) meta.tags = parsed.tags;
        if (meta.title && meta.prompt) return meta;
      }
    } catch (e) {}

    // Attempt 4: Microlink OpenGraph scraper fallback
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
   * Parses title, tags, and prompt lyrics from Suno HTML React Server Component streaming chunks
   * @param {string} html
   * @param {string} uuid
   * @returns {Object}
   */
  static parseNextRscHtml(html, uuid) {
    const res = {};
    if (!html) return res;
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      const t = ogTitleMatch[1].replace(/\s*[|-]\s*Suno.*$/i, '').trim();
      if (t && t.toLowerCase() !== 'suno') res.title = t;
    }
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    if (ogDescMatch && ogDescMatch[1]) {
      res.tags = ogDescMatch[1].trim();
    }
    try {
      const promptPtrMatch = html.match(/"prompt"\s*:\s*"\$([0-9a-fA-F]+)"/);
      if (promptPtrMatch) {
        const ptr = promptPtrMatch[1];
        const chunkPattern = new RegExp(`(?:^|[\\r\\n])${ptr}:T([0-9a-fA-F]+),([\\s\\S]*?)(?:[\\r\\n][0-9a-fA-F]+:[A-Za-z0-9]|$)`);
        const chunkMatch = html.match(chunkPattern);
        if (chunkMatch && chunkMatch[2]) {
          const hexLen = parseInt(chunkMatch[1], 16);
          let rawPrompt = chunkMatch[2].slice(0, hexLen);
          rawPrompt = rawPrompt.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
          if (rawPrompt.trim().length > 0) res.prompt = rawPrompt.trim();
        }
      }
      if (!res.prompt) {
        const verseIdx = html.indexOf('[Verse');
        if (verseIdx !== -1) {
          const slice = html.substring(verseIdx, verseIdx + 4000);
          const endIdx = slice.search(/(?:<\/|",|\\"\s*[,}])/);
          if (endIdx > 50) {
            res.prompt = slice.substring(0, endIdx).replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
          }
        }
      }
    } catch (e) {}
    return res;
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
      'Could not acquire Mango DRM rights from external host due to browser CORS policies. Please use the 1-Click Bookmarklet on suno.com or launch the Python helper with: python helper/suno_helper.py --serve --port 8899'
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
