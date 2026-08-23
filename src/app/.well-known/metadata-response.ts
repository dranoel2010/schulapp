import { requestOrigin } from "@/app/api/request-origin";

/**
 * Die Auslieferung eines Metadaten-Dokuments — für alle drei dieselbe.
 *
 * Was sie gemeinsam haben: sie stehen offen (ohne Anmeldung), sie sagen nichts
 * über den Nutzer, und sie hängen an der Adresse, unter der der Server gerade
 * erreicht wird. Ein Client liest sie, **bevor** er ein Token hat — sie hinter
 * eine Anmeldung zu stellen hieße, die Entdeckung unmöglich zu machen.
 *
 * **CORS ist Pflicht und keine Bequemlichkeit.** Diese Dokumente werden auch
 * aus einer Webanwendung heraus gelesen, und ein Browser fragt vorher per
 * OPTIONS nach. Ohne die Freigabe bricht die Verbindung ab, bevor der erste
 * Schritt getan ist. Sie kostet nichts: hier steht kein Geheimnis, und die
 * Freigabe erlaubt nur zu lesen, was ohnehin jeder abrufen kann.
 *
 * Zwischengespeichert werden sie eine Stunde. Sie ändern sich nur mit einem
 * Deploy, und ein Client, der sie bei jedem Verbindungsversuch neu holt, fragt
 * damit dreimal dasselbe.
 */
export function metadataResponse(
  build: (origin: string) => Record<string, unknown>,
  request: Request,
): Response {
  return Response.json(build(requestOrigin(request)), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Die Antwort auf die Vorabfrage eines Browsers. */
metadataResponse.preflight = function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    },
  });
};
