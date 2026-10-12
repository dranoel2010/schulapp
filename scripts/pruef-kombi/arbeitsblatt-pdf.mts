/**
 * Schreibt die beiden Beispielblätter aus dem Prototyp als PDF in einen
 * Ordner — zum Nebeneinanderlegen mit `page.pdf()` des Drucks (Plan H,
 * Abnahme „Das PDF stimmt mit dem Druck überein“). Ohne Datenbank.
 *
 *   npx tsx scripts/pruef-kombi/arbeitsblatt-pdf.mts <ordner>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { blattErgebnis, papierFuer } from "@/lib/arbeitsblatt/auftrag";
import {
  ABSCHRIFT_FRANZOESISCH,
  ABSCHRIFT_MATHE,
  UEBUNG_FRANZOESISCH,
  UEBUNG_MATHE,
} from "@/lib/arbeitsblatt/beispiel";
import { buildArbeitsblattPdf } from "@/lib/pdf/arbeitsblatt-document";

const ordner = process.argv[2] ?? ".";
const BEISPIELE = [
  ["Mathematik", "Quadratische Funktionen", UEBUNG_MATHE, ABSCHRIFT_MATHE, "Scheitelpunktform, Übungen", "mathematik"],
  ["Französisch", "Passé composé mit être", UEBUNG_FRANZOESISCH, ABSCHRIFT_FRANZOESISCH, "Passé composé, Regeln", "franzoesisch"],
] as const;

for (const [fach, thema, antwort, abschrift, titel, name] of BEISPIELE) {
  const e = blattErgebnis(
    antwort,
    { fach, thema, blaetter: [{ materialId: "8f0d3c1e-5b7a-4c2d-9e1f-0a1b2c3d4e5f", titel, datum: "2026-10-08", seiten: [abschrift] }] },
    papierFuer(fach),
  );
  if (e.art !== "fertig") throw new Error(`${fach}: Beispiel ungültig`);
  const pdf = await buildArbeitsblattPdf({ fach, thema, tag: "2026-10-12", inhalt: e.inhalt });
  const pfad = join(ordner, `ab-pdf-${name}.pdf`);
  writeFileSync(pfad, pdf);
  console.log(pfad);
}
