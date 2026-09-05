/**
 * Der Durchlauf mit ECHTEN Daten: echte Fotos aus der Ablage, echte Abschriften
 * davon, durch den echten Erzeuger des Fach-PDF und die echten Wiki-Renderer.
 *
 * Warum es das neben scripts/probe-pdf.mts gibt: dort sind die Daten erfunden
 * und so gewählt, dass sie die Grenzfälle treffen — griechische Buchstaben,
 * WebP, ein leeres Budget. Hier ist nichts gewählt. Es sind drei Blätter aus dem
 * Geografieheft, so fotografiert, wie sie fotografiert wurden, und so
 * abgeschrieben, wie ein Modell sie wirklich liest, samt aller ⟨spitzen
 * Klammern⟩, die dabei stehen geblieben sind.
 *
 * Der Unterschied ist nicht kosmetisch. Erfundene Testdaten sind ordentlich:
 * gerade Zeilen, saubere Umlaute, keine Durchstreichung. Ein echtes Heft bringt
 * eine durchgestrichene „⟨überproduktion⟩", eine Überschrift, die anders
 * geschrieben ist als der Titel in der App, und fünf Vornamen, bei denen der
 * Leser zwischen zwei Lesungen schwankt.
 *
 * Es wird NICHTS geschrieben — weder in die Datenbank noch an die Blätter. Die
 * Abschriften stehen in einer JSON-Datei daneben und gehen nur durch die
 * Erzeuger.
 *
 * Aufruf:
 *   npx tsx scripts/probe-echte-blaetter.mts <daten.json> <fotos-ordner> <ziel-ordner>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildSubjectPdf,
  type PdfSheetEntry,
  type SubjectPdfInput,
} from "@/lib/pdf/subject-document";

type EchtesBlatt = {
  id: string;
  title: string;
  capturedOn: string;
  note: string | null;
  topics: string[];
  foto: string;
  transcript: string;
};

const [datenPfad, fotoOrdner, zielOrdner] = process.argv.slice(2);
if (!datenPfad || !fotoOrdner || !zielOrdner) {
  console.error(
    "Aufruf: npx tsx scripts/probe-echte-blaetter.mts <daten.json> <fotos> <ziel>",
  );
  process.exit(1);
}

mkdirSync(zielOrdner, { recursive: true });

const blaetter: EchtesBlatt[] = JSON.parse(readFileSync(datenPfad, "utf8"));

/* Jedes Blatt hat genau eine Seite — so liegen sie in der Ablage. Die Seiten-id
   ist hier die des Fotos; für das PDF zählt nur, dass sie eindeutig ist und der
   Bildlader sie wiederfindet. */
const sheets: PdfSheetEntry[] = blaetter.map((b) => ({
  id: b.id,
  title: b.title,
  capturedOn: b.capturedOn,
  note: b.note,
  topics: b.topics,
  pages: [{ pageId: b.foto, transcript: b.transcript }],
}));

const eingabe: SubjectPdfInput = {
  subject: { name: "Geografie", color: "orange" },
  sheets,
  today: "2026-09-05",
  cutOff: false,
};

const bytes = await buildSubjectPdf(eingabe, async (pageId) => ({
  kind: "bytes",
  bytes: readFileSync(path.join(fotoOrdner, `${pageId}.jpg`)),
}));

const ziel = path.join(zielOrdner, "Geografie-echt.pdf");
writeFileSync(ziel, bytes);

const roh = Buffer.from(bytes).toString("latin1");
const seiten = (roh.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const schriften = [...new Set(roh.match(/\/BaseFont\s*\/[A-Za-z0-9+#-]+/g) ?? [])];

console.log(`\nGeschrieben: ${ziel}`);
console.log(`  Blätter:   ${sheets.length}`);
console.log(`  Zeichen:   ${blaetter.reduce((s, b) => s + b.transcript.length, 0)}`);
console.log(`  Größe:     ${Math.round(bytes.byteLength / 1024)} KB`);
console.log(`  Seiten:    ${seiten > 0 ? seiten : "(komprimiert)"}`);
console.log(`  Schriften: ${schriften.join(", ") || "(komprimiert)"}`);

/* Wie viele ⟨spitze Klammern⟩ stecken wirklich in diesen drei Abschriften?
   Das ist die Zahl, die im PDF hervorgehoben und im Formular gezählt wird. */
const klammern = blaetter.reduce(
  (s, b) => s + (b.transcript.match(/⟨/g) ?? []).length,
  0,
);
console.log(`  ⟨Klammern⟩: ${klammern} unsichere Stellen in echtem Text`);
console.log("");
