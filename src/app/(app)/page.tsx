import type { Metadata } from "next";

import {
  catchUpMissedAction,
  skipMissedAction,
} from "@/app/(app)/klausuren/[id]/plan-actions";
import { HomeDashboard } from "@/components/home/dashboard";
import { HomeTiles } from "@/components/home/tile-grid";
import { MissedPrompt } from "@/components/study/missed-prompt";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { todayInBerlin } from "@/lib/dates";
import { loadHomeData } from "@/lib/home";

/**
 * Die Startseite. Sie lädt ihre Daten genau einmal und zeigt sie in zwei
 * Anordnungen: am Handy als Kachelmenü, am großen Bildschirm als Dashboard.
 *
 * Umgeschaltet wird allein per CSS. Die Seite wird auf dem Server gerendert,
 * dort gibt es keine Fensterbreite — eine Messung im Browser käme erst nach
 * dem ersten Bild und würde sichtbar umspringen. Beide Ansichten bekommen
 * dasselbe bereits geladene HomeData, es entsteht also keine zweite Abfrage.
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

  return (
    <div className="space-y-6">
      {[...missedByExam.values()].map((entry) => (
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

      <div className="md:hidden">
        <HomeTiles data={data} />
      </div>

      <div className="hidden md:block">
        <HomeDashboard data={data} />
      </div>
    </div>
  );
}
