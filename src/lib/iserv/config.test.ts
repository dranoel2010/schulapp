import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { IservZugang, readIservConfig, teileListe } from "@/lib/iserv/config";

const PASSWORT = "Ge heim&<'\"+ä%42 ";

const VOLL = {
  ISERV_URL: "https://iserv.example.test",
  ISERV_USER: "test.schueler",
  ISERV_PASSWORD: PASSWORT,
  ISERV_KLASSE: "10",
};

function missing(env: Record<string, string | undefined>): string[] {
  const ergebnis = readIservConfig(env);
  assert.equal(ergebnis.ok, false);
  return ergebnis.ok ? [] : ergebnis.missing;
}

describe("readIservConfig", () => {
  it("nennt jede fehlende Pflichtvariable beim Namen", () => {
    assert.deepEqual(missing({}), ["ISERV_URL", "ISERV_USER", "ISERV_PASSWORD", "ISERV_KLASSE"]);
  });

  it("zählt leere und nur aus Leerzeichen bestehende Werte als fehlend", () => {
    assert.deepEqual(
      missing({ ISERV_URL: " ", ISERV_USER: "", ISERV_PASSWORD: "   ", ISERV_KLASSE: "\t" }),
      ["ISERV_URL", "ISERV_USER", "ISERV_PASSWORD", "ISERV_KLASSE"],
    );
  });

  it("nimmt eine gültige Umgebung an — Origin, Klasse, Passwort ungetrimmt", () => {
    const ergebnis = readIservConfig({ ...VOLL, ISERV_URL: "https://iserv.example.test/" });

    assert.ok(ergebnis.ok);
    assert.equal(ergebnis.config.zugang.origin, "https://iserv.example.test");
    assert.equal(ergebnis.config.zugang.user, "test.schueler");
    assert.equal(ergebnis.config.klasse, 10);
    assert.deepEqual(ergebnis.config.auch, []);
    assert.equal(ergebnis.config.klassenkalender, null);
    // Leerzeichen am Rand gehören zum Passwort.
    assert.equal(
      new URLSearchParams(ergebnis.config.zugang.formBody()).get("_password"),
      PASSWORT,
    );
  });

  it("lehnt ungültige Adressen ab: http, Pfad, Query, Hash, Zugangsdaten", () => {
    for (const url of [
      "http://iserv.example.test",
      "https://iserv.example.test/iserv",
      "https://iserv.example.test/?a=1",
      "https://iserv.example.test/#x",
      "https://ich:geheim@iserv.example.test",
      "kein url",
    ]) {
      assert.deepEqual(missing({ ...VOLL, ISERV_URL: url }), ["ISERV_URL (ungültig)"], url);
    }
  });

  it("lässt http nur für den eigenen Rechner zu", () => {
    assert.ok(readIservConfig({ ...VOLL, ISERV_URL: "http://127.0.0.1:4321" }).ok);
    assert.ok(readIservConfig({ ...VOLL, ISERV_URL: "http://localhost:4321" }).ok);
  });

  it("verlangt eine Klasse von 1 bis 13, ohne Standardwert", () => {
    for (const klasse of ["0", "14", "zehn", "10a", "1.5", "-3"]) {
      assert.deepEqual(missing({ ...VOLL, ISERV_KLASSE: klasse }), ["ISERV_KLASSE (1–13)"], klasse);
    }
    for (const klasse of ["1", "13", " 9 "]) {
      assert.ok(readIservConfig({ ...VOLL, ISERV_KLASSE: klasse }).ok, klasse);
    }
  });

  it("lehnt Zeilenumbrüche in Benutzer und Passwort ab", () => {
    assert.deepEqual(missing({ ...VOLL, ISERV_PASSWORD: "a\nb" }), ["ISERV_PASSWORD (Zeilenumbruch)"]);
    assert.deepEqual(missing({ ...VOLL, ISERV_PASSWORD: "a\rb" }), ["ISERV_PASSWORD (Zeilenumbruch)"]);
    assert.deepEqual(missing({ ...VOLL, ISERV_USER: "a\nb" }), ["ISERV_USER (Zeilenumbruch)"]);
  });

  it("prüft ISERV_KLASSENKALENDER", () => {
    const ok = readIservConfig({ ...VOLL, ISERV_KLASSENKALENDER: "/arbeitsmaterial.10/calendar" });
    assert.ok(ok.ok);
    assert.equal(ok.config.klassenkalender, "/arbeitsmaterial.10/calendar");

    for (const wert of ["arbeitsmaterial.10", "/a/b/calendar", "/x/kalender"]) {
      assert.deepEqual(missing({ ...VOLL, ISERV_KLASSENKALENDER: wert }), ["ISERV_KLASSENKALENDER (ungültig)"]);
    }
  });

  it("zerlegt ISERV_AUCH und ISERV_NIE an „;“ und normalisiert", () => {
    const ergebnis = readIservConfig({
      ...VOLL,
      ISERV_AUCH: "MSA; EA 10;;x; ",
      ISERV_NIE: "Nachschreibetermin;Gartenkreis_Treffen",
    });

    assert.ok(ergebnis.ok);
    assert.deepEqual(ergebnis.config.auch, ["msa", "ea 10"]);
    assert.deepEqual(ergebnis.config.nie, ["nachschreibetermin", "gartenkreis treffen"]);
    assert.deepEqual(teileListe(null), []);
  });
});

describe("Das Passwort bleibt verborgen", () => {
  const ergebnis = readIservConfig(VOLL);
  assert.ok(ergebnis.ok);
  const config = ergebnis.config;

  it("steht weder in JSON.stringify noch in util.inspect", () => {
    const json = JSON.stringify(config);
    const text = inspect(config, { depth: 10, showHidden: true });

    for (const ausgabe of [json, text, String(config.zugang), `${config.zugang}`]) {
      assert.ok(!ausgabe.includes("Ge heim"), ausgabe);
      assert.ok(!ausgabe.includes("test.schueler"), ausgabe);
    }
    assert.match(json, /verborgen/);
  });

  it("steht nicht in der Liste der fehlenden Namen", () => {
    const fehlt = missing({ ...VOLL, ISERV_KLASSE: "99" });
    assert.ok(!JSON.stringify(fehlt).includes("Ge heim"));
  });

  it("wird in jeder Form geschwärzt: Klartext, URL-kodiert, Formular, HTML", () => {
    const zugang = new IservZugang("https://iserv.example.test", "test.schueler", PASSWORT);
    const html = PASSWORT.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    const formular = new URLSearchParams({ p: PASSWORT }).toString().slice(2);

    const text = `a ${PASSWORT} b ${encodeURIComponent(PASSWORT)} c ${formular} d ${html} e test.schueler`;
    const geschwaerzt = zugang.schwaerze(text);

    assert.ok(!geschwaerzt.includes("Ge heim"), geschwaerzt);
    assert.ok(!geschwaerzt.includes("Ge%20heim"), geschwaerzt);
    assert.ok(!geschwaerzt.includes("Ge+heim"), geschwaerzt);
    assert.ok(!geschwaerzt.includes("test.schueler"), geschwaerzt);
    assert.match(geschwaerzt, /«Passwort»/);
  });
});
