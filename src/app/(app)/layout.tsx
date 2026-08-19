import { redirect } from "next/navigation";

import { AppNav } from "@/components/nav/app-nav";
import { hasAccount, requireUser } from "@/lib/auth";

/**
 * Gilt für alle Seiten in diesem Bereich: sie lesen Sitzung und Datenbank, es
 * gibt also nichts, was sich beim Bauen vorberechnen ließe. Ohne das versucht
 * `next build` es trotzdem — und bricht auf einem frisch aufgesetzten Server
 * ab, auf dem die Tabellen noch fehlen.
 */
export const dynamic = "force-dynamic";

/**
 * Alles hinter der Anmeldung. Gibt es noch gar kein Konto, führt der Weg
 * zuerst durch die Einrichtung — sonst landet man auf einer Anmeldeseite,
 * für die es kein Passwort gibt.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!(await hasAccount())) {
    redirect("/setup");
  }

  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <AppNav userName={user.name} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 pt-safe backdrop-blur md:hidden">
          <div className="page flex h-14 items-center">
            <span className="text-[0.9375rem] font-semibold tracking-tight">
              Schulapp
            </span>
          </div>
        </header>

        {/* Unten Platz für die feste Leiste am Handy. */}
        <main className="page flex-1 pb-28 pt-6 md:pb-12 md:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
