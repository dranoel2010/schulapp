import { ladeAblauf } from "@/lib/kombi/ablauf";
import { jetztFuerAblauf } from "@/lib/kombi/ablauf-uhr";
import { getSessionUser } from "@/lib/session";

/**
 * Die Daten des Ablaufs nach der Schule als JSON (Modell 23, Abschnitt C):
 * ob er heute dran ist, Schritt, Blätter des Tages, Fächer und Aufgaben.
 * Die Ebene `flow` fragt beim Öffnen der App, beim Zurückkommen aus dem
 * Hintergrund und — solange ein Blatt nicht fertig ist — nach jedem neuen
 * Stand der Blätter.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  return Response.json(await ladeAblauf(user.id, await jetztFuerAblauf()), { headers: HEADERS });
}
