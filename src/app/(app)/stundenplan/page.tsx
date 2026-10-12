import type { Metadata } from "next";

import { DirekteSeite, einfach } from "@/components/kombi/seiten/direkt";

/**
 * Woche als Nachschlage-Seite (Plan 2.2): der direkte Aufruf rendert
 * dieselbe Seite wie der Stapel der Shell.
 */

export const metadata: Metadata = { title: "Woche" };

export default async function Page({ searchParams }: PageProps<"/stundenplan">) {
  return <DirekteSeite art="woche" params={einfach(await searchParams, ["tag"])} />;
}
