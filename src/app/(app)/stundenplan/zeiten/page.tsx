import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { ensurePeriods, isDefaultPeriods } from "@/lib/timetable";

import { savePeriodsAction } from "../actions";
import { PeriodForm } from "./period-form";

/**
 * Das Stundenraster: wann welche Stunde beginnt und endet.
 *
 * Es steht bewusst nicht im Wochenraster, sondern hier — der Wochenplan
 * beantwortet „was habe ich wann“, die Uhrzeiten braucht erst der Tagesplan
 * auf der Startseite, um den Tag der Reihe nach zu zeigen.
 *
 * Beim ersten Aufruf legt ensurePeriods() die Vorgabe an. Solange sie
 * unverändert ist, sagt die Seite das auch: eine erfundene Pausenordnung ist
 * kein Stundenplan, sie ist ein Anfang.
 */

export const metadata: Metadata = {
  title: "Stundenzeiten",
};

export default async function PeriodsPage() {
  const user = await requireUser();

  const periods = await ensurePeriods(user.id);

  const rows = periods.map((period) => ({
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  }));

  const untouched = isDefaultPeriods(rows);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/stundenplan"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 6-6 6 6 6" />
        </svg>
        Wochenplan
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Stundenzeiten</h1>
        <p className="text-sm text-muted">
          Wann deine Stunden anfangen und aufhören. Im Wochenraster stehen die
          Zeiten nicht — gebraucht werden sie für den Tagesplan auf der
          Startseite, der deinen Tag von morgens nach abends sortiert.
        </p>
      </div>

      {untouched ? (
        <p className="rounded-card border border-dashed border-border px-4 py-3 text-sm text-muted">
          Das ist noch die Vorgabe der App — die Pausenordnung eines gedachten
          Gymnasiums. Stell sie auf deine Schule um, sonst steht der Tagesplan
          zur falschen Zeit.
        </p>
      ) : null}

      <PeriodForm action={savePeriodsAction} rows={rows} />
    </div>
  );
}
