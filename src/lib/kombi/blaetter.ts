import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { leserLaeufe, materialPages, materialTopics, materials, subjects } from "@/db/schema";
import { IN_ARBEIT_MINUTEN, KORB_FRISCH_MINUTEN } from "@/lib/blaetter-stand";
import { claudeConfigured } from "@/lib/claude/client";
import { markFiled } from "@/lib/inbox";
import { jevConfigured } from "@/lib/jev";
import { claudeBeschaeftigt, claudeEingeplant, claudeLiestGerade, claudePausiert } from "@/lib/leser/claude-zustand";
import { loadTopics, ownsSubject } from "@/lib/materials";

import { themenLaufAktiv } from "./themen-lauf";

/**
 * Die Blätter für den Ablauf nach der Schule und „Zuletzt abgelegt“
 * (Modell 23, Plan 3.8): je Blatt eine kurze, serialisierbare Zeile mit dem
 * Status in Worten des Prototyps (`statusTexts`, Z. 3631).
 *
 * Der Status kommt aus dem, was die Datenbank weiß: `filed_at` (eingeordnet
 * von Jev oder von Hand), die Abschrift je Seite, der Leser je Seite und der
 * jüngste Lauf des Claude-Lesers. „hochladen“ und „hängt“ kennt nur der
 * Browser.
 */

export type BlattStatus =
  /** `filed_at` leer, die App liest oder Jev ordnet gerade ein */
  | "einordnen"
  /** eingeordnet, eine Abschrift steht noch aus und wird gerade gelesen */
  | "abschrift_laeuft"
  /** eingeordnet, jede Seite hat eine Abschrift */
  | "abschrift_da"
  /** der letzte Lauf des Lesers scheiterte, Seiten ohne Abschrift */
  | "fehlgeschlagen"
  /** liegt im Eingangskorb, niemand liest (kein Jev, Skizze, kein Schlüssel) */
  | "im_korb"
  /** eingeordnet, ohne Abschrift und ohne Lauf (Prototyp: Titel allein) */
  | "eingeordnet";

export type BlattKurz = {
  id: string;
  titel: string;
  /** null, solange das Blatt nicht eingeordnet ist — die Oberfläche zeigt das Fach dann nicht */
  fach: { id: string; name: string } | null;
  /** das vorläufige Fach, nur für „Fach ändern“ (welche Pille gedrückt ist) */
  fachVorlaeufig: string;
  themen: string[];
  /** Nach „Fach ändern“ bestimmt Jev gerade die Themen: „Thema folgt“ */
  themaFolgt: boolean;
  seiten: number;
  status: BlattStatus;
  /** Vorschau der ersten Seite */
  vorschau: string | null;
  datum: string;
  /** ISO, Reihenfolge in der Liste (neuestes oben) */
  erstellt: string;
};

/** Ein Lauf, der ohne Abschrift endete (Prototyp: `fehler`). */
export function laufGescheitert(lauf: {
  ergebnis: string;
  abbruch: string | null;
  fristRestMs: number | null;
} | null): boolean {
  if (!lauf) return false;
  if (lauf.abbruch !== null) return true;
  if (lauf.ergebnis === "nichts" || lauf.ergebnis === "spaeter") return true;
  return lauf.ergebnis === "laeuft" && (lauf.fristRestMs === null || lauf.fristRestMs <= 0);
}

/**
 * Der Status eines Blatts, rein gerechnet (Plan 3.8, Tabelle).
 *
 * - nicht eingeordnet: liest jemand → `einordnen`; scheiterte der Lauf an
 *   ungelesenen Seiten → `fehlgeschlagen`; sonst `im_korb`;
 * - eingeordnet: alle Seiten gelesen → `abschrift_da`; scheiterte der Lauf →
 *   `fehlgeschlagen`; liest jemand → `abschrift_laeuft`; sonst `eingeordnet`.
 */
export function blattStatus(s: {
  eingeordnet: boolean;
  ungelesen: number;
  inArbeit: boolean;
  gescheitert: boolean;
}): BlattStatus {
  if (!s.eingeordnet) {
    if (s.inArbeit) return "einordnen";
    if (s.gescheitert && s.ungelesen > 0) return "fehlgeschlagen";
    return "im_korb";
  }
  if (s.ungelesen === 0) return "abschrift_da";
  if (s.inArbeit) return "abschrift_laeuft";
  if (s.gescheitert) return "fehlgeschlagen";
  return "eingeordnet";
}

export { blattFertig } from "@/components/kombi/ablauf/status-texte";

// ── Zeit: der App-Tag beginnt um 04:00 Berliner Zeit ─────────────────────────

const berlinTeile = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Abstand Berlin − UTC in Minuten zu einem Zeitpunkt. */
function berlinVersatz(ms: number): number {
  const t: Record<string, number> = {};
  for (const p of berlinTeile.formatToParts(new Date(ms))) {
    if (p.type !== "literal") t[p.type] = Number(p.value);
  }
  const lokal = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  return Math.round((lokal - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Der Zeitpunkt „Tag, HH:MM“ in Berlin, auch über die Zeitumstellung. */
export function berlinZeitpunkt(tag: string, stunde: number, minute = 0): Date {
  const [y, m, d] = tag.split("-").map(Number);
  const wand = Date.UTC(y, m - 1, d, stunde, minute);
  let t = wand - berlinVersatz(wand) * 60_000;
  t = wand - berlinVersatz(t) * 60_000;
  return new Date(t);
}

/** [Beginn, Ende) eines App-Tags: 04:00 bis 04:00 des Folgetags, Berliner Zeit. */
export function appTagGrenzen(tag: string): [Date, Date] {
  const [y, m, d] = tag.split("-").map(Number);
  const morgen = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return [berlinZeitpunkt(tag, 4), berlinZeitpunkt(morgen, 4)];
}

// ── Laden ────────────────────────────────────────────────────────────────────

type Zeile = {
  id: string;
  title: string;
  capturedOn: string;
  filedAt: Date | null;
  createdAt: Date;
  subjectId: string;
  subjectName: string;
};

async function kurzMachen(userId: string, zeilen: Zeile[]): Promise<BlattKurz[]> {
  if (zeilen.length === 0) return [];
  const ids = zeilen.map((z) => z.id);
  const frischSeit = sql`now() - make_interval(mins => ${IN_ARBEIT_MINUTEN}::int)`;

  const [seiten, themen, laeufe] = await Promise.all([
    db
      .select({
        materialId: materialPages.materialId,
        id: materialPages.id,
        ungelesen: sql<boolean>`${materialPages.transcript} is null`,
        frischOffen: sql<boolean>`(${materialPages.leser} = 'offen' and ${materialPages.createdAt} > ${frischSeit})`,
        frischClaude: sql<boolean>`(${materialPages.leser} = 'claude' and ${materialPages.transcript} is null and ${materialPages.createdAt} > ${frischSeit})`,
        ungelesenClaude: sql<boolean>`(coalesce(${materialPages.leser}, 'claude') = 'claude' and ${materialPages.transcript} is null)`,
        erstellt: materialPages.createdAt,
      })
      .from(materialPages)
      .where(inArray(materialPages.materialId, ids))
      .orderBy(asc(materialPages.sortOrder), asc(materialPages.createdAt)),
    loadTopics(userId, ids),
    db
      .selectDistinctOn([leserLaeufe.materialId], {
        materialId: leserLaeufe.materialId,
        ergebnis: leserLaeufe.ergebnis,
        abbruch: leserLaeufe.abbruch,
        fristRestMs: sql<number | null>`case when ${leserLaeufe.fristBis} is null then null else floor(extract(epoch from (${leserLaeufe.fristBis} - now())) * 1000)::float8 end`,
        erstellt: leserLaeufe.createdAt,
      })
      .from(leserLaeufe)
      .where(and(eq(leserLaeufe.userId, userId), inArray(leserLaeufe.materialId, ids)))
      .orderBy(leserLaeufe.materialId, desc(leserLaeufe.createdAt), desc(leserLaeufe.id)),
  ]);

  const claudeLiest = claudeConfigured() && !claudePausiert();
  const beschaeftigt = claudeBeschaeftigt(userId);
  const jev = jevConfigured();
  const korbFrischSeit = Date.now() - KORB_FRISCH_MINUTEN * 60_000;

  return zeilen.map((z) => {
    const s = seiten.filter((p) => p.materialId === z.id);
    const lauf = laeufe.find((l) => l.materialId === z.id) ?? null;
    const juengsteSeite = s.reduce<Date | null>((a, p) => (!a || p.erstellt > a ? p.erstellt : a), null);
    // Ein Lauf zählt nur, wenn er die jüngste Seite schon kannte.
    const laufGilt = lauf && (!juengsteSeite || lauf.erstellt >= juengsteSeite) ? lauf : null;
    const gescheitert = laufGescheitert(
      laufGilt
        ? { ergebnis: laufGilt.ergebnis, abbruch: laufGilt.abbruch, fristRestMs: laufGilt.fristRestMs === null ? null : Number(laufGilt.fristRestMs) }
        : null,
    );
    const ungelesen = s.filter((p) => Boolean(p.ungelesen)).length;
    const liest =
      (beschaeftigt && (claudeLiestGerade(z.id) || claudeEingeplant(z.id))) ||
      (laufGilt?.ergebnis === "laeuft" && !gescheitert);
    const eingeordnet = z.filedAt !== null;
    // Ein frisches Korbblatt wartet auf den Vorschlag der App und auf Jev (wie
    // `frischImKorb` in `blaetterStand()`): nicht, wenn niemand mehr kommt —
    // ohne Jev, nach einem erledigenden Lauf, oder mit Claude-Seiten, die
    // niemand liest (kein Schlüssel, Pause).
    const erledigt = laufGilt?.ergebnis === "kein-vorschlag" || laufGilt?.ergebnis === "nichts";
    const claudeOhneLeser = !claudeLiest && s.some((p) => Boolean(p.ungelesenClaude));
    const korbFrisch =
      !eingeordnet && jev && !gescheitert && !erledigt && !claudeOhneLeser &&
      !!juengsteSeite && juengsteSeite.getTime() > korbFrischSeit;
    const inArbeit =
      liest ||
      korbFrisch ||
      s.some((p) => Boolean(p.frischOffen)) ||
      (claudeLiest && !gescheitert && !laufGilt && s.some((p) => Boolean(p.frischClaude)));
    return {
      id: z.id,
      titel: z.title,
      fach: eingeordnet ? { id: z.subjectId, name: z.subjectName } : null,
      fachVorlaeufig: z.subjectId,
      themen: (themen.get(z.id) ?? []).map((t) => t.title),
      themaFolgt: themenLaufAktiv(z.id),
      seiten: s.length,
      status: blattStatus({ eingeordnet, ungelesen, inArbeit, gescheitert }),
      vorschau: s[0] ? `/api/material/${s[0].id}/vorschau` : null,
      datum: z.capturedOn,
      erstellt: z.createdAt.toISOString(),
    };
  });
}

const FELDER = {
  id: materials.id,
  title: materials.title,
  capturedOn: materials.capturedOn,
  filedAt: materials.filedAt,
  createdAt: materials.createdAt,
  subjectId: materials.subjectId,
  subjectName: subjects.name,
};

/** Die Blätter, die an diesem App-Tag angelegt wurden, das neueste zuerst (über `created_at`). */
export async function blaetterVomTag(userId: string, tag: string): Promise<BlattKurz[]> {
  const [von, bis] = appTagGrenzen(tag);
  const zeilen = await db
    .select(FELDER)
    .from(materials)
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .where(and(eq(materials.userId, userId), gte(materials.createdAt, von), lt(materials.createdAt, bis)))
    .orderBy(desc(materials.createdAt), desc(materials.id));
  return kurzMachen(userId, zeilen);
}

/** Die jüngsten Blätter (für „Zuletzt abgelegt“ auf dem Überblick). */
export async function blaetterKurz(userId: string, { limit = 3 }: { limit?: number } = {}): Promise<BlattKurz[]> {
  const zeilen = await db
    .select(FELDER)
    .from(materials)
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .where(eq(materials.userId, userId))
    .orderBy(desc(materials.createdAt), desc(materials.id))
    .limit(Math.max(1, Math.min(20, limit)));
  return kurzMachen(userId, zeilen);
}

/** Der Status (Plan 3.8) bestimmter Blätter, etwa der Miniaturen auf dem Überblick. */
export async function blattStatusVon(userId: string, ids: string[]): Promise<Map<string, BlattStatus>> {
  if (!ids.length) return new Map();
  const zeilen = await db
    .select(FELDER)
    .from(materials)
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .where(and(eq(materials.userId, userId), inArray(materials.id, ids)));
  return new Map((await kurzMachen(userId, zeilen)).map((b) => [b.id, b.status]));
}

/** Ein Blatt in Kurzform, oder null. */
export async function blattKurz(userId: string, id: string): Promise<BlattKurz | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const zeilen = await db
    .select(FELDER)
    .from(materials)
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .where(and(eq(materials.userId, userId), eq(materials.id, id)))
    .limit(1);
  const [b] = await kurzMachen(userId, zeilen);
  return b ?? null;
}

/**
 * „Fach ändern“ (Plan 3.8): setzt das Fach und `filed_at`. Die Themen
 * bestimmt danach Jev für das neue Fach (`themenFuerFach()` in
 * @/lib/auto-file, angestoßen vom Aufrufer). Die alten Themen gehören zum
 * alten Fach und fallen weg. Kein Protokoll, wie im Prototyp.
 *
 * Gibt `false` zurück, wenn Blatt oder Fach nicht (mehr) dem Nutzer gehören.
 */
export async function fachAendern(userId: string, materialId: string, subjectId: string): Promise<boolean> {
  if (!(await ownsSubject(userId, subjectId))) return false;
  const geaendert = await db.transaction(async (tx) => {
    const [alt] = await tx
      .select({ subjectId: materials.subjectId })
      .from(materials)
      .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
      .limit(1);
    if (!alt) return false;
    if (alt.subjectId !== subjectId) {
      await tx.update(materials).set({ subjectId }).where(and(eq(materials.userId, userId), eq(materials.id, materialId)));
      // Themen hängen am Vokabular des Fachs: mit dem Fach gehen sie.
      await tx.delete(materialTopics).where(eq(materialTopics.materialId, materialId));
    }
    return true;
  });
  if (!geaendert) return false;
  await markFiled(userId, materialId, true);
  return true;
}
