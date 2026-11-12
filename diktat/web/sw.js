// Service Worker:
// 1. macht die App offline verfügbar (App-Dateien im Cache; Modelle liegen in IndexedDB),
// 2. setzt COOP/COEP-Header, damit der Browser mehrere Prozessorkerne freigibt (crossOriginIsolated),
//    auch auf Hosts, die diese Header nicht selbst senden (z. B. GitHub Pages).
const VERSION = 'diktat-web-v2';
const SHELL = [
  './', './index.html', './einfach.js', './voll.html', './app.js', './store.js', './asr-worker.js', './llm-worker.js',
  './manifest.webmanifest', './icon.svg',
  './lib/transformers/transformers.min.js',
  './lib/transformers/ort-wasm-simd-threaded.jsep.mjs',
  './lib/transformers/ort-wasm-simd-threaded.jsep.wasm',
  './lib/ort/ort.bundle.min.mjs',
  './lib/ort/ort-wasm-simd-threaded.jsep.wasm',
  './lib/parakeet.bundle.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(resp) {
  if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Modelle von Hugging Face: direkt
  const big = url.pathname.includes('/lib/');
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (big) {
      // Bibliotheken ändern sich nur mit neuer Version: Cache zuerst
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return isolate(hit);
    }
    try {
      const resp = await fetch(req);
      if (resp.ok) cache.put(req, resp.clone());
      return isolate(resp);
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('./index.html'));
      if (hit) return isolate(hit);
      throw err;
    }
  })());
});
