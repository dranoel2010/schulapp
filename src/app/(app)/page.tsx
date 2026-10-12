import type { Metadata } from "next";
import { after } from "next/server";

import { Startseite } from "@/components/kombi/home/startseite";
import { vorabBauen } from "@/lib/arbeitsblatt/bauen";
import { requireUser } from "@/lib/auth";
import { ladeTag } from "@/lib/kombi/tag-daten";

/**
 * Die Startseite (Modell 23): Datumszeile, Überschrift und die Ansicht der
 * Tageszeit. Die Daten lädt der Server einmal und gibt sie der Shell als
 * Startwert mit (Plan 2.4, Punkt 1) — kein zweiter Abruf beim Kaltstart.
 *
 * Abschnitt A zeigt nur das Gerüst (Datumszeile und Zeile); Morgens,
 * Überblick und Ablauf bringen B und C.
 */

export const metadata: Metadata = {
  title: "Start",
};

export default async function HomePage() {
  const user = await requireUser();
  const daten = await ladeTag(user.id, new Date());
  // Arbeitsblätter für heute und morgen vorab bauen (Plan H)
  after(() => vorabBauen(user.id));
  return <Startseite daten={daten} vomServer />;
}
