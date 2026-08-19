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
        "flex flex-col items-center rounded-card border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-subtle">{icon}</div> : null}

      <p className="text-base font-medium text-foreground">{title}</p>

      {description ? (
        <p className="mt-1.5 max-w-xs text-sm text-muted">{description}</p>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
