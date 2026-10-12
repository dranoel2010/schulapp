import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Einstellungen als Nachschlage-Seite (Plan 2.2). Was bisher als eine lange
 * Seite dastand, liegt jetzt in Unterseiten unter /einstellungen/…; diese
 * Seite führt zu ihnen.
 */

export const metadata: Metadata = { title: "Einstellungen" };

export default async function Page() {
  return <DirekteSeite art="einstellungen" params={{}} />;
}
