/**
 * Die vier Materialarten — und wie sie auf dem Bildschirm heißen.
 *
 * ── Warum das eine eigene Datei ohne einen einzigen Import ist ───────────────
 *
 * Weil das Formular unter /abruf/bausteine/neu eine Client-Komponente ist. Ein
 * `import … from "@/recall/items"` dort zieht über `@/db` die Datenbankschicht
 * in das Browserpaket, und der Bau bricht ab mit „Module not found: Can't
 * resolve 'fs'" — am 12.9.2026 genau so passiert, beim Versuch, die Liste an
 * EINE Stelle zu legen.
 *
 * Diese Datei importiert deshalb nichts. Sie ist eine Abmachung über vier
 * Wörter, und beide Seiten dürfen sie lesen: der Kern, der die Werte schreibt,
 * und die Oberfläche, die sie anzeigt.
 *
 * ── Und warum die Liste überhaupt an einer Stelle stehen muss ────────────────
 *
 * Sie stand dreimal da: als Aufzählung im Formularschema, als vier `<option>`
 * in der Oberfläche und als eigene Tabelle in der Bestandsliste — die Tür für
 * den Agenten wäre die vierte geworden. Eine fünfte Art hätte an vier Orten
 * nachgetragen werden müssen, und die Oberfläche ist der Ort, an dem man es
 * vergisst.
 *
 * Beliebig sind die Werte nicht: A10 mischt über den Materialtyp, und gemischt
 * wird nur Verwechselbares. Anschauungsklassen gewinnen dabei bis 0,67,
 * Begriff-Definition-Paare verlieren mit -0,39 — eine fünfte Art, hastig
 * hinzugefügt, wäre eine Klasse ohne Befund, die später mitgemischt wird.
 */
export const MATERIALARTEN = [
  "begriff",
  "anschauung",
  "verfahren",
  "ereignis",
] as const;

export type Materialart = (typeof MATERIALARTEN)[number];

/**
 * Der lange Name steht im Auswahlfeld, der kurze in der Bestandsliste.
 *
 * Beide hier, weil die Liste hier steht. Es sind die NAMEN der Werte dieser
 * Aufzählung und keine Oberfläche — dieselbe Rolle wie die Sätze an einer
 * Fehlerart.
 */
export const MATERIALART_NAMEN: Record<
  Materialart,
  { lang: string; kurz: string }
> = {
  begriff: { lang: "Begriff oder Definition", kurz: "Begriff" },
  anschauung: { lang: "Anschauung, Beispiel, Bild", kurz: "Anschauung" },
  verfahren: { lang: "Verfahren, Rechenweg", kurz: "Verfahren" },
  ereignis: { lang: "Ereignis, Datum, Ablauf", kurz: "Ereignis" },
};
