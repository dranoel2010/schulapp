import type { Metadata } from "next";

import {
  catchUpMissedAction,
  skipMissedAction,
} from "@/app/(app)/klausuren/[id]/plan-actions";
import { HomeDashboard } from "@/components/home/dashboard";
import { DayTimeline } from "@/components/home/day-timeline";
import { SwipePager } from "@/components/home/swipe-pager";
import { HomeTiles } from "@/components/home/tile-grid";
import { MissedPrompt } from "@/components/study/missed-prompt";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { todayInBerlin } from "@/lib/dates";
import { loadHomeData } from "@/lib/home";

/**
 * Die Startseite. Sie lädt ihre Daten genau einmal und zeigt sie in zwei
 * Anordnungen: am Handy zwei wischbare Seiten (Kachelmenü und Tageskalender),
 * am großen Bildschirm das Dashboard.
 *
 * Umgeschaltet wird allein per CSS. Die Seite wird auf dem Server gerendert,
 * dort gibt es keine Fensterbreite — eine Messung im Browser käme erst nach
 * dem ersten Bild und würde sichtbar umspringen. Beide Ansichten bekommen
 * dasselbe bereits geladene HomeData, es entsteht also keine zweite Abfrage.
 *
 * SwipePager ist die einzige Hülle mit "use client". Kachelmenü und Kalender
 * kommen als fertig gerenderte Knoten hinein — sie bleiben damit Server
 * Components, obwohl die Hülle ums Wischen herum interaktiv ist.
 */

export const metadata: Metadata = {
  title: "Start",
};

// `export const dynamic = "force-dynamic"` steht schon im Layout der Gruppe
// (src/app/(app)/layout.tsx) und gilt damit auch hier — hier wäre es doppelt.

export default async function StartPage() {
  const user = await requireUser();
  const today = todayInBerlin();
  const data = await loadHomeData(user.id, user.name, today);

  // Eine Nachfrage je Prüfung, über alle betroffenen Tage zusammengefasst.
  const missedByExam = new Map<
    string,
    {
      examId: string;
      subjectName: string;
      color: string;
      minutes: number;
      dates: Set<string>;
      lastDate: string;
    }
  >();

  for (const block of data.missed) {
    const entry = missedByExam.get(block.examId) ?? {
      examId: block.examId,
      subjectName: block.subject.name,
      color: subjectColor(block.subject.color).hex,
      minutes: 0,
      dates: new Set<string>(),
      lastDate: block.date,
    };

    entry.minutes += block.minutes;
    entry.dates.add(block.date);
    if (block.date > entry.lastDate) entry.lastDate = block.date;

    missedByExam.set(block.examId, entry);
  }

  const missed = [...missedByExam.values()];

  return (
    // Am Handy laufen die beiden Seiten von Rand zu Rand: nur so gleitet die
    // Spur beim Wischen sauber durch. Das Layout hält die Startseite dort
    // deshalb randlos (PageBody), die Ränder aus dem Entwurf bringen die
    // Seiten selbst mit. Ab md setzt das Layout den Rand ums Dashboard.
    <div className="flex flex-1 flex-col">
      {missed.length > 0 && (
        // Die Nachfrage liegt über der Wischhülle und bringt ihren eigenen
        // Rand mit — die Hülle darunter bleibt randlos. Die 20px oben sind
        // dieselben, mit denen auch die beiden Seiten beginnen.
        <div className="flex flex-col gap-6 px-[22px] pt-[20px] pb-6 md:px-0 md:pt-0">
          {missed.map((entry) => (
            <MissedPrompt
              key={entry.examId}
              subjectName={entry.subjectName}
              color={entry.color}
              days={entry.dates.size}
              minutes={entry.minutes}
              lastDate={entry.lastDate}
              today={data.today}
              catchUp={catchUpMissedAction.bind(null, entry.examId)}
              skip={skipMissedAction.bind(null, entry.examId)}
            />
          ))}
        </div>
      )}

      {/* Die Wischhülle füllt die Resthöhe: die Flex-Kette läuft von <main>
          über diese Zwischenebene bis in den Pager durch, min-h-0 hält die
          Spur davon ab, über den Bildschirm hinauszuwachsen. */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <SwipePager
          start={<HomeTiles data={data} />}
          calendar={<DayTimeline data={data} />}
        />
      </div>

      <div className="hidden flex-1 flex-col md:flex">
        <HomeDashboard data={data} />
      </div>
    </div>
  );
}
