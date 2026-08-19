import type { ComponentProps } from "react";

/**
 * Eingabefelder. Schriftgröße bewusst 16px (text-base) — kleiner zoomt
 * Android beim Antippen hinein. Höhe mindestens 44px.
 *
 * Der Fokusring kommt global aus globals.css, hier steht nur die Ruhelage.
 * Bei aria-invalid="true" färbt sich der Rahmen rot; das setzt <Field> von
 * selbst, sobald ein Fehler übergeben wird.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const CONTROL =
  "block w-full rounded-control border border-border bg-surface text-base text-foreground " +
  "placeholder:text-subtle transition-colors hover:border-border-strong " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 " +
  "aria-[invalid=true]:border-danger";

export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input className={cn(CONTROL, "min-h-11 px-3.5 py-2.5", className)} {...props} />
  );
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(CONTROL, "min-h-24 resize-y px-3.5 py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export type SelectProps = ComponentProps<"select">;

/**
 * Natives <select> — nur umgestylt. Die Auswahlliste zeichnet das
 * Betriebssystem, das fühlt sich auf dem Handy am besten an.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <span className="relative block">
      <select
        className={cn(
          CONTROL,
          "min-h-11 cursor-pointer appearance-none py-2.5 pl-3.5 pr-10",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle"
      >
        <path
          d="m6 9 6 6 6-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
