/**
 * Sasta Dawa Finder - service worker
 * App shell: cache-first with background refresh. Medicine data: network-first
 * (so price updates arrive quickly) with cached fallback for offline use.
 * API calls are never cached (they carry sign-in tokens, live pharmacy stock and reservations).
 * The account / business / developer / widget pages are not precached: they always need the
 * network, and are only kept as an offline copy after a successful visit.
 */
const CACHE_NAME = 'sasta-dawa-v2.4.0';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=2.4.0',
  './js/i18n.js?v=2.4.0',
  './js/data.js?v=2.4.0',
  './js/search.js?v=2.4.0',
  './js/assistant.js?v=2.4.0',
  './js/app.js?v=2.4.0',
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

function isApi(url) {
  return url.pathname.startsWith('/api/') || url.pathname.includes('/api/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http') || url.origin !== self.location.origin) return;
  // Never touch the API (no cache, no offline copy) or the admin panel.
  if (isApi(url) || url.pathname.startsWith('/unonenginerrunon')) return;
  if (request.headers.get('Authorization')) return;

  // Medicine data (prices + registered brands): network first so new prices arrive quickly, but on a weak connection use
  // the saved copy after 4 s (the download still finishes in the background for next time).
  if (url.pathname.endsWith('/data/medicines.json') || url.pathname.endsWith('/data/registry.json')) {
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

  // Navigations: network first. Offline, use that page's own saved copy if there is one
  // (e.g. /account after a visit), otherwise the app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((r) => putInCache(request, r))
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
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
