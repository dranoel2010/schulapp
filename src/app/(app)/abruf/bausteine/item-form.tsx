"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/kombi/form";
import { MATERIALARTEN, MATERIALART_NAMEN } from "@/recall/arten";
import { Field } from "@/components/kombi/form";
import { Input, Select, Textarea } from "@/components/kombi/form";
import { splitTranscript } from "@/lib/transcripts";

import type { BausteinFormState } from "../actions";

/**
 * Einen Baustein von Hand anlegen.
 *
 * ── Warum von Hand, wo ein Agent das auch könnte ─────────────────────────────
 *
 * Weil es im Repo als Regel steht: alles, was die App später von selbst kann,
 * muss vorher von Hand gehen. Der Agent kommt in Stufe 1b und geht dann durch
 * dieselbe Tür (`createItem()`) wie dieses Formular — nicht durch eine zweite,
 * die jemand vergessen hat gleich streng zu machen.
 *
 * ── Warum die Abschrift danebensteht ─────────────────────────────────────────
 *
 * Weil A5 verlangt, dass die Frage aus dem Heft stammt, und weil das Zitat
 * wörtlich in der Abschrift stehen muss — sonst weist `createItem()` ab. Die
 * Stelle herauszukopieren ist deshalb der schnellste Weg, und die ⟨spitzen
 * Klammern⟩ bleiben dabei sichtbar: Sie markieren, was schon beim Abschreiben
 * unsicher war, und genau darauf darf keine Frage gebaut werden.
 *
 * ── Warum jedes Feld in `useState` liegt ─────────────────────────────────────
 *
 * Weil React die Felder sonst nach JEDER Aktion leert — auch nach einer
 * abgelehnten. Das ist kein Versehen von React, sondern dokumentiertes
 * Verhalten von `useActionState`: Unkontrollierte Felder werden nach dem
 * Absenden zurückgesetzt.
 *
 * Beim ersten Durchklicken am 12.9.2026 sah das so aus: vier Felder ausgefüllt,
 * abgeschickt, die Quellbindung wies das Zitat zurecht ab — und darunter stand
 * ein leeres Formular. Die Meldung erklärte geduldig, welche Stelle besser
 * gewählt wäre, aber die Frage, die Musterlösung und der Verwechslungssatz
 * waren weg. Ein Formular, das Arbeit verschluckt, wird zweimal benutzt und
 * danach nicht mehr.
 *
 * Die anderen Formulare des Hauses halten ihre Werte aus demselben Grund in
 * `useState` (siehe hausaufgaben/homework-form.tsx, klausuren/exam-form.tsx).
 */

const EMPTY_STATE: BausteinFormState = {};

export type SeitenWahl = {
  pageId: string;
  sortOrder: number;
  transcript: string;
};

export function ItemForm({
  action,
  subjectId,
  seiten,
  zurueckHref,
}: {
  action: (
    state: BausteinFormState,
    formData: FormData,
  ) => Promise<BausteinFormState>;
  subjectId: string;
  seiten: SeitenWahl[];
  zurueckHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  const [pageId, setPageId] = useState(seiten[0]?.pageId ?? "");
  const [sourceQuote, setSourceQuote] = useState("");
  const [promptFree, setPromptFree] = useState("");
  const [solution, setSolution] = useState("");
  const [misconception, setMisconception] = useState("");
  const [materialKind, setMaterialKind] = useState("begriff");
  const [role, setRole] = useState("uebung");

  /**
   * Bei jedem NEUEN Zustand die Felder angleichen.
   *
   * ── Warum nicht einfach `useState(state.werte?.…)` ───────────────────────────
   *
   * Weil die Reihenfolge dagegen spricht, und das war am 12.9.2026 im Browser
   * nur durch Hinsehen zu finden: Beim Abschicken wird dieses Formular NEU
   * AUFGEBAUT, und es wird mit einem LEEREN Zustand aufgebaut — das Ergebnis
   * der Aktion trifft erst danach ein. Die Anfangswerte von `useState` sind zu
   * diesem Zeitpunkt längst gelaufen. Gemessen sah das so aus: Die
   * Fehlermeldung stand da, die vier Felder darunter waren leer.
   *
   * Deshalb wird hier auf die IDENTITÄT des Zustands geschaut. `useActionState`
   * liefert bei jedem Lauf ein neues Objekt; sobald ein anderes ankommt als das
   * zuletzt gesehene, werden die Felder daraus gesetzt. Das greift auf beiden
   * Wegen — ob die Komponente neu aufgebaut wurde oder bloß neu gerendert.
   *
   * Angeglichen beim Rendern und nicht in einem Effekt: So sieht der Nutzer
   * nichts aufblitzen, und die Lint-Regel react-hooks/set-state-in-effect
   * verbietet die Effekt-Fassung ohnehin.
   */
  const [gesehenerZustand, setGesehenerZustand] =
    useState<BausteinFormState>(state);

  if (state !== gesehenerZustand) {
    setGesehenerZustand(state);

    if (state.werte) {
      // Ein Fehler: alles kommt zurück, wie es dastand.
      setPageId(state.werte.pageId || (seiten[0]?.pageId ?? ""));
      setSourceQuote(state.werte.sourceQuote);
      setPromptFree(state.werte.promptFree);
      setSolution(state.werte.solution);
      setMisconception(state.werte.misconception);
      setMaterialKind(state.werte.materialKind);
      setRole(state.werte.role);
    } else if (state.angelegt) {
      // Angelegt: die vier Textfelder leeren, Seite, Art und Wofür bleiben —
      // der nächste Baustein kommt meistens aus derselben Stelle.
      setSourceQuote("");
      setPromptFree("");
      setSolution("");
      setMisconception("");
    }
  }

  const seite = seiten.find((s) => s.pageId === pageId) ?? seiten[0];
  const teile = seite ? splitTranscript(seite.transcript) : [];

  return (
    <form action={formAction} className="kf-form" noValidate>
      {state.message ? (
        <p
          role="alert"
          className={
            state.angelegt
              ? "rounded-[12px] border border-line bg-raise px-3.5 py-3 text-[15px] text-ink-2"
              : "rounded-[12px] border border-error bg-raise px-3.5 py-3 text-[15px] text-error"
          }
        >
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="subjectId" value={subjectId} />

      <Field
        id="pageId"
        label="Seite"
        hint="Die Seite, aus der die Frage stammt. Nur Seiten mit Abschrift stehen hier."
        error={state.errors?.pageId}
      >
        {(control) => (
          <Select
            {...control}
            name="pageId"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
          >
            {seiten.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                Seite {s.sortOrder + 1}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {seite ? (
        <div className="space-y-1.5">
          <p className="text-[15px] font-[560] text-ink">Was dasteht</p>
          <div className="p-sub">
            {teile.map((teil, i) =>
              teil.uncertain ? (
                <mark
                  key={i}
                  className="rounded-sm bg-raise px-0.5 text-ink"
                  title="Beim Abschreiben unsicher. Darauf lässt sich keine Frage bauen."
                >
                  {teil.text}
                </mark>
              ) : (
                <span key={i}>{teil.text}</span>
              ),
            )}
          </div>
          <p className="text-[13px] text-ink-3">
            Hervorgehobenes war beim Abschreiben unsicher. Ein Zitat daraus
            wird abgewiesen.
          </p>
        </div>
      ) : null}

      <Field
        id="sourceQuote"
        label="Zitat"
        hint="Die Stelle wörtlich aus dem Text oben."
        error={state.errors?.sourceQuote}
      >
        {(control) => (
          <Textarea
            {...control}
            name="sourceQuote"
            rows={3}
            value={sourceQuote}
            onChange={(e) => setSourceQuote(e.target.value)}
          />
        )}
      </Field>

      <Field
        id="promptFree"
        label="Frage"
        hint="Offen gestellt, so wie in der Klausur."
        error={state.errors?.promptFree}
      >
        {(control) => (
          <Input
            {...control}
            name="promptFree"
            value={promptFree}
            onChange={(e) => setPromptFree(e.target.value)}
          />
        )}
      </Field>

      <Field
        id="solution"
        label="Musterlösung"
        hint="Eine Sinneinheit je Zeile. Was in eigenen Worten dastehen muss, damit es zählt."
        error={state.errors?.solution}
      >
        {(control) => (
          <Textarea
            {...control}
            name="solution"
            rows={4}
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
          />
        )}
      </Field>

      <Field
        id="misconception"
        label="Womit man das verwechselt"
        hint="Ein bis zwei Sätze. Ohne sie wird der Baustein nicht gezeigt."
        error={state.errors?.misconception}
      >
        {(control) => (
          <Textarea
            {...control}
            name="misconception"
            rows={2}
            value={misconception}
            onChange={(e) => setMisconception(e.target.value)}
          />
        )}
      </Field>

      <Field
        id="materialKind"
        label="Art"
        hint="Entscheidet, was beim Üben gemischt wird."
        error={state.errors?.materialKind}
      >
        {(control) => (
          <Select
            {...control}
            name="materialKind"
            value={materialKind}
            onChange={(e) => setMaterialKind(e.target.value)}
          >
            {MATERIALARTEN.map((art) => (
              <option key={art} value={art}>
                {MATERIALART_NAMEN[art].lang}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="role"
        label="Wofür"
        hint="Fragen nur zum Prüfen werden nie geübt. Nur so lässt sich später messen, ob das Üben etwas gebracht hat."
        error={state.errors?.role}
      >
        {(control) => (
          <Select
            {...control}
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="uebung">Zum Üben</option>
            <option value="messung">
              Nur zum Prüfen, nie üben
            </option>
          </Select>
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Baustein anlegen
        </Button>
        <Link
          href={zurueckHref}
          className="text-[15px] text-ink-2 underline underline-offset-2"
        >
          Zurück
        </Link>
      </div>
    </form>
  );
}
