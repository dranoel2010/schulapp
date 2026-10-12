import { redirect } from "next/navigation";

import { KombiShell } from "@/components/kombi/shell";
import { hasAccount, requireUser } from "@/lib/auth";

/**
 * Gilt für alle Seiten in diesem Bereich: sie lesen Sitzung und Datenbank, es
 * gibt also nichts, was sich beim Bauen vorberechnen ließe. Ohne das versucht
 * `next build` es trotzdem — und bricht auf einem frisch aufgesetzten Server
 * ab, auf dem die Tabellen noch fehlen.
 */
export const dynamic = "force-dynamic";

/**
 * Alles hinter der Anmeldung, in der Shell von Modell 23 (Plan 2.1, A):
 * keine Seitenleiste, keine obere Leiste — Startseite, Zeile, Stapel. Das
 * Layout lädt nur Sitzung und Nutzer; die Daten der Startseite holt die
 * Shell selbst (Plan 2.4, Punkt 1). Jede Route dieses Bereichs, die nicht `/`
 * ist, legt die Shell als oberste Ebene über die Startseite.
 *
 * Gibt es noch gar kein Konto, führt der Weg zuerst durch die Einrichtung.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!(await hasAccount())) {
    redirect("/setup");
  }

  await requireUser();

  return <KombiShell>{children}</KombiShell>;
}
