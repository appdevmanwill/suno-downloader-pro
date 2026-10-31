/**
 * Suno Downloader Pro - ZIP Archive Packager
 * Packages multi-stem kits, complete song bundles, and multi-song deck batches into single .ZIP downloads.
 */

import { AudioConverter } from './audio-converter.js?v=2026.2';
import { Mp3Encoder } from './mp3-encoder.js?v=2026.2';
import { ID3Writer } from './id3-writer.js?v=2026.2';
import { LyricsUtils } from './lyrics-utils.js?v=2026.2';

export class ZipPackager {
  static ensureJSZip() {
    if (typeof window.JSZip === 'undefined') {
      throw new Error('JSZip library is not loaded.');
    }
    return new window.JSZip();
  }

  static safeName(str, fallback = 'Suno_Song') {
    return String(str || fallback)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 65) || fallback;
  }

  /**
   * Packages all 4 neural stems + combined Instrumental + Cover + Lyrics into a single .ZIP
   *
   * @param {Object} song
   * @param {Object} stems - { vocals, drums, bass, other, instrumental } AudioBuffers
   * @param {'wav'|'mp3'} [format='wav']
   * @param {Function} [onProgress] - (percent, text)
   * @returns {Promise<Blob>}
   */
  static async buildStemsZip(song, stems, format = 'wav', onProgress = () => {}) {
    const zip = ZipPackager.ensureJSZip();
    const base = ZipPackager.safeName(song.title);
    const folder = zip.folder(`${base} - Neural Stems`);

    const items = [
      { key: 'vocals', name: `01 - ${base} (Vocals)` },
      { key: 'drums', name: `02 - ${base} (Drums)` },
      { key: 'bass', name: `03 - ${base} (Bass)` },
      { key: 'other', name: `04 - ${base} (Other - Melodies)` },
      { key: 'instrumental', name: `05 - ${base} (Full Instrumental)` }
    ];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const buf = stems[item.key];
      if (!buf) continue;

      const basePct = Math.round((i / items.length) * 85);
      if (format === 'mp3') {
        onProgress(basePct, `Encoding ${item.key} (320k MP3 + ID3)...`);
        const rawMp3 = await Mp3Encoder.encode(buf, 320);
        const tagged = await ID3Writer.embedTags(rawMp3, {
          title: `${song.title} (${item.key.toUpperCase()})`,
          genre: song.tags,
          lyrics: item.key === 'vocals' ? song.prompt : '',
          coverUrl: song.imageLarge
        });
        folder.file(`${item.name}.mp3`, tagged, { compression: 'STORE' });
      } else {
        onProgress(basePct, `Packaging ${item.key} (Lossless 16-bit WAV)...`);
        const wavBuf = AudioConverter.encodeWavArrayBuffer(buf);
        folder.file(`${item.name}.wav`, wavBuf, { compression: 'STORE' });
      }
    }

    onProgress(88, 'Attaching cover art & synced lyrics...');
    const coverData = await ID3Writer.fetchCoverBytes(song.imageLarge);
    if (coverData) {
      folder.file(`${base} - Cover.jpg`, coverData.bytes, { compression: 'STORE' });
    }

    const dur = (stems.vocals && stems.vocals.duration) || song.duration || 180;
    folder.file(`${base} - Lyrics.txt`, LyricsUtils.toTxt(song));
    folder.file(`${base} - Karaoke.lrc`, LyricsUtils.toLrc(song, dur));
    folder.file(`${base} - Subtitles.srt`, LyricsUtils.toSrt(song, dur));

    onProgress(94, 'Finalizing ZIP archive...');
    const blob = await zip.generateAsync({ type: 'blob' });
    onProgress(100, 'Stems ZIP ready!');
    return blob;
  }

  /**
   * Packages a Complete Song Studio Pack (M4A + Tagged 320k MP3 + Cover + TXT/LRC/SRT + Cached Stems if present)
   */
  static async buildSongPackZip(song, audioPayload, cachedStemsWavs = null, onProgress = () => {}) {
    const zip = ZipPackager.ensureJSZip();
    const base = ZipPackager.safeName(song.title);
    const folder = zip.folder(base);

    onProgress(10, 'Adding untouched M4A master...');
    if (audioPayload.decryptedBuffer) {
      folder.file(`${base}.m4a`, audioPayload.decryptedBuffer, { compression: 'STORE' });
    }

    onProgress(20, 'Encoding 320k MP3 with embedded cover art & ID3 lyrics...');
    const rawMp3 = await Mp3Encoder.encode(audioPayload.audioBuffer, 320, (pct) => {
      onProgress(20 + Math.round(pct * 0.55), `Encoding Tagged MP3 (${pct}%)...`);
    });
    const taggedMp3 = await ID3Writer.embedTags(rawMp3, {
      title: song.title,
      genre: song.tags,
      lyrics: song.prompt,
      coverUrl: song.imageLarge
    });
    folder.file(`${base} (320k Tagged).mp3`, taggedMp3, { compression: 'STORE' });

    onProgress(80, 'Embedding artwork & lyrics (.txt / .lrc / .srt)...');
    const coverData = await ID3Writer.fetchCoverBytes(song.imageLarge);
    if (coverData) {
      folder.file(`${base} - Cover.jpg`, coverData.bytes, { compression: 'STORE' });
    }

    const dur = audioPayload.audioBuffer.duration || song.duration || 180;
    folder.file(`${base} - Lyrics.txt`, LyricsUtils.toTxt(song));
    folder.file(`${base} - Karaoke.lrc`, LyricsUtils.toLrc(song, dur));
    folder.file(`${base} - Subtitles.srt`, LyricsUtils.toSrt(song, dur));

    if (cachedStemsWavs && cachedStemsWavs.vocalsWav) {
      onProgress(88, 'Including cached 4-track neural WAV stems...');
      const stemsDir = folder.folder('Stems');
      stemsDir.file(`01 - Vocals.wav`, cachedStemsWavs.vocalsWav, { compression: 'STORE' });
      stemsDir.file(`02 - Drums.wav`, cachedStemsWavs.drumsWav, { compression: 'STORE' });
      stemsDir.file(`03 - Bass.wav`, cachedStemsWavs.bassWav, { compression: 'STORE' });
      stemsDir.file(`04 - Other.wav`, cachedStemsWavs.otherWav, { compression: 'STORE' });
    }

    onProgress(95, 'Finalizing Song Pack ZIP...');
    const blob = await zip.generateAsync({ type: 'blob' });
    onProgress(100, 'Song Pack ZIP complete!');
    return blob;
  }

  /**
   * Packages all songs in the deck into a single Batch ZIP archive
   * @param {Array<Object>} songs
   * @param {Function} getAudioFn - async (uuid, statusCb) => { decryptedBuffer, audioBuffer }
   * @param {'m4a'|'mp3'|'wav'} [format='mp3']
   * @param {Function} [onProgress] - (percent, text)
   */
  static async buildBatchDeckZip(songs, getAudioFn, format = 'mp3', onProgress = () => {}) {
    const zip = ZipPackager.ensureJSZip();
    const total = songs.length;

    for (let i = 0; i < total; i++) {
      const song = songs[i];
      const base = ZipPackager.safeName(`${String(i + 1).padStart(2, '0')} - ${song.title}`);
      const songFolder = zip.folder(base);
      const startPct = Math.round((i / total) * 90);

      onProgress(startPct, `[${i + 1}/${total}] Preparing "${song.title}"...`);
      const payload = await getAudioFn(song.uuid, (st) => {
        onProgress(startPct, `[${i + 1}/${total}] ${song.title}: ${st}`);
      });

      if (format === 'mp3') {
        const rawMp3 = await Mp3Encoder.encode(payload.audioBuffer, 320);
        const tagged = await ID3Writer.embedTags(rawMp3, {
          title: song.title,
          genre: song.tags,
          lyrics: song.prompt,
          coverUrl: song.imageLarge
        });
        songFolder.file(`${ZipPackager.safeName(song.title)}.mp3`, tagged, { compression: 'STORE' });
      } else if (format === 'wav') {
        const wavBuf = AudioConverter.encodeWavArrayBuffer(payload.audioBuffer);
        songFolder.file(`${ZipPackager.safeName(song.title)}.wav`, wavBuf, { compression: 'STORE' });
      } else {
        songFolder.file(`${ZipPackager.safeName(song.title)}.m4a`, payload.decryptedBuffer, { compression: 'STORE' });
      }

      const coverData = await ID3Writer.fetchCoverBytes(song.imageLarge);
      if (coverData) {
        songFolder.file('Cover.jpg', coverData.bytes, { compression: 'STORE' });
      }

      const dur = payload.audioBuffer.duration || song.duration || 180;
      songFolder.file('Lyrics.txt', LyricsUtils.toTxt(song));
      songFolder.file('Karaoke.lrc', LyricsUtils.toLrc(song, dur));
    }

    onProgress(95, 'Generating Batch ZIP archive...');
    const blob = await zip.generateAsync({ type: 'blob' });
    onProgress(100, 'Batch ZIP ready!');
    return blob;
  }
}
