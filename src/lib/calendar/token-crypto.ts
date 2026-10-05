import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Das Refresh Token für Google, verschlossen für die Datenbank.
 *
 * Reine Rechnung: kein Netz, keine Datenbank, der Schlüssel wird
 * hereingereicht. Er steht nur in `GOOGLE_TOKEN_KEY` (siehe
 * @/lib/calendar/config) — wer einen Abzug der Datenbank hat, hat damit noch
 * keinen Zugang zum Kalender.
 *
 * AES-256-GCM aus node:crypto, keine Abhängigkeit. GCM und nicht CBC, weil es
 * nicht nur verschlüsselt, sondern auch prüft: Ein verändertes Zeichen, ein
 * falscher Schlüssel oder ein Token aus einer anderen Zeile scheitern laut,
 * statt einen falschen Klartext zu liefern, mit dem Google dann `invalid_grant`
 * sagt und niemand weiß, warum.
 *
 * Die Nutzer-ID geht als AAD mit ein. Sie wird nicht verschlüsselt, aber
 * mitgeprüft: Kopiert jemand den verschlossenen Wert in die Zeile eines anderen
 * Nutzers, lässt er sich dort nicht öffnen.
 *
 * Das Format ist „v1.<iv>.<tag>.<daten>", alles base64url. Die Version steht
 * vorn, damit ein späterer Wechsel des Verfahrens die alten Werte erkennt,
 * statt an ihnen zu scheitern.
 *
 * Das Klartext-Token erscheint nie in einer Meldung — auch nicht in der eines
 * Fehlers, denn die landet im Container-Protokoll.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Nur Zeichen aus base64url — `Buffer.from` überginge alles andere stillschweigend. */
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Der gespeicherte Zugang lässt sich nicht öffnen. Die Meldung nennt nie das Token. */
export class TokenDecryptError extends Error {
  constructor(message = "Der gespeicherte Zugang lässt sich nicht entschlüsseln.") {
    super(message);
    this.name = "TokenDecryptError";
  }
}

function aad(userId: string): Buffer {
  return Buffer.from(`schulapp-google-refresh:${userId}`, "utf8");
}

/** Verschließt das Token für genau diesen Nutzer. Jeder Aufruf ergibt einen anderen Wert. */
export function sealToken(plain: string, key: Buffer, userId: string): string {
  if (key.length !== 32) {
    throw new Error("Der Schlüssel für das Refresh Token muss 32 Bytes lang sein.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId));

  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

/** Öffnet einen Wert aus `sealToken()`. Wirft `TokenDecryptError` bei jeder Abweichung. */
export function openToken(sealed: string, key: Buffer, userId: string): string {
  const parts = sealed.split(".");

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenDecryptError("Der gespeicherte Zugang hat ein unbekanntes Format.");
  }

  const [, ivText, tagText, dataText] = parts;
  if (![ivText, tagText, dataText].every((part) => BASE64URL.test(part))) {
    throw new TokenDecryptError("Der gespeicherte Zugang hat ein unbekanntes Format.");
  }

  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const data = Buffer.from(dataText, "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new TokenDecryptError("Der gespeicherte Zugang hat ein unbekanntes Format.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // Falscher Schlüssel, falscher Nutzer, verändertes Zeichen — GCM sagt nur
    // „passt nicht", und mehr soll hier auch niemand erfahren.
    throw new TokenDecryptError();
  }
}
