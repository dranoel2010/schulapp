import Link from "next/link";

import { CaptureButton } from "@/components/material/capture-button";
import { germanShortParts } from "@/lib/dates";
import { captureSubject, type HomeData } from "@/lib/home";

/**
 * Die Kameraseite der Startseite — die linke der drei Seiten in der Wischhülle.
 *
 * Sie liegt links vom Raster, weil rechts der Kalender liegt: der Weg zur
 * Kamera ist die Wischrichtung, in der nicht der Tagesablauf steht. Am Handy
 * ist das die kürzeste Geste, die es gibt, und genau darum geht es hier — im
 * Unterricht bleiben für ein abfotografiertes Arbeitsblatt zwei Sekunden.
 *
 * Die Maße sind die des Kachelmenüs: Kopfzeile auf 22px eingerückt, Inhalt auf
 * 14px, und die Seite trägt ihre Ränder selbst, weil die Wischhülle keine
 * setzt. Die Überschrift steht als h2 da — die h1 der Startseite ist das Datum
 * auf der mittleren Seite, und beide Seiten stehen gleichzeitig im Dokument.
 *
 * Vorgeschlagen wird das Fach der Stunde, die gerade läuft oder heute noch
 * kommt. Weiß die App keine, entscheidet die Zahl der Fächer: bei mehreren
 * fragt der Auslöser selbst nach, bei genau einem fällt das Blatt dorthin —
 * und dann steht das im Satz über dem Knopf. Geraten wird nichts, und still
 * einsortiert schon gar nicht; ein Blatt im falschen Fach findet später
 * niemand wieder.
 *
 * Ein abgewähltes Fach wird nicht vorgeschlagen. Der Stundenplan kennt kein
 * Archiv — eine Stunde bleibt stehen, auch wenn ihr Fach zugemacht wurde, und
 * das ist dort Absicht. Hier wäre es einer: anders als in der Ablage gibt es
 * auf dieser Seite kein zweites Fach zum Gegensteuern, denn sobald ein
 * Vorschlag steht, versteckt der Auslöser seine Auswahl. Fällt der Vorschlag
 * weg, entscheidet der Nutzer — an der Auswahl des Auslösers, die dann wieder
 * dasteht, oder, wenn er nur ein einziges aktives Fach hat, mit dem Wissen aus
 * dem Satz darüber, wohin das Blatt geht.
 *
 * Die Fächer kommen mit HomeData herein. Die Seite könnte sie selbst holen,
 * hinge damit aber am Ende des kritischen Pfades von "/": sie rendert erst,
 * wenn `loadHomeData()` fertig ist, ihre Abfrage liefe also hinter allen
 * anderen statt neben ihnen. Dazu kommt, dass diese Server Component auch am
 * großen Bildschirm läuft, wo das Dashboard gezeigt wird — die Wischhülle
 * versteckt CSS, nicht der Server. Eine Abfrage für etwas Unsichtbares wäre
 * eine zu viel; oben in HomeData kostet die Liste keine Wartezeit. (Die
 * Sitzung war nie das Problem: `getSessionUser` ist mit `cache()` gebündelt
 * und liest je Anfrage einmal, egal wie viele Komponenten fragen.)
 *
 * Die letzten Blätter stehen als Raster von Vorschaubildern darunter, jedes ein
 * Weg zu seinem Blatt. Das ist die Bestätigung, die nach dem Auslösen fehlt:
 * man sieht, dass das Foto angekommen ist, ohne die Ablage zu öffnen.
 *
 * Die Reihenfolge ist die der Aufnahme — erst dadurch sagt die Überschrift
 * „Zuletzt aufgenommen“ die Wahrheit. Das Datum unter dem Bild ist ein
 * anderes: `capturedOn` ist der Schultag, von dem das Blatt stammt, und nicht
 * der Zeitpunkt, an dem es fotografiert wurde. Damit niemand das eine für das
 * andere hält, steht es mit demselben „vom“ da, das auch das Formular und
 * der Titel eines frischen Blattes benutzen („Blatt vom 21.8.“).
 *
 * Die Bilder kommen als schlichtes <img> vom Route Handler und nicht über
 * next/image, weil der Bildoptimierer ohne Session-Cookie anfragt und ein
 * Schulblatt in keinen allgemeinen Bildcache gehört.
 */

export function CapturePane({ data }: { data: HomeData }) {
  const subjects = data.subjects;

  // `captureSubject()` lässt abgewählte Fächer schon selbst draußen. Hier steht
  // die zweite Tür: `subjects` sind die aktiven Fächer, und was der Auslöser
  // nicht anbieten würde, wird auch nicht vorbelegt. Die Prüfung kostet nichts
  // und hält, falls die Auswahl einmal enger wird als der Stundenplan.
  const suggested = captureSubject(data);
  const proposed =
    suggested && subjects.some((subject) => subject.id === suggested.id)
      ? suggested
      : null;

  // In welches Fach die nächste Aufnahme wirklich fällt — dieselbe Rechnung wie
  // in der Ablage (src/app/(app)/material/page.tsx). Ohne Vorschlag belegt der
  // Auslöser bei genau einem Fach von sich aus vor und versteckt dann seine
  // Auswahl. Stünde hier weiter „wähl es selbst“, verlangte der Satz etwas,
  // wofür es kein Feld gibt, und das Blatt fiele still in ein Fach, das
  // nirgends stand. Die Regel gilt ohne Ausnahme: wo ein Fach vorbelegt ist,
  // steht es auf dem Bildschirm.
  const onlyActive = subjects.length === 1 ? (subjects[0] ?? null) : null;
  const preset = proposed ?? onlyActive;

  const lead = preset
    ? `Das Blatt landet in ${preset.name} — ändern kannst du das danach.`
    : "Gerade schlägt kein Stundenplan ein Fach vor — wähl es selbst.";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      <header className="px-[22px] pt-[20px] pb-[16px]">
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          Aufnehmen
        </h2>
        {/* Drei Lagen, drei Sätze. `subjects` sind nur die aktiven, `subjectCount`
            zählt auch die archivierten mit — erst beide zusammen unterscheiden
            „noch keins angelegt“ von „alle wieder zugemacht“. Ohne das stünde
            hier „Noch kein Fach angelegt.“, während eine Wischgeste weiter die
            Kachel „Fächer 3“ steht; zwei Sätze aus derselben Ladung, die sich
            widersprechen.

            Was zu tun ist, steht hier bewusst nicht: der Auslöser darunter
            kennt den Unterschied inzwischen selbst (`allArchived`) und hat den
            Weg als Knopf daneben. Der Rat gehört dorthin, wo er anklickbar ist,
            und stünde sonst zweimal übereinander — einmal als Satz, zehn Pixel
            tiefer noch einmal. Diese Zeile sagt nur den Zustand, genau wie im
            Fall ohne jedes Fach. */}
        <p className="mt-[2px] text-[14px] leading-snug text-muted">
          {subjects.length > 0
            ? lead
            : data.subjectCount > 0
              ? "Alle deine Fächer sind archiviert."
              : "Noch kein Fach angelegt."}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] px-[14px] pb-[18px]">
        <CaptureButton
          subjectId={preset?.id ?? null}
          subjects={subjects}
          today={data.today}
          allArchived={subjects.length === 0 && data.subjectCount > 0}
        />

        <section className="space-y-[10px]">
          <h3 className="text-[15px] font-medium text-foreground">
            Zuletzt aufgenommen
          </h3>

          {data.materials.length === 0 ? (
            <p className="text-[14px] leading-snug text-muted">
              Noch kein Blatt. Das erste steht gleich hier.
            </p>
          ) : (
            // Ein Raster, das umbricht, statt einer waagerecht scrollenden
            // Reihe: die waagerechte Geste gehört der Wischhülle. Sie nimmt
            // sie sich mit `touch-pan-y` auf ihrem Rahmen und einem
            // preventDefault auf jedem erkennbar waagerechten touchmove (siehe
            // swipe-pager.tsx), und das ist Absicht — ein Streifen hier ließe
            // sich am Finger überhaupt nicht schieben, stattdessen blätterte
            // die Startseite zum Kachelmenü. Was rechts aus dem Bild ragte,
            // wäre am Handy also unerreichbar.
            //
            // Drei Spalten passen auf jedes Handy: bei 390px Breite bleiben
            // nach den Rändern 362px, also 114px je Bild und mit dem
            // 3:4-Format 152px Höhe. Zwei Reihen samt Beschriftung sind rund
            // 360px — zusammen mit Kopfzeile, Auslöser und dem Weg in die
            // Ablage bleibt das unter einer Bildschirmhöhe. Mehr als sechs
            // Blätter holt die Startseite ohnehin nicht, und wird es doch
            // einmal eng, scrollt diese Seite für sich senkrecht; die
            // Wischhülle wächst dadurch nicht.
            <ul className="grid grid-cols-3 gap-[10px]">
              {data.materials.map((item) => (
                <li key={item.id}>
                  <Link href={`/material/${item.id}`} className="block">
                    <span className="block aspect-[3/4] overflow-hidden rounded-[14px] border border-border bg-surface-muted">
                      {item.coverPageId ? (
                        // eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache
                        <img
                          src={`/api/material/${item.coverPageId}/vorschau`}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover"
                        />
                      ) : null}
                    </span>
                    <span className="mt-[6px] block truncate text-[13px] leading-snug text-muted">
                      {item.subject.short} · vom{" "}
                      {germanShortParts(item.capturedOn).dayMonth}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Der leise Weg in die Ablage steht am Ende: hier wird aufgenommen,
            gesucht wird dort. */}
        <Link
          href="/material"
          className="-mx-[4px] mt-auto inline-flex min-h-11 items-center gap-1.5 self-start px-[4px] text-[14px] text-muted transition-colors hover:text-foreground"
        >
          Zur Ablage
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
