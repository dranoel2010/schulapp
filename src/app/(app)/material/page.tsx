import type { Metadata } from "next";

import { DirekteSeite, einfach } from "@/components/kombi/seiten/direkt";

/**
 * Ablage als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Ablage" };

export default async function Page({ searchParams }: PageProps<"/material">) {
  return <DirekteSeite art="ablage" params={einfach(await searchParams, ["fach", "thema"])} />;
}
