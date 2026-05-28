const CACHE_PREFIX = 'resto-control-';
const STATIC_CACHE = `${CACHE_PREFIX}static-v1`;
const NO_STORE_PATHS = new Set(['/app-version.json', '/manifest.webmanifest', '/manifest-bookings.webmanifest', '/sw.js']);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)))));
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Resto Control', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Resto Control';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '',
    icon: payload.icon || '/resto-control-logo.png',
    badge: payload.badge || '/icon.svg',
    tag: payload.tag || 'resto-control',
    data: payload.data || { url: '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin !== self.location.origin) continue;
      await client.focus();
      if ('navigate' in client) return client.navigate(targetUrl);
      return undefined;
    }
    return clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (NO_STORE_PATHS.has(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg' || url.pathname === '/resto-control-logo.png') {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw new Error('Нет сети и файл не найден в кеше');
        }
      })
    );
  }
});
