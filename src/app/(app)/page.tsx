import type { Metadata } from "next";
import { after } from "next/server";

import { Startseite } from "@/components/kombi/home/startseite";
import { vorabBauen } from "@/lib/arbeitsblatt/bauen";
import { requireUser } from "@/lib/auth";
import { ladeTag } from "@/lib/kombi/tag-daten";
import { jetzt, uhrVersatz } from "@/lib/tag";

/**
 * Die Startseite (Modell 23): Datumszeile, Überschrift und die Ansicht der
 * Tageszeit. Die Daten lädt der Server einmal und gibt sie der Shell als
 * Startwert mit (Plan 2.4, Punkt 1) — kein zweiter Abruf beim Kaltstart.
 *
 * Die Uhr ist `jetzt()`: mit `SCHULAPP_TESTUHR=1` die Testuhr aus dem
 * Cookie, sonst die echte (Plan 3.1).
 */

export const metadata: Metadata = {
  title: "Start",
};

export default async function HomePage() {
  const user = await requireUser();
  const now = await jetzt();
  const daten = await ladeTag(user.id, now, await uhrVersatz());
  // Arbeitsblätter für heute und morgen vorab bauen (Plan H)
  after(() => vorabBauen(user.id, now));
  return <Startseite daten={daten} vomServer />;
}
