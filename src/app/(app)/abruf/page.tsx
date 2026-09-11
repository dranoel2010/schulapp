import type { Metadata } from "next";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { listItems } from "@/recall/items";
import { faelligHeute, tagesbericht } from "@/recall/sessions";

import { neuPlanenAction } from "./actions";

/**
 * Der Abruf: hier wird abgefragt, nicht verwaltet.
 *
 * Die Seite beantwortet genau eine Frage — was steht heute an? — und hat
 * deshalb genau einen Knopf. Alles andere (Bausteine ansehen, neue anlegen)
 * steht darunter und kleiner.
 *
 * ── Warum hier keine Trefferquote steht ──────────────────────────────────────
 *
 * Weil sie die Kennzahl ist, die lügt. Die Quote des laufenden Abends steigt,
 * weil der Stoff frisch ist und dieselben Fragen wiederkehren — während die
 * Klausur etwas anderes misst: unter einem Tag Abstand 0,41 gegen 0,69
 * darüber. Eine Zahl, die jeden Abend gut aussieht und nichts vorhersagt, ist
 * schlimmer als keine, weil man sich auf sie verlässt. Es steht deshalb eine
 * Zählung da und kein Prozentwert.
 *
 * Der zweite Grund ist N2: keine Gamification, keine Serie, kein Rangplatz.
 * Motivation 0,22 und Verhalten 0,27, beide nicht signifikant; reiner
 * Wettbewerb -0,09 und -0,01. Und eine sichtbar gebrochene Serie senkt das
 * Weitermachen auf 45,21 gegen 60,90 Prozent ganz ohne Serienanzeige (N4) —
 * bei einem Stundenplan bis 16:50 sind Ausfalltage garantiert, es wirkte also
 * nur der schädliche Zweig.
 */

export const metadata: Metadata = {
  title: "Abruf",
};

export default async function AbrufPage() {
  const user = await requireUser();
  const heute = todayInBerlin();

  const [faellig, bericht, bausteine] = await Promise.all([
    faelligHeute(user.id, heute),
    tagesbericht(user.id, heute),
    listItems(user.id),
  ]);

  const aktive = bausteine.filter((b) => b.retiredAt === null);
  const ueberfaellig = faellig.filter((f) => f.dueOn < heute).length;

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Abruf</h1>
        <p className="mt-1 text-muted">
          {aktive.length === 0
            ? "Noch keine Bausteine — jede Frage stammt aus einer Seite deiner Blätter."
            : faellig.length === 0
              ? bericht.versuche > 0
                ? "Für heute durch. Der nächste Termin kommt von selbst."
                : "Heute ist nichts fällig."
              : `${faellig.length} ${faellig.length === 1 ? "Baustein wartet" : "Bausteine warten"}${
                  ueberfaellig > 0 ? ` — ${ueberfaellig} davon länger als heute` : ""
                }.`}
        </p>
      </header>

      {aktive.length === 0 ? (
        <EmptyState
          title="Noch nichts abzurufen"
          description="Ein Baustein ist eine Frage, ihre Musterlösung und ein Satz dazu, womit man sie verwechselt — alle drei aus einer Seite, die schon abgeschrieben ist."
          action={
            <ButtonLink href="/abruf/bausteine/neu">
              Ersten Baustein anlegen
            </ButtonLink>
          }
        />
      ) : faellig.length > 0 ? (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[...new Set(faellig.map((f) => f.subjectName))].map((name) => {
                const farbe = subjectColor(
                  faellig.find((f) => f.subjectName === name)?.subjectColor,
                );
                return (
                  <span
                    key={name}
                    className="rounded-pill px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: `color-mix(in oklab, ${farbe.hex} 12%, var(--surface))`,
                      color: farbe.hex,
                    }}
                  >
                    {name}
                    {" · "}
                    {faellig.filter((f) => f.subjectName === name).length}
                  </span>
                );
              })}
            </div>

            <ButtonLink href="/abruf/sitzung">
              {ueberfaellig > 0 ? "Weitermachen" : "Abend anfangen"}
            </ButtonLink>

            <p className="text-sm text-muted">
              Erst antworten, dann die Lösung — in dieser Reihenfolge, sonst
              lernt man das Wiedererkennen statt der Sache. Ein Baustein ist
              erst durch, wenn er einmal saß.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-foreground">
              {bericht.versuche > 0
                ? `${bericht.versuche} ${bericht.versuche === 1 ? "Versuch" : "Versuche"} über ${bericht.bausteine} ${bericht.bausteine === 1 ? "Baustein" : "Bausteine"}, davon ${bericht.richtig} auf Anhieb richtig.`
                : "Heute war nichts fällig."}
            </p>
            <p className="text-sm text-muted">
              Das ist ein Bericht über den Abend, keine Zusammenfassung des
              Stoffs — die gehört in dein Heft und nicht hierher.
            </p>
          </CardContent>
        </Card>
      )}

      {aktive.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted">Bestand</h2>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="/abruf/bausteine" variant="secondary">
              {aktive.length} {aktive.length === 1 ? "Baustein" : "Bausteine"}
            </ButtonLink>
            <ButtonLink href="/abruf/bausteine/neu" variant="secondary">
              Baustein anlegen
            </ButtonLink>
          </div>
          {/* Der Weg zurück, wenn der Kalender sich bewegt hat.
              Die Termine entstehen beim Anlegen, ein Klausurtermin danach
              nicht mehr: Wer Bausteine baut, bevor die Klausur eingetragen
              ist, hat Termine ohne Ziel — und wer eine Klausur verschiebt,
              hat welche dahinter. Erledigtes bleibt dabei stehen. */}
          <form action={neuPlanenAction}>
            <Button type="submit" variant="secondary">
              Termine neu rechnen
            </Button>
          </form>

          <p className="text-sm text-subtle">
            Heute ist der {formatGerman(heute, "lang")}. Trägst du eine Klausur
            nach oder verschiebst sie, rechne die Termine neu — sie entstehen
            beim Anlegen und wissen von der Änderung sonst nichts.
          </p>
        </section>
      ) : null}
    </div>
  );
}
