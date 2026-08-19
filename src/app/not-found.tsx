import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";

/**
 * Wird gezeigt, wenn eine Adresse ins Leere zeigt — etwa ein Fach, das es
 * nicht mehr gibt. Ohne diese Seite stünde hier Nextens englischer Standard.
 */

export const metadata: Metadata = {
  title: "Seite nicht gefunden",
};

export default function NotFound() {
  return (
    <main className="page flex flex-1 flex-col items-center justify-center py-16 text-center">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-10 text-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4.5" />
        <path d="M12 16h.01" />
      </svg>

      <h1 className="mt-5 text-xl font-semibold">Hier ist nichts</h1>

      <p className="mt-2 max-w-sm text-muted">
        Diese Seite gibt es nicht — vielleicht hast du ein Fach gelöscht, das
        noch als Lesezeichen herumliegt.
      </p>

      <ButtonLink href="/" className="mt-6">
        Zur Startseite
      </ButtonLink>
    </main>
  );
}
