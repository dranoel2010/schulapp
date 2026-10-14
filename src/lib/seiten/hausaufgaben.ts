import { lessonRoom } from "@/lib/home";
import { getHomework, listHomework } from "@/lib/homework";
import { aufgabeImArchiv } from "@/lib/kombi/archiv";
import { offeneFuer } from "@/lib/kombi/startseite";
import { listMaterials } from "@/lib/materials";
import { jetzt, ladeKalender, nachSchulschluss } from "@/lib/tag";
import { lessonsForWeekday, listPeriods, periodTimes, weekdayOf } from "@/lib/timetable";

import { blaetterImKorb, blattZeile, type BlattZeile } from "./ablage";
import { aufgabeDaten, heuteApp, schulKalender, type AufgabeDaten } from "./gemeinsam";

/**
 * Die Seite „Hausaufgaben“ (Prototyp `hausaufgabenGroups`, Z. 3026): „Für
 * ⟨nächster Schultag⟩“, „Später“ und „Erledigt“ — erledigt nur, was in den
 * letzten zwei Tagen abgehakt wurde (Plan 2.2). Ältere erledigte Aufgaben
 * stehen im Archiv (Antwort 11, `archivSeite`); die Suche der Zeile findet
 * sie noch zwei Wochen lang (`ERLEDIGT_SUCHE_TAGE`) und öffnet sie dort wieder.
 */
export type HausaufgabenDaten = {
  heute: string;
  /** Der nächste Schultag */
  ns: string;
  /**
   * An einem Schultag heute fällig und noch offen, bis Schulschluss auch das
   * Überfällige: dieselbe Menge wie „Abgeben“ auf der Startseite
   * (`istAbgabeAm`). Das heute Fällige steht den ganzen Tag hier, damit man es
   * nachmittags abhaken oder ändern kann.
   */
  heuteFaellig: AufgabeDaten[];
  /**
   * „Für ⟨nächster Schultag⟩“: dieselbe Menge wie der Überblick der Startseite
   * (`offeneFuer`), ohne was gerade unter „Heute“ steht. Nach Schulschluss
   * steht das Überfällige also hier, wie im Prototyp (Z. 3031).
   */
  fuer: AufgabeDaten[];
  spaeter: AufgabeDaten[];
  erledigt: AufgabeDaten[];
  /** Wie viele erledigte Aufgaben im Archiv stehen: ab 1 steht unten „Archiv“ */
  archiv: number;
};

const nachFaelligkeit = (a: AufgabeDaten, b: AufgabeDaten) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);

export async function hausaufgabenSeite(userId: string, jetztZeit?: Date): Promise<HausaufgabenDaten> {
  const now = jetztZeit ?? (await jetzt());
  const heute = heuteApp(now);
  const [kal, k, liste] = await Promise.all([
    schulKalender(userId, heute),
    ladeKalender(userId),
    listHomework(userId, { includeDone: true }),
  ]);
  const ns = kal.naechsterSchultag(heute);
  const heuteSchule = kal.schultag(heute);
  // Dieselbe Grenze wie die Ansicht der Startseite: bis Schulschluss „morgens“
  const vorSchluss = heuteSchule && !nachSchulschluss(k, now);
  // gleiche Fälligkeit: in der Reihenfolge des Eintragens (Prototyp `offeneFuer`, Z. 1782)
  const alle = [...liste].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(aufgabeDaten);
  const jetztMs = now.getTime();
  // An einem Schultag das heute Fällige, bis Schulschluss auch das Überfällige
  const heuteOffen = heuteSchule
    ? alle.filter((a) => !a.done && (a.due === heute || (a.due < heute && vorSchluss)))
    : [];
  const unterHeute = new Set(heuteOffen.map((a) => a.id));

  return {
    heute,
    ns,
    heuteFaellig: heuteOffen.sort(nachFaelligkeit),
    fuer: offeneFuer({ tag: heute, schultag: heuteSchule, naechsterSchultag: ns }, alle).filter(
      (a) => !unterHeute.has(a.id),
    ),
    spaeter: alle.filter((a) => !a.done && a.due > ns).sort(nachFaelligkeit),
    erledigt: alle
      .filter((a) => a.done && !aufgabeImArchiv(a, jetztMs))
      .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
    archiv: alle.filter((a) => aufgabeImArchiv(a, jetztMs)).length,
  };
}

/**
 * Jede Aufgabe, die nicht im Archiv steht, steht in genau einer Gruppe der
 * Seite (desktop.html hatte den Fehler: eine wieder geöffnete alte Aufgabe
 * fiel aus allen Gruppen). Für Tests und die Liste am Rechner.
 */
export function gruppeVon(d: HausaufgabenDaten, id: string): "heute" | "fuer" | "spaeter" | "erledigt" | null {
  if (d.heuteFaellig.some((a) => a.id === id)) return "heute";
  if (d.fuer.some((a) => a.id === id)) return "fuer";
  if (d.spaeter.some((a) => a.id === id)) return "spaeter";
  if (d.erledigt.some((a) => a.id === id)) return "erledigt";
  return null;
}

// ── Eine Aufgabe (am Rechner im Detail neben der Liste) ──────────────────────

/**
 * Was das Detail einer Aufgabe am Rechner zeigt (desktop.html `aufgabeDetail`):
 * Fach und Text, Abgabe mit der ersten Stunde des Fachs an diesem Tag aus dem
 * Stundenplan, wann sie eingetragen und wann erledigt wurde, und die
 * jüngsten Blätter des Fachs. Am Handy gibt es diese Seite nicht.
 */
export type AufgabeSeite = AufgabeDaten & {
  /** App-Tag beim Laden */
  heute: string;
  /** voller Fachname („Mathematik“); `fach` ist der Anzeigename („Mathe“) */
  fachName: string;
  /** Die Notiz der Aufgabe, falls eine da ist */
  notiz: string | null;
  /** App-Tag des Eintragens */
  eingetragen: string;
  /** App-Tag des Abhakens, sonst null */
  erledigtAm: string | null;
  /** Steht die Aufgabe im Archiv (länger als zwei Tage erledigt)? */
  imArchiv: boolean;
  /** Die erste Stunde des Fachs am Abgabetag laut Stundenplan */
  stunde: { nr: number; von: string | null; raum: string | null } | null;
  /** Die jüngsten eingeordneten Blätter des Fachs (höchstens drei) */
  blaetter: BlattZeile[];
};

export async function aufgabeSeite(
  userId: string,
  params: Record<string, string>,
  jetztZeit?: Date,
): Promise<AufgabeSeite | null> {
  const item = await getHomework(userId, params.id ?? "");
  if (!item) return null;
  const now = jetztZeit ?? (await jetzt());
  const [stunden, raster, blaetter, imKorb] = await Promise.all([
    lessonsForWeekday(userId, weekdayOf(item.dueDate)),
    listPeriods(userId),
    listMaterials(userId, { subjectId: item.subject.id, limit: 12 }),
    blaetterImKorb(userId),
  ]);
  const erste = stunden
    .filter((l) => l.subjectId === item.subject.id)
    .reduce<(typeof stunden)[number] | null>((min, l) => (min === null || l.period < min.period ? l : min), null);
  const zeiten = periodTimes(raster);
  const a = aufgabeDaten(item);
  return {
    ...a,
    heute: heuteApp(now),
    fachName: item.subject.name,
    notiz: item.details?.trim() ? item.details.trim() : null,
    eingetragen: heuteApp(item.createdAt),
    erledigtAm: item.doneAt ? heuteApp(item.doneAt) : null,
    imArchiv: aufgabeImArchiv(a, now.getTime()),
    stunde: erste ? { nr: erste.period, von: zeiten.get(erste.period)?.startsAt ?? null, raum: lessonRoom(erste) } : null,
    // Nicht eingeordnete Blätter tragen ein geratenes Fach (wie auf der Seite des Fachs)
    blaetter: blaetter.filter((b) => !imKorb.has(b.id)).slice(0, 3).map(blattZeile),
  };
}
