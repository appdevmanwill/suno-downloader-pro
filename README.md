# NTK OmniStream Studio · Universal Media & Neural Stem Separator

Deploy this universal multi-platform media downloader, video demuxer, 2-stem and 4-stem neural stem separator, mastering FX, and 1080p karaoke video studio directly to **Firebase Hosting**, **GitHub Pages**, **Cloudflare Pages**, **Netlify**, or **Vercel**.

---

## Key Capabilities

1. **Universal Stream Link Extractor (1,000+ Platforms)**:
   - Catch streams from **YouTube**, **TikTok**, **SoundCloud**, **Suno AI**, **Instagram**, **Twitter/X**, **Bandcamp**, and **direct media URLs**.
   - Dual-engine resolver: runs native browser fetch for CORS-open media, or offloads to local `helper/omni_helper.py` (`yt-dlp` engine).
   - Fast **Data-Saver Audio-Only Mode**: grabs pristine Opus/M4A/AAC streams directly to save bandwidth.
   - **Session Cookie Vault**: import Netscape cookies to access private playlists, age-restricted videos, and members-only audio.

2. **In-Browser Video & Audio Demuxer**:
   - Drag and drop local video (`.mp4`, `.mov`, `.mkv`, `.webm`) or audio files (`.mp3`, `.wav`, `.flac`, `.m4a`, `.ogg`).
   - Pure client-side demuxing extracts high-resolution poster artwork frames and renders full lossless audio into the Web Audio API without uploading your files to any external server.

3. **Selectable 2-Stem & 4-Stem Neural AI Separator (Meta HTDemucs v4)**:
   - Choose your separation mode directly from the console:
     - **2-Stem (Vocal + Instrumental)**: fast split into crisp Acapella and pristine Instrumental backing track with zero bleed.
     - **4-Stem (Full Band)**: discrete separation of Vocals, Drums, Bass, and Other Melodies.
     - **Vocal Demix (Acapella Solo)**: isolates pure vocal lead.
     - **5-Stem Kit**: includes all 4 discrete stems plus the full instrumental master track.
   - **Tier 1 (Native Local PyTorch)**: hardware-accelerated separation on port `8899` with multi-core CPU and GPU support.
   - **Tier 2 (Browser WebGPU / ONNX)**: client-side fallback running `htdemucs_embedded.onnx` cached inside IndexedDB.
   - **Console Mixer**: sample-locked 5-track mixer with Mute (`M`), Solo (`S`), volume faders (`0%` to `150%`), peak meters, quick presets, and live custom mix bounce.

4. **Multi-Format Master Audio Exports**:
   - **Tagged 320kbps MP3 (`.mp3`)**: encoded in-browser with bundled `lamejs` and complete **ID3v2.3 tags** (Title, Artist, Album, Genre, Year, Lyrics, and Front Cover Artwork).
   - **Studio WAV (`.wav`)**: uncompressed 16-bit PCM RIFF audio.
   - **FLAC & M4A**: pristine high-fidelity audio streams.
   - **2-Stem & 5-Stem Kit ZIPs**: export separated stems packaged with artwork and lyrics in one click.

5. **Waveform Trimmer & Mastering FX Studio**:
   - Dual-handle waveform trimmer with customizable fade-in, fade-out, and `-0.5 dBFS` peak normalization.
   - Six mastering FX presets: *Studio Master*, *Slowed + Reverb*, *Nightcore*, *808 Bass Boost*, *Lo-Fi Radio*, and *Clean*.

6. **1080p Karaoke Video & Visualizer Studio**:
   - Render 1080p videos in `16:9` widescreen, `9:16` vertical TikTok/Reels, or `1:1` square.
   - Three animated visualizers: *Frequency Bars*, *Neon Wave*, and *Radial Ring*.
   - Four color themes: *Sunset Glow*, *Cyber Neon*, *Emerald Beat*, and *Monochrome Studio*.
   - Standalone `.TXT`, `.LRC`, and `.SRT` subtitle export.

7. **IndexedDB Offline Storage Vault**:
   - Persists master streams, separated stems, and AI model weights across sessions.
   - Granular vault manager lets you inspect disk usage in MB/GB, clear stems, or clear master audio streams.

---

## Directory Structure

```
working/
├── index.html                 # NTK OmniStream Studio UI shell
├── manifest.json              # PWA manifest
├── sw.js                      # Service worker with offline caching
├── assets/
│   └── icon.svg               # Vector PWA icon
├── css/
│   ├── style.css              # Design tokens and typography
│   ├── components.css         # UI cards, platform badges, stem console, trimmer & FX
│   ├── player.css             # Waveform seeker and player layout
│   └── visualizer.css         # Canvas visualizer animations
├── js/
│   ├── app.js                 # Application controller and event bus
│   ├── omni-api.js            # Universal stream classifier and yt-dlp helper client
│   ├── video-demuxer.js       # Client-side video to audio + poster frame extractor
│   ├── stem-engine.js         # Meta HTDemucs v4 coordinator (local PyTorch & WebGPU ONNX)
│   ├── stem-mixer.js          # Synchronized 5-track audio console mixer
│   ├── vault-db.js            # IndexedDB Offline Storage Vault (v2)
│   ├── suno-api.js            # Suno playlist/song resolver
│   ├── crypto-engine.js       # Web Crypto AES-GCM and AES-CTR decryptor
│   ├── mp3-encoder.js         # Client-side MP3 320kbps encoder
│   ├── id3-writer.js          # Binary ID3v2.3 tagger with APIC artwork
│   ├── audio-fx.js            # Web Audio mastering FX chains
│   ├── audio-converter.js     # WAV encoder and normalization
│   ├── video-generator.js     # 1080p Canvas karaoke video renderer
│   ├── lyrics-utils.js        # LRC, SRT, and TXT parsing
│   ├── zip-packager.js        # Multi-file ZIP archiver
│   └── player.js              # Dual-deck audio player
└── helper/
    ├── omni_helper.py         # Universal yt-dlp resolver + PyTorch HTDemucs v4 server
    ├── requirements.txt       # Python dependencies
    └── test_helper.py         # Automated helper test suite
```

---

## Local Python OmniHelper Server (Optional)

To enable universal downloading from YouTube, TikTok, SoundCloud, Instagram, and age-restricted links:

```bash
cd helper
pip install -r requirements.txt
python omni_helper.py --serve --port 8899
```

Open `http://localhost:8899` or your deployed Firebase URL in your browser. OmniStream Studio will automatically detect the local helper on port `8899` and route stream downloads through it.

---

## License & Credits

Built for NTK Hub. Powered by Meta HTDemucs v4, yt-dlp, FFmpeg, lamejs, and JSZip.
