import type { ReactNode } from "react";

import { Button, CardContent, SeitenKopf } from "@/components/kombi/form";
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
    text: "Verbunden. Der Kalender „Schule“ füllt sich gerade. Lade die Seite in einer Minute neu.",
  },
  abgelehnt: {
    tone: "danger",
    text: "Du hast bei Google abgebrochen. Es ist nichts verbunden.",
  },
  ungueltig: {
    tone: "danger",
    text: "Die Anmeldung bei Google ist abgelaufen. Verbinde noch einmal im Browser, nicht in der installierten App.",
  },
  berechtigung: {
    tone: "danger",
    text: "Google hat den Kalender nicht freigegeben. Beim Verbinden den Haken beim Kalender setzen.",
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
    text: "Getrennt. Google hat den Widerruf nicht bestätigt. Entferne den Zugriff selbst unter myaccount.google.com/permissions.",
  },
  "neu-angelegt": {
    tone: "success",
    text: "Ein frischer Kalender „Schule“ ist angelegt und füllt sich gerade. Den alten löschst du in Google selbst.",
  },
  "neu-anlegen-gescheitert": {
    tone: "danger",
    text: "Der neue Kalender ließ sich nicht anlegen. Der Grund steht unter „Letzter Fehler“.",
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
      <dt className="shrink-0 text-[15px] text-ink-2">{label}</dt>
      <dd className="text-right font-[560]">{children}</dd>
    </div>
  );
}

const BLOCKED_TEXT = {
  zugang: (since: string) =>
    `Verbindung unterbrochen seit ${since}. Der Zugang wurde entzogen oder ist abgelaufen. Steht das Cloud-Projekt auf „Testing“, dort auf „In production“ stellen. Dann neu verbinden.`,
  schluessel: () =>
    "Der gespeicherte Zugang lässt sich nicht entschlüsseln, GOOGLE_TOKEN_KEY hat sich geändert. Neu verbinden behebt es.",
  kalender: () =>
    "Den Kalender „Schule“ gibt es in Google nicht mehr. Die App legt ihn nicht von selbst neu an.",
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
    <>
      {/* Derselbe Seitenkopf wie auf den übrigen Unterseiten: ohne Rahmen darüber, sonst springt der Titel. */}
      <SeitenKopf
        titel="Google Kalender"
        sub={
          <>
              Klausuren, offene Hausaufgaben, freie Tage und Termine aus IServ
              stehen in einem eigenen Kalender „Schule“. An deine anderen
              Kalender kommt die App nicht heran.
          </>
        }
      />

      <CardContent className="space-y-4" style={{ marginTop: 16 }}>
        {meldung ? (
          meldung.tone === "success" ? (
            <p role="status" className="text-[15px] text-ink-2">
              {meldung.text}
            </p>
          ) : (
            <p role="alert" className="text-[15px] text-error">
              {meldung.text}
            </p>
          )
        ) : null}

        {state.kind === "nicht-eingerichtet" ? (
          <p className="text-[15px] text-ink-2">
            Auf diesem Server fehlt {state.missing.join(", ")}. Wie man es
            einrichtet, steht im README unter „Google Kalender“.
          </p>
        ) : null}

        {state.kind === "getrennt" ? (
          <>
            <p className="text-[15px]">Nicht verbunden.</p>
            <ConnectForm label="Mit Google verbinden" />
            <p className="text-[0.8125rem] text-ink-3">
              Google fragt, ob die App eigene Kalender anlegen darf. Bei der
              Warnung „Google hat diese App nicht überprüft“ geht es über
              „Erweitert“ weiter.
            </p>
            <p className="text-[0.8125rem] text-ink-3">
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
            <p className="kf-fehler">
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
                {status.verworfen.count}, die App trägt sie nicht wieder ein:{" "}
                {status.verworfen.titles.join(", ")}
                <span className="mt-1 block text-[0.8125rem] font-normal text-ink-3">
                  Die App bemerkt eine Löschung, sobald sie den Termin ändern
                  oder entfernen will.
                </span>
              </Row>
            ) : null}
          </dl>
        ) : null}

        {(state.kind === "verbunden" || state.kind === "blockiert") &&
        status.lastError ? (
          <p className="kf-fehler">
            Letzter Fehler, {zeitpunkt(status.lastError.at)}:{" "}
            {status.lastError.sentence}
          </p>
        ) : null}

        {(state.kind === "verbunden" || state.kind === "blockiert") &&
        status.cronStaleSince ? (
          <p className="p-sub">
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

            <p className="text-[0.8125rem] text-ink-3">
              Trennen nimmt der App den Zugang. Der Kalender „Schule“ bleibt in
              Google stehen; was du dort gelöscht hast, bleibt auch nach neuem
              Verbinden draußen.
            </p>

            <details className="text-[15px]">
              <summary className="cursor-pointer text-ink-2">
                Kalender neu anlegen
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-ink-2">
                  Legt einen frischen Kalender „Schule“ an und trägt alles neu
                  ein, auch Gelöschtes. Den alten löschst du selbst in Google.
                </p>
                <RecreateForm variant="secondary" />
              </div>
            </details>
          </>
        ) : null}
      </CardContent>
    </>
  );
}
