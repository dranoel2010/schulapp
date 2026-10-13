import { listHomework } from "@/lib/homework";
import { jetzt } from "@/lib/tag";

import { aufgabeDaten, heuteApp, schulKalender, type AufgabeDaten } from "./gemeinsam";

/**
 * Die Seite „Hausaufgaben“ (Prototyp `hausaufgabenGroups`, Z. 3026): „Für
 * ⟨nächster Schultag⟩“, „Später“ und „Erledigt“ — erledigt nur, was in den
 * letzten zwei Tagen abgehakt wurde (Plan 2.2). Ältere erledigte Aufgaben
 * findet die Suche der Zeile.
 */
export type HausaufgabenDaten = {
  heute: string;
  /** Der nächste Schultag */
  ns: string;
  /**
   * Heute an einem Schultag fällig und noch offen. Der Morgens-Ablauf zeigt
   * sie unter „Abgeben“; auf dieser Seite stehen sie den ganzen Tag unter
   * „Heute“, damit man sie auch nachmittags abhaken oder ändern kann.
   */
  heuteFaellig: AufgabeDaten[];
  fuer: AufgabeDaten[];
  spaeter: AufgabeDaten[];
  erledigt: AufgabeDaten[];
};

const nachFaelligkeit = (a: AufgabeDaten, b: AufgabeDaten) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);

export async function hausaufgabenSeite(userId: string, jetztZeit?: Date): Promise<HausaufgabenDaten> {
  const now = jetztZeit ?? (await jetzt());
  const heute = heuteApp(now);
  const [kal, liste] = await Promise.all([
    schulKalender(userId, heute),
    listHomework(userId, { includeDone: true }),
  ]);
  const ns = kal.naechsterSchultag(heute);
  const heuteSchule = kal.schultag(heute);
  // gleiche Fälligkeit: in der Reihenfolge des Eintragens (Prototyp `offeneFuer`, Z. 1782)
  const alle = [...liste].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(aufgabeDaten);
  const grenze = now.getTime() - 2 * 864e5;

  return {
    heute,
    ns,
    heuteFaellig: heuteSchule ? alle.filter((a) => !a.done && a.due === heute) : [],
    // Was bis zum nächsten Schultag fällig ist, ohne die heutigen Abgaben an
    // einem Schultag — die stehen morgens (Prototyp `offeneFuer`, Z. 1782).
    fuer: alle
      .filter((a) => !a.done && a.due <= ns && !(a.due === heute && heuteSchule))
      .sort(nachFaelligkeit),
    spaeter: alle.filter((a) => !a.done && a.due > ns).sort(nachFaelligkeit),
    erledigt: alle
      .filter((a) => a.done && a.doneAt !== null && new Date(a.doneAt).getTime() >= grenze)
      .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  };
}
