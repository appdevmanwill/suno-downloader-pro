/**
 * Suno Downloader Pro - Main Application Orchestrator
 * 2026 Studio Edition (HTDemucs v4 4-Stem Neural AI, Trimmer & FX, ID3v2.3, ZIP, Karaoke Video & PWA Vault)
 */

import { SunoAPI } from './suno-api.js?v=2026.2';
import { CryptoEngine } from './crypto-engine.js?v=2026.2';
import { AudioConverter } from './audio-converter.js?v=2026.2';
import { Mp3Encoder } from './mp3-encoder.js?v=2026.2';
import { ID3Writer } from './id3-writer.js?v=2026.2';
import { LyricsUtils } from './lyrics-utils.js?v=2026.2';
import { VaultDB } from './vault-db.js?v=2026.2';
import { StemEngine } from './stem-engine.js?v=2026.2';
import { StemMixer } from './stem-mixer.js?v=2026.2';
import { AudioFXEngine } from './audio-fx.js?v=2026.2';
import { ZipPackager } from './zip-packager.js?v=2026.2';
import { VideoGenerator } from './video-generator.js?v=2026.2';
import { BookmarkletEngine } from './bookmarklet.js?v=2026.2';
import { StorageManager } from './storage.js?v=2026.2';
import { PlayerEngine } from './player.js?v=2026.2';

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
      const existing = StorageManager.loadSongs().find((s) => s.uuid === uuid);
      if (!existing) {
        const meta = await SunoAPI.fetchMetadata(uuid);
        meta.playerMode = 'custom';
        meta.hasStem = true;
        StorageManager.upsertSong(meta);
        this.renderSongs();
      }

      // Clean query params without reload
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
      this.showToast('Paste one or more Suno song links or UUIDs first.', 'amber');
      inputArea.focus();
      return;
    }

    const uuids = SunoAPI.extractUuids(text);
    if (uuids.length === 0) {
      this.showToast('No valid Suno song URL or UUID found (e.g. suno.com/song/...).', 'rose');
      return;
    }

    this.showToast(`Resolving ${uuids.length} song(s)...`, 'emerald');
    inputArea.value = '';

    for (const uuid of uuids) {
      const meta = await SunoAPI.fetchMetadata(uuid);
      meta.playerMode = 'custom';
      meta.hasStem = true;
      StorageManager.upsertSong(meta);
    }

    this.renderSongs();
    this.showToast(`Added ${uuids.length} song(s) to your studio deck!`, 'emerald');
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
    let rights = null;
    try {
      rights = await SunoAPI.fetchRights(uuid);
    } catch (err) {
      this.openHelperModal(uuid);
      throw err;
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
        genre: song.tags,
        lyrics: song.prompt,
        coverUrl: song.imageLarge
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
      this.syncStemConsoleControls('full');

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

    for (const k of StemMixer.TRACK_KEYS) {
      const st = this.stemMixer.state[k];
      const muteBtn = document.getElementById(`stem-mute-${k}`);
      const soloBtn = document.getElementById(`stem-solo-${k}`);
      const fader = document.getElementById(`stem-fader-${k}`);
      const gainLbl = document.getElementById(`stem-gain-${k}`);
      const strip = document.getElementById(`stem-strip-${k}`);

      if (muteBtn) muteBtn.classList.toggle('active', st.muted);
      if (soloBtn) soloBtn.classList.toggle('active', st.solo);
      if (fader) fader.value = String(Math.round(st.volume * 100));
      if (gainLbl) gainLbl.textContent = `${Math.round(st.volume * 100)}%`;
      if (strip) strip.classList.toggle('is-muted', effGains[k] === 0);
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

    for (const k of StemMixer.TRACK_KEYS) {
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
          genre: song.tags,
          lyrics: type === 'vocals' ? song.prompt : '',
          coverUrl: song.imageLarge
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

  async downloadAllStemsZip(format = 'wav') {
    if (!this.activeStemsSong) return;
    const song = this.activeStemsSong;
    const cached = StorageManager.getCachedBuffer(song.uuid);
    if (!cached || !cached.stems) return;

    const btnId = format === 'wav' ? 'btnStemsZipWav' : 'btnStemsZipMp3';
    this.setBtnLoading(btnId, true, 'Packaging 0%...');

    try {
      const zipBlob = await ZipPackager.buildStemsZip(song, cached.stems, format, (pct, msg) => {
        this.setBtnLoading(btnId, true, `${pct}% ${msg.slice(0, 18)}...`);
      });
      const filename = this.makeSafeFilename(`${song.title} - 5 Stems Kit (${format.toUpperCase()})`, 'zip');
      this.triggerDownload(zipBlob, filename);
      this.showToast(`Downloaded 5-Stem Kit .ZIP: "${filename}"!`, 'emerald');
    } catch (e) {
      this.showToast(`Stems ZIP failed: ${e.message}`, 'rose');
    } finally {
      this.setBtnLoading(btnId, false);
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

  async openVideoStudio(uuid) {
    const song = StorageManager.loadSongs().find((s) => s.uuid === uuid);
    if (!song) return;

    this.player.pause();
    this.stopAllModalAudio();
    this.activeStudioSong = song;

    const modal = document.getElementById('videoStudioModal');
    if (!modal) return;
    modal.classList.add('open');

    const titleEl = document.getElementById('studioSongTitle');
    if (titleEl) titleEl.textContent = `Karaoke Video Studio: ${song.title}`;

    const showLyrics = document.getElementById('chkVideoLyrics')?.checked !== false;
    const canvas = document.getElementById('studioCanvas');

    this.videoStudio = new VideoGenerator({
      canvas,
      aspectRatio: '1:1',
      visualStyle: 'bars',
      theme: 'sunset',
      showLyrics,
      songMeta: song
    });

    // Reset button active states
    document.querySelectorAll('.ratio-btn').forEach((b) => b.classList.toggle('active', b.dataset.ratio === '1:1'));
    document.querySelectorAll('.style-btn').forEach((b) => b.classList.toggle('active', b.dataset.vstyle === 'bars'));
    document.querySelectorAll('.theme-swatch-btn').forEach((b) => b.classList.toggle('active', b.dataset.vtheme === 'sunset'));
    const container = document.getElementById('canvasContainer');
    if (container) container.className = 'canvas-container ratio-1-1';

    this.videoStudio.setSongMeta(song, song.duration || 180);
    this.videoStudio.updateCanvasDimensions();
    await this.videoStudio.loadCoverImage(song.imageLarge);
    this.redrawStaticVideoPreview();
  }

  redrawStaticVideoPreview() {
    if (!this.videoStudio) return;
    const demoSpectrum = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
      demoSpectrum[i] = Math.round(90 + Math.sin(i * 0.25) * 65 + Math.cos(i * 0.11) * 40);
    }
    const dur = (this.activeStudioSong && this.activeStudioSong.duration) || 180;
    this.videoStudio.drawFrame(demoSpectrum, Math.min(12, dur * 0.12), dur);
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
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  setVideoStyle(style) {
    if (!this.videoStudio) return;
    this.videoStudio.visualStyle = style;
    document.querySelectorAll('.style-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.vstyle === style);
    });
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  setVideoTheme(theme) {
    if (!this.videoStudio) return;
    this.videoStudio.theme = theme;
    document.querySelectorAll('.theme-swatch-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.vtheme === theme);
    });
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  toggleVideoLyrics(checked) {
    if (!this.videoStudio) return;
    this.videoStudio.showLyrics = Boolean(checked);
    if (!this.videoStudio.isPreviewing && !this.videoStudio.isRecording) {
      this.redrawStaticVideoPreview();
    }
  }

  async toggleVideoPreview() {
    if (!this.videoStudio || !this.activeStudioSong) return;
    const btn = document.getElementById('btnVideoLivePreview');

    if (this.videoStudio.isPreviewing) {
      this.videoStudio.stop();
      if (btn) btn.textContent = '▶ Live Preview with Audio';
      this.redrawStaticVideoPreview();
      return;
    }

    if (btn) btn.textContent = '⏳ Loading Audio...';
    try {
      const { audioBuffer } = await this.getDecryptedAudio(this.activeStudioSong.uuid);
      this.videoStudio.startPreview(audioBuffer, this.activeStudioSong);
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
              title="Separate Vocals, Drums, Bass & Melodies with Meta HTDemucs v4 Neural AI"
            >
              <div class="dl-btn-format">
                <span style="color:#67e8f9">4-Stem AI</span>
                <span>🎛️</span>
              </div>
              <span class="dl-btn-desc">HTDemucs v4 Mixer</span>
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
}

window.app = new App();
window.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
