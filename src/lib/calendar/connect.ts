import { calendarConfig } from "@/lib/calendar/config";
import { errorText } from "@/lib/calendar/error-text";
import { createCalendarApi, GoogleApiError } from "@/lib/calendar/google-api";
import {
  createTokenSource,
  exchangeCode,
  grantsCalendar,
  GoogleTokenError,
  readCookieValue,
  revokeToken,
  sameSecret,
  staticTokenSource,
} from "@/lib/calendar/google-oauth";
import {
  clearConnection,
  getConnection,
  recordError,
  replaceCalendar,
  saveConnection,
  storeRefreshToken,
} from "@/lib/calendar/store";
import {
  blockAndNotify,
  requestCalendarSync,
  SYNC_SENTENCES,
} from "@/lib/calendar/sync";
import { openToken, sealToken } from "@/lib/calendar/token-crypto";

/**
 * Verbinden, Trennen, Kalender neu anlegen — die drei Handgriffe aus den
 * Einstellungen.
 *
 * Die Route Handler und Server Actions davor sind dünn; was dort passiert,
 * steht hier. Ins Protokoll kommt bei allem nur, was schiefging, mit dem
 * Präfix „Google-Kalender: Verbinden" — nie ein Token und nie ein Code, und
 * deshalb jeder Fehler nur durch `errorText()` (@/lib/calendar/error-text):
 * Eine gescheiterte Abfrage von `saveConnection()` trüge sonst das versiegelte
 * Refresh Token in ihren Parametern mit.
 *
 * Den Kalender in Google löscht die App NIE, auch beim Trennen nicht: Der
 * Nutzer könnte eigene Termine hineingeschrieben haben, und die gehören nicht
 * der App. `calendars.delete` gibt es hier deshalb gar nicht.
 */

/** Wie das Verbinden ausging — wird zu `?kalender=…` in der Adresse der Einstellungen. */
export type ConnectOutcome =
  | "verbunden"
  | "abgelehnt"
  | "ungueltig"
  | "berechtigung"
  | "zugangsdaten"
  | "api-aus"
  | "kalender"
  | "fehlgeschlagen"
  | "nicht-eingerichtet";

/** Wie lange das Verbinden auf Google warten darf, bevor der Nutzer eine Antwort bekommt. */
const CONNECT_BUDGET_MS = 30_000;

function log(...teile: unknown[]): void {
  console.error("Google-Kalender: Verbinden", ...teile);
}

/**
 * Die Rückkehr von Google. Wirft nie — jedes Ende ist ein `ConnectOutcome`,
 * und die Karte hat für jedes einen Satz.
 */
export async function finishGoogleConnection(
  userId: string,
  input: {
    code: string | null;
    state: string | null;
    error: string | null;
    cookie: string | undefined;
  },
): Promise<ConnectOutcome> {
  try {
    const cfg = calendarConfig();
    if (!cfg.ok) return "nicht-eingerichtet";
    const config = cfg.config;

    if (input.error === "access_denied") return "abgelehnt";
    if (input.error) {
      log("Google meldet", input.error.slice(0, 100));
      return "fehlgeschlagen";
    }

    // Kein Cookie, ein fremdes `state` oder kein Code: Die Rückkehr gehört
    // nicht zu einem Verbinden, das in diesem Browser angefangen hat.
    const saved = readCookieValue(input.cookie);
    if (!saved || !input.code || !sameSecret(saved.state, input.state)) {
      return "ungueltig";
    }

    let tokens: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      tokens = await exchangeCode(config, input.code, saved.verifier);
    } catch (fehler) {
      if (fehler instanceof GoogleTokenError) {
        if (fehler.kind === "invalid_client") return "zugangsdaten";
        log(fehler.message);
      } else {
        log(errorText(fehler));
      }
      return "fehlgeschlagen";
    }

    if (!grantsCalendar(tokens.scope)) {
      // Den halben Zugang nicht liegen lassen.
      await revokeToken(tokens.accessToken);
      return "berechtigung";
    }

    if (!tokens.refreshToken) {
      log("kein Refresh Token trotz prompt=consent");
      return "fehlgeschlagen";
    }

    const api = createCalendarApi({
      tokens: staticTokenSource(tokens.accessToken),
      deadline: Date.now() + CONNECT_BUDGET_MS,
    });

    const alt = await getConnection(userId);
    let calendarId = alt?.calendarId ?? null;
    let newCalendar = false;

    try {
      // Den alten Kalender weiterführen, wenn es ihn gibt und er zu diesem
      // Google-Konto gehört. 404 heißt gelöscht, 403 meist: ein anderes Konto.
      if (calendarId && (await api.calendarState(calendarId)) !== "da") {
        calendarId = null;
      }

      if (!calendarId) {
        calendarId = await api.createCalendar();
        newCalendar = true;
      }
    } catch (fehler) {
      if (fehler instanceof GoogleApiError) {
        log(fehler.kind, fehler.status, fehler.reason);
        return fehler.kind === "api-aus" ? "api-aus" : "kalender";
      }
      throw fehler;
    }

    // Ein altes Refresh Token wird hier NICHT widerrufen. Bei Google hängt es
    // am selben Grant wie das gerade erteilte, und ein Revoke nähme beide mit.
    await saveConnection(userId, {
      refreshTokenEnc: sealToken(tokens.refreshToken, config.tokenKey, userId),
      scope: tokens.scope,
      calendarId,
      newCalendar,
    });

    return "verbunden";
  } catch (fehler) {
    log(errorText(fehler));
    return "fehlgeschlagen";
  }
}

/**
 * Wie das Widerrufen beim Trennen ausging. Nur bei `widerrufen` hat Google
 * bestätigt, dass der Zugang dort nicht mehr gilt; `nichts` heißt, es gab
 * keinen gespeicherten Zugang.
 */
export type RevokeOutcome =
  | "widerrufen"
  | "nichts"
  | "nicht-bestaetigt"
  | "nicht-lesbar"
  | "nicht-eingerichtet";

/**
 * Trennen: den Zugang bei Google zurückziehen und hier vergessen. Kalender und
 * Gedächtnis bleiben — wer neu verbindet, bekommt denselben Kalender
 * weitergeführt.
 *
 * Vergessen wird IMMER, auch wenn Google den Widerruf nicht bestätigt: Der
 * Nutzer will getrennt sein. Aber das Ergebnis geht zurück, und die Karte sagt
 * dann, dass der Zugang bei Google womöglich noch besteht und wo er ihn selbst
 * entfernt — sonst hielte er ihn für entzogen, während das Refresh Token bei
 * Google weiter gilt und versiegelt in jeder Sicherung der Datenbank liegt.
 */
export async function disconnectGoogle(userId: string): Promise<RevokeOutcome> {
  const conn = await getConnection(userId);
  const cfg = calendarConfig();
  let outcome: RevokeOutcome = "nichts";

  if (conn?.refreshTokenEnc && !cfg.ok) {
    log("Trennen: Google ist nicht eingerichtet, der Zugang wird nur hier vergessen");
    outcome = "nicht-eingerichtet";
  } else if (conn?.refreshTokenEnc && cfg.ok) {
    let refresh: string | null = null;
    try {
      refresh = openToken(conn.refreshTokenEnc, cfg.config.tokenKey, userId);
    } catch {
      log("Trennen: gespeicherter Zugang nicht lesbar, nur hier vergessen");
      outcome = "nicht-lesbar";
    }

    // Das Refresh Token direkt: Google nimmt damit den ganzen Grant zurück.
    if (refresh !== null) {
      if (await revokeToken(refresh)) {
        outcome = "widerrufen";
      } else {
        log("Trennen: Google hat den Widerruf nicht bestätigt");
        outcome = "nicht-bestaetigt";
      }
    }
  }

  await clearConnection(userId);

  return outcome;
}

/**
 * Einen frischen Kalender „Schule" anlegen und alles neu eintragen — auch, was
 * der Nutzer im alten gelöscht hatte. Der einzige Weg, auf dem das Gedächtnis
 * geleert wird. Der alte Kalender bleibt in Google stehen; ein Lauf, der noch
 * im alten unterwegs war, hinterlässt höchstens Zeilen, die der nächste Lauf
 * wegräumt.
 *
 * Wirft nie: `false` heißt, es ging nicht, und der Grund steht unter „Letzter
 * Fehler".
 */
export async function recreateCalendar(userId: string): Promise<boolean> {
  try {
    const cfg = calendarConfig();
    if (!cfg.ok) return false;
    const config = cfg.config;

    const conn = await getConnection(userId);
    if (!conn?.refreshTokenEnc) return false;

    let tokenEnc = conn.refreshTokenEnc;

    let refresh: string;
    try {
      refresh = openToken(tokenEnc, config.tokenKey, userId);
    } catch {
      await blockAndNotify(userId, {
        reason: "schluessel",
        sentence: SYNC_SENTENCES.schluessel,
        tokenEnc,
        calendarId: conn.calendarId,
      });
      return false;
    }

    const tokens = createTokenSource(config, refresh, {
      onRotate: async (neu) => {
        const enc = sealToken(neu, config.tokenKey, userId);
        await storeRefreshToken(userId, tokenEnc, enc);
        tokenEnc = enc;
      },
    });

    try {
      await tokens.current();
    } catch (fehler) {
      if (fehler instanceof GoogleTokenError && fehler.kind === "invalid_grant") {
        await blockAndNotify(userId, {
          reason: "zugang",
          sentence: SYNC_SENTENCES.zugang,
          tokenEnc,
          calendarId: conn.calendarId,
        });
        return false;
      }

      await recordError(
        userId,
        "Der neue Kalender ließ sich nicht anlegen: Google war beim Erneuern des Zugangs nicht erreichbar.",
      );
      return false;
    }

    let calendarId: string;
    try {
      calendarId = await createCalendarApi({
        tokens,
        deadline: Date.now() + CONNECT_BUDGET_MS,
      }).createCalendar();
    } catch (fehler) {
      const satz = fehler instanceof GoogleApiError ? fehler.sentence : "unbekannter Fehler";
      log("Neu anlegen gescheitert", satz);
      await recordError(userId, `Der neue Kalender ließ sich nicht anlegen: ${satz}`);
      return false;
    }

    await replaceCalendar(userId, calendarId);
    requestCalendarSync(userId, "verbinden");

    return true;
  } catch (fehler) {
    log("Neu anlegen abgebrochen", errorText(fehler));
    return false;
  }
}
