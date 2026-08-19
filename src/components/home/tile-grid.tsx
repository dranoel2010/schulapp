import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { formatCountdown, formatGerman } from "@/lib/dates";
import type { HomeData } from "@/lib/home";

/**
 * Das Kachelmenü fürs Handy — die Startansicht auf schmalen Bildschirmen.
 *
 * Ein Raster großer Flächen, jede führt in ihren Bereich. Die Maße stammen aus
 * dem Entwurf und sind auf ein 390px breites Gerät gerechnet; deshalb stehen
 * hier feste Pixelwerte, wo es kein passendes Token gibt. Den seitlichen Rand
 * gibt das Layout vor — eigener Rand käme oben drauf und würde die Kacheln
 * schmaler machen als gezeichnet.
 *
 * Ehrlichkeit vor Vollständigkeit: Stundenplan, Hausaufgaben und Noten gibt es
 * noch nicht. Ihre Kacheln stehen als leere, gestrichelte Flächen da und sind
 * bewusst nicht anklickbar — lieber eine sichtbare Lücke als erfundene Zahlen.
 *
 * Die Kopfzeile bringt die Komponente selbst mit. Ums Ausblenden ab mittlerer
 * Breite kümmert sich die Startseite.
 */

/** Gemeinsame Form aller Kacheln, unabhängig von der Variante. */
const TILE_SHAPE =
  "flex min-h-[116px] flex-col justify-between rounded-[20px] p-[18px] text-left";

const LABEL = "text-[15px] leading-snug";

const VALUE =
  "block font-mono text-[42px] font-semibold leading-none tracking-[-0.03em]";

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
 * Ein Bereich, den es noch nicht gibt: keine Fläche, keine Zahl, kein Link.
 * Ein div statt eines Links — was nirgendwohin führt, soll sich auch nicht
 * anfassen lassen.
 */
function SoonTile({ label }: { label: string }) {
  return (
    <div
      className={`${TILE_SHAPE} border border-dashed border-border-strong text-subtle`}
    >
      <span className={LABEL}>{label}</span>
      <span className={CAPTION}>kommt noch</span>
    </div>
  );
}

export function HomeTiles({ data }: { data: HomeData }) {
  const hasSubjects = data.subjectCount > 0;

  // Lernen führt in die Prüfung, an der heute als Nächstes gearbeitet wird.
  const nextOpen = data.todayBlocks.find((block) => block.status === "open");
  const learnHref = nextOpen ? `/klausuren/${nextOpen.examId}` : "/klausuren";

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
    <div>
      <header className="flex items-end justify-between gap-4 pb-[16px]">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-none tracking-[-0.03em]">
            {formatGerman(data.today, "kurz")}
          </h1>
          <p className="mt-2 text-[14px] leading-snug text-muted">
            {summary.join(" · ")}
          </p>
        </div>

        <p className="shrink-0 text-[13px] leading-snug text-subtle">
          {data.userName}
        </p>
      </header>

      {/* Ohne Fächer hängt alles andere in der Luft — dann steht der Weg
          dorthin vorn und das Raster tritt zurück. */}
      {hasSubjects ? null : (
        <div className="mb-[10px] rounded-[20px] bg-surface p-[18px] shadow-soft">
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

      <div className="grid auto-rows-fr grid-cols-2 gap-[10px]">
        <Tile
          label="Lernen"
          value={learnValue}
          caption={learnCaption}
          href={learnHref}
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
          label="Fächer"
          value={String(data.subjectCount)}
          caption="verwalten"
          href="/faecher"
        />

        <SoonTile label="Stundenplan" />
        <SoonTile label="Hausaufgaben" />
        <SoonTile label="Noten" />
      </div>
    </div>
  );
}
