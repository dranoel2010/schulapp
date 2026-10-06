import { blaetterStand } from "@/lib/materials";
import { getSessionUser } from "@/lib/session";

/**
 * Der Stand der Blätter als `{ stand, inArbeit }` — für den angemeldeten
 * Nutzer und sonst niemanden.
 *
 * Gefragt wird von `AutoRefresh` (@/components/material/auto-refresh) auf
 * Ablage, Blattseite, Eingangskorb und Vorschlagsseite: alle fünf Sekunden,
 * solange gelesen wird, sonst alle dreißig, und nur bei sichtbarem Tab. Ändert
 * sich der Text in `stand`, lädt die Seite nach. Was darin gezählt ist, steht
 * an `blaetterStand()` in @/lib/materials.
 *
 * GET, weil nur gelesen wird, und `private, no-store`, weil die Antwort einem
 * Menschen gehört und in der nächsten Sekunde schon falsch sein kann — ein
 * Cache auf dem Weg, der sie aufhebt, hielte die Seite im alten Stand fest.
 * Ein `export const dynamic` steht hier nicht: Route Handler sind in Next 16
 * nicht gecacht, und die Sitzung liest ohnehin ein Cookie.
 *
 * `getSessionUser()` und nicht `requireUser()`: das leitet nach /login um, und
 * eine Umleitung auf eine HTML-Seite ist für eine Frage aus dem Hintergrund
 * keine Antwort. Ein ehrliches 401 sagt dem Baustein, dass er aufhören kann.
 */

/** An jeder Antwort, auch an den Absagen. */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json(
      { ok: false, error: "Nicht angemeldet." },
      { status: 401, headers: HEADERS },
    );
  }

  try {
    return Response.json(await blaetterStand(user.id), { headers: HEADERS });
  } catch (error) {
    // Der Baustein fragt nach einem Fehler leise im ruhigen Takt weiter; zu
    // sehen ist er nur hier im Protokoll.
    console.error("Stand der Blätter: Abfrage fehlgeschlagen", error);
    return Response.json(
      { ok: false, error: "Der Stand ist gerade nicht abrufbar." },
      { status: 503, headers: HEADERS },
    );
  }
}
