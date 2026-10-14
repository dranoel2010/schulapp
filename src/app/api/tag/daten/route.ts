import { ladeTag } from "@/lib/kombi/tag-daten";
import { getSessionUser } from "@/lib/session";
import { jetzt, uhrVersatz } from "@/lib/tag";

/**
 * Die Daten der Startseite als JSON (Plan 2.4, Punkt 1). Die Shell holt sie
 * bei jedem Einstieg, der nicht `/` ist, und nach jeder Action gezielt neu.
 * Der Service Worker legt sie network-first in den Daten-Cache.
 *
 * `getSessionUser()` statt `requireUser()`, wie `/api/material/stand`: eine
 * Umleitung auf /login ist für eine Frage aus dem Hintergrund keine Antwort,
 * ein ehrliches 401 schon.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  return Response.json(await ladeTag(user.id, await jetzt(), await uhrVersatz()), { headers: HEADERS });
}
