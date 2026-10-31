/**
 * Suno Downloader Pro - Studio PWA Service Worker
 * Provides offline app-shell caching while keeping API and streaming endpoints network-direct.
 */

const CACHE_NAME = 'suno-studio-pwa-v2026-2';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon.svg',
  './css/style.css',
  './css/components.css',
  './css/player.css',
  './css/visualizer.css',
  './lib/lame.all.js',
  './lib/jszip.min.js',
  './lib/demucs-web/index.js',
  './lib/demucs-web/constants.js',
  './lib/demucs-web/fft.js',
  './lib/demucs-web/processor.js',
  './js/app.js',
  './js/suno-api.js',
  './js/crypto-engine.js',
  './js/audio-converter.js',
  './js/mp3-encoder.js',
  './js/id3-writer.js',
  './js/lyrics-utils.js',
  './js/vault-db.js',
  './js/stem-engine.js',
  './js/stem-mixer.js',
  './js/audio-fx.js',
  './js/zip-packager.js',
  './js/video-generator.js',
  './js/bookmarklet.js',
  './js/storage.js',
  './js/player.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept local API endpoints or cross-origin media/model streams
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  // Network-first with offline cache fallback so static deployments stay fresh and work offline
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return networkRes;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
