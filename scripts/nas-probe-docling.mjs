// Rechnet Docling eine Seite — mit genau den Einstellungen der App?
//
// Läuft IM App-Container, damit dieselbe Adresse (DOCLING_URL) und derselbe
// Netzweg geprüft werden, den die App nimmt. Der Text kommt über die
// Standardeingabe, weil das Bild scripts/ nicht enthält:
//
//   docker compose exec -T app node --input-type=module - < scripts/nas-probe-docling.mjs
//
// Gerufen von scripts/jev-und-docling.sh. Geschickt wird eine kleine PDF-Seite
// mit Text und einer Formelzeile, und zwar zweimal: Der erste Lauf baut die
// Pipeline auf und lädt dabei das Formelmodell — fehlt es, scheitert genau
// dieser Lauf, und nicht erst das erste echte Blatt. Der zweite zeigt, wie
// lange eine Seite dauert, wenn alles geladen ist.
//
// Die Formularfelder sind dieselben wie in doclingForm() in src/lib/docling.ts;
// nur die Datei ist ein PDF statt eines Fotos.
//
// Rückgabe: 0 = beide Läufe haben Text geliefert, 1 = sonst.

const base = process.env.DOCLING_URL?.replace(/\/+$/, "");
if (!base) {
  console.log("Docling: DOCLING_URL kommt in der App nicht an.");
  process.exit(1);
}

/** Eine A4-Seite mit drei Zeilen Helvetica, Versatztabelle ausgerechnet. */
function probeSeite() {
  const zeilen = ["Probe fuer Docling", "Die Photosynthese", "f(x) = x^2 + 3x - 4"];
  const inhalt =
    "BT /F1 20 Tf 26 TL 72 720 Td " + zeilen.map((zeile) => `(${zeile}) '`).join(" ") + " ET";
  const objekte = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(inhalt)} >>\nstream\n${inhalt}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const versatz = [];
  objekte.forEach((objekt, index) => {
    versatz.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objekt}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  pdf += versatz.map((zahl) => `${String(zahl).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function einLauf(name) {
  const form = new FormData();
  form.append("files", new Blob([probeSeite()], { type: "application/pdf" }), "probe.pdf");
  form.append("to_formats", "md");
  form.append("do_ocr", "true");
  form.append("force_ocr", "true");
  for (const lang of ["de", "fr", "en"]) form.append("ocr_lang", lang);
  form.append("do_formula_enrichment", "true");
  form.append("code_formula_preset", "codeformulav2");
  form.append("table_mode", "accurate");
  form.append("image_export_mode", "placeholder");

  const start = Date.now();
  // Der erste Lauf darf lange dauern: Er lädt die Modelle, und auf einem NAS
  // ohne Grafikkarte sind das Minuten. Die App selbst wartet je Seite drei.
  const deadline = start + 10 * 60_000;
  const signal = () => AbortSignal.timeout(Math.max(1, deadline - Date.now()));

  const submitted = await fetch(`${base}/v1/convert/file/async`, {
    method: "POST",
    headers: { accept: "application/json" },
    body: form,
    signal: signal(),
  });
  if (!submitted.ok) {
    throw new Error(`nimmt die Seite nicht an (${submitted.status}): ${(await submitted.text()).slice(0, 300)}`);
  }
  const { task_id: taskId } = await submitted.json();

  for (;;) {
    if (Date.now() > deadline) throw new Error("nach 10 Minuten noch nicht fertig");
    const poll = await fetch(`${base}/v1/status/poll/${taskId}`, { signal: signal() });
    if (!poll.ok) throw new Error(`antwortet beim Nachfragen mit ${poll.status}`);
    const status = await poll.json();
    if (status.task_status === "success") break;
    if (status.task_status === "failure") {
      throw new Error(`gescheitert: ${status.error_message ?? "ohne Grund"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const result = await fetch(`${base}/v1/result/${taskId}`, {
    headers: { accept: "application/json" },
    signal: signal(),
  });
  if (!result.ok) throw new Error(`liefert das Ergebnis nicht (${result.status})`);
  const body = await result.json();
  const markdown = (body.document?.md_content ?? "").trim();
  const wand = ((Date.now() - start) / 1000).toFixed(1);
  const gerechnet = (body.processing_time ?? 0).toFixed(1);

  console.log(`Docling ${name}: Wand ${wand} s, gerechnet ${gerechnet} s, Status ${body.status}`);
  console.log(`  gelesen: ${markdown.replace(/\s+/g, " ").slice(0, 160) || "(nichts)"}`);
  if (!/photosynthese/i.test(markdown)) throw new Error("der gelesene Text fehlt");
}

try {
  await einLauf("kalt");
  await einLauf("warm");
  process.exit(0);
} catch (error) {
  console.log(`Docling: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
