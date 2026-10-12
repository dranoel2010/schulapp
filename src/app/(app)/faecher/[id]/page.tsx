import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Fach als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Fach" };

export default async function Page({ params }: PageProps<"/faecher/[id]">) {
  const { id } = await params;
  return <DirekteSeite art="fach" params={{ id }} />;
}
