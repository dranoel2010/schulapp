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
import { countAgentGrants } from "@/lib/oauth";
import { readThemePreference, THEME_OPTIONS } from "@/lib/theme";

import {
  revokeAgentAccessAction,
  setReminderHourAction,
  setThemeAction,
} from "./actions";
import { PushSettings, ReminderTime } from "./push-settings";

export const metadata: Metadata = {
  title: "Einstellungen",
};

/** Wie auf der Startseite: der Server läuft womöglich in UTC. */
const TIME_ZONE = "Europe/Berlin";

export default async function SettingsPage() {
  const user = await requireUser();
  const theme = await readThemePreference();

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

  // Wie viele Agenten gerade zugreifen dürfen. Gezählt werden die
  // Refresh-Token: eines je Verbindung, und es ist das, was die Verbindung am
  // Leben hält. Zugriffstoken wären die falsche Zahl — davon entsteht jede
  // Stunde ein neues.
  const agents = await countAgentGrants(user.id);

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
          <CardTitle>Darstellung</CardTitle>
          <CardDescription>
            Ohne eigene Wahl folgt die App deinem Gerät — Android schaltet
            abends von selbst auf dunkel. Die Wahl gilt für dieses Gerät.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Drei Knöpfe statt eines Schalters: so ist der aktuelle Zustand
              ablesbar, und es funktioniert ohne JavaScript. */}
          <form
            action={setThemeAction}
            className="grid gap-2 sm:grid-cols-3"
          >
            {THEME_OPTIONS.map((option) => {
              const active = option.value === theme;

              return (
                <button
                  key={option.value}
                  type="submit"
                  name="theme"
                  value={option.value}
                  aria-pressed={active}
                  className={[
                    "flex min-h-16 flex-col justify-center gap-0.5 rounded-control border px-4 py-3 text-left transition-colors",
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface text-foreground hover:bg-surface-muted",
                  ].join(" ")}
                >
                  <span className="text-[0.9375rem] font-medium">
                    {option.label}
                  </span>
                  <span
                    className={
                      active ? "text-[0.8125rem]" : "text-[0.8125rem] text-muted"
                    }
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </form>
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

      {/* Die Karte steht nur da, wenn wirklich ein Agent verbunden ist. Eine
          Zeile „0 Verbindungen“ unter jeder Einstellungsseite wäre eine
          tägliche Meldung darüber, dass nichts passiert ist — dieselbe Regel
          wie beim Eingangskorb auf der Startseite. Wie man einen Agenten
          anschließt, steht im README und nicht hier: es ist ein Vorgang in der
          Claude-App und nicht in dieser. */}
      {agents > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Verbundene Agenten</CardTitle>
            <CardDescription>
              {agents === 1
                ? "Ein Agent darf gerade lesen und Vorschläge in deinen Eingangskorb legen."
                : `${agents} Agenten dürfen gerade lesen und Vorschläge in deinen Eingangskorb legen.`}{" "}
              Ändern kann keiner von ihnen etwas — es gibt kein Werkzeug dafür.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={revokeAgentAccessAction}>
              <Button
                type="submit"
                variant="secondary"
                className="w-full sm:w-auto"
              >
                Zugriff zurücknehmen
              </Button>
            </form>
            <p className="text-sm text-muted">
              Danach kommt kein Agent mehr an deine Daten, bis du in der
              Claude-App neu verbindest und hier wieder erlaubst.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
