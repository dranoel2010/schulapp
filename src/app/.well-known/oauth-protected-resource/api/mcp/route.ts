import { protectedResourceMetadata } from "@/lib/oauth";

import { metadataResponse } from "../../../metadata-response";

export const dynamic = "force-dynamic";

/**
 * Dieselbe Ressourcen-Beschreibung, an der Adresse mit dem Pfad des Servers
 * dahinter — die, die ein Client zuerst probiert.
 *
 * Der Pfad `/api/mcp` steht hier als Verzeichnisname im Dateibaum und nicht in
 * einer Zeichenkette. Das sieht doppelt aus (der Pfad steht auch in
 * `MCP_PATH`), ist aber die einzige Art, wie ein Ort im Netz entsteht: Next
 * baut Adressen aus Ordnern. Wandert der Server einmal woandershin, wandert
 * dieser Ordner mit — und `resourceMetadataUrl()` in @/lib/oauth sagt, wohin.
 */
export async function GET(request: Request) {
  return metadataResponse(request, protectedResourceMetadata);
}
