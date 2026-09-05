import { subjectPdfResponse } from "./subject-pdf-response";

/**
 * Ein PDF mit allen abgeschriebenen Blättern eines Fachs.
 *
 * Hier steht nur, wie die Adresse aussieht und woher die id kommt. Sitzung,
 * Besitzprüfung und die Header liegen in ./subject-pdf-response, das Dokument
 * selbst in @/lib/pdf — der Grund für diese Aufteilung steht ausgeschrieben in
 * ../../../material/[id]/page-image-response.ts.
 *
 * Die `id` in der Adresse ist die des FACHS. Anders als bei den Seitenbildern
 * ist der Inhalt hinter dieser Adresse nicht unveränderlich: er wächst mit
 * jedem Blatt. Was das für die Header bedeutet, steht im Modul daneben; was es
 * für den Service Worker bedeutet, in public/sw.js.
 *
 * Kein `export const dynamic`: Route Handler sind in Next 16 grundsätzlich
 * nicht gecacht, und die Cache-Control setzt das Modul nebenan selbst.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/fach/[id]/pdf">,
) {
  const { id } = await context.params;

  return subjectPdfResponse(id);
}
