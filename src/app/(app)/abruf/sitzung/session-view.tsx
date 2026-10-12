"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/kombi/form";
import { formatGerman } from "@/lib/dates";
import { Card, CardContent } from "@/components/kombi/form";
import { Textarea } from "@/components/kombi/form";

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
  sourceQuote: string;
  materialId: string | null;
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
          <p className="text-ink">
            Für heute durch — jeder fällige Baustein saß mindestens einmal.
          </p>
          <p className="text-[15px] text-ink-2">
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
        sourceQuote: ergebnis.sourceQuote,
        materialId: ergebnis.materialId,
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
      >
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span
              className="rounded-full px-2.5 py-1 font-[560]"
              style={{ color: aktuell.subjectColorHex }}
            >
              {aktuell.subjectName}
            </span>
            {aktuell.ueberfaellig ? (
              <span className="text-ink">
                {/* Auf Deutsch und nicht als „2026-09-09": Diese Zeile liest
                    ein Schüler, und die App schreibt Datumsangaben überall
                    sonst mit `formatGerman()`. */}
                seit {formatGerman(aktuell.dueOn, "kurz")} offen
              </span>
            ) : null}
          </div>

          <p className="text-lg font-[560] text-ink">
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
                <span className="text-[15px] text-ink-3">
                  Auch leer abschicken zählt als Versuch.
                </span>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-sub">
                <p className="text-[13px] font-[560] text-ink-2">Deine Antwort</p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] text-ink">
                  {antwort.trim() === "" ? "— nichts geschrieben —" : antwort}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[13px] font-[560] text-ink-2">Musterlösung</p>
                <ol className="ml-4 list-decimal space-y-1 text-[15px] text-ink">
                  {geloest.solution
                    .split("\n")
                    .map((zeile) => zeile.trim())
                    .filter(Boolean)
                    .map((zeile, i) => (
                      <li key={i}>{zeile}</li>
                    ))}
                </ol>
                <p className="text-[15px] text-ink-2">{geloest.misconception}</p>
              </div>

              {/* Der Rückweg zur Quelle (A5). Erst hier, weil das Zitat der
                  Wortlaut ist, aus dem die Antwort stammt — vorher gezeigt
                  wäre es die Lösung mit Umweg. Und ohne ihn müsste der
                  Meldeknopf darunter blind gedrückt werden. */}
              <details className="p-sub">
                <summary className="cursor-pointer text-[13px] font-[560] text-ink-2">
                  Das stand im Heft
                </summary>
                <p className="mt-2 text-[15px] whitespace-pre-wrap text-ink">
                  {geloest.sourceQuote}
                </p>
                {geloest.materialId ? (
                  <Link
                    href={`/material/${geloest.materialId}`}
                    className="mt-2 inline-block text-[13px] text-ink-2 underline underline-offset-2"
                  >
                    Blatt ansehen
                  </Link>
                ) : null}
              </details>

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
                className="text-[15px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
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
          className="kf-fehler"
        >
          {fehler}
        </p>
      ) : null}

      <p className="text-[15px] text-ink-3">
        {warten > 0
          ? `Noch ${warten} ${warten === 1 ? "Baustein" : "Bausteine"} in der Reihe.`
          : "Letzter Baustein für heute."}{" "}
        <Link href="/abruf" className="underline underline-offset-2">
          Abbrechen
        </Link>{" "}
        — was du beantwortet hast, ist festgehalten. Stand:{" "}
        {formatGerman(heute, "kurz")}.
      </p>
    </div>
  );
}
