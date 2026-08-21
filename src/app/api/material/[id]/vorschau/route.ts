import { pageImageResponse } from "../page-image-response";

/**
 * Die Vorschau derselben Seite — 320 Pixel lange Kante statt 1600.
 *
 * Die Ablage zeigt bis zu zweihundert Blätter auf einmal. Lieferte sie dafür
 * die Vollbilder aus und ließe der Browser sie klein zeichnen, wären das rund
 * 50 Megabyte statt rund 3 — für Kacheln, die keine 400 Pixel breit sind. Die
 * Vorschau liegt deshalb als eigene Spalte in derselben Zeile und bekommt hier
 * ihre eigene Adresse: dieselbe Seiten-id, ein Wort mehr im Pfad.
 *
 * Eine eigene Datei und keine Abzweigung über einen Query-Parameter, weil eine
 * Adresse, die sich nie ändert, den harten Cache erst erlaubt — und weil ein
 * Route Handler ausschließlich seine Methoden ausführt. Doppelt geschrieben
 * wird deshalb nichts: alles, was diese Adresse mit dem Vollbild nebenan teilt,
 * steht in ../page-image-response, und was hier übrig bleibt, ist das eine Wort
 * Unterschied.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/material/[id]/vorschau">,
) {
  const { id } = await context.params;

  return pageImageResponse(id, "vorschau");
}
