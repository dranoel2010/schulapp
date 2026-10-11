/**
 * Die Abnahme-Messung des Abschreibers (11.10.2026): echte Seiten, echter
 * Aufruf, nichts geschrieben.
 *
 * Warum es sie gibt: Am 11.10.2026 lasen Opus 5.5 und Sonnet 5.5 31 echte
 * Seiten blind, außerhalb der App, an der 1000-px-Lesefassung — daher Opus
 * und daher die Lesefassung als Vorgabe (@/lib/claude/client). Zwei Fragen
 * blieben offen, und beide beantwortet nur ein Lauf über den Aufruf, den die
 * App jetzt selbst macht:
 *
 *   1. Liest der Abschreiber der App so gut wie die Messung? Derselbe Text
 *      sagt es nicht von selbst: Systemtext, Auftrag und Form der Antwort sind
 *      neu geschrieben.
 *   2. Liest das 1600-px-Vollbild besser — oder kostet es nur mehr Bild-Tokens?
 *      Erst danach ist `CLAUDE_BILD=voll` eine Entscheidung und kein Raten.
 *
 * Gelesen wird je Seite und je Bildfassung einmal, über `seiteTrockenLesen()`
 * (@/lib/leser/claude-trocken): derselbe Aufruf wie im Betrieb, aber kein
 * Vorschlag, kein Vermerk in `leser_laeufe`, keine Änderung an irgendeinem
 * Blatt. Die Ausgabe ist eine JSON-Zeile je Aufruf auf stdout — mit dem Text
 * des Modells, seiner Notiz und seinem Grund, der Abschrift, die heute an der
 * Seite steht (zum Vergleichen), und der Messung samt Preis. Alles andere
 * (Fortschritt, Messzeilen, Summe) geht nach stderr, damit stdout eine
 * saubere Datei ergibt.
 *
 * ── Wo es läuft ─────────────────────────────────────────────────────────────
 *
 * Auf dem NAS, mit der Umgebung der App: ihrer Datenbank (`DATABASE_URL`) und
 * ihrem Schlüssel (`ANTHROPIC_API_KEY`). Das Bild der App enthält aber weder
 * src/ noch tsx (Dockerfile: nur das Ergebnis des Baus und die
 * Produktionsabhängigkeiten). Deshalb wird dieses Skript AUF DEM RECHNER zu
 * einer einzigen .mjs-Datei gebündelt — mit dem esbuild aus node_modules, also
 * aus package-lock.json —, und im Container läuft nur `node` darauf. Die
 * Pakete (drizzle-orm, postgres, das SDK, zod) bündelt esbuild NICHT
 * (`--packages=external`): sie kommen aus /app/node_modules des Bildes, das
 * `npm ci` aus demselben Lockfile gebaut hat.
 *
 * Bis zur Abnahme vom 11.10.2026 holte die Zeile hier `npx --yes tsx@…` in
 * den Container — und damit Code aus der npm-Registry samt Install-Skripten
 * (esbuild als `~0.28.0`, also nicht aus dem Lockfile) in einen Prozess, der
 * den Schlüssel und die Datenbank in seiner Umgebung trägt. Jetzt wird im
 * Container nichts installiert; was dort läuft, hat dieser Rechner gebaut.
 *
 * Auf dem Rechner, im Klon, nach `npm ci`:
 *
 *   ./node_modules/.bin/esbuild scripts/abschrift-messen.mts --bundle --platform=node --format=esm --packages=external --outfile=abschrift-messen.mjs
 *   scp abschrift-messen.mjs <benutzer>@<nas>:/tmp/abschrift-messen.mjs
 *
 * (`<benutzer>@<nas>` wie beim ssh aufs NAS — die Adresse im Tailnet.)
 *
 * Auf dem NAS (die Datei nur lesend eingehängt, gestartet aus /app, damit
 * `node` die Pakete in /app/node_modules findet):
 *
 *   sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose run --rm --no-deps -T -v /tmp/abschrift-messen.mjs:/app/abschrift-messen.mjs:ro app node abschrift-messen.mjs <seiten-id> …' > messung.jsonl
 *
 * Danach `rm /tmp/abschrift-messen.mjs` — sie enthält keinen Schlüssel, aber
 * sie gehört nicht dorthin.
 *
 * Schalter (vor oder nach den ids):
 *
 *   --fassung lesefassung|voll|beide   Vorgabe: beide, je Seite nacheinander
 *   --nachlese                         mit dem Auftrag der Nachlese (nur
 *                                      Abschrift) statt mit dem zum Einordnen
 *
 * Die Seiten-ids stehen in der App in der Adresse eines Seitenbildes
 * (/api/material/<seiten-id>/…) und in `material_pages.id`.
 *
 * ── Was es kostet ───────────────────────────────────────────────────────────
 *
 * Jeder Aufruf ist bezahlt, vom Schlüssel in der .env. Geschätzt — aus den
 * Preisen, einer vollen Seite Abschrift und dem Denken bei `high` — kostet
 * eine Seite grob 0,10 bis 0,30 $; genau steht es danach in jeder Messzeile
 * und in der Summe am Ende. Mit `beide` zählt jede Seite doppelt. Höchstens `HOECHSTENS` Seiten je Lauf — die 31 der
 * Messung passen hinein, ein Tippfehler in einer Schleife nicht. Eine Pause
 * (Schlüssel abgewiesen, Kontingent oder Ausgabelimit erreicht, API gestört)
 * beendet den Lauf sofort: jeder weitere Aufruf träfe dasselbe.
 *
 * Rückgabe: 0 = alle Aufrufe gemacht, 1 = falsch aufgerufen oder eine Seite
 * unbekannt, 2 = wegen einer Pause abgebrochen.
 */

import type { ClaudeBildfassung } from "@/lib/claude/client";

/** So viele Seiten nimmt ein Lauf höchstens — die 31 der Messung und etwas Luft. */
const HOECHSTENS = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hilfe(): never {
  console.error(
    "Aufruf: node abschrift-messen.mjs [--fassung lesefassung|voll|beide] [--nachlese] <seiten-id> …\n" +
      "Gebündelt auf dem Rechner, gestartet auf dem NAS mit der Umgebung der App — beide Zeilen stehen im Kopf von scripts/abschrift-messen.mts.",
  );
  process.exit(1);
}

// ── Aufruf lesen ─────────────────────────────────────────────────────────────

const argumente = process.argv.slice(2);
let fassungen: ClaudeBildfassung[] = ["lesefassung", "voll"];
let art: "einordnen" | "nachlese" = "einordnen";
const ids: string[] = [];

for (let i = 0; i < argumente.length; i += 1) {
  const argument = argumente[i] ?? "";
  if (argument === "--fassung") {
    const wert = argumente[(i += 1)];
    if (wert === "beide") fassungen = ["lesefassung", "voll"];
    else if (wert === "lesefassung" || wert === "voll") fassungen = [wert];
    else hilfe();
  } else if (argument === "--nachlese") {
    art = "nachlese";
  } else if (argument === "-h" || argument === "--hilfe" || argument === "--help") {
    hilfe();
  } else if (UUID.test(argument)) {
    if (!ids.includes(argument.toLowerCase())) ids.push(argument.toLowerCase());
  } else {
    console.error(`Keine Seiten-id: ${argument}`);
    hilfe();
  }
}

if (ids.length === 0) hilfe();
if (ids.length > HOECHSTENS) {
  console.error(`${ids.length} Seiten — höchstens ${HOECHSTENS} je Lauf. Jeder Aufruf ist bezahlt; lieber in zwei Läufen.`);
  process.exit(1);
}

// ── Riegel ───────────────────────────────────────────────────────────────────
//
// Ohne DATABASE_URL öffnete @/db die Datei-Datenbank unter .data/pglite — im
// Container eine leere, auf dem Rechner die eigene, womöglich neben einem
// laufenden Entwicklungsserver (zwei Prozesse auf denselben Dateien sind der
// Zustand, der diese Datenbank schon einmal zerstört hat, README). Gemessen
// wird an den echten Seiten, also nur gegen den Postgres der App.
if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL fehlt — die Messung läuft nur mit der Umgebung der App auf dem NAS (Zeile im Kopf dieser Datei).",
  );
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY fehlt — jede Zeile wäre eine Pause. Erst den Schlüssel einrichten (scripts/claude-einrichten.sh).",
  );
  process.exit(1);
}

// Erst nach den Riegeln geladen: schon das Laden der App-Module darf nichts
// öffnen, bevor feststeht, wogegen.
const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { materialPages, materials } = await import("@/db/schema");
const { CLAUDE_EFFORT, CLAUDE_MODELL } = await import("@/lib/claude/client");
const { dollar, messungZeile } = await import("@/lib/claude/ergebnis");
const { seiteTrockenLesen } = await import("@/lib/leser/claude-trocken");

/** Wem gehört die Seite, und an welchem Blatt hängt sie? */
async function finden(pageId: string): Promise<{ userId: string; materialId: string } | null> {
  const [zeile] = await db
    .select({ materialId: materialPages.materialId, userId: materials.userId })
    .from(materialPages)
    .innerJoin(materials, eq(materials.id, materialPages.materialId))
    .where(eq(materialPages.id, pageId))
    .limit(1);
  return zeile ?? null;
}

/** Wartet, bis alles auf stdout geschrieben ist — vor `process.exit` an einer Pipe. */
function ausgeschrieben(): Promise<void> {
  return new Promise((fertig) => process.stdout.write("", () => fertig()));
}

const kurz = (id: string) => id.slice(0, 8);

console.error(
  `Messe ${ids.length} ${ids.length === 1 ? "Seite" : "Seiten"} × ${fassungen.join(" + ")} = ${ids.length * fassungen.length} Aufrufe, bezahlt — ${CLAUDE_MODELL}, effort ${CLAUDE_EFFORT}, Auftrag ${art === "einordnen" ? "zum Einordnen" : "der Nachlese"}. Abbrechen mit Strg-C.`,
);

let rueckgabe = 0;
let aufrufe = 0;
let summe = 0;
let ohnePreis = 0;

messen: for (const pageId of ids) {
  const fund = await finden(pageId);
  if (!fund) {
    console.error(`Seite ${kurz(pageId)}: gibt es nicht — übersprungen.`);
    rueckgabe = 1;
    continue;
  }

  for (const fassung of fassungen) {
    const ergebnis = await seiteTrockenLesen(fund.userId, fund.materialId, pageId, fassung, art);
    if (!ergebnis.gelaufen) {
      console.error(`Seite ${kurz(pageId)} (${fassung}): kein Aufruf — ${ergebnis.grund}`);
      rueckgabe = 1;
      continue;
    }

    const { zeile } = ergebnis;
    process.stdout.write(`${JSON.stringify(zeile)}\n`);
    if (zeile.messung) {
      aufrufe += 1;
      if (zeile.messung.kostenUsd === null) ohnePreis += 1;
      else summe += zeile.messung.kostenUsd;
    }

    const zeichen = zeile.text === null ? "keine Abschrift" : `${zeile.text.length} Zeichen`;
    console.error(
      `Seite ${kurz(pageId)} (Nr. ${zeile.nummer}, ${fassung}): ${zeile.ergebnis}, ${zeichen}${zeile.grund ? ` — ${zeile.grund.slice(0, 120)}` : ""}`,
    );
    console.error(
      `   ${zeile.messung ? messungZeile(zeile.messung) : `Wand ${Math.round(zeile.wandMs / 1000)} s, keine Antwort`}`,
    );

    if (zeile.ergebnis === "pause") {
      console.error("Pause — jeder weitere Aufruf träfe dasselbe. Abgebrochen.");
      rueckgabe = 2;
      break messen;
    }
  }
}

console.error(
  `Fertig: ${aufrufe} ${aufrufe === 1 ? "Aufruf" : "Aufrufe"} mit Antwort, zusammen ${dollar(summe)}${ohnePreis > 0 ? ` und ${ohnePreis} ohne bekannten Preis (die Summe ist eine Untergrenze)` : ""}.`,
);

await ausgeschrieben();
process.exit(rueckgabe);
