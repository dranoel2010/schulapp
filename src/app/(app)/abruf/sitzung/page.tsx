import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { todayInBerlin } from "@/lib/dates";
import { faelligHeute } from "@/recall/sessions";

import { SessionView, type Frage } from "./session-view";

/**
 * Der Abend.
 *
 * Diese Seite tut zwei Dinge: Sie holt, was heute fällig ist, und **sie lässt
 * die Musterlösung weg**. Das ist kein Detail der Darstellung, sondern die
 * Umsetzung von A2: Was an den Browser geht, steht in den Entwicklerwerkzeugen.
 * `faelligHeute()` liefert die Lösung mit — sie wird hier bewusst nicht in
 * `Frage` übernommen, und die Sitzung holt sie erst nach dem abgeschickten
 * Versuch über eine Server Action.
 *
 * Wer diese Zuordnung unten um `solution` erweitert, macht aus einer
 * Abrufübung eine Leseübung mit Zwischenschritt — dann steht die Antwort im
 * HTML, bevor die Frage gelesen ist.
 */

export const metadata: Metadata = {
  title: "Abend",
};

export default async function SitzungPage() {
  const user = await requireUser();
  const heute = todayInBerlin();

  const faellig = await faelligHeute(user.id, heute);

  // Nichts fällig heißt: hier gibt es nichts zu tun. Die Übersicht sagt das
  // besser als eine leere Sitzung, die einen Knopf ohne Aufgabe zeigt.
  if (faellig.length === 0) redirect("/abruf");

  const fragen: Frage[] = faellig.map((f) => ({
    scheduleId: f.scheduleId,
    itemId: f.itemId,
    promptFree: f.promptFree,
    promptCue: f.promptCue,
    dueOn: f.dueOn,
    subjectName: f.subjectName,
    subjectColorHex: subjectColor(f.subjectColor).hex,
    ueberfaellig: f.dueOn < heute,
    // solution und misconception stehen hier ABSICHTLICH nicht. Siehe oben.
  }));

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Abend</h1>
        <p className="mt-1 text-sm text-muted">
          Erst antworten, dann vergleichen. Ein Baustein ist durch, wenn er
          einmal saß — was danebengeht, kommt heute noch einmal.
        </p>
      </header>

      <SessionView fragen={fragen} heute={heute} />
    </div>
  );
}
