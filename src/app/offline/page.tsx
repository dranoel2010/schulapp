import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Keine Verbindung",
};

export default function OfflinePage() {
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
        <path d="M3 3l18 18" />
        <path d="M8.5 16.5a5 5 0 0 1 7 0" />
        <path d="M5 13a10 10 0 0 1 3.5-2.3" />
        <path d="M15.5 10.7A10 10 0 0 1 19 13" />
        <path d="M2 9a16 16 0 0 1 5-3.2" />
        <path d="M11 5.1A16 16 0 0 1 22 9" />
        <path d="M12 20h.01" />
      </svg>

      <h1 className="mt-5 text-xl font-semibold">Keine Verbindung</h1>

      <p className="mt-2 max-w-sm text-muted">
        Dein Gerät ist gerade offline. Was du vorher schon geöffnet hattest,
        kannst du weiter lesen — neue Seiten und Änderungen brauchen Netz.
      </p>

      <ButtonLink href="/" className="mt-6">
        Nochmal versuchen
      </ButtonLink>
    </main>
  );
}
