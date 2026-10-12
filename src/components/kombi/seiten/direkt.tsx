import { notFound } from "next/navigation";

import { SeitenInhalt } from "@/components/kombi/seite";
import { requireUser } from "@/lib/auth";
import { seitenLoader } from "@/lib/seiten";

/**
 * Der direkte Aufruf einer Nachschlage-Seite (Plan 2.1): derselbe Loader und
 * dieselbe Komponente wie im Stapel, serverseitig gerendert. Die Shell legt
 * die Seite als einzige über die Startseite; „Zurück“ führt nach `/`.
 */
export async function DirekteSeite({
  art,
  params,
}: {
  art: string;
  params: Record<string, string>;
}) {
  const user = await requireUser();
  const loader = seitenLoader(art);
  if (!loader) notFound();
  const daten = await loader(user.id, params);
  if (daten === null) notFound();
  return <SeitenInhalt art={art} params={params} daten={daten} />;
}

/** Nur einfache Werte aus der Adresse; doppelte Parameter zählen beim ersten. */
export function einfach(
  roh: Record<string, string | string[] | undefined>,
  namen: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of namen) {
    const v = roh[n];
    const w = Array.isArray(v) ? v[0] : v;
    if (typeof w === "string" && w) out[n] = w;
  }
  return out;
}
