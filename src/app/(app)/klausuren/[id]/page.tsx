import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Klausur als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Klausur" };

export default async function Page({ params }: PageProps<"/klausuren/[id]">) {
  const { id } = await params;
  return <DirekteSeite art="klausur" params={{ id }} />;
}
