import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { SeitenKopf } from "@/components/kombi/form";
import { TermineNeuZeile } from "@/components/kombi/seiten/termine-neu";
import { TextLine } from "@/components/kombi/seiten/zeilen";
import { requireUser } from "@/lib/auth";
import { getSubject } from "@/lib/subjects";
import { MATERIALARTEN, MATERIALART_NAMEN } from "@/recall/arten";
import { listItems } from "@/recall/items";

/**
 * Die Bausteine des Abrufs (Plan 2.2, Zeile `/abruf`): jede Frage mit
 * Musterlösung und dem Satz, womit man sie verwechselt. Erreichbar aus dem
 * Fach („Fragen und Bausteine“, dann mit `?fach=`), über die Suche der Zeile
 * („bausteine“) und aus den Einstellungen. Unten „Termine neu rechnen“ mit
 * Erklärsatz — der bestehende Rettungsweg nach einer verschobenen Klausur;
 * am Takt ändert er nichts.
 */

export const metadata: Metadata = {
  title: "Bausteine",
};

const ART_LABELS: Record<string, string> = Object.fromEntries(
  MATERIALARTEN.map((art) => [art, MATERIALART_NAMEN[art].kurz]),
);

export default async function BausteinePage({ searchParams }: PageProps<"/abruf/bausteine">) {
  const user = await requireUser();
  const { fach } = await searchParams;
  const fachId = typeof fach === "string" ? fach : null;
  const [alle, gefiltert] = await Promise.all([
    listItems(user.id),
    fachId ? getSubject(user.id, fachId) : Promise.resolve(null),
  ]);
  const bausteine = gefiltert ? alle.filter((b) => b.subjectName === gefiltert.name) : alle;

  const aktive = bausteine.filter((b) => b.retiredAt === null);
  const zurueckgezogen = bausteine.filter((b) => b.retiredAt !== null);

  return (
    <>
      <SeitenKopf
        titel={gefiltert ? `Bausteine ${gefiltert.name}` : "Bausteine"}
        sub={
          aktive.length === 0
            ? "Noch keine. Ein Baustein ist eine Frage mit Musterlösung und dem, womit man sie verwechselt."
            : `${aktive.length} ${aktive.length === 1 ? "Baustein" : "Bausteine"} im Bestand.`
        }
      />

      {[...aktive, ...zurueckgezogen].map((b) => {
        const still = b.retiredAt !== null;
        const stand =
          b.role === "messung"
            ? "nur zum Prüfen"
            : still
              ? "zurückgezogen"
              : `${b.offeneTermine} ${b.offeneTermine === 1 ? "Termin" : "Termine"} offen`;
        return (
          <div key={b.id} className="lrow plain" style={{ display: "block", opacity: still ? 0.6 : 1 }}>
            <span className="s">{[b.subjectName, ART_LABELS[b.materialKind] ?? b.materialKind, stand].join(" · ")}</span>
            <b style={{ marginTop: 2 }}>{b.promptFree}</b>
            {/* wie die Musterlösung auf dem Tisch (`.cb-sol`): Nummer in der Textschrift, innerhalb des Randes */}
            <ol
              className="cb-sol"
              style={{ fontSize: 15, color: "var(--ink-2)", "--card-ink-2": "var(--ink-3)" } as CSSProperties}
            >
              {b.solution
                .split("\n")
                .map((z) => z.trim())
                .filter(Boolean)
                .map((z, i) => (
                  <li key={i}>{z}</li>
                ))}
            </ol>
            <span className="s" style={{ marginTop: 6, color: "var(--ink-3)" }}>
              {b.misconception}
            </span>
          </div>
        );
      })}

      <h3 className="p-lab">Termine</h3>
      <TermineNeuZeile />
      <div style={{ height: 16 }} />
      <TextLine href="/abruf/bausteine/neu">Baustein anlegen</TextLine>
      <TextLine href="/abruf/klausur">Stoff einer Klausur</TextLine>
      <TextLine href="/abruf/eingang">Fragen-Vorschläge</TextLine>
    </>
  );
}
