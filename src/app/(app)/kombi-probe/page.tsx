import { notFound } from "next/navigation";

import { SeitenInhalt } from "@/components/kombi/seite";
import { requireUser } from "@/lib/auth";
import { probeErlaubt, probeSeite } from "@/lib/seiten/probe";

/**
 * Direkter Aufruf der Probe-Stapelseite (Plan 2.4, „Neuladen“): derselbe
 * Loader und dieselbe Komponente wie im Stapel, serverseitig gerendert. Die
 * Shell legt sie als einzige Seite über die Startseite.
 */
export default async function ProbePage({ searchParams }: PageProps<"/kombi-probe">) {
  if (!probeErlaubt()) notFound();
  const user = await requireUser();
  const roh = await searchParams;
  const params: Record<string, string> = {};
  if (typeof roh.ebene === "string") params.ebene = roh.ebene;
  const daten = await probeSeite(user.id, params);
  if (!daten) notFound();
  return <SeitenInhalt art="probe" params={params} daten={daten} />;
}
