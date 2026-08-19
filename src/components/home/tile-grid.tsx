import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { formatCountdown, formatGerman } from "@/lib/dates";
import type { HomeData } from "@/lib/home";

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
 * Ehrlichkeit vor Vollständigkeit: Stundenplan, Hausaufgaben und Noten gibt es
 * noch nicht. Ihre Kacheln behalten die Form der anderen, sind aber sichtbar
 * zurückgenommen und nicht anklickbar — lieber eine sichtbare Lücke als eine
 * erfundene Zahl.
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
};

function Tile({ label, value, caption, href, highlighted = false }: TileProps) {
  // Auf der Akzentfläche trägt der Nebentext keine eigene Farbe, sondern
  // weniger Deckkraft — sonst müsste jede Textfarbe zweimal gedacht werden.
  const quiet = highlighted ? "opacity-[0.85]" : "text-muted";

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
        <span className={`${CAPTION} ${quiet} ${value ? "mt-1.5" : ""}`}>
          {caption}
        </span>
      </span>
    </Link>
  );
}

/**
 * Ein Bereich, den es noch nicht gibt. Die Fläche sieht aus wie die anderen,
 * damit das Raster seinen Rhythmus behält — aber sichtbar zurückgenommen und
 * ohne Link: was nirgendwohin führt, soll sich auch nicht anfassen lassen.
 * Eine erfundene Zahl stünde hier nicht, auch wenn der Entwurf eine zeigt.
 */
function SoonTile({ label }: { label: string }) {
  return (
    <div className={`${TILE_SHAPE} bg-surface-muted/60 text-subtle`}>
      <span className={LABEL}>{label}</span>
      <span className={CAPTION}>kommt noch</span>
    </div>
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

  // Die Zusammenfassung nennt nur, was wirklich in der Datenbank steht:
  // die heutigen Lernblöcke und die nächste Prüfung. Keine Schulstunden.
  const summary: string[] = [];

  if (!hasSubjects) {
    summary.push("noch keine Fächer angelegt");
  } else if (data.todayBlocks.length === 1) {
    summary.push("1 Lernblock heute");
  } else if (data.todayBlocks.length > 1) {
    summary.push(`${data.todayBlocks.length} Lernblöcke heute`);
  } else {
    summary.push("heute keine Lernblöcke");
  }

  if (data.nextExam) {
    summary.push(
      `${data.nextExam.subject.name} ${formatCountdown(
        data.today,
        data.nextExam.date,
      )}`,
    );
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
            {summary.join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-[10px]">
          <p className="text-[13px] leading-snug text-subtle">
            {data.userName}
          </p>
          <SettingsLink />
        </div>
      </header>

      {/* Ohne Fächer hängt alles andere in der Luft — dann steht der Weg
          dorthin vorn und das Raster tritt zurück. Der seitliche Rand ist der
          des Rasters, damit der Hinweis auf einer Linie mit den Kacheln steht. */}
      {hasSubjects ? null : (
        <div className="mx-[14px] mb-[10px] rounded-[20px] bg-surface p-[18px] shadow-soft">
          <p className="text-[15px] font-medium text-foreground">
            Zuerst die Fächer
          </p>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            Klausuren, Lernpläne und später auch Noten hängen an deinen Fächern.
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

        <SoonTile label="Hausaufgaben" />
        <SoonTile label="Noten" />
        <SoonTile label="Stundenplan" />

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
