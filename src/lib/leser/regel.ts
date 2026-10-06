import type { Leser, LeserGrund, LeserGrundCode } from "@/db/schema";
import type { DoclingResult } from "@/lib/docling";
import { doclingZuAbschrift } from "@/lib/leser/abschrift";

/**
 * Die feste Regel, nach der die App entscheidet, wer eine Seite liest — reine
 * Rechnung, ohne Netz und ohne Datenbank (seit dem 6.10.2026).
 *
 * Billig zuerst, und jede Stufe kann nur zu Claude schicken, nie zu Docling:
 *
 *   a) Docling meldet Erfolg, und der Text ist nicht leer;
 *   b) mindestens `MIN_WOERTER` Wörter aus mindestens drei Buchstaben;
 *   c) kein Formelverdacht (`formelVerdacht()`);
 *   d) die Abschrift passt in eine Seite (`MATERIAL_TRANSCRIPT_MAX`);
 *   e) danach Jev: hält es den Text mit mindestens `JEV_SCHWELLE` für
 *      sauber, liest Docling allein. Die Frage stellt @/lib/leser/zuteilung.
 *
 * Gemessen am 5.10.2026 an 37 echten Seiten (die Messung liegt mit den
 * Seiten außerhalb des Repos): mit
 * Jev ≥ 0,5 und ≥ 60 Wörtern lasen 12 Seiten Docling allein, keine davon
 * falsch; mit dem Formelverdacht dazu sind es 11. Die Schwellen sind an genau
 * diesen Seiten gewählt — in-sample, zwei davon dasselbe Handout. Wer sie
 * ändert, erhöht `REGEL_VERSION`, damit `leser_grund` zeigt, nach welcher
 * Fassung eine Seite entschieden wurde.
 *
 * Kein Wörterbuch, kein Hunspell, kein neues Paket (Entscheidung 2): die
 * Unterscheidung „sauberer Druck oder Kauderwelsch aus Handschrift“ trifft
 * Jev, die Regel davor hält nur die Fälle fern, in denen ein Lesefehler teuer
 * wäre (Formeln) oder nichts zu entscheiden ist (zu wenig Text).
 *
 * Diese Datei importiert @/lib/materials NICHT: dort holt `createMaterialWithPage()`
 * sich `leserBeimAnlegen()` von hier, und ein Import zurück wäre ein Zyklus.
 */

/** Die Fassung der Regel, festgehalten in `leser_grund.regel`. */
export const REGEL_VERSION = 1;

/** Unter so vielen Wörtern liest Claude — zu wenig für eine Einstufung. */
export const MIN_WOERTER = 60;

/** Ab dieser Wahrscheinlichkeit für „sauber“ liest Docling allein. */
export const JEV_SCHWELLE = 0.5;

/**
 * So lange muss die jüngste Seite eines Blattes alt sein, bevor die App aus
 * einem reinen Docling-Blatt einen Vorschlag macht. Der Spiegel von
 * `RUHE_SEKUNDEN` in harness/postbote.mts: die Rückseite kommt über „Seite
 * hinzufügen“ erst nach der Vorderseite, und ein Vorschlag dazwischen ordnete
 * ein halbes Blatt ein.
 */
export const RUHE_MS = 20_000;

/**
 * Die Notbremse: `LESER_REGEL=aus` (Groß-/Kleinschreibung und Rand egal).
 * Dann fragt die App Docling nicht, und jede neue Seite liest Claude — der
 * Stand vor Docling, ohne neuen Bau.
 */
export function leserRegelAus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (env.LESER_REGEL ?? "").trim().toLowerCase() === "aus";
}

/** Ein Grund ohne jede Messung — für Seiten, die Docling nie gesehen hat. */
export function grundOhneMessung(grund: LeserGrundCode): LeserGrund {
  return {
    regel: REGEL_VERSION,
    grund,
    woerter: null,
    formel: null,
    zeichen: null,
    jev: null,
    sekunden: null,
  };
}

/**
 * Was eine neue Seite beim Anlegen bekommt.
 *
 * Steht im Anlegen selbst und nicht erst in der Zuteilung, damit die
 * Notbremse auch dann wirkt, wenn die Zuteilung klemmt: eine Seite, die mit
 * `'claude'` entsteht, ist sofort beim Postboten, ohne dass irgendein Lauf
 * sie anfassen muss.
 */
export function leserBeimAnlegen(
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  leser: Leser;
  leserGrund: LeserGrund | null;
} {
  return leserRegelAus(env)
    ? { leser: "claude", leserGrund: grundOhneMessung("aus") }
    : { leser: "offen", leserGrund: null };
}

/**
 * Doclings Markdown ohne die Auszeichnung, die nicht als Wort zählen soll.
 * Zeichen für Zeichen die Säuberung, mit der die Schwelle am 5.10.2026
 * gemessen wurde (das Messskript liegt außerhalb des Repos, weil es an echten
 * Schülerseiten lief) — eine andere Säuberung zählte andere Wörter, und die
 * 60 gälten nicht mehr.
 */
function doclingText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\$\$?([^$]*)\$\$?/g, " $1 ")
    .replace(/[#*|`_>\\-]+/g, " ");
}

/**
 * Die Wörter in Doclings Text: reine Buchstabenfolgen ab drei Zeichen.
 *
 * Zahlen, Kürzel, Markup und Einzelbuchstaben fallen heraus; ein
 * französisches „l'eau“ zählt als „eau“. Wörtlich aus der Messung
 * übernommen, aus demselben Grund wie `doclingText()`.
 */
export function woerterAus(markdown: string): string[] {
  const tokens =
    doclingText(markdown ?? "")
      .normalize("NFC")
      .match(/[\p{L}][\p{L}'’]*/gu) ?? [];

  return tokens
    .map((t) => t.replace(/^(?:qu|[ldjnsctm])['’]/i, "").replace(/['’]+$/, ""))
    .filter((t) => t.length >= 3);
}

/**
 * Die Muster des Formelverdachts, in fester Reihenfolge — der Name des
 * ersten Treffers landet in `leser_grund.formel`.
 *
 * Eine Seite mit Formel geht an Claude, auch wenn Docling sie sauber las.
 * Docling liest Formeln als LaTeX, und in einer Abschrift ohne ⟨⟩ wäre ein
 * verlesenes Vorzeichen zitierfähig; genau dort ist ein Lesefehler am
 * teuersten. Die beiden letzten Muster schließen den dokumentierten Fehler
 * „f'(x) wird zu f(x)“ ein, den weder ein Zeichen wie „=“ noch die Wortzahl
 * fängt.
 *
 * `buchstabe-ziffer` ist wörtlich nach der Entscheidung gebaut und trifft
 * deshalb auch CO2, M1 oder A4. Im Messbestand kostet das keine Seite; ob es
 * im Betrieb Druckseiten an Claude schickt, zeigt `leser_grund.formel`.
 */
const FORMELMUSTER: readonly (readonly [string, RegExp])[] = [
  ["dollar", /\$/],
  ["formula-not-decoded", /formula-not-decoded/],
  ["latex", /\\[A-Za-z]+/],
  ["gleich", /=/],
  ["kleiner-gleich", /≤/],
  ["groesser-gleich", /≥/],
  ["wurzel", /√/],
  ["hoch", /\^/],
  ["quadrat", /²/],
  ["kubik", /³/],
  ["buchstabe-ziffer", /\p{L}\p{Nd}/u],
  ["funktion", /\p{L}\(/u],
  // Ein einzelner Buchstabe mit Strich: f' und f'(x), aber nicht l'eau
  // (danach ein Buchstabe) und nicht don't (davor einer).
  ["strich", /(?<!\p{L})\p{L}['’′]+(?!\p{L})/u],
];

/** Der Name des ersten Formelmusters, das auf Doclings Markdown trifft, oder `null`. */
export function formelVerdacht(markdown: string): string | null {
  for (const [name, muster] of FORMELMUSTER) {
    if (muster.test(markdown)) return name;
  }

  return null;
}

/** Was die Regel an einer Seite gemessen hat — für `leser_grund`. */
export type Merkmale = {
  woerter: number;
  formel: string | null;
  /** Länge der Abschrift; `null`, wenn es nichts umzuwandeln gab. */
  zeichen: number | null;
};

export type Vorpruefung =
  | { ok: true; abschrift: string; merkmale: Merkmale }
  | {
      ok: false;
      grund: Extract<
        LeserGrundCode,
        "nicht-erfolg" | "leer" | "zu-wenig-woerter" | "formel" | "zu-lang"
      >;
      merkmale: Merkmale;
    };

/**
 * Die Regel a bis d über eine Docling-Antwort.
 *
 * Gemessen wird immer alles, entschieden in der festen Reihenfolge: auch eine
 * Seite, die schon an der Wortzahl scheitert, trägt ihren Formelverdacht und
 * ihre Länge in `leser_grund`. Das kostet nichts und ist genau das, was man
 * später zum Nachmessen braucht.
 */
export function vorpruefen(
  ergebnis: DoclingResult,
  maxZeichen: number,
): Vorpruefung {
  const markdown = ergebnis.markdown ?? "";
  const leer = markdown.trim() === "";
  const abschrift = leer ? "" : doclingZuAbschrift(markdown);

  const merkmale: Merkmale = {
    woerter: woerterAus(markdown).length,
    formel: formelVerdacht(markdown),
    zeichen: leer ? null : abschrift.length,
  };

  if (ergebnis.status !== "success") {
    return { ok: false, grund: "nicht-erfolg", merkmale };
  }
  if (leer) return { ok: false, grund: "leer", merkmale };
  if (merkmale.woerter < MIN_WOERTER) {
    return { ok: false, grund: "zu-wenig-woerter", merkmale };
  }
  if (merkmale.formel !== null) return { ok: false, grund: "formel", merkmale };
  if (abschrift.length > maxZeichen) {
    return { ok: false, grund: "zu-lang", merkmale };
  }

  return { ok: true, abschrift, merkmale };
}

/**
 * Was die App über ein Blatt wissen muss, um einen eigenen Vorschlag
 * anzulegen — die Form von `KorbblattStand` in @/lib/materials, hier ohne
 * Import beschrieben (siehe Kopf).
 */
export type KorbblattZahlen = {
  eingeordnet: boolean;
  vorschlaege: number;
  /** Seiten mit `leser = 'offen'`. */
  offen: number;
  /** Seiten ohne Abschrift (`transcript IS NULL`). */
  ungelesen: number;
  /** Seiten mit `maschinell = true`. */
  maschinell: number;
  seitLetzterSeiteMs: number;
};

export type VorschlagFaellig =
  | { art: "jetzt" }
  | { art: "warten"; ms: number }
  | { art: "nein"; warum: string };

/**
 * Ist es Zeit für den Vorschlag der App (Entscheidung 8)?
 *
 * „jetzt“ nur für ein Blatt im Korb, an dem kein Vorschlag liegt, jede Seite
 * entschieden und gelesen ist und mindestens eine davon Docling geschrieben
 * hat — ein Blatt also, zu dem kein Agent mehr kommt. Eine offene
 * Claude-Seite heißt: der Postbote kommt, und sein Vorschlag nimmt den
 * Bestand mit. „warten“, solange die jüngste Seite jünger ist als die Ruhe;
 * die halbe Sekunde obendrauf sorgt dafür, dass der Wecker nicht eine
 * Millisekunde zu früh klingelt und gleich noch einmal warten muss.
 */
export function appVorschlagFaellig(
  stand: KorbblattZahlen,
  ruheMs: number,
): VorschlagFaellig {
  if (stand.eingeordnet) return { art: "nein", warum: "schon eingeordnet" };
  if (stand.vorschlaege > 0) return { art: "nein", warum: "ein Vorschlag liegt" };
  if (stand.offen > 0) return { art: "nein", warum: "eine Seite ist offen" };
  if (stand.ungelesen > 0) return { art: "nein", warum: "Claude liest noch" };
  if (stand.maschinell === 0) {
    return { art: "nein", warum: "keine Seite von Docling" };
  }
  if (stand.seitLetzterSeiteMs < ruheMs) {
    return { art: "warten", ms: ruheMs - stand.seitLetzterSeiteMs + 500 };
  }

  return { art: "jetzt" };
}
