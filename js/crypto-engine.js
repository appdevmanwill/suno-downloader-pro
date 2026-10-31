/**
 * Suno Downloader Pro - Crypto Engine
 * Implements Mango DRM (2026 Edition) AES-GCM + AES-CTR Key Derivation and Decryption
 */

export class CryptoEngine {
  /**
   * Decrypts an encrypted Suno audio stream using Mango DRM rights.
   *
   * @param {ArrayBuffer} encryptedBuffer - Raw bytes of the encrypted .m4a stream from CloudFront
   * @param {Object} rights - Object containing { glt, key, iv }
   * @param {string} uuid - Suno song content UUID
   * @param {Function} [onProgress] - Optional progress callback (stage: string)
   * @returns {Promise<ArrayBuffer>} Decrypted audio buffer (.m4a AAC)
   */
  static async decryptStream(encryptedBuffer, rights, uuid, onProgress = () => {}) {
    if (!rights || !rights.glt || !rights.key || !rights.iv) {
      throw new Error('Incomplete Mango DRM rights payload provided.');
    }

    const cleanUuid = uuid.toLowerCase().trim();

    // Step 1: Derive Master Key from GLT token using SHA-256
    onProgress('Deriving cryptographic master key...');
    const gltBytes = new TextEncoder().encode(rights.glt);
    const masterKeyDigest = await crypto.subtle.digest('SHA-256', gltBytes);

    const masterKey = await crypto.subtle.importKey(
      'raw',
      masterKeyDigest,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Step 2: Unwrap Content Key and IV using AES-GCM with UUID as AAD
    onProgress('Unwrapping content encryption keys...');
    const unwrapGcm = async (b64String) => {
      const rawBytes = CryptoEngine.base64ToUint8Array(b64String);
      if (rawBytes.length < 28) {
        throw new Error('Invalid wrapped key payload size.');
      }
      const iv = rawBytes.slice(0, 12);
      const ciphertextWithTag = rawBytes.slice(12);
      const aad = new TextEncoder().encode(cleanUuid);

      const unwrapped = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: aad
        },
        masterKey,
        ciphertextWithTag
      );
      return new Uint8Array(unwrapped);
    };

    const [unwrappedKeyBytes, unwrappedIvBytes] = await Promise.all([
      unwrapGcm(rights.key),
      unwrapGcm(rights.iv)
    ]);

    // Step 3: Import Content Key for AES-CTR
    onProgress('Initializing AES-CTR stream cipher...');
    const contentKey = await crypto.subtle.importKey(
      'raw',
      unwrappedKeyBytes,
      { name: 'AES-CTR' },
      false,
      ['decrypt']
    );

    // Step 4: Decrypt the full stream
    onProgress('Decrypting audio stream...');
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-CTR',
        counter: unwrappedIvBytes,
        length: 128
      },
      contentKey,
      encryptedBuffer
    );

    onProgress('Decryption complete!');
    return decryptedBuffer;
  }

  /**
   * Helper to decode Base64 string to Uint8Array
   * @param {string} b64
   * @returns {Uint8Array}
   */
  static base64ToUint8Array(b64) {
    const binary = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
