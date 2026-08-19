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
    <div className="flex flex-1 flex-col md:flex-row">
      <AppNav userName={user.name} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Nur am Handy: der Weg zurück zum Kachelmenü. Ab md steht der Name
            der App in der Seitenspalte, und die Seiten bringen ihre eigene
            Überschrift mit. Auf der Startseite zeigt die Zeile nichts. */}
        <MobileTopBar />

        {/* Am Handy randlos und ohne Platz für eine Leiste unten — die gibt es
            nicht mehr; pb-safe hält nur noch die Gestenleiste frei. Die
            seitlichen Ränder setzt PageBody, damit die Startseite ohne
            auskommt. Ab md die volle Breite neben der Seitenspalte — das
            Dashboard braucht sie für sein Raster, min-w-0 hält die Spalten
            darin im Rahmen. */}
        <main className="mx-auto flex w-full min-w-0 max-w-xl flex-1 flex-col max-md:pb-safe md:mx-0 md:max-w-none md:min-h-dvh md:px-[26px] md:py-6">
          <PageBody>{children}</PageBody>
        </main>
      </div>
    </div>
  );
}
