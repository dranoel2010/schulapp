import { z } from "zod";

import { removeSubscription } from "@/lib/push";
import { getSessionUser } from "@/lib/session";

/**
 * Ein Gerät abmelden. Läuft auch, wenn keine VAPID-Schlüssel gesetzt sind —
 * Aufräumen muss immer möglich sein.
 */

const bodySchema = z.object({
  endpoint: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json(
      { ok: false, error: "Nicht angemeldet." },
      { status: 401 },
    );
  }

  const data = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(data);

  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Es fehlt die Adresse des Geräts." },
      { status: 400 },
    );
  }

  await removeSubscription(user.id, parsed.data.endpoint);

  return Response.json({ ok: true });
}
