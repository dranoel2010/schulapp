import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { formatGerman, germanShortParts } from "@/lib/dates";
import { formatAverage } from "@/lib/grade-scale";
import { countedGrades, dayLine, lessonRoom, type HomeData } from "@/lib/home";

/**
 * Das Kachelmenü fürs Handy — die Startansicht auf schmalen Bildschirmen.
 *
 * Ein Raster großer Flächen, jede führt in ihren Bereich. Die Maße stammen aus
 * dem Entwurf und sind auf ein 390px breites Gerät gerechnet; deshalb stehen
 * hier feste Pixelwerte, wo es kein passendes Token gibt.
 *
 * Die Seite trägt ihre Ränder selbst: Kopfzeile 20/22/16, Raster 0/14/18. Am
 * Handy steckt sie in der Wischhülle, die keinen eigenen Rand setzt — sonst
 * käme ein zweiter Rand obendrauf und die Kacheln würden schmaler als
 * gezeichnet. Kopfzeile und Raster sind unterschiedlich weit eingerückt: die
 * Schrift steht auf 22px, die Kacheln liegen mit 14px näher am Rand.
 *
 * Das Raster liegt auf flex-1 mit gleich hohen Reihen: die Kacheln füllen den
 * Bildschirm, so wie im Entwurf gezeichnet. Dafür muss die Flex-Kette von
 * <body> über das Layout bis hierher durchgehen — reißt sie an einer Stelle,
 * fallen die Kacheln auf ihre Mindesthöhe zurück.
 *
 * Ehrlichkeit vor Vollständigkeit: jede Kachel zeigt nur, was auch in der
 * Datenbank steht. Ohne Note bleibt die große Zahl der Noten-Kachel weg, ohne
 * Termin die der Klausuren-Kachel, und auf der Stundenplan-Kachel steht ein
 * Strich statt einer Uhrzeit, solange kein Plan eingetragen ist. Aus demselben
 * Grund fehlt der Trend, den der Entwurf neben den Schnitt setzt — die App
 * hebt keinen alten Stand auf, gegen den sie rechnen könnte.
 *
 * Die Kopfzeile bringt die Komponente selbst mit. Ums Ausblenden ab mittlerer
 * Breite kümmert sich die Startseite.
 */

/** Gemeinsame Form aller Kacheln, unabhängig von der Variante. */
const TILE_SHAPE =
  "flex min-h-[116px] flex-col justify-between rounded-[20px] p-[18px] text-left";

const LABEL = "text-[15px] leading-snug";

// Der Entwurf setzt die großen Zahlen in Geist, nicht in Geist Mono — Mono
// steht dort nur in der Statusleiste und an den Uhrzeiten des Kalenders.
const VALUE =
  "block text-[42px] font-semibold leading-none tracking-[-0.03em] tabular-nums";

const CAPTION = "block text-[14px] leading-snug";

type TileProps = {
  label: string;
  /** Große Zahl oder Wort. Fehlt, wenn es nichts zu zählen gibt. */
  value?: string;
  caption: string;
  href: string;
  /** Nur die erste Kachel trägt den Akzent. */
  highlighted?: boolean;
  /**
   * Färbt allein die Caption warnend. Im Entwurf ist das die einzige Farbe im
   * Raster außer dem Akzent — sie bleibt deshalb den Hausaufgaben vorbehalten.
   */
  warning?: boolean;
};

function Tile({
  label,
  value,
  caption,
  href,
  highlighted = false,
  warning = false,
}: TileProps) {
  // Auf der Akzentfläche trägt der Nebentext keine eigene Farbe, sondern
  // weniger Deckkraft — sonst müsste jede Textfarbe zweimal gedacht werden.
  const quiet = highlighted ? "opacity-[0.85]" : "text-muted";
  const captionTone = warning && !highlighted ? "text-warning" : quiet;

  return (
    <Link
      href={href}
      className={[
        TILE_SHAPE,
        "transition-colors duration-150",
        highlighted
          ? "bg-accent text-accent-foreground hover:bg-accent-hover"
          : "bg-surface-muted text-foreground hover:bg-border",
      ].join(" ")}
    >
      <span className={`${LABEL} ${quiet}`}>{label}</span>

      <span className="block">
        {value ? <span className={VALUE}>{value}</span> : null}
        <span className={`${CAPTION} ${captionTone} ${value ? "mt-1.5" : ""}`}>
          {caption}
        </span>
      </span>
    </Link>
  );
}

/**
 * Das Zahnrad in der Kopfzeile. Die Tippfläche ist volle 44px groß, sitzt aber
 * mit -10px Rand so weit außen, dass das Symbol optisch auf der Randlinie der
 * Kopfzeile steht — groß genug für den Daumen, ohne den Text zu verschieben.
 */
function SettingsLink() {
  return (
    <Link
      href="/einstellungen"
      aria-label="Einstellungen"
      className="-mr-[10px] flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[14px] bg-transparent text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        width={22}
        height={22}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19.4 14.6a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.69 2.69l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.69-2.69l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.6a1.9 1.9 0 1 1 0-3.8h.09a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06A1.9 1.9 0 1 1 7.47 4.4l.06.06a1.6 1.6 0 0 0 1.77.32h.08A1.6 1.6 0 0 0 10.35 3.3v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.9 1.9 0 1 1 2.69 2.69l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.47.97Z" />
      </svg>
    </Link>
  );
}

export function HomeTiles({ data }: { data: HomeData }) {
  const hasSubjects = data.subjectCount > 0;

  let learnValue: string | undefined;
  let learnCaption: string;

  if (data.todayOpenMinutes > 0) {
    learnValue = String(data.todayOpenMinutes);
    learnCaption = "Minuten heute";
  } else if (data.todayDoneCount > 0) {
    learnValue = String(data.todayDoneCount);
    learnCaption = "heute geschafft";
  } else {
    learnCaption = "heute nichts geplant";
  }

  const days = data.daysToNextExam;
  const nextShort = data.nextExam?.subject.short ?? "";

  let examValue: string | undefined;
  let examCaption: string;

  if (days === null) {
    examCaption = "nichts eingetragen";
  } else if (days === 0) {
    // "0 Tage bis Ma" liest niemand gern — heute heißt heute.
    examValue = "heute";
    examCaption = `${nextShort} steht an`;
  } else {
    examValue = String(days);
    examCaption = days === 1 ? `Tag bis ${nextShort}` : `Tage bis ${nextShort}`;
  }

  // Die Zahl sind die offenen Aufgaben, die Zeile darunter sagt, was davon
  // drängt. Überfälliges hat Vorrang: es ist die schlechtere Nachricht und
  // deshalb die, die zuerst gelesen werden muss.
  const { open, overdue, dueToday } = data.homeworkCounts;

  let homeworkCaption: string;

  if (overdue > 0) {
    homeworkCaption = `${overdue} überfällig`;
  } else if (dueToday === 0) {
    homeworkCaption = "nichts heute fällig";
  } else {
    homeworkCaption = `${dueToday} heute fällig`;
  }

  // Der Entwurf setzt unter den Schnitt einen Trend („▲ 0,2“) in Grün. Den
  // gibt es nicht: die App hebt keinen Vergleichsstand von Juli auf, sie kennt
  // also keine Bewegung. An seiner Stelle steht eine wahre Angabe, und zwar in
  // der normalen Kachelfarbe — Grün wäre schon die halbe Behauptung, es ginge
  // aufwärts.
  const overall = data.grades.overall;
  const gradeCount = countedGrades(data.grades);

  let gradeValue: string | undefined;
  let gradeCaption: string;

  if (overall === null) {
    // Wie bei den Klausuren ohne Termin: keine Zahl, nur der Hinweis, dass
    // hier noch nichts steht. Die Kachel führt trotzdem zu den Noten, denn
    // genau dort fehlt ja etwas.
    gradeCaption = "nichts eingetragen";
  } else {
    // Eine Nachkommastelle: auf einer Kachel zählt der Eindruck, nicht die
    // zweite Stelle. Genauer steht der Schnitt auf der Notenseite.
    gradeValue = formatAverage(overall, 1);
    gradeCaption = gradeCount === 1 ? "aus 1 Note" : `aus ${gradeCount} Noten`;
  }

  const next = data.nextLesson;

  let planValue: string;
  let planCaption: string;

  if (!next) {
    // Ohne eingetragene Stunden gibt es keine nächste — dann steht dort ein
    // Strich und der Weg dorthin, keine erfundene Uhrzeit. Die Kachel führt
    // trotzdem in den Stundenplan, denn genau dort fehlt ja etwas.
    planValue = "–";
    planCaption = "eintragen";
  } else {
    // Zweistellig wie im Entwurf: aus "08:50" wird "08". Die Minuten stehen
    // in der Tagesspur, hier zählt die Stunde.
    planValue = next.startsAt.slice(0, 2);

    const room = lessonRoom(next.lesson);
    const where = room
      ? `${next.lesson.subject.name}, ${room}`
      : next.lesson.subject.name;

    // "Mo · Mathe, A203": das Kürzel nur, wenn die Stunde nicht mehr heute
    // ist. Im Kachelmenü ist der Platz auf eine Zeile begrenzt — das ganze
    // Datum passte nicht daneben.
    planCaption = next.isToday
      ? where
      : `${germanShortParts(next.date).weekday} · ${where}`;
  }

  return (
    // Normalerweise füllt das Raster den Bildschirm genau aus. Bleibt darüber
    // eine Nachfrage stehen, wird es enger als seine Mindesthöhe — dann muss
    // sich der Rest schieben lassen, sonst verschluckt ihn die Wischhülle.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      <header className="flex items-end justify-between gap-4 px-[22px] pt-[20px] pb-[16px]">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-none tracking-[-0.03em]">
            {formatGerman(data.today, "kurz")}
          </h1>
          <p className="mt-2 text-[14px] leading-snug text-muted">
            {hasSubjects ? dayLine(data) : "noch keine Fächer angelegt"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-[10px]">
          <p className="text-[13px] leading-snug text-subtle">
            {data.userName}
          </p>
          <SettingsLink />
        </div>
      </header>

      {/* Der Eingangskorb bekommt keine siebte Kachel: das Raster ist eigens
          auf sechs getrimmt, damit es auf einen Bildschirm passt, und eine
          Kachel, die an den meisten Tagen „0“ zeigt, wäre den Platz nicht
          wert. Er meldet sich stattdessen dann, wenn etwas liegt — als
          schmaler Streifen über den Kacheln, der wegbleibt, sobald der Korb
          leer ist. Ehrlichkeit vor Vollständigkeit, dieselbe Regel wie bei den
          Kacheln selbst.

          Eine Zeile und kein Absatz: jede zusätzliche Zeile schiebt die untere
          Kachelreihe aus dem Bild, und dass die sechs Kacheln auf einen
          Bildschirm passen, war eigens hergestellt. Was der Korb ist, steht
          auf seiner eigenen Seite — hier steht, dass etwas liegt.

          Ohne Fächer kann es keine Blätter geben und damit auch keine
          Vorschläge — die beiden Hinweise stehen deshalb nie zugleich da. */}
      {data.openProposals > 0 ? (
        <Link
          href="/eingang"
          className="mx-[14px] mb-[10px] flex items-center justify-between gap-3 rounded-[20px] bg-accent-soft px-[18px] py-[11px] transition-colors duration-150 hover:bg-border"
        >
          <span className="min-w-0 truncate text-[15px] font-medium text-accent">
            {data.openProposals === 1
              ? "Ein Vorschlag wartet im Eingangskorb"
              : `${data.openProposals} Vorschläge warten im Eingangskorb`}
          </span>
          <span aria-hidden="true" className="shrink-0 text-[18px] text-accent">
            →
          </span>
        </Link>
      ) : null}

      {/* Ohne Fächer hängt alles andere in der Luft — dann steht der Weg
          dorthin vorn und das Raster tritt zurück. Der seitliche Rand ist der
          des Rasters, damit der Hinweis auf einer Linie mit den Kacheln steht. */}
      {hasSubjects ? null : (
        <div className="mx-[14px] mb-[10px] rounded-[20px] bg-surface p-[18px] shadow-soft">
          <p className="text-[15px] font-medium text-foreground">
            Zuerst die Fächer
          </p>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            Klausuren, Lernpläne und Noten hängen an deinen Fächern.
          </p>
          <ButtonLink href="/faecher" className="mt-4 w-full">
            Fächer anlegen
          </ButtonLink>
        </div>
      )}

      <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-[10px] px-[14px] pb-[18px]">
        {/* Immer in den Lernbereich — dort steht der Plan für heute. Die
            Klausur selbst wird woanders verwaltet. */}
        <Tile
          label="Lernen"
          value={learnValue}
          caption={learnCaption}
          href="/lernen"
          // Ohne Fächer gibt es nichts zu lernen — dann trägt die Kachel den
          // Akzent nicht, damit sie dem Hinweis darüber nicht die Schau stiehlt.
          highlighted={hasSubjects}
        />

        <Tile
          label="Klausuren"
          value={examValue}
          caption={examCaption}
          href="/klausuren"
        />

        <Tile
          label="Hausaufgaben"
          value={String(open)}
          caption={homeworkCaption}
          href="/hausaufgaben"
          // Die Warnfarbe steht nur da, wo auch wirklich etwas drängt —
          // "nichts heute fällig" in Bernstein wäre ein Alarm ohne Anlass.
          warning={overdue > 0 || dueToday > 0}
        />

        <Tile
          label="Noten"
          value={gradeValue}
          caption={gradeCaption}
          href="/noten"
        />

        <Tile
          label="Stundenplan"
          value={planValue}
          caption={planCaption}
          href="/stundenplan"
        />

        <Tile
          label="Fächer"
          value={String(data.subjectCount)}
          caption="verwalten"
          href="/faecher"
        />
      </div>
    </div>
  );
}
