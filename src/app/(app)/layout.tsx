import { redirect } from "next/navigation";

import { AppNav, MobileTopBar, PageBody } from "@/components/nav/app-nav";
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
    <div className="flex min-h-dvh flex-1">
      <a href="#main-content" className="skip-link">Zum Inhalt springen</a>
      <AppNav userName={user.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main id="main-content" tabIndex={-1} className="app-main">
          <PageBody>{children}</PageBody>
        </main>
      </div>
    </div>
  );
}
