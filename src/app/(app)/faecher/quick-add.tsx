"use client";

import { Fragment, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
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

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

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
    <form
      action={formAction}
      className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Oder such dir raus, was du hast
        </h2>
        <p className="text-sm text-muted">
          Antippen, fertig. Kürzel und Farbe legt die App vor, ändern kannst du
          später alles.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_SUBJECTS.map((preset) => {
          const position = selected.indexOf(preset.name);
          const isSelected = position >= 0;
          const color = isSelected
            ? SUBJECT_COLORS[position % SUBJECT_COLORS.length]
            : null;

          return (
            <button
              key={preset.name}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(preset.name)}
              style={
                color
                  ? {
                      borderColor: color.hex,
                      backgroundColor: `color-mix(in oklab, ${color.hex} 12%, var(--surface))`,
                    }
                  : undefined
              }
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-pill border px-3.5 text-sm transition-colors",
                isSelected
                  ? "font-medium text-foreground"
                  : "border-border text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              {color ? (
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: color.hex }}
                  className="size-2.5 shrink-0 rounded-full"
                />
              ) : null}
              {preset.name}
            </button>
          );
        })}
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
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <Button
        type="submit"
        loading={pending}
        disabled={selected.length === 0}
        className="w-full sm:w-auto"
      >
        {buttonLabel(selected.length)}
      </Button>
    </form>
  );
}
