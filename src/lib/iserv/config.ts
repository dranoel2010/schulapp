import { normalisiere } from "@/lib/iserv/klasse";

/**
 * IServ — was die Umgebung dazu sagen muss, und die Konstanten.
 *
 * Reine Rechnung: keine Datenbank, kein Netz. `readIservConfig()` bekommt die
 * Umgebung hereingereicht und ist deshalb ohne gesetzte Variablen prüfbar;
 * `iservConfig()` liest `process.env` zur Aufrufzeit, nicht beim Laden des
 * Moduls — sonst fröre `next build` den Stand ohne Variablen ein. Dasselbe
 * Muster wie @/lib/calendar/config.
 *
 * Fehlt eine Pflichtvariable, ist die Funktion sauber aus: Kein Lauf fragt
 * die IServ-Tabellen ab, nichts geht ins Netz, und die Karte nennt nur die
 * NAMEN dessen, was fehlt.
 *
 * ── Das Passwort ─────────────────────────────────────────────────────────────
 *
 * Benutzer und Passwort des Schülers stehen NUR in der Umgebung (auf dem NAS
 * in der .env). Nie in der Datenbank, nie in einem Protokoll, einem
 * Fehlersatz, der Karte, der Antwort des Crons oder einer Push-Nachricht — und
 * nie bei einem KI-Agenten: Weder der Web MCP noch der Postbote lesen
 * irgendetwas aus IServ. Deshalb steckt das Passwort in `IservZugang` in einem
 * privaten Feld: `JSON.stringify()` und `console.log()` sehen davon nur
 * „«verborgen»“, und wer es braucht, bekommt es nur als fertigen Formularkörper
 * für die eine Anfrage, die es braucht. `schwaerze()` ist die zweite
 * Verteidigung für jeden Satz, der aus einer Antwort von IServ gebaut ist.
 */

/** Die Namen der Umgebungsvariablen — an einer Stelle, damit Meldung und Lesen nicht auseinanderlaufen. */
export const ENV = {
  url: "ISERV_URL",
  user: "ISERV_USER",
  password: "ISERV_PASSWORD",
  klasse: "ISERV_KLASSE",
  auch: "ISERV_AUCH",
  nie: "ISERV_NIE",
  klassenkalender: "ISERV_KLASSENKALENDER",
} as const;

// ── Pfade ────────────────────────────────────────────────────────────────────

export const EVENTSOURCES_PATH = "/iserv/calendar/api/eventsources";
export const LOGIN_PATH = "/iserv/auth/login";
export const LOGOUT_PATH = "/iserv/auth/logout";
/** Eine Weiterleitung hierher heißt außerhalb der Anmeldung: Die Session gilt nicht mehr. */
export const AUTH_PREFIX = "/iserv/auth/";
export const PUBLIC_CAL_ID = "/+public/calendar";

// ── Anfragen ────────────────────────────────────────────────────────────────

/** Ehrlich, wer da fragt: kein vorgetäuschter Browser. */
export const USER_AGENT = "Schulapp/1 (nur lesen)";
export const ACCEPT_LANGUAGE = "de-DE,de;q=0.9";
export const ANFRAGE_TIMEOUT_MS = 15_000;
export const MAX_ANTWORT_BYTES = 2 * 1024 * 1024;
/** Die Anmeldung braucht sieben Sprünge (302, Meta, 301, 302, Meta, 302); zwölf lassen Luft. */
export const MAX_SPRUENGE_LOGIN = 12;
export const MAX_SPRUENGE_DATEN = 3;

/** So lange darf ein Abruf im stündlichen Lauf dauern — er zählt in die 270 Sekunden des Kalender-Crons. */
export const LAUF_BUDGET_CRON_MS = 60_000;
/** „Erneut versuchen" in den Einstellungen. */
export const LAUF_BUDGET_HAND_MS = 45_000;

/** IServ beendet eine Session nach 16 Stunden; bei 15 meldet sich die App vorher neu an. */
export const SITZUNG_MAX_ALTER_MS = 15 * 3_600_000;

// ── Fenster und Grenzen ──────────────────────────────────────────────────────

export const FENSTER_ZURUECK_TAGE = 14;
export const FENSTER_VOR_TAGE = 365;

export const MAX_EINTRAEGE = 2000;
export const TITEL_MAX = 200;
export const ORT_MAX = 100;
export const BESCHREIBUNG_MAX = 500;
export const LABEL_MAX = 100;

const VERBORGEN = "IservZugang(«verborgen»)";
const ERSATZ = "«Passwort»";

/** Was im Text für das Passwort steht, in allen Formen, in denen es in einer Antwort auftauchen könnte. */
function formenDes(passwort: string): string[] {
  const html = passwort
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const formular = new URLSearchParams({ p: passwort }).toString().slice(2);

  const formen = new Set([
    passwort,
    encodeURIComponent(passwort),
    formular,
    html,
    html.replace(/&#39;/g, "&#x27;"),
  ]);

  // Die längste zuerst: Sonst ersetzte die kurze Form ein Stück der langen,
  // und der Rest bliebe stehen.
  return [...formen].filter((form) => form.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * Der Zugang zu IServ: Adresse, Benutzer, Passwort.
 *
 * Das Passwort liegt in einem privaten Feld und kommt nur als fertiger
 * Formularkörper heraus. `toJSON()` und die Darstellung für `console.log`
 * zeigen „«verborgen»“ — auch der Benutzername steht darin nicht.
 */
export class IservZugang {
  readonly #origin: string;
  readonly #user: string;
  readonly #password: string;

  constructor(origin: string, user: string, password: string) {
    this.#origin = origin;
    this.#user = user;
    this.#password = password;
  }

  /** z.B. "https://iserv.example.test" — ohne Pfad */
  get origin(): string {
    return this.#origin;
  }

  get user(): string {
    return this.#user;
  }

  /** Der Körper der einen POST-Anfrage an /iserv/auth/login. */
  formBody(): string {
    return new URLSearchParams({
      _username: this.#user,
      _password: this.#password,
    }).toString();
  }

  /**
   * Ersetzt das Passwort — im Klartext, URL-kodiert, als Formularwert
   * (Leerzeichen als +) und HTML-kodiert — und den Benutzernamen in einem
   * Text. Für jeden Satz, in den etwas aus einer Antwort geraten könnte.
   */
  schwaerze(text: string): string {
    let ergebnis = text;

    for (const form of formenDes(this.#password)) {
      ergebnis = ergebnis.split(form).join(ERSATZ);
    }

    // Kurze Benutzernamen nicht: Aus „ab" würde sonst jedes „ab" im Satz.
    if (this.#user.length >= 4) {
      ergebnis = ergebnis.split(this.#user).join("«Benutzer»");
    }

    return ergebnis;
  }

  toJSON(): string {
    return VERBORGEN;
  }

  toString(): string {
    return VERBORGEN;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return VERBORGEN;
  }
}

export type IservConfig = {
  zugang: IservZugang;
  /** 1–13; zum Schuljahreswechsel von Hand anheben */
  klasse: number;
  /** Normalisierte Titelteile aus ISERV_AUCH */
  auch: string[];
  /** Normalisierte Titelteile aus ISERV_NIE */
  nie: string[];
  /** Die id des Gruppenkalenders der Klasse, wenn die Erkennung nicht reicht */
  klassenkalender: string | null;
};

export type IservConfigResult =
  | { ok: true; config: IservConfig }
  | { ok: false; missing: string[] };

/** Ein leerer oder nur aus Leerzeichen bestehender Wert gilt als nicht gesetzt — wie in @/lib/calendar/config. */
function read(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * Der Origin, wenn die Adresse taugt, sonst null. https überall, http nur auf
 * dem eigenen Rechner (für die Attrappe in den Tests). Keine Zugangsdaten,
 * keine Query, kein Hash, kein Pfad: Die App hängt die Pfade selbst an.
 */
function validOrigin(value: string): string | null {
  if (value.includes("?") || value.includes("#")) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;

  return url.origin;
}

/** „msa; nachschreibetermin" → ["msa", "nachschreibetermin"]. Leere und einbuchstabige Teile entfallen. */
export function teileListe(value: string | null): string[] {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(";")
        .map((teil) => normalisiere(teil))
        .filter((teil) => teil.length >= 2),
    ),
  ];
}

/**
 * Liest und prüft die Umgebung. `missing` nennt jede Variable, die fehlt oder
 * nicht taugt — nur den NAMEN, nie den Wert.
 */
export function readIservConfig(env: Record<string, string | undefined>): IservConfigResult {
  const missing: string[] = [];

  const rawUrl = read(env, ENV.url);
  const origin = rawUrl ? validOrigin(rawUrl) : null;
  if (!rawUrl) missing.push(ENV.url);
  else if (!origin) missing.push(`${ENV.url} (ungültig)`);

  const user = read(env, ENV.user);
  if (!user) missing.push(ENV.user);
  else if (/[\r\n]/.test(user)) missing.push(`${ENV.user} (Zeilenumbruch)`);

  // Nicht getrimmt: Leerzeichen am Rand sind Teil des Passworts.
  const password = env[ENV.password];
  const passwordOk = typeof password === "string" && password.trim() !== "";
  if (!passwordOk) missing.push(ENV.password);
  else if (/[\r\n]/.test(password)) missing.push(`${ENV.password} (Zeilenumbruch)`);

  // Bewusst ohne Standardwert: Er würde zum Schuljahreswechsel still falsch.
  const rawKlasse = read(env, ENV.klasse);
  const klasse = rawKlasse && /^\d{1,2}$/.test(rawKlasse) ? Number(rawKlasse) : null;
  if (!rawKlasse) missing.push(ENV.klasse);
  else if (klasse === null || klasse < 1 || klasse > 13) missing.push(`${ENV.klasse} (1–13)`);

  const klassenkalender = read(env, ENV.klassenkalender);
  if (klassenkalender && !/^\/[^/]+\/calendar$/.test(klassenkalender)) {
    missing.push(`${ENV.klassenkalender} (ungültig)`);
  }

  if (
    missing.length > 0 ||
    !origin ||
    !user ||
    !passwordOk ||
    klasse === null
  ) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      zugang: new IservZugang(origin, user, password),
      klasse,
      auch: teileListe(read(env, ENV.auch)),
      nie: teileListe(read(env, ENV.nie)),
      klassenkalender,
    },
  };
}

/** Die Umgebung dieses Prozesses, zur Aufrufzeit gelesen. */
export function iservConfig(): IservConfigResult {
  return readIservConfig(process.env);
}

/** Ist IServ eingeschaltet? Nur die Umgebung, keine Datenbank. */
export function iservConfigured(): boolean {
  return iservConfig().ok;
}
