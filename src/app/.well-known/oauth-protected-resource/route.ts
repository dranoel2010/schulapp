import { protectedResourceMetadata } from "@/lib/oauth";

import { metadataResponse } from "../metadata-response";

/**
 * Das Metadaten-Dokument der geschützten Ressource (RFC 9728).
 *
 * Es ist der erste Schritt der Entdeckung: der MCP-Endpunkt antwortet ohne
 * Token mit `401` und einem `WWW-Authenticate`, das hierher zeigt; hier steht,
 * welcher Autorisierungsserver zuständig ist. Für diese App ist er dieselbe
 * App — das Dokument nennt also den eigenen Ursprung.
 */
export async function GET(request: Request) {
  return metadataResponse(protectedResourceMetadata, request);
}

export async function OPTIONS() {
  return metadataResponse.preflight();
}
