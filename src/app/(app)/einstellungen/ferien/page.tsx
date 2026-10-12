import type { Metadata } from "next";

import { Button, SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { freeLabel, listFreePeriods } from "@/lib/free-days";

import { createFreePeriodAction, deleteFreePeriodAction } from "../actions";
import { FreeDaysForm } from "../free-days-form";

/**
 * Einstellungen › Ferien und freie Tage. An diesen Tagen ist ganz frei: kein
 * Stundenplan, keine Lernblöcke, kein Abruf, keine Erinnerung (Memory „Ferien
 * ganz frei“).
 */

export const metadata: Metadata = { title: "Ferien und freie Tage" };

export default async function FerienPage() {
  const user = await requireUser();
  const today = todayInBerlin();
  const freePeriods = await listFreePeriods(user.id, today);

  return (
    <>
      <SeitenKopf
        titel="Ferien und freie Tage"
        sub="An diesen Tagen ist ganz frei: kein Stundenplan, keine Lernblöcke, kein Abruf, keine Erinnerung. Der Lernplan weicht auf die Tage davor und danach aus."
      />

      {freePeriods.length === 0 ? (
        <p className="empty">Nichts eingetragen.</p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {freePeriods.map((period) => (
            <div key={period.id} className="set-row">
              <div>
                <b style={{ fontWeight: 560 }}>
                  {freeLabel(period)}
                  {period.startsOn <= today ? " · gerade" : ""}
                </b>
                <span style={{ display: "block" }}>
                  {period.startsOn === period.endsOn
                    ? formatGerman(period.startsOn, "kurz")
                    : `${formatGerman(period.startsOn, "kurz")} bis ${formatGerman(period.endsOn, "kurz")}`}
                </span>
              </div>
              <form action={deleteFreePeriodAction}>
                <input type="hidden" name="id" value={period.id} />
                <Button type="submit" variant="ghost">
                  Streichen
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}

      <h3 className="p-lab">Neu eintragen</h3>
      <FreeDaysForm action={createFreePeriodAction} />
    </>
  );
}
