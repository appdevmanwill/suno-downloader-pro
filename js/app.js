/**
 * Suno Downloader Pro - Main Application Orchestrator
 * 2026 Studio Edition (HTDemucs v4 4-Stem Neural AI, Trimmer & FX, ID3v2.3, ZIP, Karaoke Video & PWA Vault)
 */

import { SunoAPI } from './suno-api.js?v=2026.4';
import { CryptoEngine } from './crypto-engine.js?v=2026.4';
import { AudioConverter } from './audio-converter.js?v=2026.4';
import { Mp3Encoder } from './mp3-encoder.js?v=2026.4';
import { ID3Writer } from './id3-writer.js?v=2026.4';
import { LyricsUtils } from './lyrics-utils.js?v=2026.4';
import { VaultDB } from './vault-db.js?v=2026.4';
import { StemEngine } from './stem-engine.js?v=2026.4';
import { StemMixer } from './stem-mixer.js?v=2026.4';
import { AudioFXEngine } from './audio-fx.js?v=2026.4';
import { ZipPackager } from './zip-packager.js?v=2026.4';
import { VideoGenerator } from './video-generator.js?v=2026.4';
import { BookmarkletEngine } from './bookmarklet.js?v=2026.4';
import { StorageManager } from './storage.js?v=2026.4';
import { PlayerEngine } from './player.js?v=2026.4';

class App {
  constructor() {
    this.player = new PlayerEngine();
    this.stemMixer = new StemMixer((tick) => this.onStemMixerTick(tick));
    this.videoStudio = null;

    this.isLocalProxyActive = false;
    this.localDemucsCaps = { available: false, device: 'cpu', engine: 'none' };

    this.activeStudioSong = null;
    this.activeStemsSong = null;
    this.activeTrimSong = null;

    this.trimState = {
      duration: 0,
      startSec: 0,
      endSec: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      preset: 'clean',
      peaks: null,
      audioBuffer: null
    };
    this.fxPreviewSource = null;

    this.vaultSummary = {
      masterIds: new Set(),
      stemIds: new Set(),
      hasOnnxModel: false
    };

    this.deferredInstallPrompt = null;
  }

  async init() {
    this.setupUIBindings();
    this.setupBookmarklet();
    this.setupDropzone();
    this.setupTrimCanvasInteractions();
    this.setupPwa();

    await Promise.all([
      this.checkProxyStatus(),
      this.refreshVaultSummary(false)
    ]);

    this.renderSongs();
    await this.handleDeepLinkParams();

    setInterval(() => this.checkProxyStatus(), 15000);
  }

  /**
   * Smart Clipboard Grab: Reads system clipboard, extracts all Suno URLs / short links / UUIDs, and resolves them
   */
  async pasteAndResolveClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      this.showToast('Clipboard read requires user paste (press Ctrl+V into the URL box).', 'amber');
      document.getElementById('songUrlInput')?.focus();
      return;
    }

    try {
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        this.showToast('Your clipboard is empty. Copy a Suno song link first!', 'amber');
        return;
      }

      const uuids = SunoAPI.extractUuids(clipText);
      const inputArea = document.getElementById('songUrlInput');

      if (uuids.length === 0) {
        if (inputArea) {
          inputArea.value = clipText;
          inputArea.focus();
        }
        this.showToast('Pasted clipboard text, but no Suno song UUID was detected.', 'amber');
        return;
      }

      if (inputArea) inputArea.value = clipText;
      await this.handleSongInput();
    } catch (err) {
      this.showToast('Allow clipboard permission or press Ctrl+V inside the URL box.', 'amber');
      document.getElementById('songUrlInput')?.focus();
    }
  }

  /**
   * Exports current Studio Deck metadata as a portable JSON session file
   */
  exportDeckJson() {
    const songs = StorageManager.loadSongs();
    if (songs.length === 0) {
      this.showToast('Your Studio Deck is empty. Add songs before exporting a session.', 'amber');
      return;
    }
    const jsonStr = StorageManager.exportPlaylist();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `Suno_Studio_Session_${stamp}.json`;
    this.triggerDownload(blob, filename);
    this.showToast(`Exported Studio Session (${songs.length} tracks): "${filename}"`, 'emerald');
  }

  /**
   * Imports a saved Studio Deck JSON session file
   */
  async handleImportDeckJson(event) {
    const file = event.target && event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const jsonText = await file.text();
      const added = StorageManager.importPlaylist(jsonText);
      this.renderSongs();
      this.showToast(`Imported ${added} new track(s) into your Studio Deck!`, 'emerald');
    } catch (err) {
      this.showToast(`Invalid Studio Session JSON: ${err.message}`, 'rose');
    } finally {
      event.target.value = '';
    }
  }

  setupPwa() {
    if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration skipped:', err);
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const btn = document.getElementById('btnInstallPwa');
      if (btn) btn.style.display = 'inline-flex';
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const btn = document.getElementById('btnInstallPwa');
      if (btn) btn.style.display = 'none';
      this.showToast('Installed Suno Studio App!', 'emerald');
    });
  }

  async installPwa() {
    if (!this.deferredInstallPrompt) return;
    this.deferredInstallPrompt.prompt();
    await this.deferredInstallPrompt.userChoice;
    this.deferredInstallPrompt = null;
    const btn = document.getElementById('btnInstallPwa');
    if (btn) btn.style.display = 'none';
  }

  async handleDeepLinkParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const songParam = params.get('song');
      const openAction = params.get('open');
      if (!songParam) return;

      const uuids = SunoAPI.extractUuids(songParam);
      if (uuids.length === 0) return;

      const uuid = uuids[0];
      let bridgePayload = null;
      if (window.location.hash && window.location.hash.includes('bridge=')) {
        try {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const b64 = hashParams.get('bridge');
          if (b64) {
            bridgePayload = JSON.parse(decodeURIComponent(escape(atob(b64))));
          }
        } catch (err) {}
      }

      const existing = StorageManager.loadSongs().find((s) => s.uuid === uuid);
      const meta = existing ? { ...existing } : await SunoAPI.fetchMetadata(uuid);
      meta.playerMode = 'custom';
      meta.hasStem = true;
      meta.album = meta.album || 'NTK Hub';
      if (bridgePayload) {
        if (bridgePayload.title && !bridgePayload.title.startsWith('Suno_Song_')) {
          meta.title = bridgePayload.title;
        }
        if (bridgePayload.prompt && bridgePayload.prompt.trim()) {
          meta.prompt = bridgePayload.prompt.trim();
        }
        if (bridgePayload.rights && bridgePayload.rights.key && bridgePayload.rights.iv && bridgePayload.rights.glt) {
          meta.rights = bridgePayload.rights;
        }
      }
      StorageManager.upsertSong(meta);
      this.renderSongs();

      // Clean query & hash params without reload
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      if (openAction === 'stems') {
        this.openStemsStudio(uuid);
      } else if (openAction === 'trim') {
        this.openTrimFxStudio(uuid);
      } else if (openAction === 'video') {
        this.openVideoStudio(uuid);
      }
    } catch (e) {}
  }

  setupBookmarklet() {
    const magicBtn = document.getElementById('sunoMagicBookmarklet');
    if (magicBtn) {
      magicBtn.href = BookmarkletEngine.getBookmarkletUrl();
    }
  }

  stopAllModalAudio() {
    this.stemMixer.stop();
    this.stopFxPreview();
    if (this.videoStudio) {
      this.videoStudio.stop();
      const prevBtn = document.getElementById('btnVideoLivePreview');
      if (prevBtn) prevBtn.textContent = '▶ Live Preview with Audio';
    }
  }

  setupUIBindings() {
    const addBtn = document.getElementById('btnAddSong');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.handleSongInput());
    }

    const inputArea = document.getElementById('songUrlInput');
    if (inputArea) {
      inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSongInput();
        }
      });
    }

    const clearInputBtn = document.getElementById('btnClearInput');
    if (clearInputBtn) {
      clearInputBtn.addEventListener('click', () => {
        if (inputArea) {
          inputArea.value = '';
          inputArea.focus();
        }
      });
    }

    const clearAllBtn = document.getElementById('btnClearAll');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        if (confirm('Clear all songs from your deck and remove cached audio from Offline Vault?')) {
          this.player.pause();
          this.stopAllModalAudio();
          StorageManager.clearAll();
          await VaultDB.clearAudioVault(false);
          await this.refreshVaultSummary(false);
          this.renderSongs();
          this.showToast('Cleared song deck and audio cache.', 'amber');
        }
      });
    }

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) {
          modal.classList.remove('open');
          this.stopAllModalAudio();
        }
      });
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('open');
          this.stopAllModalAudio();
        }
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
        this.stopAllModalAudio();
      }
    });
  }

  setupDropzone() {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        for (const file of files) {
          if (/\.(m4a|mp3|wav|flac|ogg|aac)$/i.test(file.name) || file.type.startsWith('audio/')) {
            await this.importAudioFile(file);
          }
        }
      }
    });
  }

  async handleLocalFileSelect(event) {
    const files = event.target && event.target.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      await this.importAudioFile(file);
    }
    event.target.value = '';
  }

  async importAudioFile(file) {
    try {
      this.showToast(`Importing "${file.name}" into Studio...`, 'emerald');
      const arrayBuf = await file.arrayBuffer();
      const audioBuffer = await AudioConverter.decodeAudioData(arrayBuf);
      const title = file.name.replace(/\.[^/.]+$/, '');
      const pseudoUuid = 'local-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 6);

      const songObj = {
        uuid: pseudoUuid,
        title,
        prompt: '',
        tags: 'Local Master Audio',
        duration: audioBuffer.duration,
        model: `${Math.round(audioBuffer.sampleRate / 100) / 10}kHz Stereo`,
        streamUrl: '',
        imageLarge: '',
        videoUrl: '',
        hasStem: true,
        showDetails: false,
        playerMode: 'custom'
      };

      StorageManager.upsertSong(songObj);
      StorageManager.setCachedBuffer(pseudoUuid, {
        decryptedBuffer: arrayBuf,
        audioBuffer
      });
      await VaultDB.saveMaster(pseudoUuid, arrayBuf);
      await this.refreshVaultSummary(false);
      this.renderSongs();
      this.showToast(`Ready! "${title}" (${this.formatDuration(audioBuffer.duration)}) cached in Studio Vault.`, 'emerald');
    } catch (err) {
      this.showToast(`Could not decode audio file: ${err.message}`, 'rose');
    }
  }

  async refreshVaultSummary(reRender = true) {
    this.vaultSummary = await VaultDB.getVaultSummary();
    const badge = document.getElementById('vaultBadgeText');
    if (badge) {
      const count = new Set([...this.vaultSummary.masterIds, ...this.vaultSummary.stemIds]).size;
      const aiTag = this.vaultSummary.hasOnnxModel ? ' + AI' : '';
      badge.textContent = `Vault: ${count}${aiTag}`;
    }
    if (reRender) {
      this.renderSongs();
    }
  }

  async handleVaultClick() {
    await this.refreshVaultSummary(false);
    const mastersCount = this.vaultSummary.masterIds.size;
    const stemsCount = this.vaultSummary.stemIds.size;
    const modelStatus = this.vaultSummary.hasOnnxModel ? 'Cached Offline (172 MB HTDemucs ONNX)' : 'On-Demand';

    if (mastersCount === 0 && stemsCount === 0) {
      this.showToast(`Offline Vault: 0 cached songs • Browser AI Weights: ${modelStatus}`, 'emerald');
      return;
    }

    const msg =
      `IndexedDB Offline Vault Status:\n` +
      `• Cached Master Tracks: ${mastersCount}\n` +
      `• Cached 4-Stem Neural Bundles: ${stemsCount}\n` +
      `• In-Browser HTDemucs ONNX Model: ${modelStatus}\n\n` +
      `Click OK to clear cached audio & stems (keeps AI weights), or Cancel to keep everything offline.`;

    if (confirm(msg)) {
      this.stopAllModalAudio();
      StorageManager._bufferCache.clear();
      await VaultDB.clearAudioVault(false);
      await this.refreshVaultSummary(true);
      this.showToast('Cleared cached audio & stems from Offline Vault.', 'amber');
    }
  }

  async checkProxyStatus() {
    const [proxyOk, demucsCaps] = await Promise.all([
      SunoAPI.checkLocalProxy(),
      StemEngine.checkLocalDemucs()
    ]);

    this.isLocalProxyActive = proxyOk;
    this.localDemucsCaps = demucsCaps;

    const statusPill = document.getElementById('proxyStatusPill');
    if (!statusPill) return;

    if (this.isLocalProxyActive && demucsCaps.available) {
      statusPill.innerHTML = `
        <span class="status-dot active"></span>
        <span style="color:#6ee7b7;font-weight:700">Local Proxy + PyTorch HTDemucs v4 (${String(demucsCaps.device).toUpperCase()})</span>
      `;
    } else if (this.isLocalProxyActive) {
      statusPill.innerHTML = `
        <span class="status-dot active"></span>
        <span style="color:#6ee7b7;font-weight:700">Local Proxy Active • Browser WebGPU AI Ready</span>
      `;
    } else {
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      statusPill.innerHTML = `
        <span class="status-dot" style="background:#38bdf8;box-shadow:0 0 8px #38bdf8"></span>
        <span style="color:#bae6fd">Static Cloud Mode • ${hasGpu ? 'WebGPU' : 'WASM'} HTDemucs Ready</span>
      `;
    }
  }

  async handleSongInput() {
    const inputArea = document.getElementById('songUrlInput');
    if (!inputArea) return;
    const text = inputArea.value.trim();

    if (!text) {
      this.showToast('Paste one or more Suno song links or playlist URLs first.', 'amber');
      inputArea.focus();
      return;
    }

    const { playlistUuids, songUuids } = SunoAPI.parseBatchInput(text);
    if (playlistUuids.length === 0 && songUuids.length === 0) {
      this.showToast('No valid Suno song or playlist link found (e.g. suno.com/song/... or suno.com/playlist/...).', 'rose');
      return;
    }

    inputArea.value = '';
    let totalAdded = 0;

    // Handle Playlists
    for (const plId of playlistUuids) {
      this.showToast(`Fetching Suno playlist ${plId.slice(0, 8)}...`, 'cyan');
      try {
        const plData = await SunoAPI.fetchPlaylist(plId);
        const plName = plData.name || `Suno Playlist`;
        const clips = plData.clips || [];
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          clip.album = plName;
          clip.trackNumber = `${String(i + 1).padStart(2, '0')}/${String(clips.length).padStart(2, '0')}`;
          clip.year = clip.year || String(new Date().getFullYear());
          clip.artist = clip.artist || 'Suno AI Studio';
          StorageManager.upsertSong(clip);
          totalAdded++;
        }
        this.showToast(`Loaded playlist "${plName}" (${clips.length} tracks)!`, 'emerald');
      } catch (err) {
        this.showToast(`Playlist error: ${err.message}`, 'rose');
      }
    }

    // Handle Individual Songs
    if (songUuids.length > 0) {
      this.showToast(`Resolving ${songUuids.length} individual song(s)...`, 'emerald');
      for (const uuid of songUuids) {
        try {
          const meta = await SunoAPI.fetchMetadata(uuid);
          meta.playerMode = 'custom';
          meta.hasStem = true;
          meta.artist = meta.artist || 'Suno AI Studio';
          meta.album = meta.album || 'NTK Hub';
          meta.year = meta.year || String(new Date().getFullYear());
          StorageManager.upsertSong(meta);
          totalAdded++;
        } catch (e) {
          console.warn(`Failed to resolve ${uuid}:`, e);
        }
      }
    }

    this.renderSongs();
    if (totalAdded > 0) {
      this.showToast(`Added ${totalAdded} track(s) to your Studio Deck!`, 'emerald');
    }
  }

  /**
   * Core Decryptor & Vault Pipeline:
   * 1. In-memory buffer cache
   * 2. IndexedDB Offline Vault (instant offline restore across page reloads)
   * 3. Live Mango DRM decryption -> caches permanently to IndexedDB Vault
   */
  async getDecryptedAudio(uuid, onProgress = () => {}) {
    const cached = StorageManager.getCachedBuffer(uuid);
    if (cached && cached.decryptedBuffer && cached.audioBuffer) {
      return cached;
    }

    // Check IndexedDB Offline Vault
    const vaultMaster = await VaultDB.getMaster(uuid);
    if (vaultMaster && vaultMaster.byteLength > 0) {
      onProgress('Restoring master audio from Offline Vault...');
      const audioBuffer = await AudioConverter.decodeAudioData(vaultMaster);
      const payload = {
        decryptedBuffer: vaultMaster,
        audioBuffer,
        stems: cached ? cached.stems : null
      };
      StorageManager.setCachedBuffer(uuid, payload);
      return payload;
    }

    if (String(uuid).startsWith('local-')) {
      throw new Error('Local file buffer was cleared. Please re-import the audio file.');
    }

    onProgress('Requesting Mango DRM rights...');
    const storedSong = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    let rights = (storedSong && storedSong.rights && storedSong.rights.key && storedSong.rights.iv && storedSong.rights.glt)
      ? storedSong.rights
      : null;
    if (!rights) {
      try {
        rights = await SunoAPI.fetchRights(uuid);
      } catch (err) {
        this.openHelperModal(uuid);
        throw err;
      }
    }

    onProgress('Downloading CloudFront encrypted audio...');
    const encBuffer = await SunoAPI.downloadEncryptedStream(uuid, (pct) => {
      onProgress(`Downloading audio stream (${pct}%)...`);
    });

    onProgress('Decrypting audio stream via AES-CTR...');
    const decryptedBuffer = await CryptoEngine.decryptStream(encBuffer, rights, uuid, onProgress);

    onProgress('Decoding audio data & saving to Offline Vault...');
    const audioBuffer = await AudioConverter.decodeAudioData(decryptedBuffer);

    await VaultDB.saveMaster(uuid, decryptedBuffer);
    await this.refreshVaultSummary(true);

    // Update accurate duration in song metadata if needed
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (song && (!song.duration || Math.abs(song.duration - audioBuffer.duration) > 1)) {
      song.duration = audioBuffer.duration;
      StorageManager.upsertSong(song);
    }

    const cachePayload = {
      decryptedBuffer,
      audioBuffer
    };
    StorageManager.setCachedBuffer(uuid, cachePayload);
    return cachePayload;
  }

  /**
   * Action: Download Original Untouched M4A
   */
  async downloadM4a(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.setBtnLoading(`btn-m4a-${uuid}`, true, 'Decrypting...');
    try {
      const { decryptedBuffer } = await this.getDecryptedAudio(uuid, (status) => {
        this.setBtnLoading(`btn-m4a-${uuid}`, true, status);
      });

      const blob = new Blob([decryptedBuffer], { type: 'audio/mp4' });
      const filename = this.makeSafeFilename(song.title, 'm4a');
      this.triggerDownload(blob, filename);
      this.showToast(`Downloaded Master M4A: "${filename}"`, 'emerald');
    } catch (e) {
      this.showToast(`Download error: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(`btn-m4a-${uuid}`, false);
    }
  }

  /**
   * Action: Download Lossless 16-bit Studio WAV
   */
  async downloadWav(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.setBtnLoading(`btn-wav-${uuid}`, true, 'Processing...');
    try {
      const { audioBuffer } = await this.getDecryptedAudio(uuid, (status) => {
        this.setBtnLoading(`btn-wav-${uuid}`, true, status);
      });

      this.setBtnLoading(`btn-wav-${uuid}`, true, 'Encoding WAV...');
      const wavBlob = AudioConverter.encodeWav(audioBuffer);
      const filename = this.makeSafeFilename(song.title, 'wav');
      this.triggerDownload(wavBlob, filename);
      this.showToast(`Downloaded Studio WAV: "${filename}"`, 'emerald');
    } catch (e) {
      this.showToast(`WAV conversion failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(`btn-wav-${uuid}`, false);
    }
  }

  /**
   * Action: Download 320kbps MP3 with Embedded ID3v2.3 Metadata, Lyrics & Cover Art
   */
  async downloadMp3(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.setBtnLoading(`btn-mp3-${uuid}`, true, 'Decoding...');
    try {
      const { audioBuffer } = await this.getDecryptedAudio(uuid, (status) => {
        this.setBtnLoading(`btn-mp3-${uuid}`, true, status);
      });

      this.setBtnLoading(`btn-mp3-${uuid}`, true, 'MP3 0%...');
      const rawMp3 = await Mp3Encoder.encode(audioBuffer, 320, (pct) => {
        this.setBtnLoading(`btn-mp3-${uuid}`, true, `MP3 ${pct}%`);
      });

      this.setBtnLoading(`btn-mp3-${uuid}`, true, 'Tagging ID3...');
      const taggedMp3 = await ID3Writer.embedTags(rawMp3, {
        title: song.title,
        artist: song.artist || 'Suno AI Studio',
        album: song.album || 'NTK Hub',
        trackNumber: song.trackNumber || '01/01',
        year: song.year || String(new Date().getFullYear()),
        genre: song.tags,
        lyrics: song.prompt,
        coverUrl: song.imageLarge,
        coverBytes: song.customCoverBytes || null
      });

      const filename = this.makeSafeFilename(song.title, 'mp3');
      this.triggerDownload(taggedMp3, filename);
      this.showToast(`Downloaded Tagged 320k MP3 (with Cover Art & Lyrics): "${filename}"`, 'emerald');
    } catch (e) {
      this.showToast(`MP3 encoding failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(`btn-mp3-${uuid}`, false);
    }
  }

  /**
   * Action: Download Complete Song Studio Pack (.ZIP)
   */
  async downloadSongPackZip(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.setBtnLoading(`btn-pack-${uuid}`, true, 'Preparing ZIP...');
    try {
      const payload = await this.getDecryptedAudio(uuid, (st) => {
        this.setBtnLoading(`btn-pack-${uuid}`, true, st);
      });
      const cachedStemsWavs = await VaultDB.getStems(uuid);

      const zipBlob = await ZipPackager.buildSongPackZip(song, payload, cachedStemsWavs, (pct, msg) => {
        this.setBtnLoading(`btn-pack-${uuid}`, true, `${pct}% ${msg.slice(0, 18)}...`);
      });

      const filename = this.makeSafeFilename(`${song.title} - Studio Pack`, 'zip');
      this.triggerDownload(zipBlob, filename);
      this.showToast(`Downloaded Complete Studio Pack: "${filename}"`, 'emerald');
    } catch (e) {
      this.showToast(`Studio Pack ZIP failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(`btn-pack-${uuid}`, false);
    }
  }

  /**
   * Action: Batch Download Entire Deck as a Single .ZIP
   */
  async downloadBatchDeckZip(format = 'mp3') {
    const songs = StorageManager.loadSongs();
    if (songs.length === 0) {
      this.showToast('Your song deck is empty. Add songs first!', 'amber');
      return;
    }

    const btnId = format === 'mp3' ? 'btnBatchZipMp3' : 'btnBatchZipM4a';
    this.setBtnLoading(btnId, true, 'Batch 0%...');

    try {
      const zipBlob = await ZipPackager.buildBatchDeckZip(
        songs,
        (uuid, stCb) => this.getDecryptedAudio(uuid, stCb),
        format,
        (pct, text) => {
          this.setBtnLoading(btnId, true, `${pct}%`);
          console.info(`[Batch ZIP] ${pct}% - ${text}`);
        }
      );

      const filename = this.makeSafeFilename(`Suno_Studio_Batch_${songs.length}_Songs_${format.toUpperCase()}`, 'zip');
      this.triggerDownload(zipBlob, filename);
      this.showToast(`Exported Batch ZIP (${songs.length} songs): "${filename}"!`, 'emerald');
    } catch (e) {
      this.showToast(`Batch ZIP failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(btnId, false);
    }
  }

  /* =========================================================================
     4-STEM NEURAL AI CONSOLE (META HTDEMUCS v4)
     ========================================================================= */

  async openStemsStudio(uuid, forceRecompute = false) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.player.pause();
    this.stopAllModalAudio();
    this.activeStemsSong = song;

    const modal = document.getElementById('stemsModal');
    if (!modal) return;
    modal.classList.add('open');

    const titleEl = document.getElementById('stemsModalTitle');
    const progressCard = document.getElementById('stemsProgressCard');
    const progressBar = document.getElementById('stemsProgressBar');
    const progressPct = document.getElementById('stemsProgressPct');
    const statusEl = document.getElementById('stemsStatusText');
    const consoleWrap = document.getElementById('stemsConsoleWrap');
    const engineSelect = document.getElementById('stemEngineMode');
    const engineBadge = document.getElementById('stemActiveEngineBadge');
    const rerunBtn = document.getElementById('btnReseparateStems');

    if (titleEl) titleEl.textContent = `4-Stem Neural Console: ${song.title}`;
    if (progressCard) progressCard.style.display = 'flex';
    if (consoleWrap) consoleWrap.style.display = 'none';
    if (progressBar) progressBar.style.width = '2%';
    if (progressPct) progressPct.textContent = '2%';
    if (statusEl) statusEl.textContent = 'Preparing lossless master audio...';
    if (rerunBtn) rerunBtn.disabled = true;

    const mode = engineSelect ? engineSelect.value : 'auto';

    try {
      const { audioBuffer } = await this.getDecryptedAudio(uuid, (status) => {
        if (statusEl) statusEl.textContent = status;
      });

      const stemBundle = await StemEngine.separate(uuid, audioBuffer, {
        mode,
        forceRecompute,
        onProgress: ({ percent, stage, engine }) => {
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressPct) progressPct.textContent = `${percent}%`;
          if (statusEl) statusEl.textContent = stage;
          if (engine && engineBadge) engineBadge.textContent = engine;
        }
      });

      const cached = StorageManager.getCachedBuffer(uuid) || {};
      cached.stems = stemBundle;
      StorageManager.setCachedBuffer(uuid, cached);

      await this.refreshVaultSummary(true);

      this.stemMixer.loadStems(stemBundle);

      const targetModeSelect = document.getElementById('stemTargetMode');
      const targetMode = (targetModeSelect && targetModeSelect.value) || '2-stem';
      this.handleStemTargetModeChange(targetMode, false);

      if (engineBadge) engineBadge.textContent = `✓ ${stemBundle.engine || 'HTDemucs v4'}`;
      if (progressBar) progressBar.style.width = '100%';
      if (progressPct) progressPct.textContent = '100%';
      if (progressCard) progressCard.style.display = 'none';
      if (consoleWrap) consoleWrap.style.display = 'flex';
    } catch (e) {
      if (statusEl) {
        statusEl.innerHTML = `❌ <strong>Stem Separation Error:</strong> ${this.escapeHtml(e.message)}`;
      }
      this.showToast(`Stem separation error: ${e.message}`, 'rose');
    } finally {
      if (rerunBtn) rerunBtn.disabled = false;
    }
  }

  handleStemTargetModeChange(mode, showNotification = true) {
    if (!this.stemMixer) return;
    this.stemMixer.setTargetMode(mode);
    const select = document.getElementById('stemTargetMode');
    if (select && select.value !== mode) select.value = mode;

    const titleEl = document.getElementById('stemsModalTitle');
    const songTitle = this.activeStemsSong ? this.activeStemsSong.title : '';

    const stripVocals = document.getElementById('stem-strip-vocals');
    const stripLead = document.getElementById('stem-strip-lead_vocals');
    const stripBacking = document.getElementById('stem-strip-backing_vocals');
    const stripInstrumental = document.getElementById('stem-strip-instrumental');
    const stripDrums = document.getElementById('stem-strip-drums');
    const stripBass = document.getElementById('stem-strip-bass');
    const stripOther = document.getElementById('stem-strip-other');
    const splitBtn = document.getElementById('btnSplitVocals');

    const chipDrumless = document.getElementById('chip-preset-drumless');
    const chipRhythm = document.getElementById('chip-preset-rhythm');
    const chipBoost = document.getElementById('chip-preset-boost');

    const cached = this.activeStemsSong ? StorageManager.getCachedBuffer(this.activeStemsSong.uuid) : null;
    const stems = cached && cached.stems ? cached.stems : (this.stemMixer.stems || {});
    const hasSplit = Boolean(stems.lead_vocals && stems.backing_vocals);

    if (mode === '2-stem') {
      if (titleEl) titleEl.textContent = `2-Stem Studio (Vocals + Instrumental): ${songTitle}`;
      if (stripVocals) stripVocals.style.display = 'flex';
      if (stripInstrumental) stripInstrumental.style.display = 'flex';
      if (stripLead) stripLead.style.display = 'none';
      if (stripBacking) stripBacking.style.display = 'none';
      if (stripDrums) stripDrums.style.display = 'none';
      if (stripBass) stripBass.style.display = 'none';
      if (stripOther) stripOther.style.display = 'none';
      if (splitBtn) splitBtn.style.display = 'none';
      if (chipDrumless) chipDrumless.style.display = 'none';
      if (chipRhythm) chipRhythm.style.display = 'none';
      if (chipBoost) chipBoost.style.display = 'inline-block';
      this.stemMixer.applyPreset('full');
      this.syncStemConsoleControls('full');
      if (showNotification) this.showToast('2-Stem Mode Active (Vocals + Clean Instrumental)!', 'emerald');
    } else if (mode === 'vocal-split') {
      if (titleEl) titleEl.textContent = `Vocal Demix Console (Lead + Backing): ${songTitle}`;
      if (chipDrumless) chipDrumless.style.display = 'none';
      if (chipRhythm) chipRhythm.style.display = 'none';
      if (chipBoost) chipBoost.style.display = 'none';
      if (splitBtn) splitBtn.style.display = 'inline-flex';
      if (!hasSplit) {
        this.splitCurrentVocals();
      } else {
        if (stripVocals) stripVocals.style.display = 'none';
        if (stripLead) stripLead.style.display = 'flex';
        if (stripBacking) stripBacking.style.display = 'flex';
        if (stripInstrumental) stripInstrumental.style.display = 'flex';
        if (stripDrums) stripDrums.style.display = 'none';
        if (stripBass) stripBass.style.display = 'none';
        if (stripOther) stripOther.style.display = 'none';
        this.stemMixer.applyPreset('full');
        this.syncStemConsoleControls('full');
        if (showNotification) this.showToast('Vocal Demix Mode Active (Lead + Backing Harmonies)!', 'emerald');
      }
    } else if (mode === '5-stem') {
      if (titleEl) titleEl.textContent = `5-Stem Studio Kit (All Tracks): ${songTitle}`;
      if (chipDrumless) chipDrumless.style.display = 'inline-block';
      if (chipRhythm) chipRhythm.style.display = 'inline-block';
      if (chipBoost) chipBoost.style.display = 'none';
      if (splitBtn) splitBtn.style.display = 'inline-flex';
      if (!hasSplit) {
        this.splitCurrentVocals();
      } else {
        if (stripVocals) stripVocals.style.display = 'none';
        if (stripLead) stripLead.style.display = 'flex';
        if (stripBacking) stripBacking.style.display = 'flex';
        if (stripInstrumental) stripInstrumental.style.display = 'none';
        if (stripDrums) stripDrums.style.display = 'flex';
        if (stripBass) stripBass.style.display = 'flex';
        if (stripOther) stripOther.style.display = 'flex';
        this.stemMixer.applyPreset('full');
        this.syncStemConsoleControls('full');
        if (showNotification) this.showToast('5-Stem Studio Kit Mode Active (All Tracks)!', 'emerald');
      }
    } else {
      // 4-stem mode
      if (titleEl) titleEl.textContent = `4-Stem Neural Console: ${songTitle}`;
      if (stripVocals) stripVocals.style.display = 'flex';
      if (stripLead) stripLead.style.display = 'none';
      if (stripBacking) stripBacking.style.display = 'none';
      if (stripInstrumental) stripInstrumental.style.display = 'none';
      if (stripDrums) stripDrums.style.display = 'flex';
      if (stripBass) stripBass.style.display = 'flex';
      if (stripOther) stripOther.style.display = 'flex';
      if (splitBtn) splitBtn.style.display = 'inline-flex';
      if (chipDrumless) chipDrumless.style.display = 'inline-block';
      if (chipRhythm) chipRhythm.style.display = 'inline-block';
      if (chipBoost) chipBoost.style.display = 'none';
      this.stemMixer.applyPreset('full');
      this.syncStemConsoleControls('full');
      if (showNotification) this.showToast('4-Stem Mode Active (Vocals, Drums, Bass, Melodies)!', 'emerald');
    }
  }

  reseparateActiveStems() {
    if (!this.activeStemsSong) return;
    this.openStemsStudio(this.activeStemsSong.uuid, true);
  }

  toggleStemMixerPlay() {
    if (!this.stemMixer.stems) return;
    if (this.stemMixer.isPlaying) {
      this.stemMixer.pause();
    } else {
      this.stemMixer.play();
    }
    this.updateStemPlayBtn();
  }

  stopStemMixer() {
    this.stemMixer.stop();
    this.updateStemPlayBtn();
  }

  updateStemPlayBtn() {
    const btn = document.getElementById('stemMixPlayBtn');
    if (btn) {
      btn.textContent = this.stemMixer.isPlaying ? '❚❚ Pause' : '▶ Play Mix';
    }
  }

  seekStemMixer(sliderVal) {
    if (!this.stemMixer.duration) return;
    const ratio = Math.max(0, Math.min(1, Number(sliderVal) / 1000));
    this.stemMixer.seek(ratio * this.stemMixer.duration);
  }

  applyStemPreset(preset) {
    this.stemMixer.applyPreset(preset);
    this.syncStemConsoleControls(preset);
  }

  toggleStemMute(track) {
    this.stemMixer.toggleMute(track);
    this.syncStemConsoleControls('');
  }

  toggleStemSolo(track) {
    this.stemMixer.toggleSolo(track);
    this.syncStemConsoleControls('');
  }

  setStemVolume(track, pctVal) {
    const pct = Math.max(0, Math.min(150, Number(pctVal)));
    this.stemMixer.setVolume(track, pct / 100);
    const label = document.getElementById(`stem-gain-${track}`);
    if (label) label.textContent = `${Math.round(pct)}%`;
  }

  syncStemConsoleControls(activePreset = '') {
    const effGains = this.stemMixer.getEffectiveGains();
    const activeKeys = this.stemMixer.getActiveTrackKeys();

    for (const k of activeKeys) {
      const st = this.stemMixer.state[k];
      const muteBtn = document.getElementById(`stem-mute-${k}`);
      const soloBtn = document.getElementById(`stem-solo-${k}`);
      const fader = document.getElementById(`stem-fader-${k}`);
      const gainLbl = document.getElementById(`stem-gain-${k}`);
      const strip = document.getElementById(`stem-strip-${k}`);

      if (muteBtn && st) muteBtn.classList.toggle('active', st.muted);
      if (soloBtn && st) soloBtn.classList.toggle('active', st.solo);
      if (fader && st) fader.value = String(Math.round(st.volume * 100));
      if (gainLbl && st) gainLbl.textContent = `${Math.round(st.volume * 100)}%`;
      if (strip) strip.classList.toggle('is-muted', (effGains[k] || 0) === 0);
    }

    document.querySelectorAll('[data-stem-preset]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.stemPreset === activePreset);
    });

    const timeEl = document.getElementById('stemMixTimeText');
    if (timeEl) {
      timeEl.textContent = `${this.formatDuration(this.stemMixer.getCurrentTime())} / ${this.formatDuration(this.stemMixer.duration)}`;
    }
  }

  onStemMixerTick({ currentTime, duration, isPlaying, levels }) {
    const scrubber = document.getElementById('stemMixScrubber');
    const timeEl = document.getElementById('stemMixTimeText');

    if (scrubber && duration > 0) {
      scrubber.value = String(Math.round((currentTime / duration) * 1000));
    }
    if (timeEl) {
      timeEl.textContent = `${this.formatDuration(currentTime)} / ${this.formatDuration(duration)}`;
    }

    const activeKeys = this.stemMixer.getActiveTrackKeys();
    for (const k of activeKeys) {
      const meter = document.getElementById(`stem-meter-${k}`);
      if (meter) {
        const pct = Math.min(100, Math.round((levels[k] || 0) * 100));
        meter.style.width = `${pct}%`;
      }
    }

    const btn = document.getElementById('stemMixPlayBtn');
    if (btn) {
      btn.textContent = isPlaying ? '❚❚ Pause' : '▶ Play Mix';
    }
  }

  async downloadStemTrack(type, format = 'wav') {
    if (!this.activeStemsSong) return;
    const song = this.activeStemsSong;
    const cached = StorageManager.getCachedBuffer(song.uuid);
    if (!cached || !cached.stems || !cached.stems[type]) {
      this.showToast('Wait for neural stem separation to finish first.', 'amber');
      return;
    }

    const labelMap = {
      vocals: 'Vocals',
      lead_vocals: 'Lead Vocals',
      backing_vocals: 'Backing Harmonies',
      drums: 'Drums',
      bass: 'Bass',
      other: 'Melodies',
      instrumental: 'Instrumental'
    };
    const suffix = labelMap[type] || type;
    const stemBuffer = cached.stems[type];

    try {
      if (format === 'wav') {
        const wavBlob = AudioConverter.encodeWav(stemBuffer);
        const filename = this.makeSafeFilename(`${song.title} (${suffix})`, 'wav');
        this.triggerDownload(wavBlob, filename);
        this.showToast(`Downloaded ${suffix} Lossless WAV!`, 'emerald');
      } else {
        this.showToast(`Encoding ${suffix} 320k MP3 + ID3...`, 'emerald');
        const rawMp3 = await Mp3Encoder.encode(stemBuffer, 320);
        const taggedMp3 = await ID3Writer.embedTags(rawMp3, {
          title: `${song.title} (${suffix})`,
          artist: song.artist || 'Suno AI Studio',
          album: `${song.title} (Stems)`,
          genre: song.tags,
          lyrics: (type === 'vocals' || type === 'lead_vocals') ? song.prompt : '',
          coverUrl: song.imageLarge,
          coverBytes: song.customCoverBytes || null
        });
        const filename = this.makeSafeFilename(`${song.title} (${suffix})`, 'mp3');
        this.triggerDownload(taggedMp3, filename);
        this.showToast(`Downloaded Tagged ${suffix} MP3!`, 'emerald');
      }
    } catch (e) {
      this.showToast(`Stem export failed: ${e.message}`, 'rose');
    }
  }

  async exportCustomStemMix(format = 'wav') {
    if (!this.activeStemsSong || !this.stemMixer.stems) return;
    const song = this.activeStemsSong;

    try {
      const mixedBuffer = this.stemMixer.renderCustomMixBuffer();
      if (format === 'wav') {
        const wavBlob = AudioConverter.encodeWav(mixedBuffer);
        const filename = this.makeSafeFilename(`${song.title} (Custom Stem Mix)`, 'wav');
        this.triggerDownload(wavBlob, filename);
        this.showToast(`Exported Custom Stem Mix WAV!`, 'emerald');
      } else {
        this.showToast('Encoding Custom Stem Mix (320k MP3 + ID3)...', 'emerald');
        const rawMp3 = await Mp3Encoder.encode(mixedBuffer, 320);
        const taggedMp3 = await ID3Writer.embedTags(rawMp3, {
          title: `${song.title} (Custom Stem Mix)`,
          genre: song.tags,
          lyrics: song.prompt,
          coverUrl: song.imageLarge
        });
        const filename = this.makeSafeFilename(`${song.title} (Custom Stem Mix)`, 'mp3');
        this.triggerDownload(taggedMp3, filename);
        this.showToast(`Exported Custom Stem Mix MP3!`, 'emerald');
      }
    } catch (e) {
      this.showToast(`Custom mix export failed: ${e.message}`, 'rose');
    }
  }

  async downloadStemsZip(format = 'wav', mode = '2-stem') {
    if (!this.activeStemsSong) return;
    const song = this.activeStemsSong;
    const cached = StorageManager.getCachedBuffer(song.uuid);
    if (!cached || !cached.stems) return;

    const btnId = mode === '2-stem'
      ? (format === 'wav' ? 'btnZip2StemWav' : 'btnZip2StemMp3')
      : (format === 'wav' ? 'btnStemsZipWav' : 'btnStemsZipMp3');
    this.setBtnLoading(btnId, true, 'Packaging 0%...');

    try {
      const zipBlob = await ZipPackager.buildStemsZip(song, cached.stems, format, (pct, msg) => {
        this.setBtnLoading(btnId, true, `${pct}% ${msg.slice(0, 18)}...`);
      }, mode);

      const label = mode === '2-stem' ? '2-Stem Kit' : 'Neural Stems Kit';
      const filename = this.makeSafeFilename(`${song.title} - ${label} (${format.toUpperCase()})`, 'zip');
      this.triggerDownload(zipBlob, filename);
      this.showToast(`Downloaded ${label} ZIP: "${filename}"`, 'emerald');
    } catch (e) {
      this.showToast(`Stems ZIP failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(btnId, false);
    }
  }

  async downloadAllStemsZip(format = 'wav') {
    const mode = (this.stemMixer && this.stemMixer.targetMode === '2-stem') ? '2-stem' : 'auto';
    return this.downloadStemsZip(format, mode);
  }

  /* =========================================================================
     STAGE 2 VOCAL DEMIXING (LEAD VS BACKING HARMONIES)
     ========================================================================= */

  async splitCurrentVocals() {
    if (!this.activeStemsSong) return;
    const currentBundle = this.stemMixer.stems;
    if (!currentBundle || !currentBundle.vocals) {
      this.showToast('Run HTDemucs stem separation first before splitting vocals.', 'amber');
      return;
    }

    const btn = document.getElementById('btnSplitVocals');
    const progCard = document.getElementById('stemsProgressCard');
    const progBar = document.getElementById('stemsProgressBar');
    const progText = document.getElementById('stemsStatusText');
    const progPct = document.getElementById('stemsProgressPct');

    if (btn) btn.disabled = true;
    if (progCard) progCard.style.display = 'flex';

    try {
      const { leadVocals, backingVocals, engine } = await StemEngine.splitLeadAndBackingVocals(
        currentBundle.vocals,
        (pct, stage) => {
          if (progBar) progBar.style.width = `${pct}%`;
          if (progPct) progPct.textContent = `${pct}%`;
          if (progText) progText.textContent = stage;
        }
      );

      currentBundle.lead_vocals = leadVocals;
      currentBundle.backing_vocals = backingVocals;

      // Update mixer & display strips
      this.stemMixer.loadStems(currentBundle, true);
      this.stemMixer.setVocalSplit(true);
      this.syncStemConsoleControls('full');

      const stripVocals = document.getElementById('stem-strip-vocals');
      const stripLead = document.getElementById('stem-strip-lead_vocals');
      const stripBacking = document.getElementById('stem-strip-backing_vocals');

      if (stripVocals) stripVocals.style.display = 'none';
      if (stripLead) stripLead.style.display = 'flex';
      if (stripBacking) stripBacking.style.display = 'flex';

      if (btn) {
        btn.textContent = '✓ Split (Lead & Backing)';
        btn.classList.remove('btn-cyan');
        btn.classList.add('btn-secondary');
      }

      const activeBadge = document.getElementById('stemActiveEngineBadge');
      if (activeBadge) {
        activeBadge.textContent = `6 Stems (${engine})`;
      }

      this.showToast('Separated Lead Vocals and Backing Harmonies!', 'emerald');
    } catch (err) {
      this.showToast(`Vocal split failed: ${err.message}`, 'rose');
    } finally {
      if (btn) btn.disabled = false;
      if (progCard) progCard.style.display = 'none';
    }
  }

  /* =========================================================================
     METADATA & ID3 TAG EDITOR (INDIVIDUAL & BATCH)
     ========================================================================= */

  openMetaModal(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.activeMetaSong = song;
    this.tempCoverDataUrl = song.customCoverDataUrl || null;

    document.getElementById('editMetaUuid').value = song.uuid;
    document.getElementById('editMetaTitle').value = song.title || '';
    document.getElementById('editMetaArtist').value = song.artist || 'Suno AI Studio';
    document.getElementById('editMetaAlbum').value = song.album || 'NTK Hub';
    document.getElementById('editMetaTrack').value = song.trackNumber || '';
    document.getElementById('editMetaYear').value = song.year || String(new Date().getFullYear());
    document.getElementById('editMetaGenre').value = song.tags || '';
    document.getElementById('editMetaLyrics').value = song.prompt || '';

    const preview = document.getElementById('editMetaCoverPreview');
    if (preview) {
      preview.src = song.customCoverDataUrl || song.imageLarge || 'assets/icon.svg';
    }

    const modal = document.getElementById('metaModal');
    if (modal) modal.classList.add('open');
  }

  async handleCustomCoverUpload(event) {
    const file = event.target && event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      const base64Url = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      this.tempCoverDataUrl = base64Url;
      const preview = document.getElementById('editMetaCoverPreview');
      if (preview) {
        preview.src = base64Url;
      }
      this.showToast('Loaded custom cover artwork image.', 'emerald');
    } catch (err) {
      this.showToast(`Error reading image: ${err.message}`, 'rose');
    } finally {
      event.target.value = '';
    }
  }

  saveMetaModal() {
    const uuid = document.getElementById('editMetaUuid').value;
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    song.title = document.getElementById('editMetaTitle').value.trim() || song.title;
    song.artist = document.getElementById('editMetaArtist').value.trim() || 'Suno AI Studio';
    song.album = document.getElementById('editMetaAlbum').value.trim() || 'NTK Hub';
    song.trackNumber = document.getElementById('editMetaTrack').value.trim();
    song.year = document.getElementById('editMetaYear').value.trim() || String(new Date().getFullYear());
    song.tags = document.getElementById('editMetaGenre').value.trim();
    song.prompt = document.getElementById('editMetaLyrics').value.trim();

    if (this.tempCoverDataUrl) {
      song.customCoverDataUrl = this.tempCoverDataUrl;
    }

    StorageManager.upsertSong(song);
    this.renderSongs();

    const modal = document.getElementById('metaModal');
    if (modal) modal.classList.remove('open');
    this.showToast(`Saved metadata tags for "${song.title}"!`, 'emerald');
  }

  openBatchMetaModal() {
    const songs = StorageManager.loadSongs();
    if (songs.length === 0) {
      this.showToast('Your studio deck is empty. Add songs first!', 'amber');
      return;
    }

    const first = songs[0];
    document.getElementById('batchAlbum').value = first.album || (songs.length > 1 ? 'Suno Studio Collection' : first.title);
    document.getElementById('batchArtist').value = first.artist || 'Suno AI Studio';
    document.getElementById('batchYear').value = first.year || String(new Date().getFullYear());
    document.getElementById('batchGenre').value = first.tags || '';

    const modal = document.getElementById('batchMetaModal');
    if (modal) modal.classList.add('open');
  }

  saveBatchMetaModal() {
    const songs = StorageManager.loadSongs();
    if (songs.length === 0) return;

    const album = document.getElementById('batchAlbum').value.trim();
    const artist = document.getElementById('batchArtist').value.trim();
    const year = document.getElementById('batchYear').value.trim();
    const genre = document.getElementById('batchGenre').value.trim();
    const autoNumber = document.getElementById('batchAutoNumber').checked;

    for (let i = 0; i < songs.length; i++) {
      const s = songs[i];
      if (album) s.album = album;
      if (artist) s.artist = artist;
      if (year) s.year = year;
      if (genre) s.tags = genre;
      if (autoNumber) {
        s.trackNumber = `${String(i + 1).padStart(2, '0')}/${String(songs.length).padStart(2, '0')}`;
      }
      StorageManager.upsertSong(s);
    }

    this.renderSongs();
    const modal = document.getElementById('batchMetaModal');
    if (modal) modal.classList.remove('open');
    this.showToast(`Applied custom tags across all ${songs.length} tracks!`, 'emerald');
  }

  /* =========================================================================
     BULK DOWNLOAD ALL TRACKS (SINGLE .ZIP ARCHIVE)
     ========================================================================= */

  openBulkDownloadModal() {
    const songs = StorageManager.loadSongs();
    if (songs.length === 0) {
      this.showToast('Your studio deck is empty. Add songs or a playlist link first!', 'amber');
      return;
    }
    const modal = document.getElementById('bulkDownloadModal');
    if (modal) {
      const wrap = document.getElementById('bulkDownloadProgressWrap');
      if (wrap) wrap.style.display = 'none';
      const btn = document.getElementById('btnStartBulkDownload');
      if (btn) btn.disabled = false;
      modal.classList.add('open');
    }
  }

  async startBulkDownload() {
    const songs = StorageManager.loadSongs();
    if (songs.length === 0) return;

    const radio = document.querySelector('input[name="bulkFormatRadio"]:checked');
    const format = radio ? radio.value : 'mp3';

    const btn = document.getElementById('btnStartBulkDownload');
    const wrap = document.getElementById('bulkDownloadProgressWrap');
    const bar = document.getElementById('bulkDownloadProgressBar');
    const statusText = document.getElementById('bulkDownloadStatusText');
    const pctText = document.getElementById('bulkDownloadProgressPct');

    if (btn) btn.disabled = true;
    if (wrap) wrap.style.display = 'block';

    try {
      const commonAlbum = songs[0]?.album || 'Suno Studio Collection';
      const zipBlob = await ZipPackager.buildBatchDeckZip(
        songs,
        (uuid, stCb) => this.getDecryptedAudio(uuid, stCb),
        format,
        (pct, text) => {
          if (bar) bar.style.width = `${pct}%`;
          if (pctText) pctText.textContent = `${pct}%`;
          if (statusText) statusText.textContent = text;
        },
        { albumName: commonAlbum }
      );

      const safeAlbum = this.makeSafeFilename(commonAlbum.replace(/\s+/g, '_'), 'zip');
      const filename = `Suno_Batch_${songs.length}_Tracks_${format.toUpperCase()}_${safeAlbum}`;
      this.triggerDownload(zipBlob, filename);
      this.showToast(`Downloaded Batch ZIP (${songs.length} tracks): "${filename}"!`, 'emerald');

      const modal = document.getElementById('bulkDownloadModal');
      if (modal) modal.classList.remove('open');
    } catch (err) {
      this.showToast(`Bulk download error: ${err.message}`, 'rose');
      if (statusText) statusText.textContent = `Error: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* =========================================================================
     WAVEFORM AUDIO TRIMMER & MASTERING FX STUDIO
     ========================================================================= */

  setupTrimCanvasInteractions() {
    const canvas = document.getElementById('trimWaveCanvas');
    if (!canvas) return;

    let draggingHandle = null; // 'start' | 'end'

    const updateFromClientX = (clientX) => {
      if (!this.trimState.duration) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const sec = Number((ratio * this.trimState.duration).toFixed(1));

      if (!draggingHandle) {
        const distStart = Math.abs(sec - this.trimState.startSec);
        const distEnd = Math.abs(sec - this.trimState.endSec);
        draggingHandle = distStart <= distEnd ? 'start' : 'end';
      }

      if (draggingHandle === 'start') {
        this.trimState.startSec = Math.min(sec, Math.max(0, this.trimState.endSec - 0.5));
      } else {
        this.trimState.endSec = Math.max(sec, Math.min(this.trimState.duration, this.trimState.startSec + 0.5));
      }

      this.stopFxPreview();
      this.syncTrimControlsUI();
      this.drawTrimWaveform();
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.trimState.duration) return;
      draggingHandle = null;
      canvas.setPointerCapture(e.pointerId);
      updateFromClientX(e.clientX);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!draggingHandle) return;
      updateFromClientX(e.clientX);
    });

    const endDrag = () => {
      draggingHandle = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  async openTrimFxStudio(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.player.pause();
    this.stopAllModalAudio();
    this.activeTrimSong = song;

    const modal = document.getElementById('trimFxModal');
    if (!modal) return;
    modal.classList.add('open');

    const titleEl = document.getElementById('trimModalTitle');
    const banner = document.getElementById('trimStatusBanner');
    if (titleEl) titleEl.textContent = `Trim & Mastering FX: ${song.title}`;
    if (banner) {
      banner.style.display = 'flex';
      banner.textContent = '⏳ Decoding master waveform...';
    }

    try {
      const { audioBuffer } = await this.getDecryptedAudio(uuid, (st) => {
        if (banner) banner.textContent = st;
      });

      const dur = Number(audioBuffer.duration.toFixed(1));
      const peaks = AudioConverter.computePeaks(audioBuffer, 220);

      this.trimState = {
        duration: dur,
        startSec: 0,
        endSec: dur,
        fadeInSec: 0,
        fadeOutSec: 0,
        preset: 'clean',
        peaks,
        audioBuffer
      };

      const startSlider = document.getElementById('trimStartRange');
      const endSlider = document.getElementById('trimEndRange');
      if (startSlider) {
        startSlider.max = String(dur);
        startSlider.value = '0';
      }
      if (endSlider) {
        endSlider.max = String(dur);
        endSlider.value = String(dur);
      }

      const fadeInSlider = document.getElementById('trimFadeInRange');
      const fadeOutSlider = document.getElementById('trimFadeOutRange');
      if (fadeInSlider) fadeInSlider.value = '0';
      if (fadeOutSlider) fadeOutSlider.value = '0';

      if (banner) banner.style.display = 'none';
      this.selectFxPreset('clean');
      this.syncTrimControlsUI();
      this.drawTrimWaveform();
    } catch (e) {
      if (banner) banner.textContent = `❌ Error: ${e.message}`;
      this.showToast(`Could not open Trim & FX Studio: ${e.message}`, 'rose');
    }
  }

  setQuickTrim(mode) {
    if (!this.trimState.duration) return;
    this.stopFxPreview();
    const dur = this.trimState.duration;

    if (mode === '30s') {
      this.trimState.startSec = 0;
      this.trimState.endSec = Math.min(dur, 30);
    } else if (mode === '15s') {
      this.trimState.startSec = 0;
      this.trimState.endSec = Math.min(dur, 15);
    } else {
      this.trimState.startSec = 0;
      this.trimState.endSec = dur;
    }

    this.syncTrimControlsUI();
    this.drawTrimWaveform();
  }

  onTrimSliderChange(which, val) {
    if (!this.trimState.duration) return;
    this.stopFxPreview();
    const num = Number(val);

    if (which === 'start') {
      this.trimState.startSec = Math.min(num, Math.max(0, this.trimState.endSec - 0.5));
    } else {
      this.trimState.endSec = Math.max(num, Math.min(this.trimState.duration, this.trimState.startSec + 0.5));
    }

    this.syncTrimControlsUI();
    this.drawTrimWaveform();
  }

  onTrimFadeChange() {
    this.stopFxPreview();
    const fi = Number(document.getElementById('trimFadeInRange')?.value || 0);
    const fo = Number(document.getElementById('trimFadeOutRange')?.value || 0);
    this.trimState.fadeInSec = fi;
    this.trimState.fadeOutSec = fo;
    this.syncTrimControlsUI();
    this.drawTrimWaveform();
  }

  selectFxPreset(presetId) {
    this.stopFxPreview();
    this.trimState.preset = presetId;
    document.querySelectorAll('.fx-preset-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.fx === presetId);
    });
  }

  syncTrimControlsUI() {
    const { startSec, endSec, fadeInSec, fadeOutSec } = this.trimState;
    const clipLen = Math.max(0, endSec - startSec);

    const startSlider = document.getElementById('trimStartRange');
    const endSlider = document.getElementById('trimEndRange');
    if (startSlider) startSlider.value = String(startSec);
    if (endSlider) endSlider.value = String(endSec);

    const fmt = (s) => {
      const m = Math.floor(s / 60);
      const rem = (s % 60).toFixed(1);
      return `${m}:${Number(rem) < 10 ? '0' : ''}${rem}`;
    };

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };

    setTxt('trimInLabel', fmt(startSec));
    setTxt('trimOutLabel', fmt(endSec));
    setTxt('trimLenLabel', fmt(clipLen));
    setTxt('trimStartVal', `${startSec.toFixed(1)}s`);
    setTxt('trimEndVal', `${endSec.toFixed(1)}s`);
    setTxt('trimFadeInVal', `${fadeInSec.toFixed(1)}s`);
    setTxt('trimFadeOutVal', `${fadeOutSec.toFixed(1)}s`);
  }

  drawTrimWaveform() {
    const canvas = document.getElementById('trimWaveCanvas');
    if (!canvas || !this.trimState.peaks || !this.trimState.duration) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const { peaks, duration, startSec, endSec, fadeInSec, fadeOutSec } = this.trimState;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#090b12';
    ctx.fillRect(0, 0, w, h);

    const startX = (startSec / duration) * w;
    const endX = (endSec / duration) * w;

    // Highlight active selected region
    const regionGrad = ctx.createLinearGradient(startX, 0, endX, 0);
    regionGrad.addColorStop(0, 'rgba(16, 185, 129, 0.16)');
    regionGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.14)');
    regionGrad.addColorStop(1, 'rgba(245, 158, 11, 0.18)');
    ctx.fillStyle = regionGrad;
    ctx.fillRect(startX, 0, Math.max(2, endX - startX), h);

    // Draw waveform bars
    const n = peaks.length;
    const barW = w / n;
    for (let i = 0; i < n; i++) {
      const x = i * barW;
      const inRange = x >= startX && x <= endX;
      const amp = Math.max(0.06, peaks[i]);
      const barH = amp * (h * 0.8);
      const y = (h - barH) / 2;

      ctx.fillStyle = inRange ? '#fbbf24' : 'rgba(100, 116, 139, 0.28)';
      ctx.fillRect(x + 0.8, y, Math.max(1.2, barW - 1.6), barH);
    }

    // Fade-in & Fade-out visual envelopes
    if (fadeInSec > 0) {
      const fiW = Math.min((endX - startX) * 0.48, (fadeInSec / duration) * w);
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, h - 6);
      ctx.lineTo(startX + fiW, 10);
      ctx.stroke();
    }
    if (fadeOutSec > 0) {
      const foW = Math.min((endX - startX) * 0.48, (fadeOutSec / duration) * w);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endX - foW, 10);
      ctx.lineTo(endX, h - 6);
      ctx.stroke();
    }

    // IN Handle
    ctx.fillStyle = '#10b981';
    ctx.fillRect(startX - 2, 0, 4, h);
    ctx.beginPath();
    ctx.roundRect(Math.max(0, startX - 16), 4, 32, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#052e16';
    ctx.font = '800 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IN', Math.max(16, startX), 16);

    // OUT Handle
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(endX - 2, 0, 4, h);
    ctx.beginPath();
    ctx.roundRect(Math.min(w - 36, endX - 18), h - 22, 36, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#451a03';
    ctx.fillText('OUT', Math.min(w - 18, endX), h - 10);
  }

  stopFxPreview() {
    if (this.fxPreviewSource) {
      try { this.fxPreviewSource.stop(); } catch (e) {}
      try { this.fxPreviewSource.disconnect(); } catch (e) {}
      this.fxPreviewSource = null;
    }
    const btn = document.getElementById('btnPreviewFx');
    if (btn) btn.textContent = '▶ Audition Processed Mix';
  }

  async renderActiveFxBuffer() {
    if (!this.trimState.audioBuffer) throw new Error('Audio buffer is not loaded.');
    const normalize = document.getElementById('trimNormalizeChk')?.checked !== false;

    return await AudioFXEngine.process(this.trimState.audioBuffer, {
      startSec: this.trimState.startSec,
      endSec: this.trimState.endSec,
      fadeInSec: this.trimState.fadeInSec,
      fadeOutSec: this.trimState.fadeOutSec,
      normalize,
      preset: this.trimState.preset
    });
  }

  async toggleFxPreview() {
    if (this.fxPreviewSource) {
      this.stopFxPreview();
      return;
    }

    const btn = document.getElementById('btnPreviewFx');
    if (btn) btn.textContent = '⏳ Rendering FX...';

    try {
      const processed = await this.renderActiveFxBuffer();
      const ctx = AudioConverter.getAudioContext();
      const src = ctx.createBufferSource();
      src.buffer = processed;
      src.connect(ctx.destination);
      src.onended = () => {
        if (this.fxPreviewSource === src) {
          this.fxPreviewSource = null;
          if (btn) btn.textContent = '▶ Audition Processed Mix';
        }
      };
      this.fxPreviewSource = src;
      src.start(0);
      if (btn) btn.textContent = '⏹ Stop Audition';
    } catch (e) {
      this.stopFxPreview();
      this.showToast(`FX preview failed: ${e.message}`, 'rose');
    }
  }

  async exportProcessedFx(format = 'mp3') {
    if (!this.activeTrimSong || !this.trimState.audioBuffer) return;
    this.stopFxPreview();

    const song = this.activeTrimSong;
    const presetMeta = AudioFXEngine.PRESETS.find((p) => p.id === this.trimState.preset) || AudioFXEngine.PRESETS[0];
    const suffix = this.trimState.preset === 'clean' ? 'Trimmed' : presetMeta.label;
    const btnId = format === 'wav' ? 'btnExportFxWav' : 'btnExportFxMp3';

    this.setBtnLoading(btnId, true, 'Mastering...');
    try {
      const processed = await this.renderActiveFxBuffer();

      if (format === 'wav') {
        const wavBlob = AudioConverter.encodeWav(processed);
        const filename = this.makeSafeFilename(`${song.title} (${suffix})`, 'wav');
        this.triggerDownload(wavBlob, filename);
        this.showToast(`Exported Mastered WAV: "${filename}"!`, 'emerald');
      } else {
        this.setBtnLoading(btnId, true, 'MP3 0%...');
        const rawMp3 = await Mp3Encoder.encode(processed, 320, (pct) => {
          this.setBtnLoading(btnId, true, `MP3 ${pct}%`);
        });
        const tagged = await ID3Writer.embedTags(rawMp3, {
          title: `${song.title} (${suffix})`,
          genre: song.tags,
          lyrics: song.prompt,
          coverUrl: song.imageLarge
        });
        const filename = this.makeSafeFilename(`${song.title} (${suffix})`, 'mp3');
        this.triggerDownload(tagged, filename);
        this.showToast(`Exported Mastered 320k MP3: "${filename}"!`, 'emerald');
      }
    } catch (e) {
      this.showToast(`Mastering export failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(btnId, false);
    }
  }

  /* =========================================================================
     KARAOKE VIDEO & VISUALIZER STUDIO
     ========================================================================= */

  /* =========================================================================
     WORLD-CLASS VIDEO STUDIO & CUSTOMIZATION SUITE
     ========================================================================= */

  loadVideoStudioSettings() {
    const defaultSettings = {
      studioName: 'NTK Hub',
      studioSubtitle: 'Official Visualizer',
      watermarkPos: 'top-left',
      customBgDataUrl: null,
      bgDimOpacity: 0.40,
      bgBlurPx: 20,
      bgMotion: 'ken-burns',
      artMode: 'card',
      artSizeScale: 0.44,
      artCornerRadius: 28,
      artGlowIntensity: 0.70,
      visualStyle: 'bars',
      showVisualizer: true,
      vizPosition: 'below_artwork',
      vizWidthPercent: 0.74,
      vizMaxHeight: 120,
      theme: 'sunset',
      customColors: null,
      showParticles: true,
      customCoverDataUrl: null,
      lyricAnimation: 'capcut_bounce',
      showFooter: true,
      fontFamily: 'Inter',
      lyricPosition: 'lower-third',
      aspectRatio: '1:1',
      fps: 60,
      bitrateMbps: 12,
      customPositions: null
    };

    try {
      const stored = localStorage.getItem('suno_video_studio_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.studioName === 'NTK Studios') {
          parsed.studioName = 'NTK Hub';
        }
        return { ...defaultSettings, ...parsed };
      }
    } catch (e) {}
    return defaultSettings;
  }

  saveVideoStudioSettings() {
    if (!this.videoStudio) return;
    try {
      const settings = {
        studioName: this.videoStudio.studioName,
        studioSubtitle: this.videoStudio.studioSubtitle,
        watermarkPos: this.videoStudio.watermarkPos,
        customBgDataUrl: this.videoStudio.customBgDataUrl,
        bgDimOpacity: this.videoStudio.bgDimOpacity,
        bgBlurPx: this.videoStudio.bgBlurPx,
        bgMotion: this.videoStudio.bgMotion,
        artMode: this.videoStudio.artMode,
        artSizeScale: this.videoStudio.artSizeScale,
        artCornerRadius: this.videoStudio.artCornerRadius,
        artGlowIntensity: this.videoStudio.artGlowIntensity,
        visualStyle: this.videoStudio.visualStyle,
        showVisualizer: this.videoStudio.showVisualizer !== false,
        vizPosition: this.videoStudio.vizPosition || 'below_artwork',
        vizWidthPercent: this.videoStudio.vizWidthPercent || 0.74,
        vizMaxHeight: this.videoStudio.vizMaxHeight || 120,
        theme: this.videoStudio.theme,
        customColors: this.videoStudio.customColors,
        showParticles: this.videoStudio.showParticles,
        customCoverDataUrl: this.videoStudio.customCoverDataUrl,
        lyricAnimation: this.videoStudio.lyricAnimation,
        showFooter: this.videoStudio.showFooter,
        fontFamily: this.videoStudio.fontFamily,
        lyricPosition: this.videoStudio.lyricPosition,
        aspectRatio: this.videoStudio.aspectRatio,
        fps: this.videoStudio.fps,
        bitrateMbps: this.videoStudio.bitrateMbps,
        customPositions: this.videoStudio.customPositions || null
      };
      localStorage.setItem('suno_video_studio_settings', JSON.stringify(settings));
    } catch (e) {}
  }

  async openVideoStudio(uuid) {
    let song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    // Proactively enrich metadata and lyrics if missing or using placeholder title
    if (!song.prompt || (song.title && song.title.startsWith('Suno_Song_'))) {
      try {
        const freshMeta = await SunoAPI.fetchMetadata(song.uuid);
        if (freshMeta) {
          let updated = false;
          if (freshMeta.title && !freshMeta.title.startsWith('Suno_Song_')) {
            song.title = freshMeta.title;
            updated = true;
          }
          if (freshMeta.prompt && freshMeta.prompt.trim()) {
            song.prompt = freshMeta.prompt.trim();
            updated = true;
          }
          if (freshMeta.tags) song.tags = freshMeta.tags;
          if (freshMeta.duration) song.duration = freshMeta.duration;
          if (freshMeta.artist) song.artist = freshMeta.artist;
          if (updated) {
            const allSongs = StorageManager.loadSongs();
            const idx = allSongs.findIndex((s) => s.uuid === song.uuid);
            if (idx !== -1) {
              allSongs[idx] = { ...allSongs[idx], ...song };
              StorageManager.saveSongs(allSongs);
            }
            this.renderSongCards();
          }
        }
      } catch (e) {}
    }

    this.player.pause();
    this.stopAllModalAudio();
    this.activeStudioSong = song;

    const modal = document.getElementById('videoStudioModal');
    if (!modal) return;
    modal.classList.add('open');

    const titleEl = document.getElementById('studioSongTitle');
    if (titleEl) titleEl.textContent = `Karaoke Video Studio: ${song.title}`;

    const settings = this.loadVideoStudioSettings();
    const canvas = document.getElementById('studioCanvas');
    const showLyrics = document.getElementById('chkVideoLyrics')?.checked !== false;

    this.videoStudio = new VideoGenerator({
      canvas,
      aspectRatio: settings.aspectRatio,
      visualStyle: settings.visualStyle,
      showVisualizer: settings.showVisualizer !== false,
      vizPosition: settings.vizPosition || 'below_artwork',
      vizWidthPercent: settings.vizWidthPercent || 0.74,
      vizMaxHeight: settings.vizMaxHeight || 120,
      theme: settings.theme,
      customColors: settings.customColors,
      showLyrics,
      studioName: settings.studioName,
      studioSubtitle: settings.studioSubtitle,
      watermarkPos: settings.watermarkPos,
      customBgDataUrl: settings.customBgDataUrl,
      bgDimOpacity: settings.bgDimOpacity,
      bgBlurPx: settings.bgBlurPx,
      bgMotion: settings.bgMotion,
      showParticles: settings.showParticles,
      customCoverDataUrl: settings.customCoverDataUrl,
      lyricAnimation: settings.lyricAnimation,
      showFooter: settings.showFooter !== false,
      artMode: settings.artMode,
      artSizeScale: settings.artSizeScale,
      artCornerRadius: settings.artCornerRadius,
      artGlowIntensity: settings.artGlowIntensity,
      fontFamily: settings.fontFamily,
      lyricPosition: settings.lyricPosition,
      fps: settings.fps,
      bitrateMbps: settings.bitrateMbps,
      customPositions: settings.customPositions || null,
      songMeta: song
    });

    if (canvas) {
      this.videoStudio.setupDragInteraction(canvas, (comp, pos) => {
        this.onVideoComponentMoved(comp, pos);
      });
    }

    // Populate UI inputs with saved settings
    const nameInput = document.getElementById('videoStudioName');
    if (nameInput) nameInput.value = settings.studioName;

    const subInput = document.getElementById('videoStudioSubtitle');
    if (subInput) subInput.value = settings.studioSubtitle;

    const wmSelect = document.getElementById('videoWatermarkPos');
    if (wmSelect) wmSelect.value = settings.watermarkPos;

    const chkFooter = document.getElementById('chkVideoFooter');
    if (chkFooter) chkFooter.checked = settings.showFooter !== false;

    const dimInput = document.getElementById('videoBgDim');
    const dimVal = document.getElementById('videoBgDimVal');
    if (dimInput) dimInput.value = Math.round(settings.bgDimOpacity * 100);
    if (dimVal) dimVal.textContent = `${Math.round(settings.bgDimOpacity * 100)}%`;

    const blurInput = document.getElementById('videoBgBlur');
    const blurVal = document.getElementById('videoBgBlurVal');
    if (blurInput) blurInput.value = settings.bgBlurPx;
    if (blurVal) blurVal.textContent = `${settings.bgBlurPx}px`;

    const motionSelect = document.getElementById('videoBgMotion');
    if (motionSelect) motionSelect.value = settings.bgMotion;

    const scaleInput = document.getElementById('videoArtScale');
    const scaleVal = document.getElementById('videoArtScaleVal');
    if (scaleInput) scaleInput.value = Math.round(settings.artSizeScale * 100);
    if (scaleVal) scaleVal.textContent = `${Math.round(settings.artSizeScale * 100)}%`;

    const cornersSelect = document.getElementById('videoArtCorners');
    if (cornersSelect) cornersSelect.value = String(settings.artCornerRadius);

    const glowInput = document.getElementById('videoArtGlow');
    const glowVal = document.getElementById('videoArtGlowVal');
    if (glowInput) glowInput.value = Math.round(settings.artGlowIntensity * 100);
    if (glowVal) glowVal.textContent = `${Math.round(settings.artGlowIntensity * 100)}%`;

    const fontSelect = document.getElementById('videoFontFamily');
    if (fontSelect) fontSelect.value = settings.fontFamily;

    const animSelect = document.getElementById('videoLyricAnimSelect');
    if (animSelect) animSelect.value = settings.lyricAnimation || 'capcut_bounce';

    const posSelect = document.getElementById('videoLyricPos');
    if (posSelect) posSelect.value = settings.lyricPosition;

    const fpsSelect = document.getElementById('videoFpsSelect');
    if (fpsSelect) fpsSelect.value = String(settings.fps);

    const bitSelect = document.getElementById('videoBitrateSelect');
    if (bitSelect) bitSelect.value = String(settings.bitrateMbps);

    const partChk = document.getElementById('videoShowParticles');
    if (partChk) partChk.checked = settings.showParticles;

    // Visualizer Controls Population
    const chkViz = document.getElementById('chkVideoVisualizer');
    if (chkViz) chkViz.checked = settings.showVisualizer !== false;

    const vizPosSelect = document.getElementById('videoVizPosition');
    if (vizPosSelect) vizPosSelect.value = settings.vizPosition || 'below_artwork';

    const vizWInput = document.getElementById('videoVizWidth');
    const vizWVal = document.getElementById('videoVizWidthVal');
    if (vizWInput) vizWInput.value = Math.round((settings.vizWidthPercent || 0.74) * 100);
    if (vizWVal) vizWVal.textContent = `${Math.round((settings.vizWidthPercent || 0.74) * 100)}%`;

    const vizHInput = document.getElementById('videoVizHeight');
    const vizHVal = document.getElementById('videoVizHeightVal');
    if (vizHInput) vizHInput.value = settings.vizMaxHeight || 120;
    if (vizHVal) vizHVal.textContent = `${settings.vizMaxHeight || 120}px`;

    // Reset button active states
    document.querySelectorAll('.ratio-btn').forEach((b) => b.classList.toggle('active', b.dataset.ratio === settings.aspectRatio));
    document.querySelectorAll('[data-vstyle]').forEach((b) => b.classList.toggle('active', b.dataset.vstyle === settings.visualStyle));
    document.querySelectorAll('[data-artmode]').forEach((b) => b.classList.toggle('active', b.dataset.artmode === settings.artMode));
    document.querySelectorAll('.theme-swatch-btn').forEach((b) => b.classList.toggle('active', b.dataset.vtheme === settings.theme));

    const container = document.getElementById('canvasContainer');
    if (container) container.className = `canvas-container ratio-${settings.aspectRatio.replace(':', '-')}`;

    // Timeline Scrubber
    const scrubber = document.getElementById('videoTimelineScrubber');
    const timeText = document.getElementById('videoTimelineTime');
    if (scrubber) scrubber.value = 0;
    const dur = song.duration || 180;
    if (timeText) timeText.textContent = `0:00 / ${this.formatTime(dur)}`;

    this.videoStudio.setSongMeta(song, dur);
    this.videoStudio.updateCanvasDimensions();

    // Load artwork & custom background
    const bgStatus = document.getElementById('videoBgStatusText');
    const clearBgBtn = document.getElementById('btnClearVideoBg');

    if (settings.customBgDataUrl) {
      if (bgStatus) bgStatus.textContent = 'Custom Wallpaper Active';
      if (clearBgBtn) clearBgBtn.style.display = 'inline-block';
      await this.videoStudio.loadBackgroundImage(settings.customBgDataUrl);
    } else {
      if (bgStatus) bgStatus.textContent = 'Using Album Artwork Backdrop';
      if (clearBgBtn) clearBgBtn.style.display = 'none';
    }

    // Custom Album Artwork / Vinyl Label
    const artStatus = document.getElementById('videoArtStatusText');
    const clearArtBtn = document.getElementById('btnClearVideoArt');
    if (settings.customCoverDataUrl) {
      if (artStatus) artStatus.textContent = 'Custom Artwork Active';
      if (clearArtBtn) clearArtBtn.style.display = 'inline-block';
      await this.videoStudio.loadCustomCover(settings.customCoverDataUrl);
    } else {
      if (artStatus) artStatus.textContent = 'Using Song Artwork';
      if (clearArtBtn) clearArtBtn.style.display = 'none';
      await this.videoStudio.loadCustomCover(null);
    }

    // Lyrics & Cues
    const lyricsTextarea = document.getElementById('videoLyricsTextarea');
    const cuesBadge = document.getElementById('videoLyricCuesCount');
    const lyricsStatusText = document.getElementById('videoLyricsStatusText');
    const songPrompt = (song.prompt || '').trim();
    if (lyricsTextarea) lyricsTextarea.value = songPrompt;
    this.videoStudio.setCustomLyrics(songPrompt, dur);
    if (cuesBadge) cuesBadge.textContent = `${this.videoStudio.lyricCues.length} cues`;
    if (lyricsStatusText) {
      lyricsStatusText.textContent = this.videoStudio.lyricCues.length > 0
        ? `Loaded ${this.videoStudio.lyricCues.length} cues from song`
        : 'Ready (paste or import lyrics)';
    }

    await this.videoStudio.loadCoverImage(song.imageLarge);

    const resetBtn = document.getElementById('btnResetCanvasPositions');
    if (resetBtn) {
      const hasAny = this.videoStudio.customPositions && Object.values(this.videoStudio.customPositions).some((p) => p !== null);
      resetBtn.style.display = hasAny ? 'inline-flex' : 'none';
    }
    if (this.videoStudio.customPositions && this.videoStudio.customPositions.visualizer) {
      const vizPosSelect = document.getElementById('videoVizPosition');
      if (vizPosSelect) vizPosSelect.value = 'custom';
    }

    this.redrawStaticVideoPreview(0);
  }

  onVideoComponentMoved(comp, pos) {
    this.saveVideoStudioSettings();
    const resetBtn = document.getElementById('btnResetCanvasPositions');
    if (resetBtn) resetBtn.style.display = 'inline-flex';
    if (comp === 'visualizer') {
      const sel = document.getElementById('videoVizPosition');
      if (sel) sel.value = 'custom';
    }
  }

  resetVideoLayoutPositions(comp = null) {
    if (!this.videoStudio) return;
    this.videoStudio.resetCustomPositions(comp);
    this.saveVideoStudioSettings();
    const resetBtn = document.getElementById('btnResetCanvasPositions');
    if (resetBtn) {
      const hasAny = this.videoStudio.customPositions && Object.values(this.videoStudio.customPositions).some((p) => p !== null);
      resetBtn.style.display = hasAny ? 'inline-flex' : 'none';
    }
    const sel = document.getElementById('videoVizPosition');
    if (sel && sel.value === 'custom') {
      sel.value = this.videoStudio.vizPosition || 'below_artwork';
    }
    this.redrawStaticVideoPreview();
    this.showToast('Reset component layout positions to defaults.', 'amber');
  }

  switchVideoTab(tabName) {
    document.querySelectorAll('.studio-tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.vtab === tabName);
    });
    document.querySelectorAll('.studio-tab-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `vtab-${tabName}`);
    });
  }

  getCurrentVideoTime() {
    const scrubber = document.getElementById('videoTimelineScrubber');
    const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
    if (scrubber) {
      return (Number(scrubber.value) / 1000) * dur;
    }
    return 0;
  }

  redrawStaticVideoPreview(timeSec = null) {
    if (!this.videoStudio) return;
    const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
    const t = (timeSec !== null && timeSec !== undefined) ? timeSec : this.getCurrentVideoTime();
    this.videoStudio.renderStaticAtTime(t, dur);
  }

  scrubVideoTimeline(val) {
    if (!this.videoStudio) return;
    const scrubber = document.getElementById('videoTimelineScrubber');
    if (scrubber && String(scrubber.value) !== String(val)) {
      scrubber.value = val;
    }
    const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
    const currentSec = (Number(val) / 1000) * dur;
    const timeText = document.getElementById('videoTimelineTime');
    if (timeText) timeText.textContent = `${this.formatTime(currentSec)} / ${this.formatTime(dur)}`;

    if (this.videoStudio.isPreviewing) {
      this.videoStudio.seekPreview(currentSec);
    } else if (!this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview(currentSec);
    }
  }

  snapshotVideoFrame() {
    const canvas = document.getElementById('studioCanvas');
    if (!canvas || !this.activeStudioSong) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${this.makeSafeFilename(this.activeStudioSong.title, 'png')}`;
      link.href = dataUrl;
      link.click();
      this.showToast('Downloaded High-Res Frame Snapshot!', 'emerald');
    } catch (e) {
      this.showToast(`Snapshot failed: ${e.message}`, 'rose');
    }
  }

  updateVideoBranding() {
    if (!this.videoStudio) return;
    const name = document.getElementById('videoStudioName')?.value || 'NTK Hub';
    const sub = document.getElementById('videoStudioSubtitle')?.value || 'Official Visualizer';
    const wm = document.getElementById('videoWatermarkPos')?.value || 'top-left';

    this.videoStudio.studioName = name;
    this.videoStudio.studioSubtitle = sub;
    this.videoStudio.watermarkPos = wm;

    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  toggleVideoFooter(checked) {
    if (!this.videoStudio) return;
    this.videoStudio.showFooter = Boolean(checked);
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  async handleCustomBgUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !this.videoStudio) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      await this.videoStudio.setCustomBackground(dataUrl);

      const bgStatus = document.getElementById('videoBgStatusText');
      const clearBtn = document.getElementById('btnClearVideoBg');
      if (bgStatus) bgStatus.textContent = `Custom Wallpaper: ${file.name}`;
      if (clearBtn) clearBtn.style.display = 'inline-block';

      this.saveVideoStudioSettings();
      this.redrawStaticVideoPreview();
      this.showToast('Loaded custom cinema wallpaper!', 'emerald');
    };
    reader.readAsDataURL(file);
  }

  async clearCustomVideoBg() {
    if (!this.videoStudio) return;
    await this.videoStudio.setCustomBackground(null);

    const bgStatus = document.getElementById('videoBgStatusText');
    const clearBtn = document.getElementById('btnClearVideoBg');
    if (bgStatus) bgStatus.textContent = 'Using Album Artwork Backdrop';
    if (clearBtn) clearBtn.style.display = 'none';

    this.saveVideoStudioSettings();
    this.redrawStaticVideoPreview();
    this.showToast('Reset background to album artwork.', 'cyan');
  }

  updateVideoBgSettings() {
    if (!this.videoStudio) return;
    const dimVal = Number(document.getElementById('videoBgDim')?.value || 40);
    const blurVal = Number(document.getElementById('videoBgBlur')?.value || 20);
    const motion = document.getElementById('videoBgMotion')?.value || 'ken-burns';

    this.videoStudio.bgDimOpacity = dimVal / 100;
    this.videoStudio.bgBlurPx = blurVal;
    this.videoStudio.bgMotion = motion;

    const dimLabel = document.getElementById('videoBgDimVal');
    const blurLabel = document.getElementById('videoBgBlurVal');
    if (dimLabel) dimLabel.textContent = `${dimVal}%`;
    if (blurLabel) blurLabel.textContent = `${blurVal}px`;

    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  setVideoArtMode(mode) {
    if (!this.videoStudio) return;
    this.videoStudio.artMode = mode;
    document.querySelectorAll('[data-artmode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.artmode === mode);
    });
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  updateVideoArtSettings() {
    if (!this.videoStudio) return;
    const scaleVal = Number(document.getElementById('videoArtScale')?.value || 44);
    const corners = document.getElementById('videoArtCorners')?.value || '28';
    const glowVal = Number(document.getElementById('videoArtGlow')?.value || 70);

    this.videoStudio.artSizeScale = scaleVal / 100;
    this.videoStudio.artCornerRadius = isNaN(Number(corners)) ? corners : Number(corners);
    this.videoStudio.artGlowIntensity = glowVal / 100;

    const scaleLabel = document.getElementById('videoArtScaleVal');
    const glowLabel = document.getElementById('videoArtGlowVal');
    if (scaleLabel) scaleLabel.textContent = `${scaleVal}%`;
    if (glowLabel) glowLabel.textContent = `${glowVal}%`;

    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  async handleCustomArtUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !this.videoStudio) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      await this.videoStudio.setCustomCover(dataUrl);

      const statusEl = document.getElementById('videoArtStatusText');
      const clearBtn = document.getElementById('btnClearVideoArt');
      if (statusEl) statusEl.textContent = `Custom Artwork: ${file.name}`;
      if (clearBtn) clearBtn.style.display = 'inline-block';

      this.saveVideoStudioSettings();
      this.redrawStaticVideoPreview();
      this.showToast('Loaded custom album artwork & vinyl label!', 'emerald');
    };
    reader.readAsDataURL(file);
  }

  async clearCustomArt() {
    if (!this.videoStudio) return;
    await this.videoStudio.setCustomCover(null);

    const statusEl = document.getElementById('videoArtStatusText');
    const clearBtn = document.getElementById('btnClearVideoArt');
    if (statusEl) statusEl.textContent = 'Using Song Artwork';
    if (clearBtn) clearBtn.style.display = 'none';

    this.saveVideoStudioSettings();
    this.redrawStaticVideoPreview();
    this.showToast('Reset to default song artwork.', 'cyan');
  }

  setVideoAspectRatio(ratio) {
    if (!this.videoStudio) return;
    this.videoStudio.aspectRatio = ratio;
    const container = document.getElementById('canvasContainer');
    if (container) {
      container.className = `canvas-container ratio-${ratio.replace(':', '-')}`;
    }
    document.querySelectorAll('.ratio-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.ratio === ratio);
    });
    this.videoStudio.updateCanvasDimensions();
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  setVideoStyle(style) {
    if (!this.videoStudio) return;
    this.videoStudio.visualStyle = style;
    if (style === 'none') {
      this.videoStudio.showVisualizer = false;
      const chk = document.getElementById('chkVideoVisualizer');
      if (chk) chk.checked = false;
    } else {
      this.videoStudio.showVisualizer = true;
      const chk = document.getElementById('chkVideoVisualizer');
      if (chk) chk.checked = true;
    }
    document.querySelectorAll('[data-vstyle]').forEach((b) => {
      b.classList.toggle('active', b.dataset.vstyle === style);
    });
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  toggleVideoVisualizer(checked) {
    if (!this.videoStudio) return;
    this.videoStudio.showVisualizer = Boolean(checked);
    const chk = document.getElementById('chkVideoVisualizer');
    if (chk && chk.checked !== Boolean(checked)) chk.checked = Boolean(checked);
    if (!this.videoStudio.showVisualizer) {
      document.querySelectorAll('[data-vstyle]').forEach((b) => {
        b.classList.toggle('active', b.dataset.vstyle === 'none');
      });
    } else if (this.videoStudio.visualStyle === 'none') {
      this.videoStudio.visualStyle = 'bars';
      document.querySelectorAll('[data-vstyle]').forEach((b) => {
        b.classList.toggle('active', b.dataset.vstyle === 'bars');
      });
    }
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  updateVideoVizPosition(pos) {
    if (!this.videoStudio) return;
    if (pos === 'custom') {
      return;
    }
    if (this.videoStudio.customPositions) {
      this.videoStudio.customPositions.visualizer = null;
    }
    this.videoStudio.vizPosition = pos;
    if (pos === 'around_artwork' && this.videoStudio.visualStyle !== 'circular') {
      this.setVideoStyle('circular');
    }
    this.saveVideoStudioSettings();
    const resetBtn = document.getElementById('btnResetCanvasPositions');
    if (resetBtn) {
      const hasAny = this.videoStudio.customPositions && Object.values(this.videoStudio.customPositions).some((p) => p !== null);
      resetBtn.style.display = hasAny ? 'inline-flex' : 'none';
    }
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  updateVideoVizDimensions() {
    if (!this.videoStudio) return;
    const wVal = Number(document.getElementById('videoVizWidth')?.value || 74);
    const hVal = Number(document.getElementById('videoVizHeight')?.value || 120);

    this.videoStudio.vizWidthPercent = wVal / 100;
    this.videoStudio.vizMaxHeight = hVal;

    const wLabel = document.getElementById('videoVizWidthVal');
    const hLabel = document.getElementById('videoVizHeightVal');
    if (wLabel) wLabel.textContent = `${wVal}%`;
    if (hLabel) hLabel.textContent = `${hVal}px`;

    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  setVideoTheme(theme) {
    if (!this.videoStudio) return;
    this.videoStudio.theme = theme;
    this.videoStudio.customColors = null;
    document.querySelectorAll('.theme-swatch-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.vtheme === theme);
    });
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  updateCustomVideoColors() {
    if (!this.videoStudio) return;
    const primary = document.getElementById('videoCustomPrimary')?.value || '#fbbf24';
    const secondary = document.getElementById('videoCustomSecondary')?.value || '#f43f5e';
    this.videoStudio.customColors = { primary, secondary, glow: '245, 158, 11' };
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  resetCustomVideoColors() {
    if (!this.videoStudio) return;
    this.videoStudio.customColors = null;
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
    this.showToast('Reset to theme colors.', 'cyan');
  }

  toggleVideoParticles(checked) {
    if (!this.videoStudio) return;
    this.videoStudio.showParticles = Boolean(checked);
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  toggleVideoLyrics(checked) {
    if (!this.videoStudio) return;
    this.videoStudio.showLyrics = Boolean(checked);
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  updateVideoFont(font) {
    if (!this.videoStudio) return;
    this.videoStudio.fontFamily = font;
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  updateVideoLyricPos(pos) {
    if (!this.videoStudio) return;
    this.videoStudio.lyricPosition = pos;
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  setVideoLyricAnimation(style) {
    if (!this.videoStudio) return;
    this.videoStudio.lyricAnimation = style;
    const select = document.getElementById('videoLyricAnimSelect');
    if (select && select.value !== style) select.value = style;
    this.saveVideoStudioSettings();
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  async fetchOnlineLyricsForVideo() {
    if (!this.activeStudioSong || !this.videoStudio) return;
    const btn = document.getElementById('btnFetchOnlineLyrics');
    const statusText = document.getElementById('videoLyricsStatusText');
    const oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Searching LRCLIB...';
    }
    if (statusText) statusText.textContent = 'Querying LRCLIB database...';

    try {
      const result = await LyricsUtils.searchOnlineLyrics(
        this.activeStudioSong.title,
        this.activeStudioSong.artist || '',
        this.activeStudioSong.duration || 180
      );

      const lyricsToUse = result.syncedLyrics || result.plainLyrics;
      if (!lyricsToUse) {
        this.showToast('No online lyrics found for this track.', 'amber');
        if (statusText) statusText.textContent = 'No online lyrics found.';
        return;
      }

      const textarea = document.getElementById('videoLyricsTextarea');
      if (textarea) textarea.value = lyricsToUse;

      const dur = this.activeStudioSong.duration || 180;
      this.videoStudio.setCustomLyrics(lyricsToUse, dur);

      const cuesBadge = document.getElementById('videoLyricCuesCount');
      if (cuesBadge) cuesBadge.textContent = `${this.videoStudio.lyricCues.length} cues`;

      if (statusText) {
        statusText.textContent = result.isSynced
          ? `Loaded synced lyrics (${this.videoStudio.lyricCues.length} cues)`
          : `Loaded plain lyrics (${this.videoStudio.lyricCues.length} cues)`;
      }

      this.redrawStaticVideoPreview();
      this.showToast(`Loaded ${this.videoStudio.lyricCues.length} ${result.isSynced ? 'synced' : 'timed'} lyric cues!`, 'emerald');
    } catch (err) {
      if (statusText) statusText.textContent = `Search failed: ${err.message}`;
      this.showToast(err.message || 'Lyrics search failed', 'rose');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText || 'Search Online (LRCLIB)';
      }
    }
  }

  handleLyricsFileUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !this.videoStudio) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const textarea = document.getElementById('videoLyricsTextarea');
      if (textarea) textarea.value = text;

      const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
      this.videoStudio.setCustomLyrics(text, dur);

      const cuesBadge = document.getElementById('videoLyricCuesCount');
      if (cuesBadge) cuesBadge.textContent = `${this.videoStudio.lyricCues.length} cues`;

      const statusText = document.getElementById('videoLyricsStatusText');
      if (statusText) statusText.textContent = `Imported from ${file.name}`;

      this.redrawStaticVideoPreview();
      this.showToast(`Imported ${this.videoStudio.lyricCues.length} cues from ${file.name}!`, 'emerald');
    };
    reader.readAsText(file);
  }

  async resetLyricsFromSong() {
    if (!this.videoStudio || !this.activeStudioSong) return;
    let raw = (this.activeStudioSong.prompt || '').trim();
    const textarea = document.getElementById('videoLyricsTextarea');
    const cuesBadge = document.getElementById('videoLyricCuesCount');
    const statusText = document.getElementById('videoLyricsStatusText');

    if (!raw) {
      if (statusText) statusText.textContent = 'Fetching prompt lyrics from Suno...';
      try {
        const freshMeta = await SunoAPI.fetchMetadata(this.activeStudioSong.uuid);
        if (freshMeta && freshMeta.prompt) {
          raw = freshMeta.prompt.trim();
          this.activeStudioSong.prompt = raw;
          if (freshMeta.title && !freshMeta.title.startsWith('Suno_Song_')) {
            this.activeStudioSong.title = freshMeta.title;
          }
          const songs = StorageManager.loadSongs();
          const idx = songs.findIndex((s) => s.uuid === this.activeStudioSong.uuid);
          if (idx !== -1) {
            songs[idx] = { ...songs[idx], ...this.activeStudioSong };
            StorageManager.saveSongs(songs);
          }
        }
      } catch (e) {}
    }

    if (textarea) textarea.value = raw;

    const dur = this.activeStudioSong.duration || 180;
    this.videoStudio.setCustomLyrics(raw, dur);

    if (cuesBadge) cuesBadge.textContent = `${this.videoStudio.lyricCues.length} cues`;
    if (statusText) {
      statusText.textContent = this.videoStudio.lyricCues.length > 0
        ? `Reset to Suno prompt (${this.videoStudio.lyricCues.length} cues)`
        : 'Suno prompt has no lyrics text';
    }

    this.redrawStaticVideoPreview();
    this.showToast(raw ? 'Reset lyrics to Suno prompt.' : 'No lyrics prompt found on Suno.', raw ? 'cyan' : 'amber');
  }

  updateVideoLyricsText() {
    if (!this.videoStudio) return;
    const textarea = document.getElementById('videoLyricsTextarea');
    const text = textarea ? textarea.value : '';

    const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
    this.videoStudio.setCustomLyrics(text, dur);

    const cuesBadge = document.getElementById('videoLyricCuesCount');
    if (cuesBadge) cuesBadge.textContent = `${this.videoStudio.lyricCues.length} cues`;

    const statusText = document.getElementById('videoLyricsStatusText');
    if (statusText) statusText.textContent = `Edited (${this.videoStudio.lyricCues.length} cues)`;

    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  toggleTapToSync() {
    if (!this.videoStudio || !this.activeStudioSong) return;
    const panel = document.getElementById('tapSyncPanel');
    if (!panel) return;

    if (this.tapSyncState && this.tapSyncState.active) {
      this.cancelTapToSync();
      return;
    }

    const textarea = document.getElementById('videoLyricsTextarea');
    const rawText = textarea ? textarea.value : '';
    // Split into clean lines, removing existing timestamps if re-syncing
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.replace(/^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim())
      .filter((l) => l.length > 0 && !/^\[.*?\]$/.test(l));

    if (lines.length === 0) {
      this.showToast('Please paste or reset lyrics before starting Tap-to-Sync.', 'amber');
      return;
    }

    this.tapSyncState = {
      active: true,
      lines: lines,
      stamped: [],
      currentIndex: 0
    };

    panel.style.display = 'block';
    this.updateTapSyncUI();

    // Start audio preview if paused
    if (!this.videoStudio.isPreviewing) {
      this.toggleVideoPreview();
    }

    // Attach global keyboard listener for Spacebar
    if (!this._tapSyncKeyHandler) {
      this._tapSyncKeyHandler = (e) => {
        if (!this.tapSyncState || !this.tapSyncState.active) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          this.tapNextLyricLine();
        }
      };
      window.addEventListener('keydown', this._tapSyncKeyHandler);
    }

    this.showToast('Tap-to-Sync active: Listen to audio and press Spacebar at each line!', 'emerald');
  }

  updateTapSyncUI() {
    if (!this.tapSyncState) return;
    const idx = this.tapSyncState.currentIndex;
    const total = this.tapSyncState.lines.length;
    const progressEl = document.getElementById('tapSyncProgress');
    const currLineEl = document.getElementById('tapSyncCurrentLine');
    const nextLineEl = document.getElementById('tapSyncNextLine');
    const btnAction = document.getElementById('btnTapSyncAction');

    if (progressEl) progressEl.textContent = `Line ${Math.min(idx + 1, total)} of ${total}`;
    if (currLineEl) {
      currLineEl.textContent = idx < total ? this.tapSyncState.lines[idx] : '🎉 All lines stamped!';
    }
    if (nextLineEl) {
      nextLineEl.textContent = idx + 1 < total ? `Next: ${this.tapSyncState.lines[idx + 1]}` : (idx < total ? 'Next: (End of song)' : '');
    }
    if (btnAction) {
      btnAction.textContent = idx < total ? `👉 Tap Line ${idx + 1} (Spacebar)` : '✅ Finish & Save Cues';
    }
  }

  tapNextLyricLine() {
    if (!this.tapSyncState || !this.tapSyncState.active) return;
    const idx = this.tapSyncState.currentIndex;
    const total = this.tapSyncState.lines.length;

    if (idx >= total) {
      this.finishTapToSync();
      return;
    }

    const currentSec = (this.videoStudio && this.videoStudio.getCurrentPreviewTime()) || this.getCurrentVideoTime() || 0;
    const mins = Math.floor(currentSec / 60);
    const secs = Math.floor(currentSec % 60);
    const hundredths = Math.floor((currentSec - Math.floor(currentSec)) * 100);
    const timestampTag = `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`;

    const stampedLine = `${timestampTag} ${this.tapSyncState.lines[idx]}`;
    this.tapSyncState.stamped.push(stampedLine);
    this.tapSyncState.currentIndex++;

    if (this.tapSyncState.currentIndex >= total) {
      this.finishTapToSync();
    } else {
      this.updateTapSyncUI();
    }
  }

  finishTapToSync(partial = false) {
    if (!this.tapSyncState) return;
    const total = this.tapSyncState.lines.length;
    const stampedCount = this.tapSyncState.stamped.length;

    let finalText = [...this.tapSyncState.stamped];
    if (stampedCount < total) {
      for (let i = stampedCount; i < total; i++) {
        finalText.push(this.tapSyncState.lines[i]);
      }
    }

    const outputString = finalText.join('\n');
    const textarea = document.getElementById('videoLyricsTextarea');
    if (textarea) textarea.value = outputString;

    const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
    this.videoStudio.setCustomLyrics(outputString, dur);

    const cuesBadge = document.getElementById('videoLyricCuesCount');
    if (cuesBadge) cuesBadge.textContent = `${this.videoStudio.lyricCues.length} cues`;

    const statusText = document.getElementById('videoLyricsStatusText');
    if (statusText) statusText.textContent = `Synced with exact timestamps (${stampedCount} stamped lines)`;

    this.cancelTapToSync(false);
    this.showToast(`Saved ${stampedCount} exact lyric timestamps!`, 'emerald');
    this.redrawStaticVideoPreview();
  }

  cancelTapToSync(showToastMsg = true) {
    if (this.tapSyncState) {
      this.tapSyncState.active = false;
      this.tapSyncState = null;
    }
    const panel = document.getElementById('tapSyncPanel');
    if (panel) panel.style.display = 'none';

    if (this._tapSyncKeyHandler) {
      window.removeEventListener('keydown', this._tapSyncKeyHandler);
      this._tapSyncKeyHandler = null;
    }

    if (showToastMsg) {
      this.showToast('Exited Tap-to-Sync mode.', 'slate');
    }
  }

  setVideoFps(fps) {
    if (!this.videoStudio) return;
    this.videoStudio.fps = Number(fps);
    this.saveVideoStudioSettings();
  }

  setVideoBitrate(mbps) {
    if (!this.videoStudio) return;
    this.videoStudio.bitrateMbps = Number(mbps);
    this.saveVideoStudioSettings();
  }

  async toggleVideoPreview() {
    if (!this.videoStudio || !this.activeStudioSong) return;
    const btn = document.getElementById('btnVideoLivePreview');
    const scrubber = document.getElementById('videoTimelineScrubber');
    const timeText = document.getElementById('videoTimelineTime');

    if (this.videoStudio.isPreviewing) {
      this.videoStudio.stop();
      if (btn) btn.textContent = '▶ Live Preview with Audio';
      this.redrawStaticVideoPreview();
      return;
    }

    if (btn) btn.textContent = '⏳ Loading Audio...';
    try {
      const { audioBuffer } = await this.getDecryptedAudio(this.activeStudioSong.uuid);
      const totalDur = audioBuffer.duration || this.activeStudioSong.duration || 180;
      const startOffset = this.getCurrentVideoTime();

      this.videoStudio.onPreviewEnded = () => {
        if (btn) btn.textContent = '▶ Live Preview with Audio';
        if (scrubber) scrubber.value = 0;
        if (timeText) timeText.textContent = `0:00 / ${this.formatTime(totalDur)}`;
      };

      this.videoStudio.startPreview(audioBuffer, this.activeStudioSong, startOffset, (elapsed, dur) => {
        if (scrubber && !this.isUserDraggingScrubber) {
          const ratio = Math.min(1, Math.max(0, elapsed / dur));
          scrubber.value = Math.round(ratio * 1000);
        }
        if (timeText) {
          timeText.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(dur)}`;
        }
      });
      if (btn) btn.textContent = '⏹ Stop Live Preview';
    } catch (e) {
      if (btn) btn.textContent = '▶ Live Preview with Audio';
      this.showToast(`Preview failed: ${e.message}`, 'rose');
    }
  }

  async renderAndExportVideo() {
    if (!this.videoStudio || !this.activeStudioSong) return;
    const uuid = this.activeStudioSong.uuid;
    const btn = document.getElementById('btnStartVideoRender');
    const previewBtn = document.getElementById('btnVideoLivePreview');
    const progressBox = document.getElementById('studioProgressBox');
    const progressBar = document.getElementById('studioProgressBar');
    const statusText = document.getElementById('studioStatusText');

    this.videoStudio.stop();
    if (previewBtn) previewBtn.textContent = '▶ Live Preview with Audio';
    if (btn) btn.disabled = true;
    if (progressBox) progressBox.style.display = 'flex';

    try {
      const { audioBuffer } = await this.getDecryptedAudio(uuid, (status) => {
        if (statusText) statusText.textContent = status;
      });

      const videoBlob = await this.videoStudio.exportVideo(
        audioBuffer,
        this.activeStudioSong,
        this.activeStudioSong.imageLarge,
        (pct, text) => {
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (statusText) statusText.textContent = text;
        }
      );

      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const filename = this.makeSafeFilename(this.activeStudioSong.title, ext);
      this.triggerDownload(videoBlob, filename);
      this.showToast(`Exported 1080p Karaoke Video: "${filename}"!`, 'emerald');
    } catch (e) {
      this.showToast(`Video rendering failed: ${e.message}`, 'rose');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* =========================================================================
     ARTWORK, LYRICS (.TXT / .LRC / .SRT) & DECK RENDERING
     ========================================================================= */

  async downloadCover(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song || !song.imageLarge) {
      this.showToast('No external cover artwork URL for this track.', 'amber');
      return;
    }

    try {
      const resp = await fetch(song.imageLarge);
      if (!resp.ok) throw new Error('Cover art fetch failed');
      const blob = await resp.blob();
      const filename = this.makeSafeFilename(song.title, 'jpeg');
      this.triggerDownload(blob, filename);
      this.showToast(`Downloaded Cover Art "${filename}"!`, 'emerald');
    } catch (e) {
      window.open(song.imageLarge, '_blank');
      this.showToast('Opened cover art in new tab!', 'amber');
    }
  }

  downloadLyrics(uuid, format = 'txt') {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    let content = '';
    let ext = 'txt';
    let label = 'Lyrics TXT';

    if (format === 'lrc') {
      content = LyricsUtils.toLrc(song, song.duration || 180);
      ext = 'lrc';
      label = 'Synchronized Karaoke LRC';
    } else if (format === 'srt') {
      content = LyricsUtils.toSrt(song, song.duration || 180);
      ext = 'srt';
      label = 'Video Subtitles SRT';
    } else {
      content = LyricsUtils.toTxt(song);
      ext = 'txt';
      label = 'Lyrics Sheet TXT';
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const filename = this.makeSafeFilename(`${song.title} - Lyrics`, ext);
    this.triggerDownload(blob, filename);
    this.showToast(`Downloaded ${label}: "${filename}"`, 'emerald');
  }

  async togglePlayAudio(uuid) {
    try {
      this.stopAllModalAudio();
      const { decryptedBuffer } = await this.getDecryptedAudio(uuid, (status) => {
        this.showToast(status, 'emerald');
      });

      const blob = new Blob([decryptedBuffer], { type: 'audio/mp4' });
      const canvasEl = document.getElementById(`wave-canvas-${uuid}`);
      await this.player.play(uuid, blob, 'master', canvasEl);
    } catch (e) {
      this.showToast(`Playback error: ${e.message}`, 'rose');
    }
  }

  renderSongs() {
    const container = document.getElementById('songsContainer');
    const countBadge = document.getElementById('songCountBadge');
    const songs = StorageManager.loadSongs();

    if (countBadge) countBadge.textContent = songs.length;
    if (!container) return;

    if (songs.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 2.75rem 1.5rem; border-style: dashed;">
          <div style="font-size: 2.4rem; margin-bottom: 0.65rem;">🎛️</div>
          <h3 style="font-size: 1.12rem; font-weight: 800; margin-bottom: 0.35rem;">Studio Deck Ready</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 520px; margin: 0 auto 1.25rem;">
            Paste one or multiple Suno links above to decrypt master audio, or import any local audio file to run Meta HTDemucs v4 4-Stem AI separation, Mastering FX, and 1080p Karaoke Video rendering.
          </p>
          <div style="display:flex;justify-content:center;gap:0.65rem;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="app.pasteAndResolveClipboard()">
              📋 Smart Clipboard Grab
            </button>
            <button class="btn btn-cyan btn-sm" onclick="document.getElementById('localAudioFileInput').click()">
              📂 Import Local Audio (.m4a / .mp3 / .wav)
            </button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = songs.map((song) => {
      const safeTitle = this.escapeHtml(song.title);
      const isLocal = String(song.uuid).startsWith('local-');
      const isOfficialEmbed = !isLocal && song.playerMode === 'suno';
      const cleanId = song.uuid.toLowerCase().trim();
      const hasVaultMaster = this.vaultSummary.masterIds.has(cleanId);
      const hasVaultStems = this.vaultSummary.stemIds.has(cleanId);
      const fallbackImg = 'assets/icon.svg';

      return `
        <article class="song-card" id="card-${song.uuid}">
          <!-- Main Info Row -->
          <div class="song-main-row">
            <div class="song-cover-container" onclick="app.downloadCover('${song.uuid}')" title="Click to download full-res artwork">
              <img
                src="${song.imageLarge || fallbackImg}"
                alt="${safeTitle}"
                class="song-cover-img"
                onerror="this.onerror=null;this.src='${isLocal ? fallbackImg : `https://cdn1.suno.ai/image_${song.uuid}.jpeg`}';"
              />
            </div>

            <div class="song-info">
              <div class="song-title-row">
                <input
                  type="text"
                  value="${safeTitle}"
                  onchange="app.renameSong('${song.uuid}', this.value)"
                  class="song-title-input"
                  title="Click to rename (updates exported filenames & ID3 tags)"
                />
                <button
                  onclick="app.removeSong('${song.uuid}')"
                  class="btn btn-ghost btn-sm"
                  title="Remove from deck"
                >
                  ✕
                </button>
              </div>

              <div class="song-meta-tags">
                <span class="tag-badge uuid">ID: ${this.escapeHtml(song.uuid.slice(0, 10))}</span>
                ${song.trackNumber ? `<span class="tag-badge" style="color:#bae6fd;border-color:rgba(56,189,248,0.3)">#${this.escapeHtml(song.trackNumber)}</span>` : ''}
                ${song.artist ? `<span class="tag-badge" style="color:#fde68a;border-color:rgba(245,158,11,0.3)">👤 ${this.escapeHtml(song.artist)}</span>` : ''}
                ${song.album ? `<span class="tag-badge" style="color:#a7f3d0;border-color:rgba(16,185,129,0.3)">💿 ${this.escapeHtml(song.album)}</span>` : ''}
                <span class="tag-badge model">${this.escapeHtml(song.model || 'Suno V3.5')}</span>
                ${hasVaultMaster ? `<span class="tag-badge vault-master" title="Decrypted master audio cached in IndexedDB Offline Vault">💾 Cached Offline</span>` : ''}
                ${hasVaultStems ? `<span class="tag-badge vault-stems" title="4 HTDemucs v4 neural stems cached & ready instantly">🎚️ 4 Stems Ready</span>` : ''}
                ${!isLocal ? `
                  <a
                    href="https://suno.com/song/${song.uuid}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="tag-badge"
                    style="text-decoration:none;color:var(--text-secondary)"
                  >
                    Suno Page ↗
                  </a>
                ` : ''}
              </div>

              ${song.prompt ? `
                <p class="song-lyrics-preview" title="${this.escapeHtml(song.prompt)}">
                  "${this.escapeHtml(song.prompt.slice(0, 180))}${song.prompt.length > 180 ? '...' : ''}"
                </p>
              ` : ''}
            </div>
          </div>

          <!-- Dual Player Container -->
          <div class="song-player-container">
            <div class="player-mode-tabs">
              <div class="player-tab-buttons">
                <button
                  class="player-tab-btn ${!isOfficialEmbed ? 'active' : ''}"
                  onclick="app.switchPlayerMode('${song.uuid}', 'custom')"
                >
                  ⚡ Studio Player (Waveform)
                </button>
                ${!isLocal ? `
                  <button
                    class="player-tab-btn ${isOfficialEmbed ? 'active' : ''}"
                    onclick="app.switchPlayerMode('${song.uuid}', 'suno')"
                  >
                    ▶ Official Suno Stream
                  </button>
                ` : ''}
              </div>
              <span style="font-size: 0.7rem; color: var(--text-muted)">${hasVaultMaster ? 'Instant Vault Stream' : 'High-Fidelity Stream'}</span>
            </div>

            ${!isOfficialEmbed ? `
              <div class="custom-audio-player">
                <div class="player-controls-row">
                  <button
                    id="btn-play-${song.uuid}"
                    class="btn-play-pause"
                    onclick="app.togglePlayAudio('${song.uuid}')"
                    title="Play / Pause"
                  >
                    ${this.player.currentSongUuid === song.uuid && this.player.isPlaying ? '❚❚' : '▶'}
                  </button>

                  <div class="waveform-scrubber">
                    <canvas
                      id="wave-canvas-${song.uuid}"
                      class="waveform-canvas"
                      width="500"
                      height="38"
                      onclick="app.handleScrubberClick('${song.uuid}', event)"
                    ></canvas>
                    <div class="player-time-row">
                      <span id="time-cur-${song.uuid}">0:00</span>
                      <span id="time-dur-${song.uuid}">${this.formatDuration(song.duration)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ` : `
              <div class="suno-iframe-wrapper">
                <iframe
                  src="https://suno.com/embed/${song.uuid}"
                  class="suno-iframe"
                  allow="autoplay; encrypted-media; fullscreen"
                  loading="lazy"
                ></iframe>
              </div>
            `}
          </div>

          <!-- Primary Studio Action Matrix (6 Cards) -->
          <div class="download-matrix">
            <button
              id="btn-m4a-${song.uuid}"
              class="dl-button-card primary"
              onclick="app.downloadM4a('${song.uuid}')"
              title="Download untouched AAC master stream"
            >
              <div class="dl-btn-format">
                <span>Master M4A</span>
                <span>⚡</span>
              </div>
              <span class="dl-btn-desc">Original Bit-Perfect</span>
            </button>

            <button
              id="btn-wav-${song.uuid}"
              class="dl-button-card"
              onclick="app.downloadWav('${song.uuid}')"
              title="Download lossless 16-bit Studio Master WAV"
            >
              <div class="dl-btn-format">
                <span>Studio WAV</span>
                <span>💎</span>
              </div>
              <span class="dl-btn-desc">Lossless 16-Bit PCM</span>
            </button>

            <button
              id="btn-mp3-${song.uuid}"
              class="dl-button-card"
              onclick="app.downloadMp3('${song.uuid}')"
              title="Download 320kbps MP3 with embedded Cover Art, Title, Genre & Lyrics"
            >
              <div class="dl-btn-format">
                <span>MP3 320k</span>
                <span>🏷️</span>
              </div>
              <span class="dl-btn-desc">ID3 + Art + Lyrics</span>
            </button>

            <button
              id="btn-stems-${song.uuid}"
              class="dl-button-card"
              style="background:rgba(6,182,212,0.13);border-color:rgba(6,182,212,0.38)"
              onclick="app.openStemsStudio('${song.uuid}')"
              title="Separate Vocals & Instrumental (2-Stem) or Full 4-Stem/5-Stem Studio Kit"
            >
              <div class="dl-btn-format">
                <span style="color:#67e8f9">2 / 4 Stem AI</span>
                <span>🎛️</span>
              </div>
              <span class="dl-btn-desc">Vocals + Stems</span>
            </button>

            <button
              id="btn-fx-${song.uuid}"
              class="dl-button-card fx"
              onclick="app.openTrimFxStudio('${song.uuid}')"
              title="Trim start/end, add fades, normalize, or apply Slowed+Reverb / Nightcore / Bass Boost"
            >
              <div class="dl-btn-format">
                <span style="color:#6ee7b7">Trim &amp; FX</span>
                <span>✂️</span>
              </div>
              <span class="dl-btn-desc">Master &amp; Presets</span>
            </button>

            <button
              id="btn-video-${song.uuid}"
              class="dl-button-card video"
              onclick="app.openVideoStudio('${song.uuid}')"
              title="Open 1080p Karaoke Lyrics & Visualizer Video Studio"
            >
              <div class="dl-btn-format">
                <span style="color:#c4b5fd">Video Studio</span>
                <span>🎬</span>
              </div>
              <span class="dl-btn-desc">1080p + Karaoke</span>
            </button>
          </div>

          <!-- Secondary Packaging, Subtitles & Artwork Bar -->
          <div class="song-secondary-actions">
            <div style="display:flex;gap:0.45rem;flex-wrap:wrap">
              <button
                id="btn-pack-${song.uuid}"
                class="btn btn-accent btn-sm"
                onclick="app.downloadSongPackZip('${song.uuid}')"
                title="Bundle M4A + Tagged 320k MP3 + Cover Art + TXT/LRC/SRT (+ Cached Stems) into one .ZIP"
              >
                📦 Complete Pack (.ZIP)
              </button>
              <button
                class="btn btn-cyan btn-sm"
                onclick="app.openMetaModal('${song.uuid}')"
                title="Edit Title, Artist, Album, Track Number, Year, Genre, Lyrics & Cover Art"
              >
                🏷️ Edit Tags
              </button>
              <button
                class="btn btn-secondary btn-sm"
                onclick="app.downloadCover('${song.uuid}')"
              >
                🖼 Artwork
              </button>
              <button
                class="btn btn-secondary btn-sm"
                onclick="app.downloadLyrics('${song.uuid}', 'txt')"
                title="Download plain text lyrics & metadata sheet"
              >
                📝 .TXT
              </button>
              <button
                class="btn btn-secondary btn-sm"
                onclick="app.downloadLyrics('${song.uuid}', 'lrc')"
                title="Download synchronized karaoke .LRC file"
              >
                🎤 .LRC
              </button>
              <button
                class="btn btn-secondary btn-sm"
                onclick="app.downloadLyrics('${song.uuid}', 'srt')"
                title="Download video subtitle .SRT captions"
              >
                💬 .SRT
              </button>
              ${!isLocal ? `
                <button
                  class="btn btn-secondary btn-sm"
                  onclick="app.openHelperModal('${song.uuid}')"
                >
                  🖥️ CLI
                </button>
              ` : ''}
            </div>

            <button
              class="btn btn-ghost btn-sm"
              onclick="app.toggleSongDetails('${song.uuid}')"
            >
              ${song.showDetails ? 'Hide Diagnostics' : 'Diagnostics'}
            </button>
          </div>

          ${song.showDetails ? `
            <div class="code-box" style="flex-direction:column;align-items:flex-start;gap:0.45rem">
              <div><strong>UUID:</strong> <code>${this.escapeHtml(song.uuid)}</code></div>
              ${song.streamUrl ? `<div><strong>CloudFront Stream:</strong> <a href="${this.escapeHtml(song.streamUrl)}" target="_blank" style="color:var(--accent-amber)">${this.escapeHtml(song.streamUrl)}</a></div>` : ''}
              ${song.imageLarge ? `<div><strong>Cover Art URL:</strong> <a href="${this.escapeHtml(song.imageLarge)}" target="_blank" style="color:var(--accent-amber)">${this.escapeHtml(song.imageLarge)}</a></div>` : ''}
              <div><strong>Offline Vault:</strong> Master=${hasVaultMaster ? 'Cached' : 'Not cached'} • 4-Track Stems=${hasVaultStems ? 'Cached' : 'Not cached'}</div>
            </div>
          ` : ''}
        </article>
      `;
    }).join('');
  }

  switchPlayerMode(uuid, mode) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;
    song.playerMode = mode;
    StorageManager.upsertSong(song);
    this.renderSongs();
  }

  toggleSongDetails(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;
    song.showDetails = !song.showDetails;
    StorageManager.upsertSong(song);
    this.renderSongs();
  }

  renameSong(uuid, newTitle) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;
    song.title = newTitle.trim() || song.title;
    StorageManager.upsertSong(song);
    this.showToast(`Renamed to "${song.title}"`, 'emerald');
  }

  async removeSong(uuid) {
    if (this.player.currentSongUuid === uuid) {
      this.player.pause();
    }
    StorageManager.removeSong(uuid);
    await VaultDB.deleteSongAssets(uuid);
    await this.refreshVaultSummary(false);
    this.renderSongs();
    this.showToast('Removed song from deck.', 'amber');
  }

  handleScrubberClick(uuid, event) {
    const canvas = document.getElementById(`wave-canvas-${uuid}`);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const dur = this.player.audioElement.duration || 0;
    if (dur > 0 && this.player.currentSongUuid === uuid) {
      this.player.seek(dur * ratio);
    }
  }

  openHelperModal(uuid = '') {
    const modal = document.getElementById('helperModal');
    if (!modal) return;
    modal.classList.add('open');

    const sampleUuid = uuid && !String(uuid).startsWith('local-')
      ? uuid
      : '<SONG_ID>';
    const cliEl = document.getElementById('helperCliCmd');
    if (cliEl) {
      cliEl.textContent = `python helper/suno_helper.py https://suno.com/song/${sampleUuid}`;
    }
  }

  setBtnLoading(btnId, isLoading, text = '') {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    if (isLoading) {
      if (!btn.dataset.origHtml) {
        btn.dataset.origHtml = btn.innerHTML;
      }
      btn.disabled = true;
      btn.innerHTML = `<span style="font-size:0.75rem">${this.escapeHtml(text)}</span>`;
    } else {
      btn.disabled = false;
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
    }
  }

  triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  makeSafeFilename(title, ext) {
    const clean = (title || 'Suno_Song')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 75) || 'Suno_Song';
    return `${clean}.${ext}`;
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatDuration(sec) {
    if (sec === undefined || sec === null || isNaN(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  showToast(message, color = 'emerald') {
    const box = document.getElementById('toastContainer');
    if (!box) return;

    const toast = document.createElement('div');
    toast.className = `toast ${color}`;
    toast.innerHTML = `<span>✨</span><span>${this.escapeHtml(message)}</span>`;
    box.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  }

  copyToClipboard(text, message = 'Copied to clipboard!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      this.showToast(message, 'emerald');
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      this.showToast(message, 'emerald');
    } catch (e) {}
    ta.remove();
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
}

window.app = new App();
window.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
