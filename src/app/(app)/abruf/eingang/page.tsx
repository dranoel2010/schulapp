import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import { offeneVorschlaege, vorschlagsErgebnis } from "@/recall/proposals";

import { ProposalView } from "./proposal-view";

/**
 * Der Eingang: was der Agent an Fragen vorgeschlagen hat.
 *
 * Dasselbe Muster wie der Eingangskorb für Blätter — die KI legt einen
 * Vorschlag ab, ein Mensch übernimmt ihn. Der Unterschied zur Abschrift ist die
 * Prüfbarkeit: Eine Abschrift kann man gegen das Foto halten, eine
 * Musterlösung nicht. Deshalb steht bei jeder Frage das Zitat aus dem Heft
 * dabei, und deshalb geht jede übernommene Frage durch dieselbe
 * Quellbindungsprüfung wie eine von Hand angelegte.
 */

export const metadata: Metadata = {
  title: "Vorschläge",
};

export default async function EingangPage({
  searchParams,
}: PageProps<"/abruf/eingang">) {
  const user = await requireUser();
  const { erledigt } = await searchParams;

  // Der Bericht eines abgearbeiteten Vorschlags — serverseitig, weil er im
  // Browser nicht überleben kann: Jedes revalidatePath() in einer Server Action
  // frischt die offene Route mit auf und ersetzt dabei die Komponente, die den
  // Bericht hielt. Die Gründe stehen ohnehin in der Datenbank.
  const ergebnis =
    typeof erledigt === "string"
      ? await vorschlagsErgebnis(user.id, erledigt)
      : null;

  if (ergebnis) {
    // Die Unterscheidung kommt aus dem Kern und wird hier nicht aus dem
    // Grundtext geraten. Bis zum 12.9.2026 stand hier eine Textsuche nach dem
    // Wort „Zitat" — und „Die Seite hat keine Abschrift." landete damit unter
    // „hast du abgewählt", während der Grund nirgends auf dem Bildschirm
    // erschien. Vier unabhängige Prüfer haben denselben Fehler gemeldet.
    const abgewaehlt = ergebnis.fragen.filter(
      (f) => !f.uebernommen && f.abgewaehlt,
    );
    const abgewiesen = ergebnis.fragen.filter(
      (f) => !f.uebernommen && !f.abgewaehlt,
    );

    return (
      <div className="space-y-6 md:max-w-3xl">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Übernommen</h1>
          <p className="text-sm text-muted">
            {ergebnis.uebernommen === 1
              ? "Eine Frage ist jetzt ein Baustein"
              : `${ergebnis.uebernommen} Fragen sind jetzt Bausteine`}{" "}
            in {ergebnis.subjectName}
            {abgewaehlt.length > 0
              ? `, ${abgewaehlt.length} hast du abgewählt`
              : ""}
            {abgewiesen.length > 0
              ? `, ${abgewiesen.length} ${abgewiesen.length === 1 ? "hat" : "haben"} die Quellbindung abgewiesen`
              : ""}
            .
          </p>
        </header>

        {/* Die Dosis, die dabei herauskam. Ohne diesen Kasten sagte der
            Bericht „12 Fragen sind jetzt Bausteine" und verschwieg, dass vor
            der Klausur kein einziger Abruf mehr passt — das Handformular sagt
            genau das nach jedem einzelnen Anlegen. */}
        {ergebnis.uebernommen > 0 && ergebnis.wenigsteAbrufe !== null ? (
          <Card
            className={
              ergebnis.wenigsteAbrufe < 4 ? "border-warning/40" : undefined
            }
          >
            <CardContent className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {ergebnis.wenigsteAbrufe === 0
                  ? "Vor der Klausur kommt keiner davon mehr dran."
                  : ergebnis.wenigsteAbrufe < 4
                    ? `Bis zur Klausur reicht es nur für ${ergebnis.wenigsteAbrufe} ${ergebnis.wenigsteAbrufe === 1 ? "Abruf" : "Abrufe"} statt der vier, die nötig wären.`
                    : `Jede übernommene Frage kommt mindestens ${ergebnis.wenigsteAbrufe} Mal vor der Klausur dran.`}
              </p>
              {ergebnis.wenigsteAbrufe < 4 ? (
                <p className="text-sm text-muted">
                  Vier Begegnungen sind die Dosis, ab der Abrufen messbar mehr
                  bringt als Wiederlesen. Dafür ist es diesmal zu spät — die
                  Fragen bleiben trotzdem im Bestand und laufen weiter.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {abgewiesen.length > 0 ? (
          <Card className="border-warning/40">
            <CardContent className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Nicht in den Bestand gekommen:
              </p>
              <ul className="space-y-2">
                {abgewiesen.map((f, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-foreground">{f.promptFree}</span>
                    <span className="block text-muted">{f.grund}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted">
                Dieselbe Prüfung gilt für eine von Hand angelegte Frage — die KI
                bekommt hier keinen kürzeren Weg. Das Zitat muss wörtlich in der
                Abschrift stehen.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/abruf">Zum Abruf</ButtonLink>
          <ButtonLink href="/abruf/eingang" variant="secondary">
            Eingang
          </ButtonLink>
        </div>
      </div>
    );
  }

  const vorschlaege = await offeneVorschlaege(user.id);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Vorschläge</h1>
        <p className="text-sm text-muted">
          {vorschlaege.length === 0
            ? "Nichts durchzusehen."
            : "Was die KI gebaut hat. Nichts davon steht im Bestand, bevor du es übernimmst."}
        </p>
      </header>

      {vorschlaege.length === 0 ? (
        <EmptyState
          title="Kein Vorschlag im Eingang"
          description="Hier liegen die Fragen, die ein Lauf über die Blätter einer Klausur gebaut hat — bis du sie durchgesehen hast. Solange keiner gelaufen ist, ist es hier leer."
          action={
            <ButtonLink href="/abruf/klausur" variant="secondary">
              Stoff einer Klausur ansehen
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-8">
          {vorschlaege.map((v) => (
            <ProposalView
              key={v.id}
              vorschlag={{
                id: v.id,
                subjectName: v.subjectName,
                subjectColorHex: subjectColor(v.subjectColor).hex,
                // Die lange Form und nicht die kurze: „Mi, 14.9." endet selbst
                // mit einem Punkt, und im Satz „…am Mi, 14.9.." stehen dann
                // zwei. Im Browser gesehen, nicht im Test.
                klausurtag: formatGerman(v.klausurtag),
                note: v.note,
                fragen: v.fragen.map((f) => ({
                  id: f.id,
                  promptFree: f.promptFree,
                  solution: f.solution,
                  misconception: f.misconception,
                  sourceQuote: f.sourceQuote,
                  blattTitel: f.blattTitel,
                  seitenNummer: f.seitenNummer,
                })),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
