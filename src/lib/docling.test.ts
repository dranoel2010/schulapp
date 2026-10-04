import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";

import {
  DoclingAusfall,
  PAUSE_MS,
  convertPage,
  doclingFertig,
  doclingFor,
  doclingForm,
  neuerSchalter,
  neuerVorrat,
  trifftDocling,
} from "@/lib/docling";

describe("doclingForm", () => {
  const form = doclingForm(new Uint8Array([1, 2, 3]), "image/jpeg");

  it("erzwingt OCR — ein Foto hat keine Textebene", () => {
    assert.equal(form.get("force_ocr"), "true");
    assert.deepEqual(form.getAll("ocr_lang"), ["de", "fr", "en"]);
  });

  it("nennt die Formel-Voreinstellung ausdrücklich", () => {
    // Ohne sie scheitert docling-serve 1.x mit „Preset 'default' not found".
    assert.equal(form.get("do_formula_enrichment"), "true");
    assert.equal(form.get("code_formula_preset"), "codeformulav2");
  });

  it("schickt Bilder nur als Platzhalter zurück", () => {
    assert.equal(form.get("image_export_mode"), "placeholder");
    assert.equal(form.get("to_formats"), "md");
  });

  it("gibt der Datei die Endung ihres Formats", () => {
    const file = doclingForm(new Uint8Array([1]), "image/png").get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "seite.png");
  });
});

describe("der Schalter", () => {
  it("bleibt bei einer einzelnen gescheiterten Seite zu", () => {
    const schalter = neuerSchalter();

    assert.equal(
      schalter.fehlschlag(new Error("Docling ist gescheitert: kaputtes Bild"), 0),
      false,
    );
    assert.equal(schalter.pausiertBis(0), null);
  });

  it("öffnet sich, wenn Docling die Aufgabe nicht mehr kennt (404)", () => {
    const schalter = neuerSchalter();

    assert.equal(
      schalter.fehlschlag(new DoclingAusfall("Docling kennt die Aufgabe nicht mehr (404)."), 1_000),
      true,
    );
    assert.equal(schalter.pausiertBis(1_000), 1_000 + PAUSE_MS);
  });

  it("öffnet sich beim Zeitablauf des Clients", () => {
    // So wirft fetch, wenn `AbortSignal.timeout()` abläuft.
    const schalter = neuerSchalter();

    assert.equal(
      schalter.fehlschlag(new DOMException("The operation timed out.", "TimeoutError"), 0),
      true,
    );
    assert.notEqual(schalter.pausiertBis(0), null);
  });

  it("schließt sich nach zehn Minuten von selbst", () => {
    const schalter = neuerSchalter();
    schalter.fehlschlag(new DoclingAusfall("Docling braucht zu lange."), 0);

    assert.equal(PAUSE_MS, 10 * 60_000);
    assert.equal(schalter.pausiertBis(PAUSE_MS - 1), PAUSE_MS);
    assert.equal(schalter.pausiertBis(PAUSE_MS), null);
  });

  it("unterscheidet Ausfall und Einzelfall an der Klasse", () => {
    assert.equal(trifftDocling(new DoclingAusfall("503")), true);
    assert.equal(trifftDocling(new Error("Docling nimmt die Seite nicht an (422)")), false);
    assert.equal(trifftDocling("irgendwas"), false);
  });
});

describe("der Vorrat", () => {
  it("rechnet dieselbe Seite nur einmal, auch bei zwei Anfragen zugleich", async () => {
    const vorrat = neuerVorrat<string>(1_000, 3);
    let laeufe = 0;
    const load = async () => {
      laeufe += 1;
      return "# Seite";
    };

    // Beide Aufrufe ohne ein `await` dazwischen — genau der Fall, in dem ein
    // Eintrag, der erst nach dem ersten Warten gesetzt würde, fehlte.
    const erste = vorrat.holen("nutzer:seite", load, 0);
    const zweite = vorrat.holen("nutzer:seite", load, 0);

    assert.equal(erste.treffer, false);
    assert.equal(zweite.treffer, true);
    assert.equal(zweite.promise, erste.promise);
    assert.equal(await zweite.promise, "# Seite");
    assert.equal(laeufe, 1);
  });

  it("rechnet nach Ablauf der Frist neu", async () => {
    const vorrat = neuerVorrat<number>(1_000, 3);
    let laeufe = 0;
    const load = async () => ++laeufe;

    await vorrat.holen("k", load, 0).promise;
    assert.equal(vorrat.holen("k", load, 999).treffer, true);

    const spaeter = vorrat.holen("k", load, 1_000);
    assert.equal(spaeter.treffer, false);
    assert.equal(await spaeter.promise, 2);
  });

  it("hält die Obergrenze und verdrängt den ältesten Eintrag", async () => {
    const vorrat = neuerVorrat<string>(60_000, 3);
    const load = async () => "x";

    vorrat.holen("a", load, 0);
    vorrat.holen("b", load, 1);
    vorrat.holen("c", load, 2);
    vorrat.holen("d", load, 3);

    assert.equal(vorrat.groesse(), 3);
    assert.equal(vorrat.holen("c", load, 4).treffer, true);
    assert.equal(vorrat.holen("a", load, 5).treffer, false, "a war der älteste");
  });

  it("vergisst einen Fehlschlag, damit der nächste Versuch neu rechnet", async () => {
    const vorrat = neuerVorrat<string>(60_000, 3);
    let laeufe = 0;
    const load = async () => {
      laeufe += 1;
      if (laeufe === 1) throw new Error("Docling ist gescheitert");
      return "# zweiter Versuch";
    };

    await assert.rejects(vorrat.holen("k", load, 0).promise);
    assert.equal(vorrat.groesse(), 0);

    const neu = vorrat.holen("k", load, 1);
    assert.equal(neu.treffer, false);
    assert.equal(await neu.promise, "# zweiter Versuch");
  });
});

/**
 * Was `read_docling` während der Pause noch herausgeben darf: nur, was schon
 * fertig im Vorrat liegt (4.10.2026). Für jedes der Dinge, die dabei nicht
 * passieren dürfen, steht ein Test da: auf eine laufende Umrechnung warten,
 * eine neue anstoßen, ein abgelaufenes oder gescheitertes Ergebnis nennen.
 */
describe("das Fertige im Vorrat", () => {
  /** Eine Umrechnung, deren Ende der Test selbst bestimmt. */
  function aufZuruf<T>() {
    let erfuellen!: (wert: T) => void;
    let verwerfen!: (grund: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      erfuellen = resolve;
      verwerfen = reject;
    });
    return { load: () => promise, erfuellen, verwerfen };
  }

  it("nennt eine laufende Umrechnung nicht — erst die fertige", async () => {
    const vorrat = neuerVorrat<string>(60_000, 3);
    const umrechnung = aufZuruf<string>();

    const geholt = vorrat.holen("k", umrechnung.load, 0);
    // Erst anlaufen lassen: `load` beginnt einen Mikrotask später.
    await Promise.resolve();
    assert.equal(vorrat.fertig("k", 1), null, "läuft noch");

    umrechnung.erfuellen("# Seite");
    await geholt.promise;

    assert.deepEqual(vorrat.fertig("k", 2), { wert: "# Seite" });
  });

  it("stößt nichts an und legt nichts an", () => {
    const vorrat = neuerVorrat<string>(60_000, 3);

    assert.equal(vorrat.fertig("nie-geholt", 0), null);
    assert.equal(vorrat.groesse(), 0);
  });

  it("nennt ein abgelaufenes Ergebnis nicht", async () => {
    const vorrat = neuerVorrat<string>(1_000, 3);
    await vorrat.holen("k", async () => "alt", 0).promise;

    assert.deepEqual(vorrat.fertig("k", 999), { wert: "alt" });
    assert.equal(vorrat.fertig("k", 1_000), null);
  });

  it("nennt einen Fehlschlag nicht", async () => {
    const vorrat = neuerVorrat<string>(60_000, 3);
    const umrechnung = aufZuruf<string>();
    const geholt = vorrat.holen("k", umrechnung.load, 0);

    umrechnung.verwerfen(new Error("Docling ist gescheitert"));
    await assert.rejects(geholt.promise);

    assert.equal(vorrat.fertig("k", 1), null);
  });

  it("unterscheidet ein fertiges leeres Ergebnis von keinem", async () => {
    // Leeres Markdown ist eine Antwort („nichts Gedrucktes"), kein Fehlen.
    const vorrat = neuerVorrat<string>(60_000, 3);
    await vorrat.holen("k", async () => "", 0).promise;

    assert.deepEqual(vorrat.fertig("k", 1), { wert: "" });
  });
});

describe("doclingFertig", () => {
  const ergebnis = { markdown: "# Aufgabe 1", seconds: 4.2, status: "success" };
  // Eigene Schlüssel je Lauf: der Vorrat des Prozesses hängt an `globalThis`.
  const nutzer = `test-nutzer-${Math.random().toString(36).slice(2)}`;

  it("gibt die fertige Seite desselben Nutzers heraus — und keinem anderen", async () => {
    await doclingFor(nutzer, "seite-1", async () => ergebnis, 1_000).promise;

    assert.deepEqual(doclingFertig(nutzer, "seite-1", 2_000), ergebnis);
    assert.equal(doclingFertig(`${nutzer}-fremd`, "seite-1", 2_000), null);
  });

  it("fragt Docling nicht nach einer Seite, die noch niemand geholt hat", () => {
    assert.equal(doclingFertig(nutzer, "seite-2", 2_000), null);
  });
});

describe("convertPage", () => {
  const vorher = process.env.DOCLING_URL;
  before(() => {
    process.env.DOCLING_URL = "http://docling.test/";
  });
  after(() => {
    if (vorher === undefined) delete process.env.DOCLING_URL;
    else process.env.DOCLING_URL = vorher;
  });

  /** Ein Docling zum Hineinreichen: je Adresse eine Antwort. */
  function docling(
    t: TestContext,
    antworten: { abgeben: () => Response; nachfragen?: () => Response; abholen?: () => Response },
  ): string[] {
    const aufrufe: string[] = [];

    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      aufrufe.push(url);

      if (url.endsWith("/v1/convert/file/async")) return antworten.abgeben();
      if (url.includes("/v1/status/poll/") && antworten.nachfragen) return antworten.nachfragen();
      if (url.includes("/v1/result/") && antworten.abholen) return antworten.abholen();

      throw new Error(`Unerwartete Adresse: ${url}`);
    });

    return aufrufe;
  }

  const bild = () => new Uint8Array([1, 2, 3]);

  it("gibt bei einem 404 auf die Nachfrage sofort auf, statt bis zur Frist zu fragen", async (t) => {
    const aufrufe = docling(t, {
      abgeben: () => Response.json({ task_id: "t1" }),
      nachfragen: () => new Response("Task not found", { status: 404 }),
    });

    await assert.rejects(
      convertPage(bild(), "image/jpeg"),
      (error: unknown) => error instanceof DoclingAusfall && /404/.test(error.message),
    );
    assert.equal(aufrufe.length, 2, "abgeben und einmal nachfragen — kein zweites Mal");
  });

  it("hält ein verlorenes Netz beim Nachfragen für einen Ausfall", async (t) => {
    docling(t, {
      abgeben: () => Response.json({ task_id: "t4" }),
      nachfragen: () => {
        throw new TypeError("fetch failed");
      },
    });

    await assert.rejects(
      convertPage(bild(), "image/jpeg"),
      (error: unknown) => error instanceof DoclingAusfall,
    );
  });

  it("wirft, wenn Docling die Seite ohne Aufgabe annimmt — ohne den Schalter zu meinen", async (t) => {
    const aufrufe = docling(t, { abgeben: () => Response.json({}) });

    await assert.rejects(
      convertPage(bild(), "image/jpeg"),
      (error: unknown) =>
        error instanceof Error && !trifftDocling(error) && /task_id/.test(error.message),
    );
    assert.equal(aufrufe.length, 1);
  });

  it("hält eine Absage beim Abgeben für einen Einzelfall", async (t) => {
    docling(t, { abgeben: () => new Response("Preset 'default' not found", { status: 422 }) });

    await assert.rejects(
      convertPage(bild(), "image/jpeg"),
      (error: unknown) => error instanceof Error && !trifftDocling(error),
    );
  });

  it("nennt ein leeres Ergebnis ohne „success“ einen Fehler und keine leere Seite", async (t) => {
    docling(t, {
      abgeben: () => Response.json({ task_id: "t2" }),
      nachfragen: () => Response.json({ task_status: "success" }),
      abholen: () =>
        Response.json({ document: { md_content: "" }, status: "partial_success" }),
    });

    await assert.rejects(
      convertPage(bild(), "image/jpeg"),
      (error: unknown) =>
        error instanceof Error && !trifftDocling(error) && /partial_success/.test(error.message),
    );
  });

  it("liefert das Markdown, wenn alles gutgeht", async (t) => {
    docling(t, {
      abgeben: () => Response.json({ task_id: "t3" }),
      nachfragen: () => Response.json({ task_status: "success" }),
      abholen: () =>
        Response.json({
          document: { md_content: "  # Aufgabe 1\n\n$x^2$  " },
          status: "success",
          processing_time: 12.5,
        }),
    });

    assert.deepEqual(await convertPage(bild(), "image/jpeg"), {
      markdown: "# Aufgabe 1\n\n$x^2$",
      seconds: 12.5,
      status: "success",
    });
  });
});
