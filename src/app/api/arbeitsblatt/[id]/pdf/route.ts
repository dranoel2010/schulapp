import { blattStand } from "@/lib/arbeitsblatt/ablauf";
import { asciiFileName } from "@/lib/pdf/filename";
import { arbeitsblattDateiname, buildArbeitsblattPdf } from "@/lib/pdf/arbeitsblatt-document";
import { getSessionUser } from "@/lib/session";
import { jetzt } from "@/lib/tag";
import { istId } from "@/recall/ids";

/**
 * Das Arbeitsblatt als PDF (Plan H, „Drucken“): der Weg in der installierten
 * Android-App, falls `window.print()` dort keinen Druckdialog öffnet. Der
 * PDF-Betrachter des Handys druckt. `inline`, damit er das Blatt zeigt statt
 * es nur abzulegen.
 *
 * Nicht im Service Worker: wie das Fach-PDF bleibt diese Adresse ungecacht.
 */
export async function GET(_request: Request, context: RouteContext<"/api/arbeitsblatt/[id]/pdf">) {
  const user = await getSessionUser();
  if (!user) return text("Du bist nicht angemeldet.", 401);

  const { id } = await context.params;
  if (!istId(id)) return text("Dieses Arbeitsblatt gibt es nicht.", 404);

  const stand = await blattStand(user.id, id, await jetzt());
  if (!stand) return text("Dieses Arbeitsblatt gibt es nicht.", 404);
  if (!stand.inhalt) return text("Das Blatt wird gerade gebaut.", 409);

  const pdf = await buildArbeitsblattPdf({
    fach: stand.fach,
    thema: stand.thema,
    tag: stand.tag,
    inhalt: stand.inhalt,
    probe: stand.probe,
  });
  const name = arbeitsblattDateiname(stand);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `inline; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function text(meldung: string, status: number): Response {
  return new Response(meldung, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
