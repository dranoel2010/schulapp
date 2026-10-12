import type { NextRequest } from "next/server";

import type { BlattImSheet } from "@/components/kombi/tisch/typen";
import { laufGescheitert } from "@/lib/kombi/blaetter";
import { letzterLauf } from "@/lib/leser/laeufe";
import { getMaterial, listMaterialTranscripts } from "@/lib/materials";
import { getSessionUser } from "@/lib/session";

/**
 * „Blatt ansehen“ auf der Rückseite einer Karte (V2 6.4): Titel, Fach,
 * Seitenzahl und die Abschrift, für das Sheet auf dem Tisch (Prototyp
 * `openSheet`, Z. 3335). Nur das eigene Blatt.
 *
 * `fehlgeschlagen` (Plan 3.8, Prototyp `abschriftEl` Z. 3238): Seiten ohne
 * Abschrift, und der jüngste Lauf des Lesers endete ohne sie — dieselbe Regel
 * wie auf der Blattseite (`laufGescheitert()` aus `src/lib/kombi/blaetter.ts`).
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const [blatt, seiten] = await Promise.all([getMaterial(user.id, id), listMaterialTranscripts(user.id, id)]);
  if (!blatt) return Response.json({ ok: false }, { status: 404, headers: HEADERS });
  const offen = seiten.some((s) => s.transcript === null);
  const fehlgeschlagen = offen && laufGescheitert(await letzterLauf(user.id, id));
  const antwort: BlattImSheet = {
    titel: blatt.title,
    fach: blatt.subject.name,
    seiten: blatt.pageCount,
    abschrift: seiten.map((s) => s.transcript),
    fehlgeschlagen,
  };
  return Response.json({ ok: true, blatt: antwort }, { headers: HEADERS });
}
