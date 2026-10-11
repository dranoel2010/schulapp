import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  fragenLaufen,
  fragenLaufenGerade,
  fragenVormerken,
} from "@/lib/fragenlauf";

/**
 * Der Fragenlauf der App — geprüft an seinem Quelltext, wie der Abschreiber
 * (claude-leser.test.ts), und an seiner Sperre.
 *
 * Was er mit einer Datenbank und einem Sender tut, steht in
 * scripts/probe-fragenlauf.mts. Hier steht, was ohne beides zu prüfen ist:
 * dass ein Modell, das Abschriften liest, auch aus der App heraus nur auf
 * EINEM Weg schreibt — `vorschlagAnlegen()`, nie `createItem()` —, dass nichts
 * ihn von selbst startet, und dass ein zweiter Druck keinen zweiten Lauf
 * auslöst.
 */

function quelle(...teile: string[]): string {
  return readFileSync(path.join(process.cwd(), ...teile), "utf8");
}

/** Ein Quelltext ohne Kommentare — ein Name im Kommentar ist kein Aufruf. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LAUF = ohneKommentare(quelle("src", "lib", "fragenlauf.ts"));
const AUFTRAG = ohneKommentare(quelle("src", "lib", "fragenlauf-auftrag.ts"));
const STOFF = ohneKommentare(quelle("src", "lib", "klausur-stoff.ts"));

/** Diese Namen schreiben in den Bestand des Abrufs oder in Blätter — keiner gehört hierher. */
const SCHREIBWEGE = [
  "createItem",
  "vorschlagUebernehmen",
  "vorschlagVerwerfen",
  "retireItem",
  "neuPlanen",
  "setMaterialTranscripts",
  "createProposal",
  "blattVorschlagen",
];

describe("der Fragenlauf schreibt nur einen Vorschlag", () => {
  it("legt Fragen genau über vorschlagAnlegen ab und hat keinen anderen Schreibweg", () => {
    assert.equal([...LAUF.matchAll(/\bvorschlagAnlegen\(/g)].length, 1);
    for (const datei of [LAUF, AUFTRAG, STOFF]) {
      for (const verboten of SCHREIBWEGE) {
        assert.doesNotMatch(datei, new RegExp(`\\b${verboten}\\b`), verboten);
      }
    }
  });

  it("schreibt selbst nur den Vermerk — über laufVermerken, ohne die Datenbank anzufassen", () => {
    assert.equal([...LAUF.matchAll(/\blaufVermerken\(/g)].length, 1);
    assert.match(LAUF, /art: "fragen",/);
    for (const datei of [LAUF, AUFTRAG, STOFF]) {
      assert.doesNotMatch(datei, /\bdb\./);
      assert.doesNotMatch(datei, /from "@\/db"/);
    }
  });

  it("ruft das Modell einmal, über claudeRufen, mit dem Systemtext und beiden Formen", () => {
    assert.doesNotMatch(LAUF, /new Anthropic|@anthropic-ai\/sdk/);
    const aufrufe = [...LAUF.matchAll(/claudeRufen\(\s*\{([\s\S]*?)\}\s*,\s*d\.senden/g)].map((t) => t[1]);
    assert.equal(aufrufe.length, 1);
    assert.match(aufrufe[0] ?? "", /system: FRAGEN_SYSTEM/);
    assert.match(aufrufe[0] ?? "", /schema: FRAGEN_ANTWORT/);
    assert.match(aufrufe[0] ?? "", /form: FRAGEN_FORM/);
    assert.match(aufrufe[0] ?? "", /fristMs: FRAGEN_FRIST_MS/);
    assert.match(aufrufe[0] ?? "", /maxTokens: FRAGEN_MAX_TOKENS/);
  });

  it("holt nichts aus harness/ und liegt nicht im Abrufkern", () => {
    for (const datei of [LAUF, AUFTRAG, STOFF]) {
      assert.doesNotMatch(datei, /from "[^"]*harness/);
    }
    // src/recall darf aus der Schulapp kaum etwas importieren
    // (src/recall/grenzen.test.ts) — und ein Modellaufruf gehört nicht hinein.
    const kern = readdirSync(path.join(process.cwd(), "src", "recall"));
    assert.equal(kern.some((datei) => /fragenlauf|klausur-stoff/.test(datei)), false);
  });
});

describe("von selbst läuft nichts", () => {
  it("stößt nur der Knopf an — nach der Antwort, ohne zu warten", () => {
    const actions = ohneKommentare(quelle("src", "app", "(app)", "abruf", "actions.ts"));
    assert.match(actions, /after\(\(\) => fragenAnstossen\(user\.id, examId\)\);/);
    assert.doesNotMatch(actions, /await fragen(Laufen|Bauen|Anstossen)/);
  });

  it("und sonst niemand: kein Takt, kein Start, keine Zuteilung", () => {
    const wurzel = path.join(process.cwd(), "src");
    const aufrufer = readdirSync(wurzel, { recursive: true })
      .map(String)
      .filter((datei) => /\.tsx?$/.test(datei) && !/\.test\.tsx?$/.test(datei))
      .filter((datei) =>
        /\bfragen(Anstossen|Laufen|Bauen)\(/.test(ohneKommentare(readFileSync(path.join(wurzel, datei), "utf8"))),
      )
      .sort();
    assert.deepEqual(aufrufer, [path.join("app", "(app)", "abruf", "actions.ts"), path.join("lib", "fragenlauf.ts")]);
  });
});

describe("die Sperre je Klausur", () => {
  // Ohne Schlüssel (`konfiguriert: false`) endet ein Lauf, bevor er die
  // Datenbank fragt — so lässt sich die Queue ohne beides prüfen. Ob ein
  // zweiter Druck WÄHREND eines laufenden Aufrufs nichts anstößt, braucht
  // einen Aufruf, der dauert; das prüft scripts/probe-fragenlauf.mts mit
  // einem langsamen Sender.
  const ohneSchluessel = { konfiguriert: false };

  it("fragt die Queue, bevor sie einen Lauf anstellt — und hängt sich nie an", () => {
    // Sich an einen wartenden Lauf zu hängen, wie der Abschreiber es tut,
    // genügte nicht (Kopf von fragenlauf.ts): erst `busy`, dann `request`.
    const koerper = LAUF.slice(LAUF.indexOf("export function fragenLaufen("));
    const frage = koerper.indexOf("z.queue.busy(schluessel(examId))");
    const anstellen = koerper.indexOf("z.queue.request(");
    assert.ok(frage > 0 && anstellen > frage);
    assert.match(koerper.slice(frage, anstellen), /return Promise\.resolve\(\);/);
  });

  it("gibt die Klausur nach dem Lauf wieder frei", async () => {
    const lauf = fragenLaufen("nutzer", "klausur-1", ohneSchluessel);
    assert.equal(fragenLaufenGerade("nutzer", "klausur-1"), true);
    await lauf;
    assert.equal(fragenLaufenGerade("nutzer", "klausur-1"), false);
  });

  it("sperrt nur DIESE Klausur", async () => {
    const eins = fragenLaufen("nutzer", "klausur-2", ohneSchluessel);
    assert.equal(fragenLaufenGerade("nutzer", "klausur-3"), false);
    await eins;
  });

  it("zeigt einen Knopfdruck als „baut gerade“, bevor sein Lauf beginnt — aber nicht ewig und nicht einem anderen", () => {
    const jetzt = Date.now();
    fragenVormerken("nutzer", "klausur-4");
    assert.equal(fragenLaufenGerade("nutzer", "klausur-4", jetzt), true);
    assert.equal(fragenLaufenGerade("anderer", "klausur-4", jetzt), false);
    assert.equal(fragenLaufenGerade("nutzer", "klausur-4", jetzt + 61_000), false);
  });
});
