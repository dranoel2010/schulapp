import type { Metadata } from "next";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";

import { setReminderHourAction } from "../actions";
import { PushSettings, ReminderTime } from "../push-settings";

/** Einstellungen › Erinnerungen: Push am Handy und die Uhrzeit der Lernerinnerung. */

export const metadata: Metadata = { title: "Erinnerungen" };

export default async function ErinnerungenPage() {
  const user = await requireUser();
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <>
      <SeitenKopf titel="Erinnerungen" sub="Benachrichtigungen am Handy: Lernblöcke, Klausuren, IServ." />
      <div className="kf-inhalt" style={{ marginTop: 16 }}>
        <PushSettings vapidPublicKey={vapidPublicKey} />
        <h3 className="p-lab">Uhrzeit</h3>
        <ReminderTime action={setReminderHourAction} hour={user.reminderHour} />
      </div>
    </>
  );
}
