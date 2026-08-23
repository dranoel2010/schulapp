import { authServerMetadata } from "@/lib/oauth";

import { metadataResponse } from "../metadata-response";

/**
 * Das Metadaten-Dokument des Autorisierungsservers (RFC 8414).
 *
 * Der zweite Schritt der Entdeckung. Wichtigster Eintrag darin ist
 * `code_challenge_methods_supported`: fehlt er, muss ein Client nach der
 * Spezifikation abbrechen, weil er dann nicht wissen kann, ob PKCE greift.
 */
export async function GET(request: Request) {
  return metadataResponse(authServerMetadata, request);
}

export async function OPTIONS() {
  return metadataResponse.preflight();
}
