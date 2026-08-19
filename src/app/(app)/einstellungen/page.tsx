import type { Metadata } from "next";

import { logout } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

import { setReminderHourAction } from "./actions";
import { PushSettings, ReminderTime } from "./push-settings";

export const metadata: Metadata = {
  title: "Einstellungen",
};

/** Wie auf der Startseite: der Server läuft womöglich in UTC. */
const TIME_ZONE = "Europe/Berlin";

export default async function SettingsPage() {
  const user = await requireUser();

  const since = user.createdAt.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  });

  // In der Entwicklung liegt die Datenbank als Datei im Projekt, sonst steht
  // eine DATABASE_URL auf einen echten Postgres.
  const onServer = Boolean(process.env.DATABASE_URL);

  // Ohne Schlüssel kann der Browser sich gar nicht erst anmelden — die
  // Komponente sagt das dann geradeheraus, statt einen Knopf anzubieten.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <div className="space-y-6">
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
            Es geht an keinen anderen Dienst, und außer deinem gibt es kein
            Konto.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
