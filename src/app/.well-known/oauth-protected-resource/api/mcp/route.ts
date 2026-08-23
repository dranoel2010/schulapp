import { protectedResourceMetadata } from "@/lib/oauth";

import { metadataResponse } from "../../../metadata-response";

/**
 * Dasselbe Dokument noch einmal, unter der Adresse mit eingesetztem Pfad.
 *
 * RFC 9728 kennt zwei Schreibweisen für die Metadaten einer Ressource unter
 * einem Pfad: `/.well-known/oauth-protected-resource` und, mit dem Pfad der
 * Ressource dahinter, `/.well-known/oauth-protected-resource/api/mcp`. Welche
 * ein Client versucht, ist ihm überlassen — manche versuchen beide, manche nur
 * eine. Beide auszuliefern kostet diese zwölf Zeilen; eine davon nicht zu
 * haben kostet die Verbindung.
 */
export async function GET(request: Request) {
  return metadataResponse(protectedResourceMetadata, request);
}

export async function OPTIONS() {
  return metadataResponse.preflight();
}
