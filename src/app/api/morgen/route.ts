import { jetztFuerAblauf } from "@/lib/kombi/ablauf-uhr";
import { ladeMorgen } from "@/lib/morgen";
import { getSessionUser } from "@/lib/session";

/**
 * Der Ablauf vor der Schule als JSON: Briefing und Packliste des Tages
 * (aus dem nächtlichen Wiki-Lauf, siehe src/lib/morgen.ts) und ob er
 * gerade dran ist.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  return Response.json(await ladeMorgen(user.id, await jetztFuerAblauf()), { headers: HEADERS });
}
