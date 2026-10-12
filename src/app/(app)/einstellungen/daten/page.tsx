import type { Metadata } from "next";
import Link from "next/link";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { loadCalendarStatus } from "@/lib/calendar/sync";
import { claudeConfigured } from "@/lib/claude/client";
import { iservConfigured } from "@/lib/iserv/config";
import { jevConfigured } from "@/lib/jev";
import { listConnections } from "@/lib/oauth";

/**
 * Einstellungen › Wo deine Daten liegen: was die App speichert und was davon
 * hinausgeht — nur das, was eingeschaltet ist.
 */

export const metadata: Metadata = { title: "Wo deine Daten liegen" };

export default async function DatenPage() {
  const user = await requireUser();
  const [connections, calendar] = await Promise.all([listConnections(user.id), loadCalendarStatus(user.id)]);
  const claude = claudeConfigured();
  const onServer = Boolean(process.env.DATABASE_URL);

  const hinaus = [
    calendar.state.kind === "verbunden" || calendar.state.kind === "blockiert"
      ? "Klausuren, offene Hausaufgaben und freie Tage gehen als Termine in deinen Google Kalender „Schule“"
      : null,
    iservConfigured()
      ? "die App meldet sich mit deinem IServ-Konto an, liest Kalender und Aufgaben und trägt Termine deiner Klasse in „Schule“ ein"
      : null,
    jevConfigured() ? "die Abschrift eines Blattes geht zum Einordnen an Jev (TypeSafe)" : null,
    claude
      ? "Fotos von Seiten, die Docling nicht sicher liest, gehen zum Abschreiben an Claude (Anthropic) — nur die Fotos, nie etwas aus IServ"
      : null,
    claude
      ? "drückst du an einer Klausur „Fragen bauen lassen“, geht ihr Stoff — die Abschriften der Blätter zu ihren Themen — an Claude (Anthropic)"
      : null,
    claude
      ? "für ein Arbeitsblatt zum Üben gehen die Abschriften der Blätter seines Themas an Claude (Anthropic)"
      : null,
    connections.length > 0 ? "verbundene Programme lesen über den Web MCP mit, auch Fotos und Abschriften deiner Blätter" : null,
  ].filter((teil): teil is string => teil !== null);

  return (
    <>
      <SeitenKopf titel="Wo deine Daten liegen" />
      <div className="abschrift" style={{ marginTop: 12 }}>
        <p>
          {onServer
            ? "Alles, was du einträgst, liegt in der Datenbank auf dem Server, auf dem diese App läuft."
            : "In der Entwicklung liegt alles, was du einträgst, als Datei unter .data/pglite in deinem Projektordner."}
        </p>
        <p>
          {hinaus.length > 0
            ? `Hinaus geht davon nur, was du eingeschaltet hast: ${hinaus.join("; ")}. Außer deinem gibt es kein Konto.`
            : "Es geht an keinen anderen Dienst, und außer deinem gibt es kein Konto."}
        </p>
      </div>
      <div style={{ height: 16 }} />
      <Link className="textline" href="/datenschutz">
        Datenschutz
      </Link>
    </>
  );
}
