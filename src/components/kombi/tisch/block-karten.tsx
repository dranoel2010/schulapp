"use client";

/**
 * Die Karten im Lernblock: die heute offenen Fragen der Klausurthemen
 * (`fragenFuerLernblock`), beantwortet und beurteilt wie beim Wiederholen
 * (V2 9.1, 6.4). Eine Frage, die hier saß, ist auch für Wiederholen erledigt
 * (Kriterium 47) — beide schreiben über `versuchFesthalten`/`urteilFesthalten`
 * denselben Termin.
 *
 * Den Kartenstapel baut Abschnitt E (Ticks, Zähler, Stapel, Knöpfe:
 * `kombi/tisch/*`). Diese Stelle ist die Schnittstelle dorthin: Beim
 * Zusammenführen rendert sie Es Stapel mit `fragen` statt der Themenfragen
 * und meldet das Ende über `onEnde` — der Lernblock-Tisch zeigt dann
 * „Fragen für heute durch.“ mit „Weiter mit Material“ und „Block beenden“.
 *
 * Bis dahin steht nur der Zähler aus `.t-meta` da („3 Fragen“); Uhr,
 * Material und Schließen arbeiten unabhängig davon.
 */

export type BlockKartenProps = {
  blockId: string;
  fragen: { scheduleId: string; itemId: string }[];
  /** n Fragen, ok davon beim ersten Mal gewusst */
  onEnde: (ergebnis: { n: number; ok: number }) => void;
};

export function BlockKarten({ fragen }: BlockKartenProps) {
  return (
    <div className="t-meta" id="tMeta">
      <p className="t-count" id="tCount">
        {fragen.length === 1 ? "1 Frage" : `${fragen.length} Fragen`}
      </p>
    </div>
  );
}
