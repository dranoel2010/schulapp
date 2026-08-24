import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import {
  authorizationServerMetadata,
  canonicalResource,
  checkRegistration,
  isAllowedRedirectUri,
  originFrom,
  protectedResourceMetadata,
  redirectUriMatches,
  resourceMetadataUrl,
  safeReturnPath,
  splitRedirectUris,
  verifyPkce,
  OAUTH_SCOPE,
} from "@/lib/oauth";

/**
 * Die reinen Teile von @/lib/oauth: die Adressen, die in den Metadaten stehen,
 * die Regeln für Rückadressen und die PKCE-Prüfung.
 *
 * Alle drei entscheiden über Zugang, und alle drei kommen ohne Datenbank aus.
 * Was hier nicht steht, ist Absicht: das Ausstellen und Einlösen von Codes
 * schreibt, und das gehört in einen Test mit echter Datenbank und nicht in eine
 * nachgebaute. Warum ein Import dieser Datei trotzdem keine PGlite öffnet,
 * steht im Kopf von materials.test.ts.
 *
 * Der teuerste Fehler, den diese Datei abfangen soll, ist der stille: eine
 * Rückadresse, die durchgeht, obwohl sie woanders hinzeigt. Sie ist die
 * Stelle, an die ein frischer Zugangscode geschickt wird — wer sie fälschen
 * kann, braucht kein Passwort mehr.
 */

const HOST = "schulapp.example";

describe("originFrom", () => {
  it("nimmt das Schema aus x-forwarded-proto", () => {
    assert.equal(originFrom(HOST, "https"), "https://schulapp.example");
    assert.equal(originFrom(HOST, "http"), "http://schulapp.example");
  });

  it("liest aus einer Kette von Proxys den ersten Eintrag", () => {
    assert.equal(originFrom(HOST, "https, http"), "https://schulapp.example");
  });

  it("nimmt ohne Angabe https an — außer auf dem eigenen Rechner", () => {
    assert.equal(originFrom(HOST), "https://schulapp.example");
    assert.equal(originFrom("localhost:3000"), "http://localhost:3000");
    assert.equal(originFrom("127.0.0.1:3000"), "http://127.0.0.1:3000");
  });

  it("gibt ohne Host nichts zurück statt etwas zu raten", () => {
    assert.equal(originFrom(null), null);
    assert.equal(originFrom(""), null);
    assert.equal(originFrom("   "), null);
  });

  it("weist einen Host zurück, in dem eine zweite Adresse stecken könnte", () => {
    assert.equal(originFrom("schulapp.example/../evil"), null);
    assert.equal(originFrom("schulapp.example evil.example"), null);
    assert.equal(originFrom("schulapp.example\nX-Foo: 1"), null);
  });
});

describe("die Adressen in den Metadaten", () => {
  const origin = originFrom(HOST, "https")!;

  it("nennt den Server ohne Schrägstrich am Ende", () => {
    assert.equal(canonicalResource(origin), "https://schulapp.example/api/mcp");
    assert.equal(
      canonicalResource("https://schulapp.example/"),
      "https://schulapp.example/api/mcp",
    );
  });

  it("schiebt den Pfad des Servers HINTER das well-known", () => {
    assert.equal(
      resourceMetadataUrl(origin),
      "https://schulapp.example/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("nennt in der Ressourcen-Beschreibung genau die Adresse, die der Client aufruft", () => {
    const doc = protectedResourceMetadata(origin);

    assert.equal(doc.resource, canonicalResource(origin));
    assert.deepEqual(doc.authorization_servers, [origin]);
    assert.deepEqual(doc.scopes_supported, [OAUTH_SCOPE]);
  });

  it("führt kein offline_access unter den Umfängen", () => {
    const doc = protectedResourceMetadata(origin);
    assert.equal((doc.scopes_supported as string[]).includes("offline_access"), false);
  });

  it("nennt PKCE und öffentliche Clients — ohne beides käme keine Verbindung zustande", () => {
    const doc = authorizationServerMetadata(origin);

    assert.deepEqual(doc.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(doc.token_endpoint_auth_methods_supported, ["none"]);
    assert.equal(doc.issuer, origin);
  });

  it("nennt alle Adressen absolut und unter derselben Herkunft", () => {
    const doc = authorizationServerMetadata(origin);

    for (const key of [
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
    ]) {
      assert.equal(
        String(doc[key]).startsWith(`${origin}/`),
        true,
        `${key} steht nicht unter ${origin}`,
      );
    }
  });
});

describe("isAllowedRedirectUri", () => {
  it("lässt https durch", () => {
    assert.equal(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"), true);
  });

  it("lässt http nur auf dem eigenen Rechner durch", () => {
    assert.equal(isAllowedRedirectUri("http://localhost:53219/callback"), true);
    assert.equal(isAllowedRedirectUri("http://127.0.0.1/callback"), true);
    assert.equal(isAllowedRedirectUri("http://beispiel.example/callback"), false);
  });

  it("weist alles zurück, was kein http(s) ist", () => {
    assert.equal(isAllowedRedirectUri("javascript:alert(1)"), false);
    assert.equal(isAllowedRedirectUri("data:text/html,x"), false);
    assert.equal(isAllowedRedirectUri("schulapp://zurueck"), false);
    assert.equal(isAllowedRedirectUri("keine adresse"), false);
  });

  it("weist eine Adresse mit Fragment zurück", () => {
    assert.equal(isAllowedRedirectUri("https://claude.ai/cb#teil"), false);
  });
});

describe("redirectUriMatches", () => {
  const angemeldet = ["https://claude.ai/api/mcp/auth_callback"];

  it("vergleicht Zeichen für Zeichen", () => {
    assert.equal(redirectUriMatches(angemeldet, angemeldet[0]!), true);
    assert.equal(
      redirectUriMatches(angemeldet, "https://claude.ai/api/mcp/auth_callback/"),
      false,
    );
    assert.equal(
      redirectUriMatches(angemeldet, "https://claude.ai/api/mcp/auth_callback?x=1"),
      false,
    );
  });

  it("lässt sich nicht von einer ähnlichen Adresse täuschen", () => {
    assert.equal(redirectUriMatches(angemeldet, "https://claude.ai.evil.example/api/mcp/auth_callback"), false);
    assert.equal(redirectUriMatches(angemeldet, "https://evil.example/?x=https://claude.ai/api/mcp/auth_callback"), false);
    assert.equal(redirectUriMatches(angemeldet, "http://claude.ai/api/mcp/auth_callback"), false);
  });

  it("lässt auf dem eigenen Rechner einen anderen Port zu — und sonst nichts", () => {
    const lokal = ["http://127.0.0.1:1234/callback"];

    assert.equal(redirectUriMatches(lokal, "http://127.0.0.1:59999/callback"), true);
    assert.equal(redirectUriMatches(lokal, "http://127.0.0.1:59999/anders"), false);
    assert.equal(redirectUriMatches(lokal, "http://localhost:59999/callback"), false);
    assert.equal(redirectUriMatches(lokal, "https://127.0.0.1:59999/callback"), false);
  });

  it("findet nichts in einer leeren Liste", () => {
    assert.equal(redirectUriMatches([], "https://claude.ai/api/mcp/auth_callback"), false);
  });
});

describe("verifyPkce", () => {
  /** So rechnet ein Client den Prüfwert aus (RFC 7636 §4.2). */
  function challengeFor(verifier: string): string {
    return createHash("sha256").update(verifier, "ascii").digest("base64url");
  }

  const verifier = randomBytes(32).toString("base64url");

  it("erkennt das richtige Geheimnis", () => {
    assert.equal(verifyPkce(challengeFor(verifier), verifier), true);
  });

  it("weist ein anderes Geheimnis ab", () => {
    const anderes = randomBytes(32).toString("base64url");
    assert.equal(verifyPkce(challengeFor(verifier), anderes), false);
  });

  it("weist ein Geheimnis ab, das die Form nicht einhält", () => {
    // Zu kurz (unter 43 Zeichen) …
    assert.equal(verifyPkce(challengeFor("kurz"), "kurz"), false);
    // … und mit Zeichen, die dort nicht vorkommen dürfen.
    const mitLeerzeichen = `${verifier.slice(0, 40)} ab`;
    assert.equal(verifyPkce(challengeFor(mitLeerzeichen), mitLeerzeichen), false);
  });

  it("weist einen leeren Prüfwert ab", () => {
    assert.equal(verifyPkce("", verifier), false);
    assert.equal(verifyPkce(challengeFor(verifier), ""), false);
  });
});

describe("splitRedirectUris", () => {
  it("macht aus der Spalte wieder eine Liste", () => {
    assert.deepEqual(splitRedirectUris("https://a.example/cb https://b.example/cb"), [
      "https://a.example/cb",
      "https://b.example/cb",
    ]);
  });

  it("liefert für eine leere Spalte eine leere Liste und keinen leeren Eintrag", () => {
    assert.deepEqual(splitRedirectUris(""), []);
    assert.deepEqual(splitRedirectUris("   "), []);
  });
});

describe("safeReturnPath", () => {
  it("lässt einen Weg innerhalb der App durch", () => {
    assert.equal(safeReturnPath("/verbinden?client_id=1"), "/verbinden?client_id=1");
    assert.equal(safeReturnPath("/"), "/");
  });

  it("weist alles zurück, was zu einem fremden Server führen könnte", () => {
    assert.equal(safeReturnPath("//evil.example"), null);
    assert.equal(safeReturnPath("/\\evil.example"), null);
    assert.equal(safeReturnPath("https://evil.example"), null);
    assert.equal(safeReturnPath("javascript:alert(1)"), null);
    assert.equal(safeReturnPath("verbinden"), null);
  });

  it("weist einen Zeilenumbruch zurück", () => {
    assert.equal(safeReturnPath("/verbinden\nX-Foo: 1"), null);
  });

  it("macht aus nichts nichts", () => {
    assert.equal(safeReturnPath(null), null);
    assert.equal(safeReturnPath(undefined), null);
    assert.equal(safeReturnPath(""), null);
  });
});

describe("checkRegistration", () => {
  it("nimmt eine Anmeldung mit einer https-Rückadresse an", () => {
    const result = checkRegistration({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.client.name, "Claude");
    assert.deepEqual(result.client.redirectUris, [
      "https://claude.ai/api/mcp/auth_callback",
    ]);
  });

  it("gibt einem namenlosen Client ein Wort, mit dem die Frage dasteht", () => {
    const result = checkRegistration({ redirect_uris: ["https://a.example/cb"] });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.client.name.length > 0, true);
  });

  it("lehnt eine Anmeldung ohne Rückadresse ab", () => {
    for (const body of [{}, { redirect_uris: [] }, { redirect_uris: "https://a.example/cb" }]) {
      const result = checkRegistration(body);
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.error, "invalid_redirect_uri");
    }
  });

  it("lehnt eine Rückadresse ab, die woanders hinzeigt", () => {
    const result = checkRegistration({
      redirect_uris: ["https://claude.ai/cb", "javascript:alert(1)"],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "invalid_redirect_uri");
  });

  it("lehnt ab, was gar kein Objekt ist", () => {
    for (const body of [null, "text", 42, []]) {
      assert.equal(checkRegistration(body).ok, false);
    }
  });

  it("wirft Dubletten weg, statt sie doppelt anzumelden", () => {
    const result = checkRegistration({
      redirect_uris: ["https://a.example/cb", "https://a.example/cb"],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.client.redirectUris, ["https://a.example/cb"]);
  });
});
