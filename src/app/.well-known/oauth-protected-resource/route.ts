import { protectedResourceMetadata } from "@/lib/oauth";

import { metadataResponse } from "../metadata-response";

export const dynamic = "force-dynamic";

/**
 * Die Ressourcen-Beschreibung an der Wurzel (RFC 9728).
 *
 * Zwei Adressen tragen dasselbe Dokument, und das ist kein Versehen: ein Client
 * probiert erst die Form mit dem Pfad des Servers dahinter
 * (`/.well-known/oauth-protected-resource/api/mcp`) und danach diese hier. Nur
 * die erste zu bedienen ginge auch — bis ein Client kommt, der es andersherum
 * versucht, und dann stünde die Verbindung an einer 404, die niemand erklärt.
 *
 * Der Inhalt ist an beiden gleich, weil es nur einen geschützten Server gibt.
 * Er wird an einer Stelle gerechnet (@/lib/oauth), damit die beiden Adressen
 * nicht auseinanderlaufen können.
 */
export async function GET(request: Request) {
  return metadataResponse(request, protectedResourceMetadata);
}
