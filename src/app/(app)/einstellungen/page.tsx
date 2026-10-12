import type { Metadata } from "next";

import { logout } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { loadCalendarStatus } from "@/lib/calendar/sync";
import { CLAUDE_MODELL, claudeConfigured } from "@/lib/claude/client";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { freeLabel, listFreePeriods } from "@/lib/free-days";
import { iservConfigured } from "@/lib/iserv/config";
import { loadIservStatus } from "@/lib/iserv/status";
import { jevConfigured } from "@/lib/jev";
import { kostenSatz, laufAnzeige } from "@/lib/leser/claude-ablauf";
import { laufKostenSeit, letzterArbeitsblattLauf } from "@/lib/leser/laeufe";
import { listConnections } from "@/lib/oauth";

import {
  createFreePeriodAction,
  deleteFreePeriodAction,
  revokeConnectionAction,
  setReminderHourAction,
} from "./actions";
import { FreeDaysForm } from "./free-days-form";
import { GoogleCalendarCard } from "./google-calendar-card";
import { IservCard } from "./iserv-card";
import { PushSettings, ReminderTime } from "./push-settings";

export const metadata: Metadata = {
  title: "Einstellungen",
};

/** Wie auf der Startseite: der Server läuft womöglich in UTC. */
const TIME_ZONE = "Europe/Berlin";

/** Ein Datum, wie es in dieser Karte steht: „24. August 2026". */
function tag(value: Date): string {
  return value.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
}

export default async function SettingsPage({
  searchParams,
}: PageProps<"/einstellungen">) {
  const user = await requireUser();
  const today = todayInBerlin();
  const { kalender } = await searchParams;
  // Seit wann der Claude-Leser für „diesen Monat“ zählt: der Erste des
  // Berliner Monats, um Mitternacht UTC. Die ein, zwei Stunden Abstand zu
  // Berlin sind für eine Summe zum Ansehen ohne Belang — abgerechnet wird bei
  // Anthropic, nicht hier.
  const monatsanfang = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
  const claude = claudeConfigured();
  const [connections, freePeriods, calendar, iserv, kosten, blattLauf] = await Promise.all([
    listConnections(user.id),
    listFreePeriods(user.id, today),
    loadCalendarStatus(user.id),
    loadIservStatus(user.id),
    laufKostenSeit(user.id, monatsanfang),
    letzterArbeitsblattLauf(user.id),
  ]);

  const since = tag(user.createdAt);

  // In der Entwicklung liegt die Datenbank als Datei im Projekt, sonst steht
  // eine DATABASE_URL auf einen echten Postgres.
  const onServer = Boolean(process.env.DATABASE_URL);

  // Ohne Schlüssel kann der Browser sich gar nicht erst anmelden — die
  // Komponente sagt das dann geradeheraus, statt einen Knopf anzubieten.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  // Was davon tatsächlich hinausgeht — nur das, was eingeschaltet ist. Steht
  // nichts davon an, ist der alte Satz „Es geht an keinen anderen Dienst" wahr
  // und bleibt stehen.
  const hinaus = [
    calendar.state.kind === "verbunden" || calendar.state.kind === "blockiert"
      ? "Klausuren, offene Hausaufgaben und freie Tage gehen als Termine in deinen Google Kalender „Schule“"
      : null,
    iservConfigured()
      ? "die App meldet sich mit deinem IServ-Konto an, liest Kalender und Aufgaben und trägt Termine deiner Klasse in „Schule“ ein"
      : null,
    jevConfigured()
      ? "die Abschrift eines Blattes geht zum Einordnen an Jev (TypeSafe)"
      : null,
    claude
      ? "Fotos von Seiten, die Docling nicht sicher liest, gehen zum Abschreiben an Claude (Anthropic) — nur die Fotos, nie etwas aus IServ"
      : null,
    claude
      ? "drückst du an einer Klausur „Fragen bauen lassen“, geht ihr Stoff — die Abschriften der Blätter zu ihren Themen — an Claude (Anthropic)"
      : null,
    connections.length > 0
      ? "verbundene Programme lesen über den Web MCP mit, auch Fotos und Abschriften deiner Blätter"
      : null,
  ].filter((teil): teil is string => teil !== null);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>

      <Card>
        <CardHeader>
          <CardTitle>Erinnerungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PushSettings vapidPublicKey={vapidPublicKey} />

          <div className="h-px bg-border" />

          <ReminderTime
            action={setReminderHourAction}
            hour={user.reminderHour}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ferien und Klassenfahrt</CardTitle>
          <CardDescription>
            An diesen Tagen ist ganz frei: kein Stundenplan, keine Lernblöcke,
            kein Abruf, keine Erinnerung. Der Lernplan weicht auf die Tage
            davor und danach aus.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {freePeriods.length === 0 ? (
            <p className="text-sm text-muted">Nichts eingetragen.</p>
          ) : (
            <ul className="space-y-3">
              {freePeriods.map((period) => (
                <li
                  key={period.id}
                  className="flex flex-wrap items-baseline justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">
                      {freeLabel(period)}
                      {period.startsOn <= today ? (
                        <span className="text-sm font-normal text-accent">
                          {" "}
                          · gerade
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted">
                      {period.startsOn === period.endsOn
                        ? formatGerman(period.startsOn, "kurz")
                        : `${formatGerman(period.startsOn, "kurz")} bis ${formatGerman(period.endsOn, "kurz")}`}
                    </p>
                  </div>

                  <form action={deleteFreePeriodAction}>
                    <input type="hidden" name="id" value={period.id} />
                    <Button type="submit" variant="secondary">
                      Streichen
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div className="h-px bg-border" />

          <FreeDaysForm action={createFreePeriodAction} />
        </CardContent>
      </Card>

      <section id="kalender" className="scroll-mt-6">
        <GoogleCalendarCard
          status={calendar}
          notice={typeof kalender === "string" ? kalender : undefined}
        />
      </section>

      <section id="iserv" className="scroll-mt-6">
        <IservCard status={iserv} />
      </section>

      {/* Der Claude-Leser (seit dem 11.10.2026): an derselben Stelle sichtbar
          wie Jev — in „Wo deine Daten liegen“ —, und hier mit dem, was nur er
          hat: ein Zustand ohne Schlüssel, der nicht still bleiben darf, und
          Kosten in echtem Geld. Ohne Schlüssel läuft die App wie bisher, nur
          Handschrift liest niemand; das soll hier stehen und nicht erst im
          Protokoll auffallen. Die Summe des Monats zählt jeden Lauf in
          `leser_laeufe` mit Antwort, also auch die Fragenläufe an den
          Klausuren — es ist derselbe Schlüssel, und abgerechnet wird beides
          zusammen. Bezahlte Abbrüche (eigene Frist, Strom abgerissen, Neustart
          mitten im Aufruf) haben keine Messung; gab es im Monat einen, steht
          „mindestens“ vor der Summe und dahinter, wie viele fehlen
          (`kostenSatz()`, seit der Abnahme vom 11.10.2026 — bis dahin fehlten
          sie still). */}
      <Card>
        <CardHeader>
          <CardTitle>Handschrift abschreiben</CardTitle>
          <CardDescription>
            Seiten, die Docling nicht sicher liest — Handschrift, Formeln —,
            schreibt Claude vom Foto ab. Daraus wird ein Vorschlag im
            Eingangskorb, und Jev ordnet ein; ändern kann Claude dabei nichts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {claude ? (
            <p className="text-sm text-muted">
              {`Eingerichtet: ${CLAUDE_MODELL} über den API-Schlüssel dieses Servers. Jeder Lauf kostet Geld; diesen Monat bisher ${kostenSatz(kosten)}, Abschreiben, Fragen bauen und Arbeitsblätter zusammen. Was die Läufe an einem Blatt gekostet haben, steht an ihm, was ein Fragenlauf gekostet hat, an seiner Klausur.`}
            </p>
          ) : null}
          {/* Ein Arbeitsblatt hat keine eigene Seite: sein jüngster Bau steht hier (Befund der Abnahme von H) */}
          {claude && blattLauf ? (
            <p className="text-sm text-muted">{`Arbeitsblätter: ${laufAnzeige(blattLauf)}`}</p>
          ) : null}
          {!claude ? (
            <p className="text-sm text-muted">
              Auf diesem Server ist Claude nicht eingerichtet — es fehlt{" "}
              <code>ANTHROPIC_API_KEY</code>. Gedrucktes liest Docling weiter;
              Handschrift liest niemand, sie bleibt ohne Abschrift, bis du sie
              am Blatt abtippst. Übungsthemen laufen dann mit Karten statt
              mit Arbeitsblatt.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Als App installieren</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Am Handy in Chrome, dann fühlt sich die Schulapp wie eine richtige
            App an:
          </p>
          <ol className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-subtle">
                1.
              </span>
              <span>Oben rechts das Menü öffnen — die drei Punkte.</span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-subtle">
                2.
              </span>
              <span>
                „App installieren“ antippen. Steht dort stattdessen „Zum
                Startbildschirm hinzufügen“, ist das dasselbe.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-subtle">
                3.
              </span>
              <span>Bestätigen.</span>
            </li>
          </ol>
          <p className="text-sm text-muted">
            Danach liegt sie mit eigenem Symbol im App-Menü und startet ohne
            Browserleiste.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verbundene Programme</CardTitle>
          <CardDescription>
            Was über den Web MCP mitlesen darf. Ein verbundenes Programm sieht
            deine Schulsachen und kann Vorschläge in den Eingangskorb legen —
            ändern kann es nichts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-sm text-muted">
              Nichts verbunden. Verbunden wird in der Claude-App unter
              Connectors, mit der Adresse{" "}
              <code className="break-all">/api/mcp</code> dieser App; die Frage
              danach stellt dir diese App selbst.
            </p>
          ) : (
            <ul className="space-y-3">
              {connections.map((connection) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-baseline justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">{connection.clientName}</p>
                    <p className="text-sm text-muted">
                      verbunden seit {tag(connection.createdAt)}
                    </p>
                  </div>

                  <form action={revokeConnectionAction}>
                    <input type="hidden" name="id" value={connection.id} />
                    <Button type="submit" variant="secondary">
                      Trennen
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Konto</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Name</dt>
              <dd className="text-right font-medium">{user.name}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Angelegt am</dt>
              <dd className="text-right font-medium">{since}</dd>
            </div>
          </dl>

          <form action={logout} className="pt-1">
            <Button type="submit" variant="secondary" className="w-full sm:w-auto">
              Abmelden
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wo deine Daten liegen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            {onServer
              ? "Alles, was du einträgst, liegt in der Datenbank auf dem Server, auf dem diese App läuft."
              : "In der Entwicklung liegt alles, was du einträgst, als Datei unter .data/pglite in deinem Projektordner."}{" "}
            {hinaus.length > 0
              ? `Hinaus geht davon nur, was du eingeschaltet hast: ${hinaus.join("; ")}. Außer deinem gibt es kein Konto.`
              : "Es geht an keinen anderen Dienst, und außer deinem gibt es kein Konto."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
