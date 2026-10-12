import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/app/(app)/material/eingang/proposal-form";
import { ButtonLink } from "@/components/kombi/form";
import { Card, CardContent } from "@/components/kombi/form";
import { EmptyState } from "@/components/kombi/form";
import { Icon } from "@/components/kombi/icon";
import { requireUser } from "@/lib/auth";
import { claudeConfigured } from "@/lib/claude/client";
import {
  daysBetween,
  formatCountdown,
  formatGerman,
  todayInBerlin,
} from "@/lib/dates";
import { listExams, type ExamListItem } from "@/lib/exams";
import { fragenLaufenGerade, fragenStand } from "@/lib/fragenlauf";
import { laufAnzeige } from "@/lib/leser/claude-ablauf";
import { letzterFragenLauf } from "@/lib/leser/laeufe";
import { transcriptPreview } from "@/lib/transcripts";
import { stoffZuKlausur } from "@/recall/source";

import { fragenBauenLassenAction } from "../actions";
import { NeuLadenWaehrendFragen } from "./neu-laden";

/**
 * Der Weg, den der Nutzer beschrieben hat: von der Klausur zu ihrem Stoff.
 *
 * „Ich stelle einen Test ein, dann kommen die Themen dran, und daraus wird der
 * Lernstoff gemacht." Nicht „wähle ein Blatt" — man lernt für eine Klausur und
 * nicht für einen Stapel. Die Klausur sagt, WAS geprüft wird, ihre Themen sind
 * der Schlüssel, und darüber sind genau die Blätter erreichbar, die dazu
 * gehören. Welches Blatt zu welchem Thema gehört, weiß die App längst.
 *
 * ── Warum hier Zahlen stehen und nicht nur Namen ─────────────────────────────
 *
 * Weil die beiden Fälle, in denen dieser Weg ins Leere führt, nur an einer Zahl
 * zu erkennen sind:
 *
 *   Ein Thema OHNE Verknüpfung ist freier Text auf der Klausur und hängt an
 *   keiner Vokabel des Fachs. Von dort gibt es keinen Weg zu Blättern — nicht
 *   weil nichts da wäre, sondern weil die Verbindung fehlt. Das steht hier als
 *   eigener Satz, damit niemand seine Blätter verdächtigt.
 *
 *   Ein Thema im FALSCHEN FACH findet seine Blätter nicht, obwohl sie
 *   existieren. Am 11.9.2026 in den echten Daten gemessen: „El Niño", „Smart
 *   Cities", „Containerschifffahrt" und „Standortwahl" standen unter
 *   Mathematik statt Geografie. Eine Geografie-Klausur mit null Seiten ist
 *   dann kein leeres Heft, sondern ein falsch einsortiertes Thema.
 */

export const metadata: Metadata = {
  title: "Stoff einer Klausur",
};

export default async function KlausurStoffPage({
  searchParams,
}: PageProps<"/abruf/klausur">) {
  const user = await requireUser();
  const heute = todayInBerlin();
  const { klausur: gewuenscht, id } = await searchParams;
  // `?id=` ist der Weg von der Klausurseite (Plan 2.2), `?klausur=` der alte.
  const klausur = gewuenscht ?? id;

  // MIT den geschriebenen. Ohne sie war diese Seite genau dann unerreichbar,
  // wenn man sie braucht: Am 12.9.2026 lagen alle drei Prüfungen der App in der
  // Vergangenheit, die Seite sagte „Keine Klausur eingetragen" — und zu keinem
  // Stoff führte mehr ein Weg, obwohl die Blätter dalagen. Eine geschriebene
  // Klausur ist auch kein toter Posten: Ihre Themen sind derselbe Schlüssel zu
  // denselben Blättern, und nach der Arbeit lernt man weiter (die
  // Erhaltungstermine liegen ausdrücklich DANACH, siehe schedule.ts).
  const klausuren = await listExams(user.id, { includePast: true });
  const kommende = klausuren.filter((k) => k.date >= heute);
  const geschrieben = klausuren
    .filter((k) => k.date < heute)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const gewaehlt =
    typeof klausur === "string" ? await stoffZuKlausur(user.id, klausur) : null;

  if (gewaehlt) {
    const ohneVerknuepfung = gewaehlt.themen.filter((t) => !t.verknuepft);
    const ohneSeiten = gewaehlt.themen.filter(
      (t) => t.verknuepft && t.seiten.length === 0,
    );

    /*
     * Claude an der Klausur: der letzte Fragenlauf und der Knopf „Fragen
     * bauen lassen“ (seit dem 11.10.2026, als die App Opus selbst zu rufen
     * begann — bis dahin harness/fragen.mts, von Hand im Container).
     *
     * Der Knopf steht nur da, wo er etwas tun kann: dieselbe Rechnung, nach
     * der der Lauf entscheidet (`fragenStand()` in @/lib/fragenlauf). Sonst
     * steht ihr Grund da — liegen noch Fragen unentschieden im Eingang, ist
     * der nächste Schritt dort und nicht hier. Ohne Schlüssel steht statt des
     * Knopfes ein Satz, wie am Blatt.
     *
     * Die Zeile „Zuletzt …“ steht, sobald es einen Lauf gab: ein
     * „kein Vorschlag“ samt Grund stand bis dahin nur im Protokoll des
     * Containers, und dort las es niemand.
     */
    const [stand, letzter] = await Promise.all([
      fragenStand(user.id, gewaehlt),
      letzterFragenLauf(user.id, gewaehlt.examId),
    ]);
    const konfiguriert = claudeConfigured();
    const baut = fragenLaufenGerade(user.id, gewaehlt.examId);
    const zeigeFragen = gewaehlt.seitenGesamt.length > 0 || letzter !== null || baut;

    return (
      <div className="kf-seite">
        <header className="space-y-1">
          <h2 className="p-title">
            Stoff der Klausur
          </h2>
          <p className="text-[15px] text-ink-2">
            <span>{gewaehlt.subjectName}</span> ·{" "}
            {formatGerman(gewaehlt.klausurtag, "lang")} ·{" "}
            {formatCountdown(heute, gewaehlt.klausurtag)} ·{" "}
            <Link
              href="/abruf/klausur"
              className="kf-inline underline underline-offset-2"
            >
              andere Klausur
            </Link>
          </p>
        </header>

        <Card
        >
          <CardContent className="space-y-1">
            <p className="text-ink">
              {/* Drei Fälle und nicht zwei. „Kein Stoff erreichbar" stimmt
                  auch bei einer Klausur ohne jedes Thema — es ist nur die
                  falsche Auskunft: Dort fehlt nicht das Blatt, sondern der
                  Schlüssel dazu, und der nächste Schritt ist ein anderer. Im
                  Browser aufgefallen, wo unter der Meldung eine leere
                  Überschrift stand. */}
              {gewaehlt.themen.length === 0
                ? "Diese Klausur hat noch keine Themen."
                : gewaehlt.seitenGesamt.length === 0
                  ? "Zu dieser Klausur ist kein abgeschriebener Stoff erreichbar."
                  : `${gewaehlt.seitenGesamt.length} ${gewaehlt.seitenGesamt.length === 1 ? "Seite" : "Seiten"} mit Abschrift, ${gewaehlt.zeichenGesamt.toLocaleString("de-DE")} Zeichen.`}
            </p>
            <p className="text-[15px] text-ink-2">
              {gewaehlt.themen.length === 0 ? (
                <>
                  Die Themen sind der Schlüssel zum Stoff: Sie sagen, welche
                  Blätter dazugehören. Häng sie unter{" "}
                  <Link
                    href={`/klausuren/${gewaehlt.examId}`}
                    className="kf-inline underline underline-offset-2"
                  >
                    Klausuren
                  </Link>{" "}
                  an, dann führt der Weg von hier zu den Seiten.
                </>
              ) : (
                "Daraus entstehen die Fragen — jede mit einem wörtlichen Zitat aus dem Heft."
              )}
            </p>
          </CardContent>
        </Card>

        {zeigeFragen ? (
          <Card>
            <CardContent className="space-y-3">
              <p className="text-[15px] font-[560] text-ink">
                Fragen bauen lassen
              </p>

              {letzter ? (
                <p className="text-[15px] text-ink-2">{laufAnzeige(letzter)}</p>
              ) : null}

              {baut ? (
                <>
                  <p className="text-[15px]">
                    Claude baut gerade Fragen aus diesem Stoff … das dauert
                    ein, zwei Minuten. Sie landen als Vorschlag im{" "}
                    <Link
                      href="/abruf/eingang"
                      className="kf-inline underline underline-offset-2"
                    >
                      Eingang
                    </Link>
                    , und diese Seite lädt von selbst nach.
                  </p>
                  <NeuLadenWaehrendFragen />
                </>
              ) : !konfiguriert ? (
                <p className="text-[15px] text-ink-2">
                  Auf diesem Server ist kein API-Schlüssel eingerichtet — es
                  fehlt <code>ANTHROPIC_API_KEY</code>. Fragen lassen sich
                  deshalb nur von Hand anlegen.
                </p>
              ) : "wieviele" in stand.was ? (
                <>
                  <p className="text-[15px] text-ink-2">
                    {`Claude kann aus diesem Stoff ${stand.was.wieviele} ${stand.was.wieviele === 1 ? "Frage" : "Fragen"} bauen, über alle Themen verteilt. Sie landen als ein Vorschlag im Eingang; übernommen wird nur, was du auswählst, und jedes Zitat wird dabei gegen die Abschrift geprüft. Ein Lauf kostet Geld vom API-Schlüssel, und was er gekostet hat, steht danach hier.`}
                  </p>
                  <form
                    action={fragenBauenLassenAction.bind(null, gewaehlt.examId)}
                  >
                    <SubmitButton>Fragen bauen lassen</SubmitButton>
                  </form>
                </>
              ) : (
                <p className="text-[15px] text-ink-2">
                  {`Gerade keine neuen Fragen: ${stand.was.nichts}.`}
                  {stand.auskunft.daten.stock.openQuestions > 0 ? (
                    <>
                      {" "}
                      <Link
                        href="/abruf/eingang"
                        className="kf-inline underline underline-offset-2"
                      >
                        Zum Eingang
                      </Link>
                    </>
                  ) : null}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {ohneVerknuepfung.length > 0 ? (
          <Card className="border-line">
            <CardContent className="space-y-1">
              <p className="text-[15px] font-[560] text-ink">
                {ohneVerknuepfung.length}{" "}
                {ohneVerknuepfung.length === 1 ? "Thema ist" : "Themen sind"}{" "}
                mit keinem Blatt verbunden
              </p>
              <p className="text-[15px] text-ink-2">
                {ohneVerknuepfung.map((t) => t.title).join(", ")} — auf der
                Klausur steht nur der Text, nicht die Vokabel des Fachs. Von
                dort führt kein Weg zu Blättern. Das lässt sich unter{" "}
                <Link
                  href={`/klausuren/${gewaehlt.examId}`}
                  className="kf-inline underline underline-offset-2"
                >
                  Klausuren
                </Link>{" "}
                beheben.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {ohneSeiten.length > 0 ? (
          <Card className="border-line">
            <CardContent className="space-y-1">
              <p className="text-[15px] font-[560] text-ink">
                {ohneSeiten.length}{" "}
                {ohneSeiten.length === 1 ? "Thema hat" : "Themen haben"} kein
                abgeschriebenes Blatt
              </p>
              <p className="text-[15px] text-ink-2">
                {ohneSeiten.map((t) => t.title).join(", ")} — entweder ist noch
                kein Blatt dazu abfotografiert, oder es ist noch nicht
                abgeschrieben. Prüf auch, ob das Thema im richtigen Fach hängt;
                ein Thema im falschen Fach findet seine Blätter nicht.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {gewaehlt.themen.length > 0 ? (
          <section className="space-y-3">
            <h2 className="p-lab">
              Themen und ihre Seiten
            </h2>

            <ul>
              {gewaehlt.themen.map((thema) => (
                <li key={thema.examTopicId}>
                  <Card>
                    <CardContent className="space-y-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="font-[560] text-ink">
                          {thema.title}
                        </p>
                        <span className="text-[13px] text-ink-3">
                          {!thema.verknuepft
                            ? "nicht verbunden"
                            : thema.seiten.length === 0
                              ? "kein Blatt"
                              : `${thema.seiten.length} ${thema.seiten.length === 1 ? "Seite" : "Seiten"}`}
                        </span>
                      </div>

                      {thema.seiten.length > 0 ? (
                        <ul className="space-y-1.5">
                          {thema.seiten.map((seite) => (
                            <li
                              key={seite.pageId}
                              className="text-[15px] text-ink-2"
                            >
                              {transcriptPreview(seite.transcript, 90)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {gewaehlt.seitenGesamt.length > 0 ? (
          <ButtonLink href="/abruf/bausteine/neu" variant="secondary">
            Frage von Hand anlegen
          </ButtonLink>
        ) : null}
      </div>
    );
  }

  return (
    <div className="kf-seite">
      <header className="space-y-1">
        <h2 className="p-title">
          Stoff einer Klausur
        </h2>
        <p className="text-[15px] text-ink-2">
          Für welche Klausur? Ihre Themen sagen, welche Blätter dazugehören.
        </p>
      </header>

      {klausuren.length === 0 ? (
        <EmptyState
          title="Keine Klausur eingetragen"
          description="Der Stoff hängt an den Themen einer Klausur. Trag eine ein, häng die Themen dran, dann steht hier, welche Blätter dazu passen."
          action={
            <ButtonLink href="/klausuren/neu">Klausur eintragen</ButtonLink>
          }
        />
      ) : (
        <>
          {kommende.length > 0 ? (
            <ul>
              {kommende.map((k) => (
                <KlausurZeile key={k.id} klausur={k} heute={heute} />
              ))}
            </ul>
          ) : (
            <Card>
              <CardContent className="space-y-1">
                <p className="text-ink">Keine Klausur steht an.</p>
                <p className="text-[15px] text-ink-2">
                  Der Stoff der geschriebenen bleibt trotzdem erreichbar — die
                  Themen sind dieselben, und die Blätter auch.{" "}
                  <Link
                    href="/klausuren/neu"
                    className="kf-inline underline underline-offset-2"
                  >
                    Nächste Klausur eintragen
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          )}

          {geschrieben.length > 0 ? (
            <section className="space-y-3">
              <h2 className="p-lab">
                Schon geschrieben
              </h2>
              <ul>
                {geschrieben.map((k) => (
                  <KlausurZeile key={k.id} klausur={k} heute={heute} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Eine Klausur in der Liste.
 *
 * Als eigene Funktion, weil sie jetzt zweimal vorkommt — oben die kommenden,
 * darunter die geschriebenen. Zwei Kopien desselben Kartenaufbaus wären die
 * Art Verdopplung, bei der die zweite nach dem dritten Feinschliff anders
 * aussieht als die erste.
 */
function KlausurZeile({
  klausur,
  heute,
}: {
  klausur: ExamListItem;
  heute: string;
}) {
  const vorbei = klausur.date < heute;

  return (
    <li>
      <Link href={`/abruf/klausur?klausur=${klausur.id}`} className="lrow plain">
        <span>
          <b>{klausur.title ?? klausur.subject.name}</b>
          <span className="s">
            {klausur.subject.name} · {formatGerman(klausur.date, "kurz")} ·{" "}
            {/* „vor 3 Tagen" statt „in -3 Tagen": bei einer geschriebenen
                Klausur ist der Abstand kein Countdown mehr. */}
            {vorbei
              ? `geschrieben${daysBetween(klausur.date, heute) > 0 ? ` vor ${daysBetween(klausur.date, heute)} ${daysBetween(klausur.date, heute) === 1 ? "Tag" : "Tagen"}` : " heute"}`
              : formatCountdown(heute, klausur.date)}{" "}
            · {klausur.topicCount} {klausur.topicCount === 1 ? "Thema" : "Themen"}
          </span>
        </span>
        <Icon name="chevron_right" />
      </Link>
    </li>
  );
}
