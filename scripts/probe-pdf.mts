/**
 * Erzeugt ein Fach-PDF aus erfundenen Daten — ohne Datenbank, ohne Server.
 *
 * Warum es das gibt: `buildSubjectPdf()` lässt sich mit Tests bis an den Rand
 * prüfen, aber ob am Ende ein PDF herauskommt, in dem ein α auch wirklich ein α
 * ist, sieht man erst an der Datei. Der Fehler, um den es geht, ist stumm: eine
 * Schrift ohne das Zeichen zeichnet ein leeres Kästchen, und niemand bemerkt es
 * vor dem Ausdrucken.
 *
 * Die Daten hier sind deshalb absichtlich die schwierigen:
 *   • griechische Buchstaben und Mengenzeichen — die fehlen Geist
 *   • ⟨spitze Klammern⟩ — die fehlen Geist AUCH, und sie stehen in fast
 *     jeder Abschrift
 *   • Französisch mit Accents und Guillemets
 *   • alle drei Zustände einer Seite: Text, "" und null
 *   • ein Foto, das kein Foto ist (WebP kann pdfkit nicht einbetten)
 *   • ein Zeichen, das KEINE der beiden Schriften kann
 *
 * Aufruf:
 *   npx tsx scripts/probe-pdf.mts /tmp/probe.pdf
 */

import { writeFileSync } from "node:fs";

import sharp from "sharp";

import {
  buildSubjectPdf,
  type PdfImage,
  type SubjectPdfInput,
} from "@/lib/pdf/subject-document";

const ziel = process.argv[2] ?? "/tmp/probe-fach.pdf";

/**
 * `--nur <n>` nimmt nur das n-te Blatt (ab 1). Gedacht dafür, einen einzelnen
 * Fall auf Seite 1 zu bekommen — die Vorschau von macOS zeigt nur die erste.
 */
const nurIndex = (() => {
  const stelle = process.argv.indexOf("--nur");
  if (stelle === -1) return null;
  const zahl = Number(process.argv[stelle + 1]);
  return Number.isInteger(zahl) && zahl > 0 ? zahl : null;
})();

/** Ein echtes JPEG, damit pdfkit etwas zum Einbetten hat. */
const jpeg = await sharp({
  create: { width: 1240, height: 1754, channels: 3, background: "#eef1f5" },
})
  .jpeg({ quality: 72 })
  .toBuffer();

/** Ein echtes WebP — das kann pdfkit NICHT, und genau das soll es zeigen. */
const webp = await sharp({
  create: { width: 800, height: 1000, channels: 3, background: "#e8e8e8" },
})
  .webp()
  .toBuffer();

const eingabe: SubjectPdfInput = {
  subject: { name: "Mathematik", color: "blue" },
  today: "2026-09-05",
  cutOff: false,
  sheets: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Ableitungsregeln",
      capturedOn: "2026-08-25",
      note: "Seite 3 war nicht zu lesen.",
      topics: ["Ableitungen", "Kettenregel"],
      pages: [
        {
          pageId: "aaaa1111-1111-4111-8111-111111111111",
          transcript:
            "Die ⟨Kettenregel⟩ lautet: f(g(x))' = f'(g(x)) · g'(x).\n\n" +
            "Für α, β ∈ ℝ und θ ∈ [0, 2π] gilt:\n" +
            "  sin²θ + cos²θ = 1\n" +
            "  Σ von k=1 bis n:  k = n(n+1)/2\n" +
            "  √2 ≈ 1,414   und   Δx ≤ ε\n\n" +
            "Merke: γ ist die ⟨Euler-Mascheroni/Euler-Maskeroni⟩-Konstante.\n" +
            "Für M ⊂ ℕ mit σ(M) < ∞ folgt …",
        },
        {
          pageId: "aaaa2222-2222-4222-8222-222222222222",
          transcript: "",
        },
        {
          pageId: "aaaa3333-3333-4333-8333-333333333333",
          transcript: null,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Vocabulaire — les fonctions",
      capturedOn: "2026-08-28",
      note: null,
      topics: ["Kettenregel"],
      pages: [
        {
          pageId: "bbbb1111-1111-4111-8111-111111111111",
          transcript:
            "« La dérivée d'une fonction composée » — Übersetzung geübt.\n" +
            "l'accroissement, la tangente, le cœur du problème, être élève.\n" +
            "Achtung: ce n'est pas « où » sondern « ou ».",
        },
      ],
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      title: "Blatt mit WebP",
      capturedOn: "2026-08-30",
      note: null,
      topics: [],
      pages: [
        {
          pageId: "cccc1111-1111-4111-8111-111111111111",
          transcript: "Dieses Foto liegt als WebP vor. 漢字 kann keine der beiden Schriften.",
        },
        {
          pageId: "cccc2222-2222-4222-8222-222222222222",
          transcript: "Für dieses Foto war das Budget erschöpft.",
        },
      ],
    },
  ],
};

const bilder: Record<string, PdfImage> = {
  "aaaa1111-1111-4111-8111-111111111111": { kind: "bytes", bytes: jpeg },
  "aaaa2222-2222-4222-8222-222222222222": { kind: "bytes", bytes: jpeg },
  "aaaa3333-3333-4333-8333-333333333333": { kind: "gone" },
  "bbbb1111-1111-4111-8111-111111111111": { kind: "bytes", bytes: jpeg },
  "cccc1111-1111-4111-8111-111111111111": { kind: "bytes", bytes: webp },
  "cccc2222-2222-4222-8222-222222222222": { kind: "budget" },
};

if (nurIndex !== null) {
  const gewaehlt = eingabe.sheets[nurIndex - 1];
  if (!gewaehlt) {
    console.error(`Es gibt kein ${nurIndex}. Blatt (nur ${eingabe.sheets.length}).`);
    process.exit(1);
  }
  eingabe.sheets = [gewaehlt];
}

const bytes = await buildSubjectPdf(eingabe, async (pageId) => {
  const bild = bilder[pageId];
  if (!bild) throw new Error(`Kein Bild hinterlegt für ${pageId}`);
  return bild;
});

writeFileSync(ziel, bytes);

const kopf = Buffer.from(bytes.slice(0, 8)).toString("latin1");
const text = Buffer.from(bytes).toString("latin1");
const seiten = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const schriften = [...new Set(text.match(/\/BaseFont\s*\/[A-Za-z0-9+#-]+/g) ?? [])];

console.log(`\nGeschrieben: ${ziel}`);
console.log(`  Kopf:      ${kopf.trim()}`);
console.log(`  Größe:     ${Math.round(bytes.byteLength / 1024)} KB`);
console.log(`  Seiten:    ${seiten > 0 ? seiten : "(komprimiert, nicht zählbar)"}`);
console.log(`  Schriften: ${schriften.length > 0 ? schriften.join(", ") : "(komprimiert)"}`);
console.log("");
