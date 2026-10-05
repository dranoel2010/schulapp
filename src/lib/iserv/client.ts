import {
  ACCEPT_LANGUAGE,
  ANFRAGE_TIMEOUT_MS,
  AUTH_PREFIX,
  LOGIN_PATH,
  LOGOUT_PATH,
  MAX_ANTWORT_BYTES,
  MAX_SPRUENGE_DATEN,
  MAX_SPRUENGE_LOGIN,
  SITZUNG_MAX_ALTER_MS,
  USER_AGENT,
  type IservZugang,
} from "@/lib/iserv/config";
import { CookieJar } from "@/lib/iserv/cookies";
import {
  hatZweiterFaktorFeld,
  istLoginFormular,
  metaRefreshZiel,
  ordneLoginEin,
} from "@/lib/iserv/html";

/**
 * Der Weg zu IServ — anmelden, eine Session halten, JSON lesen. NUR lesen.
 *
 * `fetch` wird hereingereicht (in den Tests eine Attrappe von IServ, siehe
 * @/lib/iserv/fixtures). Datenbank gibt es hier keine.
 *
 * ── Nur lesen, und das prüft der Client selbst ───────────────────────────────
 *
 * Es gibt genau eine schreibende Anfrage: POST /iserv/auth/login mit Benutzer
 * und Passwort. Alles andere ist GET — auch das Folgen einer Weiterleitung
 * nach dem POST. `erlaubteAnfrage()` wirft, bevor ein POST an irgendeinen
 * anderen Pfad hinausginge. Nichts wird gesendet, abgegeben oder geändert.
 *
 * ── Höflich ──────────────────────────────────────────────────────────────────
 *
 * Eine Anmeldung kostet etwa acht Anfragen und steht in den „Letzten
 * Anmeldungen" des Schülers und in den Protokollen der Schule. Deshalb:
 *
 * - Die Session lebt im Speicher (`sitzungsSpeicher()`) und wird
 *   wiederverwendet, bis IServ sie verwirft oder sie 15 Stunden alt ist
 *   (IServ beendet sie nach 16).
 * - Höchstens EINE Anmeldung je Client, also je Lauf. Verwirft IServ die
 *   frische Session gleich wieder, endet der Lauf mit „session", statt es in
 *   einer Schleife zu versuchen.
 * - Eine abgelehnte Anmeldung (falsches Passwort, zweiter Faktor, Captcha,
 *   Sperre, abgelaufenes Passwort) SPERRT: `IservFehler.sperrt`. Der Aufrufer
 *   versucht es danach nicht noch einmal, bis ein Mensch handelt — sonst
 *   sperrte die App das Konto des Schülers mit Fehlversuchen.
 * - Kein Logout im Betrieb. Die Wiederverwendung braucht die Session, und
 *   IServ beendet sie ohnehin selbst. Nur die Probe (scripts/iserv-probe.mts)
 *   meldet sich ab.
 *
 * ── Was nie in einen Satz oder ins Protokoll kommt ──────────────────────────
 *
 * Cookie-Werte, `Set-Cookie`, und Adressen mit Query: Die Ziele der
 * Meta-Weiterleitungen tragen den `code` und den `state` von OpenID Connect.
 * Ein Fehlersatz nennt höchstens den Status und einen Pfad, und er geht
 * durch `zugang.schwaerze()`.
 */

export type IservFehlerArt =
  // sperrend: Ohne einen Handgriff des Menschen geht nichts mehr.
  | "abgelehnt"
  | "zweiter-faktor"
  | "gesperrt"
  | "captcha"
  | "passwort-abgelaufen"
  // nicht sperrend: Der nächste Lauf versucht es wieder.
  | "unerwartet"
  | "session"
  | "format"
  | "verweigert"
  | "fehlt"
  | "voruebergehend"
  | "budget"
  | "fremde-adresse"
  | "zu-gross";

export const SPERR_ARTEN: ReadonlySet<IservFehlerArt> = new Set<IservFehlerArt>([
  "abgelehnt",
  "zweiter-faktor",
  "gesperrt",
  "captcha",
  "passwort-abgelaufen",
]);

/** Ein Fehler mit festem deutschem Satz — der Satz ist das Einzige, was nach außen geht. */
export class IservFehler extends Error {
  readonly art: IservFehlerArt;
  readonly sperrt: boolean;
  readonly satz: string;

  constructor(art: IservFehlerArt, satz: string) {
    super(satz);
    this.name = "IservFehler";
    this.art = art;
    this.sperrt = SPERR_ARTEN.has(art);
    this.satz = satz;
  }
}

/** Die festen Sätze. `ort` ist höchstens „HTTP 500 auf /iserv/…" — ein Pfad, nie eine Query. */
export const FEHLER_SAETZE: Record<IservFehlerArt, (ort: string) => string> = {
  abgelehnt: () => "IServ hat die Anmeldung abgelehnt (Benutzername oder Passwort falsch?).",
  "zweiter-faktor": () => "IServ verlangt bei der Anmeldung einen zweiten Faktor.",
  gesperrt: () => "IServ meldet das Konto als gesperrt oder zu viele Fehlversuche.",
  captcha: () => "IServ verlangt bei der Anmeldung ein Captcha.",
  "passwort-abgelaufen": () => "IServ verlangt ein neues Passwort.",
  unerwartet: (ort) => `Die Anmeldung bei IServ endete unerwartet${ort}.`,
  session: (ort) => `IServ hat die frische Anmeldung gleich wieder verworfen${ort}.`,
  format: (ort) => `IServ antwortet in einem unerwarteten Format${ort}.`,
  verweigert: (ort) => `IServ verweigert den Zugriff${ort}.`,
  fehlt: (ort) => `Diesen Teil gibt es in IServ nicht${ort}.`,
  voruebergehend: (ort) => `IServ war nicht erreichbar${ort} — der nächste Lauf versucht es wieder.`,
  budget: () => "Die Zeit für diesen Lauf war um, bevor IServ fertig gelesen war — der nächste Lauf versucht es wieder.",
  "fremde-adresse": () => "IServ leitet auf eine fremde Adresse um — die App folgt dem nicht.",
  "zu-gross": (ort) => `Die Antwort von IServ ist größer als 2 MB${ort}.`,
};

// ── Der Sitzungsspeicher ─────────────────────────────────────────────────────

export type Sitzung = {
  origin: string;
  user: string;
  jar: CookieJar;
  angemeldetAm: number;
};

export type SitzungsSpeicher = {
  holen(origin: string, user: string): Sitzung | null;
  setzen(sitzung: Sitzung): void;
  vergessen(): void;
};

/** Ein frischer Speicher — für die Probe und die Tests. */
export function neuerSitzungsSpeicher(): SitzungsSpeicher {
  let aktuell: Sitzung | null = null;

  return {
    holen(origin, user) {
      return aktuell && aktuell.origin === origin && aktuell.user === user ? aktuell : null;
    },
    setzen(sitzung) {
      aktuell = sitzung;
    },
    vergessen() {
      aktuell = null;
    },
  };
}

/**
 * Der Speicher des Prozesses — an `globalThis`, aus demselben Grund wie die
 * Queue in @/lib/calendar/sync: Next kann dieselbe Datei in zwei Bündeln
 * zweimal auswerten, und zwei Speicher hießen zwei Anmeldungen.
 */
export function sitzungsSpeicher(): SitzungsSpeicher {
  const global = globalThis as unknown as { __schulappIservSitzung?: SitzungsSpeicher };
  return (global.__schulappIservSitzung ??= neuerSitzungsSpeicher());
}

// ── Nur lesen ────────────────────────────────────────────────────────────────

/** Wirft, bevor etwas anderes als die Anmeldung gesendet würde. */
export function erlaubteAnfrage(methode: "GET" | "POST", pfad: string): void {
  if (methode === "POST" && pfad !== LOGIN_PATH) {
    throw new Error(`IServ: Die App sendet nur die Anmeldung, nicht ${pfad}.`);
  }
}

// ── Der Client ───────────────────────────────────────────────────────────────

type Antwort = {
  status: number;
  url: URL;
  location: string | null;
  text: string;
};

export type IservClient = {
  getJson(urlOderPfad: string, params?: Record<string, string>): Promise<unknown>;
  logout(): Promise<void>;
  /** Wie oft dieser Client sich angemeldet hat — 0 oder 1 */
  readonly logins: number;
  /** Jede Anfrage, nur Methode und Pfad — für die Tests „außer der Anmeldung nur GET" */
  readonly anfragen: readonly { methode: "GET" | "POST"; pfad: string }[];
};

/** Die Session gilt nicht (mehr) — kein Fehler nach außen, sondern ein Grund für eine Anmeldung. */
const UNGUELTIG = Symbol("ungueltig");

export function createIservClient(
  zugang: IservZugang,
  deps: {
    fetch?: typeof fetch;
    now?: () => number;
    /** Zeitpunkt (ms), bis zu dem der Lauf fertig sein will */
    deadline: number;
    speicher: SitzungsSpeicher;
  },
): IservClient {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const origin = zugang.origin;
  const anfragen: { methode: "GET" | "POST"; pfad: string }[] = [];
  let logins = 0;

  const fehler = (art: IservFehlerArt, ort = ""): IservFehler =>
    new IservFehler(art, zugang.schwaerze(FEHLER_SAETZE[art](ort)));

  /** Nur der Pfad, nie die Query. */
  const auf = (url: URL, status?: number): string =>
    status === undefined ? ` (${url.pathname})` : ` (HTTP ${status} auf ${url.pathname})`;

  function pruefeOrigin(url: URL): void {
    if (url.origin !== origin) throw fehler("fremde-adresse");
  }

  /** Ein Weiterleitungsziel als Adresse — eine unlesbare wirft mit festem Satz, nie mit der Adresse darin. */
  function ziel(wohin: string, basis: URL, art: "unerwartet" | "format"): URL {
    try {
      return new URL(wohin, basis);
    } catch {
      throw fehler(art, ` (unlesbare Weiterleitung von ${basis.pathname})`);
    }
  }

  /** Den Körper lesen, aber höchstens 2 MB — sonst Abbruch. */
  async function koerper(response: Response, url: URL): Promise<string> {
    const laenge = Number(response.headers.get("content-length"));
    if (Number.isFinite(laenge) && laenge > MAX_ANTWORT_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw fehler("zu-gross", auf(url));
    }
    if (!response.body) return "";

    const reader = response.body.getReader();
    const teile: Uint8Array[] = [];
    let gelesen = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      gelesen += value.byteLength;
      if (gelesen > MAX_ANTWORT_BYTES) {
        await reader.cancel().catch(() => {});
        throw fehler("zu-gross", auf(url));
      }
      teile.push(value);
    }

    const alles = new Uint8Array(gelesen);
    let stelle = 0;
    for (const teil of teile) {
      alles.set(teil, stelle);
      stelle += teil.byteLength;
    }

    return new TextDecoder("utf-8").decode(alles);
  }

  async function anfrage(
    methode: "GET" | "POST",
    url: URL,
    jar: CookieJar,
    options: { accept: "json" | "html"; body?: string },
  ): Promise<Antwort> {
    erlaubteAnfrage(methode, url.pathname);
    pruefeOrigin(url);

    const rest = deps.deadline - now();
    if (rest < ANFRAGE_TIMEOUT_MS + 1000) throw fehler("budget");

    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      "accept-language": ACCEPT_LANGUAGE,
      accept: options.accept === "json" ? "application/json" : "text/html",
    };
    const cookie = jar.header(url, now());
    if (cookie) headers.cookie = cookie;
    if (methode === "POST") headers["content-type"] = "application/x-www-form-urlencoded";

    anfragen.push({ methode, pfad: url.pathname });

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: methode,
        headers,
        body: options.body,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(ANFRAGE_TIMEOUT_MS, rest)),
      });
    } catch (problem) {
      const name = problem instanceof Error ? problem.name : "";
      const wie = name === "TimeoutError" || name === "AbortError" ? "Zeitüberschreitung" : "Netz";
      throw fehler("voruebergehend", ` (${wie} bei ${url.pathname})`);
    }

    jar.setFrom(response.headers.getSetCookie?.() ?? [], url, now());

    if (response.status >= 500 || response.status === 429) {
      await response.body?.cancel().catch(() => {});
      throw fehler("voruebergehend", auf(url, response.status));
    }

    let text: string;
    try {
      text = await koerper(response, url);
    } catch (problem) {
      if (problem instanceof IservFehler) throw problem;
      throw fehler("voruebergehend", ` (Netz bei ${url.pathname})`);
    }

    return { status: response.status, url, location: response.headers.get("location"), text };
  }

  /** Weiterleitungen und Meta-Refresh folgen, solange es welche gibt — höchstens `max`. */
  async function folgeAnmeldung(start: Antwort, jar: CookieJar): Promise<Antwort> {
    let aktuell = start;

    for (let sprung = 0; ; sprung += 1) {
      let wohin: string | null = null;

      if (aktuell.status >= 300 && aktuell.status < 400) {
        if (!aktuell.location) throw fehler("unerwartet", auf(aktuell.url, aktuell.status));
        wohin = aktuell.location;
      } else if (aktuell.status === 200) {
        wohin = metaRefreshZiel(aktuell.text);
      }

      if (wohin === null) return aktuell;
      if (sprung >= MAX_SPRUENGE_LOGIN) throw fehler("unerwartet", ` (mehr als ${MAX_SPRUENGE_LOGIN} Weiterleitungen)`);

      aktuell = await anfrage("GET", ziel(wohin, aktuell.url, "unerwartet"), jar, { accept: "html" });
    }
  }

  async function login(speicher: SitzungsSpeicher): Promise<Sitzung> {
    speicher.vergessen();
    const jar = new CookieJar();
    const loginUrl = new URL(LOGIN_PATH, origin);

    // 1. Die Login-Seite holen — sie setzt die ersten Cookies.
    const seite = await folgeAnmeldung(
      await anfrage("GET", loginUrl, jar, { accept: "html" }),
      jar,
    );
    if (seite.status !== 200 || !istLoginFormular(seite.text)) {
      throw fehler("unerwartet", ` (keine Login-Seite auf ${seite.url.pathname})`);
    }

    // 2. Die eine schreibende Anfrage. Kein _remember_me, kein CSRF-Feld
    //    (die Seite hat keins, nachgesehen am 5.10.2026).
    logins += 1;
    const ende = await folgeAnmeldung(
      await anfrage("POST", loginUrl, jar, { accept: "html", body: zugang.formBody() }),
      jar,
    );
    const finalPath = ende.url.pathname;

    // 3. Angemeldet? Erst danach wird nach einem Grund gesucht: Auf der
    //    Startseite von IServ kann „gesperrt" in einer Neuigkeit stehen.
    const drin =
      ende.status === 200 &&
      jar.has("IServSession") &&
      !finalPath.startsWith(AUTH_PREFIX) &&
      !istLoginFormular(ende.text) &&
      !hatZweiterFaktorFeld(ende.text);

    if (!drin) {
      const art = ordneLoginEin(finalPath, ende.text);
      if (art) throw fehler(art);
      throw fehler("unerwartet", auf(ende.url, ende.status));
    }

    const sitzung: Sitzung = { origin, user: zugang.user, jar, angemeldetAm: now() };
    speicher.setzen(sitzung);
    return sitzung;
  }

  /** Eine Anfrage mit dieser Session — JSON, oder UNGUELTIG, wenn IServ zur Anmeldung schickt. */
  async function versuch(url: URL, jar: CookieJar): Promise<unknown | typeof UNGUELTIG> {
    let aktuell = await anfrage("GET", url, jar, { accept: "json" });

    for (let sprung = 0; aktuell.status >= 300 && aktuell.status < 400; sprung += 1) {
      if (!aktuell.location) throw fehler("format", auf(aktuell.url, aktuell.status));

      const weiter = ziel(aktuell.location, aktuell.url, "format");
      pruefeOrigin(weiter);
      if (weiter.pathname.startsWith(AUTH_PREFIX)) return UNGUELTIG;
      if (sprung >= MAX_SPRUENGE_DATEN) throw fehler("format", ` (zu viele Weiterleitungen bei ${url.pathname})`);

      aktuell = await anfrage("GET", weiter, jar, { accept: "json" });
    }

    if (aktuell.status === 401) return UNGUELTIG;
    if (aktuell.status === 403) throw fehler("verweigert", auf(aktuell.url, 403));
    if (aktuell.status === 404) throw fehler("fehlt", auf(aktuell.url, 404));
    if (aktuell.status !== 200) throw fehler("format", auf(aktuell.url, aktuell.status));

    const text = aktuell.text.trim();
    if (!text.startsWith("[") && !text.startsWith("{")) {
      const meta = metaRefreshZiel(aktuell.text);
      const zurAnmeldung = meta !== null && ziel(meta, aktuell.url, "format").pathname.startsWith(AUTH_PREFIX);
      if (istLoginFormular(aktuell.text) || zurAnmeldung) return UNGUELTIG;
      throw fehler("format", ` (kein JSON von ${aktuell.url.pathname})`);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw fehler("format", ` (kaputtes JSON von ${aktuell.url.pathname})`);
    }
  }

  return {
    get logins() {
      return logins;
    },
    anfragen,

    async getJson(urlOderPfad, params = {}) {
      const url = new URL(urlOderPfad, origin);
      pruefeOrigin(url);
      for (const [name, wert] of Object.entries(params)) url.searchParams.set(name, wert);

      const speicher = deps.speicher;
      let sitzung = speicher.holen(origin, zugang.user);

      try {
        if (!sitzung || now() - sitzung.angemeldetAm > SITZUNG_MAX_ALTER_MS) {
          if (logins > 0) throw fehler("session", auf(url));
          sitzung = await login(speicher);
        }

        const ergebnis = await versuch(url, sitzung.jar);
        if (ergebnis !== UNGUELTIG) return ergebnis;

        // Die gemerkte Session gilt nicht mehr — einmal neu anmelden, aber
        // nur, wenn dieser Client es noch nicht getan hat.
        speicher.vergessen();
        if (logins > 0) throw fehler("session", auf(url));

        sitzung = await login(speicher);
        const zweiter = await versuch(url, sitzung.jar);
        if (zweiter === UNGUELTIG) {
          speicher.vergessen();
          throw fehler("session", auf(url));
        }
        return zweiter;
      } catch (problem) {
        if (problem instanceof IservFehler && problem.sperrt) speicher.vergessen();
        throw problem;
      }
    },

    async logout() {
      const speicher = deps.speicher;
      const sitzung = speicher.holen(origin, zugang.user);

      try {
        if (!sitzung) return;
        let aktuell = await anfrage("GET", new URL(LOGOUT_PATH, origin), sitzung.jar, { accept: "html" });

        for (let sprung = 0; aktuell.status >= 300 && aktuell.status < 400 && aktuell.location; sprung += 1) {
          if (sprung >= MAX_SPRUENGE_LOGIN) break;
          aktuell = await anfrage("GET", ziel(aktuell.location, aktuell.url, "unerwartet"), sitzung.jar, { accept: "html" });
        }
      } finally {
        sitzung?.jar.clear();
        speicher.vergessen();
      }
    },
  };
}
