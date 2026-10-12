"use client";

import { Button, ButtonLink } from "@/components/ui/button";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section role="alert" className="rounded-card border border-border bg-surface p-6 sm:p-10">
      <p className="eyebrow">Kurz unterbrochen</p>
      <h1 className="page-heading mt-3">Diese Seite konnte nicht geladen werden.</h1>
      <p className="page-description">Versuche es noch einmal. Falls du gerade etwas gespeichert hast, prüfe danach, ob der Eintrag angekommen ist.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => retry()}>Erneut versuchen</Button>
        <ButtonLink href="/" variant="secondary">Zur Übersicht</ButtonLink>
      </div>
    </section>
  );
}
