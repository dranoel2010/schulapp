import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Noten als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Noten" };

export default async function Page({ params }: PageProps<"/noten/fach/[id]">) {
  const { id } = await params;
  return <DirekteSeite art="notenfach" params={{ id }} />;
}
