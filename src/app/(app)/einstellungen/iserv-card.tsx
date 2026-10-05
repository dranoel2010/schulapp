import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addDays, berlinDay, formatGerman, timeInBerlin, todayInBerlin } from "@/lib/dates";
import type { Eintrag } from "@/lib/iserv/auswahl";
import { BLOCK_TEXT, type IservStatus } from "@/lib/iserv/report";
import type { IservRolle } from "@/lib/iserv/types";

import { retryIservAction } from "./actions";
import { CalendarSubmit } from "./calendar-submit";

/**
 * Die Karte „IServ" in den Einstellungen — der Ort, an dem jeder Fehler des
 * Abrufs sichtbar wird, und die Liste dessen, was knapp draußen blieb.
 *
 * Server Component: Sie bekommt den fertigen Zustand aus `loadIservStatus()`
 * (@/lib/iserv/status) und rechnet nichts mehr nach. Der einzige Knopf ist
 * „Erneut versuchen"; er sitzt in calendar-submit.tsx und weiß von IServ
 * nichts.
 *
 * Titel aus IServ stehen hier nur als React-Text, also maskiert — nie als
 * HTML. Passwort und Benutzername stehen nirgends; die Karte nennt nur den
 * Server und die Klasse.
 */

const TIME_ZONE = "Europe/Berlin";

/** „heute, 14:05", „gestern, 17:15" oder „3. Oktober, 09:15" — wie in der Karte Google Kalender. */
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

/** Ein Datum, wie es in den Einstellungen steht: „24. August 2026". */
function tag(value: Date): string {
  return value.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/** „Mo, 12.10." oder „Sa, 17.10. – Sa, 31.10." */
function datum(eintrag: Eintrag): string {
  return eintrag.bisTag === eintrag.tag
    ? formatGerman(eintrag.tag, "kurz")
    : `${formatGerman(eintrag.tag, "kurz")} – ${formatGerman(eintrag.bisTag, "kurz")}`;
}

function Liste({ eintraege, mitGrund }: { eintraege: Eintrag[]; mitGrund: boolean }) {
  return (
    <ul className="space-y-2">
      {eintraege.map((eintrag, index) => (
        <li key={`${eintrag.tag}-${index}`} className="text-sm">
          <span className="text-muted">
            {datum(eintrag)}
            {eintrag.uhrzeit ? `, ${eintrag.uhrzeit}` : ""}
          </span>
          {" · "}
          <span className="break-words">{eintrag.titel}</span>
          {mitGrund ? <span className="text-subtle"> · {eintrag.grund}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const VERWENDET: readonly IservRolle[] = ["klasse", "oeffentlich", "aufgaben"];

function RetryForm() {
  return (
    <form action={retryIservAction}>
      <CalendarSubmit label="Erneut versuchen" pendingLabel="Liest …" variant="primary" />
    </form>
  );
}

export function IservCard({ status }: { status: IservStatus }) {
  const { state } = status;
  const aktiv = state.kind === "aktiv" || state.kind === "noch-nie";
  const verwendet = status.quellen.filter((q) => VERWENDET.includes(q.rolle));
  const uebergangen = status.quellen.filter((q) => !VERWENDET.includes(q.rolle));
  const zahlFuer = (rolle: IservRolle) =>
    rolle === "klasse" || rolle === "oeffentlich" || rolle === "aufgaben" ? status.zahlen[rolle] : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>IServ</CardTitle>
        <CardDescription>
          Die App meldet sich mit deinem IServ-Konto an und liest — nur lesen —
          den Kalender deiner Klasse, den öffentlichen Schulkalender und deine
          Aufgaben, höchstens alle drei Stunden zwischen 6 und 21 Uhr. In
          „Schule“ landet nur, was deine Klasse betrifft; im Zweifel bleibt ein
          Termin draußen. Das Passwort steht nur auf dem Server.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {state.kind === "nicht-eingerichtet" ? (
          <p className="text-sm text-muted">
            Auf diesem Server ist IServ nicht eingerichtet — es fehlt{" "}
            {state.missing.join(", ")}. Die Variablen gehören in die .env auf
            dem NAS; wie, steht im README unter „IServ“.
          </p>
        ) : null}

        {state.kind === "ruht" ? <p className="text-sm text-muted">{state.grund}</p> : null}

        {state.kind === "noch-nie" ? (
          <p className="text-sm">
            Noch nicht gelesen — der nächste stündliche Lauf holt den ersten Stand.
          </p>
        ) : null}

        {state.kind === "blockiert" ? (
          <>
            <p className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger">
              Seit {tag(state.since)}: {BLOCK_TEXT[state.reason]}
            </p>
            <RetryForm />
          </>
        ) : null}

        {state.kind === "aktiv" ? (
          <dl className="space-y-3">
            {status.host ? <Row label="Server">{status.host}</Row> : null}
            {status.klasse !== null ? (
              <Row label="Klasse">
                {status.klasse}
                <span className="mt-1 block text-[0.8125rem] font-normal text-subtle">
                  ISERV_KLASSE, zum Schuljahr anheben
                </span>
              </Row>
            ) : null}
            <Row label="Zuletzt gelesen">
              {status.lastSuccessAt ? zeitpunkt(status.lastSuccessAt) : "noch nie vollständig"}
              {status.running ? " · liest gerade" : ""}
            </Row>
            {verwendet.length > 0 ? (
              <Row label="Quellen">
                {verwendet.map((q) => `${q.label} (${zahlFuer(q.rolle)})`).join(", ")}
                {uebergangen.length > 0 ? (
                  <span className="mt-1 block text-[0.8125rem] font-normal text-subtle">
                    Übergangen: {uebergangen.map((q) => `${q.label} — ${q.grund}`).join("; ")}
                  </span>
                ) : null}
              </Row>
            ) : null}
            <Row label="Im Kalender aus IServ">
              {status.counts.genommen === 1 ? "1 Termin" : `${status.counts.genommen} Termine`}
              {status.counts.knapp > 0 ? `, davon ${status.counts.knapp} knapp` : ""}
            </Row>
            {status.counts.ausgelassenFrei > 0 ? (
              <Row label="Wegen freier Tage ausgelassen">{status.counts.ausgelassenFrei}</Row>
            ) : null}
          </dl>
        ) : null}

        {state.kind === "aktiv" && status.naechste.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Als Nächstes</p>
            <Liste eintraege={status.naechste} mitGrund={false} />
          </div>
        ) : null}

        {state.kind === "aktiv" && status.zweifel.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">
              Unklar, deshalb nicht im Kalender ({status.zweifel.length})
            </summary>
            <div className="mt-3 space-y-3">
              <Liste eintraege={status.zweifel} mitGrund />
              <p className="text-[0.8125rem] text-subtle">
                Gehört einer davon hinein? Den Titelteil in ISERV_AUCH eintragen
                (z. B. msa), Einrichtung siehe README. Was nie hinein soll:
                ISERV_NIE.
              </p>
            </div>
          </details>
        ) : null}

        {state.kind === "aktiv" && status.knapp.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">
              Knapp aufgenommen ({status.knapp.length})
            </summary>
            <div className="mt-3">
              <Liste eintraege={status.knapp} mitGrund />
            </div>
          </details>
        ) : null}

        {state.kind === "aktiv" && status.ausgelassenFrei.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">
              Wegen freier Tage nicht eingetragen ({status.ausgelassenFrei.length})
            </summary>
            <div className="mt-3">
              <Liste eintraege={status.ausgelassenFrei} mitGrund={false} />
              <p className="mt-2 text-[0.8125rem] text-subtle">
                Ferien und unterrichtsfreie Tage aus dem Schulkalender, die schon
                als freie Tage der App im Kalender stehen. Termine deiner Klasse
                und Aufgaben fallen hier nie weg.
              </p>
            </div>
          </details>
        ) : null}

        {aktiv && status.exerciseFields ? (
          <p className="text-[0.8125rem] text-subtle">
            Aufgaben-Format erkannt: {status.exerciseFields}
          </p>
        ) : null}

        {aktiv && status.warning ? (
          <p className="rounded-control border border-warning/40 px-3.5 py-3 text-sm text-warning">
            {status.warning}
          </p>
        ) : null}

        {(aktiv || state.kind === "blockiert") && status.lastError ? (
          <p className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger">
            Letzter Fehler, {zeitpunkt(status.lastError.at)}: {status.lastError.sentence}
          </p>
        ) : null}

        {aktiv && status.staleSince ? (
          <p className="rounded-control border border-warning/40 px-3.5 py-3 text-sm text-warning">
            Seit {zeitpunkt(status.staleSince)} kam kein Stand aus IServ an. Die
            Termine aus IServ in „Schule“ sind womöglich nicht aktuell. Auf dem
            NAS nachsehen:{" "}
            <code className="break-all">sudo tail -n 5 /volume1/docker/schulapp/kalender.log</code>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
