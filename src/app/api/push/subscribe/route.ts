import { z } from "zod";

import { isPushConfigured, saveSubscription } from "@/lib/push";
import { getSessionUser } from "@/lib/session";

/**
 * Ein Gerät für Push-Nachrichten anmelden.
 *
 * Der Browser erzeugt die Subscription, die Seite schickt sie hierher —
 * so wie JSON.stringify sie ausgibt.
 */

const subscriptionSchema = z.object({
  endpoint: z.url("Diese Anmeldung sieht nicht aus wie eine Adresse.").max(2000),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  /** Zur Anzeige in den Einstellungen, z.B. "Chrome auf Android". */
  label: z.string().trim().max(80).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json(
      { ok: false, error: "Nicht angemeldet." },
      { status: 401 },
    );
  }

  if (!isPushConfigured()) {
    return Response.json(
      { ok: false, error: "Push ist auf diesem Server nicht eingerichtet." },
      { status: 503 },
    );
  }

  const data = await request.json().catch(() => null);
  const parsed = subscriptionSchema.safeParse(data);

  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Die Anmeldung des Geräts war unvollständig." },
      { status: 400 },
    );
  }

  const { endpoint, keys, label } = parsed.data;
  await saveSubscription(user.id, { endpoint, keys }, label);

  return Response.json({ ok: true });
}
