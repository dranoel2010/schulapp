import { getSessionUser } from "@/lib/session";
import { ansicht, jetzt } from "@/lib/tag";

/**
 * Der leichte Stand der Startseite (Modell 23, Plan 3.1): welche Ansicht
 * gerade gilt, auf welchem Schritt der Ablauf steht, welcher App-Tag ist.
 * Die Startseite fragt ihn beim Zurückkommen aus dem Hintergrund
 * (`visibilitychange`) — sie wechselt die Ansicht nie, während der
 * Bildschirm sichtbar ist (V2 3.2). Muster: `/api/material/stand`.
 *
 * Der Service Worker legt die Antwort network-first in den Daten-Cache.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  try {
    const s = await ansicht(user.id, await jetzt());
    return Response.json(
      {
        ok: true,
        ansicht: s.ansicht,
        schritt: s.schritt,
        tag: s.tag,
        fingerabdruck: `${s.tag}:${s.ansicht}:${s.schritt}:${s.stand ?? "-"}`,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    console.error("Stand der Startseite: Abfrage fehlgeschlagen", error);
    return Response.json(
      { ok: false, error: "Der Stand ist gerade nicht abrufbar." },
      { status: 503, headers: HEADERS },
    );
  }
}
