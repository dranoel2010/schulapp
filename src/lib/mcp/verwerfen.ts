import type { Leser } from "@/db/schema";

/**
 * Die Tür `propose_sheet` und ein Leser je Seite (seit dem 6.10.2026,
 * Entscheidung 7 des Umbaus) — als reine Rechnung, damit `npm test` sie
 * prüfen kann. Der Aufrufer ist der Handler in ./run.ts; dort steht, warum
 * VERWORFEN wird und nicht abgewiesen.
 *
 * Kurz: Eine Abschrift zu einer Seite, die die App selbst liest oder schon
 * gelesen hat, oder die schon eine Abschrift trägt, kommt nicht in den
 * Vorschlag. Sonst ersetzte ein Mensch beim Übernehmen im Formular die
 * Docling-Abschrift oder die schon bestätigte, ohne es zu merken — ob der
 * Vorschlag vom Postboten kommt oder aus einem Chat in der Claude-App.
 */

/**
 * Eine Abschrift, die propose_sheet nicht in den Vorschlag nimmt, und warum:
 * „docling" — die App hat die Seite maschinell gelesen; „offen" — die App
 * liest sie gerade; „gelesen" — sie hat schon eine Abschrift. Die Wörter sind
 * dieselben wie in `leser` an read_sheet, damit ein Aufrufer beide Antworten
 * nebeneinanderlegen kann.
 */
export type Verworfen = { page: string; grund: "docling" | "offen" | "gelesen" };

/** Was die Tür von einer Seite wissen muss — ein Ausschnitt aus `MaterialPageInfo`. */
export type SeitenStand = {
  leser: Leser | null;
  transcriptLength: number | null;
};

/**
 * Warum eine Abschrift zu dieser Seite verworfen wird — oder `null`, wenn sie
 * in den Vorschlag darf.
 *
 * Die Reihenfolge sagt das Genaueste zuerst: eine Docling-Seite hat fast
 * immer auch eine Abschrift, und „die App hat sie gelesen" erklärt mehr als
 * „sie hat schon eine". Eine Seite mit leser „claude" oder `null` (von vor dem
 * 6.10.2026) ohne Abschrift ist genau die, die ein Agent abschreiben soll —
 * und nur sie.
 */
export function verwerfGrund(seite: SeitenStand): Verworfen["grund"] | null {
  if (seite.leser === "docling") return "docling";
  if (seite.leser === "offen") return "offen";
  if (seite.transcriptLength !== null) return "gelesen";
  return null;
}

/**
 * Teilt die Abschriften eines Aufrufs in die, die in den Vorschlag dürfen,
 * und die verworfenen — in der Reihenfolge des Aufrufs. Eine Seite, die es
 * am Blatt nicht gibt, steht in keiner der beiden Listen: die weist der
 * Aufrufer vorher mit einem eigenen Satz ab.
 */
export function abschriftenSieben<T extends { page: string }>(
  eintraege: readonly T[],
  seiten: ReadonlyMap<string, SeitenStand>,
): { bleiben: T[]; verworfen: Verworfen[] } {
  const bleiben: T[] = [];
  const verworfen: Verworfen[] = [];

  for (const eintrag of eintraege) {
    const seite = seiten.get(eintrag.page);
    if (!seite) continue;

    const grund = verwerfGrund(seite);
    if (grund === null) {
      bleiben.push(eintrag);
    } else {
      verworfen.push({ page: eintrag.page, grund });
    }
  }

  return { bleiben, verworfen };
}

/**
 * Ist der Vorschlag NUR deshalb leer, weil alles verworfen wurde? Dann
 * antwortet propose_sheet mit Daten statt mit einem Fehler — ein alter
 * Postbote merkte sich ein `isError` als „kein Vorschlag" und verlöre die
 * Claude-Seiten des Blattes.
 *
 * Erkannt wird der leere Vorschlag an Meldungen ohne Feld: das ist die eine
 * Regel des Schemas, die am Ganzen hängt („Ein Vorschlag, der nichts
 * vorschlägt, ist keiner"). Ein zu langer Titel daneben bliebe ein Fehler mit
 * Feld und käme als Fehler heraus wie bisher.
 */
export function nurVerworfen(
  meldungen: readonly { path: readonly PropertyKey[] }[],
  verworfen: readonly Verworfen[],
  bleiben: number,
): boolean {
  return (
    verworfen.length > 0 &&
    bleiben === 0 &&
    meldungen.length > 0 &&
    meldungen.every((meldung) => meldung.path.length === 0)
  );
}

/**
 * Was verworfen wurde, als ein Satz — gezählt nach Grund, die ids stehen in
 * den Daten. Ein Satz je Seite wäre bei zwölf Docling-Seiten eine Liste, die
 * niemand liest; die Zahl je Grund sagt, was zu verstehen ist.
 */
export function verworfenSatz(verworfen: readonly Verworfen[]): string {
  const anzahl = (grund: Verworfen["grund"]) =>
    verworfen.filter((eintrag) => eintrag.grund === grund).length;
  // Im Dativ, weil es „zu einer Seite" heißt.
  const seiten = (n: number) => (n === 1 ? "einer Seite" : `${n} Seiten`);

  const teile: string[] = [];
  const docling = anzahl("docling");
  const offen = anzahl("offen");
  const gelesen = anzahl("gelesen");

  if (docling > 0) teile.push(`${seiten(docling)}, die die App maschinell gelesen hat (Docling)`);
  if (offen > 0) teile.push(`${seiten(offen)}, die die App gerade selbst liest`);
  if (gelesen > 0) {
    teile.push(`${seiten(gelesen)}, die schon eine Abschrift ${gelesen === 1 ? "hat" : "haben"}`);
  }

  const aufgezaehlt =
    teile.length > 1
      ? `${teile.slice(0, -1).join(", ")} und ${teile[teile.length - 1]}`
      : (teile[0] ?? "");

  return `Verworfen ${verworfen.length === 1 ? "wurde die Abschrift" : "wurden die Abschriften"} zu ${aufgezaehlt} — die ids stehen unter „verworfen“.`;
}
