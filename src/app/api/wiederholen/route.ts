import type { NextRequest } from "next/server";

import type { ThemaKurz, ThemaLauf, WiederholenAntwort } from "@/components/kombi/tisch/typen";
import { getSessionUser } from "@/lib/session";
import {
  appTagVon,
  faelligeThemen,
  fragenZumThema,
  naechstesThemaText,
  naechsterTerminThema,
  themaTagesbericht,
} from "@/recall/themen";
import { freePeriodToday } from "@/lib/free-days";

/**
 * Was der Tisch zum Wiederholen braucht (Plan E, 3.4):
 *
 * - `GET /api/wiederholen[?fach=<id>]` — die fälligen Themen in ihrer
 *   Reihenfolge und gleich die Fragen des ersten Themas;
 * - `GET /api/wiederholen?thema=<key>` — die Fragen eines Themas
 *   („Fertig, weiter“).
 *
 * Die Musterlösung reist nicht mit (A2): sie kommt erst nach dem Versuch aus
 * `versuchThemaAction()`. Nur lesen, kein Termin wird hier geschrieben.
 */
const HEADERS = { "Cache-Control": "private, no-store" };

async function lauf(userId: string, heute: string, key: string): Promise<ThemaLauf> {
  const [fragen, bericht, wiederDran] = await Promise.all([
    fragenZumThema(userId, heute, key),
    themaTagesbericht(userId, key, heute),
    naechsterTerminThema(userId, key, heute),
  ]);
  return {
    key,
    fragen: fragen.map((f) => ({
      scheduleId: f.scheduleId,
      itemId: f.itemId,
      frage: f.promptFree,
      heuteDaneben: f.heuteDaneben,
      // solution, misconception und sourceQuote stehen hier ABSICHTLICH nicht (A2)
    })),
    erste: bericht.erste,
    wiederDran,
  };
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  const heute = appTagVon(new Date());
  const sp = request.nextUrl.searchParams;

  const thema = sp.get("thema");
  if (thema) {
    if (thema.length > 60) return Response.json({ ok: false }, { status: 400, headers: HEADERS });
    return Response.json({ ok: true, lauf: await lauf(user.id, heute, thema) }, { headers: HEADERS });
  }

  const fach = sp.get("fach") ?? undefined;
  const [themen, naechstesThema, ferien] = await Promise.all([
    faelligeThemen(user.id, heute, { subjectId: fach }),
    naechstesThemaText(user.id, heute),
    freePeriodToday(user.id, heute),
  ]);
  const kurz: ThemaKurz[] = themen.map((t) => ({
    key: t.key,
    fach: t.fach,
    titel: t.titel,
    art: t.art,
    umfang: t.umfang,
    istEpoche: t.istEpoche,
    fragen: t.fragen,
    angefangen: t.angefangen,
    blattAngefangen: t.blattAngefangen,
  }));
  const antwort: WiederholenAntwort = {
    ok: true,
    heute,
    ferien: !!ferien,
    themen: kurz,
    naechstesThema,
    lauf: kurz[0] ? await lauf(user.id, heute, kurz[0].key) : null,
  };
  return Response.json(antwort, { headers: HEADERS });
}
