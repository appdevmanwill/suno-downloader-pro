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


def extract_uuid(input_str: str) -> str:
    match = UUID_REGEX.search(input_str)
    if not match:
        raise ValueError(f"Could not find a valid Suno UUID in: {input_str}")
    return match.group(0).lower()


def fetch_metadata(uuid: str) -> dict:
    url = f"https://studio-api.prod.suno.com/api/clip/{uuid}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return {
                'title': data.get('title') or f"Suno_Song_{uuid[:8]}",
                'image': data.get('image_large_url') or f"https://cdn2.suno.ai/image_large_{uuid}.jpeg",
                'video_url': data.get('video_url') or f"https://cdn1.suno.ai/{uuid}.mp4",
                'prompt': (data.get('metadata') or {}).get('prompt') or '',
                'tags': (data.get('metadata') or {}).get('tags') or '',
                'duration': data.get('duration') or 0
            }
    except Exception:
        pass

    return {
        'title': f"Suno_Song_{uuid[:8]}",
        'image': f"https://cdn2.suno.ai/image_large_{uuid}.jpeg",
        'video_url': f"https://cdn1.suno.ai/{uuid}.mp4",
        'prompt': '',
        'tags': '',
        'duration': 0
    }


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
            "stems": ["vocals", "drums", "bass", "other"]
        }
    except Exception as exc:
        return {
            "available": False,
            "engine": "none",
            "device": "none",
            "error": str(exc)
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

        job["stems"] = stems_wav
        job["progress"] = 100
        job["stage"] = "4-Stem Neural Separation Complete!"
        job["status"] = "done"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        job["stage"] = f"Stem separation error: {exc}"


class LocalProxyHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Song-Id')
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def _send_json(self, status_code: int, payload: dict):
        resp_bytes = json.dumps(payload).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(resp_bytes)))
        self.end_headers()
        self.wfile.write(resp_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path).path

        if parsed_path == '/api/stems/capabilities':
            self._send_json(200, check_demucs_available())
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
    print(f"[*] Suno Downloader Pro Server active on http://127.0.0.1:{port}")
    print(f"[*] Serving web app from: {os.path.abspath(directory)}")
    print(f"[*] Neural Stems (HTDemucs v4): {'READY (' + caps['device'].upper() + ')' if caps['available'] else 'UNAVAILABLE'}")
    print(f"[*] Open http://127.0.0.1:{port}/ in your web browser")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Stopped server.")


def main():
    parser = argparse.ArgumentParser(description="Suno Downloader Pro Helper & Proxy")
    parser.add_argument("url_or_uuid", nargs="?", help="Suno song URL or UUID")
    parser.add_argument("-o", "--output", default=".", help="Output directory")
    parser.add_argument("--serve", action="store_true", help="Start local web server with Mango DRM proxy")
    parser.add_argument("--port", type=int, default=8899, help="Port for server")
    parser.add_argument("--dir", default=".", help="Directory to serve")
    args = parser.parse_args()

    if args.serve:
        serve(port=args.port, directory=args.dir)
    elif args.url_or_uuid:
        uuid = extract_uuid(args.url_or_uuid)
        download_and_decrypt(uuid, args.output)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
