import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { Messung } from "@/lib/claude/ergebnis";
import { PROPOSAL_TRANSCRIPT_MAX } from "@/lib/inbox";
import type { EinordnenAntwort } from "@/lib/leser/claude-auftrag";
import {
  einordnenAuswerten,
  nachleseAuswerten,
  trockenVorab,
} from "@/lib/leser/claude-trocken";

/**
 * Der trockene Lauf für die Abnahme-Messung — was ohne Datenbank und ohne
 * Aufruf zu prüfen ist: welche Seite der Auftrag nennt und was aus einer
 * Antwort in der Zeile der Messung wird. Dass er nichts schreibt, prüft
 * claude-leser.test.ts am Quelltext; dass er gegen eine echte Datenbank
 * nichts hinterlässt, scripts/probe-claude-leser.mts.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const BLATT = "99999999-9999-4999-8999-999999999999";

const MESSUNG: Messung = {
  modell: "claude-opus-5-5",
  rueckfall: false,
  abgelehntVon: [],
  stopGrund: "end_turn",
  ablehnung: null,
  eingabe: 2_000,
  ausgabe: 800,
  denken: 300,
  cacheGelesen: 0,
  cacheGeschrieben: 0,
  kostenUsd: 0.024,
  ohnePreis: [],
  wandMs: 12_000,
};

function antwort(teil: Partial<EinordnenAntwort> = {}): EinordnenAntwort {
  return {
    transcripts: [{ page: B, text: "Rückseite, wörtlich" }],
    title: null,
    topics: [],
    captured_on: null,
    note: "Zeile 3 ⟨unleserlich⟩.",
    ergebnis: "vorschlag",
    grund: " Zeile 3 unsicher ",
    ...teil,
  };
}

describe("trockenVorab: eine Seite, wie der Betrieb sie als Teilblatt stellte", () => {
  it("nummeriert nach der Stelle am Blatt und kennt die erste Seite", () => {
    const zweite = trockenVorab([A, B, C], B, "2026-10-01");
    assert.deepEqual(zweite?.seite, { id: B, nummer: 2 });
    assert.equal(zweite?.einordnen.vollstaendig, false);
    assert.equal(zweite?.einordnen.ersteSeiteDabei, false);
    assert.deepEqual(zweite?.einordnen.seiten, [{ id: B, nummer: 2 }]);
    assert.equal(zweite?.einordnen.capturedOn, "2026-10-01");

    const erste = trockenVorab([A, B], A, "2026-10-01");
    assert.equal(erste?.einordnen.ersteSeiteDabei, true);
  });

  it("ist nur bei einem einseitigen Blatt vollständig", () => {
    assert.equal(trockenVorab([A], A, "2026-10-01")?.einordnen.vollstaendig, true);
  });

  it("nennt bei der Nachlese genau diese Seite, nicht als nachgereicht", () => {
    assert.deepEqual(trockenVorab([A, B], B, "2026-10-01")?.nachlese, {
      seiten: [{ id: B, nummer: 2 }],
      nachgereicht: false,
    });
  });

  it("kennt keine Seite, die nicht zum Blatt gehört", () => {
    assert.equal(trockenVorab([A, B], C, "2026-10-01"), null);
  });
});

describe("einordnenAuswerten: was in der Zeile steht", () => {
  const vorab = trockenVorab([A, B], B, "2026-10-01")!.einordnen;

  it("nimmt die Abschrift dieser Seite ungekürzt und den Grund des Modells", () => {
    const zeile = einordnenAuswerten(
      { art: "antwort", antwort: antwort(), messung: MESSUNG, wandMs: 12_000 },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.ergebnis, "vorschlag");
    assert.equal(zeile.text, "Rückseite, wörtlich");
    assert.equal(zeile.notiz, "Zeile 3 ⟨unleserlich⟩.");
    assert.equal(zeile.grund, "Zeile 3 unsicher");
    assert.deepEqual(zeile.hinweise, []);
    assert.equal(zeile.messung, MESSUNG);
  });

  it("zeigt den Text auch, wenn die Tür ihn als zu lang weggelassen hätte — und sagt es", () => {
    const lang = "x".repeat(PROPOSAL_TRANSCRIPT_MAX + 1);
    const zeile = einordnenAuswerten(
      {
        art: "antwort",
        antwort: antwort({ transcripts: [{ page: B, text: lang }], note: "lang" }),
        messung: MESSUNG,
        wandMs: 1,
      },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.text, lang);
    assert.equal(zeile.ergebnis, "vorschlag");
    assert.match(zeile.hinweise.join(" "), /länger als/);
  });

  it("hält einen Titel fest, den die Tür ohne erste Seite verworfen hätte", () => {
    const zeile = einordnenAuswerten(
      { art: "antwort", antwort: antwort({ title: "Überschrift" }), messung: MESSUNG, wandMs: 1 },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.titel, "Überschrift");
    assert.match(zeile.hinweise.join(" "), /Titel verworfen/);
  });

  it("findet keine Abschrift zu einer anderen id", () => {
    const zeile = einordnenAuswerten(
      { art: "antwort", antwort: antwort({ transcripts: [{ page: A, text: "falsch" }], note: null }), messung: MESSUNG, wandMs: 1 },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.text, null);
    assert.equal(zeile.ergebnis, "nichts");
  });

  it("ohne Antwort: Ergebnis und Grund des Aufrufs, sonst nichts", () => {
    const zeile = einordnenAuswerten(
      { art: "pause", grund: "Kontingent erschöpft", messung: null, abbruch: null, pauseAmBlatt: false, wandMs: 300 },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.ergebnis, "pause");
    assert.equal(zeile.grund, "Kontingent erschöpft");
    assert.equal(zeile.text, null);
    assert.equal(zeile.messung, null);
    assert.equal(zeile.wandMs, 300);
  });
});

describe("nachleseAuswerten", () => {
  const vorab = trockenVorab([A, B], B, "2026-10-01")!.nachlese;

  it("kennt nur Abschrift, Ergebnis und Grund", () => {
    const zeile = nachleseAuswerten(
      {
        art: "antwort",
        antwort: { transcripts: [{ page: B, text: "" }], ergebnis: "vorschlag", grund: "leer" },
        messung: MESSUNG,
        wandMs: 1,
      },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.text, "");
    assert.equal(zeile.ergebnis, "vorschlag");
    assert.equal(zeile.titel, null);
    assert.equal(zeile.notiz, null);
    assert.deepEqual(zeile.themen, []);
  });

  it("„kein-vorschlag“ des Modells bleibt seines", () => {
    const zeile = nachleseAuswerten(
      {
        art: "antwort",
        antwort: { transcripts: [], ergebnis: "kein-vorschlag", grund: "zu dunkel" },
        messung: MESSUNG,
        wandMs: 1,
      },
      vorab,
      B,
      BLATT,
    );
    assert.equal(zeile.ergebnis, "kein-vorschlag");
    assert.equal(zeile.grund, "zu dunkel");
  });
});

describe("die Zeile, mit der die Messung auf dem NAS läuft", () => {
  const kopf = readFileSync(path.join(process.cwd(), "scripts", "abschrift-messen.mts"), "utf8");

  it("bündelt auf dem Rechner mit dem esbuild aus dem Lockfile und lässt im Container nur node laufen", () => {
    // Bis zur Abnahme vom 11.10.2026 holte die Zeile tsx per npx in den
    // Container — Code aus der Registry, samt Install-Skripten und einem
    // esbuild, das nicht aus package-lock.json kam, in einen Prozess mit
    // Schlüssel und Datenbank.
    // Die Zeilen zum Abtippen stehen eingerückt im Kopf — in keiner ein npx
    // oder eine Installation.
    assert.doesNotMatch(kopf, /^ \* {3}.*(\bnpx\b|npm (i|install|exec)\b)/m);
    assert.match(
      kopf,
      /\.\/node_modules\/\.bin\/esbuild scripts\/abschrift-messen\.mts --bundle --platform=node --format=esm --packages=external --outfile=abschrift-messen\.mjs/,
    );
    assert.match(kopf, /docker compose run --rm --no-deps -T -v \/tmp\/abschrift-messen\.mjs:\/app\/abschrift-messen\.mjs:ro app node abschrift-messen\.mjs/);

    const sperre = JSON.parse(readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    assert.ok(sperre.packages["node_modules/esbuild"]?.version, "esbuild steht im Lockfile");
  });

  it("braucht im Container nur, was das Bild hat: die Produktionsabhängigkeiten", async () => {
    // Das Bild hat nach `npm prune` nur `dependencies` (Dockerfile). Was das
    // Bündel als Paket importiert, muss dort stehen — sonst scheiterte die
    // Messung erst auf dem NAS, mit einer Zeile, die man vom Handy tippt.
    const { build } = await import("esbuild");
    const ergebnis = await build({
      entryPoints: [path.join(process.cwd(), "scripts", "abschrift-messen.mts")],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const paket = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const extern = new Set(
      Object.values(ergebnis.metafile.outputs).flatMap((ausgabe) =>
        ausgabe.imports.filter((i) => i.external).map((i) => i.path),
      ),
    );
    assert.ok(extern.size > 0);
    for (const name of extern) {
      if (name.startsWith("node:")) continue;
      const wurzel = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]!;
      assert.ok(wurzel in paket.dependencies, `${name} ist keine Produktionsabhängigkeit`);
    }
    // Und nichts aus der App bleibt draußen: die Aliasse sind aufgelöst.
    assert.ok(![...extern].some((name) => name.startsWith("@/")));
  });

  it("läuft nur gegen die Datenbank der App, nie gegen .data/pglite", () => {
    assert.match(kopf, /if \(!process\.env\.DATABASE_URL\) \{/);
    // Die App-Module erst nach dem Riegel: schon @/db zu laden entschiede sonst,
    // wogegen.
    assert.ok(kopf.indexOf("process.env.DATABASE_URL") < kopf.indexOf('await import("@/db")'));
    // Typen dürfen oben stehen: sie verschwinden beim Übersetzen.
    assert.doesNotMatch(kopf, /^import (?!type )[^;]* from "@\/(db|lib)/m);
  });
});
