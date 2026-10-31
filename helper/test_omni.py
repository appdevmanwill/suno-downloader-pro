"""
Automated Verification Suite for NTK OmniStream Studio Helper
"""
import sys
import os
import json
import threading
import time
import urllib.request
import urllib.parse
from http.server import ThreadingHTTPServer

# Ensure helper dir is on path
helper_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, helper_dir)

import omni_helper
from omni_helper import OmniStudioHTTPHandler, COOKIE_FILE_PATH

def test_environment():
    print("[TEST] Checking environment dependencies...")
    assert omni_helper.yt_dlp is not None, "yt-dlp must be installed"
    print("  [OK] yt-dlp available")
    import shutil
    ffmpeg_bin = shutil.which("ffmpeg")
    assert ffmpeg_bin is not None, "ffmpeg must be on PATH"
    print(f"  [OK] ffmpeg available at: {ffmpeg_bin}")
    caps = omni_helper.check_demucs_available()
    print(f"  [OK] HTDemucs capabilities: {caps}")

def test_server():
    print("[TEST] Launching OmniHelper server on test port 8898...")
    handler = lambda *args, **kwargs: OmniStudioHTTPHandler(*args, directory=os.path.dirname(helper_dir), **kwargs)
    httpd = ThreadingHTTPServer(("127.0.0.1", 8898), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(1)

    try:
        # Test 1: Health check
        print("[TEST] GET /api/health ...")
        req = urllib.request.urlopen("http://127.0.0.1:8898/api/health")
        data = json.loads(req.read().decode('utf-8'))
        assert data["status"] == "ok", f"Expected ok, got {data['status']}"
        assert data["yt_dlp"] is True
        assert data["ffmpeg"] is True
        print(f"  [OK] /api/health returned: {data}")

        # Test 2: Cookies API (/api/omni/cookies)
        print("[TEST] POST /api/omni/cookies ...")
        test_cookie = "# Netscape HTTP Cookie File\n.test.com\tTRUE\t/\tTRUE\t1799999999\tTEST\t1"
        post_data = json.dumps({"cookies": test_cookie}).encode('utf-8')
        post_req = urllib.request.Request("http://127.0.0.1:8898/api/omni/cookies", data=post_data, headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(post_req)
        resp_data = json.loads(resp.read().decode('utf-8'))
        assert resp_data["success"] is True
        print("  [OK] Cookie successfully saved to disk")

        assert os.path.exists(COOKIE_FILE_PATH)
        with open(COOKIE_FILE_PATH, 'r', encoding='utf-8') as f:
            saved_content = f.read()
        assert "TEST" in saved_content
        print("  [OK] Cookie file on disk verified")

        # Cleanup test cookie
        if os.path.exists(COOKIE_FILE_PATH):
            os.remove(COOKIE_FILE_PATH)

        print("\nAll OmniHelper tests PASSED successfully!")
    finally:
        httpd.shutdown()

if __name__ == "__main__":
    test_environment()
    test_server()
