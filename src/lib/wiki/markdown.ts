/**
 * Markdown und YAML für die Wiki-Übergabe — die Schicht, die feindlichen Text
 * einpackt.
 *
 * **Jeder Wert aus der Datenbank ist hier feindlich, ausnahmslos.** Das ist
 * keine Vorsichtsformel: Auf einem abfotografierten Blatt kann alles stehen,
 * die Abschrift bringt es wörtlich in `material_pages.transcript`, und über
 * einen übernommenen Vorschlag (`material_proposals`) wandert Text von einem
 * Blatt auch in Titel, Notiz und Thema. Ein Titel mit einem Zeilenumbruch
 * zerlegt eine YAML-Zeile; ein Text mit „---" am Zeilenanfang zerlegt das
 * Frontmatter; ein Text mit „```" bricht aus einem Codeblock aus. Alle drei
 * enden damit, dass der Agent im Vault etwas anderes liest, als auf dem Blatt
 * stand.
 *
 * ── Die Regel, nach der die Renderer arbeiten ────────────────────────────────
 *
 * Es gibt genau zwei Wege für fremden Text, und jeder Wert nimmt einen davon:
 *
 *   1. **Kurze Werte** — Titel, Fachname, Thema, Raum — gehen durch
 *      `inlineText()` und stehen dann in einer Überschrift oder einer Zeile.
 *      Sie werden einzeilig gemacht und ihre Markdown-Sonderzeichen maskiert.
 *   2. **Freier Text** — die Abschrift einer Seite, eine Notiz — geht durch
 *      `codeBlock()` und steht wörtlich in einem Codeblock. Wörtlich ist bei
 *      einer Abschrift Pflicht: sie ist das, was auf dem Blatt steht, und
 *      maskierte Sterne wären eine Verfälschung.
 *
 * Ins Frontmatter kommt nur der erste Weg, und dort zusätzlich in
 * Anführungszeichen (`yamlText()`). Ein YAML-Wert in doppelten
 * Anführungszeichen kann jedes Zeichen tragen, solange „\" und „"" maskiert
 * sind — und einzeilig ist er hier schon.
 *
 * ── Was diese Datei ausdrücklich NICHT tut ───────────────────────────────────
 *
 * Sie baut keine Dateinamen. Ein Dateiname entsteht ausschließlich aus einer
 * Art und einer UUID (`documentId()` in @/lib/wiki/documents) und nie aus einem
 * Titel — deshalb kann ein Fach „Deutsch/Französisch" keinen Pfad erzeugen, der
 * aus dem Übergabeordner herausführt. Geprüft wird das in
 * `fileNameFor()` in @/lib/wiki/folder.
 *
 * Reine Zeichenkettenarbeit: kein Datenbankzugriff, kein Dateisystem, kein
 * Import aus Next. Deshalb ist alles hier ohne Datenbank prüfbar, und
 * markdown.test.ts prüft es Zeichen für Zeichen.
 */

/** Was in einer Frontmatter-Zeile stehen kann. `null` heißt: Zeile weglassen. */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | undefined;

/** Eine Zeile im Frontmatter. Der Schlüssel steht immer im Code, nie in den Daten. */
export type FrontmatterField = {
  key: string;
  value: FrontmatterValue;
};

/**
 * Zeichen, die eine Zeile zerlegen oder ihre Leserichtung umdrehen können.
 *
 * Die erste Gruppe ist Steuerzeichen und Zeilentrenner — sie machen aus einer
 * YAML-Zeile zwei. Die zweite ist die unsichtbare: U+202A bis U+202E und
 * U+2066 bis U+2069 kehren die Anzeigerichtung um, U+200B und U+FEFF sind
 * breitenlos. Damit lässt sich ein Titel bauen, der im Vault etwas anderes
 * zeigt, als in der Datei steht — die Datei sagt „blatt-9c11", der Agent liest
 * „11c9-ttalb". Kein theoretischer Fall bei Text, der von einem Blatt kommt.
 *
 * U+200D (der Zusammenbinder in Emoji-Folgen) steht bewusst NICHT dabei: er
 * hält „👨‍👩‍👧" zusammen und richtet keinen Schaden an.
 */
const UNSICHTBAR = /[\u200b\u202a-\u202e\u2066-\u2069\ufeff]/gu;

/** Steuerzeichen, Zeilentrenner und jede Art von Leerraum. */
const LEERRAUM = /[\p{Cc}\p{Zl}\p{Zp}\s]+/gu;

/**
 * Was in Markdown eine Bedeutung hat und deshalb maskiert wird.
 *
 * `\` zuerst, sonst maskierte die Funktion ihre eigenen Schrägstriche noch
 * einmal. Dann die Auszeichnungen (`*` `_` `~`), das Wörtliche (`` ` ``), die
 * Verweise (`[` `]` — damit kann auch „![" kein Bild mehr werden), die
 * HTML-Klammern (`<` `>`), der Tabellentrenner (`|`) und die Raute.
 *
 * Die Raute sieht nach Übereifer aus und ist keiner: In Obsidian wird aus
 * „Aufgabe #wichtig" ein **Tag** im Vault. Ein Blatt könnte sich damit selbst
 * verschlagworten, und der Agent fände hinterher Themen, die niemand vergeben
 * hat.
 */
const MARKDOWN_SONDERZEICHEN = /[\\`*_[\]<>|#~]/g;

/**
 * Aus beliebigem Text eine einzige Zeile.
 *
 * Jeder Umbruch, jedes Steuerzeichen und jede Folge von Leerraum wird zu einem
 * einzelnen Leerzeichen, die unsichtbaren Zeichen fallen ganz weg. Danach ist
 * der Wert für eine YAML-Zeile und für eine Überschrift geeignet — beide
 * enden am Zeilenende, und beide würden von einem Umbruch mittendrin
 * auseinandergerissen.
 */
export function singleLine(value: string): string {
  return value.replace(UNSICHTBAR, "").replace(LEERRAUM, " ").trim();
}

/**
 * Ein kurzer Wert, wie er mitten in einer Markdown-Zeile stehen darf:
 * einzeilig und ohne Sonderzeichen mit Wirkung.
 *
 * Gedacht für Titel, Fachnamen, Themen, Räume — alles, was in eine Überschrift
 * oder hinter einen Gedankenstrich kommt. NICHT gedacht für eine Abschrift:
 * die soll wörtlich bleiben und geht durch `codeBlock()`.
 */
export function inlineText(value: string): string {
  return singleLine(value).replace(MARKDOWN_SONDERZEICHEN, "\\$&");
}

/**
 * Ein YAML-Wert in doppelten Anführungszeichen.
 *
 * In dieser Form darf ein YAML-Wert jedes Zeichen tragen; zu maskieren sind
 * nur der Rückstrich und das Anführungszeichen selbst — in dieser Reihenfolge,
 * sonst würde das eben eingefügte „\" der zweiten Ersetzung noch einmal
 * maskiert. Umbrüche kann es hier nicht mehr geben, `singleLine()` läuft davor.
 *
 * Immer in Anführungszeichen, auch bei „Mathematik". Ohne sie läse ein
 * YAML-Leser „ja", „nein", „null" und „2026-09-01" als Wahrheitswert, als
 * Nichts und als Datum — und ein Fach namens „No" wäre plötzlich `false`.
 */
export function yamlText(value: string): string {
  const einzeilig = singleLine(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  return `"${einzeilig}"`;
}

/**
 * Eine Liste als YAML-Flussfolge: `["Kettenregel", "Ableitungen"]`.
 *
 * In einer Zeile und nicht als Aufzählung über mehrere, weil eine Zeile pro
 * Feld die ganze Datei berechenbar hält: jedes Frontmatter-Feld ist genau eine
 * Zeile, und keine davon kann durch einen Wert zu zweien werden.
 */
export function yamlList(values: readonly string[]): string {
  if (values.length === 0) return "[]";

  return `[${values.map(yamlText).join(", ")}]`;
}

/**
 * Der Frontmatter-Block einer Datei, mit den beiden „---" drumherum.
 *
 * Felder mit `null` oder `undefined` fallen heraus, und das ist eine
 * Entscheidung: `fach: ""` an einem Stundenplan sähe aus wie ein Fach ohne
 * Namen. Ein fehlender Schlüssel heißt „gibt es bei dieser Art nicht" — genau
 * so steht es in der Legende der MANIFEST.md, damit der Agent nicht raten muss.
 *
 * Ein leerer String bleibt dagegen stehen. Er ist ein Wert wie jeder andere:
 * bei einer Abschrift heißt er „gelesen, es stand nichts darauf", und dieser
 * Unterschied zu „noch nie gelesen" gilt in der ganzen App.
 */
export function frontmatterBlock(fields: readonly FrontmatterField[]): string {
  const zeilen: string[] = ["---"];

  for (const { key, value } of fields) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      zeilen.push(`${key}: ${yamlList(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      zeilen.push(`${key}: ${value}`);
    } else {
      zeilen.push(`${key}: ${yamlText(value as string)}`);
    }
  }

  zeilen.push("---");

  return zeilen.join("\n");
}

/**
 * Fremder Text, wörtlich, in einem Codeblock — die einzige Form, in der eine
 * Abschrift in die Datei kommt.
 *
 * Der Zaun ist so lang, wie er sein muss: Ein Codeblock endet an einer Zeile
 * mit mindestens so vielen Rückwärtsstrichen, wie ihn geöffnet haben. Steht in
 * der Abschrift selbst „```" — und auf einem abfotografierten Blatt mit
 * Programmcode steht genau das —, dann bricht ein fester Dreierzaun an dieser
 * Stelle auf, und alles dahinter ist wieder Markdown. Deshalb wird die längste
 * Folge im Text gesucht und der Zaun einen länger gemacht; damit kann keine
 * Zeile im Text ihn schließen.
 *
 * Kein Sprachkürzel hinter dem öffnenden Zaun. Es wäre eine Behauptung über
 * den Inhalt, und die App weiß nichts über ihn.
 *
 * Der Text selbst wird NICHT angefasst — kein Maskieren, kein Kürzen, kein
 * Glätten von Umbrüchen. Eine Abschrift ist das, was auf dem Blatt steht; wer
 * hier etwas verbessert, macht aus einer Quelle eine Nacherzählung.
 */
export function codeBlock(text: string): string {
  const zaun = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));

  return `${zaun}\n${text}\n${zaun}`;
}

/** Wie viele Rückwärtsstriche die längste Folge im Text hat; 0, wenn keiner. */
function longestBacktickRun(text: string): number {
  let laengste = 0;

  for (const treffer of text.matchAll(/`+/g)) {
    laengste = Math.max(laengste, treffer[0].length);
  }

  return laengste;
}
