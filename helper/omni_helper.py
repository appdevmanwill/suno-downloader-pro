#!/usr/bin/env python3
"""
NTK OmniStream Studio - Universal Media Helper & Local Server
Features:
- Serves the frontend web app on http://127.0.0.1:8899
- Universal yt-dlp extractor for 1,000+ sites (YouTube, TikTok, SoundCloud, Instagram, Twitter/X, Vimeo, Facebook, etc.)
- Audio-only extraction (MP3 320k, WAV, M4A, FLAC) and 1080p/720p Video downloads
- Active Mango DRM proxy and direct AES-CTR/GCM decryption for Suno AI
- In-memory & disk cookie management for private and age-gated media
- Native PyTorch HTDemucs v4 multi-stem AI server (2-stem, 4-stem, lead/backing vocal demixing)
- Local FFmpeg format transcoder
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
import subprocess
import urllib.request
import urllib.parse
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
except ImportError:
    Cipher = None

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

# Active background jobs: { job_id: { status, percent, message, file_path, meta, error } }
JOBS = {}
JOBS_LOCK = threading.Lock()

COOKIE_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_cookies.txt")

UUID_REGEX = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
PLAYLIST_URL_REGEX = re.compile(r'/playlist/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', re.I)


def is_suno_url(url: str) -> bool:
    if not url:
        return False
    u = url.lower()
    return 'suno.com' in u or 'suno.ai' in u or (bool(UUID_REGEX.search(url)) and 'youtube' not in u and 'tiktok' not in u)


# =========================================================================
# UNIVERSAL MEDIA RESOLUTION & EXTRACTION VIA YT-DLP
# =========================================================================

def get_ytdl_base_opts():
    opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'nocheckcertificate': True,
        'ignoreerrors': False,
        'logtostderr': False,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    }
    if os.path.isfile(COOKIE_FILE_PATH) and os.path.getsize(COOKIE_FILE_PATH) > 0:
        opts['cookiefile'] = COOKIE_FILE_PATH
    return opts


def resolve_media_info(url: str) -> dict:
    """
    Extracts universal metadata: title, uploader, duration, thumbnail, formats, audio streams.
    """
    if is_suno_url(url):
        return resolve_suno_info(url)

    if not yt_dlp:
        raise RuntimeError("yt-dlp is not installed in the Python environment. Run: pip install yt-dlp")

    opts = get_ytdl_base_opts()
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError(f"Could not extract info for URL: {url}")

        # Playlist vs Single Video
        if 'entries' in info and info.get('_type') == 'playlist':
            clips = []
            for entry in (info.get('entries') or []):
                if not entry:
                    continue
                clips.append(_format_entry(entry))
            return {
                'type': 'playlist',
                'id': info.get('id') or str(uuid_lib.uuid4())[:8],
                'title': info.get('title') or 'Playlist',
                'uploader': info.get('uploader') or info.get('channel') or '',
                'count': len(clips),
                'clips': clips
            }
        else:
            formatted = _format_entry(info)
            formatted['type'] = 'single'
            return formatted


def _format_entry(entry: dict) -> dict:
    webpage_url = entry.get('webpage_url') or entry.get('url') or ''
    cid = entry.get('id') or hashlib.md5(webpage_url.encode('utf-8')).hexdigest()[:12]
    duration = entry.get('duration') or 0
    title = entry.get('title') or f"Media_{cid}"
    uploader = entry.get('uploader') or entry.get('channel') or entry.get('artist') or 'Unknown Creator'
    thumbnail = entry.get('thumbnail') or ''

    # Detect platform
    extractor = (entry.get('extractor_key') or entry.get('extractor') or '').lower()
    platform = 'Universal'
    if 'youtube' in extractor: platform = 'YouTube'
    elif 'tiktok' in extractor: platform = 'TikTok'
    elif 'soundcloud' in extractor: platform = 'SoundCloud'
    elif 'instagram' in extractor: platform = 'Instagram'
    elif 'twitter' in extractor or 'x' == extractor: platform = 'Twitter/X'
    elif 'facebook' in extractor: platform = 'Facebook'
    elif 'vimeo' in extractor: platform = 'Vimeo'
    elif 'bandcamp' in extractor: platform = 'Bandcamp'

    formats_list = []
    raw_formats = entry.get('formats') or []
    has_video = False
    has_audio = False

    for f in raw_formats:
        vcodec = f.get('vcodec') or 'none'
        acodec = f.get('acodec') or 'none'
        height = f.get('height') or 0
        ext = f.get('ext') or ''
        filesize = f.get('filesize') or f.get('filesize_approx') or 0

        if vcodec != 'none': has_video = True
        if acodec != 'none': has_audio = True

        if height and height >= 360:
            formats_list.append({
                'formatId': f.get('format_id'),
                'label': f"{height}p ({ext.upper()})",
                'height': height,
                'ext': ext,
                'filesize': filesize
            })

    # Deduplicate video formats
    seen_heights = set()
    deduped_formats = []
    for f in sorted(formats_list, key=lambda x: x['height'], reverse=True):
        if f['height'] not in seen_heights:
            seen_heights.add(f['height'])
            deduped_formats.append(f)

    return {
        'uuid': f"omni-{cid}",
        'id': cid,
        'title': title,
        'artist': uploader,
        'duration': duration,
        'imageLarge': thumbnail,
        'imageThumb': thumbnail,
        'url': webpage_url,
        'platform': platform,
        'hasVideo': has_video,
        'hasAudio': has_audio,
        'formats': deduped_formats[:6],
        'tags': f"{platform} • {uploader}",
        'hasStem': True,
        'playerMode': 'custom'
    }


def download_media_task(job_id: str, url: str, target_format: str = 'mp3', audio_only: bool = False, output_dir: str = "."):
    os.makedirs(output_dir, exist_ok=True)
    with JOBS_LOCK:
        JOBS[job_id] = {
            'status': 'downloading',
            'percent': 5,
            'message': 'Starting stream download...',
            'filePath': None,
            'error': None
        }

    def ytdl_hook(d):
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes') or 0
            pct = 10
            if total > 0:
                pct = int(10 + (downloaded / total) * 75)
            spd = d.get('speed') or 0
            spd_mb = f"{spd / 1024 / 1024:.1f} MB/s" if spd else ""
            with JOBS_LOCK:
                JOBS[job_id]['percent'] = min(88, pct)
                JOBS[job_id]['message'] = f"Downloading stream {spd_mb}..."
        elif d['status'] == 'finished':
            with JOBS_LOCK:
                JOBS[job_id]['percent'] = 90
                JOBS[job_id]['message'] = 'Processing and packaging media...'

    try:
        base_opts = get_ytdl_base_opts()
        base_opts['progress_hooks'] = [ytdl_hook]
        out_tmpl = os.path.join(output_dir, f"%(title)s_%(id)s.%(ext)s")
        base_opts['outtmpl'] = out_tmpl

        if audio_only or target_format in ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus']:
            base_opts['format'] = 'bestaudio/best'
            base_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': target_format if target_format in ['mp3', 'wav', 'flac', 'm4a', 'opus'] else 'mp3',
                'preferredquality': '320' if target_format == 'mp3' else None
            }]
        else:
            # Video download (1080p, 720p, or best MP4)
            if target_format == '1080p':
                base_opts['format'] = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'
            elif target_format == '720p':
                base_opts['format'] = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'
            else:
                base_opts['format'] = 'bestvideo+bestaudio/best'
            base_opts['merge_output_format'] = 'mp4'

        with yt_dlp.YoutubeDL(base_opts) as ydl:
            res = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(res)
            # Check target extension after FFmpeg post-processing
            if audio_only or target_format in ['mp3', 'wav', 'flac', 'm4a', 'opus']:
                base_name = os.path.splitext(filename)[0]
                expected = f"{base_name}.{target_format}"
                if os.path.isfile(expected):
                    filename = expected

        with JOBS_LOCK:
            JOBS[job_id]['status'] = 'complete'
            JOBS[job_id]['percent'] = 100
            JOBS[job_id]['message'] = 'Download and conversion complete!'
            JOBS[job_id]['filePath'] = filename

    except Exception as exc:
        with JOBS_LOCK:
            JOBS[job_id]['status'] = 'error'
            JOBS[job_id]['error'] = str(exc)
            JOBS[job_id]['message'] = f"Download failed: {exc}"


# =========================================================================
# SUNO AI STREAM RESOLUTION & AES DECRYPTION
# =========================================================================

def resolve_suno_info(url: str) -> dict:
    match = UUID_REGEX.search(url)
    if not match:
        raise ValueError(f"Could not find valid Suno UUID in: {url}")
    clean_uuid = match.group(0).lower()

    if '/playlist/' in url.lower():
        api_url = f"https://studio-api.prod.suno.com/api/playlist/{clean_uuid}/?page=1"
        req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            clips = []
            for item in data.get('playlist_clips', []):
                c = item.get('clip') or {}
                cid = (c.get('id') or '').lower().strip()
                if cid:
                    clips.append({
                        'uuid': cid,
                        'title': c.get('title') or f"Suno_{cid[:8]}",
                        'artist': 'Suno AI',
                        'duration': c.get('duration') or 0,
                        'imageLarge': c.get('image_large_url') or f"https://cdn2.suno.ai/image_large_{cid}.jpeg",
                        'imageThumb': c.get('image_url') or f"https://cdn1.suno.ai/image_{cid}.jpeg",
                        'streamUrl': f"https://d2lwuy8qc234o3.cloudfront.net/1/clip/{cid}.m4a",
                        'url': f"https://suno.com/song/{cid}",
                        'platform': 'Suno AI',
                        'hasVideo': True,
                        'hasAudio': True,
                        'hasStem': True,
                        'tags': (c.get('metadata') or {}).get('tags') or 'Suno AI Generation'
                    })
            return {
                'type': 'playlist',
                'id': clean_uuid,
                'title': data.get('name') or f"Suno Playlist {clean_uuid[:8]}",
                'uploader': 'Suno AI',
                'count': len(clips),
                'clips': clips
            }
    else:
        api_url = f"https://studio-api.prod.suno.com/api/clip/{clean_uuid}"
        title = f"Suno_{clean_uuid[:8]}"
        duration = 180
        image = f"https://cdn2.suno.ai/image_large_{clean_uuid}.jpeg"
        tags = 'Suno AI Master'
        try:
            req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                title = data.get('title') or title
                duration = data.get('duration') or duration
                image = data.get('image_large_url') or image
                tags = (data.get('metadata') or {}).get('tags') or tags
        except Exception:
            pass

        return {
            'type': 'single',
            'uuid': clean_uuid,
            'id': clean_uuid,
            'title': title,
            'artist': 'Suno AI',
            'duration': duration,
            'imageLarge': image,
            'imageThumb': image,
            'streamUrl': f"https://d2lwuy8qc234o3.cloudfront.net/1/clip/{clean_uuid}.m4a",
            'url': f"https://suno.com/song/{clean_uuid}",
            'platform': 'Suno AI',
            'hasVideo': True,
            'hasAudio': True,
            'hasStem': True,
            'tags': tags,
            'formats': [{'formatId': 'm4a', 'label': 'Lossless M4A Master', 'ext': 'm4a'}]
        }


def decrypt_suno_stream(uuid: str) -> bytes:
    if not Cipher:
        raise RuntimeError("Cryptography package required. Run: pip install cryptography")

    rights_url = "https://studio-api.prod.suno.com/api/mango/rights"
    payload = json.dumps({'clip_id': uuid}).encode('utf-8')
    req = urllib.request.Request(
        rights_url,
        data=payload,
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        rights = json.loads(resp.read().decode('utf-8'))

    wrapped = base64.b64decode(rights['wrapped_content_key'])
    iv_gcm = base64.b64decode(rights['key_wrap_iv'])
    tag_gcm = base64.b64decode(rights['key_wrap_tag'])
    app_key = bytes([
        0x3c, 0xa1, 0x9f, 0x4e, 0x2b, 0x78, 0x5d, 0x12,
        0x89, 0x4f, 0xc6, 0x23, 0x71, 0x05, 0xe8, 0x9a,
        0xd4, 0x1b, 0x6e, 0x3f, 0x90, 0x52, 0x87, 0x4c,
        0x13, 0x68, 0x29, 0xfa, 0xeb, 0x47, 0x0d, 0x51
    ])

    decryptor_gcm = Cipher(
        algorithms.AES(app_key),
        modes.GCM(iv_gcm, tag_gcm),
        backend=default_backend()
    ).decryptor()
    content_key = decryptor_gcm.update(wrapped) + decryptor_gcm.finalize()

    stream_url = f"https://d2lwuy8qc234o3.cloudfront.net/1/clip/{uuid}.m4a"
    sreq = urllib.request.Request(stream_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(sreq, timeout=30) as sresp:
        encrypted_bytes = sresp.read()

    cipher_ctr = Cipher(
        algorithms.AES(content_key),
        modes.CTR(b'\x00' * 16),
        backend=default_backend()
    )
    decryptor_ctr = cipher_ctr.decryptor()
    return decryptor_ctr.update(encrypted_bytes) + decryptor_ctr.finalize()


# =========================================================================
# NATIVE PYTORCH HTDEMUCS v4 STEM SEPARATION
# =========================================================================

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


class OmniStudioHTTPHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict):
        resp_bytes = json.dumps(payload).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(resp_bytes)))
        self.end_headers()
        self.wfile.write(resp_bytes)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization, X-Requested-With')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 0. API: Stems Capabilities & Status
        if path == '/api/stems/capabilities':
            self._send_json(200, check_demucs_available())
            return

        if path.startswith('/api/stems/status/'):
            job_id = path.split('/api/stems/status/', 1)[1].strip('/')
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

        if path.startswith('/api/stems/download/'):
            parts = path.split('/api/stems/download/', 1)[1].strip('/').split('/')
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


        # 1. API: Check capabilities & health
        if path in ('/api/capabilities', '/api/health'):
            caps = {
                'status': 'ok',
                'server': 'NTK OmniStream Studio Helper v2026.5',
                'yt_dlp': bool(yt_dlp),
                'ffmpeg': self._check_ffmpeg(),
                'demucs': check_demucs_available()
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(caps).encode('utf-8'))
            return

        # 2. API: Resolve stream metadata
        if path.startswith('/api/omni/resolve'):
            query = urllib.parse.parse_qs(parsed.query)
            target_url = query.get('url', [''])[0].strip()
            if not target_url:
                self.send_error(400, "Missing 'url' query parameter.")
                return
            try:
                info = resolve_media_info(target_url)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(info).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        # 3. API: Check download job status
        if path.startswith('/api/omni/status/'):
            job_id = path.split('/api/omni/status/')[1].strip('/')
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                self.send_error(404, "Job ID not found.")
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(job).encode('utf-8'))
            return

        # 4. API: Stream or download completed job file
        if path.startswith('/api/omni/download-file/'):
            job_id = path.split('/api/omni/download-file/')[1].strip('/')
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job or not job.get('filePath') or not os.path.isfile(job['filePath']):
                self.send_error(404, "File not ready or not found.")
                return

            fpath = job['filePath']
            fname = os.path.basename(fpath)
            fsize = os.path.getsize(fpath)
            ext = os.path.splitext(fname)[1].lower()

            mime = 'application/octet-stream'
            if ext == '.mp3': mime = 'audio/mpeg'
            elif ext == '.wav': mime = 'audio/wav'
            elif ext == '.m4a': mime = 'audio/mp4'
            elif ext == '.mp4': mime = 'video/mp4'
            elif ext == '.webm': mime = 'video/webm'

            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(fsize))
            self.send_header('Content-Disposition', f'attachment; filename="{fname}"')
            self.end_headers()
            with open(fpath, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk: break
                    self.wfile.write(chunk)
            return

        # 5. API: Decrypt Suno Song
        if path.startswith('/api/suno/decrypt/'):
            uuid = path.split('/api/suno/decrypt/')[1].strip('/').lower()
            try:
                decrypted = decrypt_suno_stream(uuid)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mp4')
                self.send_header('Content-Length', str(len(decrypted)))
                self.send_header('Content-Disposition', f'attachment; filename="Suno_{uuid}.m4a"')
                self.end_headers()
                self.wfile.write(decrypted)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        # Fallback: Serve static directory
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 0. API: Stems Split-Vocals & Separate
        if path.startswith('/api/stems/split-vocals'):
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

        if path.startswith('/api/stems/separate'):
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

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''

        # 1. API: Trigger download
        if path == '/api/omni/download':
            try:
                data = json.loads(body.decode('utf-8'))
                url = data.get('url')
                target_format = data.get('format', 'mp3')
                audio_only = bool(data.get('audioOnly', False))
                if not url:
                    self.send_error(400, "Missing 'url' field.")
                    return

                job_id = str(uuid_lib.uuid4())[:12]
                download_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "downloads")
                t = threading.Thread(
                    target=download_media_task,
                    args=(job_id, url, target_format, audio_only, download_dir),
                    daemon=True
                )
                t.start()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'jobId': job_id, 'status': 'queued'}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        # 2. API: Save Cookies
        if path == '/api/omni/cookies':
            try:
                data = json.loads(body.decode('utf-8'))
                cookies_text = data.get('cookies', '')
                with open(COOKIE_FILE_PATH, 'w', encoding='utf-8') as f:
                    f.write(cookies_text)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'message': 'Cookies saved successfully.'}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        # 3. Mango DRM Rights Proxy (for Suno)
        if path == '/api/mango/rights':
            try:
                rights_url = "https://studio-api.prod.suno.com/api/mango/rights"
                req = urllib.request.Request(
                    rights_url,
                    data=body,
                    headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp_data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(resp_data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        self.send_error(404, "Endpoint not found.")

    def _check_ffmpeg(self) -> bool:
        try:
            res = subprocess.run(['ffmpeg', '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
            return res.returncode == 0
        except Exception:
            return False


def run_server(port: int = 8899, directory: str = "."):
    handler = lambda *args, **kwargs: OmniStudioHTTPHandler(*args, directory=directory, **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    caps = check_demucs_available()
    print("=" * 70)
    print(f"[*] NTK OmniStream Studio Server Active on http://127.0.0.1:{port}")
    print(f"[*] Serving web app from: {os.path.abspath(directory)}")
    print(f"[*] Universal Media Extractor (yt-dlp): {'READY' if yt_dlp else 'NOT INSTALLED'}")
    print(f"[*] Neural Stems (HTDemucs v4): {'READY (' + caps['device'].upper() + ')' if caps['available'] else 'BROWSER WEBGPU/WASM ONNX'}")
    print("=" * 70)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopped.")


def main():
    parser = argparse.ArgumentParser(description="NTK OmniStream Studio Helper & Server")
    parser.add_argument("url", nargs="?", help="Universal media URL to download")
    parser.add_argument("--serve", action="store_true", default=True, help="Start local web server with yt-dlp & proxy")
    parser.add_argument("--port", type=int, default=8899, help="Port for server (default 8899)")
    parser.add_argument("--dir", default=".", help="Directory to serve")
    parser.add_argument("--format", default="mp3", help="Audio/video format (mp3, wav, flac, 1080p, 720p)")
    parser.add_argument("--audio-only", action="store_true", help="Fast grab audio stream only")
    args = parser.parse_args()

    if args.url:
        print(f"[*] Extracting media from: {args.url}")
        job_id = "cli-" + str(uuid_lib.uuid4())[:8]
        download_media_task(job_id, args.url, target_format=args.format, audio_only=args.audio_only, output_dir="./downloads")
        res = JOBS.get(job_id)
        if res and res.get('filePath'):
            print(f"[+] Download complete: {res['filePath']}")
        else:
            print(f"[!] Error: {res.get('error') if res else 'Unknown'}")
        return

    if args.serve:
        run_server(port=args.port, directory=args.dir)


if __name__ == "__main__":
    main()
