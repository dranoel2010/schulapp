import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAPTCHA_SEITE,
  GESPERRT_SEITE,
  LOGIN_SEITE,
  loginFehlgeschlagen,
  metaRefresh,
  PASSWORT_ABGELAUFEN_SEITE,
  STARTSEITE,
  ZWEI_FAKTOR_SEITE,
} from "@/lib/iserv/fixtures";
import {
  dekodiere,
  istLoginFormular,
  istZweiterFaktor,
  metaRefreshZiel,
  ordneLoginEin,
  saeubere,
  saeubereMehrzeilig,
} from "@/lib/iserv/html";

describe("metaRefreshZiel", () => {
  it("liest die Weiterleitung von IServ — mit &amp; und in einfachen Anführungszeichen", () => {
    assert.equal(
      metaRefreshZiel(metaRefresh("/iserv/app/authentication/redirect?state=s1&amp;code=c2", true)),
      "/iserv/app/authentication/redirect?state=s1&code=c2",
    );
    assert.equal(metaRefreshZiel(metaRefresh("/iserv")), "/iserv");
  });

  it("verträgt Groß- und Kleinschreibung, andere Anführungszeichen und Leerzeichen", () => {
    assert.equal(metaRefreshZiel(`<META HTTP-EQUIV='Refresh' CONTENT='5; URL=/a?b=1&amp;c=2'>`), "/a?b=1&c=2");
    assert.equal(metaRefreshZiel(`<meta content="0 ; url = &quot;/x&quot;" http-equiv = "refresh" />`), "/x");
    assert.equal(metaRefreshZiel(`<meta http-equiv=refresh content="0;url=/y">`), "/y");
  });

  it("findet nichts, wo nichts ist", () => {
    assert.equal(metaRefreshZiel(LOGIN_SEITE), null);
    assert.equal(metaRefreshZiel(`<meta charset="UTF-8"><meta http-equiv="refresh" content="30">`), null);
    assert.equal(metaRefreshZiel(""), null);
  });
});

describe("dekodiere und saeubere", () => {
  it("dekodiert in einem Durchgang", () => {
    assert.equal(dekodiere("a &amp;lt; b"), "a &lt; b");
    assert.equal(dekodiere("&quot;x&quot; &#39;y&#x27; &#228;&#xE4; &nbsp;|"), "\"x\" 'y' ää  |");
    assert.equal(dekodiere("&unbekannt; &#0; &#xD800;"), "&unbekannt; � �");
  });

  it("nimmt Tags weg, dekodiert, entfernt Steuerzeichen und fasst Leerraum zusammen", () => {
    assert.equal(saeubere("  <b>Kl. 10</b>_Theater &amp; Musik\n\tim\u0000 Saal‮ ", 200), "Kl. 10 _Theater & Musik im Saal");
    assert.equal(saeubere("<script>alert(1)</script>Titel", 200), "alert(1) Titel");
    assert.equal(saeubere("   ", 200), "");
  });

  it("lässt auch KODIERTES Markup nie als HTML stehen", () => {
    const boese = 'Infos: &lt;a href=&quot;https://boese.example.test/login&quot;&gt;IServ-Anmeldung&lt;/a&gt;';
    assert.equal(saeubereMehrzeilig(boese, 500), "Infos: IServ-Anmeldung");
    assert.equal(saeubere("&lt;script&gt;alert(1)&lt;/script&gt;Titel", 200), "alert(1) Titel");
    assert.equal(saeubere("&amp;lt;b&amp;gt;fett", 200), "&lt;b&gt;fett", "doppelt kodiert bleibt kodiert");
    assert.equal(saeubere("&lt;img src=x onerror=alert(1)", 200), "‹img src=x onerror=alert(1)");
    for (const text of [boese, "&lt;b&gt;x&lt;/b&gt;", "<<b>b>", "&#60;i&#62;x&#60;/i&#62;"]) {
      assert.ok(!/[<>]/.test(saeubere(text, 200)), text);
      assert.ok(!/[<>]/.test(saeubereMehrzeilig(text, 500)), text);
    }
  });

  it("lässt eine spitze Klammer im Text lesbar", () => {
    assert.equal(saeubere("Note 1 < 2 und 3 > 2", 200), "Note 1 ‹ 2 und 3 › 2");
    assert.equal(saeubere("Note 1 &lt; 2", 200), "Note 1 ‹ 2");
  });

  it("kürzt mit „…“", () => {
    const lang = "x".repeat(250);
    const kurz = saeubere(lang, 200);

    assert.equal(kurz.length, 200);
    assert.ok(kurz.endsWith("…"));
    assert.equal(saeubere("abc", 3), "abc");
    assert.equal(saeubere("abcd", 3), "ab…");
  });

  it("lässt in mehrzeiligem Text die Zeilen stehen — höchstens eine Leerzeile", () => {
    assert.equal(
      saeubereMehrzeilig("Zeile 1\r\n<b>Zeile</b>   2\n\n\n\n  Zeile 3  ", 500),
      "Zeile 1\nZeile 2\n\nZeile 3",
    );
  });
});

describe("ordneLoginEin", () => {
  it("erkennt die abgelehnte Anmeldung am wiedergekommenen Formular", () => {
    assert.ok(istLoginFormular(LOGIN_SEITE));
    assert.equal(ordneLoginEin("/iserv/auth/login", loginFehlgeschlagen()), "abgelehnt");
  });

  it("lässt sich vom Browser-Banner und dem versteckten „Bitte warten“ nicht täuschen", () => {
    // Beides steht auf JEDER Login-Seite — ein Banner allein ist nur „abgelehnt".
    assert.match(LOGIN_SEITE, /veralteten Webbrowser/);
    assert.match(LOGIN_SEITE, /Bitte warten Sie/);
    assert.equal(ordneLoginEin("/iserv/auth/login", LOGIN_SEITE), "abgelehnt");
    assert.equal(
      ordneLoginEin("/iserv/", LOGIN_SEITE.replace(/<form[\s\S]*<\/form>/, "")),
      null,
    );
  });

  it("erkennt den zweiten Faktor — am Feld und am Text", () => {
    assert.ok(istZweiterFaktor(ZWEI_FAKTOR_SEITE));
    assert.equal(ordneLoginEin("/iserv/auth/login/2fa", ZWEI_FAKTOR_SEITE), "zweiter-faktor");
    assert.equal(ordneLoginEin("/iserv/auth/x", `<input name="_two_factor_token">`), "zweiter-faktor");
    assert.equal(ordneLoginEin("/iserv/auth/x", `<p>Zwei-Faktor-Anmeldung</p>`), "zweiter-faktor");
  });

  it("erkennt ein Captcha, auch nur in einem Attribut", () => {
    assert.equal(ordneLoginEin("/iserv/auth/login", CAPTCHA_SEITE), "captcha");
  });

  it("erkennt eine Sperre", () => {
    assert.equal(ordneLoginEin("/iserv/auth/login", GESPERRT_SEITE), "gesperrt");
    assert.equal(ordneLoginEin("/iserv/auth/login", "<p>Too many login attempts</p>"), "gesperrt");
  });

  it("erkennt ein abgelaufenes Passwort — am Pfad oder am Text", () => {
    assert.equal(ordneLoginEin("/iserv/auth/password/change", PASSWORT_ABGELAUFEN_SEITE), "passwort-abgelaufen");
    assert.equal(ordneLoginEin("/iserv/auth/x", "<p>Ihr Passwort ist abgelaufen.</p>"), "passwort-abgelaufen");
  });

  it("sagt bei einer Seite ohne Hinweis nichts", () => {
    assert.equal(ordneLoginEin("/iserv/irgendwo", "<p>Nichts</p>"), null);
  });

  it("hält ein „gesperrt“ in einem Skript nicht für Text", () => {
    assert.equal(
      ordneLoginEin("/iserv/x", `<script>var gesperrt = true;</script><p>Hallo</p>`),
      null,
    );
    // Die Startseite trägt „gesperrt" sichtbar — deshalb fragt login() erst, ob
    // es drin ist, und ordnet nur ein, wenn nicht (siehe client.test.ts).
    assert.equal(ordneLoginEin("/iserv/", STARTSEITE), "gesperrt");
  });
});
