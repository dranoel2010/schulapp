import { and, count, eq } from "drizzle-orm";

import { ButtonLink } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { subjects } from "@/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * Der Server läuft je nach Hosting in UTC — ohne feste Zeitzone stünde nachts
 * das Datum von gestern auf der Startseite.
 */
const TIME_ZONE = "Europe/Berlin";

/** Was als Nächstes gebaut wird — steht so auch in KONZEPT.md. */
const ROADMAP = [
  {
    title: "Klausuren und Lernphasen",
    text: "Termine mit Countdown und Lernblöcken, die sich auf die Tage davor verteilen.",
  },
  {
    title: "Stundenplan und Hausaufgaben",
    text: "Der Wochenplan und was bis wann fällig ist.",
  },
  {
    title: "Noten",
    text: "Eintragen, Schnitt pro Fach und insgesamt.",
  },
];

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return "Guten Morgen";
  if (hour >= 18) return "Guten Abend";
  return "Hallo";
}

export default async function StartPage() {
  const user = await requireUser();

  const [row] = await db
    .select({ value: count() })
    .from(subjects)
    .where(and(eq(subjects.userId, user.id), eq(subjects.archived, false)));

  const subjectCount = row?.value ?? 0;

  const now = new Date();
  const today = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  });
  // formatToParts statt toLocaleString: Deutsch hängt sonst „Uhr“ an die Zahl.
  const hour = Number(
    new Intl.DateTimeFormat("de-DE", {
      hour: "numeric",
      hour12: false,
      timeZone: TIME_ZONE,
    })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value,
  );
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greetingFor(hour)}, {firstName}
        </h1>
        <p className="mt-1 text-muted">{today}</p>
      </div>

      {subjectCount === 0 ? (
        <EmptyState
          title="Noch keine Fächer"
          description="Ohne Fächer kann die App nichts einsortieren. Sobald sie stehen, hängen Klausuren, Stundenplan und Noten daran."
          action={
            <ButtonLink href="/faecher/neu" size="lg">
              Erstes Fach anlegen
            </ButtonLink>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Fächer</CardTitle>
            <ButtonLink href="/faecher" variant="secondary">
              Ansehen
            </ButtonLink>
          </CardHeader>
          <CardContent>
            <p className="text-muted">
              <span className="text-2xl font-semibold text-foreground">
                {subjectCount}
              </span>{" "}
              {subjectCount === 1 ? "Fach angelegt" : "Fächer angelegt"}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Als Nächstes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Die App wächst in Abschnitten. Fertig ist das Fundament: Anmeldung
            und Fächer. Das kommt noch:
          </p>
          <ol className="space-y-3">
            {ROADMAP.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-xs font-medium text-muted"
                >
                  {index + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {step.title}
                  </span>
                  <span className="block text-sm text-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
