import type { NextRequest } from "next/server";

import { STOP } from "@/components/kombi/zeile/suche";
import { norm } from "@/lib/kombi/fach-alias";
import { getSessionUser } from "@/lib/session";
import { sucheBlaetter, suchWoerter } from "@/lib/suche";

/**
 * Volltextsuche der Zeile über die Blätter (Plan 3.7): `GET /api/suche?q=`.
 * Die Zeile ruft sie 150 ms nach dem letzten Tastendruck auf (Prototyp
 * Z. 2451); alle anderen Gruppen rechnet sie selbst aus dem Vorrat.
 *
 * `w` nennt die Wörter, um die der Ausschnitt liegen soll (ohne Fach- und
 * Zielwörter, wie `srvQs` im Prototyp); ohne `w` sind es die Suchwörter.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  const woerter = suchWoerter(q).filter((w) => !STOP.has(norm(w)));
  const markieren = (request.nextUrl.searchParams.get("w") ?? "")
    .split(/\s+/)
    .map((w) => norm(w).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 8);
  const list = await sucheBlaetter(user.id, woerter, 8, markieren);
  return Response.json({ ok: true, q, list }, { headers: HEADERS });
}
