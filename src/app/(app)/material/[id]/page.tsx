import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Blatt als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Blatt" };

export default async function Page({ params }: PageProps<"/material/[id]">) {
  const { id } = await params;
  return <DirekteSeite art="blatt" params={{ id }} />;
}
