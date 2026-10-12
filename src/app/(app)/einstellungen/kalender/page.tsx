import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";
import { loadCalendarStatus } from "@/lib/calendar/sync";

import { GoogleCalendarCard } from "../google-calendar-card";

/**
 * Einstellungen › Google Kalender. Der Rückweg von Google
 * (`/api/google/callback`) landet hier, mit `?kalender=…` für die Meldung.
 */

export const metadata: Metadata = { title: "Google Kalender" };

export default async function KalenderPage({ searchParams }: PageProps<"/einstellungen/kalender">) {
  const user = await requireUser();
  const { kalender } = await searchParams;
  const status = await loadCalendarStatus(user.id);

  return <GoogleCalendarCard status={status} notice={typeof kalender === "string" ? kalender : undefined} />;
}
