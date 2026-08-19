import { isPushConfigured, listSubscriptions, sendToUser } from "@/lib/push";
import { getSessionUser } from "@/lib/session";

/**
 * Eine Testnachricht an alle angemeldeten Geräte — damit sich der ganze Weg
 * einmal durchspielen lässt, ohne bis zur Erinnerungszeit zu warten.
 */
export async function POST() {
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

  const devices = await listSubscriptions(user.id);
  if (devices.length === 0) {
    return Response.json({
      ok: false,
      sent: 0,
      removed: 0,
      error: "Für dieses Konto ist noch kein Gerät angemeldet.",
    });
  }

  const { sent, removed } = await sendToUser(user.id, {
    title: "Test",
    body: "Die Erinnerungen kommen an.",
    url: "/einstellungen",
    tag: "schulapp-test",
  });

  if (sent === 0) {
    return Response.json({
      ok: false,
      sent,
      removed,
      error:
        removed > 0
          ? "Das Gerät war beim Push-Dienst nicht mehr bekannt und wurde abgemeldet."
          : "Die Nachricht ließ sich nicht zustellen.",
    });
  }

  return Response.json({ ok: true, sent, removed });
}
