import type { Metadata } from "next";

import {
  catchUpMissedAction,
  skipMissedAction,
} from "@/app/(app)/lernen/actions";
import { CapturePane } from "@/components/home/capture-pane";
import { HomeDashboard } from "@/components/home/dashboard";
import { DayTimeline } from "@/components/home/day-timeline";
import { HomeWorkspace } from "@/components/home/home-workspace";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MissedPrompt } from "@/components/study/missed-prompt";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { loadHomeData } from "@/lib/home";

/** Die gleichen Tagesdaten versorgen Übersicht, Tagesablauf und Kamera. */
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
    <div className="space-y-6">
      <header className="page-header">
        <div className="min-w-0">
          <p className="eyebrow">{formatGerman(data.today, "lang")}</p>
          <h1 className="page-heading mt-2">Hallo, {data.userName}.</h1>
          <p className="page-description">Dein Tag, deine Aufgaben. Ein Schritt nach dem anderen.</p>
        </div>
        <ButtonLink href="/hausaufgaben/neu" variant="secondary"><Icon name="plus" />Aufgabe eintragen</ButtonLink>
      </header>
      {missed.length > 0 && (
        <div className="flex flex-col gap-4">
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
      <HomeWorkspace
        camera={<CapturePane data={data} />}
        overview={<HomeDashboard data={data} />}
        calendar={<DayTimeline data={data} />}
      />
    </div>
  );
}
