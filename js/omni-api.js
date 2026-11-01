/**
 * NTK OmniStream Studio - Universal Stream & Link Resolver
 * Multi-tier connectivity: Same-Origin Laravel Server -> Local OmniHelper -> In-Browser Fallbacks
 */

export class OmniAPI {
  static LOCAL_PROXY_URL = 'http://127.0.0.1:8899';
  static SUNO_UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  static SUNO_PLAYLIST_REGEX = /(?:suno\.com\/playlist\/|[?&]playlist=)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  static YOUTUBE_REGEX = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|playlist\?list=))([a-zA-Z0-9_-]{11,34})/i;
  static TIKTOK_REGEX = /tiktok\.com\/@?[a-zA-Z0-9_.-]+\/video\/(\d+)|vm\.tiktok\.com\/[a-zA-Z0-9_-]+/i;
  static SOUNDCLOUD_REGEX = /soundcloud\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/i;

  static _localActive = null;

  /**
   * Probes whether the Laravel backend or local Python helper is running
   * @returns {Promise<{ active: boolean, ytdl: boolean, ffmpeg: boolean, demucs: Object }>}
   */
  static async checkLocalHelper() {
    // Tier 0: Same-Origin Laravel Server
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/capabilities', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        OmniAPI._localActive = true;
        return {
          active: true,
          server: data.server || 'Laravel Server',
          ytdl: Boolean(data.yt_dlp),
          ffmpeg: Boolean(data.ffmpeg),
          demucs: data.demucs || { available: false, engine: 'In-Browser ONNX WebGPU/WASM' }
        };
      }
    } catch (e) {}

    // Tier 1: Local Python OmniHelper on port 8899 (only if running as static PWA or file:)
    if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.location.port === '8899' || !window.location.host.includes(':'))) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${OmniAPI.LOCAL_PROXY_URL}/api/capabilities`, {
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          OmniAPI._localActive = true;
          return {
            active: true,
            server: 'Local Python Helper',
            ytdl: Boolean(data.ytdl || data.yt_dlp),
            ffmpeg: Boolean(data.ffmpeg),
            demucs: data.demucs || { available: false }
          };
        }
      } catch (e) {
        OmniAPI._localActive = false;
      }
    }

    return {
      active: false,
      ytdl: false,
      ffmpeg: false,
      demucs: { available: false, engine: 'In-Browser ONNX WebGPU/WASM' }
    };
  }

  /**
   * Sanitizes URLs by stripping tracking queries and canonicalizing shortlinks
   * @param {string} raw
   * @returns {string}
   */
  static cleanUrl(raw) {
    let clean = String(raw || '').trim();
    if (!clean) return '';

    // Unshorten YouTube shortlinks
    const ytShort = clean.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
    if (ytShort) {
      clean = `https://www.youtube.com/watch?v=${ytShort[1]}`;
    }

    clean = clean.replace(/m\.youtube\.com/i, 'www.youtube.com');

    // Strip tracking queries
    try {
      const u = new URL(clean);
      const dropParams = ['si', 'feature', 'utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'igshid', 'share_id', 'locale'];
      dropParams.forEach((k) => u.searchParams.delete(k));
      return u.toString();
    } catch (e) {
      return clean;
    }
  }

  /**
   * Classifies an input string into platform and type
   * @param {string} input
   * @returns {{ platform: string, isPlaylist: boolean, raw: string }}
   */
  static classifyUrl(input) {
    const s = String(input || '').trim();
    if (!s) return { platform: 'Unknown', isPlaylist: false, raw: s };

    if (OmniAPI.SUNO_PLAYLIST_REGEX.test(s) || (s.includes('suno.com') && s.includes('/playlist/'))) {
      return { platform: 'Suno AI', isPlaylist: true, raw: s };
    }
    if (OmniAPI.SUNO_UUID_REGEX.test(s) && (s.includes('suno.com') || s.includes('suno.ai') || !s.includes('http'))) {
      return { platform: 'Suno AI', isPlaylist: false, raw: s };
    }
    if (OmniAPI.YOUTUBE_REGEX.test(s)) {
      return { platform: 'YouTube', isPlaylist: s.includes('list='), raw: s };
    }
    if (OmniAPI.TIKTOK_REGEX.test(s)) {
      return { platform: 'TikTok', isPlaylist: false, raw: s };
    }
    if (OmniAPI.SOUNDCLOUD_REGEX.test(s)) {
      return { platform: 'SoundCloud', isPlaylist: s.includes('/sets/'), raw: s };
    }
    if (s.includes('instagram.com')) {
      return { platform: 'Instagram', isPlaylist: false, raw: s };
    }
    if (s.includes('twitter.com') || s.includes('x.com')) {
      return { platform: 'Twitter/X', isPlaylist: false, raw: s };
    }
    if (s.includes('vimeo.com')) {
      return { platform: 'Vimeo', isPlaylist: false, raw: s };
    }
    if (s.includes('facebook.com') || s.includes('fb.watch')) {
      return { platform: 'Facebook', isPlaylist: false, raw: s };
    }
    if (/\.(m3u8|mpd)($|\?)/i.test(s)) {
      return { platform: 'HLS/DASH Stream', isPlaylist: false, raw: s };
    }
    if (/\.(mp3|wav|m4a|mp4|webm|flac|ogg)($|\?)/i.test(s)) {
      return { platform: 'Direct Media File', isPlaylist: false, raw: s };
    }
    return { platform: 'Universal Web', isPlaylist: false, raw: s };
  }

  /**
   * Resolves universal metadata for any link
   * @param {string} url
   * @returns {Promise<Object>}
   */
  static async resolveUrl(url) {
    const clean = OmniAPI.cleanUrl(url);
    if (!clean) throw new Error('Empty URL provided.');

    const q = encodeURIComponent(clean);

    // Tier 0: Same-Origin Laravel Server
    try {
      const res = await fetch(`/api/omni/resolve?url=${q}`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) {
          return data;
        }
      }
    } catch (e) {}

    // Tier 1: Local Python OmniHelper
    try {
      const res = await fetch(`${OmniAPI.LOCAL_PROXY_URL}/api/omni/resolve?url=${q}`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) {
          return data;
        }
      }
    } catch (e) {}

    // Tier 2: Direct Suno fallback
    const classification = OmniAPI.classifyUrl(clean);
    if (classification.platform === 'Suno AI') {
      return OmniAPI.resolveSunoDirect(clean);
    }

    // Tier 3: Direct media URL fallback
    if (classification.platform === 'Direct Media File') {
      const filename = clean.split('/').pop().split('?')[0] || 'Media_Track';
      const ext = filename.split('.').pop().toLowerCase();
      const isVid = ['mp4', 'webm', 'mov'].includes(ext);
      return {
        type: 'single',
        uuid: `direct-${Date.now().toString(16)}`,
        id: `direct-${Date.now().toString(16)}`,
        title: decodeURIComponent(filename.replace(/\.[^/.]+$/, '')),
        artist: 'Web Media Stream',
        duration: 0,
        imageLarge: '',
        imageThumb: '',
        streamUrl: clean,
        url: clean,
        platform: 'Direct Media File',
        hasVideo: isVid,
        hasAudio: true,
        hasStem: true,
        tags: `${ext.toUpperCase()} Stream`
      };
    }

    throw new Error(
      `Could not resolve "${classification.platform}" link. Verify the URL or check server connectivity.`
    );
  }

  /**
   * Direct Suno resolver without local helper
   */
  static async resolveSunoDirect(input) {
    const match = input.match(OmniAPI.SUNO_UUID_REGEX);
    if (!match) throw new Error(`Could not find Suno UUID in: ${input}`);
    const uuid = match[0].toLowerCase();

    // Check playlist
    if (input.includes('/playlist/')) {
      const resp = await fetch(`https://studio-api.prod.suno.com/api/playlist/${uuid}/?page=1`);
      if (resp.ok) {
        const data = await resp.json();
        const clips = (data.playlist_clips || []).map((item) => {
          const c = item.clip || {};
          const cid = (c.id || '').toLowerCase().trim();
          return {
            uuid: cid,
            title: c.title || `Suno_${cid.slice(0, 8)}`,
            artist: 'Suno AI',
            imageLarge: c.image_large_url || `https://cdn2.suno.ai/image_large_${cid}.jpeg`,
            imageThumb: c.image_url || `https://cdn1.suno.ai/image_${cid}.jpeg`,
            streamUrl: `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${cid}.m4a`,
            url: `https://suno.com/song/${cid}`,
            duration: c.duration || 0,
            prompt: (c.metadata || {}).prompt || '',
            tags: (c.metadata || {}).tags || 'Suno AI Track',
            platform: 'Suno AI',
            hasVideo: true,
            hasAudio: true,
            hasStem: true
          };
        });
        return {
          type: 'playlist',
          id: uuid,
          title: data.name || `Suno Playlist ${uuid.slice(0, 8)}`,
          count: clips.length,
          clips
        };
      }
    }

    // Single Clip
    let title = `Suno_${uuid.slice(0, 8)}`;
    let duration = 180;
    let image = `https://cdn2.suno.ai/image_large_${uuid}.jpeg`;
    let prompt = '';
    let tags = 'Suno AI Generation';

    try {
      const clipResp = await fetch(`https://studio-api.prod.suno.com/api/clip/${uuid}`);
      if (clipResp.ok) {
        const c = await clipResp.json();
        title = c.title || title;
        duration = c.duration || duration;
        image = c.image_large_url || image;
        prompt = (c.metadata || {}).prompt || '';
        tags = (c.metadata || {}).tags || tags;
      }
    } catch (e) {}

    return {
      type: 'single',
      uuid,
      id: uuid,
      title,
      artist: 'Suno AI',
      duration,
      imageLarge: image,
      imageThumb: image,
      streamUrl: `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${uuid}.m4a`,
      url: `https://suno.com/song/${uuid}`,
      prompt,
      tags,
      platform: 'Suno AI',
      hasVideo: true,
      hasAudio: true,
      hasStem: true
    };
  }

  /**
   * Starts a download job
   */
  static async startDownload(url, targetFormat = 'mp3', audioOnly = false) {
    // Tier 0: Same-Origin Laravel Server
    try {
      const res = await fetch('/api/omni/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format: targetFormat, is_audio_only: audioOnly })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.job_id) return data.job_id;
      }
    } catch (e) {}

    // Tier 1: Local Python OmniHelper
    const res = await fetch(`${OmniAPI.LOCAL_PROXY_URL}/api/omni/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: targetFormat, audioOnly })
    });
    if (!res.ok) throw new Error('Failed to dispatch download task to OmniStream server.');
    const data = await res.json();
    return data.jobId || data.job_id;
  }

  /**
   * Polls job progress until complete
   */
  static async pollJob(jobId, onProgress = () => {}) {
    let attempts = 0;
    while (attempts < 300) {
      attempts++;
      await new Promise((r) => setTimeout(r, 800));

      // Tier 0: Check same origin
      try {
        const res = await fetch(`/api/omni/status/${jobId}`);
        if (res.ok) {
          const job = await res.json();
          onProgress(job.progress || 0, job.message || 'Processing stream...');
          if (job.status === 'completed' || job.status === 'complete') {
            return job.download_url || `/api/omni/stream/${jobId}`;
          }
          if (job.status === 'failed' || job.status === 'error') {
            throw new Error(job.error || 'Download task failed.');
          }
          continue;
        }
      } catch (e) {
        if (e.message && !e.message.includes('Failed to fetch')) throw e;
      }

      // Tier 1: Check local helper
      try {
        const res = await fetch(`${OmniAPI.LOCAL_PROXY_URL}/api/omni/status/${jobId}`);
        if (res.ok) {
          const job = await res.json();
          onProgress(job.percent || 0, job.message || 'Processing...');
          if (job.status === 'complete' || job.status === 'completed') {
            return `${OmniAPI.LOCAL_PROXY_URL}/api/omni/download-file/${jobId}`;
          }
          if (job.status === 'error' || job.status === 'failed') {
            throw new Error(job.error || job.message || 'Download task failed.');
          }
        }
      } catch (err) {
        if (err.message && !err.message.includes('Failed to fetch')) {
          throw err;
        }
      }
    }
    throw new Error('Download task timed out.');
  }

  /**
   * Saves cookies to server for private downloads
   */
  static async saveCookies(cookiesText) {
    // Tier 0: Same-Origin Laravel Server
    try {
      const res = await fetch('/api/omni/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookiesText })
      });
      if (res.ok) return res.json();
    } catch (e) {}

    // Tier 1: Local Python OmniHelper
    const res = await fetch(`${OmniAPI.LOCAL_PROXY_URL}/api/omni/cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: cookiesText })
    });
    return res.json();
  }
}
