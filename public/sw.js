/* WorkHub service worker — cache public shell only, never private APIs */
const CACHE = 'workhub-shell-v1';
const SHELL = ['/', '/css/style.css', '/js/api.js', '/js/domSafe.js', '/js/main.js', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/host/') || url.pathname.startsWith('/admin/')) {
    return; // network only for private
  }
  if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      }))
    );
  }
});
