import { jetzt } from "@/lib/tag";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { loadCalendarStatus } from "@/lib/calendar/sync";
import { claudeConfigured } from "@/lib/claude/client";
import { iservConfigured } from "@/lib/iserv/config";
import { listConnections } from "@/lib/oauth";
import { getSubject } from "@/lib/subjects";
import { offeneVorschlaege } from "@/recall/proposals";

import { heuteApp, schulKalender } from "./gemeinsam";

/**
 * Die Seite „Einstellungen“ (Prototyp Z. 3194): oben die drei Zeilen des
 * Prototyps (Stundenplan, Epoche, Hell und dunkel), darunter je eine Zeile zu
 * den Unterseiten, in die die bisherige Einstellungsseite aufgeteilt ist
 * (Plan 2.2). Jede Unterzeile sagt den Stand in einem Satz.
 */
export type EinstellungenDaten = {
  stunden: number;
  epoche: { id: string; name: string } | null;
  erinnerung: string;
  abschrift: string;
  kalender: string;
  iserv: string;
  verbindungen: string;
  konto: string;
  vorschlaege: number;
};

const KALENDER: Record<string, string> = {
  "nicht-eingerichtet": "Auf diesem Server nicht eingerichtet",
  getrennt: "Nicht verbunden",
  blockiert: "Verbunden, gerade blockiert",
  verbunden: "Verbunden",
};

export async function einstellungenSeite(userId: string): Promise<EinstellungenDaten> {
  const heute = heuteApp(await jetzt());
  const [kal, kalender, verbindungen, vorschlaege, nutzer] = await Promise.all([
    schulKalender(userId, heute),
    loadCalendarStatus(userId),
    listConnections(userId),
    offeneVorschlaege(userId).catch(() => []),
    db.select({ name: users.name, reminderHour: users.reminderHour }).from(users).where(eq(users.id, userId)),
  ]);
  const epochenFach = kal.epoche ? await getSubject(userId, kal.epoche) : null;

  return {
    stunden: kal.week.days.reduce((s, d) => s + d.lessons.length, 0),
    epoche: epochenFach ? { id: epochenFach.id, name: epochenFach.name } : null,
    erinnerung: `Lernerinnerung um ${nutzer[0]?.reminderHour ?? 17} Uhr`,
    abschrift: claudeConfigured() ? "Claude ist eingerichtet" : "Claude ist nicht eingerichtet",
    kalender: KALENDER[kalender.state.kind] ?? "",
    iserv: iservConfigured() ? "Eingerichtet" : "Auf diesem Server nicht eingerichtet",
    verbindungen:
      verbindungen.length === 0
        ? "Nichts verbunden"
        : verbindungen.length === 1
          ? verbindungen[0].clientName
          : `${verbindungen.length} Programme verbunden`,
    konto: nutzer[0]?.name ?? "",
    vorschlaege: vorschlaege.length,
  };
}
