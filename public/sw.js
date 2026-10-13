/**
 * Service Worker der Schulapp.
 *
 * Ziel: die App bleibt ohne Netz lesbar.
 *  - /_next/static und /icons  → cache-first (die Dateinamen enthalten einen Hash,
 *    das Zeug ändert sich nie)
 *  - Seitenaufrufe             → network-first, sonst die zuletzt geladene Fassung,
 *    sonst die Offline-Seite. Für „/“ und die Stapelseiten ohne Netz die Shell
 *    mit den Daten aus dem Daten-Cache, wenn die neuer sind (siehe networkFirst)
 *  - Daten der Shell (Modell 23, Plan 2.4 Punkt 8): /api/seite/*, /api/tag/daten,
 *    /api/tag/stand und /api/ablauf → network-first in den eigenen Cache
 *    `schulapp-v3-daten`
 *  - alles andere              → unangetastet ans Netz
 */

const VERSION = "schulapp-v3";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const DATA_CACHE = `${VERSION}-daten`;

/**
 * Die Ausnahmen von „alles unter /api/ unberührt“ (Plan 2.4, Punkt 8). Dazu
 * der Ablauf nach der Schule: ohne ihn bliebe die Startseite beim Kaltstart
 * ohne Netz leer.
 */
function istShellDaten(pathname) {
  return (
    pathname.startsWith("/api/seite/") ||
    pathname === "/api/tag/daten" ||
    pathname === "/api/tag/stand" ||
    pathname === "/api/ablauf"
  );
}

/**
 * Wo die Seite nachsieht, ob ihre Navigation ohne Netz aus dem Cache kam
 * (src/components/kombi/shell.tsx, `navigationAusCache`). Ein Eintrag im
 * Daten-Cache statt eines Kopfes: die Kopfzeilen einer Navigation kann die
 * Seite nicht lesen.
 */
const NAV_MARKE = "/__schulapp/navigation";
const OFFLINE_URL = "/offline";

/**
 * Adressen, hinter denen eine Stapelseite steht — dieselben wie
 * `artAusSegmenten` in src/components/kombi/seiten/registry.tsx.
 */
const ID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const STAPEL_PFADE = new RegExp(
  `^/(?:(?:stundenplan|hausaufgaben|klausuren|noten|material|faecher|einstellungen)|(?:klausuren|material|faecher)/${ID}|noten/fach/${ID})/?$`,
);
function stapelPfad(pathname) {
  return STAPEL_PFADE.test(pathname);
}

/**
 * Die Datenadresse hinter einer Stapelseite — wie `artAusSegmenten` in
 * registry.tsx und `seiteHolen` in shell.tsx sie bilden.
 */
const EINFACH = {
  stundenplan: "woche",
  hausaufgaben: "hausaufgaben",
  klausuren: "klausuren",
  noten: "noten",
  material: "ablage",
  faecher: "faecher",
  einstellungen: "einstellungen",
};
const MIT_ID = { klausuren: "klausur", material: "blatt", faecher: "fach" };
function stapelDaten(pathname) {
  const s = pathname.split("/").filter(Boolean).map((x) => decodeURIComponent(x));
  let art = null;
  let id = null;
  if (s.length === 1 && Object.hasOwn(EINFACH, s[0])) art = EINFACH[s[0]];
  else if (s.length === 2 && Object.hasOwn(MIT_ID, s[0])) [art, id] = [MIT_ID[s[0]], s[1]];
  else if (s.length === 3 && s[0] === "noten" && s[1] === "fach") [art, id] = ["notenfach", s[2]];
  if (!art) return null;
  return new URL(`/api/seite/${art}${id ? `?${new URLSearchParams({ id })}` : ""}`, self.location.origin).href;
}

/** Wann eine Antwort in den Cache kam (0: unbekannt, etwa aus einer älteren Fassung des Workers). */
function gespeichertUm(response) {
  const t = response ? Date.parse(response.headers.get("x-schulapp-gespeichert") || "") : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Eine Antwort mit dem Zeitpunkt des Speicherns, für den Cache. */
async function mitZeitpunkt(response) {
  const headers = new Headers(response.headers);
  headers.set("x-schulapp-gespeichert", new Date().toISOString());
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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

  /*
   * Alles unter /api/ bleibt unangetastet — auch dann, wenn es als Navigation
   * hereinkommt.
   *
   * Der Fall, für den diese Zeile da ist, ist das Fach-PDF unter
   * /api/fach/<id>/pdf. Wer diese Adresse in die Adresszeile tippt oder einem
   * Link folgt, dessen `download` der Browser nicht beachtet, erzeugt eine
   * Anfrage mit `mode === "navigate"` — und ohne diese Zeile fiele sie in
   * networkFirst() und landete im PAGE_CACHE. Drei Gründe, warum das falsch
   * wäre:
   *
   *  1. Es altert falsch. Der PAGE_CACHE ist für Seiten da, deren Adresse
   *     dieselbe bleibt und deren Inhalt zur Not eine Version alt sein darf.
   *     Ein Fach-PDF ändert sich mit jedem neuen Blatt und mit jeder
   *     richtiggestellten Abschrift. Aus dem Cache käme still ein Dokument von
   *     vorletzter Woche.
   *  2. Es gehört nicht liegengelassen. Genau diese Überlegung steht in
   *     KONZEPT.md zu den Seitenbildern: „weil ein Schulblatt nicht
   *     versehentlich liegenbleiben soll". Ein Fach-PDF ist nicht ein Blatt,
   *     sondern alle auf einmal.
   *  3. Es ist zu groß. Ein Fach-PDF darf bis zu 40 MB Fotos tragen
   *     (PDF_IMAGE_BYTES in @/lib/pdf/subject-pdf). Der Cache-Speicher, aus
   *     dem im Zweifel die Offline-Seite kommt, ist nicht der Ort dafür.
   *
   * Für alle anderen Adressen unter /api/ ändert sich dadurch nichts: sie
   * kommen als fetch() herein, nicht als Navigation, und fielen ohnehin unten
   * durch. Die Zeile steht hier trotzdem als Regel und nicht als Sonderfall
   * für ein Pfadstück — die nächste Adresse, die eine Datei ausliefert, soll
   * nicht wieder daran denken müssen.
   */
  if (istShellDaten(url.pathname) && request.mode !== "navigate") {
    event.respondWith(datenNetworkFirst(request, event));
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

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
      event.waitUntil(
        mitZeitpunkt(copy).then((c) => caches.open(PAGE_CACHE).then((cache) => cache.put(request, c))),
      );
    }
    return response;
  } catch {
    const pfad = new URL(request.url).pathname;
    const cached = await caches.match(request, { cacheName: PAGE_CACHE });

    /*
     * „/“ und Stapelseiten: Das HTML im Cache trägt die Daten vom Zeitpunkt
     * seines Ladens. Was danach geschah (abgehakt, eingetragen), steht nur
     * im Daten-Cache — die Shell holt TagDaten und Seitendaten nach jeder
     * Action neu. Deshalb hier die Shell ausliefern und die Seite ihre Daten
     * aus dem Daten-Cache nehmen lassen, wenn die neuer sind als das HTML
     * der Adresse. Stapelseiten, die per pushState entstanden, haben gar
     * kein eigenes HTML; sie bekommen die Startseite unter ihrer Adresse,
     * und die Shell legt die Seite darauf.
     */
    const istStart = pfad === "/";
    if (istStart || stapelPfad(pfad)) {
      const start = istStart ? cached : await caches.match(new URL("/", self.location.origin).href, { cacheName: PAGE_CACHE });
      let antwort = cached;
      if (!istStart && start) {
        const datenUrl = stapelDaten(pfad);
        const daten = datenUrl ? await caches.match(datenUrl, { cacheName: DATA_CACHE }) : null;
        if (!cached || (daten && gespeichertUm(daten) >= gespeichertUm(cached))) antwort = start;
      }
      if (antwort) {
        // Für die Shell: diese Seite kam ohne Netz, Stand des HTML
        try {
          const cache = await caches.open(DATA_CACHE);
          await cache.put(
            new URL(NAV_MARKE, self.location.origin).href,
            new Response(
              JSON.stringify({
                pfad,
                zeit: Date.now(),
                gespeichert: gespeichertUm(antwort) || null,
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        } catch {
          // ohne Marke fehlt nur der Hinweis „Ohne Verbindung“
        }
        return antwort;
      }
    }

    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return Response.error();
  }
}

/**
 * Daten der Shell: erst das Netz; die Antwort wandert mit dem Zeitpunkt des
 * Speicherns (`x-schulapp-gespeichert`) in den Daten-Cache. Ohne Netz kommt
 * die letzte Fassung mit `x-schulapp-aus-cache: 1` — daran schreibt die
 * Seite „Ohne Verbindung · Stand ⟨Uhrzeit⟩“. Gibt es auch dort nichts, geht
 * der Fehler an die Shell (Toast „Keine Verbindung“).
 *
 * Nur erfolgreiche Antworten werden gemerkt: ein 401 nach dem Abmelden soll
 * keine alte Seite überschreiben und keine liefern.
 */
async function datenNetworkFirst(request, event) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const body = await response.clone().arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("x-schulapp-gespeichert", new Date().toISOString());
      const copy = new Response(body, { status: response.status, headers });
      event.waitUntil(caches.open(DATA_CACHE).then((c) => c.put(request, copy)));
    }
    return response;
  } catch (fehler) {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    if (!cached) throw fehler;
    const headers = new Headers(cached.headers);
    headers.set("x-schulapp-aus-cache", "1");
    return new Response(await cached.arrayBuffer(), { status: 200, headers });
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
