import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { addDays, todayInBerlin } from "@/lib/dates";
import { listHomework } from "@/lib/homework";
import { listSubjects } from "@/lib/subjects";

import { HomeworkList } from "./homework-list";

/**
 * Was aufgegeben ist, in einer Liste: Offenes nach Fälligkeit, Überfälliges
 * ganz oben, frisch Abgehaktes darunter. Abhaken geht direkt hier, antippen
 * führt zur Aufgabe.
 *
 * Die Reihenfolge kommt aus listHomework — offen nach Fälligkeit, erledigt
 * zuletzt Abgehaktes zuerst. Überfälliges steht damit von selbst obenauf, weil
 * sein Datum das kleinste ist.
 */

export const metadata: Metadata = {
  title: "Hausaufgaben",
};

// `export const dynamic = "force-dynamic"` steht schon im Layout der Gruppe
// (src/app/(app)/layout.tsx) und gilt damit auch hier — hier wäre es doppelt.

/**
 * So lange bleibt eine abgehakte Aufgabe in der Liste stehen.
 *
 * Gelöscht wird nie etwas: die Aufgabe bleibt in der Datenbank, sie
 * verschwindet nur aus dieser Ansicht. Sonst wüchse die Liste über ein
 * Schuljahr auf hunderte durchgestrichene Zeilen an, und man sähe das
 * Wichtige nicht mehr. Zwei Wochen reichen, um versehentlich Abgehaktes
 * wiederzufinden.
 */
const DONE_VISIBLE_DAYS = 14;

export default async function HomeworkPage() {
  const user = await requireUser();
  const today = todayInBerlin();

  const [items, subjects] = await Promise.all([
    listHomework(user.id, { includeDone: true }),
    listSubjects(user.id),
  ]);

  const cutoff = addDays(today, -DONE_VISIBLE_DAYS);

  // todayInBerlin rechnet einen Zeitpunkt in den Berliner Kalendertag um —
  // dieselbe Zeitzone wie überall sonst in der App. Gezählt wird ab dem Tag
  // des Abhakens, nicht ab der Fälligkeit: was man heute nachträgt, soll heute
  // noch dastehen.
  const visible = items.filter(
    (item) =>
      !item.done ||
      (item.doneAt !== null && todayInBerlin(item.doneAt) >= cutoff),
  );

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Hausaufgaben</h1>
        <p className="text-sm text-muted">
          Antippen öffnet die Aufgabe. Das Kästchen hakt sie ab — erledigte
          bleiben zwei Wochen stehen.
        </p>
      </header>

      {visible.length === 0 ? (
        subjects.length === 0 ? (
          <EmptyState
            title="Zuerst die Fächer"
            description="Jede Aufgabe gehört zu einem Fach. Sobald deine Fächer stehen, kannst du eintragen, was aufgegeben ist."
            action={<ButtonLink href="/faecher">Zu den Fächern</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="Nichts aufgegeben"
            description="Trag ein, was bis wann fällig ist. Vorgeschlagen wird die nächste Stunde in dem Fach."
            action={
              <ButtonLink href="/hausaufgaben/neu">Aufgabe eintragen</ButtonLink>
            }
            icon={
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="size-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3.5" y="4.5" width="6" height="6" rx="2" />
                <rect x="3.5" y="13.5" width="6" height="6" rx="2" />
                <path d="M13 7.5h7.5M13 16.5h7.5" />
              </svg>
            }
          />
        )
      ) : (
        <>
          <HomeworkList items={visible} today={today} />

          {/* Der Akzentknopf steht unten: am Handy liegt er da, wo der Daumen
              ohnehin ist, und die Liste bleibt das Erste, was man sieht. */}
          <ButtonLink
            href="/hausaufgaben/neu"
            size="lg"
            className="w-full sm:w-auto"
          >
            + Aufgabe
          </ButtonLink>
        </>
      )}
    </div>
  );
}
