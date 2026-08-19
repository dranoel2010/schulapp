import { and, asc, eq } from "drizzle-orm";
import {
  sendNotification,
  setVapidDetails,
  WebPushError,
  type PushSubscription as WebPushSubscription,
} from "web-push";

import { db } from "@/db";
import { pushSubscriptions, type PushSubscription } from "@/db/schema";

/**
 * Push-Nachrichten — Geräte merken und beschicken.
 *
 * Die Bedienoberfläche liegt woanders; hier stehen nur die Bausteine. Ohne
 * VAPID-Schlüssel bleibt alles still: isPushConfigured() meldet false und der
 * Versand tut nichts. Die App läuft dann normal weiter, nur eben ohne
 * Erinnerungen.
 */

/** Was an das Gerät geht. Der Service Worker liest genau diese Felder. */
export type PushPayload = {
  title: string;
  body: string;
  /** Wohin der Tipp auf die Nachricht führt. Standard: Startseite. */
  url?: string;
  /** Gleiches Kennzeichen ersetzt die vorige Nachricht, statt sie zu stapeln. */
  tag?: string;
};

export type SendResult = {
  sent: number;
  /** Geräte, die es nicht mehr gibt — die Zeile wurde gelöscht. */
  removed: number;
};

/**
 * Eine Erinnerung ist nur heute etwas wert. Kommt das Handy erst morgen
 * wieder ins Netz, soll der Push-Dienst sie verwerfen statt sie nachzureichen.
 */
const TTL_SECONDS = 6 * 60 * 60;

const SUBJECT = process.env.VAPID_SUBJECT;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

/** undefined = noch nicht versucht. Der Aufbau passiert genau einmal. */
let configured: boolean | undefined;

function configure(): boolean {
  if (configured !== undefined) return configured;

  if (!SUBJECT || !PUBLIC_KEY || !PRIVATE_KEY) {
    configured = false;
    return configured;
  }

  try {
    setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch {
    // Kaputter Schlüssel oder ein Betreff, der weder mailto: noch https: ist.
    configured = false;
  }

  return configured;
}

/** Sind die VAPID-Schlüssel gesetzt und brauchbar? */
export function isPushConfigured(): boolean {
  return configure();
}

/**
 * Ein Gerät anmelden. Idempotent: derselbe Endpunkt wird aktualisiert, nicht
 * verdoppelt — der Browser liefert nach einem Neuaufbau gern dieselbe
 * Adresse mit frischen Schlüsseln.
 */
export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  label?: string,
): Promise<void> {
  const row = {
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    // Ohne neuen Namen bleibt der alte stehen, statt überschrieben zu werden.
    ...(label ? { label } : {}),
  };

  await db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row });
}

/** Ein Gerät abmelden. */
export async function removeSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}

/** Alle angemeldeten Geräte eines Nutzers, ältestes zuerst. */
export async function listSubscriptions(
  userId: string,
): Promise<PushSubscription[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(asc(pushSubscriptions.createdAt));
}

/**
 * Eine Nachricht an alle Geräte des Nutzers.
 *
 * Ein Gerät, das der Push-Dienst nicht mehr kennt (404/410), wird gelöscht.
 * Jeder andere Fehler betrifft nur dieses eine Gerät — die übrigen bekommen
 * ihre Nachricht trotzdem.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  if (!configure()) return { sent: 0, removed: 0 };

  const devices = await listSubscriptions(userId);
  if (devices.length === 0) return { sent: 0, removed: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? "schulapp",
  });

  const results = await Promise.all(
    devices.map((device) => sendToDevice(device, body)),
  );

  return {
    sent: results.filter((result) => result === "sent").length,
    removed: results.filter((result) => result === "removed").length,
  };
}

async function sendToDevice(
  device: PushSubscription,
  body: string,
): Promise<"sent" | "removed" | "failed"> {
  const subscription: WebPushSubscription = {
    endpoint: device.endpoint,
    keys: { p256dh: device.p256dh, auth: device.auth },
  };

  try {
    await sendNotification(subscription, body, {
      TTL: TTL_SECONDS,
      urgency: "normal",
    });
    return "sent";
  } catch (error) {
    const status = statusOf(error);

    if (status === 404 || status === 410) {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.id, device.id));
      return "removed";
    }

    console.error("Push fehlgeschlagen", status ?? error);
    return "failed";
  }
}

/**
 * Der Statuscode des Push-Dienstes. Der instanceof-Test greift nicht immer —
 * je nach Bündelung kann eine zweite Kopie des Moduls im Spiel sein, deshalb
 * zusätzlich der Blick auf die Eigenschaft.
 */
function statusOf(error: unknown): number | undefined {
  if (error instanceof WebPushError) return error.statusCode;

  if (error && typeof error === "object" && "statusCode" in error) {
    const status = (error as { statusCode: unknown }).statusCode;
    if (typeof status === "number") return status;
  }

  return undefined;
}
