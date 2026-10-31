#!/usr/bin/env python3
"""
Suno Downloader Pro - Python Helper & Local Server
Features:
- Serves the frontend web app on http://127.0.0.1:8899
- Active Mango DRM proxy with full CORS support (/api/mango/rights)
- Command line batch downloader: M4A, WAV, MP3, Stems, Video, Artwork
"""

import sys
import os
import re
import json
import base64
import hashlib
import argparse
import io
import wave
import time
import uuid as uuid_lib
import threading
import urllib.request
import urllib.parse
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
except ImportError:
    print("[!] 'cryptography' library is required. Install via: pip install cryptography")
    sys.exit(1)

UUID_REGEX = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
PLAYLIST_URL_REGEX = re.compile(r'/playlist/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', re.I)


def extract_uuid(input_str: str) -> str:
    match = UUID_REGEX.search(input_str)
    if not match:
        raise ValueError(f"Could not find a valid Suno UUID in: {input_str}")
    return match.group(0).lower()


def is_playlist_input(input_str: str) -> bool:
    return '/playlist/' in input_str.lower()


def fetch_playlist(playlist_uuid: str) -> dict:
    page = 1
    all_clips = []
    clean_uuid = extract_uuid(playlist_uuid)
    playlist_meta = {
        'id': clean_uuid,
        'name': f"Suno_Playlist_{clean_uuid[:8]}",
        'description': '',
        'image_url': '',
        'num_total_results': 0,
        'clips': []
    }

    while True:
        url = f"https://studio-api.prod.suno.com/api/playlist/{clean_uuid}/?page={page}"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if page == 1:
                    playlist_meta['name'] = data.get('name') or playlist_meta['name']
                    playlist_meta['description'] = data.get('description') or ''
                    playlist_meta['image_url'] = data.get('image_url') or ''
                    playlist_meta['num_total_results'] = data.get('num_total_results') or 0

                raw_clips = data.get('playlist_clips', [])
                if not raw_clips:
                    break

                for item in raw_clips:
                    c = item.get('clip') or {}
                    cid = c.get('id')
                    if cid:
                        cid_clean = cid.lower().strip()
                        all_clips.append({
                            'uuid': cid_clean,
                            'title': c.get('title') or f"Suno_Song_{cid_clean[:8]}",
                            'imageLarge': c.get('image_large_url') or f"https://cdn2.suno.ai/image_large_{cid_clean}.jpeg",
                            'imageThumb': c.get('image_url') or f"https://cdn1.suno.ai/image_{cid_clean}.jpeg",
                            'videoUrl': c.get('video_url') or f"https://cdn1.suno.ai/{cid_clean}.mp4",
                            'duration': c.get('duration') or 0,
                            'prompt': (c.get('metadata') or {}).get('prompt') or '',
                            'tags': (c.get('metadata') or {}).get('tags') or '',
                            'streamUrl': f"https://d2lwuy8qc234o3.cloudfront.net/1/clip/{cid_clean}.m4a",
                            'sunoUrl': f"https://suno.com/song/{cid_clean}",
                            'model': c.get('model_name') or 'chirp-v3.5',
                            'playerMode': 'custom',
                            'hasStem': True
                        })

                num_total = playlist_meta['num_total_results']
                if num_total > 0 and len(all_clips) >= num_total:
                    break
                if len(raw_clips) < 20 or not data.get('next_cursor'):
                    if num_total == 0 or len(all_clips) >= num_total:
                        break
                page += 1
                if page > 50:
                    break
        except Exception as exc:
            print(f"[!] Error reading playlist page {page}: {exc}")
            break

    seen = set()
    deduped = []
    for cl in all_clips:
        if cl['uuid'] not in seen:
            seen.add(cl['uuid'])
            deduped.append(cl)

    playlist_meta['clips'] = deduped
    playlist_meta['num_total_results'] = max(playlist_meta['num_total_results'], len(deduped))
    return playlist_meta


def fetch_metadata(uuid: str) -> dict:
    meta = {
        'uuid': uuid,
        'title': f"Suno_Song_{uuid[:8]}",
        'artist': 'Suno AI Studio',
        'image': f"https://cdn2.suno.ai/image_large_{uuid}.jpeg",
        'image_large_url': f"https://cdn2.suno.ai/image_large_{uuid}.jpeg",
        'image_url': f"https://cdn1.suno.ai/image_{uuid}.jpeg",
        'video_url': f"https://cdn1.suno.ai/{uuid}.mp4",
        'prompt': '',
        'tags': '',
        'duration': 180,
        'model': 'chirp-v3.5',
        'stream_url': f"https://d2lwuy8qc234o3.cloudfront.net/1/clip/{uuid}.m4a"
    }

    # Strategy 1: Fetch Suno web page and parse React Server Component stream + OpenGraph
    try:
        page_url = f"https://suno.com/song/{uuid}"
        req = urllib.request.Request(page_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        })
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode('utf-8', errors='ignore')

            # 1. Title
            m_title = re.search(r'(?:\\\"|\")title(?:\\\"|\"):\s*(?:\\\"|\")([^\"\\]+)(?:\\\"|\")', html)
            if not m_title or m_title.group(1).lower() in ['suno', 'get the full app experience']:
                m_title = re.search(r'<meta\s+property=\"og:title\"\s+content=\"([^\"]+)\"', html)
            if not m_title or m_title.group(1).lower() in ['suno', 'get the full app experience']:
                m_title = re.search(r'<title>(.*?)(?:\s+by\s+.*?)?\s*\|\s*Suno</title>', html, re.I)
            if m_title and m_title.group(1).lower() not in ['suno', 'get the full app experience']:
                meta['title'] = m_title.group(1).strip()

            # 2. Artist
            m_artist = re.search(r'(?:\\\"|\")display_name(?:\\\"|\"):\s*(?:\\\"|\")([^\"\\]+)(?:\\\"|\")', html)
            if not m_artist:
                m_artist = re.search(r'<meta\s+name=\"description\"\s+content=\"[^\"]*?\s+by\s+([^(@]+)', html, re.I)
            if m_artist:
                meta['artist'] = m_artist.group(1).strip()

            # 3. Tags / Style
            m_tags = re.search(r'(?:\\\"|\")tags(?:\\\"|\"):\s*(?:\\\"|\")([^\"\\]+)(?:\\\"|\")', html)
            if m_tags:
                meta['tags'] = m_tags.group(1).encode('utf-8').decode('unicode_escape', errors='ignore').strip()

            # 4. Duration
            m_dur = re.search(r'(?:\\\"|\")duration(?:\\\"|\"):\s*([0-9.]+)', html)
            if m_dur:
                meta['duration'] = int(float(m_dur.group(1)))

            # 5. Image
            m_img = re.search(r'(?:\\\"|\")image_large_url(?:\\\"|\"):\s*(?:\\\"|\")([^\"\\]+)(?:\\\"|\")', html)
            if not m_img:
                m_img = re.search(r'<meta\s+property=\"og:image\"\s+content=\"([^\"]+)\"', html)
            if m_img:
                meta['image'] = m_img.group(1).strip()
                meta['image_large_url'] = meta['image']

            # 6. Model
            m_model = re.search(r'(?:\\\"|\")model_name(?:\\\"|\"):\s*(?:\\\"|\")([^\"\\]+)(?:\\\"|\")', html)
            if m_model:
                meta['model'] = m_model.group(1).strip()

            # 7. Prompt / Full Lyrics (Suno Next.js RSC pointer: "prompt":"$cf")
            m_prompt_ref = re.search(r'(?:\\\"|\")prompt(?:\\\"|\"):\s*(?:\\\"|\")\$([a-zA-Z0-9_-]+)(?:\\\"|\")', html)
            if m_prompt_ref:
                ref_id = m_prompt_ref.group(1)
                pattern = re.compile(rf'(?:\\n|\n){re.escape(ref_id)}:T([0-9a-fA-F]+),(.*)', re.DOTALL)
                m_ref_chunk = pattern.search(html)
                if m_ref_chunk:
                    try:
                        hex_len = int(m_ref_chunk.group(1), 16)
                        content = m_ref_chunk.group(2)[:hex_len]
                        meta['prompt'] = content.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\').strip()
                    except Exception:
                        pass

            # Fallback to direct prompt string
            if not meta['prompt']:
                m_direct_prompt = re.search(r'(?:\\\"|\")prompt(?:\\\"|\"):\s*(?:\\\"|\")((?:(?!\$)[^\"\\]|\\.)*)(?:\\\"|\")', html, re.DOTALL)
                if m_direct_prompt and len(m_direct_prompt.group(1)) > 5:
                    meta['prompt'] = m_direct_prompt.group(1).replace('\\n', '\n').replace('\\"', '"').strip()

            # Fallback to verse/chorus lyrics block
            if not meta['prompt']:
                m_lyrics_block = re.search(r'(\[(?:Verse|Chorus|Intro|Bridge|Outro)[^\]]*\].*?)(?=(?:\\n|\n)[a-zA-Z0-9_-]+:|\"\]|<\/div>|$)', html, re.DOTALL)
                if m_lyrics_block:
                    meta['prompt'] = m_lyrics_block.group(1).replace('\\n', '\n').replace('\\"', '"').strip()

            if meta['title'] != f"Suno_Song_{uuid[:8]}":
                return meta
    except Exception:
        pass

    # Strategy 2: Legacy Studio API fallback
    url = f"https://studio-api.prod.suno.com/api/clip/{uuid}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('title'): meta['title'] = data['title']
            if data.get('image_large_url'): meta['image'] = data['image_large_url']
            if data.get('video_url'): meta['video_url'] = data['video_url']
            if data.get('duration'): meta['duration'] = data['duration']
            m = data.get('metadata') or {}
            if m.get('prompt'): meta['prompt'] = m['prompt']
            if m.get('tags'): meta['tags'] = m['tags']
            return meta
    except Exception:
        pass

    return meta


def fetch_rights(uuid: str) -> dict:
    url = "https://studio-api.prod.suno.com/api/mango/rights"
    payload = json.dumps({
        "content_params": {
            "content_id": uuid,
            "content_type": "clip"
        }
    }).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        return json.loads(resp.read().decode('utf-8'))


def unwrap_gcm(master_key: bytes, enc_b64: str, aad_str: str) -> bytes:
    raw = base64.b64decode(enc_b64)
    iv = raw[:12]
    tag = raw[-16:]
    ciphertext = raw[12:-16]
    decryptor = Cipher(
        algorithms.AES(master_key),
        modes.GCM(iv, tag),
        backend=default_backend()
    ).decryptor()
    decryptor.authenticate_additional_data(aad_str.encode('utf-8'))
    return decryptor.update(ciphertext) + decryptor.finalize()


def download_and_decrypt(uuid: str, output_dir: str = ".") -> str:
    os.makedirs(output_dir, exist_ok=True)
    print(f"[*] Resolving song: {uuid}")
    meta = fetch_metadata(uuid)
    safe_title = re.sub(r'[<>:"/\\|?*\x00-\x1F]', '', meta['title']).strip()[:60] or f"Suno_Song_{uuid[:8]}"
    print(f"[*] Title: {safe_title}")

    print("[*] Requesting Mango DRM playback rights...")
    rights = fetch_rights(uuid)

    master_key = hashlib.sha256(rights['glt'].encode('utf-8')).digest()
    content_key = unwrap_gcm(master_key, rights['key'], uuid)
    content_iv = unwrap_gcm(master_key, rights['iv'], uuid)

    stream_url = f"https://d2lwuy8qc234o3.cloudfront.net/1/clip/{uuid}.m4a"
    print(f"[*] Downloading stream from CloudFront...")
    req = urllib.request.Request(stream_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        encrypted_bytes = resp.read()

    print(f"[*] Downloaded {len(encrypted_bytes) / 1024 / 1024:.2f} MB. Decrypting AES-CTR...")
    cipher = Cipher(
        algorithms.AES(content_key),
        modes.CTR(content_iv),
        backend=default_backend()
    )
    decryptor = cipher.decryptor()
    decrypted_bytes = decryptor.update(encrypted_bytes) + decryptor.finalize()

    out_file = os.path.join(output_dir, f"{safe_title}.m4a")
    with open(out_file, 'wb') as f:
        f.write(decrypted_bytes)

    print(f"[+] SUCCESS! Decrypted audio saved to: {out_file}")

    # Also download cover image
    try:
        img_url = meta['image']
        img_file = os.path.join(output_dir, f"{safe_title}.jpeg")
        req_img = urllib.request.Request(img_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req_img, timeout=10) as r_img:
            with open(img_file, 'wb') as f_img:
                f_img.write(r_img.read())
        print(f"[+] Saved cover art to: {img_file}")
    except Exception:
        pass

    return out_file


# =====================================================================
# NEURAL 4-STEM SEPARATION ENGINE (META HTDEMUCS V4)
# =====================================================================

_DEMUCS_LOCK = threading.Lock()
_DEMUCS_MODEL = None
_DEMUCS_DEVICE = "cpu"
_STEM_JOBS = {}  # job_id -> dict(status, progress, stage, stems, error, created_at)


def check_demucs_available() -> dict:
    try:
        import torch
        import demucs  # noqa: F401
        import numpy  # noqa: F401
        device = "cuda" if torch.cuda.is_available() else "cpu"
        return {
            "available": True,
            "engine": "htdemucs-v4",
            "device": device,
            "stems": ["vocals", "drums", "bass", "other", "lead_vocals", "backing_vocals"],
            "supports_vocal_split": True
        }
    except Exception as exc:
        return {
            "available": False,
            "engine": "none",
            "device": "none",
            "error": str(exc),
            "supports_vocal_split": False
        }


def get_demucs_model():
    global _DEMUCS_MODEL, _DEMUCS_DEVICE
    with _DEMUCS_LOCK:
        if _DEMUCS_MODEL is None:
            import torch
            from demucs.pretrained import get_model
            _DEMUCS_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
            model = get_model("htdemucs")
            model.to(_DEMUCS_DEVICE)
            model.eval()
            _DEMUCS_MODEL = model
        return _DEMUCS_MODEL, _DEMUCS_DEVICE


def decode_wav_bytes_to_stereo_float32(wav_bytes: bytes):
    """Decodes 16-bit/24-bit/32-bit PCM WAV bytes into float32 numpy array (2, N) and sample_rate."""
    import numpy as np
    from scipy.io import wavfile

    sr, data = wavfile.read(io.BytesIO(wav_bytes))
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        audio = data.astype(np.float32) / 2147483648.0
    elif data.dtype == np.uint8:
        audio = (data.astype(np.float32) - 128.0) / 128.0
    else:
        audio = data.astype(np.float32)

    if audio.ndim == 1:
        audio = np.stack([audio, audio], axis=0)
    else:
        # Take first 2 channels and transpose (N, C) -> (2, N)
        if audio.shape[1] == 1:
            audio = np.concatenate([audio, audio], axis=1)
        audio = audio[:, :2].T

    return sr, np.ascontiguousarray(audio, dtype=np.float32)


def encode_stereo_float32_to_wav_bytes(stereo_arr, sample_rate: int = 44100) -> bytes:
    """Encodes (2, N) float32 array in [-1, 1] into 16-bit PCM RIFF WAV bytes."""
    import numpy as np
    clipped = np.clip(stereo_arr.T, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)
    out_io = io.BytesIO()
    with wave.open(out_io, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    return out_io.getvalue()


def split_lead_and_backing_vocals(vocal_audio_np, sample_rate: int = 44100):
    """Separates stereo vocal array into Lead Vocals and Backing Harmonies using spectral center-extraction."""
    import numpy as np
    from scipy import signal

    left = vocal_audio_np[0]
    right = vocal_audio_np[1]
    n_samples = len(left)

    nperseg = 2048
    noverlap = 1536

    _, _, Zxx_L = signal.stft(left, fs=sample_rate, nperseg=nperseg, noverlap=noverlap)
    _, _, Zxx_R = signal.stft(right, fs=sample_rate, nperseg=nperseg, noverlap=noverlap)

    mag_L = np.abs(Zxx_L)
    mag_R = np.abs(Zxx_R)
    phase_L = np.angle(Zxx_L)
    phase_R = np.angle(Zxx_R)

    delta_phase = np.abs(phase_L - phase_R)
    coherence = np.clip(np.cos(delta_phase), 0.0, 1.0)
    center_mag = np.minimum(mag_L, mag_R) * coherence

    denom = np.maximum(mag_L, mag_R) + 1e-8
    lead_mask = np.clip(center_mag / denom, 0.0, 1.0) ** 1.35

    lead_spec_L = mag_L * lead_mask * np.exp(1j * phase_L)
    lead_spec_R = mag_R * lead_mask * np.exp(1j * phase_R)

    _, lead_L = signal.istft(lead_spec_L, fs=sample_rate, nperseg=nperseg, noverlap=noverlap)
    _, lead_R = signal.istft(lead_spec_R, fs=sample_rate, nperseg=nperseg, noverlap=noverlap)

    lead_L = lead_L[:n_samples]
    lead_R = lead_R[:n_samples]
    if len(lead_L) < n_samples:
        lead_L = np.pad(lead_L, (0, n_samples - len(lead_L)))
        lead_R = np.pad(lead_R, (0, n_samples - len(lead_R)))

    back_L = left - lead_L
    back_R = right - lead_R

    lead_stereo = np.stack([lead_L, lead_R], axis=0).astype(np.float32)
    back_stereo = np.stack([back_L, back_R], axis=0).astype(np.float32)

    return lead_stereo, back_stereo


def _prune_old_stem_jobs(max_jobs: int = 3):
    if len(_STEM_JOBS) <= max_jobs:
        return
    sorted_ids = sorted(_STEM_JOBS.keys(), key=lambda jid: _STEM_JOBS[jid].get("created_at", 0))
    for old_id in sorted_ids[:-max_jobs]:
        _STEM_JOBS.pop(old_id, None)


def _run_demucs_job(job_id: str, wav_bytes: bytes):
    job = _STEM_JOBS.get(job_id)
    if not job:
        return

    try:
        import numpy as np
        import torch
        from scipy import signal
        from demucs.apply import apply_model

        job["stage"] = "Loading Meta HTDemucs v4 neural network..."
        job["progress"] = 4
        model, device = get_demucs_model()
        target_sr = int(getattr(model, "samplerate", 44100))

        job["stage"] = "Decoding & standardizing stereo waveform..."
        job["progress"] = 8
        sr, audio_np = decode_wav_bytes_to_stereo_float32(wav_bytes)

        if sr != target_sr:
            num_target = max(1, int(round(audio_np.shape[1] * target_sr / float(sr))))
            audio_np = signal.resample(audio_np, num_target, axis=1).astype(np.float32)

        total_samples = max(1, audio_np.shape[1])
        seg_samples = int(7.8 * target_sr)

        wav_tensor = torch.from_numpy(audio_np).to(device)
        ref = wav_tensor.mean(0)
        ref_mean = ref.mean()
        ref_std = ref.std() + 1e-8
        wav_norm = (wav_tensor - ref_mean) / ref_std

        job["stage"] = f"Separating 4 neural stems on {device.upper()}..."
        job["progress"] = 12

        def on_demucs_progress(info: dict):
            offset = int(info.get("segment_offset", 0))
            state = info.get("state", "start")
            done_samples = offset + (seg_samples if state == "end" else int(seg_samples * 0.35))
            ratio = min(1.0, max(0.0, done_samples / float(total_samples)))
            pct = min(94, 12 + int(ratio * 82))
            if pct > job["progress"]:
                job["progress"] = pct
                sec_done = min(total_samples, done_samples) / float(target_sr)
                sec_tot = total_samples / float(target_sr)
                job["stage"] = f"HTDemucs neural pass: {sec_done:.0f}s / {sec_tot:.0f}s ({pct}%)"

        with torch.no_grad():
            out_sources = apply_model(
                model,
                wav_norm[None],
                shifts=0,
                split=True,
                overlap=0.25,
                progress=False,
                device=device,
                callback=on_demucs_progress
            )[0]
            out_sources = out_sources * ref_std + ref_mean

        job["stage"] = "Encoding isolated 16-bit studio WAV stems..."
        job["progress"] = 96

        source_names = list(getattr(model, "sources", ["drums", "bass", "other", "vocals"]))
        stems_wav = {}
        out_np = out_sources.detach().cpu().numpy()

        for idx, name in enumerate(source_names):
            stems_wav[name] = encode_stereo_float32_to_wav_bytes(out_np[idx], target_sr)
            if name == "vocals":
                try:
                    lead_arr, back_arr = split_lead_and_backing_vocals(out_np[idx], target_sr)
                    stems_wav["lead_vocals"] = encode_stereo_float32_to_wav_bytes(lead_arr, target_sr)
                    stems_wav["backing_vocals"] = encode_stereo_float32_to_wav_bytes(back_arr, target_sr)
                except Exception as split_err:
                    print(f"[!] Vocal demixing note: {split_err}")

        job["stems"] = stems_wav
        job["progress"] = 100
        job["stage"] = "6-Stem Neural Separation Complete (with Lead & Harmonies)!"
        job["status"] = "done"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        job["stage"] = f"Stem separation error: {exc}"


class LocalProxyHandler(SimpleHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError, TimeoutError):
            pass

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Song-Id, Access-Control-Request-Private-Network')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def _send_json(self, status_code: int, payload: dict):
        try:
            resp_bytes = json.dumps(payload).encode('utf-8')
            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_bytes)))
            self.end_headers()
            self.wfile.write(resp_bytes)
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError, TimeoutError):
            pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path).path

        if parsed_path.startswith('/api/suno/playlist/'):
            playlist_id = parsed_path.split('/api/suno/playlist/', 1)[1].strip('/')
            try:
                data = fetch_playlist(playlist_id)
                self._send_json(200, data)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        if parsed_path.startswith('/api/suno/song/') or parsed_path.startswith('/api/suno/clip/'):
            song_id = re.split(r'/api/suno/(?:song|clip)/', parsed_path)[1].strip('/')
            try:
                data = fetch_metadata(song_id)
                self._send_json(200, data)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        if parsed_path in ('/api/health', '/health'):
            self._send_json(200, {'status': 'ok', 'app': 'NTK Hub Suno Studio', 'version': '2026.4'})
            return

        if parsed_path in ('/api/capabilities', '/api/stems/capabilities'):
            caps = check_demucs_available()
            self._send_json(200, {
                'active': True,
                'status': 'ok',
                'ytdl': True,
                'ffmpeg': True,
                'demucs': caps,
                'server': 'NTK Hub Suno Studio Helper v2026.5'
            })
            return

        if parsed_path.startswith('/api/stems/status/'):
            job_id = parsed_path.split('/api/stems/status/', 1)[1].strip('/')
            job = _STEM_JOBS.get(job_id)
            if not job:
                self._send_json(404, {'error': 'Job not found'})
                return
            self._send_json(200, {
                'job_id': job_id,
                'status': job['status'],
                'progress': job['progress'],
                'stage': job['stage'],
                'error': job['error'],
                'stems': list(job['stems'].keys()) if job['stems'] else []
            })
            return

        if parsed_path.startswith('/api/stems/download/'):
            parts = parsed_path.split('/api/stems/download/', 1)[1].strip('/').split('/')
            if len(parts) == 2:
                job_id, stem_name = parts[0], parts[1].lower()
                job = _STEM_JOBS.get(job_id)
                if job and job.get('stems') and stem_name in job['stems']:
                    wav_data = job['stems'][stem_name]
                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/wav')
                    self.send_header('Content-Length', str(len(wav_data)))
                    self.end_headers()
                    self.wfile.write(wav_data)
                    return
            self._send_json(404, {'error': 'Stem audio not found'})
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/stems/split-vocals'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0:
                self._send_json(400, {'error': 'Empty vocal payload'})
                return
            wav_bytes = self.rfile.read(content_length)
            try:
                sr, vocal_np = decode_wav_bytes_to_stereo_float32(wav_bytes)
                lead_np, back_np = split_lead_and_backing_vocals(vocal_np, sr)
                lead_wav = encode_stereo_float32_to_wav_bytes(lead_np, sr)
                back_wav = encode_stereo_float32_to_wav_bytes(back_np, sr)
                self._send_json(200, {
                    'status': 'done',
                    'lead_wav_base64': base64.b64encode(lead_wav).decode('ascii'),
                    'backing_wav_base64': base64.b64encode(back_wav).decode('ascii')
                })
            except Exception as exc:
                self._send_json(500, {'error': f"Failed to split vocals: {exc}"})
            return

        if self.path.startswith('/api/stems/separate'):
            caps = check_demucs_available()
            if not caps.get('available'):
                self._send_json(503, {'error': f"Local HTDemucs unavailable: {caps.get('error', 'missing packages')}"})
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0:
                self._send_json(400, {'error': 'Empty audio payload'})
                return

            wav_bytes = self.rfile.read(content_length)
            _prune_old_stem_jobs(max_jobs=3)

            job_id = uuid_lib.uuid4().hex[:12]
            _STEM_JOBS[job_id] = {
                'status': 'processing',
                'progress': 1,
                'stage': 'Queued for HTDemucs v4 neural separation...',
                'stems': None,
                'error': None,
                'created_at': time.time()
            }

            worker = threading.Thread(target=_run_demucs_job, args=(job_id, wav_bytes), daemon=True)
            worker.start()

            self._send_json(202, {'job_id': job_id, 'status': 'processing'})
            return

        if self.path.startswith('/api/mango/rights'):
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                uuid = data.get('content_params', {}).get('content_id')
                rights = fetch_rights(uuid)
                self._send_json(200, rights)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()


def serve(port: int = 8899, directory: str = "."):
    server_address = ('127.0.0.1', port)
    handler = lambda *args, **kwargs: LocalProxyHandler(*args, directory=directory, **kwargs)
    httpd = ThreadingHTTPServer(server_address, handler)
    caps = check_demucs_available()
    print("=" * 60)
    print(f"[*] NTK Hub Suno Studio Helper active on http://127.0.0.1:{port}")
    print(f"[*] Serving web app from: {os.path.abspath(directory)}")
    print(f"[*] Neural Stems (HTDemucs v4): {'READY (' + caps['device'].upper() + ')' if caps['available'] else 'UNAVAILABLE'}")
    print(f"[*] Open http://127.0.0.1:{port}/ in your web browser")
    print("=" * 60)
    while True:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Stopped server.")
            break
        except Exception as exc:
            print(f"[!] Server recovery after transient error: {exc}")
            time.sleep(0.2)


import zipfile


def batch_download_and_zip(urls_or_uuids: list, output_dir: str = ".", make_zip: bool = False, zip_name: str = None) -> list:
    os.makedirs(output_dir, exist_ok=True)
    all_uuids = []

    for item in urls_or_uuids:
        item = str(item).strip()
        if not item:
            continue
        if is_playlist_input(item):
            print(f"[*] Expanding Suno playlist: {item}")
            try:
                p_uuid = extract_uuid(item)
                p_data = fetch_playlist(p_uuid)
                p_name = p_data.get('name') or f"Playlist_{p_uuid[:8]}"
                if not zip_name:
                    safe_pname = re.sub(r'[<>:"/\\|?*]', '', p_name)[:40].strip() or f"Playlist_{p_uuid[:8]}"
                    zip_name = f"Suno_Playlist_{safe_pname}.zip"
                print(f"[+] Found {len(p_data['clips'])} tracks in playlist '{p_name}'")
                for c in p_data['clips']:
                    all_uuids.append(c['uuid'])
            except Exception as e:
                print(f"[!] Error fetching playlist {item}: {e}")
        else:
            try:
                all_uuids.append(extract_uuid(item))
            except Exception as e:
                print(f"[!] Skipping invalid input '{item}': {e}")

    seen = set()
    deduped_uuids = []
    for u in all_uuids:
        if u not in seen:
            seen.add(u)
            deduped_uuids.append(u)

    if not deduped_uuids:
        print("[!] No valid Suno track UUIDs found to download.")
        return []

    print(f"[*] Starting batch download of {len(deduped_uuids)} track(s)...")
    downloaded_files = []
    for idx, u in enumerate(deduped_uuids, 1):
        print(f"\n--- [{idx}/{len(deduped_uuids)}] Downloading {u} ---")
        try:
            fpath = download_and_decrypt(u, output_dir=output_dir)
            downloaded_files.append(fpath)
        except Exception as exc:
            print(f"[!] Failed to download {u}: {exc}")

    if make_zip and downloaded_files:
        if not zip_name:
            zip_name = f"Suno_Studio_Batch_{len(downloaded_files)}_Songs.zip"
        zip_path = os.path.join(output_dir, zip_name)
        print(f"\n[*] Packaging {len(downloaded_files)} tracks into ZIP: {zip_path}")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in downloaded_files:
                zf.write(f, os.path.basename(f))
                jpg = os.path.splitext(f)[0] + ".jpeg"
                if os.path.exists(jpg):
                    zf.write(jpg, os.path.basename(jpg))
        print(f"[+] SUCCESS! Batch ZIP archive created: {zip_path}")
        return [zip_path]

    return downloaded_files


def main():
    parser = argparse.ArgumentParser(description="Suno Downloader Pro Helper & Proxy")
    parser.add_argument("url_or_uuid", nargs="*", help="One or more Suno song/playlist URLs or UUIDs")
    parser.add_argument("-f", "--file", help="Path to text file containing Suno URLs (one per line)")
    parser.add_argument("-o", "--output", default=".", help="Output directory")
    parser.add_argument("--zip", action="store_true", help="Package all downloaded songs into a single .zip file")
    parser.add_argument("--serve", action="store_true", help="Start local web server with Mango DRM proxy")
    parser.add_argument("--port", type=int, default=8899, help="Port for server")
    parser.add_argument("--dir", default=".", help="Directory to serve")
    args = parser.parse_args()

    if args.serve:
        serve(port=args.port, directory=args.dir)
    else:
        inputs = list(args.url_or_uuid or [])
        if args.file and os.path.isfile(args.file):
            with open(args.file, "r", encoding="utf-8") as ff:
                inputs.extend([line.strip() for line in ff if line.strip()])
        if not inputs:
            parser.print_help()
            sys.exit(0)
        batch_download_and_zip(inputs, output_dir=args.output, make_zip=args.zip)


if __name__ == "__main__":
    main()
