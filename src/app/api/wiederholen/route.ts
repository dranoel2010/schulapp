import type { NextRequest } from "next/server";

import type { ThemaKurz, ThemaLauf, WiederholenAntwort } from "@/components/kombi/tisch/typen";
import { getSessionUser } from "@/lib/session";
import { appTag, jetzt } from "@/lib/tag";
import {
  faelligeThemen,
  fragenZumThema,
  istThemaSchluessel,
  leerStand,
  naechstesThemaText,
  naechsterTerminThema,
  themaTagesbericht,
} from "@/recall/themen";
import { freePeriodToday } from "@/lib/free-days";
import { istId } from "@/recall/ids";

/**
 * Was der Tisch zum Wiederholen braucht (Plan E, 3.4):
 *
 * - `GET /api/wiederholen[?fach=<id>]` — die fälligen Themen in ihrer
 *   Reihenfolge und gleich die Fragen des ersten Themas;
 * - `GET /api/wiederholen?thema=<key>` — die Fragen eines Themas
 *   („Fertig, weiter“).
 *
 * Ist nichts fällig, kommen der Fachname (bei `?fach=`) und `durch` (heute
 * schon ein Thema beendet) mit, damit der Tisch denselben Satz sagt wie der
 * Prototyp. Ein Schlüssel, der keiner ist, ergibt 400 statt einer Ausnahme
 * aus Postgres.
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
  const heute = appTag(await jetzt());
  const sp = request.nextUrl.searchParams;

  const thema = sp.get("thema");
  if (thema) {
    if (!istThemaSchluessel(thema)) return Response.json({ ok: false }, { status: 400, headers: HEADERS });
    return Response.json({ ok: true, lauf: await lauf(user.id, heute, thema) }, { headers: HEADERS });
  }

  const fach = sp.get("fach") || undefined;
  if (fach && !istId(fach)) return Response.json({ ok: false }, { status: 400, headers: HEADERS });
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
  const leer = kurz.length ? { fachName: null, durch: false } : await leerStand(user.id, heute, fach ?? null);
  const antwort: WiederholenAntwort = {
    ok: true,
    heute,
    ferien: !!ferien,
    themen: kurz,
    naechstesThema,
    fachName: leer.fachName,
    durch: leer.durch,
    lauf: kurz[0] ? await lauf(user.id, heute, kurz[0].key) : null,
  };
  return Response.json(antwort, { headers: HEADERS });
}
