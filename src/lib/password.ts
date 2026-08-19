import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Erkennungszeichen am Anfang des Hashes, falls das Verfahren mal wechselt. */
const SCHEME = "scrypt";

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, KEY_BYTES);
  return `${SCHEME}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 3) return false;

  const [scheme, saltHex, keyHex] = parts;
  if (scheme !== SCHEME) return false;
  // Feste Längen, sonst würde ein abgeschnittener Hash mitspielen: scrypt
  // liefert für einen kürzeren Schlüssel genau den Anfang des längeren.
  if (!isHex(saltHex, SALT_BYTES) || !isHex(keyHex, KEY_BYTES)) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");

  try {
    const actual = await scrypt(plain, salt, KEY_BYTES);
    return timingSafeEqual(actual, expected);
  } catch {
    // Ein kaputter Hash ist kein Absturz, sondern schlicht ein Fehlschlag.
    return false;
  }
}

function isHex(value: string, bytes: number): boolean {
  return value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value);
}
