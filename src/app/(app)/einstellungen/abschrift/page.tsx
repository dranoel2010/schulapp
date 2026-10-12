import type { Metadata } from "next";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { CLAUDE_MODELL, claudeConfigured } from "@/lib/claude/client";
import { todayInBerlin } from "@/lib/dates";
import { kostenSatz } from "@/lib/leser/claude-ablauf";
import { laufKostenSeit } from "@/lib/leser/laeufe";

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
  const kosten = await laufKostenSeit(user.id, monatsanfang);

  return (
    <>
      <SeitenKopf
        titel="Handschrift abschreiben"
        sub="Seiten, die Docling nicht sicher liest — Handschrift, Formeln —, schreibt Claude vom Foto ab. Daraus wird ein Vorschlag im Eingangskorb, und Jev ordnet ein; ändern kann Claude dabei nichts."
      />
      {claude ? (
        <p className="p-sub" style={{ marginTop: 16 }}>
          {`Eingerichtet: ${CLAUDE_MODELL} über den API-Schlüssel dieses Servers. Jeder Lauf kostet Geld; diesen Monat bisher ${kostenSatz(kosten)}, Abschreiben, Fragen bauen und Arbeitsblätter zusammen. Was die Läufe an einem Blatt gekostet haben, steht an ihm, was ein Fragenlauf gekostet hat, an seiner Klausur.`}
        </p>
      ) : (
        <p className="p-sub" style={{ marginTop: 16 }}>
          Auf diesem Server ist Claude nicht eingerichtet — es fehlt <code>ANTHROPIC_API_KEY</code>. Gedrucktes liest
          Docling weiter; Handschrift liest niemand, sie bleibt ohne Abschrift, bis du sie am Blatt abtippst.
        </p>
      )}
    </>
  );
}
