# NTK Hub • Suno Studio Edition

You can deploy this modular Suno AI audio, 4-stem neural separator, mastering FX, and 1080p karaoke video studio directly onto **GitHub Pages**, **Firebase Hosting**, **Cloudflare Pages**, **Netlify**, or **Vercel**.

---

## Key Capabilities

1. **Multi-Format Master Audio Exports**:
   - **Original Master (`.m4a`)**: Untouched AAC master stream decrypted in-browser via Web Crypto AES-GCM and AES-CTR.
   - **Studio WAV (`.wav`)**: Lossless 16-bit PCM RIFF audio.
   - **Tagged 320kbps MP3 (`.mp3`)**: High-bitrate MP3 encoded via bundled `lamejs` with automatic **ID3v2.3 metadata** (`TIT2` title, `TPE1` artist, `TALB` album, `TCON` style tags, `USLT` full lyrics, and `APIC` high-resolution front cover art).

2. **Hybrid Meta HTDemucs v4 4-Stem Neural AI & Console Mixer**:
   - Separates any song into 4 discrete neural tracks: **Vocals**, **Drums**, **Bass**, and **Other Melodies**, plus a clean **Full Instrumental** sum (`Drums + Bass + Other`) with zero vocal bleed.
   - **Tier 1 (Local Native AI)**: Runs PyTorch `htdemucs` via `helper/suno_helper.py` on port `8899`.
   - **Tier 2 (Pure Static Frontend AI)**: Runs `onnxruntime-web` (WebGPU + SIMD WASM) in the browser using `htdemucs_embedded.onnx` cached permanently inside `IndexedDB`.
   - **4-Track Synchronized Console**: Sample-locked playback with Mute (`M`), Solo (`S`), `0%` to `150%` volume faders, live peak level meters, quick presets (*Full Mix*, *Acapella*, *Karaoke*, *Drumless*, *Rhythm*), and custom mix bounce to WAV or MP3.

3. **Waveform Audio Trimmer & Mastering FX Studio**:
   - Interactive dual-handle (`IN` / `OUT`) waveform trimmer with configurable fade-in, fade-out, and `-0.5 dBFS` peak normalization.
   - Six `OfflineAudioContext` mastering chains: *Original Clean*, *Studio Master*, *Slowed + Reverb*, *Nightcore*, *808 Bass Boost*, and *Lo-Fi Radio*.

4. **Single-Click `.ZIP` Packaging & Batch Queue**:
   - **Complete Song Studio Pack (`.zip`)**: Bundles `.m4a`, ID3-tagged 320k `.mp3`, `Cover.jpg`, `.txt`, `.lrc`, `.srt`, and cached 4-track WAV stems.
   - **5-Stem Kit (`.zip`)**: Packages Vocals, Drums, Bass, Melodies, Full Instrumental, cover art, and lyrics.
   - **Batch Deck `.ZIP`**: Exports every track in your deck into a single archive.

5. **1080p Karaoke Video & Subtitle Studio**:
   - Renders 1080p (`1:1`, `9:16`, `16:9`) music videos with synchronized karaoke lyrics burn-in, 3 visualizer engines (*Bars*, *Neon Wave*, *Radial Ring*), and 4 color themes (*Sunset*, *Cyber*, *Emerald*, *Mono*).
   - Exports standalone `.TXT`, `.LRC` karaoke files, and `.SRT` video captions.

6. **Installable PWA & IndexedDB Offline Vault**:
   - Ships with `manifest.json`, `sw.js`, and `SunoStudioVaultDB` (`IndexedDB`) to persist decrypted masters, separated 4-stem WAVs, and ONNX weights across reloads.

---

## Project Architecture

```
working/
├── index.html                 # Studio application shell
├── manifest.json              # PWA installation manifest
├── sw.js                      # Offline app-shell service worker
├── assets/
│   └── icon.svg               # Vector PWA studio icon
├── css/
│   ├── style.css              # Design tokens, variables & typography
│   ├── components.css         # Cards, 4-stem console, trimmer & FX styles
│   ├── player.css             # Waveform seeker & dual player styles
│   └── visualizer.css         # Karaoke Video Studio styles
├── js/
│   ├── app.js                 # Main studio orchestrator
│   ├── suno-api.js            # URL parsing, metadata & rights resolver
│   ├── crypto-engine.js       # Web Crypto AES-GCM & AES-CTR decryption
│   ├── audio-converter.js     # Resampling, WAV encoding, stem summing & peaks
│   ├── mp3-encoder.js         # 320kbps MP3 encoder via lamejs
│   ├── id3-writer.js          # Binary ID3v2.3 metadata & APIC cover art writer
│   ├── lyrics-utils.js        # Timed cue parser & TXT / LRC / SRT exporters
│   ├── vault-db.js            # IndexedDB persistence for audio, stems & AI models
│   ├── stem-engine.js         # Hybrid HTDemucs v4 separator (PyTorch + WebGPU ONNX)
│   ├── stem-mixer.js          # 4-track synchronized Web Audio console mixer
│   ├── audio-fx.js            # OfflineAudioContext trimmer & 6 mastering presets
│   ├── zip-packager.js        # Multi-file ZIP builder via JSZip
│   ├── video-generator.js     # 1080p karaoke visualizer & MediaRecorder engine
│   ├── player.js              # Deck audio player & live spectrum bar
│   ├── bookmarklet.js         # In-page Suno decryptor HUD & Studio launcher
│   └── storage.js             # LocalStorage deck & JSON session manager
├── lib/
│   ├── lame.all.js            # Bundled pure-JS MP3 encoder
│   ├── jszip.min.js           # Bundled pure-JS ZIP packager
│   └── demucs-web/            # Bundled HTDemucs STFT/iSTFT ONNX processor
└── helper/
    ├── suno_helper.py         # Multi-threaded local proxy + PyTorch HTDemucs server
    └── requirements.txt       # Optional local Python dependencies
```

---

## Running Locally

1. Start the local server (enables 1-click Mango DRM proxy and local PyTorch `htdemucs` separation):
   ```bash
   python helper/suno_helper.py --serve --port 8899 --dir .
   ```
2. Open `http://127.0.0.1:8899/` in your browser.

---

## Deploying to Static Hosting

Copy the contents of `completed/` (mirrored from `working/`) to any static host:
- **GitHub Pages**: Push to `main` and select **GitHub Actions** under **Settings > Pages** (`.github/workflows/deploy.yml` is included).
- **Firebase Hosting**: Run `firebase deploy --only hosting`.
- **Cloudflare Pages / Netlify / Vercel**: Set build command to empty and publish directory to `.`.
