import { cookies } from "next/headers";

import { calendarConfig } from "@/lib/calendar/config";
import {
  authorizationUrl,
  cookieValue,
  newAuthorization,
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_COOKIE_PATH,
} from "@/lib/calendar/google-oauth";
import { getSessionUser } from "@/lib/session";

/**
 * „Mit Google verbinden" — der Sprung zu Google.
 *
 * Nur POST, ausgelöst von einem `<form method="post">` in den Einstellungen.
 * Kein GET und kein `next/link`: Ein Link würde vorgeladen, und eine Adresse,
 * die beim bloßen Aufruf ein Cookie setzt und weiterleitet, wäre ein GET mit
 * Seiteneffekt.
 *
 * Der Schutz gegen ein fremdes Formular, das hierher postet, ist das
 * Session-Cookie selbst: Es ist `sameSite: "lax"` (@/lib/session) und fehlt
 * deshalb bei einem POST von einer anderen Seite — dann geht es zur Anmeldung
 * und nicht zu Google.
 *
 * Geantwortet wird mit 303 und von Hand, mit Absicht nicht mit `redirect()`:
 * Im Route Handler gäbe das 307, und der Browser schickte den POST an Google
 * weiter. Das Cookie mit `state` und PKCE-Verifier hängt Next trotzdem an die
 * Antwort — `cookies().set` wirkt auch auf eine selbst gebaute `Response`
 * (`appendMutableCookies` in next/dist/server/route-modules/app-route/module.js).
 */

export const dynamic = "force-dynamic";

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return seeOther("/login");

  const cfg = calendarConfig();
  if (!cfg.ok) return seeOther("/einstellungen?kalender=nicht-eingerichtet#kalender");

  const { state, verifier, challenge } = newAuthorization();

  (await cookies()).set(OAUTH_COOKIE, cookieValue(state, verifier), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });

  return seeOther(authorizationUrl(cfg.config, { state, challenge }));
}
