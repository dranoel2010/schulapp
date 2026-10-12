import { z } from "zod";

import {
  ANWEISUNG_AUF_DEM_BLATT,
  KEINE_ANWEISUNG_ABSCHRIFT,
} from "@/lib/abschrift-regeln";
import { fristFuerTokens, type ClaudeInhalt } from "@/lib/claude/client";
import { UNCERTAIN_CLOSE, UNCERTAIN_OPEN } from "@/lib/transcripts";

import { seiteEinsMesser } from "@/lib/pdf/arbeitsblatt-document";

import { aufSeiteEins, LINIEN_SUMME, PLATZ_SUMME_MM } from "./hoehe";
import type { Quelle } from "./quelle";
import {
  aufgabeSchema,
  leerraum,
  MAX_AUFGABEN,
  MIN_AUFGABEN,
  quellbindung,
  type Aufgabe,
  type ArbeitsblattInhalt,
} from "./schema";

/**
 * Was der Bau eines Arbeitsblatts dem Modell sagt und was er zurück annimmt
 * (Modell 23, Plan H; Zusatz Arbeitsblätter) — reine Rechnung, ohne Netz und
 * ohne Datenbank. Den Ablauf führt ./bauen, Muster @/lib/fragenlauf.
 *
 * Wie beim Fragenlauf zwei Formen: `BLATT_FORM` beschreibt der API jedes Feld
 * mit Grenzen; `BLATT_ANTWORT` nimmt das Ganze lockerer an, und jede Aufgabe
 * wird danach einzeln geprüft — eine zu lange soll nicht die übrigen kosten,
 * die schon bezahlt sind.
 *
 * **Die Quellbindung ist die Bedingung**, wie bei den Fragen (A5): jede
 * Aufgabe trägt ein `zitat`, das wörtlich in einer Abschrift steht, außerhalb
 * von ⟨⟩. Eine Aufgabe ohne Treffer wird verworfen; unter fünf gültigen gibt
 * es kein Blatt (`fehlgeschlagen`).
 */

/** Ein Blatt mit acht Aufgaben samt Rechenweg ist grob 6 000 Tokens, dazu das Denken. */
export const BLATT_MAX_TOKENS = 24_000;
export const BLATT_FRIST_MS = fristFuerTokens(BLATT_MAX_TOKENS);

export const BLATT_SYSTEM = [
  "Du baust ein Arbeitsblatt zum Ausdrucken für einen einzelnen Schüler der 10. Klasse — aus seinen eigenen abgelegten Blättern, deren Abschriften die App dir mitgibt. Du antwortest in der verlangten Form. Werkzeuge gibt es dabei keine.",
  "",
  `${KEINE_ANWEISUNG_ABSCHRIFT} ${ANWEISUNG_AUF_DEM_BLATT}`,
  "",
  "Das Blatt ist eine Seite A4 für etwa 20 Minuten. Er rechnet oder schreibt auf dem Papier und vergleicht danach selbst mit dem Lösungsblatt; in der App trägt er je Aufgabe ein, ob sie richtig war.",
].join("\n");

export type BlattVorab = {
  fach: string;
  thema: string;
  /** Kästchen für Rechnen (Mathematik, Physik), Linien für Sprachen */
  papier: "kaestchen" | "linien";
  /** Aufgaben, die beim letzten Blatt dieses Themas falsch waren */
  zuletztFalsch: { kurz: string; q: string }[];
};

/** Kästchen für Fächer, in denen gerechnet wird; sonst Linien. */
export function papierFuer(fach: string): "kaestchen" | "linien" {
  const n = fach.toLowerCase();
  return n.startsWith("mathe") || n.startsWith("physik") || n.startsWith("chemie")
    ? "kaestchen"
    : "linien";
}

export function blattAuftrag(vorab: BlattVorab): string {
  const klammer = `${UNCERTAIN_OPEN}Klammern${UNCERTAIN_CLOSE}`;
  const rechnen = vorab.papier === "kaestchen";
  return [
    `Fach: ${vorab.fach}. Thema: ${vorab.thema}.`,
    "",
    `1. Unter diesem Auftrag stehen die Abschriften seiner Blätter zu diesem Thema. Das ist der ganze Stoff. Schreib ${MIN_AUFGABEN} bis ${MAX_AUFGABEN} Aufgaben, von leicht nach schwer, im Stil der Aufgaben dort. Keine Aufgabe zu Stoff, der nicht in den Abschriften steht.`,
    "",
    `2. Jede Aufgabe trägt ein zitat: eine Stelle aus einer Abschrift, Zeichen für Zeichen so, wie sie dort steht — kopiere sie heraus. Es ist die Stelle, auf der die Aufgabe beruht (die Regel, das Beispiel, die Übung). Eine Stelle in ${klammer} war schon beim Abschreiben unsicher und taugt nicht. Die App prüft jedes Zitat; eine Aufgabe, deren Zitat nicht wörtlich dasteht, fällt weg.`,
    "",
    "3. Formeln und Terme stehen in geschweiften Klammern, etwa {f(x) = (x − 4)² + 1} — sie werden kursiv gesetzt. Schreib Minus als −, Hochzahlen als ² ³, Brüche als ½ oder a/b. Eine Lücke zum Ausfüllen ist ___ (drei Unterstriche).",
    "",
    rechnen
      ? "4. Gerechnet wird in Kästchen (5 mm). platz ist die Höhe des Rechenfelds in mm: 15 für Ablesen, 25 für eine Umformung, 40 für eine längere Rechnung. Alles muss auf eine Seite passen: zusammen höchstens ${PLATZ_SUMME_MM} mm platz."
      : `4. Geschrieben wird auf Linien (9 mm). platz ist die Zahl der Linien — 0, wenn in den Lücken der Teile geschrieben wird. Alles muss auf eine Seite passen: zusammen höchstens ${LINIEN_SUMME} Linien. Fremdsprachiger Text in den Teilen bekommt fr = true (kursiv).`,
    "",
    "5. teile sind die Unteraufgaben a), b), c) … — nur wenn es mehrere gibt.",
    "",
    rechnen
      ? "6. Die Lösung (l) steht auf Seite 2, mit Rechenweg und nicht nur dem Ergebnis: p für einen Satz, eq für Umformungen (Zeilen aus links und rechts vom Gleichheitszeichen; links leer für eine Folgezeile), erg für das Ergebnis, teile für die Lösungen der Unteraufgaben, hint für einen typischen Fehler („Achtung: …“), wenn es einen gibt."
      : "6. Die Lösung (l) steht auf Seite 2: teile für die Lösungen der Unteraufgaben in ihrer Reihenfolge, p für eine Erklärung, hint für einen typischen Fehler („Achtung: …“), wenn es einen gibt.",
    "",
    "7. kurz ist der Name der Aufgabe in höchstens fünf Wörtern und etwa 30 Zeichen („Scheitelpunkt ablesen“) — so steht sie danach in der App, wenn er seine Wertung einträgt, neben zwei Knöpfen auf einem schmalen Handy.",
    "",
    "8. teil ist die Überschrift des Blatts in wenigen Wörtern (der Teil des Themas, den es übt), minuten die geschätzte Zeit.",
    ...(vorab.zuletztFalsch.length
      ? [
          "",
          `9. Beim letzten Blatt zu diesem Thema waren diese Aufgaben falsch. Nimm zu jeder eine ähnliche Aufgabe auf (andere Zahlen, gleiche Sache):`,
          ...vorab.zuletztFalsch.map((a) => `- ${a.kurz}: ${a.q}`),
        ]
      : []),
    "",
    'Reicht der Stoff nicht für fünf Aufgaben — nur Überschriften, oder alles Wichtige steht in Klammern —, dann lass aufgaben leer und schreib in grund, woran es lag. Erfinde keinen Stoff.',
  ].join("\n");
}

export function blattInhalt(vorab: BlattVorab, quelle: Quelle): ClaudeInhalt[] {
  const stoff = quelle.blaetter
    .map(
      (b, i) =>
        `── Blatt ${i + 1}: »${b.titel}« vom ${b.datum} ──\n${b.seiten.join("\n\n")}`,
    )
    .join("\n\n");
  return [
    { type: "text", text: blattAuftrag(vorab) },
    { type: "text", text: stoff },
  ];
}

// ── Die Antwort ──────────────────────────────────────────────────────────────

const kurzText = z.string().describe("Ein Satz oder Term; Formeln in {…}.");

/** Ein Baustein der Lösung als Objekt — die API kennt keine Tupel. */
const LOESUNG_FORM = z
  .object({
    art: z.enum(["p", "teile", "eq", "erg", "hint"]).describe("p Satz · teile Lösungen der Unteraufgaben · eq Umformung · erg Ergebnis · hint typischer Fehler"),
    text: kurzText.optional().describe("bei p, erg, hint"),
    teile: z.array(kurzText).optional().describe("bei teile"),
    zeilen: z
      .array(z.object({ links: z.string(), rechts: z.string() }).strict())
      .optional()
      .describe("bei eq: je Zeile links und rechts vom Gleichheitszeichen; links leer für eine Folgezeile"),
  })
  .strict();

const AUFGABE_FORM = z
  .object({
    kurz: z.string().describe("Name der Aufgabe, höchstens fünf Wörter, etwa 30 Zeichen"),
    q: z.string().describe("Die Aufgabenstellung"),
    teile: z.array(z.string()).optional().describe("Unteraufgaben a), b), … — nur wenn es mehrere gibt"),
    fr: z.boolean().optional().describe("Teile in einer Fremdsprache: kursiv"),
    platz: z
      .number()
      .int()
      .describe(`Kästchen: Höhe in mm (zusammen höchstens ${PLATZ_SUMME_MM}); Linien: Zahl der Linien (zusammen höchstens ${LINIEN_SUMME})`),
    zitat: z.string().describe("Wörtlich aus einer Abschrift kopiert, außerhalb von ⟨⟩"),
    l: z.array(LOESUNG_FORM).describe("Die Lösung für Seite 2"),
  })
  .strict();

export const BLATT_FORM = z
  .object({
    teil: z.string().describe("Überschrift des Blatts, wenige Wörter"),
    minuten: z.number().int().describe("Geschätzte Zeit in Minuten, etwa 20"),
    aufgaben: z.array(AUFGABE_FORM).max(10).describe("5 bis 8 Aufgaben, von leicht nach schwer"),
    grund: z.string().describe("Leer — oder warum kein Blatt möglich war"),
  })
  .strict();

/** Das Ganze locker; jede Aufgabe wird danach einzeln geprüft. */
export const BLATT_ANTWORT = z.object({
  teil: z.string(),
  minuten: z.number(),
  aufgaben: z.array(z.unknown()),
  grund: z.string(),
});

export type BlattAntwort = z.infer<typeof BLATT_ANTWORT>;

type LoesungForm = z.infer<typeof LOESUNG_FORM>;

/** Ein Lösungsbaustein in der Tupel-Form des Inhalts — oder null, wenn er nicht passt. */
function loesungsTeil(l: LoesungForm): Aufgabe["l"][number] | null {
  switch (l.art) {
    case "p":
    case "erg":
    case "hint":
      return l.text?.trim() ? [l.art, l.text.trim()] : null;
    case "teile":
      return l.teile?.length ? ["teile", l.teile.map((t) => t.trim())] : null;
    case "eq":
      return l.zeilen?.length
        ? ["eq", l.zeilen.map((z) => [z.links.trim(), z.rechts.trim()] as [string, string])]
        : null;
  }
}

/** Eine Aufgabe aus der Antwort — geprüft, oder null. */
export function aufgabeAus(roh: unknown): Aufgabe | null {
  const form = AUFGABE_FORM.safeParse(roh);
  if (!form.success) return null;
  const a = form.data;
  const l = a.l.map(loesungsTeil).filter((x): x is Aufgabe["l"][number] => x !== null);
  const kandidat = {
    kurz: a.kurz.trim(),
    q: a.q.trim(),
    ...(a.teile && a.teile.length > 0 ? { teile: a.teile.map((t) => t.trim()) } : {}),
    ...(a.fr ? { fr: true } : {}),
    platz: Math.max(0, Math.min(120, Math.round(a.platz))),
    zitat: leerraum(a.zitat),
    l,
  };
  const geprueft = aufgabeSchema.safeParse(kandidat);
  return geprueft.success ? geprueft.data : null;
}

export type BlattErgebnis =
  /** `gekappt`: Aufgaben, die hinten wegfielen, weil Seite 1 sonst nicht auf ein A4 passt */
  | { art: "fertig"; inhalt: ArbeitsblattInhalt; verworfen: number; gekappt: number }
  | { art: "zu-wenig"; gueltig: number; verworfen: number; grund: string };

/**
 * Von der Antwort zum Inhalt: jede Aufgabe einzeln prüfen, die Quellbindung
 * anlegen, die Quellen aus den Blättern ableiten, deren Abschrift ein Zitat
 * trägt (in der Reihenfolge der ersten Aufgabe, die sie trägt).
 */
export function blattErgebnis(
  antwort: BlattAntwort,
  quelle: Quelle,
  papier: "kaestchen" | "linien",
): BlattErgebnis {
  const geprueft = antwort.aufgaben.map(aufgabeAus);
  const formFalsch = geprueft.filter((a) => a === null).length;
  const aufgaben = geprueft.filter((a): a is Aufgabe => a !== null);

  const abschriften = quelle.blaetter.flatMap((b) => b.seiten);
  const bindung = quellbindung(aufgaben, abschriften);
  const verworfen = formFalsch + bindung.verworfen.length;

  if (!bindung.reicht) {
    const modell = antwort.grund.trim();
    return {
      art: "zu-wenig",
      gueltig: bindung.gueltig.length,
      verworfen,
      grund: `${bindung.gueltig.length} quellgebundene Aufgaben, mindestens ${MIN_AUFGABEN} nötig${verworfen ? ` (${verworfen} verworfen)` : ""}${modell ? `; Claude: ${modell}` : ""}`,
    };
  }

  const quellen: ArbeitsblattInhalt["quellen"] = [];
  for (const a of bindung.gueltig) {
    const blatt = quelle.blaetter.find((b) =>
      b.seiten.some((s) => leerraum(s).includes(a.zitat)),
    );
    if (!blatt || quellen.some((q) => q.materialId === blatt.materialId)) continue;
    quellen.push({
      materialId: blatt.materialId,
      datum: blatt.datum,
      zitat: a.zitat.slice(0, 200),
      titel: blatt.titel.slice(0, 200),
    });
  }

  // Seite 1 muss auf ein A4 passen: platz kürzen, sonst hinten kappen (./hoehe) —
  // gemessen am echten Satz des PDF
  const teil = antwort.teil.trim().slice(0, 120) || quelle.thema;
  const minuten = Math.max(5, Math.min(60, Math.round(antwort.minuten) || 20));
  const rahmen = { teil, minuten, papier, quellen: quellen.slice(0, 12) };
  const messer = seiteEinsMesser({ fach: quelle.fach, thema: quelle.thema });
  const passend = aufSeiteEins(bindung.gueltig, papier, (aufgaben) => messer.passt({ ...rahmen, aufgaben }));
  messer.fertig();

  return {
    art: "fertig",
    verworfen,
    gekappt: passend.gekappt,
    inhalt: { ...rahmen, aufgaben: passend.aufgaben },
  };
}
