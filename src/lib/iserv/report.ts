import type { IservStateRow } from "@/db/schema";
import type { Eintrag, IservAuswertung } from "@/lib/iserv/auswahl";
import type { IservConfigResult } from "@/lib/iserv/config";
import type { Snapshot } from "@/lib/iserv/schutz";
import type { ErkannteQuelle, IservQuelle, IservRolle } from "@/lib/iserv/types";

/**
 * Was die App über IServ sagt — in der Karte in den Einstellungen.
 *
 * Reine Rechnung, nach dem Muster von @/lib/calendar/report. Derselbe
 * Grundsatz: Nichts scheitert still. Eine abgelehnte Anmeldung, ein IServ,
 * das seit einem Tag nicht antwortet, ein Termin, der knapp draußen blieb —
 * jedes davon steht in der Karte, mit dem, was zu tun ist.
 *
 * In keinem Satz hier steht das Passwort oder der Benutzername; die Karte
 * zeigt nur den Server und die Klasse.
 */

export const BLOCK_GRUENDE = [
  "abgelehnt",
  "zweiter-faktor",
  "gesperrt",
  "captcha",
  "passwort-abgelaufen",
] as const;

export type BlockGrund = (typeof BLOCK_GRUENDE)[number];

export type IservState =
  | { kind: "nicht-eingerichtet"; missing: string[] }
  | { kind: "ruht"; grund: string }
  | { kind: "blockiert"; reason: BlockGrund; since: Date }
  | { kind: "noch-nie" }
  | { kind: "aktiv" };

/** Was zu tun ist, je Grund — feste Sätze. */
export const BLOCK_TEXT: Record<BlockGrund, string> = {
  abgelehnt:
    "IServ hat die Anmeldung abgelehnt (Benutzername oder Passwort falsch?). Die App versucht es nicht noch einmal, damit dein Konto nicht gesperrt wird. Passwort auf dem NAS neu eintragen (sudo bash /volume1/docker/schulapp/repo/scripts/iserv-einrichten.sh --neues-passwort), dann hier „Erneut versuchen“.",
  "zweiter-faktor":
    "IServ verlangt einen zweiten Faktor — den kann die App nicht. Entweder die Zwei-Faktor-Anmeldung für dieses Konto abschalten oder IServ in der App wieder ausschalten (ISERV_* aus der .env nehmen).",
  gesperrt:
    "IServ meldet das Konto als gesperrt oder zu viele Fehlversuche. Abwarten bzw. von der Schule entsperren lassen, dann „Erneut versuchen“.",
  captcha:
    "IServ verlangt ein Captcha. Einmal im Browser bei IServ anmelden, dann „Erneut versuchen“.",
  "passwort-abgelaufen":
    "IServ verlangt ein neues Passwort. Im Browser in IServ ändern, auf dem NAS eintragen (--neues-passwort), dann „Erneut versuchen“.",
};

/**
 * Der Zustand, in der Reihenfolge von `deriveState()` in
 * @/lib/calendar/report: Fehlt die Umgebung, ist alles andere egal. Ohne
 * Google ruht IServ — es hätte nichts, wohin es die Termine trägt. Blockiert
 * vor allem, was danach kommt.
 */
export function deriveIservState(input: {
  config: IservConfigResult;
  /** Warum IServ gerade ruht — null, wenn der Google Kalender verbunden ist */
  ruhtGrund: string | null;
  row: Pick<IservStateRow, "blockedAt" | "blockedReason" | "lastAttemptAt"> | null;
}): IservState {
  if (!input.config.ok) return { kind: "nicht-eingerichtet", missing: input.config.missing };
  if (input.ruhtGrund) return { kind: "ruht", grund: input.ruhtGrund };

  const row = input.row;
  if (row?.blockedAt) {
    const reason = BLOCK_GRUENDE.find((grund) => grund === row.blockedReason);
    // Ein Grund, den diese Datei nicht kennt, ist am ehesten der häufigste.
    return { kind: "blockiert", reason: reason ?? "abgelehnt", since: row.blockedAt };
  }
  if (!row?.lastAttemptAt) return { kind: "noch-nie" };

  return { kind: "aktiv" };
}

/** Ein Tag: Bei sechs Abrufen am Tag ist das kein Ausrutscher mehr. */
export const STALE_MS = 24 * 60 * 60 * 1000;

/** Seit wann kein Stand mehr ankam — oder null, wenn alles in Ordnung ist. */
export function iservStaleSince(
  row: Pick<IservStateRow, "lastSuccessAt" | "createdAt">,
  jetzt: Date,
): Date | null {
  const seit = row.lastSuccessAt ?? row.createdAt;
  return jetzt.getTime() - seit.getTime() > STALE_MS ? seit : null;
}

/** Alles, was die Karte zeigt. */
export type IservStatus = {
  state: IservState;
  /** Nur der Host, z.B. "iserv.example.test" */
  host: string | null;
  klasse: number | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: { sentence: string; at: Date } | null;
  warning: string | null;
  staleSince: Date | null;
  quellen: ErkannteQuelle[];
  /** Termine je Quelle im letzten Stand (ohne eingefrorene) */
  zahlen: Record<IservQuelle, number>;
  counts: {
    genommen: number;
    knapp: number;
    zweifel: number;
    ausgelassenFrei: number;
    ausgeschlossen: number;
  };
  /** Bis zu fünf genommene ab heute */
  naechste: Eintrag[];
  /** Ab heute, höchstens zwanzig */
  zweifel: Eintrag[];
  /** Ab heute */
  knapp: Eintrag[];
  /** Höchstens zehn, ab heute */
  ausgelassenFrei: Eintrag[];
  exerciseFields: string | null;
  running: boolean;
};

const ROLLEN: readonly IservRolle[] = [
  "oeffentlich",
  "klasse",
  "aufgaben",
  "klausurplan",
  "feiertage",
  "abo",
  "andere",
  "mehrdeutig",
  "naechste-klasse",
];

/** `sources_json` lesen — was nicht passt, fällt weg; die Karte ist kein Ort für einen Absturz. */
export function leseQuellen(json: string): ErkannteQuelle[] {
  let roh: unknown;
  try {
    roh = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(roh)) return [];

  return roh.flatMap((q): ErkannteQuelle[] => {
    if (typeof q !== "object" || q === null) return [];
    const r = q as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.label !== "string" || typeof r.grund !== "string") return [];
    const rolle = ROLLEN.find((x) => x === r.rolle);
    if (!rolle) return [];

    return [
      {
        id: r.id,
        label: r.label,
        typ: r.typ === "plugin" ? "plugin" : "cal",
        rolle,
        url: typeof r.url === "string" ? r.url : null,
        grund: r.grund,
      },
    ];
  });
}

function nachTag(a: Eintrag, b: Eintrag): number {
  if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1;
  const ua = a.uhrzeit ?? "";
  const ub = b.uhrzeit ?? "";
  if (ua !== ub) return ua < ub ? -1 : 1;
  return a.titel.localeCompare(b.titel, "de");
}

function abHeute(liste: readonly Eintrag[], heute: string, max: number): Eintrag[] {
  return liste
    .filter((e) => e.bisTag >= heute)
    .sort(nachTag)
    .slice(0, max);
}

export function baueIservStatus(input: {
  config: IservConfigResult;
  ruhtGrund: string | null;
  row: IservStateRow | null;
  snapshots: ReadonlyMap<IservQuelle, Snapshot>;
  auswertung: IservAuswertung | null;
  heute: string;
  jetzt: Date;
  running: boolean;
}): IservStatus {
  const state = deriveIservState({ config: input.config, ruhtGrund: input.ruhtGrund, row: input.row });
  const cfg = input.config.ok ? input.config.config : null;
  const row = input.row;
  const a = input.auswertung;

  const zahl = (quelle: IservQuelle) =>
    input.snapshots.get(quelle)?.items.filter((item) => !item.fest).length ?? 0;

  return {
    state,
    host: cfg ? new URL(cfg.zugang.origin).host : null,
    klasse: cfg?.klasse ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastError: row?.lastError && row.lastErrorAt ? { sentence: row.lastError, at: row.lastErrorAt } : null,
    warning: row?.lastWarning ?? null,
    staleSince:
      row && (state.kind === "aktiv" || state.kind === "noch-nie")
        ? iservStaleSince(row, input.jetzt)
        : null,
    quellen: row ? leseQuellen(row.sourcesJson) : [],
    zahlen: { klasse: zahl("klasse"), oeffentlich: zahl("oeffentlich"), aufgaben: zahl("aufgaben") },
    counts: {
      genommen: a?.genommen.length ?? 0,
      knapp: a?.knapp.length ?? 0,
      zweifel: a?.zweifel.length ?? 0,
      ausgelassenFrei: a?.ausgelassenFrei.length ?? 0,
      ausgeschlossen: a?.ausgeschlossen ?? 0,
    },
    naechste: a ? abHeute(a.genommen, input.heute, 5) : [],
    zweifel: a ? abHeute(a.zweifel, input.heute, 20) : [],
    knapp: a ? abHeute(a.knapp, input.heute, 50) : [],
    ausgelassenFrei: a ? abHeute(a.ausgelassenFrei, input.heute, 10) : [],
    exerciseFields: row?.exerciseFields ?? null,
    running: input.running,
  };
}
