import { after } from "next/server";

import { abschriftScheitern, blattAnlegen, seiteAnhaengen, uploadSchluessel } from "@/lib/kombi/blatt-aufnahme";
import { jetztFuerAblauf } from "@/lib/kombi/ablauf-uhr";
import { blattKurz } from "@/lib/kombi/blaetter";
import { zuteilungAnstossen } from "@/lib/leser/zuteilung";
import { readPage } from "@/lib/material-seite";
import { getSessionUser } from "@/lib/session";

/**
 * Ein Blatt aufnehmen, ohne Fachwahl (Modell 23, Plan 3.8).
 *
 * Ein Route Handler und keine Server Action: Actions laufen nacheinander und
 * haben die 5-MB-Grenze; hier schickt die Kamera beim Ablegen jedes Blatt in
 * einer eigenen Anfrage, mehrere zugleich.
 *
 * multipart: `bild`, `lesefassung`, `vorschau`, `breite`, `hoehe` wie in
 * src/components/material/prepare-page.ts, dazu
 * - `attach=<materialId>`: die Seite an dieses Blatt (sonst ein neues Blatt),
 * - `folge=1`: zweite und weitere Seite eines eben angelegten Blatts,
 * - `seiten=<n>`: wie viele Seiten das Blatt bekommt (fürs Protokoll),
 * - `ziel=liste|zeile`: von wo die Kamera kam (fürs Protokoll),
 * - `aufnahme=<uid>` und `seite=<i>`: welche Seite welcher Aufnahme das ist.
 *   Kommt dieselbe Seite noch einmal (der Browser wiederholt, weil nur die
 *   Antwort verloren ging), gibt es das vorhandene Blatt zurück, ohne ein
 *   zweites anzulegen oder die Seite zweimal anzuhängen.
 * - `fehler=abschrift`: Testweiche, nur mit `SCHULAPP_TESTUHR=1`.
 *
 * Antwort: das Blatt in Kurzform (`BlattKurz`), oder `{message}` mit Status.
 * Ist das Blatt voll, 409 mit `voll: true`: die Kamera schickt die Seite dann
 * ohne `attach` und legt so aus dem Rest ein neues Blatt an.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

function feld(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ message: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: "Von dieser Aufnahme ist nichts angekommen. Versuch es noch einmal." }, { status: 400, headers: HEADERS });
  }

  const seite = await readPage(form);
  if (!seite.ok) return Response.json({ message: seite.message }, { status: 400, headers: HEADERS });

  const page = { ...seite.page, uploadKey: uploadSchluessel(user.id, feld(form, "aufnahme"), feld(form, "seite")) };
  const now = await jetztFuerAblauf();
  const attach = feld(form, "attach");
  const seiten = Number(feld(form, "seiten")) || 1;
  const test = process.env.SCHULAPP_TESTUHR === "1" && feld(form, "fehler") === "abschrift";

  let ergebnis;
  try {
    ergebnis = attach
      ? await seiteAnhaengen(user.id, now, attach, page, { folge: feld(form, "folge") === "1", seiten })
      : await blattAnlegen(user.id, now, page, { seiten, ziel: feld(form, "ziel") === "zeile" ? "zeile" : "liste" });
  } catch (fehler) {
    console.error("Blatt ablegen fehlgeschlagen", fehler);
    return Response.json({ message: "Das Blatt konnte nicht gespeichert werden. Versuch es noch einmal." }, { status: 500, headers: HEADERS });
  }
  if (!ergebnis.ok) {
    return Response.json(
      { message: ergebnis.message, ...(ergebnis.voll ? { voll: true } : {}) },
      { status: ergebnis.status, headers: HEADERS },
    );
  }

  if (ergebnis.wiederholt) {
    // schon angekommen: weder Testweiche noch Zuteilung ein zweites Mal
  } else if (test) {
    await abschriftScheitern(user.id, ergebnis.id);
  } else {
    // Wer die Seite liest, entscheidet die App, nach der Antwort: die Kamera
    // wartet nicht auf den Leser.
    after(() => zuteilungAnstossen(user.id));
  }

  const kurz = await blattKurz(user.id, ergebnis.id);
  return Response.json(kurz ?? { id: ergebnis.id }, { headers: HEADERS });
}
