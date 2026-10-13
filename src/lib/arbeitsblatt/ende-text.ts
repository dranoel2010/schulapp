/** Texte für das Ende eines ausgewerteten Arbeitsblatts (Prototyp `endThema`, Zweig Blatt). */

const und = (l: number[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} und ${l[l.length - 1]}`);

/**
 * „Aufgabe 2 kommt aufs nächste Blatt.“ — nur beim Blatt zu einem Fach-Thema.
 * Das nächste Blatt holt die falschen Aufgaben über sein Thema (`zuletztFalsch`
 * in ./bauen). Probeklausur und Gesamtwiederholung haben kein Fach-Thema, ihre
 * falschen Aufgaben landen auf keinem späteren Blatt: dort keine Zeile.
 */
export function falschZeile(falsch: number[], topicId: string | null): string | null {
  if (falsch.length === 0 || !topicId) return null;
  const eine = falsch.length === 1;
  return `${eine ? "Aufgabe" : "Aufgaben"} ${und(falsch)} ${eine ? "kommt" : "kommen"} aufs nächste Blatt.`;
}
