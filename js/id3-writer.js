/**
 * Suno Downloader Pro - ID3v2.3 Metadata & Cover Art Tagger
 * Embeds Title, Artist, Album, Genre Tags, Lyrics (USLT), and High-Res Cover Art (APIC)
 * directly into MP3 Blobs completely client-side.
 */

export class ID3Writer {
  static _coverCache = new Map();

  /**
   * Encodes a JS string as UTF-16LE bytes with 0xFF 0xFE BOM
   * @param {string} str
   * @returns {Uint8Array}
   */
  static encodeUtf16LeWithBom(str) {
    const text = String(str || '');
    const out = new Uint8Array(2 + text.length * 2);
    out[0] = 0xFF;
    out[1] = 0xFE;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      out[2 + i * 2] = code & 0xFF;
      out[2 + i * 2 + 1] = (code >> 8) & 0xFF;
    }
    return out;
  }

  /**
   * Encodes an ASCII string into Uint8Array
   * @param {string} str
   * @returns {Uint8Array}
   */
  static encodeAscii(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      out[i] = str.charCodeAt(i) & 0x7F;
    }
    return out;
  }

  /**
   * Builds a 10-byte ID3v2.3 frame header + payload
   * Note: ID3v2.3 uses standard 32-bit big-endian integer for individual frame sizes.
   * @param {string} frameId - 4-char ID (e.g. 'TIT2', 'APIC')
   * @param {Uint8Array} payload
   * @returns {Uint8Array}
   */
  static buildFrame(frameId, payload) {
    const size = payload.byteLength;
    const frame = new Uint8Array(10 + size);
    for (let i = 0; i < 4; i++) {
      frame[i] = frameId.charCodeAt(i);
    }
    frame[4] = (size >>> 24) & 0xFF;
    frame[5] = (size >>> 16) & 0xFF;
    frame[6] = (size >>> 8) & 0xFF;
    frame[7] = size & 0xFF;
    frame[8] = 0x00;
    frame[9] = 0x00;
    frame.set(payload, 10);
    return frame;
  }

  /**
   * Builds a standard UTF-16 text frame (TIT2, TPE1, TALB, TCON, TYER)
   */
  static buildTextFrame(frameId, value) {
    if (!value) return null;
    const textBytes = ID3Writer.encodeUtf16LeWithBom(String(value).trim());
    const payload = new Uint8Array(1 + textBytes.byteLength);
    payload[0] = 0x01; // UTF-16 with BOM
    payload.set(textBytes, 1);
    return ID3Writer.buildFrame(frameId, payload);
  }

  /**
   * Builds an Unsynchronized Lyrics (USLT) frame
   */
  static buildLyricsFrame(lyrics) {
    if (!lyrics || !String(lyrics).trim()) return null;
    const lyricsBytes = ID3Writer.encodeUtf16LeWithBom(String(lyrics).trim());
    // 1 byte encoding (0x01) + 3 bytes lang ('eng') + 4 bytes empty UTF-16 descriptor (FF FE 00 00) + lyrics
    const payload = new Uint8Array(1 + 3 + 4 + lyricsBytes.byteLength);
    payload[0] = 0x01;
    payload[1] = 0x65; // 'e'
    payload[2] = 0x6E; // 'n'
    payload[3] = 0x67; // 'g'
    payload[4] = 0xFF;
    payload[5] = 0xFE;
    payload[6] = 0x00;
    payload[7] = 0x00;
    payload.set(lyricsBytes, 8);
    return ID3Writer.buildFrame('USLT', payload);
  }

  /**
   * Builds an Attached Picture (APIC) front cover frame
   * @param {Uint8Array} imageBytes
   * @param {string} mimeType
   */
  static buildCoverArtFrame(imageBytes, mimeType = 'image/jpeg') {
    if (!imageBytes || imageBytes.byteLength === 0) return null;
    const mimeBytes = ID3Writer.encodeAscii(mimeType);
    // 1 byte encoding (0x00) + mime + 0x00 + picType (0x03 Front Cover) + empty desc (0x00) + imageBytes
    const headerLen = 1 + mimeBytes.byteLength + 1 + 1 + 1;
    const payload = new Uint8Array(headerLen + imageBytes.byteLength);
    let offset = 0;
    payload[offset++] = 0x00; // ISO-8859-1
    payload.set(mimeBytes, offset);
    offset += mimeBytes.byteLength;
    payload[offset++] = 0x00; // null terminator for MIME
    payload[offset++] = 0x03; // 0x03 = Cover (front)
    payload[offset++] = 0x00; // empty description null terminator
    payload.set(imageBytes, offset);
    return ID3Writer.buildFrame('APIC', payload);
  }

  /**
   * Fetches cover image bytes safely (with memory cache)
   * @param {string} coverUrl
   * @returns {Promise<{ bytes: Uint8Array, mime: string }|null>}
   */
  static async fetchCoverBytes(coverUrl) {
    if (!coverUrl) return null;
    if (ID3Writer._coverCache.has(coverUrl)) {
      return ID3Writer._coverCache.get(coverUrl);
    }

    try {
      const resp = await fetch(coverUrl);
      if (!resp.ok) return null;
      const mime = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0) return null;
      const entry = {
        bytes: new Uint8Array(buf),
        mime: mime.startsWith('image/') ? mime : 'image/jpeg'
      };
      ID3Writer._coverCache.set(coverUrl, entry);
      return entry;
    } catch (e) {
      return null;
    }
  }

  /**
   * Embeds ID3v2.3 metadata & cover art into an MP3 Blob
   * @param {Blob} mp3Blob
   * @param {Object} meta - { title, artist, album, genre, year, lyrics, coverUrl, coverBytes, coverMime }
   * @returns {Promise<Blob>} Tagged MP3 Blob
   */
  static async embedTags(mp3Blob, meta = {}) {
    try {
      const frames = [];

      const titleFrame = ID3Writer.buildTextFrame('TIT2', meta.title || 'Suno Track');
      const artistFrame = ID3Writer.buildTextFrame('TPE1', meta.artist || 'Suno AI Studio');
      const albumFrame = ID3Writer.buildTextFrame('TALB', meta.album || 'Suno Downloader Pro');
      const genreFrame = ID3Writer.buildTextFrame('TCON', (meta.genre || meta.tags || 'AI Music').slice(0, 120));
      const yearFrame = ID3Writer.buildTextFrame('TYER', meta.year || String(new Date().getFullYear()));
      const lyricsFrame = ID3Writer.buildLyricsFrame(meta.lyrics || meta.prompt || '');

      [titleFrame, artistFrame, albumFrame, genreFrame, yearFrame, lyricsFrame].forEach(f => {
        if (f) frames.push(f);
      });

      let coverData = null;
      if (meta.coverBytes) {
        coverData = { bytes: meta.coverBytes, mime: meta.coverMime || 'image/jpeg' };
      } else if (meta.coverUrl || meta.imageLarge) {
        coverData = await ID3Writer.fetchCoverBytes(meta.coverUrl || meta.imageLarge);
      }

      if (coverData) {
        const apicFrame = ID3Writer.buildCoverArtFrame(coverData.bytes, coverData.mime);
        if (apicFrame) frames.push(apicFrame);
      }

      const framesTotalSize = frames.reduce((sum, f) => sum + f.byteLength, 0);

      // 10-byte ID3v2.3 main header (uses 28-bit synchsafe integer)
      const header = new Uint8Array(10);
      header[0] = 0x49; // 'I'
      header[1] = 0x44; // 'D'
      header[2] = 0x33; // '3'
      header[3] = 0x03; // v2.3
      header[4] = 0x00; // revision 0
      header[5] = 0x00; // flags
      header[6] = (framesTotalSize >>> 21) & 0x7F;
      header[7] = (framesTotalSize >>> 14) & 0x7F;
      header[8] = (framesTotalSize >>> 7) & 0x7F;
      header[9] = framesTotalSize & 0x7F;

      const rawMp3Buffer = await mp3Blob.arrayBuffer();
      let audioBytes = new Uint8Array(rawMp3Buffer);

      // Strip existing ID3v2 header if already present
      if (audioBytes.length > 10 && audioBytes[0] === 0x49 && audioBytes[1] === 0x44 && audioBytes[2] === 0x33) {
        const oldSize =
          ((audioBytes[6] & 0x7F) << 21) |
          ((audioBytes[7] & 0x7F) << 14) |
          ((audioBytes[8] & 0x7F) << 7) |
          (audioBytes[9] & 0x7F);
        if (10 + oldSize < audioBytes.length) {
          audioBytes = audioBytes.subarray(10 + oldSize);
        }
      }

      return new Blob([header, ...frames, audioBytes], { type: 'audio/mpeg' });
    } catch (err) {
      console.warn('ID3 tag embedding skipped:', err);
      return mp3Blob;
    }
  }
}
