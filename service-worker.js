const CACHE_NAME = "astha-somiti-v1";

const APP_URL = "/Astha.somiti/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key.startsWith("astha-somiti-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      return (
        (await caches.match(event.request)) ||
        (event.request.mode === "navigate"
          ? await caches.match(APP_URL)
          : undefined) ||
        Response.error()
      );
    })
  );
});
