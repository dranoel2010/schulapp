"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import {
  vorschlagUebernehmenAction,
  vorschlagVerwerfenAction,
} from "../actions";

/**
 * Ein Vorschlag des Agenten, zum Durchsehen.
 *
 * ── Warum hier alles beieinandersteht ────────────────────────────────────────
 *
 * Frage, Musterlösung, Verwechslungssatz UND das Zitat aus dem Heft — jede
 * Frage vollständig. Ohne das Zitat wäre die Entscheidung nicht zu treffen,
 * sondern nur zu fordern: Eine erfundene Musterlösung erkennt man nicht an der
 * Frage, sondern daran, dass sie nicht zum Wortlaut passt.
 *
 * Der Code prüft, dass das Zitat wörtlich in der Abschrift steht. Ob die Frage
 * fachlich taugt, kann er nicht prüfen — das ist der Grund, warum diese Liste
 * überhaupt existiert und nicht direkt in den Bestand geschrieben wird.
 *
 * ── Vorausgewählt ist alles ──────────────────────────────────────────────────
 *
 * Der häufige Fall ist „passt", nicht „passt nicht". Wer alles einzeln
 * anhaken müsste, klickt bei fünfzehn Fragen fünfzehn Mal für das, was ohnehin
 * gilt. Abwählen ist der seltene Fall und kostet deshalb den Klick.
 */

export type Frage = {
  id: string;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  blattTitel: string;
  seitenNummer: number;
};

export type Vorschlag = {
  id: string;
  subjectName: string;
  subjectColorHex: string;
  klausurtag: string;
  note: string | null;
  fragen: Frage[];
};

export function ProposalView({ vorschlag }: { vorschlag: Vorschlag }) {
  const router = useRouter();
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(
    () => new Set(vorschlag.fragen.map((f) => f.id)),
  );
  const [laeuft, starten] = useTransition();

  function umschalten(id: string) {
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  function uebernehmen() {
    starten(async () => {
      const ergebnis = await vorschlagUebernehmenAction(vorschlag.id, [
        ...gewaehlt,
      ]);

      // Der Bericht wird NICHT hier gesetzt, sondern auf der Seite gelesen.
      //
      // Am 12.9.2026 dreimal im Browser gemessen: Jedes revalidatePath() in
      // einer Server Action frischt die offene Route mit auf und ersetzt dabei
      // diese Komponente — samt jedem Zustand, den sie gerade gesetzt hat.
      // Sichtbar blieb „Kein Vorschlag im Eingang", unsichtbar wurde, dass die
      // Quellbindung eine Frage abgewiesen hat. Deshalb steht das Ergebnis
      // hinter einer Adresse: Es überlebt damit auch ein Neuladen, und die
      // Gründe kommen aus der Datenbank, wo sie ohnehin liegen.
      if (!ergebnis) {
        router.push("/abruf/eingang");
        return;
      }
      router.push(`/abruf/eingang?erledigt=${vorschlag.id}`);
    });
  }

  const alle = vorschlag.fragen.length;

  return (
    <div className="space-y-4">
      <Card
        style={{
          backgroundColor: `color-mix(in oklab, ${vorschlag.subjectColorHex} 7%, var(--surface))`,
        }}
      >
        <CardContent className="space-y-1">
          <p className="text-foreground">
            {alle} {alle === 1 ? "Frage" : "Fragen"} für{" "}
            <span style={{ color: vorschlag.subjectColorHex }}>
              {vorschlag.subjectName}
            </span>{" "}
            am {vorschlag.klausurtag}.
          </p>
          {vorschlag.note ? (
            <p className="text-sm text-muted">{vorschlag.note}</p>
          ) : null}
        </CardContent>
      </Card>

      <ul className="space-y-3">
        {vorschlag.fragen.map((frage) => {
          const an = gewaehlt.has(frage.id);
          return (
            <li key={frage.id}>
              <Card className={an ? undefined : "opacity-50"}>
                <CardContent className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={an}
                      onChange={() => umschalten(frage.id)}
                      className="mt-1 size-4 shrink-0 accent-accent"
                    />
                    <span className="font-medium text-foreground">
                      {frage.promptFree}
                    </span>
                  </label>

                  <ol className="ml-7 list-decimal space-y-0.5 text-sm text-foreground">
                    {frage.solution
                      .split("\n")
                      .map((z) => z.trim())
                      .filter(Boolean)
                      .map((z, i) => (
                        <li key={i}>{z}</li>
                      ))}
                  </ol>

                  <p className="ml-7 text-sm text-muted">
                    {frage.misconception}
                  </p>

                  <div className="ml-7 rounded-control border border-border bg-surface-muted px-3 py-2">
                    <p className="text-xs text-subtle">
                      {frage.blattTitel} · Seite {frage.seitenNummer}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
                      {frage.sourceQuote}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={uebernehmen} loading={laeuft}>
          {gewaehlt.size === alle
            ? `Alle ${alle} übernehmen`
            : `${gewaehlt.size} von ${alle} übernehmen`}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={laeuft}
          onClick={() =>
            starten(async () => {
              await vorschlagVerwerfenAction(vorschlag.id);
              router.refresh();
            })
          }
        >
          Alles verwerfen
        </Button>
      </div>
    </div>
  );
}
