import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { CookieJar, defaultPath, pathMatch } from "@/lib/iserv/cookies";

const NOW = Date.parse("2026-10-05T20:00:00Z");
const u = (pfad: string, protokoll = "https") => new URL(`${protokoll}://iserv.example.test${pfad}`);

describe("CookieJar", () => {
  it("sendet nur, was zum Pfad passt", () => {
    const jar = new CookieJar();
    jar.setFrom(
      ["IServAuthSID=a1; path=/iserv/auth; secure; httponly", "IServSession=s1; path=/iserv; secure"],
      u("/iserv/auth/login"),
      NOW,
    );

    assert.equal(jar.header(u("/iserv/auth/login"), NOW), "IServAuthSID=a1; IServSession=s1");
    assert.equal(jar.header(u("/iserv/calendar/api/eventsources"), NOW), "IServSession=s1");
    assert.equal(jar.header(u("/iservx"), NOW), "");
    assert.equal(jar.header(u("/"), NOW), "");
  });

  it("nimmt ohne Path das Verzeichnis der Anfrage (RFC 6265, 5.1.4)", () => {
    assert.equal(defaultPath("/iserv/auth/login"), "/iserv/auth");
    assert.equal(defaultPath("/iserv"), "/");
    assert.equal(defaultPath(""), "/");

    const jar = new CookieJar();
    jar.setFrom(["X=1"], u("/iserv/auth/login"), NOW);
    assert.equal(jar.header(u("/iserv/auth/home"), NOW), "X=1");
    assert.equal(jar.header(u("/iserv/"), NOW), "");
  });

  it("kennt die Grenzen des Pfad-Vergleichs", () => {
    assert.ok(pathMatch("/iserv", "/iserv"));
    assert.ok(pathMatch("/iserv", "/iserv/"));
    assert.ok(pathMatch("/iserv/", "/iserv/x"));
    assert.ok(!pathMatch("/iserv", "/iservx"));
  });

  it("löscht mit Max-Age=0 und mit einem Expires in der Vergangenheit", () => {
    const jar = new CookieJar();
    jar.setFrom(["A=1; path=/", "B=2; path=/"], u("/"), NOW);
    jar.setFrom(
      ["A=deleted; Max-Age=0; path=/", "B=x; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/"],
      u("/"),
      NOW,
    );

    assert.equal(jar.header(u("/"), NOW), "");
    assert.equal(jar.size, 0);
  });

  it("lässt Max-Age vor Expires gelten und verfallen", () => {
    const jar = new CookieJar();
    jar.setFrom(["A=1; Max-Age=60; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/"], u("/"), NOW);

    assert.equal(jar.header(u("/"), NOW + 59_000), "A=1");
    assert.equal(jar.header(u("/"), NOW + 61_000), "");
  });

  it("überschreibt denselben Namen auf demselben Pfad", () => {
    const jar = new CookieJar();
    jar.setFrom(["A=1; path=/iserv"], u("/iserv/"), NOW);
    jar.setFrom(["A=2; path=/iserv"], u("/iserv/"), NOW);

    assert.equal(jar.header(u("/iserv/x"), NOW), "A=2");
    assert.equal(jar.size, 1);
  });

  it("hält gleiche Namen auf zwei Pfaden auseinander — der längere zuerst", () => {
    const jar = new CookieJar();
    jar.setFrom(["T=kurz; path=/iserv", "T=lang; path=/iserv/auth"], u("/iserv/"), NOW);

    assert.equal(jar.size, 2);
    assert.equal(jar.header(u("/iserv/auth/auth"), NOW), "T=lang; T=kurz");
    assert.equal(jar.header(u("/iserv/app"), NOW), "T=kurz");
  });

  it("schickt Secure-Cookies nur über https", () => {
    const jar = new CookieJar();
    jar.setFrom(["S=1; secure; path=/", "O=2; path=/"], u("/"), NOW);

    assert.equal(jar.header(u("/", "https"), NOW), "S=1; O=2");
    assert.equal(jar.header(u("/", "http"), NOW), "O=2");
  });

  it("weiß, ob ein Cookie mit Wert da ist", () => {
    const jar = new CookieJar();
    jar.setFrom(["IServSession=s1; path=/iserv", "Leer=; path=/"], u("/iserv/"), NOW);

    assert.ok(jar.has("IServSession"));
    assert.ok(!jar.has("Leer"));
    assert.ok(!jar.has("Fehlt"));

    jar.clear();
    assert.ok(!jar.has("IServSession"));
  });

  it("zeigt seine Werte weder in JSON noch in console.log", () => {
    const jar = new CookieJar();
    jar.setFrom(["IServSession=geheim-wert; path=/iserv"], u("/iserv/"), NOW);

    assert.ok(!JSON.stringify({ jar }).includes("geheim-wert"));
    assert.ok(!inspect(jar, { showHidden: true, depth: 5 }).includes("geheim-wert"));
  });

  it("übergeht kaputte Zeilen", () => {
    const jar = new CookieJar();
    jar.setFrom(["ohneGleich", "=nurWert", "  ; path=/"], u("/"), NOW);
    assert.equal(jar.size, 0);
  });
});
