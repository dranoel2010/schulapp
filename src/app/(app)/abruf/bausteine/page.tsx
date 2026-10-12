import type { Metadata } from "next";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { MATERIALARTEN, MATERIALART_NAMEN } from "@/recall/arten";
import { listItems } from "@/recall/items";
import { offeneVorschlaege } from "@/recall/proposals";

import { neuPlanenAction } from "../actions";

/**
 * Der Bestand: was überhaupt abgefragt werden kann.
 *
 * Eine Liste zum Nachsehen, nicht zum Üben — geübt wird auf dem Tisch
 * („Wiederholen“ auf der Startseite). Seit Modell 23 (Plan 2.2, E) steht hier
 * auch, was vorher auf /abruf stand: die Vorschläge im Eingang, der Stoff
 * einer Klausur und „Termine neu rechnen“. Der
 * Zuschnitt folgt derselben Trennung wie /lernen gegen /klausuren: hier wird
 * verwaltet, dort wird gearbeitet.
 *
 * Die Musterlösung steht hier mit, und das ist kein Widerspruch zu A2. A2 gilt
 * für die Abfrage — die Lösung darf nicht sichtbar sein, BEVOR geantwortet
 * wurde. Wer seinen eigenen Bestand durchsieht, fragt sich nicht ab; ihm die
 * Lösung vorzuenthalten hieße, ihn daran zu hindern, einen Fehler darin zu
 * finden.
 */

export const metadata: Metadata = {
  title: "Bausteine",
};

/**
 * Die kurzen Namen der Arten — aus dem Kern, nicht noch einmal getippt.
 *
 * `Record<string, …>` und nicht `Record<Materialart, …>`: Die Spalte in der
 * Datenbank ist `text`, also kann dort nach einer Wanderung ein Wert stehen,
 * den die Aufzählung nicht kennt. Dann steht er unverändert da (siehe unten),
 * statt die Seite zu sprengen.
 */
const ART_LABELS: Record<string, string> = Object.fromEntries(
  MATERIALARTEN.map((art) => [art, MATERIALART_NAMEN[art].kurz]),
);

export default async function BausteinePage() {
  const user = await requireUser();
  const [bausteine, vorschlaege] = await Promise.all([
    listItems(user.id),
    offeneVorschlaege(user.id),
  ]);
  const offeneFragen = vorschlaege.reduce((s, v) => s + v.fragen.length, 0);

  const aktive = bausteine.filter((b) => b.retiredAt === null);
  const zurueckgezogen = bausteine.filter((b) => b.retiredAt !== null);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bausteine</h1>
          <p className="mt-1 text-sm text-muted">
            {aktive.length === 0
              ? "Noch keine."
              : `${aktive.length} ${aktive.length === 1 ? "Baustein" : "Bausteine"} im Bestand.`}
          </p>
        </div>
        <ButtonLink href="/abruf/bausteine/neu" variant="secondary">
          Anlegen
        </ButtonLink>
      </header>

      {aktive.length === 0 && zurueckgezogen.length === 0 ? (
        <EmptyState
          title="Noch keine Bausteine"
          description="Ein Baustein ist eine Frage, ihre Musterlösung und ein Satz dazu, womit man sie verwechselt — alle drei aus einer Seite, die schon abgeschrieben ist."
          action={
            <ButtonLink href="/abruf/bausteine/neu">
              Ersten Baustein anlegen
            </ButtonLink>
          }
        />
      ) : (
        <ul className="space-y-3">
          {[...aktive, ...zurueckgezogen].map((b) => {
            const farbe = subjectColor(b.subjectColor);
            const still = b.retiredAt !== null;

            return (
              <li key={b.id}>
                <Card
                  style={
                    still
                      ? undefined
                      : {
                          backgroundColor: `color-mix(in oklab, ${farbe.hex} 7%, var(--surface))`,
                        }
                  }
                  className={still ? "opacity-60" : undefined}
                >
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span style={{ color: farbe.hex }}>{b.subjectName}</span>
                      <span className="text-subtle">
                        {ART_LABELS[b.materialKind] ?? b.materialKind}
                      </span>
                      {b.role === "messung" ? (
                        <span className="text-subtle">
                          Messvorrat — wird nie geübt
                        </span>
                      ) : still ? (
                        <span className="text-warning">zurückgezogen</span>
                      ) : (
                        <span className="text-subtle">
                          {b.offeneTermine}{" "}
                          {b.offeneTermine === 1 ? "Termin" : "Termine"} offen
                        </span>
                      )}
                    </div>

                    <p className="font-medium text-foreground">
                      {b.promptFree}
                    </p>

                    <ol className="ml-4 list-decimal space-y-0.5 text-sm text-muted">
                      {b.solution
                        .split("\n")
                        .map((z) => z.trim())
                        .filter(Boolean)
                        .map((z, i) => (
                          <li key={i}>{z}</li>
                        ))}
                    </ol>

                    <p className="text-sm text-subtle">{b.misconception}</p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Was vorher auf /abruf stand (Plan 2.2): Eingang, Stoff, Termine neu rechnen */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {offeneFragen > 0 ? (
            <ButtonLink href="/abruf/eingang" variant="secondary">
              {offeneFragen} {offeneFragen === 1 ? "Frage wartet" : "Fragen warten"} im Eingang
            </ButtonLink>
          ) : null}
          <ButtonLink href="/abruf/klausur" variant="secondary">
            Stoff einer Klausur
          </ButtonLink>
        </div>
        {/* Der Weg zurück, wenn der Kalender sich bewegt hat: Termine entstehen
            beim Anlegen, ein Klausurtermin danach nicht mehr. Am Takt ändert
            sich dabei nichts, Erledigtes bleibt stehen. */}
        <form action={neuPlanenAction}>
          <Button type="submit" variant="secondary">
            Termine neu rechnen
          </Button>
        </form>
        <p className="text-sm text-subtle">
          Nach einer neuen oder verschobenen Klausur: legt die
          Wiederholungstermine wieder vor die Klausur. Am Takt ändert sich
          nichts.
        </p>
      </section>
    </div>
  );
}
