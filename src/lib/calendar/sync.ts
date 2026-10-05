import { after } from "next/server";

import { calendarConfig, calendarConfigured } from "@/lib/calendar/config";
import { errorText } from "@/lib/calendar/error-text";
import { executeSteps } from "@/lib/calendar/execute";
import { createCalendarApi, GoogleApiError } from "@/lib/calendar/google-api";
import {
  createTokenSource,
  GoogleTokenError,
  type TokenSource,
} from "@/lib/calendar/google-oauth";
import { planSync } from "@/lib/calendar/plan";
import { createQueue, type Queue } from "@/lib/calendar/queue";
import {
  cronStaleSince,
  deriveState,
  summarize,
  type CalendarCronSummary,
  type CalendarStatus,
  type Counts,
} from "@/lib/calendar/report";
import { collectWishes } from "@/lib/calendar/sources";
import {
  blockConnection,
  calendarCounts,
  deleteRowsOfOtherCalendars,
  getConnection,
  listConnectedUserIds,
  listEventRows,
  readReminderHour,
  recordRun,
  stepStore,
  storeRefreshToken,
  touchCron,
} from "@/lib/calendar/store";
import { openToken, sealToken } from "@/lib/calendar/token-crypto";
import { todayInBerlin } from "@/lib/dates";
import { runIservCron } from "@/lib/iserv/abruf";
import { sendToUser, type PushPayload } from "@/lib/push";

/**
 * Der Abgleich mit Google — der Ablauf, der alles andere zusammensetzt.
 *
 * Ein Lauf geht in dieser Reihenfolge, und die Reihenfolge ist Absicht:
 *
 *   1. **App-Seite zuerst**, vor jedem Kontakt mit Google: Erinnerungsstunde,
 *      die Wünsche aller Quellen (@/lib/calendar/sources).
 *   2. **Zugang**: ein frisches Access Token. Das läuft in JEDEM Lauf, auch
 *      wenn es nichts zu tun gibt — es ist die stündliche Gesundheitsprüfung.
 *      Hat der Nutzer den Zugang entzogen, steht das nach spätestens einer
 *      Stunde in den Einstellungen, und eine Push-Nachricht sagt es.
 *   3. **Kalender**: Gibt es „Schule" noch?
 *   4. **Plan und Ausführung** (@/lib/calendar/plan, @/lib/calendar/execute).
 *   5. **Festhalten**, was herauskam — für die Karte in den Einstellungen.
 *
 * ── Immer nur ein Abgleich zur Zeit ──────────────────────────────────────────
 *
 * Abgleiche kommen aus drei Richtungen: aus `after()` nach jedem Speichern,
 * vom stündlichen Cron und vom Knopf „Jetzt abgleichen". Liefen zwei
 * gleichzeitig, läsen beide dieselben Zeilen und würden denselben Termin
 * zweimal löschen oder zweimal anlegen wollen. Deshalb stehen sie in einer
 * Queue (@/lib/calendar/queue) und laufen nacheinander.
 *
 * Die Queue lebt im Speicher, nicht in der Datenbank. Das reicht, weil der
 * Container genau einen Prozess hat (`next start`, siehe Dockerfile). Ein
 * Advisory Lock in Postgres ginge mit dem Pool von postgres-js nicht
 * zuverlässig — Sperre und Freigabe können auf verschiedenen Verbindungen
 * landen —, und PGlite hat ohnehin nur eine Verbindung. Sie hängt an
 * `globalThis` und nicht am Modul, aus demselben Grund wie die Datenbank in
 * src/db/index.ts: Next kann dieselbe Datei in zwei Bündeln zweimal
 * auswerten, und zwei Queues wären keine.
 *
 * Die zweite Verteidigung sind die festen Event-IDs: Rutscht doch ein
 * doppeltes Anlegen durch, endet es in Google mit 409 und wird übernommen.
 *
 * Wartet für einen Nutzer schon ein Lauf, der noch nicht begonnen hat, hängt
 * sich der nächste Auslöser an ihn: Der wartende liest die Datenbank erst beim
 * Start und nimmt die neue Änderung damit ohnehin mit. Seine Frist wird dabei
 * nur großzügiger, nie knapper, und wer eine Antwort braucht (Knopf, Cron),
 * wartet höchstens so lange, wie `LIMITS` es ihm erlaubt — Einzelheiten im
 * Kopf von @/lib/calendar/queue.
 *
 * ── Nichts scheitert still ───────────────────────────────────────────────────
 *
 * Jeder Fehler steht an vier Stellen: in der Karte in den Einstellungen, als
 * EINE Push-Nachricht beim Übergang nach „blockiert", als 500 der Cron-Route
 * (daraus werden `kalender.log` und die Störungsnotiz im Vault) und im
 * Container-Protokoll mit dem Präfix „Google-Kalender:".
 *
 * ── IServ ────────────────────────────────────────────────────────────────────
 *
 * Der stündliche Lauf holt, wenn es fällig ist, zuerst den Stand aus IServ
 * (@/lib/iserv/abruf, höchstens alle drei Stunden) und gleicht danach ab —
 * so sieht der Abgleich im selben Lauf schon den frischen Stand. Alle anderen
 * Läufe (nach einer Änderung, „Jetzt abgleichen") lesen nur den gespeicherten
 * Snapshot und fragen IServ nie.
 */

export type Anlass = "cron" | "hand" | "aenderung" | "verbinden";

export type SyncResult = Counts & {
  /** `laeuft`: Der Lauf war nach der Geduld des Anfragenden noch nicht fertig und arbeitet weiter. */
  status: "ok" | "fehler" | "blockiert" | "nicht-verbunden" | "aus" | "laeuft";
  unveraendert: number;
  sentence: string | null;
};

/** Länger darf ein einzelner Lauf nie arbeiten. */
const RUN_BUDGET_MS = 240_000;

/**
 * Zwei Grenzen je Anlass, beide ab dem Auslösen gerechnet: wie lange der Lauf
 * arbeiten darf (`arbeit`) und wie lange, wer ihn ausgelöst hat, höchstens auf
 * die Antwort wartet (`warten`).
 *
 * Der Cron antwortet vor dem `--max-time 300` von curl in `kalender.sh` — auch
 * dann, wenn er hinter einem anderen Lauf warten musste. Seine Arbeit endet bei
 * 270 Sekunden; die 15 Sekunden bis zum Ende seiner Geduld sind für den
 * Schritt, der dann noch läuft. Der Knopf soll nicht ewig hängen — was in
 * 25 Sekunden nicht geschafft ist, steht als „noch offen" da, und der nächste
 * Lauf macht weiter; hängt er hinter einem längeren Lauf, kommt er nach einer
 * halben Minute zurück, und die Karte sagt „läuft gerade". Nach einer Änderung
 * und nach dem Verbinden wartet niemand auf die Antwort; dort gilt nur die
 * Grenze für den Lauf selbst.
 */
const LIMITS: Record<Anlass, { arbeit: number; warten: number } | null> = {
  cron: { arbeit: 270_000, warten: 285_000 },
  hand: { arbeit: 25_000, warten: 30_000 },
  aenderung: null,
  verbinden: null,
};

const ZERO: Counts = { neu: 0, geaendert: 0, entfernt: 0, verworfen: 0, ausstehend: 0 };

const SATZ_ZUGANG =
  "Google lässt die App nicht mehr in den Kalender (invalid_grant): Der Zugang wurde entzogen oder ist abgelaufen.";
const SATZ_SCHLUESSEL =
  "Der gespeicherte Zugang lässt sich nicht entschlüsseln — GOOGLE_TOKEN_KEY hat sich geändert. Neu verbinden behebt es.";
const SATZ_KALENDER_WEG = "Den Kalender „Schule“ gibt es in Google nicht mehr.";
const SATZ_LAEUFT =
  "Ein Abgleich war nach Ablauf der Wartezeit noch nicht fertig und läuft weiter; sein Ergebnis steht danach in den Einstellungen. Kommt dieser Satz jede Stunde, hängt ein Lauf — dann den Container neu starten (sudo docker compose restart app).";

const QUELLEN: Record<string, string> = {
  klausur: "Prüfungen",
  hausaufgabe: "Hausaufgaben",
  frei: "Freie Tage",
  iserv: "IServ",
};

type BlockReason = "zugang" | "schluessel" | "kalender";

/** Die eine Nachricht beim Eintritt in „blockiert". */
const PUSH: Record<BlockReason, PushPayload> = {
  zugang: {
    title: "Google Kalender getrennt",
    body: "Die Schulapp kommt nicht mehr in deinen Kalender „Schule“. In den Einstellungen neu verbinden.",
    url: "/einstellungen",
    tag: "schulapp-kalender",
  },
  schluessel: {
    title: "Google Kalender getrennt",
    body: "Der gespeicherte Zugang passt nicht mehr zum Schlüssel auf dem Server. In den Einstellungen neu verbinden.",
    url: "/einstellungen",
    tag: "schulapp-kalender",
  },
  kalender: {
    title: "Kalender „Schule“ ist weg",
    body: "Die Schulapp trägt nichts mehr ein. In den Einstellungen neu anlegen oder trennen.",
    url: "/einstellungen",
    tag: "schulapp-kalender",
  },
};

export const SYNC_SENTENCES = {
  zugang: SATZ_ZUGANG,
  schluessel: SATZ_SCHLUESSEL,
  kalenderWeg: SATZ_KALENDER_WEG,
} as const;

const queue = ((globalThis as unknown as { __schulappKalenderQueue?: Queue<SyncResult> })
  .__schulappKalenderQueue ??= createQueue<SyncResult>());

function result(
  status: SyncResult["status"],
  sentence: string | null = null,
  counts: Counts = ZERO,
  unveraendert = 0,
): SyncResult {
  return { status, ...counts, unveraendert, sentence };
}

/**
 * Ein Abgleich für diesen Nutzer — in die Queue gestellt, nie neben einen
 * anderen. Wirft nie: Was schiefgeht, steht im Ergebnis, in der Datenbank und
 * im Protokoll. Mit `laeuft` kommt es zurück, wenn der Lauf am Ende der
 * Wartezeit aus `LIMITS` noch arbeitet.
 */
export function syncCalendar(
  userId: string,
  options: { anlass: Anlass; requestedAt?: number },
): Promise<SyncResult> {
  const requestedAt = options.requestedAt ?? Date.now();
  const grenze = LIMITS[options.anlass];

  return queue.request(
    userId,
    {
      frist: grenze === null ? null : requestedAt + grenze.arbeit,
      geduld: grenze === null ? null : requestedAt + grenze.warten,
    },
    (frist) => runSync(userId, frist),
    () => result("laeuft", SATZ_LAEUFT),
  );
}

/**
 * Nach einer Änderung in der App: einen Abgleich anstoßen, NACHDEM die Antwort
 * draußen ist (`after()`). Die Server Action wird dadurch nicht langsamer, und
 * ein Fehler bei Google lässt sie nicht scheitern — das Speichern ist da schon
 * geschehen.
 *
 * Ohne Umgebung tut das nichts, und zwar ohne eine Abfrage: Das läuft bei
 * jedem Speichern.
 *
 * `after()` außerhalb einer Anfrage wirft. Dann holt der nächste Cron die
 * Änderung nach; deshalb steht hier nur eine Zeile im Protokoll.
 */
export function requestCalendarSync(
  userId: string,
  anlass: "aenderung" | "verbinden" = "aenderung",
): void {
  if (!calendarConfigured()) return;

  try {
    after(async () => {
      try {
        await syncCalendar(userId, { anlass });
      } catch (fehler) {
        console.error("Google-Kalender: Abgleich nach Änderung abgebrochen", userId, errorText(fehler));
      }
    });
  } catch (fehler) {
    console.error("Google-Kalender: after() nicht verfügbar", errorText(fehler));
  }
}

/** Läuft für diesen Nutzer gerade ein Abgleich oder wartet einer? Für die Anzeige „läuft gerade". */
export function isCalendarSyncRunning(userId: string): boolean {
  return queue.busy(userId);
}

/**
 * „Verbindung unterbrochen" festhalten — und, wenn DIESER Aufruf es war, die
 * eine Push-Nachricht schicken. Ein Fehlschlag beim Schicken wird nur
 * protokolliert: Die Karte in den Einstellungen sagt es trotzdem.
 */
export async function blockAndNotify(
  userId: string,
  input: {
    reason: BlockReason;
    sentence: string;
    tokenEnc: string;
    calendarId: string | null;
  },
): Promise<SyncResult> {
  const first = await blockConnection(userId, input);

  if (first) {
    try {
      await sendToUser(userId, PUSH[input.reason]);
    } catch (fehler) {
      console.error("Google-Kalender: Push-Nachricht nicht verschickt", userId, errorText(fehler));
    }
  }

  console.error("Google-Kalender: blockiert", userId, input.reason, input.sentence);

  return result("blockiert", input.sentence);
}

/** Hat Google den Zugang wirklich entzogen? Ein zweites Erneuern sagt es. */
async function zugangEntzogen(tokens: TokenSource): Promise<boolean> {
  try {
    await tokens.renew();
    return false;
  } catch (fehler) {
    return fehler instanceof GoogleTokenError && fehler.kind === "invalid_grant";
  }
}

function tokenSentence(fehler: unknown): string {
  if (fehler instanceof GoogleTokenError) {
    if (fehler.kind === "invalid_client") {
      return "Google lehnt die Zugangsdaten der App ab (invalid_client) — GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET prüfen.";
    }
    if (fehler.kind === "anfrage") {
      return `Google lehnt das Erneuern des Zugangs ab (${fehler.message}).`;
    }
  }

  return "Google war beim Erneuern des Zugangs nicht erreichbar. Der nächste Lauf versucht es wieder.";
}

/** `frist`: die großzügigste Arbeitsgrenze aller, die auf diesen Lauf warten (siehe @/lib/calendar/queue). */
async function runSync(userId: string, frist: number | null): Promise<SyncResult> {
  const laufStart = Date.now();
  const deadline = Math.min(laufStart + RUN_BUDGET_MS, frist ?? Infinity);

  const cfg = calendarConfig();
  if (!cfg.ok) return result("aus");
  const config = cfg.config;

  try {
    const conn = await getConnection(userId);
    if (!conn?.refreshTokenEnc) return result("nicht-verbunden");

    // Blockiert heißt: kein Aufruf bei Google, bis ein Mensch etwas tut.
    if (conn.blockedAt) {
      return result("blockiert", conn.lastError ?? "Die Verbindung ist unterbrochen.");
    }

    let tokenEnc = conn.refreshTokenEnc;
    const cal = conn.calendarId;

    const block = (reason: BlockReason, sentence: string) =>
      blockAndNotify(userId, { reason, sentence, tokenEnc, calendarId: cal });

    if (!cal) return block("kalender", "Es ist kein Kalender „Schule“ vermerkt.");

    // 1. App-Seite, vor jedem Kontakt mit Google.
    const reminderHour = await readReminderHour(userId);
    const wishes = await collectWishes({
      userId,
      reminderHour,
      appOrigin: config.appOrigin,
    });
    const fehler = wishes.errors.map(
      (quelle) => `${QUELLEN[quelle.kind] ?? quelle.kind}: ${quelle.sentence}`,
    );

    const festhalten = async (
      counts: Counts,
      unveraendert: number,
    ): Promise<SyncResult> => {
      for (const satz of fehler) console.error("Google-Kalender:", userId, satz);

      const sentence =
        fehler.length === 0
          ? null
          : fehler[0] + (fehler.length > 1 ? ` (und ${fehler.length - 1} weitere)` : "");

      await recordRun(userId, {
        summary: summarize(counts),
        error: sentence ? { sentence } : null,
      });

      return result(sentence ? "fehler" : "ok", sentence, counts, unveraendert);
    };

    // 2. Zugang — in jedem Lauf, auch ohne Arbeit.
    let refresh: string;
    try {
      refresh = openToken(tokenEnc, config.tokenKey, userId);
    } catch {
      return block("schluessel", SATZ_SCHLUESSEL);
    }

    const tokens = createTokenSource(config, refresh, {
      onRotate: async (neu) => {
        const enc = sealToken(neu, config.tokenKey, userId);
        await storeRefreshToken(userId, tokenEnc, enc);
        tokenEnc = enc;
      },
    });

    try {
      await tokens.current();
    } catch (problem) {
      if (problem instanceof GoogleTokenError && problem.kind === "invalid_grant") {
        return block("zugang", SATZ_ZUGANG);
      }
      fehler.push(tokenSentence(problem));
      return festhalten(ZERO, 0);
    }

    const api = createCalendarApi({ tokens, deadline });

    // 3. Kalender.
    let zustand: Awaited<ReturnType<typeof api.calendarState>>;
    try {
      zustand = await api.calendarState(cal);
    } catch (problem) {
      if (!(problem instanceof GoogleApiError)) throw problem;
      if (problem.kind === "token" && (await zugangEntzogen(tokens))) {
        return block("zugang", SATZ_ZUGANG);
      }
      fehler.push(problem.sentence);
      return festhalten(ZERO, 0);
    }

    if (zustand === "fehlt") return block("kalender", SATZ_KALENDER_WEG);
    if (zustand === "kein-zugriff") {
      fehler.push("Google verweigert den Zugriff auf den Kalender „Schule“.");
      return festhalten(ZERO, 0);
    }

    // 4. Plan und Ausführung.
    await deleteRowsOfOtherCalendars(userId, cal);

    const plan = planSync({
      wanted: wishes.wanted,
      complete: wishes.complete,
      rows: await listEventRows(userId, cal),
      today: todayInBerlin(),
    });

    const executed = await executeSteps(plan.steps, {
      api,
      store: stepStore(userId, cal),
      calendarId: cal,
      deadline,
    });

    if (executed.stoppedBy === "kalender-weg") {
      return block("kalender", SATZ_KALENDER_WEG);
    }

    if (executed.stoppedBy === "token" && (await zugangEntzogen(tokens))) {
      return block("zugang", SATZ_ZUGANG);
    }

    for (const problem of executed.errors) {
      fehler.push(`„${problem.title}“: ${problem.sentence}`);
    }

    // 5. Festhalten.
    return festhalten(
      {
        neu: executed.neu,
        geaendert: executed.geaendert,
        entfernt: executed.entfernt,
        verworfen: executed.verworfen,
        ausstehend: executed.ausstehend,
      },
      plan.unveraendert,
    );
  } catch (unerwartet) {
    // Nur der Satz aus `errorText()`, nie das ganze Objekt: Eine gescheiterte
    // Abfrage trüge sonst ihre Parameter mit — bei `blockConnection()` das
    // versiegelte Refresh Token —, in die Karte, die Cron-Antwort und das Protokoll.
    const sentence = `Der Abgleich ist abgebrochen: ${errorText(unerwartet)}`;
    console.error("Google-Kalender: Lauf abgebrochen", userId, sentence);

    try {
      await recordRun(userId, { summary: "abgebrochen", error: { sentence } });
    } catch (auchDas) {
      console.error("Google-Kalender: Abbruch nicht festgehalten", userId, errorText(auchDas));
    }

    return result("fehler", sentence);
  }
}

/**
 * Der stündliche Lauf über alle Verbindungen.
 *
 * Zuerst wird bei jeder Verbindung `last_cron_at` gesetzt — das beweist, dass
 * die Crontab-Zeile lebt, auch wenn danach nichts zu tun ist. Fehlt die
 * Umgebung, läuft kein Abgleich; ob das ein Fehler ist, entscheidet
 * `cronFailure()` (ja, sobald etwas verbunden ist).
 *
 * Dann IServ, VOR den Abgleichen: Ist ein Abruf fällig, liest der Abgleich
 * gleich danach schon den frischen Stand. Sein Budget (60 Sekunden) zählt in
 * die 270 Sekunden dieses Laufs.
 */
export async function runCalendarCron(): Promise<CalendarCronSummary> {
  const start = Date.now();
  const date = todayInBerlin();
  const cfg = calendarConfig();
  const ids = await listConnectedUserIds();

  for (const id of ids) await touchCron(id);

  const summary: CalendarCronSummary = {
    date,
    verbunden: ids.length,
    blockiert: 0,
    mitFehlern: 0,
    ...ZERO,
    unveraendert: 0,
    missing: cfg.ok ? [] : cfg.missing,
    saetze: [],
    iserv: { status: "aus", satz: null },
  };

  if (!cfg.ok) return summary;

  const iserv = await runIservCron(ids, start);
  summary.iserv = { status: iserv.status, satz: iserv.satz };

  for (const id of ids) {
    const lauf = await syncCalendar(id, { anlass: "cron", requestedAt: start });

    summary.neu += lauf.neu;
    summary.geaendert += lauf.geaendert;
    summary.entfernt += lauf.entfernt;
    summary.verworfen += lauf.verworfen;
    summary.ausstehend += lauf.ausstehend;
    summary.unveraendert += lauf.unveraendert;

    if (lauf.status === "blockiert") {
      summary.blockiert += 1;
      summary.saetze.push(lauf.sentence ?? "Die Verbindung ist unterbrochen.");
    } else if (lauf.status === "fehler" || lauf.status === "laeuft") {
      // Ein Lauf, der nach 285 Sekunden noch arbeitet, ist kein Erfolg, den der
      // Cron melden kann: Ob er gelingt, weiß er nicht — und hängt einer, darf
      // das nicht Stunde um Stunde grün im Protokoll stehen.
      summary.mitFehlern += 1;
      summary.saetze.push(lauf.sentence ?? "Unbekannter Fehler.");
    }
  }

  return summary;
}

/**
 * Was die Karte in den Einstellungen zeigt.
 *
 * Ohne Umgebung KEINE Abfrage: Die Seite muss auch laufen, wenn die Tabellen
 * noch gar nicht eingespielt sind — genau das ist die Reihenfolge, die im Kopf
 * von scripts/google-kalender-tabellen.sql steht.
 */
export async function loadCalendarStatus(userId: string): Promise<CalendarStatus> {
  const config = calendarConfig();
  const running = isCalendarSyncRunning(userId);

  const leer: CalendarStatus = {
    state: deriveState({ config, row: null }),
    connectedAt: null,
    googleEmail: null,
    lastRunAt: null,
    lastSummary: null,
    lastError: null,
    cronStaleSince: null,
    running,
    geliefert: 0,
    verworfen: { count: 0, titles: [] },
  };

  if (!config.ok) return leer;

  const row = await getConnection(userId);
  if (!row) return leer;

  const state = deriveState({ config, row });
  const counts = row.calendarId
    ? await calendarCounts(userId, row.calendarId)
    : { geliefert: 0, verworfen: 0, verworfenTitel: [] };
  const verbunden = state.kind === "verbunden" || state.kind === "blockiert";

  return {
    state,
    connectedAt: verbunden ? row.connectedAt : null,
    googleEmail: row.googleEmail,
    lastRunAt: row.lastRunAt,
    lastSummary: row.lastSummary,
    lastError:
      row.lastError && row.lastErrorAt
        ? { sentence: row.lastError, at: row.lastErrorAt }
        : null,
    cronStaleSince: verbunden ? cronStaleSince(row, new Date()) : null,
    running,
    geliefert: counts.geliefert,
    verworfen: { count: counts.verworfen, titles: counts.verworfenTitel },
  };
}
