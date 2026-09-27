/* Email Management — service worker (offline app shell) */
const CACHE = 'email-management-v1.0.0';
const SHELL = [
  './', './index.html', './manifest.json', './css/styles.css',
  './js/i18n.js', './js/db.js', './js/mime.js', './js/msg.js', './js/engine.js', './js/samples.js', './js/app.js', './js/reply.js', './js/extras.js',
  './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never touch AI provider calls or other cross-origin APIs (fonts are cached opportunistically)
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;
  if (isFont) {
    event.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; } catch (e) { return hit || Response.error(); }
    }));
    return;
  }
  // App shell: network first (so updates land quickly), fall back to cache when offline
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return c.match('./index.html');
      return Response.error();
    }
  })());
});
