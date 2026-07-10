/* WorkHub service worker — public shell + offline fallback; never cache private APIs */
const CACHE = 'workhub-shell-v2';
const SHELL = [
  '/',
  '/offline.html',
  '/css/style.css',
  '/css/utilities.css',
  '/js/api.js',
  '/js/domSafe.js',
  '/js/main.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPrivatePath(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/host/') ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/payment') ||
    pathname.startsWith('/booking/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept private surfaces — network only
  if (isPrivatePath(url.pathname)) return;

  // Static assets: stale-while-revalidate
  if (
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Navigations: network first, offline shell fallback
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache successful public HTML lightly
          if (res && res.ok && url.pathname === '/') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(req)) ||
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        })
    );
  }
});

// Push notifications (requires VAPID + Push API subscription)
self.addEventListener('push', (event) => {
  let data = { title: 'WorkHub', body: 'Bạn có thông báo mới' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    /* ignore */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'WorkHub', {
      body: data.body || '',
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Allow page to ask SW to skip waiting after deploy
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
