/**
 * Suno Downloader Pro - Bookmarklet & Userscript Generator
 * 2026 Studio Edition - In-Browser Decryption, M4A, WAV, Video & 4-Stem Neural AI Studio Launcher
 */

export class BookmarkletEngine {
  /**
   * Builds the self-contained JavaScript bookmarklet URL
   * @returns {string}
   */
  static getBookmarkletUrl() {
    const studioBase =
      typeof window !== 'undefined' &&
      window.location &&
      window.location.href.startsWith('http')
        ? window.location.origin + window.location.pathname
        : 'http://127.0.0.1:8899/index.html';

    const rawCode = `(function(){
      (async function(){
        try {
          var studioUrl = ${JSON.stringify(studioBase)};
          var m = location.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          var u = m ? m[1].toLowerCase() : '';
          if (!u) {
            alert('Please open an individual Suno song page first (e.g. suno.com/song/...)!');
            return;
          }

          var old = document.getElementById('suno-studio-hud');
          if (old) old.remove();

          var h = document.createElement('div');
          h.id = 'suno-studio-hud';
          h.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999999;background:#10131d;color:#fff;border:2px solid #f59e0b;border-radius:24px;padding:22px;width:380px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 30px 70px rgba(0,0,0,0.85);line-height:1.4;';

          var t = (document.querySelector('h1') && document.querySelector('h1').innerText) || document.title.replace(/\\s*[|-]\\s*Suno.*$/i, '').trim() || 'Suno_Song';
          t = t.replace(/[<>:"/\\\\|?*]/g, '').trim().slice(0, 60) || 'Suno_Song';

          h.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<span style="font-weight:800;font-size:15px;color:#fbbf24;display:flex;align-items:center;gap:6px;"><span>🪄</span><span>Suno Downloader Pro</span></span>' +
            '<button id="sm-close" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:2px 6px;">✕</button>' +
            '</div>' +
            '<div style="font-size:13px;font-weight:700;color:#f8fafc;margin-bottom:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎵 ' + t + '</div>' +
            '<div id="sm-status" style="font-size:12px;color:#cbd5e1;margin-bottom:14px;padding:9px 12px;background:rgba(255,255,255,0.06);border-radius:12px;">⏳ Requesting decryption rights...</div>' +
            '<div id="sm-actions" style="display:none;flex-direction:column;gap:8px;"></div>';

          document.body.appendChild(h);
          document.getElementById('sm-close').onclick = function(){ h.remove(); };

          var st = document.getElementById('sm-status');
          var act = document.getElementById('sm-actions');

          var r = await fetch('https://studio-api.prod.suno.com/api/mango/rights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content_params: { content_id: u, content_type: 'clip' } })
          });
          if (!r.ok) throw new Error('Rights request failed with status: ' + r.status);
          var data = await r.json();

          st.innerText = '🔓 Deriving cryptographic keys...';
          var gDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.glt));
          var mKey = await crypto.subtle.importKey('raw', gDigest, { name: 'AES-GCM' }, false, ['decrypt']);

          var unwrap = async function(b64) {
            var raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            return new Uint8Array(await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(u) },
              mKey,
              raw.slice(12)
            ));
          };

          var cKey = await crypto.subtle.importKey('raw', await unwrap(data.key), { name: 'AES-CTR' }, false, ['decrypt']);
          var iv = await unwrap(data.iv);

          st.innerText = '⚡ Downloading master stream...';
          var encResp = await fetch('https://d2lwuy8qc234o3.cloudfront.net/1/clip/' + u + '.m4a');
          if (!encResp.ok) throw new Error('CloudFront returned HTTP ' + encResp.status);
          var encBuf = await encResp.arrayBuffer();

          st.innerText = '✨ Decrypting audio in browser...';
          var decBuf = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: iv, length: 128 }, cKey, encBuf);

          st.innerHTML = '✅ <strong>Decrypted!</strong> ' + (decBuf.byteLength / 1024 / 1024).toFixed(2) + ' MB ready.';
          act.style.display = 'flex';

          var blobM4a = new Blob([decBuf], { type: 'audio/mp4' });
          var dl = function(b, name) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
          };

          act.innerHTML =
            '<button id="sm-dl-m4a" style="padding:10px;border-radius:12px;border:none;background:linear-gradient(90deg,#fbbf24,#f43f5e);color:#0f172a;font-weight:800;font-size:12px;cursor:pointer;">⬇ Download Original Master (.m4a)</button>' +
            '<button id="sm-dl-wav" style="padding:10px;border-radius:12px;border:1px solid rgba(16,185,129,0.5);background:rgba(16,185,129,0.2);color:#6ee7b7;font-weight:800;font-size:12px;cursor:pointer;">⬇ Download Studio WAV (Lossless)</button>' +
            '<button id="sm-dl-stems" style="padding:10px;border-radius:12px;border:1px solid rgba(6,182,212,0.5);background:rgba(6,182,212,0.2);color:#67e8f9;font-weight:800;font-size:12px;cursor:pointer;">🎛️ Open in 4-Stem Neural AI Studio (HTDemucs v4)</button>' +
            '<button id="sm-dl-video" style="padding:10px;border-radius:12px;border:1px solid rgba(139,92,246,0.5);background:rgba(139,92,246,0.2);color:#c4b5fd;font-weight:800;font-size:12px;cursor:pointer;">🎬 Download Suno Video (.mp4)</button>' +
            '<button id="sm-dl-img" style="padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#cbd5e1;font-weight:600;font-size:11px;cursor:pointer;">🖼 Download Cover Art (.jpeg)</button>';

          // Auto-trigger default master download
          dl(blobM4a, t + '.m4a');

          document.getElementById('sm-dl-m4a').onclick = function(){ dl(blobM4a, t + '.m4a'); };
          document.getElementById('sm-dl-img').onclick = function(){ window.open('https://cdn2.suno.ai/image_large_' + u + '.jpeg', '_blank'); };

          document.getElementById('sm-dl-wav').onclick = async function() {
            this.innerText = '⏳ Encoding Studio WAV...';
            try {
              var ctx = new (window.AudioContext || window.webkitAudioContext)();
              var aBuf = await ctx.decodeAudioData(decBuf.slice(0));
              if (ctx.close) await ctx.close();

              var nCh = aBuf.numberOfChannels, sr = aBuf.sampleRate, len = aBuf.length, ds = len * nCh * 2;
              var b = new ArrayBuffer(44 + ds), v = new DataView(b);
              var w = function(o, s){ for (var i=0; i<s.length; i++) v.setUint8(o+i, s.charCodeAt(i)); };
              w(0, 'RIFF'); v.setUint32(4, 36 + ds, true); w(8, 'WAVE'); w(12, 'fmt ');
              v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
              v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true);
              v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
              w(36, 'data'); v.setUint32(40, ds, true);

              var chs = [];
              for (var c=0; c<nCh; c++) chs.push(aBuf.getChannelData(c));
              var off = 44;
              for (var i=0; i<len; i++) {
                for (var c=0; c<nCh; c++) {
                  var smp = Math.max(-1, Math.min(1, chs[c][i]));
                  v.setInt16(off, smp < 0 ? smp * 0x8000 : smp * 0x7FFF, true);
                  off += 2;
                }
              }
              dl(new Blob([b], { type: 'audio/wav' }), t + '.wav');
              this.innerText = '✅ WAV Downloaded!';
            } catch (err) {
              alert('WAV conversion failed: ' + err.message);
              this.innerText = '⬇ Download Studio WAV';
            }
          };

          document.getElementById('sm-dl-stems').onclick = function() {
            var sep = studioUrl.indexOf('?') !== -1 ? '&' : '?';
            window.open(studioUrl + sep + 'song=' + u + '&open=stems', '_blank');
          };

          document.getElementById('sm-dl-video').onclick = function() {
            window.open('https://cdn1.suno.ai/' + u + '.mp4', '_blank');
          };

        } catch (e) {
          var st = document.getElementById('sm-status');
          if (st) {
            st.innerHTML = '❌ <strong>Error:</strong> ' + e.message;
          } else {
            alert('Suno Downloader: ' + e.message);
          }
        }
      })();
    })();`;

    return 'javascript:' + encodeURIComponent(rawCode.replace(/\s+/g, ' ').trim());
  }

  /**
   * Generates Tampermonkey / Violentmonkey userscript
   * @returns {string}
   */
  static getUserscriptCode() {
    const bookmarkletUrl = BookmarkletEngine.getBookmarkletUrl();
    return `// ==UserScript==
// @name         Suno Downloader Pro • 2026 Studio Edition
// @namespace    suno-downloader-pro
// @version      4.0.0
// @description  1-Click direct audio & video downloader with Mango DRM decryption and HTDemucs v4 4-Stem AI Studio launcher
// @match        https://suno.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  const injectDownloadButton = () => {
    if (document.getElementById('suno-pro-hud-trigger')) return;

    const match = location.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!match) return;

    const btn = document.createElement('button');
    btn.id = 'suno-pro-hud-trigger';
    btn.innerHTML = '⚡ Download Song & Launch Studio';
    btn.style.cssText = 'position:fixed;top:16px;right:180px;z-index:999999;background:linear-gradient(90deg,#fbbf24,#f43f5e);color:#0f172a;font-weight:800;font-size:12px;padding:8px 16px;border-radius:20px;border:none;box-shadow:0 10px 25px rgba(0,0,0,0.5);cursor:pointer;transition:transform 0.2s;';
    btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; };
    btn.onmouseout = () => { btn.style.transform = 'scale(1)'; };
    btn.onclick = () => {
      location.href = "${bookmarkletUrl}";
    };
    document.body.appendChild(btn);
  };

  setInterval(injectDownloadButton, 1500);
})();`;
  }
}
