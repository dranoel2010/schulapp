import type { Metadata } from "next";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { CLAUDE_MODELL, claudeConfigured } from "@/lib/claude/client";
import { todayInBerlin } from "@/lib/dates";
import { kostenSatz, laufAnzeige } from "@/lib/leser/claude-ablauf";
import { laufKostenSeit, letzterArbeitsblattLauf } from "@/lib/leser/laeufe";

/**
 * Einstellungen › Handschrift abschreiben: ob Claude eingerichtet ist und was
 * die Läufe diesen Monat gekostet haben (Abschreiben, Fragen bauen und
 * Arbeitsblätter zusammen — es ist derselbe Schlüssel).
 */

export const metadata: Metadata = { title: "Handschrift abschreiben" };

export default async function AbschriftPage() {
  const user = await requireUser();
  const today = todayInBerlin();
  // Seit dem Ersten des Berliner Monats, um Mitternacht UTC — für eine Summe
  // zum Ansehen genau genug; abgerechnet wird bei Anthropic.
  const monatsanfang = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
  const claude = claudeConfigured();
  const [kosten, blattLauf] = await Promise.all([
    laufKostenSeit(user.id, monatsanfang),
    letzterArbeitsblattLauf(user.id),
  ]);

  return (
    <>
      <SeitenKopf
        titel="Handschrift abschreiben"
        sub="Handschrift und Formeln schreibt Claude vom Foto ab. Gedrucktes liest Docling."
      />
      {claude ? (
        <p className="p-sub" style={{ marginTop: 16 }}>
          {`Eingerichtet: ${CLAUDE_MODELL}. Diesen Monat bisher ${kostenSatz(kosten)} für Abschreiben, Fragen und Arbeitsblätter.`}
        </p>
      ) : (
        <p className="p-sub" style={{ marginTop: 16 }}>
          Auf diesem Server fehlt <code>ANTHROPIC_API_KEY</code>. Handschrift bleibt ohne Abschrift, bis du sie
          abtippst. Übungsthemen laufen mit Karten statt Arbeitsblatt.
        </p>
      )}
      {/* Ein Arbeitsblatt hat keine eigene Seite: sein jüngster Bau steht hier (Befund der Abnahme von H) */}
      {claude && blattLauf ? <p className="p-sub">{`Arbeitsblätter: ${laufAnzeige(blattLauf)}`}</p> : null}
    </>
  );
}
