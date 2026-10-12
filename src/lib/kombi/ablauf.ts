import { addDays, berlinDay } from "@/lib/dates";
import { freePeriodOn, listAllFreePeriods } from "@/lib/free-days";
import { listHomework, type HomeworkItem } from "@/lib/homework";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { ablaufSchritt, ablaufStand, eingetragenHeute, protokollieren, type AblaufSchritt, type AblaufStand } from "@/lib/protokoll";
import { listSubjects } from "@/lib/subjects";
import { ensurePeriods, listLessons, weekdayOf, type LessonWithSubject } from "@/lib/timetable";
import { db } from "@/db";
import { materialTopics, materials, subjectTopics, tagesprotokoll } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

import { blaetterVomTag, berlinZeitpunkt, type BlattKurz } from "./blaetter";
import { kurzName } from "./fach-kurz";

/**
 * Alles für den Ablauf nach der Schule (Modell 23, Plan C; Prototyp
 * Z. 2086–2260): ob er heute dran ist, bei welchem Schritt er steht, die
 * Blätter des Tages (Schritt 1) und die Fächer und Aufgaben (Schritt 2).
 *
 * Ein reines, serialisierbares Objekt. Die Ebene `flow` holt es selbst über
 * `GET /api/ablauf`; so hängt der Ablauf nicht an `TagDaten` (Abschnitt B).
 */

export type FachZeile = {
  id: string;
  name: string;
  kurz: string;
  /** „Hauptunterricht · Industrialisierung“ oder „Nächste Stunde Dienstag“ */
  sub: string | null;
  /** Tag der nächsten Stunde (Fälligkeit „nächste Stunde“), freie Tage übersprungen */
  naechste: string | null;
};

export type AufgabeKurz = {
  id: string;
  fachId: string;
  fachName: string;
  kurz: string;
  text: string;
  due: string;
  /** ISO oder null */
  done: string | null;
  details: string | null;
  /** ISO, für die Reihenfolge bei gleicher Fälligkeit */
  erstellt: string;
};

export type AblaufDaten = {
  /** App-Tag 'YYYY-MM-DD' */
  tag: string;
  /** Mo–Fr, Unterricht im Plan, kein freier Tag */
  schultag: boolean;
  /** Schulschluss (Ende der letzten Stunde) ist vorbei */
  nachSchluss: boolean;
  /** Die Ansicht des Servers ist der Ablauf (Prototyp `ansicht()`, Z. 1335) */
  ansichtAblauf: boolean;
  stand: AblaufStand;
  schritt: AblaufSchritt;
  /** Die Fächer von heute in Stundenreihenfolge (Schritt 2) */
  faecher: FachZeile[];
  /** IDs der heute eingetragenen Aufgaben (Tagesprotokoll) */
  eingetragen: string[];
  /** Alle offenen Aufgaben und die heute erledigten */
  aufgaben: AufgabeKurz[];
  blaetter: BlattKurz[];
  /** alle aktiven Fächer, für „Fach ändern“ */
  alleFaecher: { id: string; name: string }[];
};

/** Die Uhr eines Stundenendes 'HH:MM' oder 'HH:MM:SS'. */
function uhr(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h || 0, m || 0];
}

export function weekdayOrDateText(tag: string, heute: string): string {
  const TAG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const wd = new Date(`${tag}T12:00:00Z`).getUTCDay();
  const diff = Math.round((Date.parse(`${tag}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 864e5);
  if (diff <= 6) return TAG[wd];
  const [, m, d] = tag.split("-").map(Number);
  return `${TAG[wd]}, ${d}.${m}.`;
}

/** Das Fach des Hauptunterrichts: das in der ersten Stunde an den meisten Tagen (wie `guessEpochSubject`). */
export function epochenFachId(lessons: Pick<LessonWithSubject, "period" | "subjectId">[]): string | null {
  const zaehler = new Map<string, number>();
  for (const l of lessons) {
    if (l.period !== 1) continue;
    zaehler.set(l.subjectId, (zaehler.get(l.subjectId) ?? 0) + 1);
  }
  let bestes: string | null = null;
  let meiste = 1; // an mindestens zwei Tagen, sonst ist es kein Hauptunterricht
  for (const [id, n] of zaehler) {
    if (n > meiste) {
      meiste = n;
      bestes = id;
    }
  }
  return bestes;
}

/** Das jüngste Thema eines Fachs (Thema des jüngsten Blatts mit Thema). */
async function juengstesThema(userId: string, subjectId: string): Promise<string | null> {
  const [z] = await db
    .select({ title: subjectTopics.title })
    .from(materialTopics)
    .innerJoin(materials, eq(materials.id, materialTopics.materialId))
    .innerJoin(subjectTopics, eq(subjectTopics.id, materialTopics.subjectTopicId))
    .where(and(eq(materials.userId, userId), eq(materials.subjectId, subjectId)))
    .orderBy(desc(materials.capturedOn), desc(materials.createdAt))
    .limit(1);
  return z?.title ?? null;
}

function aufgabeKurz(h: HomeworkItem): AufgabeKurz {
  return {
    id: h.id,
    fachId: h.subject.id,
    fachName: h.subject.name,
    kurz: kurzName(h.subject.name),
    text: h.title,
    due: h.dueDate,
    done: h.doneAt ? h.doneAt.toISOString() : null,
    details: h.details ?? null,
    erstellt: h.createdAt.toISOString(),
  };
}

export async function ladeAblauf(userId: string, now: Date): Promise<AblaufDaten> {
  const tag = appTagVon(now);
  const [lessons, perioden, frei, stand, schritt, eingetragen, hausaufgaben, faecherAlle, blaetter] = await Promise.all([
    listLessons(userId),
    ensurePeriods(userId),
    listAllFreePeriods(userId),
    ablaufStand(userId, tag),
    ablaufSchritt(userId, tag),
    eingetragenHeute(userId, tag),
    listHomework(userId, { includeDone: true }),
    listSubjects(userId),
    blaetterVomTag(userId, tag),
  ]);

  const unterrichtAm = (t: string) => {
    const wd = weekdayOf(t);
    if (wd < 1 || wd > 5 || freePeriodOn(frei, t)) return [];
    return lessons.filter((l) => l.weekday === wd).sort((a, b) => a.period - b.period);
  };
  const heuteStunden = unterrichtAm(tag);
  const schultag = heuteStunden.length > 0;

  let nachSchluss = false;
  if (schultag) {
    const enden = heuteStunden
      .map((l) => perioden.find((p) => p.number === l.period)?.endsAt)
      .filter((e): e is string => Boolean(e))
      .sort();
    const letzte = enden[enden.length - 1];
    if (letzte) {
      const [h, m] = uhr(letzte);
      nachSchluss = now.getTime() >= berlinZeitpunkt(tag, h, m).getTime();
    }
  }

  const naechsteStunde = (subjectId: string): string | null => {
    let t = tag;
    for (let i = 0; i < 60; i++) {
      t = addDays(t, 1);
      if (unterrichtAm(t).some((l) => l.subjectId === subjectId)) return t;
    }
    return null;
  };

  const epoche = epochenFachId(lessons);
  const epochenThema = epoche ? await juengstesThema(userId, epoche) : null;

  const gesehen = new Set<string>();
  const faecher: FachZeile[] = [];
  for (const l of heuteStunden) {
    if (gesehen.has(l.subjectId)) continue;
    gesehen.add(l.subjectId);
    const nl = naechsteStunde(l.subjectId);
    const hu = l.subjectId === epoche && heuteStunden.some((x) => x.subjectId === epoche && x.period === 1);
    faecher.push({
      id: l.subjectId,
      name: l.subject.name,
      kurz: kurzName(l.subject.name),
      sub: hu
        ? `Hauptunterricht${epochenThema ? ` · ${epochenThema}` : ""}`
        : nl
          ? `Nächste Stunde ${weekdayOrDateText(nl, tag)}`
          : null,
      naechste: nl,
    });
  }

  const ein = new Set(eingetragen);
  const aufgaben = hausaufgaben
    .filter((h) => !h.done || ein.has(h.id) || (h.doneAt && berlinDay(new Date(h.doneAt.getTime() - 4 * 3600_000)) === tag))
    .map(aufgabeKurz);

  return {
    tag,
    schultag,
    nachSchluss,
    ansichtAblauf: schultag && nachSchluss && stand === null,
    stand,
    schritt,
    faecher,
    eingetragen,
    aufgaben,
    blaetter,
    alleFaecher: faecherAlle.map((f) => ({ id: f.id, name: f.name })),
  };
}

/**
 * „Fertig“ oder „Überspringen“ (Prototyp `ablaufEnde`, Z. 2254): Aus dem Menü
 * geöffnet schreibt Überspringen nichts; „Fertig“ schreibt `ablauf_beendet`
 * wie sonst. Jeder Typ höchstens einmal am Tag, und ein Überspringen nach
 * einem Stand schreibt nichts mehr. Gibt den neuen Stand zurück.
 */
export async function ablaufBeenden(
  userId: string,
  tag: string,
  typ: "ablauf_beendet" | "ablauf_uebersprungen",
  ausMenu: boolean,
): Promise<AblaufStand> {
  const stand = await ablaufStand(userId, tag);
  if ((!ausMenu || typ === "ablauf_beendet") && (!stand || typ === "ablauf_beendet")) {
    const schon = await db
      .select({ id: tagesprotokoll.id })
      .from(tagesprotokoll)
      .where(and(eq(tagesprotokoll.userId, userId), eq(tagesprotokoll.tag, tag), eq(tagesprotokoll.typ, typ)))
      .limit(1);
    if (schon.length === 0) await protokollieren(userId, tag, typ);
  }
  return ablaufStand(userId, tag);
}
