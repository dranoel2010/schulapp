import type { Metadata } from "next";

import { DirekteSeite } from "@/components/kombi/seiten/direkt";

/**
 * Die Klausurseite bei direktem Aufruf (Push-Erinnerung, Neuladen): derselbe
 * Loader und dieselbe Komponente wie im Stapel der Shell (Plan 2.1, 2.4).
 * Bearbeiten liegt unter `/klausuren/[id]/bearbeiten`.
 */

export const metadata: Metadata = { title: "Klausur" };

export default async function KlausurPage({ params }: PageProps<"/klausuren/[id]">) {
  const { id } = await params;
  return <DirekteSeite art="klausur" params={{ id }} />;
}
