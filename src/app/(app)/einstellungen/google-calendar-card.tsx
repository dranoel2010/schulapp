import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CalendarStatus } from "@/lib/calendar/report";
import { addDays, berlinDay, timeInBerlin, todayInBerlin } from "@/lib/dates";

import {
  disconnectCalendarAction,
  recreateCalendarAction,
  syncCalendarNowAction,
} from "./actions";
import { CalendarSubmit } from "./calendar-submit";

/**
 * Die Karte „Google Kalender" in den Einstellungen — der Ort, an dem jeder
 * Fehler des Abgleichs sichtbar wird.
 *
 * Server Component: Sie bekommt den fertigen Zustand aus `loadCalendarStatus()`
 * (@/lib/calendar/sync) und rechnet nichts mehr nach. Der einzige Knopf mit
 * eigenem Verhalten sitzt in calendar-submit.tsx und weiß von @/lib/calendar
 * nichts.
 *
 * „Mit Google verbinden" ist ein schlichtes `<form method="post">` auf
 * /api/google/connect und kein Link: Ein Link würde vorgeladen, und der
 * Aufruf setzt ein Cookie und schickt zu Google.
 *
 * Die Meldung aus `?kalender=…` kommt aus einer festen Liste. Ein unbekannter
 * Wert wird ignoriert, und nie steht Text aus der Adresse auf der Seite —
 * sonst könnte jeder Link der App einen Satz in den Mund legen.
 */

const TIME_ZONE = "Europe/Berlin";

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  verbunden: {
    tone: "success",
    text: "Verbunden. Der Kalender „Schule“ füllt sich gerade — lade die Seite in einer Minute neu.",
  },
  abgelehnt: {
    tone: "danger",
    text: "Du hast bei Google abgebrochen. Es ist nichts verbunden.",
  },
  ungueltig: {
    tone: "danger",
    text: "Die Anmeldung bei Google ist abgelaufen oder kam nicht in diesem Browser zurück. Bitte noch einmal verbinden — im Browser (Safari oder Chrome), nicht aus der installierten App vom Home-Bildschirm.",
  },
  berechtigung: {
    tone: "danger",
    text: "Google hat die Erlaubnis für den Kalender nicht erteilt — ohne sie kann die App nichts eintragen. Beim Verbinden den Haken beim Kalender setzen.",
  },
  zugangsdaten: {
    tone: "danger",
    text: "Google lehnt die Zugangsdaten der App ab (invalid_client). GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in der .env auf dem Server prüfen.",
  },
  "api-aus": {
    tone: "danger",
    text: "Die Google Calendar API ist im Cloud-Projekt ausgeschaltet. In der Google Cloud Console unter „APIs & Dienste“ einschalten, dann neu verbinden.",
  },
  kalender: {
    tone: "danger",
    text: "Google hat den Zugang erteilt, aber der Kalender „Schule“ ließ sich nicht anlegen. Bitte noch einmal verbinden; was Google geantwortet hat, steht im Protokoll des Containers („Google-Kalender“).",
  },
  fehlgeschlagen: {
    tone: "danger",
    text: "Google hat die Verbindung nicht bestätigt. Bitte noch einmal versuchen; was Google geantwortet hat, steht im Protokoll des Containers („Google-Kalender“).",
  },
  "nicht-eingerichtet": {
    tone: "danger",
    text: "Auf diesem Server ist Google nicht eingerichtet.",
  },
  getrennt: {
    tone: "success",
    text: "Getrennt. Der Kalender „Schule“ bleibt in deinem Google Kalender stehen, mit dem Stand von jetzt. Entfernen kannst du ihn dort unter Einstellungen → „Schule“ → Kalender entfernen.",
  },
  "getrennt-ohne-widerruf": {
    tone: "danger",
    text: "Getrennt — die App hat den Zugang vergessen, aber Google hat den Widerruf nicht bestätigt. Bei Google gilt er womöglich noch: Entferne ihn selbst unter myaccount.google.com/permissions (dort die App auswählen und den Zugriff entfernen). Der Kalender „Schule“ bleibt in Google stehen.",
  },
  "neu-angelegt": {
    tone: "success",
    text: "Ein frischer Kalender „Schule“ ist angelegt und füllt sich gerade. Den alten löschst du in Google selbst.",
  },
  "neu-anlegen-gescheitert": {
    tone: "danger",
    text: "Der neue Kalender ließ sich nicht anlegen — der Grund steht unten unter „Letzter Fehler“.",
  },
};

/** Ein Datum, wie es in den Einstellungen steht: „24. August 2026". */
function tag(value: Date): string {
  return value.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
}

/** „heute, 14:05", „gestern, 17:15" oder „3. Oktober, 09:15". */
function zeitpunkt(value: Date): string {
  const heute = todayInBerlin();
  const tagDavon = berlinDay(value);
  const uhrzeit = timeInBerlin(value);

  if (tagDavon === heute) return `heute, ${uhrzeit}`;
  if (tagDavon === addDays(heute, -1)) return `gestern, ${uhrzeit}`;

  return `${value.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  })}, ${uhrzeit}`;
}

/** Zu Google — ein echter POST, damit nichts vorgeladen wird. */
function ConnectForm({ label }: { label: string }) {
  return (
    <form action="/api/google/connect" method="post">
      <Button type="submit">{label}</Button>
    </form>
  );
}

function DisconnectForm() {
  return (
    <form action={disconnectCalendarAction}>
      <CalendarSubmit label="Trennen" pendingLabel="Trennt …" variant="ghost" />
    </form>
  );
}

function RecreateForm({ variant }: { variant: "primary" | "secondary" }) {
  return (
    <form action={recreateCalendarAction}>
      <CalendarSubmit label="Neu anlegen" pendingLabel="Legt an …" variant={variant} />
    </form>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

const BLOCKED_TEXT = {
  zugang: (since: string) =>
    `Verbindung unterbrochen seit ${since}. Google lässt die App nicht mehr in den Kalender — der Zugang wurde entzogen oder ist abgelaufen. Steht das Cloud-Projekt noch auf „Testing“, läuft der Zugang nach sieben Tagen ab; dort auf „In production“ stellen. Neu verbinden: Der Kalender „Schule“ und alles darin bleibt.`,
  schluessel: () =>
    "Der gespeicherte Zugang lässt sich nicht mehr entschlüsseln — GOOGLE_TOKEN_KEY auf dem Server hat sich geändert. Neu verbinden behebt es.",
  kalender: () =>
    "Den Kalender „Schule“ gibt es in Google nicht mehr. Die App legt ihn nicht von selbst neu an — vielleicht war das Absicht.",
} as const;

export function GoogleCalendarCard({
  status,
  notice,
}: {
  status: CalendarStatus;
  notice?: string;
}) {
  const meldung = notice && Object.hasOwn(NOTICES, notice) ? NOTICES[notice] : null;
  const { state } = status;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Kalender</CardTitle>
        <CardDescription>
          Klausuren, offene Hausaufgaben und freie Tage erscheinen als
          ganztägige Termine in einem eigenen Kalender „Schule“ in deinem
          Google Kalender. Die App trägt dort ein, ändert und löscht — an deine
          anderen Kalender kommt sie nicht heran. Was du in Google löschst,
          trägt sie nicht wieder ein. Lernblöcke kommen nicht hinein.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {meldung ? (
          meldung.tone === "success" ? (
            <p role="status" className="text-sm text-success">
              {meldung.text}
            </p>
          ) : (
            <p role="alert" className="text-sm text-danger">
              {meldung.text}
            </p>
          )
        ) : null}

        {state.kind === "nicht-eingerichtet" ? (
          <p className="text-sm text-muted">
            Auf diesem Server ist Google nicht eingerichtet — es fehlt{" "}
            {state.missing.join(", ")}. Die Variablen gehören in die .env auf
            dem NAS; wie, steht im README unter „Google Kalender“. War der
            Kalender schon verbunden, bleibt „Schule“ bis dahin auf altem
            Stand.
          </p>
        ) : null}

        {state.kind === "getrennt" ? (
          <>
            <p className="text-sm">Nicht verbunden.</p>
            <ConnectForm label="Mit Google verbinden" />
            <p className="text-[0.8125rem] text-subtle">
              Google fragt, ob die App eigene Kalender anlegen und darin
              Termine bearbeiten darf — mehr nicht. Weil die App dir gehört und
              nicht von Google geprüft ist, warnt Google vorher („Google hat
              diese App nicht überprüft“); über „Erweitert“ geht es weiter. Gab
              es den Kalender „Schule“ schon, führt die App ihn weiter.
            </p>
            <p className="text-[0.8125rem] text-subtle">
              Verbinde im Browser (Safari oder Chrome) unter der Adresse der
              App, nicht aus der installierten App vom Home-Bildschirm: Dort
              landet die Rückkehr von Google womöglich in einem Fenster, das
              deine Anmeldung nicht kennt. Die Verbindung gilt danach auch in
              der installierten App.
            </p>
          </>
        ) : null}

        {state.kind === "blockiert" ? (
          <>
            <p className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger">
              {BLOCKED_TEXT[state.reason](tag(state.since))}
            </p>
            <div className="flex flex-wrap gap-2">
              {state.reason === "kalender" ? (
                <RecreateForm variant="primary" />
              ) : (
                <ConnectForm label="Neu verbinden" />
              )}
              <DisconnectForm />
            </div>
          </>
        ) : null}

        {state.kind === "verbunden" ? (
          <dl className="space-y-3">
            {status.connectedAt ? (
              <Row label="Verbunden seit">{tag(status.connectedAt)}</Row>
            ) : null}
            {status.googleEmail ? (
              <Row label="Konto">
                <span className="break-all">{status.googleEmail}</span>
              </Row>
            ) : null}
            <Row label="Letzter Abgleich">
              {status.lastRunAt
                ? `${zeitpunkt(status.lastRunAt)} · ${status.lastSummary ?? ""}`
                : "noch keiner"}
              {status.running ? " · läuft gerade" : ""}
            </Row>
            <Row label="Im Kalender">
              {status.geliefert === 1 ? "1 Termin" : `${status.geliefert} Termine`}
            </Row>
            {status.verworfen.count > 0 ? (
              <Row label="Von dir in Google gelöscht">
                {status.verworfen.count} — die App trägt sie nicht wieder ein:{" "}
                {status.verworfen.titles.join(", ")}
                <span className="mt-1 block text-[0.8125rem] font-normal text-subtle">
                  Die App bemerkt eine Löschung, sobald sie den Termin ändern
                  oder entfernen will.
                </span>
              </Row>
            ) : null}
          </dl>
        ) : null}

        {(state.kind === "verbunden" || state.kind === "blockiert") &&
        status.lastError ? (
          <p className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger">
            Letzter Fehler, {zeitpunkt(status.lastError.at)}:{" "}
            {status.lastError.sentence}
          </p>
        ) : null}

        {(state.kind === "verbunden" || state.kind === "blockiert") &&
        status.cronStaleSince ? (
          <p className="rounded-control border border-warning/40 px-3.5 py-3 text-sm text-warning">
            Der stündliche Abgleich ist seit {zeitpunkt(status.cronStaleSince)}{" "}
            nicht gelaufen. Änderungen kommen nur noch direkt nach dem
            Speichern an. Auf dem NAS nachsehen:{" "}
            <code className="break-all">grep kalender /etc/crontab</code>
          </p>
        ) : null}

        {state.kind === "verbunden" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <form action={syncCalendarNowAction}>
                <CalendarSubmit
                  label="Jetzt abgleichen"
                  pendingLabel="Gleicht ab …"
                  variant="secondary"
                />
              </form>
              <DisconnectForm />
            </div>

            <p className="text-[0.8125rem] text-subtle">
              Trennen nimmt der App den Zugang. Der Kalender „Schule“ bleibt in
              Google stehen; was du dort gelöscht hast, bleibt auch nach neuem
              Verbinden draußen.
            </p>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted">
                Kalender neu anlegen
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-muted">
                  Legt in Google einen frischen Kalender „Schule“ an und trägt
                  alles neu ein — auch, was du im alten gelöscht hattest. Den
                  alten Kalender löschst du danach selbst in Google. Hilft,
                  wenn du „Schule“ aus der Liste entfernt hast.
                </p>
                <RecreateForm variant="secondary" />
              </div>
            </details>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
