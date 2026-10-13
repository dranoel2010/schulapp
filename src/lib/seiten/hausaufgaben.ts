import { listHomework } from "@/lib/homework";
import { aufgabeImArchiv } from "@/lib/kombi/archiv";
import { offeneFuer } from "@/lib/kombi/startseite";
import { jetzt, ladeKalender, nachSchulschluss } from "@/lib/tag";

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
