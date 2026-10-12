import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SeitenInhalt } from "@/components/kombi/seite";
import { zuletztTitel } from "@/components/kombi/zeile/zuletzt";
import { ZuletztMerken } from "@/components/kombi/zeile/zuletzt-merken";
import { requireUser } from "@/lib/auth";
import { dm } from "@/lib/kombi/text";
import { klausurSeite } from "@/lib/seiten/klausur";

/**
 * Die Klausurseite bei direktem Aufruf (Push-Erinnerung, Neuladen): derselbe
 * Loader und dieselbe Komponente wie im Stapel der Shell (Plan 2.1, 2.4).
 * Bearbeiten liegt unter `/klausuren/[id]/bearbeiten`.
 */

export const metadata: Metadata = {
  title: "Klausur",
};

export default async function KlausurPage({ params }: PageProps<"/klausuren/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const daten = await klausurSeite(user.id, { id });
  if (!daten) notFound();
  return (
    <>
      <ZuletztMerken art="klausur" id={id} label={zuletztTitel.klausur(daten.fach)} sub={dm(daten.datum)} />
      <SeitenInhalt art="klausur" params={{ id }} daten={daten} />
    </>
  );
}
