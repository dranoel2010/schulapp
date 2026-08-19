import type { ComponentProps } from "react";

/**
 * Karte — die Standardfläche für alles Inhaltliche.
 *
 *   <Card>
 *     <CardHeader>
 *       <CardTitle>Mathe</CardTitle>
 *       <ButtonLink href="…" variant="ghost" size="md">Ändern</ButtonLink>
 *     </CardHeader>
 *     <CardContent>…</CardContent>
 *   </Card>
 *
 * Card bringt das Polster mit, die Unterteile kümmern sich nur um die
 * Anordnung. CardHeader stellt Titel und Aktion nebeneinander.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface p-4 sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

/** Titelzeile: Überschrift links, optional eine Aktion rechts. */
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-3 flex items-start justify-between gap-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("text-base font-semibold leading-snug text-foreground", className)}
      {...props}
    />
  );
}

/** Ein Satz unter dem Titel. */
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}

/** Inhalt mit ruhigem Zeilenabstand zwischen den Kindern. */
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("space-y-3", className)} {...props} />;
}
