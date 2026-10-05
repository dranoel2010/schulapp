import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openToken, sealToken, TokenDecryptError } from "@/lib/calendar/token-crypto";

const KEY = Buffer.alloc(32, 3);
const OTHER_KEY = Buffer.alloc(32, 4);
const USER = "6f1c2a8e-0b44-4c55-9d2a-1b7e3f9a0c11";
const TOKEN = "1//0g-ein-refresh-token_mit.punkt";

/** Ein Zeichen am ANFANG eines Teils tauschen — am Ende stünden womöglich nur Füllbits. */
function tamper(sealed: string, part: 1 | 2 | 3): string {
  const parts = sealed.split(".");
  const first = parts[part][0];
  parts[part] = (first === "A" ? "B" : "A") + parts[part].slice(1);
  return parts.join(".");
}

describe("sealToken / openToken", () => {
  it("bekommt das Token zurück", () => {
    assert.equal(openToken(sealToken(TOKEN, KEY, USER), KEY, USER), TOKEN);
  });

  it("verschließt dasselbe Token jedes Mal anders", () => {
    assert.notEqual(sealToken(TOKEN, KEY, USER), sealToken(TOKEN, KEY, USER));
  });

  it("hat das Format v1.<iv>.<tag>.<daten>", () => {
    const sealed = sealToken(TOKEN, KEY, USER);

    assert.match(sealed, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
    assert.ok(!sealed.includes(TOKEN));
  });

  it("scheitert mit einem anderen Schlüssel", () => {
    assert.throws(
      () => openToken(sealToken(TOKEN, KEY, USER), OTHER_KEY, USER),
      TokenDecryptError,
    );
  });

  it("scheitert für einen anderen Nutzer", () => {
    assert.throws(
      () =>
        openToken(
          sealToken(TOKEN, KEY, USER),
          KEY,
          "00000000-0000-4000-8000-000000000000",
        ),
      TokenDecryptError,
    );
  });

  it("scheitert an einem veränderten Zeichen in iv, tag und daten", () => {
    const sealed = sealToken(TOKEN, KEY, USER);

    for (const part of [1, 2, 3] as const) {
      assert.throws(() => openToken(tamper(sealed, part), KEY, USER), TokenDecryptError);
    }
  });

  it("scheitert an einer fremden Version und an falscher Teilezahl", () => {
    const sealed = sealToken(TOKEN, KEY, USER);

    assert.throws(() => openToken(sealed.replace(/^v1/, "v2"), KEY, USER), TokenDecryptError);
    assert.throws(() => openToken(sealed.split(".").slice(0, 3).join("."), KEY, USER), TokenDecryptError);
    assert.throws(() => openToken(`${sealed}.mehr`, KEY, USER), TokenDecryptError);
    assert.throws(() => openToken("", KEY, USER), TokenDecryptError);
  });

  it("nennt das Token in keiner Fehlermeldung", () => {
    try {
      openToken(sealToken(TOKEN, KEY, USER), OTHER_KEY, USER);
      assert.fail("hätte werfen müssen");
    } catch (fehler) {
      assert.ok(fehler instanceof TokenDecryptError);
      assert.ok(!fehler.message.includes(TOKEN));
    }
  });

  it("verlangt zum Verschließen einen 32-Byte-Schlüssel", () => {
    assert.throws(() => sealToken(TOKEN, Buffer.alloc(16), USER));
  });
});
