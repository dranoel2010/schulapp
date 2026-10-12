"use client";

import { Fragment, useActionState, useState } from "react";

import { Button } from "@/components/kombi/form";
import { FertigBeiErfolg } from "@/components/kombi/form/fertig";
import { SUBJECT_COLORS } from "@/lib/colors";
import type { SubjectFormState } from "@/lib/subjects";

/**
 * Schnellauswahl für den allerersten Start. Antippen sammelt Fächer, ein Knopf
 * legt alle auf einmal an. Die Farbe vergibt die Reihenfolge der Auswahl —
 * dadurch bekommt jedes Fach eine andere und man erkennt sie später im
 * Stundenplan auseinander.
 */

const EMPTY_STATE: SubjectFormState = {};

const QUICK_SUBJECTS = [
  { name: "Mathematik", short: "Ma" },
  { name: "Deutsch", short: "De" },
  { name: "Englisch", short: "En" },
  { name: "Biologie", short: "Bio" },
  { name: "Chemie", short: "Ch" },
  { name: "Physik", short: "Ph" },
  { name: "Geschichte", short: "Ge" },
  { name: "Erdkunde", short: "Ek" },
  { name: "Politik/Wirtschaft", short: "PW" },
  { name: "Informatik", short: "Inf" },
  { name: "Sport", short: "Sp" },
  { name: "Kunst", short: "Ku" },
  { name: "Musik", short: "Mu" },
  { name: "Religion", short: "Rel" },
  { name: "Ethik", short: "Eth" },
  { name: "Französisch", short: "Fr" },
  { name: "Latein", short: "La" },
  { name: "Spanisch", short: "Spa" },
] as const;


function buttonLabel(count: number): string {
  if (count === 0) return "Fächer anlegen";
  if (count === 1) return "1 Fach anlegen";
  return `${count} Fächer anlegen`;
}

export type QuickAddProps = {
  action: (
    state: SubjectFormState,
    formData: FormData,
  ) => Promise<SubjectFormState>;
};

export function QuickAdd({ action }: QuickAddProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  // Reihenfolge zählt: sie entscheidet, welche Farbe ein Fach bekommt.
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(name: string) {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name],
    );
  }

  return (
    <form action={formAction}>
      <FertigBeiErfolg marke={state.fertig} toast="Fächer angelegt" />
      <h3 className="p-lab">Oder such dir raus, was du hast</h3>
      <p className="p-sub">Antippen, fertig. Kürzel und Farbe legt die App vor, ändern kannst du später alles.</p>

      <div className="refile">
        {QUICK_SUBJECTS.map((preset) => (
          <button
            key={preset.name}
            className="fp"
            type="button"
            aria-pressed={selected.includes(preset.name)}
            onClick={() => toggle(preset.name)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {selected.map((name, index) => {
        const preset = QUICK_SUBJECTS.find((entry) => entry.name === name);
        if (!preset) return null;

        const color = SUBJECT_COLORS[index % SUBJECT_COLORS.length];

        return (
          <Fragment key={name}>
            <input type="hidden" name="name" value={preset.name} />
            <input type="hidden" name="short" value={preset.short} />
            <input type="hidden" name="color" value={color.key} />
          </Fragment>
        );
      })}

      {state.message ? (
        <p role="alert" className="kf-fehler">
          {state.message}
        </p>
      ) : null}

      <div className="foot">
        <Button type="submit" loading={pending} disabled={selected.length === 0}>
          {buttonLabel(selected.length)}
        </Button>
      </div>
    </form>
  );
}
