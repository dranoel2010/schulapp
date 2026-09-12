import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Die Grenze des Abrufkerns — geprüft, nicht versprochen.
 *
 * ── Warum als Test und nicht als ESLint-Regel ────────────────────────────────
 *
 * Weil `npm run lint` in diesem Repo von nichts automatisch ausgeführt wird:
 * Es gibt keine CI, und der einzige Workflow unter .github/ ist der
 * stillgelegte Auslöser der Erinnerungen. Eine `no-restricted-imports`-Regel
 * wäre damit ein Zettel an der Tür. `npm test` ist dagegen die Hausgewohnheit —
 * und eine Grenze, die niemand prüft, ist nach dem dritten hastigen Abend
 * keine mehr.
 *
 * ── Was die Grenze soll ──────────────────────────────────────────────────────
 *
 * Der Abrufkern ist eine Wette (g = 0,095 gegen ein gut geführtes Epochenheft,
 * p = 0,062). Eine Wette muss man verlieren können, ohne dass das Haus mitgeht.
 * Deshalb: eigene Tabellen, eigene Dateien, und nach außen genau eine Tür —
 * `source.ts`. Wird der Kern je herausgelöst, ist das eine Datei, die neu
 * geschrieben werden muss, plus drei Stellen in der Schulapp (Navigation,
 * Kachel, Startseiten-Zahl) und eine Wanderung.
 *
 * Ohne diese Prüfung verwischt das binnen Wochen: Ein `import` aus
 * `@/lib/exams` ist schneller getippt als eine Zeile in `source.ts` ergänzt,
 * und danach ist der Kern kein Paket mehr, sondern ein Ordner.
 */

const KERN = path.join(process.cwd(), "src", "recall");

/**
 * Was der Kern aus der Schulapp importieren darf.
 *
 * `@/db` — die eine Verbindung des Prozesses. Eine zweite wäre nicht Trennung,
 * sondern ein zweites PGlite auf denselben Dateien; genau das hat diese
 * Datenbank schon einmal unrettbar zerstört.
 *
 * `@/db/schema` — die Tabellen, auf die die eigenen zeigen (users, subjects,
 * material_pages). Ein Fremdschlüssel braucht sein Gegenüber.
 *
 * `@/lib/dates` — „heute" in Berliner Zeit und das Rechnen mit Kalendertagen.
 * Eine eigene Fassung davon wäre eine zweite Wahrheit über denselben Tag.
 *
 * `@/lib/transcripts` — die Marke für Unsicheres. Die ⟨spitzen Klammern⟩ sind
 * eine Abmachung der Abschrift, nicht des Abrufs; sie hier nachzubauen hieße,
 * zwei Stellen zu pflegen, die dasselbe bedeuten müssen.
 */
const ERLAUBT = ["@/db", "@/db/schema", "@/lib/dates", "@/lib/transcripts"];

/** Die eine Tür nach außen. Nur sie darf mehr. */
const TUER = "source.ts";

function dateien(): string[] {
  return readdirSync(KERN).filter((name) => name.endsWith(".ts"));
}

function importe(datei: string): string[] {
  const inhalt = readFileSync(path.join(KERN, datei), "utf8");
  const treffer = inhalt.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm);
  return [...treffer].map((m) => m[1]);
}

describe("Die Grenze des Abrufkerns", () => {
  it("hat überhaupt Dateien — sonst prüft dieser Test nichts", () => {
    assert.ok(dateien().length >= 4, "src/recall ist fast leer");
  });

  it("enthält keine einzige .tsx-Datei", () => {
    // Der Kern rechnet und speichert; er stellt nichts dar. Eine Komponente
    // hier wäre der erste Schritt zurück zum Ordner: Sie brächte React, die
    // Oberflächensprache und damit die Schulapp in eine Schicht, die ohne sie
    // laufen können soll.
    const tsx = readdirSync(KERN).filter((name) => name.endsWith(".tsx"));
    assert.deepEqual(tsx, [], `Oberfläche im Kern: ${tsx.join(", ")}`);
  });

  it("importiert aus der Schulapp nur, was auf der Liste steht", () => {
    for (const datei of dateien()) {
      if (datei === TUER) continue;

      for (const quelle of importe(datei)) {
        // Alles, was nicht mit @/ anfängt, ist entweder ein Paket (drizzle,
        // node:test) oder ein Nachbar im Kern selbst — beides in Ordnung.
        if (!quelle.startsWith("@/")) continue;
        if (quelle.startsWith("@/recall/")) continue;

        assert.ok(
          ERLAUBT.includes(quelle),
          `${datei} importiert ${quelle} — erlaubt sind ${ERLAUBT.join(", ")} und @/recall/*. Was aus der Schulapp mehr gebraucht wird, gehört in ${TUER}.`,
        );
      }
    }
  });

  it("lässt nur source.ts weiter in die Schulapp greifen", () => {
    // Diese Datei DARF mehr — sie ist die Andockstelle. Der Test hält nur
    // fest, dass es sie gibt und dass sie die einzige bleibt: Sonst wäre die
    // Ausnahme oben eine Regel, die für jede Datei gilt, die sich als Tür
    // bezeichnet.
    assert.ok(dateien().includes(TUER), `${TUER} fehlt — die Tür ist weg`);
  });

  it("hält arten.ts frei von JEDEM Import — die Oberfläche liest sie mit", () => {
    // Die einzige Datei des Kerns, die auch eine CLIENT-Komponente importiert
    // (das Formular unter /abruf/bausteine/neu braucht die vier Namen für sein
    // Auswahlfeld). Kommt dort ein Import hinzu, wandert er in das
    // Browserpaket — und wenn er über @/db führt, bricht der Bau mit „Module
    // not found: Can't resolve 'fs'". Genau das ist am 12.9.2026 passiert, beim
    // Versuch, die Liste an eine Stelle zu legen: Sie lag zuerst in items.ts,
    // und items.ts spricht mit der Datenbank.
    //
    // Die Regel ist deshalb schärfer als die Liste oben: nicht „nur Erlaubtes",
    // sondern NICHTS. Eine Abmachung über vier Wörter braucht keinen Import,
    // und wer hier einen setzt, hat vermutlich die falsche Datei gewählt.
    const inhalt = readFileSync(path.join(KERN, "arten.ts"), "utf8");

    assert.deepEqual(
      [...inhalt.matchAll(/^import\s/gm)].map((m) => m[0]),
      [],
      "arten.ts importiert etwas — das landet im Browserpaket",
    );
  });

  it("schreibt nirgends in den Bestand der Schulapp", () => {
    // Der Kern liest aus materials/material_pages/subjects/exams und schreibt
    // ausschließlich in seine eigenen recall_-Tabellen. Ein `update(materials)`
    // hier wäre kein Modul mehr, sondern ein zweiter Eigentümer derselben
    // Daten — und das Erste, was bei einem Rückbau auffiele, wären fehlende
    // Daten in Tabellen, die niemand dem Abruf zugeordnet hätte.
    const fremd = ["materials", "materialPages", "subjects", "exams", "users"];

    for (const datei of dateien()) {
      if (datei.endsWith(".test.ts")) continue;

      const inhalt = readFileSync(path.join(KERN, datei), "utf8");
      for (const tabelle of fremd) {
        for (const verb of ["insert", "update", "delete"]) {
          assert.ok(
            !new RegExp(`\\.${verb}\\(\\s*${tabelle}\\b`).test(inhalt),
            `${datei}: ${verb}() auf ${tabelle} — der Kern schreibt nur in recall_*`,
          );
        }
      }
    }
  });
});
