import type { NextRequest } from "next/server";

import { seitenLoader } from "@/lib/seiten";
import { getSessionUser } from "@/lib/session";

/**
 * Die Daten einer Nachschlage-Seite für den Stapel der Shell (Plan 2.1,
 * 2.4): `GET /api/seite/<art>?<params>` → JSON aus dem Loader in
 * `src/lib/seiten/`. Der Service Worker legt die Antworten network-first in
 * den Daten-Cache `schulapp-v3-daten`, damit besuchte Seiten auch ohne Netz
 * aufgehen.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/seite/[art]">,
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }

  const { art } = await ctx.params;
  const loader = seitenLoader(art);
  if (!loader) {
    return Response.json({ ok: false, error: "Diese Seite gibt es nicht." }, { status: 404, headers: HEADERS });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const daten = await loader(user.id, params);
  if (daten === null) {
    return Response.json({ ok: false, error: "Diese Seite gibt es nicht." }, { status: 404, headers: HEADERS });
  }
  return Response.json({ ok: true, daten }, { headers: HEADERS });
}
