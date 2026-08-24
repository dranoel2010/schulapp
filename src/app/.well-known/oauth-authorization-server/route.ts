import { authorizationServerMetadata } from "@/lib/oauth";

import { metadataResponse } from "../metadata-response";

export const dynamic = "force-dynamic";

/**
 * Die Beschreibung des Ausstellers (RFC 8414): welche Adressen es gibt, welche
 * Verfahren dieser Server kann.
 *
 * Der Aussteller ist diese App selbst — kein Google, kein Auth0. Für einen
 * einzigen Nutzer, der ohnehin schon ein Passwort für diese App hat, wäre ein
 * fremder Anmeldedienst eine zweite Stelle, die weiß, wer er ist, und ein
 * zweiter Ort, an dem etwas ablaufen kann.
 */
export async function GET(request: Request) {
  return metadataResponse(request, authorizationServerMetadata);
}
