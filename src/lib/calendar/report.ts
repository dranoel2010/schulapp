import type { GoogleCalendarConnection } from "@/db/schema";
import type { ConfigResult } from "@/lib/calendar/config";
import type { IservLaufStatus } from "@/lib/iserv/types";

/**
 * Was die App über den Google Kalender sagt — in den Einstellungen und in der
 * Antwort des Crons.
 *
 * Reine Rechnung. Der Grundsatz dahinter steht über dem ganzen Abgleich: Nichts
 * scheitert still. Ein Zugang, der seit Tagen nicht mehr gilt, eine
 * Crontab-Zeile, die nach einem Update fehlt, ein Termin, den Google ablehnt —
 * jedes davon muss irgendwo stehen, wo ein Mensch es sieht. Die Erinnerungen
 * dieses Projekts waren zwölf Läufe tot, und gemerkt hat es niemand.
 */

export type CalendarState =
  | { kind: "nicht-eingerichtet"; missing: string[] }
  | { kind: "getrennt" }
  | {
      kind: "blockiert";
      reason: "zugang" | "schluessel" | "kalender";
      since: Date;
    }
  | { kind: "verbunden" };

const BLOCK_REASONS = ["zugang", "schluessel", "kalender"] as const;

/**
 * Der Zustand, in dieser Reihenfolge: Fehlt die Umgebung, ist alles andere
 * egal. Kein Token heißt getrennt. Blockiert vor verbunden — ein blockierter
 * Zugang ist auch ein vorhandener Zugang, aber kein brauchbarer.
 */
export function deriveState(input: {
  config: ConfigResult;
  row: Pick<
    GoogleCalendarConnection,
    "refreshTokenEnc" | "blockedAt" | "blockedReason"
  > | null;
}): CalendarState {
  if (!input.config.ok) {
    return { kind: "nicht-eingerichtet", missing: input.config.missing };
  }

  const row = input.row;
  if (!row?.refreshTokenEnc) return { kind: "getrennt" };

  if (row.blockedAt) {
    const reason = BLOCK_REASONS.find((value) => value === row.blockedReason);
    // Ein Grund, den diese Datei nicht kennt, ist am ehesten der häufigste.
    return { kind: "blockiert", reason: reason ?? "zugang", since: row.blockedAt };
  }

  return { kind: "verbunden" };
}

/** Zwei Stunden: Der Cron läuft stündlich, eine verpasste Stunde ist noch kein Alarm. */
export const CRON_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Seit wann der stündliche Lauf ausbleibt — oder `null`, wenn alles in Ordnung
 * ist.
 *
 * Ist er noch nie gelaufen, zählt die Verbindung: Wer gerade verbunden hat,
 * bekommt zwei Stunden, bevor die Karte warnt. Danach sagt sie es, denn eine
 * fehlende Zeile in `/etc/crontab` fällt sonst niemandem auf — die Termine
 * kommen ja weiter an, nur nicht mehr nachgeholt.
 */
export function cronStaleSince(
  row: Pick<GoogleCalendarConnection, "connectedAt" | "lastCronAt">,
  now: Date,
): Date | null {
  const grenze = now.getTime() - CRON_STALE_MS;

  if (row.lastCronAt && row.lastCronAt.getTime() >= grenze) return null;
  if (!row.lastCronAt && row.connectedAt.getTime() > grenze) return null;

  return row.lastCronAt ?? row.connectedAt;
}

/** Alles, was die Karte in den Einstellungen zeigt. */
export type CalendarStatus = {
  state: CalendarState;
  connectedAt: Date | null;
  googleEmail: string | null;
  lastRunAt: Date | null;
  lastSummary: string | null;
  lastError: { sentence: string; at: Date } | null;
  cronStaleSince: Date | null;
  running: boolean;
  geliefert: number;
  verworfen: { count: number; titles: string[] };
};

export type Counts = {
  neu: number;
  geaendert: number;
  entfernt: number;
  verworfen: number;
  ausstehend: number;
};

/**
 * „2 neu, 1 geändert, 1 entfernt, 1 von dir gelöscht, 3 Termine noch offen" —
 * die Zeile unter „Letzter Abgleich". Ohne Zeitstempel darin, den zeigt die
 * Karte daneben. Was null ist, fehlt; ist alles null, gab es nichts zu tun.
 */
export function summarize(counts: Counts): string {
  const teile: string[] = [];

  if (counts.neu > 0) teile.push(`${counts.neu} neu`);
  if (counts.geaendert > 0) teile.push(`${counts.geaendert} geändert`);
  if (counts.entfernt > 0) teile.push(`${counts.entfernt} entfernt`);
  if (counts.verworfen > 0) teile.push(`${counts.verworfen} von dir gelöscht`);
  if (counts.ausstehend > 0) {
    teile.push(
      `${counts.ausstehend} ${counts.ausstehend === 1 ? "Termin" : "Termine"} noch offen`,
    );
  }

  return teile.length > 0 ? teile.join(", ") : "nichts zu tun";
}

/** Was ein stündlicher Lauf getan hat — zugleich die Antwort der Cron-Route. */
export type CalendarCronSummary = Counts & {
  /** Kalendertag des Laufs in Berliner Zeit */
  date: string;
  /** Verbindungen mit Zugang, auch blockierte */
  verbunden: number;
  blockiert: number;
  mitFehlern: number;
  unveraendert: number;
  /** Was in der Umgebung fehlt — leer, wenn alles da ist */
  missing: string[];
  /** Je blockierter oder gescheiterter Verbindung der Satz dazu */
  saetze: string[];
  /**
   * Der Abruf bei IServ in diesem Lauf (@/lib/iserv/abruf). Nur Zustand und
   * ein fester Satz — nie ein Titel aus IServ.
   */
  iserv: { status: IservLaufStatus; satz: string | null };
};

/** Bei diesen Ausgängen ist der Abruf bei IServ ein Fehlschlag des Crons. */
const ISERV_FEHLSCHLAG: ReadonlySet<IservLaufStatus> = new Set(["fehler", "teilweise", "blockiert"]);

/**
 * Muss dieser Lauf als Fehlschlag gemeldet werden — und mit welchem Satz?
 *
 * `null` heißt Erfolg. Sonst ist die Zeichenkette der Satz, der als 500 in die
 * Antwort geht, damit `curl --fail-with-body` auf dem NAS daraus einen
 * Rückgabewert ungleich null macht und der Satz im Protokoll und in der
 * Störungsnotiz steht.
 *
 * Ausstehende Termine allein sind KEIN Fehler: Das Zeitbudget hat den Lauf
 * gekappt, und der nächste macht weiter.
 *
 * IServ kommt nach den drei Prüfungen des Google Kalenders: Ein gescheiterter,
 * teilweiser oder blockierter Abruf ist ein 500 — blockiert jede Stunde, bis
 * ein Mensch handelt, wie beim Google Kalender. Ein zurückgehaltener Stand
 * („behalten", @/lib/iserv/schutz) oder eine Warnung allein ist es nicht; die
 * stehen in der Karte und im Protokoll.
 */
export function cronFailure(summary: CalendarCronSummary): string | null {
  if (summary.missing.length > 0 && summary.verbunden > 0) {
    return (
      `Ein Google Kalender ist verbunden, aber auf dem Server fehlt ${summary.missing.join(", ")}. ` +
      "Der Kalender „Schule“ bleibt auf altem Stand, bis die Variablen in der .env und in der docker-compose.override.yml stehen."
    );
  }

  if (summary.blockiert > 0) {
    return `Der Google Kalender ist blockiert: ${summary.saetze[0] ?? "ohne Grund"} In den Einstellungen der App steht, was zu tun ist.`;
  }

  if (summary.mitFehlern > 0) {
    return (
      `Abgleich mit Google teilweise gescheitert: ${summary.saetze[0] ?? "ohne Grund"} ` +
      "Details in den Einstellungen und im Container-Protokoll (sudo docker compose logs app | grep Google-Kalender)."
    );
  }

  if (ISERV_FEHLSCHLAG.has(summary.iserv.status)) {
    return `IServ: ${summary.iserv.satz ?? "ohne Grund"} Details in den Einstellungen (Karte IServ).`;
  }

  return null;
}
