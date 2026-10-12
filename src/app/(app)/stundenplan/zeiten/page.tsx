import type { Metadata } from "next";

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
    <div className="kf-seite">

      <div className="space-y-1">
        <h2 className="p-title">Stundenzeiten</h2>
        <p className="text-[15px] text-ink-2">
          Wann deine Stunden anfangen und aufhören. Im Wochenraster stehen die
          Zeiten nicht — gebraucht werden sie für den Tagesplan auf der
          Startseite, der deinen Tag von morgens nach abends sortiert.
        </p>
      </div>

      {untouched ? (
        <p className="p-sub">
          Das ist noch die Vorgabe der App — die Pausenordnung eines gedachten
          Gymnasiums. Stell sie auf deine Schule um, sonst steht der Tagesplan
          zur falschen Zeit.
        </p>
      ) : null}

      <PeriodForm action={savePeriodsAction} rows={rows} />
    </div>
  );
}
