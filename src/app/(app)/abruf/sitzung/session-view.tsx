"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";

import {
  abendBeendenAction,
  retireItemAction,
  urteilAction,
  versuchAction,
} from "../actions";

/**
 * Der Abend: eine Frage, ein Feld, danach die Lösung.
 *
 * ── Was hier NICHT ankommt ───────────────────────────────────────────────────
 *
 * Die Musterlösung und der Satz zur Verwechslung. Sie stehen nicht in dieser
 * Datei, nicht in den Props und nicht im ausgelieferten HTML — sie kommen als
 * Rückgabewert von `versuchAction()`, nachdem geantwortet wurde. A2 verlangt
 * das („die Lösung erscheint ausnahmslos nach dem abgeschickten Versuch"), und
 * als bloße Anzeigeregel wäre es mit geöffneten Entwicklerwerkzeugen umgehbar.
 *
 * ── Was hier fehlt und fehlen soll ───────────────────────────────────────────
 *
 * Ein „Weiß nicht"-Knopf. Er wäre der kostenlose Lösungsknopf aus N11: ein
 * Tipp, und die Lösung steht da, ohne dass ein Abruf stattgefunden hätte —
 * Scheinlernen betraf 33 Prozent der Schüler. Ein leeres Feld abzuschicken ist
 * dagegen erlaubt und zählt als Versuch: „Ich weiß es nicht" ist eine Auskunft,
 * die ins Protokoll gehört.
 *
 * Ein „Überspringen" fehlt aus demselben Grund (A16): Gedeckelt werden Zeit und
 * neue Bausteine, nie fällige Wiederholungen.
 *
 * Und eine Fortschrittsanzeige „3 von 8". Sie wäre eine Zusage, die diese
 * Sitzung nicht halten kann — was danebengeht, kommt wieder, also wächst der
 * Nenner. Stattdessen steht da, wie viele noch warten.
 */

export type Frage = {
  scheduleId: string;
  itemId: string;
  promptFree: string;
  promptCue: string | null;
  dueOn: string;
  subjectName: string;
  subjectColorHex: string;
  ueberfaellig: boolean;
};

type Aufgeloest = {
  attemptId: string;
  solution: string;
  misconception: string;
};

export function SessionView({
  fragen,
  heute,
}: {
  fragen: Frage[];
  heute: string;
}) {
  const router = useRouter();
  const [warteschlange, setWarteschlange] = useState(fragen);
  const [antwort, setAntwort] = useState("");
  const [geloest, setGeloest] = useState<Aufgeloest | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();

  const aktuell = warteschlange[0];

  if (!aktuell) {
    return (
      <Card>
        <CardContent className="space-y-4">
          <p className="text-foreground">
            Für heute durch — jeder fällige Baustein saß mindestens einmal.
          </p>
          <p className="text-sm text-muted">
            Was heute danebenging, steht morgen nicht automatisch wieder da: Der
            nächste Termin ist der geplante. Das ist Absicht — nachschieben
            hieße, den ganzen Plan nach hinten zu ziehen.
          </p>
          <Button
            type="button"
            onClick={() =>
              starten(async () => {
                await abendBeendenAction();
                router.push("/abruf");
              })
            }
            loading={laeuft}
          >
            Fertig
          </Button>
        </CardContent>
      </Card>
    );
  }

  function abschicken() {
    setFehler(null);
    starten(async () => {
      const ergebnis = await versuchAction(
        aktuell.scheduleId,
        aktuell.itemId,
        antwort,
      );

      if (!ergebnis.ok) {
        setFehler(
          "Dieser Termin lässt sich nicht mehr beantworten — vielleicht ist er in einem anderen Fenster schon durch.",
        );
        setWarteschlange((liste) => liste.slice(1));
        setAntwort("");
        return;
      }

      setGeloest({
        attemptId: ergebnis.attemptId,
        solution: ergebnis.solution,
        misconception: ergebnis.misconception,
      });
    });
  }

  function urteilen(richtig: boolean) {
    if (!geloest) return;

    starten(async () => {
      const { wiederholt } = await urteilAction(geloest.attemptId, richtig);

      setWarteschlange((liste) => {
        const [erste, ...rest] = liste;
        // Was danebenging, kommt wieder — aber ans Ende. Sofort noch einmal zu
        // fragen wäre massiertes Lernen im Kleinen; innerhalb eines Abends ist
        // „ganz hinten" der größtmögliche Abstand.
        return wiederholt ? [...rest, erste] : rest;
      });
      setGeloest(null);
      setAntwort("");
    });
  }

  function melden() {
    starten(async () => {
      await retireItemAction(aktuell.itemId, "stand so nicht im Heft");
      setWarteschlange((liste) => liste.filter((f) => f.itemId !== aktuell.itemId));
      setGeloest(null);
      setAntwort("");
    });
  }

  const warten = warteschlange.length - 1;

  return (
    <div className="space-y-4">
      <Card
        style={{
          backgroundColor: `color-mix(in oklab, ${aktuell.subjectColorHex} 8%, var(--surface))`,
        }}
      >
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className="rounded-pill px-2.5 py-1 font-medium"
              style={{ color: aktuell.subjectColorHex }}
            >
              {aktuell.subjectName}
            </span>
            {aktuell.ueberfaellig ? (
              <span className="text-warning">
                seit {aktuell.dueOn} offen
              </span>
            ) : null}
          </div>

          <p className="text-lg font-medium text-foreground">
            {aktuell.promptFree}
          </p>

          {geloest === null ? (
            <>
              <Textarea
                value={antwort}
                onChange={(e) => setAntwort(e.target.value)}
                rows={5}
                placeholder="Schreib, was du weißt."
                aria-label="Deine Antwort"
                autoFocus
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={abschicken} loading={laeuft}>
                  Antwort abschicken
                </Button>
                <span className="text-sm text-subtle">
                  Auch leer abschicken zählt als Versuch.
                </span>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-control border border-border bg-surface px-3.5 py-3">
                <p className="text-xs font-medium text-muted">Deine Antwort</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {antwort.trim() === "" ? "— nichts geschrieben —" : antwort}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted">Musterlösung</p>
                <ol className="ml-4 list-decimal space-y-1 text-sm text-foreground">
                  {geloest.solution
                    .split("\n")
                    .map((zeile) => zeile.trim())
                    .filter(Boolean)
                    .map((zeile, i) => (
                      <li key={i}>{zeile}</li>
                    ))}
                </ol>
                <p className="text-sm text-muted">{geloest.misconception}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => urteilen(true)} loading={laeuft}>
                  Saß
                </Button>
                <Button
                  type="button"
                  onClick={() => urteilen(false)}
                  variant="secondary"
                  loading={laeuft}
                >
                  Daneben — noch einmal
                </Button>
              </div>

              <button
                type="button"
                onClick={melden}
                className="text-sm text-subtle underline underline-offset-2 hover:text-muted"
              >
                Stand so nicht im Heft
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {fehler ? (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {fehler}
        </p>
      ) : null}

      <p className="text-sm text-subtle">
        {warten > 0
          ? `Noch ${warten} ${warten === 1 ? "Baustein" : "Bausteine"} in der Reihe.`
          : "Letzter Baustein für heute."}{" "}
        <Link href="/abruf" className="underline underline-offset-2">
          Abbrechen
        </Link>{" "}
        — was du beantwortet hast, ist festgehalten. Stand: {heute}.
      </p>
    </div>
  );
}
