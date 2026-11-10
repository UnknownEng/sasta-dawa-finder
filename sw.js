/**
 * Sasta Dawa Finder - service worker
 * App shell: cache-first with background refresh. Medicine data: network-first
 * (so price updates arrive quickly) with cached fallback for offline use.
 * API calls are never cached.
 */
const CACHE_NAME = 'sasta-dawa-v2.1.3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=2.1.3',
  './js/i18n.js?v=2.1.3',
  './js/data.js?v=2.1.3',
  './js/search.js?v=2.1.3',
  './js/assistant.js?v=2.1.3',
  './js/app.js?v=2.1.3',
  './data/medicines.json',
  './icons/icon.svg',
  './icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http') || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.startsWith('/unonenginerrunon')) return;

  // Medicine data: network first so new prices arrive quickly, but on a weak connection use
  // the saved copy after 4 s (the download still finishes in the background for next time).
  if (url.pathname.endsWith('/data/medicines.json')) {
    const network = fetch(request).then((r) => putInCache(request, r));
    event.waitUntil(network.catch(() => {}));
    event.respondWith(
      caches.match(request).then((cached) => {
        if (!cached) return network;
        const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 4000));
        return Promise.race([network.catch(() => cached), slow]);
      })
    );
    return;
  }

  // Navigations: serve the app shell offline
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((r) => putInCache(request, r)).catch(() => caches.match('./index.html')));
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((r) => putInCache(request, r)).catch(() => cached);
      return cached || network;
    })
  );
});
