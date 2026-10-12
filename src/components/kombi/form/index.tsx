import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import "./form.css";

/**
 * Die Formular-Bausteine der Unterseiten von Modell 23 (Plan 2.1, 2.3).
 *
 * Der Prototyp kennt keine Formularfelder. Sie bekommen deshalb genau die
 * Maße der Zeile: Höhe 52, Radius 12, Fläche `--raise`, Schrift 17/450,
 * Label 15/560 in `--ink-2`, Fokus `outline 2px var(--accent)` (aus den
 * Grundwerten in globals.css). Knöpfe sind die Knöpfe des Prototyps: `.btn`
 * (52px, Pille) als Primär- und leiser Knopf, `.textbtn` als Textknopf.
 *
 * Die Namen und Props sind dieselben wie die der alten Bausteine unter
 * `src/components/ui/`, damit die bestehenden Formulare ihre Logik behalten
 * und nur das Aussehen wechseln.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ── Knöpfe ─────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

/** `.btn primary` / `.btn quiet` aus dem Prototyp, `.textbtn` für leise Wege. */
function knopfKlassen(variant: Variant, className?: string) {
  switch (variant) {
    case "primary":
      return cn("btn primary kf-btn", className);
    case "secondary":
      return cn("btn quiet kf-btn", className);
    case "danger":
      return cn("btn kf-btn kf-danger", className);
    case "ghost":
      return cn("textbtn", className);
  }
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  /** Sperrt den Knopf, solange gespeichert wird. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  // `size` gibt es nicht mehr: jeder Knopf ist 52px hoch wie im Prototyp.
  const { size, ...props } = rest;
  void size;
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={knopfKlassen(variant, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

/** Sieht aus wie ein Knopf, ist aber ein Link. */
export function ButtonLink({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const { size, ...props } = rest;
  void size;
  return (
    <Link className={knopfKlassen(variant, className)} {...props}>
      {children}
    </Link>
  );
}

// ── Felder ─────────────────────────────────────────────────────────────────

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

export type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/** Label 15/560 in `--ink-2` über dem Feld, Hinweis und Fehler darunter. */
export function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("kf-feld", className)}>
      <label htmlFor={id} className="kf-label">
        {label}
        {optional ? <span className="kf-opt"> optional</span> : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {hint ? (
        <p id={hintId} className="kf-hint">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="kf-fehler">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return <input className={cn("kf-input", className)} {...props} />;
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return <textarea rows={rows} className={cn("kf-input kf-area", className)} {...props} />;
}

export type SelectProps = ComponentProps<"select">;

/** Natives `<select>`: die Auswahlliste zeichnet Android selbst. */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <span className="kf-select">
      <select className={cn("kf-input", className)} {...props}>
        {children}
      </select>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9.5l6 6 6-6" />
      </svg>
    </span>
  );
}

// ── Abschnitte ─────────────────────────────────────────────────────────────

/**
 * Was früher eine Karte war, ist jetzt ein Abschnitt auf dem Papier: keine
 * Fläche, kein Rand, eine Überschrift im Stil `.p-lab`.
 */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("kf-abschnitt", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("kf-kopf", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("p-lab kf-titel", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("p-sub", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("kf-inhalt", className)} {...props} />;
}

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

/** Leerzustand in der Gestalt `.empty` des Prototyps, darunter der nächste Schritt. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("kf-leer", className)}>
      <p className="empty">{title}</p>
      {description ? <p className="p-sub">{description}</p> : null}
      {action ? <div className="kf-leer-akt">{action}</div> : null}
    </div>
  );
}

// ── Seitenkopf der Formular-Unterseiten ────────────────────────────────────

/** Titel 22/650 und Untertitel wie `pageShell` (Prototyp Z. 2995). */
export function SeitenKopf({ titel, sub }: { titel: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <h2 className="p-title">{titel}</h2>
      {sub ? <p className="p-sub">{sub}</p> : null}
    </>
  );
}
