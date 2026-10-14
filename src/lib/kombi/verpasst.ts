import { cap, kurz, weekdayOrDate, zahl } from "@/lib/kombi/text";

/**
 * Die Hinweise auf verpasste Lernblöcke im Block „Klausur“ der Startseite
 * (Plan 3.5): ohne Datenbank, damit Server und Startseite dieselben Sätze
 * bilden.
 */

export type VerpasstEintrag = {
  examId: string;
  anzahl: number;
  /** der letzte verpasste Tag */
  tag: string;
  kurz: string;
  /** Tag der Klausur */
  datum: string;
  name: string | null;
};

/**
 * Wie die Zeilen unter der Klausurzeile ihre Klausur nennen. Ein Hinweis auf
 * verpasste Blöcke der gezeigten Klausur nennt sie gar nicht, einer zu einer
 * anderen Klausur nennt das Fach. Steht ein Fach auf dem Block mehrmals
 * (Klausurzeile, Verpasstes, „Noch ein Lernblock heute“), kommt der Tag der
 * Klausur dazu, auch bei „Noch ein Lernblock heute: Mathe So 18.10.“.
 */
export function klausurNamen(
  verpasst: Omit<VerpasstEintrag, "name">[],
  gezeigt: { id: string; kurz: string } | null,
  heuteWeitere: { examId: string; kurz: string; datum: string }[],
): { verpasst: VerpasstEintrag[]; heuteWeitere: { examId: string; kurz: string }[] } {
  const klausurenJeFach = new Map<string, Set<string>>();
  const zaehle = (fach: string, id: string) => {
    const s = klausurenJeFach.get(fach) ?? new Set<string>();
    s.add(id);
    klausurenJeFach.set(fach, s);
  };
  if (gezeigt) zaehle(gezeigt.kurz, gezeigt.id);
  for (const v of verpasst) zaehle(v.kurz, v.examId);
  for (const h of heuteWeitere) zaehle(h.kurz, h.examId);
  const name = (fach: string, datum: string) =>
    (klausurenJeFach.get(fach)?.size ?? 0) > 1 ? `${fach} ${kurz(datum)}` : fach;
  return {
    verpasst: verpasst.map((v) => ({ ...v, name: v.examId === gezeigt?.id ? null : name(v.kurz, v.datum) })),
    heuteWeitere: heuteWeitere.map((h) => ({ examId: h.examId, kurz: name(h.kurz, h.datum) })),
  };
}

/** „Ein Lernblock von Dienstag ist offen“, mit Namen „Englisch: ein Lernblock von Donnerstag ist offen“. */
export function verpasstSatz(v: Pick<VerpasstEintrag, "anzahl" | "tag" | "name">, heute: string): string {
  const satz =
    v.anzahl === 1 ? `ein Lernblock von ${weekdayOrDate(v.tag, heute)} ist offen` : `${zahl(v.anzahl)} Lernblöcke sind offen`;
  return v.name ? `${v.name}: ${satz}` : cap(satz);
}
