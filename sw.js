const CACHE_NAME = 'astha-somiti-v18-personal-ledger';
const APP_SHELL_URL = new URL('./', self.registration.scope).href;

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(name => name.startsWith('astha-somiti-') && name !== CACHE_NAME)
           .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first navigation prevents an old cached HTML shell from breaking
  // Firebase auth restoration after refresh. Cache is only an offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok && response.type === 'basic') {
          await cache.put(request, response.clone());
          await cache.put(APP_SHELL_URL, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request) || await cache.match(APP_SHELL_URL);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Other same-origin assets also prefer the current network version.
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      return cached || Response.error();
    }
  })());
});
