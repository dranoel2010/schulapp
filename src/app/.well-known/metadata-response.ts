import { originFrom } from "@/lib/oauth";

/**
 * Die beiden Beschreibungen, an denen ein Agent diese App findet.
 *
 * Unter `/.well-known/` liegen im Netz die Dokumente, die man abholt, ohne
 * gefragt zu haben — ein fest vereinbarter Ort. Für OAuth sind es zwei: die
 * eine sagt „hier ist ein geschützter Server, und dort holt man sich Zugang",
 * die andere sagt, welche Adressen dieser Zugang hat. Was drinsteht, rechnet
 * @/lib/oauth aus; diese Datei macht daraus eine Antwort.
 *
 * **Sie steht hier und nicht in @/lib**, aus demselben Grund wie
 * `pageImageResponse()` bei den Bildern: dort steht Rechnung und Datenzugriff,
 * keine Datei dort baut eine `Response` oder kennt einen Header. Und in eine
 * `route.ts` darf sie nicht, weil Next aus einer solchen Datei nur die
 * Methodennamen entgegennimmt.
 *
 * **Die Adresse kommt aus der Anfrage.** Warum das keine Bequemlichkeit ist,
 * sondern Bedingung, steht an `originFrom()` in @/lib/oauth: der Client
 * vergleicht die Adresse in diesem Dokument zeichengleich mit der, die er
 * aufgerufen hat, und verwirft es sonst.
 *
 * **`Access-Control-Allow-Origin: *` gehört an ein öffentliches Dokument.**
 * Diese beiden Dateien enthalten nichts, was nicht jeder wissen darf — sie sind
 * die Wegbeschreibung zur verschlossenen Tür und nicht der Schlüssel. Ein
 * Client, der aus einem Browser heraus arbeitet, käme ohne diese Zeile gar
 * nicht erst bis zur Anmeldung.
 */
export function metadataResponse(
  request: Request,
  build: (origin: string) => Record<string, unknown>,
): Response {
  const origin = originFrom(
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );

  if (!origin) {
    // Ohne Host lässt sich keine Adresse bauen, und eine geratene wäre
    // schlimmer als keine: der Client verfolgt sie weiter.
    return Response.json(
      { error: "server_error", error_description: "Diese App kennt ihre eigene Adresse nicht." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(build(origin), {
    headers: {
      // Eine Stunde. Das Dokument ändert sich nur mit einem Deployment, und ein
      // Client, der es bei jeder Anfrage neu holt, wartet dafür jedes Mal.
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
