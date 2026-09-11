import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { listItems } from "@/recall/items";

/**
 * Der Bestand: was überhaupt abgefragt werden kann.
 *
 * Eine Liste zum Nachsehen, nicht zum Üben — geübt wird auf /abruf. Der
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

const ART_LABELS: Record<string, string> = {
  begriff: "Begriff",
  anschauung: "Anschauung",
  verfahren: "Verfahren",
  ereignis: "Ereignis",
};

export default async function BausteinePage() {
  const user = await requireUser();
  const bausteine = await listItems(user.id);

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
    </div>
  );
}
