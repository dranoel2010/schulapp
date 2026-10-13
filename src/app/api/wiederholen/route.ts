import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { subjectTopics, subjects } from "@/db/schema";

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
import { dauertaktSicher } from "@/recall/nachlegen";

/**
 * Was der Tisch zum Wiederholen braucht (Plan E, 3.4):
 *
 * - `GET /api/wiederholen[?fach=<id>]` — die fälligen Themen in ihrer
 *   Reihenfolge und gleich die Fragen des ersten Themas;
 * - `GET /api/wiederholen?thema=<key>` — die Fragen eines Themas
 *   („Fertig, weiter“);
 * - `GET /api/wiederholen?blatt=<topicId>` — genau dieses Fach-Thema als
 *   Arbeitsblatt, auch wenn heute nichts daran fällig ist („Blatt Grammatik
 *   Englisch“ aus der Zeile, Antwort 5 vom 13.10.2026). Ein fremdes oder
 *   unbekanntes Thema ergibt eine leere Liste.
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
  const [fragen, bericht] = await Promise.all([fragenZumThema(userId, heute, key), themaTagesbericht(userId, key, heute)]);
  const wiederDran = await naechsterTerminThema(
    userId,
    key,
    heute,
    fragen.map((f) => f.scheduleId),
  );
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

/** Ein Fach-Thema als Arbeitsblatt für den Tisch — oder null, wenn es nicht dem Nutzer gehört. */
async function blattThema(userId: string, topicId: string): Promise<ThemaKurz | null> {
  const [t] = await db
    .select({ id: subjectTopics.id, titel: subjectTopics.title, fach: subjects.name })
    .from(subjectTopics)
    .innerJoin(subjects, eq(subjects.id, subjectTopics.subjectId))
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topicId), isNull(subjectTopics.mergedInto)))
    .limit(1);
  if (!t) return null;
  return {
    key: t.id,
    fach: t.fach,
    titel: t.titel,
    art: "ueben",
    umfang: "Arbeitsblatt",
    istEpoche: false,
    fragen: 0,
    angefangen: false,
    blattAngefangen: false,
  };
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ ok: false, error: "Nicht angemeldet." }, { status: 401, headers: HEADERS });
  }
  const heute = appTag(await jetzt());
  const sp = request.nextUrl.searchParams;
  // Themen ohne Klausur bekommen ihren nächsten Termin, bevor der Tisch liest (Antwort 6)
  await dauertaktSicher(user.id, heute);

  const thema = sp.get("thema");
  if (thema) {
    if (!istThemaSchluessel(thema)) return Response.json({ ok: false }, { status: 400, headers: HEADERS });
    return Response.json({ ok: true, lauf: await lauf(user.id, heute, thema) }, { headers: HEADERS });
  }

  const blatt = sp.get("blatt");
  if (blatt) {
    if (!istId(blatt)) return Response.json({ ok: false }, { status: 400, headers: HEADERS });
    const [t, ferien] = await Promise.all([blattThema(user.id, blatt), freePeriodToday(user.id, heute)]);
    const antwort: WiederholenAntwort = {
      ok: true,
      heute,
      ferien: !!ferien,
      themen: t ? [t] : [],
      naechstesThema: null,
      fachName: null,
      durch: false,
      lauf: null,
    };
    return Response.json(antwort, { headers: HEADERS });
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
