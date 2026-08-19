import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  daysBetween,
  formatCountdown,
  formatGerman,
  todayInBerlin,
} from "@/lib/dates";
import { blocksForDay, upcomingExams } from "@/lib/exams";
import { isPushConfigured, sendToUser, type PushPayload } from "@/lib/push";

/**
 * Die Zeitsteuerung der Erinnerungen.
 *
 * Vercel ruft diese Route stündlich auf — geplant wird dort in UTC, die
 * Erinnerungszeit des Nutzers gilt aber in Berliner Zeit. Welche Stunde
 * gerade dran ist, entscheidet deshalb die Route selbst: sie schaut nach,
 * wie spät es in Berlin ist, und beschickt nur die Nutzer, deren
 * reminderHour genau darauf fällt.
 *
 * Kein Cookie, sondern "Authorization: Bearer <CRON_SECRET>".
 */

export const dynamic = "force-dynamic";

const TIME_ZONE = "Europe/Berlin";

/** Vorwarnung: einmal drei Tage vorher, einmal am Tag davor. */
const COUNTDOWN_DAYS = [3, 1];

type PlannedBlock = Awaited<ReturnType<typeof blocksForDay>>[number];
type UpcomingExam = Awaited<ReturnType<typeof upcomingExams>>[number];

const EXAM_KIND_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET fehlt." },
      { status: 500 },
    );
  }

  if (!isAuthorized(request, secret)) {
    return Response.json({ ok: false, error: "Nicht erlaubt." }, { status: 401 });
  }

  const today = todayInBerlin();
  const hour = currentHourInBerlin(new Date());

  if (!isPushConfigured()) {
    return Response.json({
      ok: true,
      date: today,
      hour,
      reason: "push-not-configured",
    });
  }

  const due = await db.select().from(users).where(eq(users.reminderHour, hour));

  let reminders = 0;
  let countdowns = 0;
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const user of due) {
    try {
      const messages: PushPayload[] = [];

      const blocks = (await blocksForDay(user.id, today)).filter(
        (block) => block.status === "open",
      );
      if (blocks.length > 0) {
        messages.push(dailyMessage(blocks));
        reminders += 1;
      }

      const soon = (await upcomingExams(user.id, today, 10)).filter((exam) =>
        COUNTDOWN_DAYS.includes(daysBetween(today, exam.date)),
      );
      if (soon.length > 0) {
        messages.push(countdownMessage(soon, today));
        countdowns += 1;
      }

      // Gibt es nichts zu melden, wird auch nichts geschickt.
      for (const message of messages) {
        const result = await sendToUser(user.id, message);
        sent += result.sent;
        removed += result.removed;
      }
    } catch (error) {
      // Ein Nutzer mit kaputten Daten darf den Lauf nicht abbrechen.
      failed += 1;
      console.error("Erinnerung fehlgeschlagen", user.id, error);
    }
  }

  return Response.json({
    ok: true,
    date: today,
    hour,
    users: due.length,
    reminders,
    countdowns,
    sent,
    removed,
    failed,
  });
}

/**
 * Zeichenweise gleich lange Prüfung, damit sich das Geheimnis nicht über die
 * Antwortzeit erraten lässt.
 */
function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length) return false;

  return timingSafeEqual(given, expected);
}

/** Volle Stunde 0–23 in Berlin. h23 erzwungen, sonst steht nachts eine 24 da. */
function currentHourInBerlin(now: Date): number {
  const value = new Intl.DateTimeFormat("de-DE", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;

  return Number(value ?? 0) % 24;
}

/** "Heute lernen" — bei mehreren Blöcken mit Gesamtzeit im Titel. */
function dailyMessage(blocks: PlannedBlock[]): PushPayload {
  const total = blocks.reduce((sum, block) => sum + block.minutes, 0);

  return {
    title: blocks.length === 1 ? "Heute lernen" : `Heute lernen — ${total} min`,
    body: blocks.map(blockLine).join("\n"),
    url: "/",
    tag: "schulapp-lernen",
  };
}

/** "45 min Mathe — Ableitungen" */
function blockLine(block: PlannedBlock): string {
  const topic = block.topic
    ? block.kind === "review"
      ? `${block.topic.title} (Wiederholung)`
      : block.topic.title
    : "Gesamtwiederholung";

  return `${block.minutes} min ${block.subject.name} — ${topic}`;
}

function countdownMessage(exams: UpcomingExam[], today: string): PushPayload {
  if (exams.length === 1) {
    const exam = exams[0];
    const when = formatGerman(exam.date);

    return {
      title: `${examLabel(exam)} — ${formatCountdown(today, exam.date)}`,
      body: exam.title ? `${exam.title} · ${when}` : when,
      url: "/",
      tag: "schulapp-countdown",
    };
  }

  return {
    title: `${exams.length} Prüfungen stehen an`,
    body: exams
      .map((exam) => `${examLabel(exam)} — ${formatCountdown(today, exam.date)}`)
      .join("\n"),
    url: "/",
    tag: "schulapp-countdown",
  };
}

/** "Klausur in Mathe" */
function examLabel(exam: UpcomingExam): string {
  const kind = EXAM_KIND_LABELS[exam.kind] ?? "Prüfung";
  return `${kind} in ${exam.subject.name}`;
}
