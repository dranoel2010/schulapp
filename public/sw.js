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

const VERSION = "schulapp-v2";
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

/* ------------------------------------------------------------------ *
 * Push-Nachrichten
 *
 * Der Server schickt JSON: { title, body, url, tag }. Kommt etwas anderes
 * an, zeigen wir trotzdem eine Nachricht — eine stumme Benachrichtigung
 * lässt Android sonst als Fehler stehen.
 * ------------------------------------------------------------------ */

const FALLBACK_NOTIFICATION = {
  title: "Schulapp",
  body: "Zeit für die Schulapp.",
  url: "/",
  tag: "schulapp",
};

self.addEventListener("push", (event) => {
  const data = readPayload(event.data);

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      // Gleiches tag ersetzt die vorige Nachricht; renotify sorgt dafür, dass
      // die neue trotzdem einmal meldet statt still zu tauschen.
      renotify: true,
      lang: "de",
      data: { url: data.url },
    }),
  );
});

function readPayload(payload) {
  if (!payload) return FALLBACK_NOTIFICATION;

  let parsed;
  try {
    parsed = payload.json();
  } catch {
    // Kein JSON — dann eben der reine Text.
    const plain = payload.text();
    return {
      ...FALLBACK_NOTIFICATION,
      body: plain || FALLBACK_NOTIFICATION.body,
    };
  }

  if (!parsed || typeof parsed !== "object") return FALLBACK_NOTIFICATION;

  return {
    title: stringOr(parsed.title, FALLBACK_NOTIFICATION.title),
    body: stringOr(parsed.body, FALLBACK_NOTIFICATION.body),
    url: stringOr(parsed.url, FALLBACK_NOTIFICATION.url),
    tag: stringOr(parsed.tag, FALLBACK_NOTIFICATION.tag),
  };
}

/** Nur brauchbare Zeichenketten durchlassen, sonst den Standard. */
function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(openApp(url || "/"));
});

/** Ein offenes Fenster der App nach vorn holen, statt ein zweites zu öffnen. */
async function openApp(url) {
  const target = new URL(url, self.location.origin);

  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    if (new URL(client.url).origin !== target.origin) continue;

    if (client.url !== target.href && "navigate" in client) {
      try {
        const navigated = await client.navigate(target.href);
        if (navigated) return navigated.focus();
      } catch {
        // Manche Browser verweigern navigate — dann bleibt das Fenster, wo es ist.
      }
    }

    return client.focus();
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(target.href);
  }
}
