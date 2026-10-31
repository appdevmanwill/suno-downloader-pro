/**
 * Suno Downloader Pro - Storage & Cache Manager
 * Manages song history, metadata caching, and in-memory audio buffers
 */

export class StorageManager {
  static STORAGE_KEY = 'suno_downloader_pro_v1';

  // In-memory cache for decrypted audio buffers to prevent redundant network fetches
  static _bufferCache = new Map(); // uuid -> { decryptedBuffer, audioBuffer, stems }

  /**
   * Loads saved songs from LocalStorage
   * @returns {Array<Object>}
   */
  static loadSongs() {
    try {
      const data = localStorage.getItem(StorageManager.STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Could not parse saved songs from localStorage', e);
    }
    return [];
  }

  /**
   * Persists songs array to LocalStorage
   * @param {Array<Object>} songs
   */
  static saveSongs(songs) {
    try {
      localStorage.setItem(StorageManager.STORAGE_KEY, JSON.stringify(songs));
    } catch (e) {
      console.warn('Could not save songs to localStorage', e);
    }
  }

  /**
   * Adds or updates a song in LocalStorage
   * @param {Object} song
   */
  static upsertSong(song) {
    const songs = StorageManager.loadSongs();
    const existingIdx = songs.findIndex(s => s.uuid === song.uuid);
    if (existingIdx !== -1) {
      songs[existingIdx] = { ...songs[existingIdx], ...song };
    } else {
      songs.unshift(song);
    }
    StorageManager.saveSongs(songs);
  }

  /**
   * Removes a song by UUID
   * @param {string} uuid
   */
  static removeSong(uuid) {
    const cleanId = uuid.toLowerCase().trim();
    const songs = StorageManager.loadSongs().filter(s => s.uuid !== cleanId);
    StorageManager.saveSongs(songs);
    StorageManager._bufferCache.delete(cleanId);
  }

  /**
   * Clears all saved songs
   */
  static clearAll() {
    try {
      localStorage.removeItem(StorageManager.STORAGE_KEY);
    } catch (e) {}
    StorageManager._bufferCache.clear();
  }

  /**
   * Memory buffer cache helpers
   */
  static setCachedBuffer(uuid, data) {
    StorageManager._bufferCache.set(uuid.toLowerCase().trim(), data);
  }

  static getCachedBuffer(uuid) {
    return StorageManager._bufferCache.get(uuid.toLowerCase().trim()) || null;
  }

  /**
   * Exports playlist as JSON
   * @returns {string}
   */
  static exportPlaylist() {
    const songs = StorageManager.loadSongs();
    return JSON.stringify(songs, null, 2);
  }

  /**
   * Imports playlist from JSON string
   * @param {string} jsonStr
   * @returns {number} Count of imported songs
   */
  static importPlaylist(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) throw new Error('Invalid playlist format');
    const existing = StorageManager.loadSongs();
    const existingIds = new Set(existing.map(s => s.uuid));

    let count = 0;
    parsed.forEach(item => {
      if (item && item.uuid && !existingIds.has(item.uuid)) {
        existing.push(item);
        count++;
      }
    });

    StorageManager.saveSongs(existing);
    return count;
  }
}
