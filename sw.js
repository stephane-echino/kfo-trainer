// Service worker — bump VERSION on every deploy.
// Strategy: network-first for navigations and data modules (fresh content
// whenever online, cache fallback offline); cache-first for static assets.
const VERSION = 'v1.6.0';
const CACHE = `kfo-trainer-${VERSION}`;

const CORE = [
  './',
  './index.html',
  './js/main.js',
  './css/app.css',
  './data/modules/circuit.json',
];
const ASSETS = [
  ...CORE,
  './data/modules/circuit-fr.json',
  './js/data.js',
  './js/store.js',
  './js/trainer.js',
  './js/examiner.js',
  './js/circuit.js',
  './js/voice.js',
  './js/i18n.js',
  './js/version.js',
  './js/updates.js',
  './js/fx.js',
  './js/state.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

// Tolerant precache: a missing non-core asset must not block install.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      const results = await Promise.allSettled(
        ASSETS.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'no-cache' }));
          if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
          await c.put(url, res);
          return url;
        })
      );
      const failed = results
        .map((r, i) => (r.status === 'rejected' ? ASSETS[i] : null))
        .filter(Boolean);
      if (failed.length) console.error('[sw] precache failed for:', failed);
      if (failed.some((url) => CORE.includes(url))) {
        throw new Error(`core asset failed to precache: ${failed.join(', ')}`);
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFreshFirst(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path.endsWith('/index.html') || path.includes('/data/modules/');
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // version.json must never be answered from cache — it is how the app detects
  // that a new build exists. Let the browser fetch it directly.
  if (new URL(e.request.url).pathname.endsWith('/version.json')) return;
  const sameOrigin = new URL(e.request.url).origin === location.origin;

  if (sameOrigin && isFreshFirst(e.request)) {
    // network-first: latest content when online, cache offline
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(cached => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  // cache-first for static assets
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached =>
      cached ||
      fetch(e.request).then(res => {
        if (res.ok && sameOrigin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});
