import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Knöpfe. Alles mindestens 44px hoch, damit man sie unterwegs mit dem
 * Daumen trifft.
 *
 *   <Button type="submit" loading={pending}>Speichern</Button>
 *   <ButtonLink href="/faecher/neu" variant="secondary">Fach anlegen</ButtonLink>
 *
 * className kommt zum Schluss dazu und ist für Layout gedacht (w-full, mt-4).
 * Farben überschreibt man besser über variant, nicht über className.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-control font-medium leading-none " +
  "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-55 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-55";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-muted hover:border-border-strong",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  danger: "bg-danger text-danger-foreground hover:bg-danger-hover",
};

const SIZES: Record<Size, string> = {
  md: "min-h-11 px-4 text-[0.9375rem]",
  lg: "min-h-12 px-5 text-base",
};

function classesFor(variant: Variant, size: Size, className?: string) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

/** Kleiner Kreisel für den Ladezustand. */
function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0 animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  /** Zeigt einen Kreisel und sperrt den Knopf, solange gespeichert wird. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      // type absichtlich nicht vorbelegt: in einem Formular soll der Knopf
      // wie gewohnt abschicken.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classesFor(variant, size, className)}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

/** Sieht aus wie ein Button, ist aber ein Link. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={classesFor(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
