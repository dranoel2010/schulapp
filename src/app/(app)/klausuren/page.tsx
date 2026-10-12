import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Klausuren als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Klausuren" };

export default async function Page() {
  return <DirekteSeite art="klausuren" params={{}} />;
}
