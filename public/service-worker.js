const CACHE_NAME = 'pure-macros-static-v1';

// Everything the shell needs to boot fully offline — no icon/font files exist
// in this project yet, so only the assets that are actually served are listed.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Cache-first, falling back to network, for static system assets — CSS,
// JS, the manifest, icons, and font files. API calls (/api/...) always hit
// the network so nutrition/entry data is never served stale from cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname === '/' ||
      /\.(html|css|js|json|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname));
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      });
    })
  );
});
