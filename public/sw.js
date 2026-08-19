/**
 * Service Worker der Schulapp.
 *
 * Ziel: die App bleibt ohne Netz lesbar.
 *  - /_next/static und /icons  → cache-first (die Dateinamen enthalten einen Hash,
 *    das Zeug ändert sich nie)
 *  - Seitenaufrufe             → network-first, sonst die zuletzt geladene Fassung,
 *    sonst die Offline-Seite
 *  - alles andere              → unangetastet ans Netz
 */

const VERSION = "schulapp-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          // Alles aus früheren Versionen wegräumen.
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, event));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(cacheFirst(request, event));
  }
});

async function cacheFirst(request, event) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.put(request, copy)));
  }
  return response;
}

async function networkFirst(request, event) {
  try {
    const response = await fetch(request);
    // Umgeleitete Antworten dürfen nicht in den Cache: der Browser weigert
    // sich, sie später für eine Navigation zu verwenden.
    if (response.ok && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(caches.open(PAGE_CACHE).then((c) => c.put(request, copy)));
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: PAGE_CACHE });
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return Response.error();
  }
}
