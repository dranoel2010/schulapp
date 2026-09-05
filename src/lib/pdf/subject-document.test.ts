import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";

import {
  buildSubjectPdf,
  groupByTopic,
  toLines,
  withDeadline,
  type LoadPageImage,
  type PdfSheetEntry,
  type Segment,
} from "@/lib/pdf/subject-document";

/**
 * Das Fach-PDF, ohne Datenbank geprüft.
 *
 * Möglich ist das, weil `buildSubjectPdf()` nichts holt: die Blätter kommen als
 * Argument herein, die Fotos über eine Rückrufstelle. Hier steht statt der
 * Datenbank eine Attrappe, und heraus kommt ein echtes PDF — dieselben Bytes,
 * die im Betrieb ausgeliefert würden.
 *
 * **Zum Ansehen:**
 *
 * ```
 * SCHULAPP_PDF_OUT=/tmp/fach.pdf npm test
 * ```
 *
 * Dann legt der Test das Dokument zusätzlich dort ab. Das ist kein Umweg,
 * sondern der Grund, warum es diesen Test gibt: an einem PDF prüft man mit
 * Zusicherungen, ob es ein PDF ist, und mit den Augen, ob es eins ist, das man
 * ausdrucken möchte.
 */

/* -------------------------------------------------------------------------
   Echte Bilder, von Hand gebaut

   pdfkit bettet die Bytes eines PNG unverändert ein — ein erfundener Kopf
   käme durch `readImageInfo()` und scheiterte danach beim Einbetten. Die
   Bilder hier sind deshalb vollständig gültig: Signatur, IHDR, ein wirklich
   komprimiertes IDAT und IEND, mit richtiger Prüfsumme an jedem Block.
   ------------------------------------------------------------------------- */

function chunk(type: string, data: Uint8Array): Uint8Array {
  const kopf = Buffer.from(type, "latin1");
  const inhalt = Buffer.concat([kopf, Buffer.from(data)]);
  const out = Buffer.alloc(inhalt.length + 8);

  out.writeUInt32BE(data.length, 0);
  inhalt.copy(out, 4);
  out.writeUInt32BE(crc32(inhalt) >>> 0, inhalt.length + 4);

  return out;
}

/**
 * Ein gültiges PNG mit einem weichen Verlauf — es komprimiert wie ein Foto
 * ungefähr so gut wie eine Rechnung und bleibt dabei klein genug für einen
 * Test.
 */
function png(width: number, height: number, ton: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 Bit je Kanal
  ihdr[9] = 2; // Echtfarbe (RGB)

  // Jede Bildzeile beginnt mit einem Filterbyte; 0 heißt „kein Filter".
  const zeilen = Buffer.alloc(height * (1 + width * 3));
  let at = 0;

  for (let y = 0; y < height; y++) {
    zeilen[at++] = 0;

    for (let x = 0; x < width; x++) {
      zeilen[at++] = (ton + x) % 256;
      zeilen[at++] = (ton + y) % 256;
      zeilen[at++] = 220;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(zeilen)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Ein PNG mit Alphakanal, dessen Bilddaten Müll sind — 63 Bytes, und der
 * gefährlichste Fall, den dieses Dokument kennt.
 *
 * Gemessen am 5.9.2026 gegen pdfkit 0.20.2: `doc.image()` WIRFT DABEI NICHT.
 * pdfkit geht bei einem Alphakanal in splitAlphaChannel(), das packt über
 * `zlib.inflate` MIT RÜCKRUF aus, und der Wurf („incorrect header check")
 * fällt eine Ereignisschleife später — ausserhalb jedes try/catch. Wörtlich:
 * „doc.image synchron: kein Wurf / UNCAUGHT: incorrect header check / nach 3s
 * -> ended = false". Das Dokument wurde nie fertig, `await fertig` löste nie
 * auf, und der Route Handler antwortete auf die Anfrage überhaupt nicht mehr.
 *
 * Der Unterschied zum `png()` oben ist ein einziges Byte: Farbtyp 6 statt 2.
 * Bei 2 packt pdfkit gar nicht aus, wirft synchron und der catch greift — das
 * ist der Fall, den der Test „bricht nicht ab, wenn ein Foto beschädigt ist"
 * schon immer geprüft hat, und er ist der harmlose von beiden.
 */
function pngMitKaputtemAlpha(): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8; // 8 Bit je Kanal
  ihdr[9] = 6; // Echtfarbe MIT Alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // Sechs Bytes Müll, wo ein Deflate-Strom stehen müsste.
    chunk("IDAT", Uint8Array.from([1, 2, 3, 4, 5, 6])),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Ein WebP-Kopf — gültiges Bild für die App, unmöglich für pdfkit. */
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
  0x38, 0x4c, 0x0d, 0, 0, 0,
]);

/* -------------------------------------------------------------------------
   Erfundene Blätter

   Sie sind so gewählt, dass jeder Sonderfall des Dokuments einmal vorkommt —
   ein PDF, in dem nur gewöhnliche Blätter stehen, prüft die Hälfte nicht.
   ------------------------------------------------------------------------- */

const SHEETS: PdfSheetEntry[] = [
  {
    id: "s1",
    title: "Ableitungsregeln — Übersicht",
    capturedOn: "2026-03-02",
    note: "Vom Tafelbild abfotografiert, die letzte Zeile war verdeckt.",
    topics: ["Ableitungen", "Kettenregel"],
    pages: [
      {
        pageId: "p1",
        transcript:
          "Ableitungsregeln\n\n" +
          "Potenzregel: f(x) = xⁿ ⟹ f′(x) = n · xⁿ⁻¹\n" +
          "Produktregel: (u · v)′ = u′ · v + u · v′\n" +
          "Kettenregel: f(g(x))′ = f′(g(x)) · g′(x)\n\n" +
          "Beispiel: f(x) = (3x² + 1)⁵\n" +
          "f′(x) = 5 · (3x² + 1)⁴ · 6x = 30x · (3x² + 1)⁴\n\n" +
          "Für α → 0 gilt sin(α)/α → 1, und ⟨der Rest der Zeile war verdeckt⟩.",
      },
      {
        pageId: "p2",
        // Der Fall, um den es beim Auffangnetz geht: griechische Buchstaben und
        // Mengenzeichen, die Geist nicht hat, mitten im deutschen Satz.
        transcript:
          "Übungen\n\n" +
          "1) Sei x ∈ ℝ und α, β ∈ [0, 2π). Zeige: sin(α + β) = sin α · cos β + cos α · sin β\n" +
          "2) M ⊂ ℕ, θ = 45°, σ = 1,5 — berechne ∑ und ∫ über M.\n" +
          "3) Prüfe: 3 ≤ x ≤ 7 ✓, x ≠ 0 ✓, y ⟨unleserlich⟩ 12 ✗",
      },
      {
        pageId: "p3",
        // „Noch niemand gelesen" — nicht dasselbe wie „war leer".
        transcript: null,
      },
    ],
  },
  {
    id: "s2",
    title: "Kettenregel — Übungsblatt",
    capturedOn: "2026-03-09",
    note: null,
    topics: ["Kettenregel"],
    pages: [
      {
        pageId: "p4",
        transcript:
          "Aufgabe 1\n\nLeite ab:\n" +
          "a) f(x) = √(2x + 5)\n" +
          "b) f(x) = e^(3x²)\n" +
          "c) f(x) = ln(x³ − 4)\n\n" +
          "Lösungen auf der Rückseite. ⟨Aufgabe d war durchgestrichen⟩",
      },
      {
        pageId: "p5",
        // „Gelesen, es stand nichts darauf" — der leere String.
        transcript: "",
      },
    ],
  },
  {
    id: "s3",
    title: "Ableitungen — Hausaufgabe",
    capturedOn: "2026-03-11",
    note: null,
    // Dasselbe erste Thema wie s1: die beiden müssen unter EINER Überschrift
    // landen, obwohl ein anderes Blatt dazwischenliegt.
    topics: ["Ableitungen"],
    pages: [
      {
        pageId: "p6",
        transcript:
          "Hausaufgabe zum 16.3.\n\nSeite 84, Nr. 3 bis 7.\n" +
          "Achtung: bei Nr. 5 ist die innere Funktion nicht x, sondern 2x − 1.\n" +
          "Ein Zeichen, das keine der beiden Schriften kann: 漢",
      },
    ],
  },
  {
    id: "s4",
    title: "Blatt vom 16.3.",
    capturedOn: "2026-03-16",
    note: "Weiß nicht mehr, woher das ist.",
    // Ohne Thema — muss ganz zuletzt stehen.
    topics: [],
    pages: [
      {
        pageId: "p7",
        transcript: "Nur eine Skizze, kein Text. ⟨Beschriftung unlesbar⟩",
      },
      // Das WebP: die Seite bleibt im Dokument, das Foto nicht.
      { pageId: "p8", transcript: "Die zweite Seite war ein WebP-Foto." },
      // Budget erschöpft.
      { pageId: "p9", transcript: "Die dritte Seite kam nicht mehr durchs Budget." },
      // Zeile weg.
      { pageId: "p10", transcript: "Die vierte Seite gibt es nicht mehr." },
    ],
  },
];

/** Die Attrappe für die Fotos: je Seite ein anderer Ausgang. */
const loadImage: LoadPageImage = async (pageId) => {
  if (pageId === "p8") return { kind: "bytes", bytes: WEBP };
  if (pageId === "p9") return { kind: "budget" };
  if (pageId === "p10") return { kind: "gone" };

  // Hochkant wie ein abfotografiertes A4-Blatt, in der Größenordnung der
  // Vorschau — ein Vollbild mit 1200 × 1600 Pixeln dauerte im Test zu lange
  // zu komprimieren, und für die Anordnung zählt nur das Seitenverhältnis.
  return { kind: "bytes", bytes: png(300, 400, pageId.length * 37) };
};

const EINGABE = {
  subject: { name: "Mathematik", color: "blue" },
  sheets: SHEETS,
  today: "2026-09-05",
  cutOff: false,
};

/** Wie oft steht diese Zeichenfolge in den rohen Bytes? */
function zaehle(bytes: Uint8Array, was: string): number {
  return Buffer.from(bytes).toString("latin1").split(was).length - 1;
}

/** Hört das Dokument regulär auf — also ist der Strom wirklich zu Ende? */
function text_endet(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).toString("latin1").trimEnd().endsWith("%%EOF");
}

describe("groupByTopic", () => {
  it("stellt jedes Blatt genau einmal hin, unter seinem ersten Thema", () => {
    const gruppen = groupByTopic(SHEETS);
    const ids = gruppen.flatMap((gruppe) => gruppe.sheets.map((sheet) => sheet.id));

    assert.deepEqual([...ids].sort(), ["s1", "s2", "s3", "s4"]);
    assert.equal(ids.length, new Set(ids).size, "ein Blatt steht doppelt im PDF");
  });

  it("ordnet die Gruppen nach ihrem ersten Blatt, nicht alphabetisch", () => {
    // „Ableitungen" kommt zuerst, weil s1 vom 2.3. ist — „Kettenregel"
    // alphabetisch davor zu stellen machte aus dem Lernheft eine Themenliste.
    assert.deepEqual(
      groupByTopic(SHEETS).map((gruppe) => gruppe.title),
      ["Ableitungen", "Kettenregel", null],
    );
  });

  it("sammelt Blätter mit demselben ersten Thema, auch über Lücken hinweg", () => {
    const [ableitungen] = groupByTopic(SHEETS);

    assert.deepEqual(ableitungen?.sheets.map((sheet) => sheet.id), ["s1", "s3"]);
  });

  it("stellt die Blätter ohne Thema ans Ende", () => {
    const gruppen = groupByTopic(SHEETS);

    assert.equal(gruppen[gruppen.length - 1]?.title, null);
  });

  it("kommt ohne Blätter aus", () => {
    assert.deepEqual(groupByTopic([]), []);
  });

  it("legt keine leere Restgruppe an, wenn jedes Blatt ein Thema hat", () => {
    const nurMitThema = SHEETS.filter((sheet) => sheet.topics.length > 0);

    assert.equal(
      groupByTopic(nurMitThema).some((gruppe) => gruppe.title === null),
      false,
    );
  });
});


describe("toLines", () => {
  /*
   * Die Regel, die einen Fehler abstellt, den man dem PDF nur ansieht, wenn man
   * es aufschlägt.
   *
   * pdfkit merkt sich bei einer mit `continued: true` fortgesetzten Kette, wo
   * das fortgesetzte Stück angefangen hat. Ein weicher Umbruch geht danach an
   * den linken Rand zurück; ein HARTER Umbruch mitten in einem fortgesetzten
   * Stück nicht — die neue Zeile fängt dort an, wo das Stück begann.
   *
   * In einer abgeschriebenen Formelsammlung sah das so aus: „Potenzregel: …
   * ⟹ …" wechselt beim ⟹ die Schrift, das Stück danach beginnt also mitten in
   * der Zeile. Die Produktregel in der nächsten Zeile stand daraufhin
   * eingerückt bis zur Seitenmitte — und zwar nur sie, weil nur sie hinter
   * einem Schriftwechsel stand. Ein Ausdruck mit treppenförmig eingerückten
   * Zeilen.
   */
  const stueck = (text: string, primary = true): Segment => ({
    text,
    primary,
    color: "#000000",
  });

  it("schneidet ein Stück an seinen Umbrüchen auf", () => {
    assert.deepEqual(
      toLines([stueck("A\nB\nC")]).map((zeile) => zeile.map((s) => s.text)),
      [["A"], ["B"], ["C"]],
    );
  });

  it("hält zusammen, was in derselben Zeile steht", () => {
    // Der Fall aus der Formelsammlung: Text, Schriftwechsel, Text — und erst
    // danach der Umbruch.
    assert.deepEqual(
      toLines([
        stueck("Potenzregel: x"),
        stueck("⟹", false),
        stueck(" f'(x)\nProduktregel:"),
      ]).map((zeile) => zeile.map((s) => s.text)),
      [["Potenzregel: x", "⟹", " f'(x)"], ["Produktregel:"]],
    );
  });

  it("macht aus einer Leerzeile eine leere Zeile", () => {
    // Sie darf nicht verschwinden: in einer abgeschriebenen Tafel trennt die
    // Leerzeile die Blöcke.
    assert.deepEqual(
      toLines([stueck("A\n\nB")]).map((zeile) => zeile.length),
      [1, 0, 1],
    );
  });

  it("kommt mit allen drei Schreibweisen des Umbruchs zurecht", () => {
    assert.equal(toLines([stueck("A\r\nB\rC\nD")]).length, 4);
  });

  it("gibt für leere Eingabe eine einzige leere Zeile", () => {
    assert.deepEqual(toLines([]), [[]]);
  });
});

describe("buildSubjectPdf", () => {
  it("baut ein PDF, das jeden Sonderfall enthält", async () => {
    const bytes = await buildSubjectPdf(EINGABE, loadImage);

    const ziel = process.env.SCHULAPP_PDF_OUT;
    if (ziel) writeFileSync(ziel, bytes);

    // Ein PDF fängt mit %PDF- an und hört mit %%EOF auf.
    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(text.startsWith("%PDF-"), "kein PDF-Kopf");
    assert.ok(text.trimEnd().endsWith("%%EOF"), "kein PDF-Ende");

    // Mehrere Seiten: die vier Blätter mit ihren Fotos passen auf keine
    // einzige. Weniger als zwei hieße, dass der Umbruch nicht greift.
    const seiten = zaehle(bytes, "/Type /Page\n");
    assert.ok(seiten >= 4, `nur ${seiten} Seiten`);

    // Beide Schriften müssen wirklich eingebettet sein. Fehlte DejaVu, stünden
    // α, ⊂ und die ⟨Klammern⟩ als leere Kästchen im Ausdruck — und genau das
    // sieht man einem PDF nicht an, bevor man es öffnet.
    assert.ok(text.includes("Geist"), "Geist ist nicht eingebettet");
    assert.ok(text.includes("DejaVu"), "DejaVu ist nicht eingebettet");

    // Zehn Seiten, davon fallen drei aus: das WebP, das Foto jenseits des
    // Budgets und die verschwundene Zeile. Bleiben sieben eingebettete Bilder.
    assert.equal(zaehle(bytes, "/Subtype /Image"), 10 - 3);

    assert.ok(bytes.byteLength > 20_000, `nur ${bytes.byteLength} Bytes`);
  });

  it("baut auch für ein Fach ohne Blätter ein gültiges PDF", async () => {
    // Kein `null` und kein Fehler: das Fach gibt es, es ist nur noch nichts
    // abgeschrieben. Das Dokument sagt das in einem Satz.
    const bytes = await buildSubjectPdf(
      { ...EINGABE, sheets: [] },
      loadImage,
    );

    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(text.startsWith("%PDF-"));
    assert.equal(zaehle(bytes, "/Type /Page\n"), 1);
  });

  it("holt kein einziges Foto, wenn es keine Seiten gibt", async () => {
    let aufrufe = 0;

    await buildSubjectPdf({ ...EINGABE, sheets: [] }, async (pageId) => {
      aufrufe += 1;
      return loadImage(pageId);
    });

    assert.equal(aufrufe, 0);
  });

  it("fragt jedes Foto genau einmal", async () => {
    // Zweimal zu fragen hieße, dieselben Bytes zweimal aus der Datenbank zu
    // holen und zweimal gegen das Budget zu rechnen.
    const gefragt: string[] = [];

    await buildSubjectPdf(EINGABE, async (pageId) => {
      gefragt.push(pageId);
      return loadImage(pageId);
    });

    assert.equal(gefragt.length, new Set(gefragt).size);
    // 3 + 2 + 1 + 4 Seiten über die vier Blätter.
    assert.equal(gefragt.length, 10);
  });

  it("bricht nicht ab, wenn ein Foto beschädigt ist", async () => {
    // Ein abgeschnittenes PNG kommt durch den Bildkopf und scheitert erst beim
    // Einbetten. Ein einziges solches Foto darf nicht das ganze Fach kosten —
    // die Abschriften sind der Zweck des Dokuments.
    const kaputt = png(300, 400, 10).slice(0, 40);

    const bytes = await buildSubjectPdf(EINGABE, async () => ({
      kind: "bytes",
      bytes: kaputt,
    }));

    assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-"));
    assert.equal(zaehle(bytes, "/Subtype /Image"), 0);
  });

  it(
    "wird auch mit einem PNG fertig, dessen Alphakanal nicht auspackbar ist",
    // Ohne die Prüfung in ./image-info käme dieser Aufruf NIE zurück. Die
    // Frist im Dokument fängt ihn nach einer Minute; damit ein Rückfall hier
    // trotzdem schnell auffällt, steht eine eigene, kürzere Frist am Test.
    { timeout: 20_000 },
    async () => {
      const kaputt = pngMitKaputtemAlpha();

      // Genau die Datei, die gemessen wurde — 63 Bytes.
      assert.equal(kaputt.byteLength, 63);

      const bytes = await buildSubjectPdf(EINGABE, async () => ({
        kind: "bytes",
        bytes: kaputt,
      }));

      assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-"));
      assert.ok(text_endet(bytes), "kein PDF-Ende");
      assert.equal(zaehle(bytes, "/Subtype /Image"), 0);
    },
  );

  it("schreibt den Hinweis auf die Grenze ins Dokument", async () => {
    // `cutOff` darf nicht verschwiegen werden: ein PDF, das ein Fach nur zur
    // Hälfte zeigt und aussieht wie ein vollständiges, ist schlimmer als eins,
    // das es hinschreibt. Die Seitenzahl steigt, weil ein Absatz dazukommt —
    // mehr lässt sich an komprimierten Bytes nicht ablesen, und dass der Satz
    // richtig gesetzt wird, sieht man im PDF selbst.
    const ohne = await buildSubjectPdf(EINGABE, loadImage);
    const mit = await buildSubjectPdf({ ...EINGABE, cutOff: true }, loadImage);

    assert.ok(mit.byteLength > ohne.byteLength);
  });

  it("setzt Zeilenumbrüche wirklich um", async () => {
    /*
     * Der Fehler, gegen den das steht: ein Umbruch wurde zu einem Leerzeichen,
     * und eine abgeschriebene Tafel lief als ein einziger Fließtext durch.
     * Sechzig kurze Zeilen brauchen mehr als eine Seite; dieselben Wörter mit
     * Leerzeichen verbunden passen auf einen Bruchteil davon. Wer die Umbrüche
     * verliert, verliert damit auch die Seiten.
     */
    const zeilen = Array.from({ length: 60 }, (_, i) => `Zeile ${i + 1}`);

    const bau = (transcript: string) =>
      buildSubjectPdf(
        {
          ...EINGABE,
          sheets: [
            {
              id: "z",
              title: "Umbrüche",
              capturedOn: "2026-03-02",
              note: null,
              topics: [],
              pages: [{ pageId: "keins", transcript }],
            },
          ],
        },
        async () => ({ kind: "gone" }),
      );

    const mitUmbruch = await bau(zeilen.join("\n"));
    const ohneUmbruch = await bau(zeilen.join(" "));

    assert.ok(
      zaehle(mitUmbruch, "/Type /Page\n") > zaehle(ohneUmbruch, "/Type /Page\n"),
      "Die Zeilenumbrüche sind unterwegs verlorengegangen",
    );
  });

  it("kommt mit einem Blatt ohne Seiten zurecht", async () => {
    const bytes = await buildSubjectPdf(
      {
        ...EINGABE,
        sheets: [
          {
            id: "leer",
            title: "Blatt ohne Seiten",
            capturedOn: "2026-03-02",
            note: null,
            topics: [],
            pages: [],
          },
        ],
      },
      loadImage,
    );

    assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-"));
  });
});

describe("withDeadline", () => {
  /*
   * Die Frist, die aus „das Dokument wird nie fertig" einen Fehler macht.
   *
   * Sie steht hier für sich und nicht an einem hängenden `buildSubjectPdf()`,
   * weil es den Weg, auf dem pdfkit nachweislich hängenblieb, seit der Prüfung
   * in ./image-info nicht mehr gibt — ein Test, der dafür einen Hänger
   * bräuchte, hinge selbst, sobald die Frist fehlte. Geprüft wird deshalb das
   * Werkzeug; dass `buildSubjectPdf()` es benutzt, ist eine einzige Zeile
   * hinter `doc.end()`.
   */
  it("reicht durch, was rechtzeitig kommt", async () => {
    assert.equal(await withDeadline(Promise.resolve("fertig"), 1_000, "zu spät"), "fertig");
  });

  it("wirft, wenn nichts mehr kommt", async () => {
    // Der Fall aus Fund 7: das Versprechen löst nie auf, weil pdfkit weder
    // `end` noch `error` sendet. Ohne diese Zeile wartete der Route Handler
    // für immer — eine Anfrage, die nie zurückkommt, und niemand sieht einen
    // Fehler.
    await assert.rejects(
      withDeadline(new Promise<never>(() => {}), 20, "Das PDF wurde nicht fertig."),
      { message: "Das PDF wurde nicht fertig." },
    );
  });

  it("lässt keinen Zeitgeber zurück", async () => {
    // Ohne `clearTimeout` hielte jeder Aufruf die Ereignisschleife bis zum
    // Ablauf der Frist offen — im Betrieb unsichtbar, hier ein Testlauf, der
    // eine Minute lang nicht enden will.
    const zaehlen = () =>
      process.getActiveResourcesInfo().filter((art) => art === "Timeout").length;

    const vorher = zaehlen();
    await withDeadline(Promise.resolve(1), 60_000, "zu spät");

    assert.equal(zaehlen(), vorher);
  });

  it("macht aus einem verspäteten Wurf keine unbehandelte Ablehnung", async () => {
    // `Promise.race` hängt an BEIDE Versprechen einen Behandler. Ein Aufbau
    // mit einer Fahne statt eines Rennens ließe den späten Wurf ohne einen —
    // und `node --test` ließe den ganzen Lauf daran scheitern.
    const spaet = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("kam zu spät")), 20);
    });

    await assert.rejects(withDeadline(spaet, 5, "die Frist"), {
      message: "die Frist",
    });

    // Warten, bis der verspätete Wurf wirklich gefallen ist.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
