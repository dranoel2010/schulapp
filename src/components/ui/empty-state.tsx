import type { ReactNode } from "react";

/**
 * Wird gezeigt, wenn eine Liste noch leer ist. Sagt, was fehlt, und bietet
 * gleich den nächsten Schritt an.
 *
 *   <EmptyState
 *     title="Noch keine Fächer"
 *     description="Leg deine Fächer an, dann kannst du später Klausuren und Noten dazu eintragen."
 *     action={<ButtonLink href="/faecher/neu">Erstes Fach anlegen</ButtonLink>}
 *   />
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type EmptyStateProps = {
  title: string;
  description?: string;
  /** Platz für einen Knopf oder Link. */
  action?: ReactNode;
  /** Schlankes Inline-SVG, wenn es die Stelle verträgt. */
  icon?: ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-card border border-border bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div> : null}

      <p className="text-lg font-semibold text-foreground">{title}</p>

      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
