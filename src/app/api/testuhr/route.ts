import type { NextRequest } from "next/server";

import { TESTUHR_COOKIE, testuhrAusParametern, testuhrErlaubt } from "@/lib/tag";

/**
 * Die Testuhr stellen (Modell 23, Plan 3.1 und 5.3) — nur mit
 * `SCHULAPP_TESTUHR=1`, sonst 404. Auf dem NAS ist die Variable nie gesetzt.
 *
 *   /api/testuhr?jetzt=2026-10-12T07:10    genauer Zeitpunkt (Berliner Zeit)
 *   /api/testuhr?zeit=07:10&tag=2026-10-13 Uhrzeit an einem Tag (Vorgabe Mo 12.10.)
 *   /api/testuhr?reset                     zurück auf die echte Uhr
 *
 * Danach leitet die Route auf `/` (oder `?weiter=/pfad`) um. Die Uhr läuft ab
 * dem gestellten Zeitpunkt weiter, wie im Prototyp.
 */
export async function GET(request: NextRequest) {
  if (!testuhrErlaubt()) return new Response("Not Found", { status: 404 });

  const p = request.nextUrl.searchParams;
  const weiter = p.get("weiter");
  const ziel = new URL(
    weiter && weiter.startsWith("/") && !weiter.startsWith("//") ? weiter : "/",
    request.url,
  );
  const kopf = new Headers({ Location: ziel.toString(), "Cache-Control": "no-store" });

  if (p.has("reset")) {
    kopf.append("Set-Cookie", `${TESTUHR_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  } else {
    const zeitpunkt = testuhrAusParametern(p);
    if (!zeitpunkt) {
      return Response.json(
        { ok: false, fehler: "?jetzt=YYYY-MM-DDTHH:MM oder ?zeit=HH:MM[&tag=YYYY-MM-DD]" },
        { status: 400 },
      );
    }
    const wert = encodeURIComponent(JSON.stringify({ start: zeitpunkt.getTime(), gestellt: Date.now() }));
    kopf.append("Set-Cookie", `${TESTUHR_COOKIE}=${wert}; Path=/; SameSite=Lax`);
  }
  return new Response(null, { status: 303, headers: kopf });
}
