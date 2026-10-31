/**
 * Suno Downloader Pro - IndexedDB Offline Audio & Stems Vault
 * Persists master audio buffers, separated 4-stem WAV packages, and ONNX neural models across reloads.
 */

export class VaultDB {
  static DB_NAME = 'SunoStudioVaultDB';
  static DB_VERSION = 1;
  static _dbPromise = null;

  /**
   * Opens (or returns cached handle to) the IndexedDB database
   * @returns {Promise<IDBDatabase|null>}
   */
  static open() {
    if (VaultDB._dbPromise) return VaultDB._dbPromise;

    VaultDB._dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }

      const req = indexedDB.open(VaultDB.DB_NAME, VaultDB.DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('audio_masters')) {
          db.createObjectStore('audio_masters', { keyPath: 'uuid' });
        }
        if (!db.objectStoreNames.contains('stems_cache')) {
          db.createObjectStore('stems_cache', { keyPath: 'uuid' });
        }
        if (!db.objectStoreNames.contains('ai_models')) {
          db.createObjectStore('ai_models', { keyPath: 'id' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('IndexedDB unavailable; running with in-memory cache only.');
        resolve(null);
      };
    });

    return VaultDB._dbPromise;
  }

  /**
   * Saves master audio ArrayBuffer to IndexedDB
   * @param {string} uuid
   * @param {ArrayBuffer} decryptedBuffer
   */
  static async saveMaster(uuid, decryptedBuffer) {
    const db = await VaultDB.open();
    if (!db || !decryptedBuffer) return;

    const cleanId = uuid.toLowerCase().trim();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('audio_masters', 'readwrite');
        tx.objectStore('audio_masters').put({
          uuid: cleanId,
          buffer: decryptedBuffer.slice(0),
          byteLength: decryptedBuffer.byteLength,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Retrieves master audio ArrayBuffer from IndexedDB
   * @param {string} uuid
   * @returns {Promise<ArrayBuffer|null>}
   */
  static async getMaster(uuid) {
    const db = await VaultDB.open();
    if (!db) return null;

    const cleanId = uuid.toLowerCase().trim();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('audio_masters', 'readonly');
        const req = tx.objectStore('audio_masters').get(cleanId);
        req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Saves separated 4-stem WAV ArrayBuffers to IndexedDB
   * @param {string} uuid
   * @param {Object} payload - { engine, vocalsWav, drumsWav, bassWav, otherWav }
   */
  static async saveStems(uuid, payload) {
    const db = await VaultDB.open();
    if (!db || !payload) return;

    const cleanId = uuid.toLowerCase().trim();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('stems_cache', 'readwrite');
        tx.objectStore('stems_cache').put({
          uuid: cleanId,
          engine: payload.engine || 'htdemucs',
          vocalsWav: payload.vocalsWav,
          drumsWav: payload.drumsWav,
          bassWav: payload.bassWav,
          otherWav: payload.otherWav,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Retrieves cached 4-stem WAV ArrayBuffers from IndexedDB
   * @param {string} uuid
   * @returns {Promise<Object|null>}
   */
  static async getStems(uuid) {
    const db = await VaultDB.open();
    if (!db) return null;

    const cleanId = uuid.toLowerCase().trim();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('stems_cache', 'readonly');
        const req = tx.objectStore('stems_cache').get(cleanId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Removes cached audio & stems for a song
   * @param {string} uuid
   */
  static async deleteSongAssets(uuid) {
    const db = await VaultDB.open();
    if (!db) return;

    const cleanId = uuid.toLowerCase().trim();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(['audio_masters', 'stems_cache'], 'readwrite');
        tx.objectStore('audio_masters').delete(cleanId);
        tx.objectStore('stems_cache').delete(cleanId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Saves an ONNX neural model ArrayBuffer in IndexedDB so static hosts cache it permanently
   * @param {string} id
   * @param {ArrayBuffer} modelBuffer
   */
  static async saveModel(id, modelBuffer) {
    const db = await VaultDB.open();
    if (!db || !modelBuffer) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction('ai_models', 'readwrite');
        tx.objectStore('ai_models').put({
          id,
          buffer: modelBuffer,
          byteLength: modelBuffer.byteLength,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Loads a cached ONNX neural model ArrayBuffer from IndexedDB
   * @param {string} id
   * @returns {Promise<ArrayBuffer|null>}
   */
  static async getModel(id) {
    const db = await VaultDB.open();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction('ai_models', 'readonly');
        const req = tx.objectStore('ai_models').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Returns summary of cached UUIDs for UI badges ("Cached Offline" / "4 Stems Ready")
   * @returns {Promise<{ masterIds: Set<string>, stemIds: Set<string>, hasOnnxModel: boolean }>}
   */
  static async getVaultSummary() {
    const summary = {
      masterIds: new Set(),
      stemIds: new Set(),
      hasOnnxModel: false
    };

    const db = await VaultDB.open();
    if (!db) return summary;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(['audio_masters', 'stems_cache', 'ai_models'], 'readonly');
        const mReq = tx.objectStore('audio_masters').getAllKeys();
        const sReq = tx.objectStore('stems_cache').getAllKeys();
        const aReq = tx.objectStore('ai_models').getAllKeys();

        tx.oncomplete = () => {
          (mReq.result || []).forEach(k => summary.masterIds.add(String(k)));
          (sReq.result || []).forEach(k => summary.stemIds.add(String(k)));
          summary.hasOnnxModel = (aReq.result || []).includes('htdemucs_embedded_v1');
          resolve(summary);
        };
        tx.onerror = () => resolve(summary);
      } catch (e) {
        resolve(summary);
      }
    });
  }

  /**
   * Clears cached audio & stems (preserves downloaded ONNX model weights unless clearModels=true)
   * @param {boolean} [clearModels=false]
   */
  static async clearAudioVault(clearModels = false) {
    const db = await VaultDB.open();
    if (!db) return;

    const stores = clearModels
      ? ['audio_masters', 'stems_cache', 'ai_models']
      : ['audio_masters', 'stems_cache'];

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach(s => tx.objectStore(s).clear());
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
}
