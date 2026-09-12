import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatCountdown, formatGerman, todayInBerlin } from "@/lib/dates";
import { listExams } from "@/lib/exams";
import { transcriptPreview } from "@/lib/transcripts";
import { stoffZuKlausur } from "@/recall/source";

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
  const { klausur } = await searchParams;

  const klausuren = await listExams(user.id);
  const kommende = klausuren.filter((k) => k.date >= heute);

  const gewaehlt =
    typeof klausur === "string" ? await stoffZuKlausur(user.id, klausur) : null;

  if (gewaehlt) {
    const farbe = subjectColor(gewaehlt.subjectColor);
    const ohneVerknuepfung = gewaehlt.themen.filter((t) => !t.verknuepft);
    const ohneSeiten = gewaehlt.themen.filter(
      (t) => t.verknuepft && t.seiten.length === 0,
    );

    return (
      <div className="space-y-6 md:max-w-3xl">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">
            Stoff der Klausur
          </h1>
          <p className="text-sm text-muted">
            <span style={{ color: farbe.hex }}>{gewaehlt.subjectName}</span> ·{" "}
            {formatGerman(gewaehlt.klausurtag, "lang")} ·{" "}
            {formatCountdown(heute, gewaehlt.klausurtag)} ·{" "}
            <Link
              href="/abruf/klausur"
              className="underline underline-offset-2"
            >
              andere Klausur
            </Link>
          </p>
        </header>

        <Card
          style={{
            backgroundColor: `color-mix(in oklab, ${farbe.hex} 7%, var(--surface))`,
          }}
        >
          <CardContent className="space-y-1">
            <p className="text-foreground">
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
            <p className="text-sm text-muted">
              {gewaehlt.themen.length === 0 ? (
                <>
                  Die Themen sind der Schlüssel zum Stoff: Sie sagen, welche
                  Blätter dazugehören. Häng sie unter{" "}
                  <Link
                    href={`/klausuren/${gewaehlt.examId}`}
                    className="underline underline-offset-2"
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

        {ohneVerknuepfung.length > 0 ? (
          <Card className="border-warning/40">
            <CardContent className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {ohneVerknuepfung.length}{" "}
                {ohneVerknuepfung.length === 1 ? "Thema ist" : "Themen sind"}{" "}
                mit keinem Blatt verbunden
              </p>
              <p className="text-sm text-muted">
                {ohneVerknuepfung.map((t) => t.title).join(", ")} — auf der
                Klausur steht nur der Text, nicht die Vokabel des Fachs. Von
                dort führt kein Weg zu Blättern. Das lässt sich unter{" "}
                <Link
                  href={`/klausuren/${gewaehlt.examId}`}
                  className="underline underline-offset-2"
                >
                  Klausuren
                </Link>{" "}
                beheben.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {ohneSeiten.length > 0 ? (
          <Card className="border-warning/40">
            <CardContent className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {ohneSeiten.length}{" "}
                {ohneSeiten.length === 1 ? "Thema hat" : "Themen haben"} kein
                abgeschriebenes Blatt
              </p>
              <p className="text-sm text-muted">
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
            <h2 className="text-sm font-medium text-muted">
              Themen und ihre Seiten
            </h2>

            <ul className="space-y-3">
              {gewaehlt.themen.map((thema) => (
                <li key={thema.examTopicId}>
                  <Card>
                    <CardContent className="space-y-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="font-medium text-foreground">
                          {thema.title}
                        </p>
                        <span className="text-xs text-subtle">
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
                              className="text-sm text-muted"
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
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          Stoff einer Klausur
        </h1>
        <p className="text-sm text-muted">
          Für welche Klausur? Ihre Themen sagen, welche Blätter dazugehören.
        </p>
      </header>

      {kommende.length === 0 ? (
        <EmptyState
          title="Keine Klausur eingetragen"
          description="Der Stoff hängt an den Themen einer Klausur. Trag eine ein, häng die Themen dran, dann steht hier, welche Blätter dazu passen."
          action={
            <ButtonLink href="/klausuren/neu">Klausur eintragen</ButtonLink>
          }
        />
      ) : (
        <ul className="space-y-3">
          {kommende.map((k) => {
            const farbe = subjectColor(k.subject.color);
            return (
              <li key={k.id}>
                <Link href={`/abruf/klausur?klausur=${k.id}`} className="block">
                  <Card
                    className="transition-shadow hover:shadow-lift"
                    style={{
                      backgroundColor: `color-mix(in oklab, ${farbe.hex} 7%, var(--surface))`,
                    }}
                  >
                    <CardContent className="space-y-1">
                      <p className="font-medium text-foreground">
                        {k.title ?? k.subject.name}
                      </p>
                      <p className="text-xs" style={{ color: farbe.hex }}>
                        {k.subject.name} · {formatGerman(k.date, "kurz")} ·{" "}
                        {formatCountdown(heute, k.date)} · {k.topicCount}{" "}
                        {k.topicCount === 1 ? "Thema" : "Themen"}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
