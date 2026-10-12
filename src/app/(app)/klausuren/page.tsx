import type { Metadata } from "next";

import { SeitenInhalt } from "@/components/kombi/seite";
import { requireUser } from "@/lib/auth";
import { klausurenSeite } from "@/lib/seiten/klausur";

/**
 * Alle Klausuren bei direktem Aufruf — dieselbe Seite wie im Stapel (Plan
 * 2.1): eine sortierte Liste, vergangene eingeschlossen, am Ende „Klausur
 * eintragen“.
 */

export const metadata: Metadata = {
  title: "Klausuren",
};

export default async function KlausurenPage() {
  const user = await requireUser();
  const daten = await klausurenSeite(user.id);
  return <SeitenInhalt art="klausuren" params={{}} daten={daten} />;
}
