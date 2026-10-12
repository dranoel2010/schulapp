import { listHomework } from "@/lib/homework";

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
  fuer: AufgabeDaten[];
  spaeter: AufgabeDaten[];
  erledigt: AufgabeDaten[];
};

const nachFaelligkeit = (a: AufgabeDaten, b: AufgabeDaten) =>
  a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : 1;

export async function hausaufgabenSeite(userId: string, now: Date = new Date()): Promise<HausaufgabenDaten> {
  const heute = heuteApp(now);
  const [kal, liste] = await Promise.all([
    schulKalender(userId, heute),
    listHomework(userId, { includeDone: true }),
  ]);
  const ns = kal.naechsterSchultag(heute);
  const heuteSchule = kal.schultag(heute);
  const alle = liste.map(aufgabeDaten);
  const grenze = now.getTime() - 2 * 864e5;

  return {
    heute,
    ns,
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
