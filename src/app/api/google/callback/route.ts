import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { finishGoogleConnection } from "@/lib/calendar/connect";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH } from "@/lib/calendar/google-oauth";
import { requestCalendarSync } from "@/lib/calendar/sync";
import { getSessionUser } from "@/lib/session";

/**
 * Die Rückkehr von Google nach der Zustimmung.
 *
 * Diese Adresse muss Zeichen für Zeichen so in der Google Cloud Console
 * stehen (im Betrieb https://treskownas.tail3a40b0.ts.net/api/google/callback,
 * siehe @/lib/calendar/config). Aus der Anfrage gelesen wird nur die Query —
 * `code`, `state`, `error` —, nie der Host.
 *
 * Das Session-Cookie kommt mit, obwohl der Aufruf von Google kommt: Es ist
 * `sameSite: "lax"`, und die Rückkehr ist eine Navigation per GET.
 *
 * Das Cookie mit `state` und Verifier gilt genau einmal und wird deshalb als
 * Erstes gelöscht, auch wenn danach etwas schiefgeht. Was beim Verbinden
 * passiert, steht in @/lib/calendar/connect; hier steht nur die Tür. Danach
 * geht es zurück in die Einstellungen, mit `?kalender=…`, und die Karte dort
 * hat für jeden Ausgang einen Satz.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const store = await cookies();
  const raw = store.get(OAUTH_COOKIE)?.value;
  store.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });

  const query = new URL(request.url).searchParams;

  const ergebnis = await finishGoogleConnection(user.id, {
    code: query.get("code"),
    state: query.get("state"),
    error: query.get("error"),
    cookie: raw,
  });

  // Der erste Abgleich läuft, nachdem die Antwort draußen ist.
  if (ergebnis === "verbunden") requestCalendarSync(user.id, "verbinden");

  // Außerhalb jedes try: redirect() wirft mit Absicht.
  redirect(`/einstellungen?kalender=${ergebnis}#kalender`);
}
