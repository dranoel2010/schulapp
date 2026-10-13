import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { arbeitsblaetter, arbeitsblattWertung, type LeserLaufErgebnis } from "@/db/schema";
import { createQueue, type Queue } from "@/lib/calendar/queue";
import { claudeRufen } from "@/lib/claude/client";
import { messungZeile, type Messung } from "@/lib/claude/ergebnis";
import { claudeAusgangMelden, claudeDeps, type ClaudeLeserDeps } from "@/lib/leser/claude-leser";
import { laufVermerken } from "@/lib/leser/laeufe";

import { vorabBlaetter } from "./ablauf";
import {
  BLATT_ANTWORT,
  BLATT_FORM,
  BLATT_FRIST_MS,
  BLATT_MAX_TOKENS,
  BLATT_SYSTEM,
  blattErgebnis,
  blattInhalt,
  papierFuer,
  type BlattVorab,
} from "./auftrag";
import {
  abschriftenDer,
  blockZiel,
  quelleFuerBlock,
  quelleFuerThema,
  type Quelle,
} from "./quelle";
import { inhaltSchema } from "./schema";
import { bauFehlgeschlagen, bauFertig, bauStarten, type ArbeitsblattZeile } from "./stand";

/**
 * Der Bau eines Arbeitsblatts (Modell 23, Plan H): aus den Abschriften des
 * Themas ruft die App Opus, prüft jede Aufgabe auf ihre Quelle und legt das
 * Blatt ab. Muster @/lib/fragenlauf: eine Warteschlange an `globalThis`,
 * `claudeRufen` mit zod-Schema, ein Vermerk in `leser_laeufe`
 * (art = 'arbeitsblatt'), damit die Kosten in den Einstellungen stehen.
 *
 * Der Zustand der Zeile (wartet → laeuft → fertig | fehlgeschlagen, Frist,
 * höchstens zwei Versuche je Blatt und Tag, Neuanstoß per UPDATE) steht in
 * ./stand; hier wird nur gebaut.
 *
 * Ohne Schlüssel wird nicht gerufen und nichts geändert: das Blatt bleibt
 * `wartet`, bis ein Schlüssel da ist. Ohne Quelle (keine Abschrift) wird das
 * Blatt sofort `fehlgeschlagen`, ohne Aufruf.
 */

export type BauDeps = ClaudeLeserDeps & { jetzt: () => Date };

type BauProzess = { queue: Queue<void> };

const ablage = globalThis as unknown as { __schulappArbeitsblatt?: BauProzess };

function prozess(): BauProzess {
  ablage.__schulappArbeitsblatt ??= { queue: createQueue<void>() };
  return ablage.__schulappArbeitsblatt;
}

const schluessel = (id: string) => `arbeitsblatt:${id}`;

export type BauErgebnis =
  | { gebaut: false; grund: string }
  | { gebaut: true; status: "fertig" | "fehlgeschlagen"; ergebnis: LeserLaufErgebnis; grund: string };

/** Die Quelle eines Blatts: über den Block, sonst über das Thema. `probe`: das Blatt einer Probeklausur. */
async function quelleFuer(
  userId: string,
  zeile: ArbeitsblattZeile,
): Promise<{ quelle: Quelle | null; probe: boolean }> {
  if (zeile.studyBlockId) {
    const ziel = await blockZiel(userId, zeile.studyBlockId);
    if (ziel) return { quelle: await quelleFuerBlock(userId, ziel), probe: ziel.kind === "probe" };
  }
  if (zeile.subjectTopicId) return { quelle: await quelleFuerThema(userId, zeile.subjectTopicId), probe: false };
  return { quelle: null, probe: false };
}

/** Was beim letzten ausgewerteten Blatt dieses Themas falsch war — „kommt aufs nächste Blatt“. */
async function zuletztFalsch(
  userId: string,
  zeile: ArbeitsblattZeile,
): Promise<BlattVorab["zuletztFalsch"]> {
  if (!zeile.subjectTopicId) return [];
  const [letztes] = await db
    .select({ id: arbeitsblaetter.id, inhalt: arbeitsblaetter.inhalt })
    .from(arbeitsblaetter)
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        eq(arbeitsblaetter.subjectTopicId, zeile.subjectTopicId),
        isNotNull(arbeitsblaetter.ausgewertetAm),
      ),
    )
    .orderBy(desc(arbeitsblaetter.ausgewertetAm))
    .limit(1);
  if (!letztes) return [];
  const inhalt = inhaltSchema.safeParse(letztes.inhalt);
  if (!inhalt.success) return [];
  const falsch = await db
    .select({ nr: arbeitsblattWertung.nr })
    .from(arbeitsblattWertung)
    .where(and(eq(arbeitsblattWertung.arbeitsblattId, letztes.id), eq(arbeitsblattWertung.richtig, false)));
  return falsch
    .map((f) => inhalt.data.aufgaben[f.nr - 1])
    .filter((a) => a !== undefined)
    .map((a) => ({ kurz: a.kurz, q: a.q }));
}

/**
 * Ein Bau. Startet per UPDATE (`bauStarten`) — oder gar nicht, wenn er nicht
 * darf (Endstatus, laufend mit gültiger Frist, Versuche aufgebraucht).
 * Wirft nur, wenn die Datenbank nicht antwortet.
 */
export async function blattBauen(
  userId: string,
  blattId: string,
  deps?: Partial<BauDeps>,
): Promise<BauErgebnis> {
  const d = claudeDeps(deps);
  const jetzt = deps?.jetzt ?? (() => new Date());
  if (!d.konfiguriert) {
    return { gebaut: false, grund: "Kein API-Schlüssel eingerichtet (ANTHROPIC_API_KEY fehlt)." };
  }

  const zeile = await bauStarten(userId, blattId, jetzt());
  if (!zeile) return { gebaut: false, grund: "Kein Bau erlaubt (fertig, läuft schon oder zwei Versuche verbraucht)." };

  const { quelle, probe } = await quelleFuer(userId, zeile);
  if (!quelle || abschriftenDer(quelle).length === 0) {
    await bauFehlgeschlagen(userId, blattId);
    return {
      gebaut: true,
      status: "fehlgeschlagen",
      ergebnis: "kein-vorschlag",
      grund: "Zu diesem Thema gibt es kein Blatt mit Abschrift.",
    };
  }

  const papier = papierFuer(quelle.fach);
  const vorab: BlattVorab = {
    fach: quelle.fach,
    thema: quelle.thema,
    papier,
    zuletztFalsch: await zuletztFalsch(userId, zeile),
    probe,
  };

  const gerufen = await claudeRufen(
    {
      system: BLATT_SYSTEM,
      inhalt: blattInhalt(vorab, quelle),
      schema: BLATT_ANTWORT,
      form: BLATT_FORM,
      fristMs: BLATT_FRIST_MS,
      maxTokens: BLATT_MAX_TOKENS,
    },
    d.senden,
  );

  let status: "fertig" | "fehlgeschlagen" = "fehlgeschlagen";
  let ergebnis: LeserLaufErgebnis;
  let grund: string;
  let messung: Messung | null = gerufen.messung;

  if (gerufen.art !== "antwort") {
    ergebnis = gerufen.art;
    grund = gerufen.grund;
  } else {
    messung = gerufen.messung;
    const e = blattErgebnis(gerufen.antwort, quelle, papier);
    if (e.art === "fertig") {
      await bauFertig(userId, blattId, e.inhalt, jetzt());
      status = "fertig";
      ergebnis = "vorschlag";
      grund = `${e.inhalt.aufgaben.length} Aufgaben${e.verworfen ? `, ${e.verworfen} verworfen` : ""}${e.gekappt ? `, ${e.gekappt} gekappt (Seite 1 voll)` : ""}`;
    } else {
      ergebnis = "kein-vorschlag";
      grund = e.grund;
    }
  }
  if (status === "fehlgeschlagen") await bauFehlgeschlagen(userId, blattId);

  await laufVermerken({
    userId,
    art: "arbeitsblatt",
    arbeitsblattId: blattId,
    ergebnis,
    grund,
    messung,
    abbruch: gerufen.art === "antwort" ? null : gerufen.abbruch,
  }).catch((error: unknown) => {
    console.error(`Arbeitsblatt ${blattId.slice(0, 8)}: Lauf nicht vermerkt — ${meldung(error)}`);
  });

  console.info(`Arbeitsblatt ${blattId.slice(0, 8)} (${quelle.fach} · ${quelle.thema}): ${status} — ${grund}`);
  if (messung) console.info(`   ${messungZeile(messung)}`);
  return { gebaut: true, status, ergebnis, grund };
}

/**
 * Der Bau in der Warteschlange — oder nichts, wenn für dieses Blatt schon
 * einer läuft oder wartet. Nacheinander laufen alle Bauten dieses Prozesses.
 */
export function blattLaufen(userId: string, blattId: string, deps?: Partial<BauDeps>): Promise<void> {
  const z = prozess();
  if (z.queue.busy(schluessel(blattId))) return Promise.resolve();
  return z.queue.request(
    schluessel(blattId),
    { frist: null, geduld: null },
    async () => {
      const e = await blattBauen(userId, blattId, deps);
      if (e.gebaut) claudeAusgangMelden(userId, e.ergebnis, e.grund);
    },
    () => undefined,
  );
}

/** Stößt den Bau an und kehrt sofort zurück. Wirft nie. */
export function blattAnstossen(userId: string, blattId: string): void {
  try {
    void blattLaufen(userId, blattId).catch((error: unknown) => {
      console.error(`Arbeitsblatt ${blattId.slice(0, 8)}: Bau abgebrochen — ${meldung(error)}`);
    });
  } catch (error) {
    console.error(`Arbeitsblatt ${blattId.slice(0, 8)}: Bau nicht angestoßen — ${meldung(error)}`);
  }
}

/** Baut dieser Prozess gerade an diesem Blatt (oder wartet ein Bau)? */
export function blattWirdGebaut(blattId: string): boolean {
  return prozess().queue.busy(schluessel(blattId));
}

function meldung(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Vorab bauen ──────────────────────────────────────────────────────────────

/** Höchstens so oft je Nutzer und Prozess — `/` lädt oft, die Abfragen kosten. */
const VORAB_ABSTAND_MS = 10 * 60_000;

/**
 * Vorab bauen (Plan H, Frage 7): beim Laden von `/` (per `after()`) und im
 * Cron `cron/reminders`. Legt die fälligen Blätter an und stößt ihren Bau an;
 * höchstens ein Blatt je Thema und Tag und eins je Termin (./ablauf). Ohne
 * Schlüssel geschieht nichts. Wirft nie.
 */
export async function vorabBauen(userId: string, now: Date = new Date(), immer = false): Promise<number> {
  try {
    if (!claudeDeps(undefined).konfiguriert) return 0;
    const ablageVorab = globalThis as unknown as { __schulappVorab?: Map<string, number> };
    ablageVorab.__schulappVorab ??= new Map();
    const zuletzt = ablageVorab.__schulappVorab.get(userId) ?? 0;
    if (!immer && now.getTime() - zuletzt < VORAB_ABSTAND_MS) return 0;
    ablageVorab.__schulappVorab.set(userId, now.getTime());
    const ids = await vorabBlaetter(userId, now);
    for (const id of ids) blattAnstossen(userId, id);
    return ids.length;
  } catch (error) {
    console.error(`Arbeitsblätter vorab: ${meldung(error)}`);
    return 0;
  }
}
