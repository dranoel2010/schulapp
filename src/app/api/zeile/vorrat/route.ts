import { zeilenVorrat } from "@/lib/kombi/zeilen-vorrat";
import { getSessionUser } from "@/lib/session";

/**
 * Der Vorrat der Zeile (Plan 3.2, D): `GET /api/zeile/vorrat`. Die Zeile holt
 * ihn bei jedem Öffnen des Menüs (bis er da ist, zeigt sie den alten), nach
 * jedem `neuLaden()` der Shell, beim Sichtbarwerden und zum Tageswechsel um
 * 04:00. Eingetragen wird erst mit einem Vorrat vom heutigen App-Tag.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  return Response.json({ ok: true, vorrat: await zeilenVorrat(user.id, new Date()) }, { headers: HEADERS });
}
