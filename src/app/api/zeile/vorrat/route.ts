import { zeilenVorrat } from "@/lib/kombi/zeilen-vorrat";
import { getSessionUser } from "@/lib/session";

/**
 * Der Vorrat der Zeile (Plan 3.2, D): `GET /api/zeile/vorrat`. Die Zeile holt
 * ihn beim ersten Öffnen des Menüs und nach jeder Action neu.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  return Response.json({ ok: true, vorrat: await zeilenVorrat(user.id, new Date()) }, { headers: HEADERS });
}
