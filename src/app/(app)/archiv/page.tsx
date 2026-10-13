import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Das Archiv als Nachschlage-Seite (Antwort 11): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Archiv" };

export default async function Page() {
  return <DirekteSeite art="archiv" params={{}} />;
}
