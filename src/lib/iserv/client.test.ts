import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createIservClient,
  erlaubteAnfrage,
  IservFehler,
  neuerSitzungsSpeicher,
  type IservFehlerArt,
} from "@/lib/iserv/client";
import { IservZugang } from "@/lib/iserv/config";
import { CookieJar } from "@/lib/iserv/cookies";
import {
  EVENTSOURCES,
  fakeIserv,
  json,
  ORIGIN,
  WARTUNGS_SEITE,
  type FakeOptionen,
} from "@/lib/iserv/fixtures";

/**
 * Der Client gegen die Attrappe von IServ (@/lib/iserv/fixtures) — die echte
 * Kette aus Weiterleitungen und Meta-Refresh, Cookies auf zwei Pfaden, keine
 * echte Anmeldung irgendwo.
 */

const PASSWORT = "Ge heim&<'\"+ä%42";
const BENUTZER = "test.schueler";

function aufbau(optionen: Partial<FakeOptionen> = {}, zugangPasswort = PASSWORT) {
  const fake = fakeIserv({ passwort: PASSWORT, benutzer: BENUTZER, ...optionen });
  const speicher = neuerSitzungsSpeicher();
  const zugang = new IservZugang(ORIGIN, BENUTZER, zugangPasswort);
  const client = (deadline = Date.now() + 60_000) =>
    createIservClient(zugang, { fetch: fake.fetch, deadline, speicher });
  return { fake, speicher, zugang, client };
}

async function fehlerVon(lauf: Promise<unknown>): Promise<IservFehler> {
  try {
    await lauf;
  } catch (fehler) {
    assert.ok(fehler instanceof IservFehler, String(fehler));
    return fehler;
  }
  assert.fail("hätte werfen sollen");
}

function enthaeltPasswort(text: string): boolean {
  return [
    PASSWORT,
    encodeURIComponent(PASSWORT),
    new URLSearchParams({ p: PASSWORT }).toString().slice(2),
    "Ge heim",
    "Ge%20heim",
    "Ge+heim",
  ].some((form) => text.includes(form));
}

describe("Anmeldung gegen die Attrappe", () => {
  it("folgt der ganzen Kette und liest danach JSON", async () => {
    const { fake, client } = aufbau();
    const c = client();

    const antwort = await c.getJson("/iserv/calendar/api/eventsources");

    assert.deepEqual(antwort, EVENTSOURCES);
    assert.equal(c.logins, 1);
    assert.deepEqual(
      fake.protokoll.map((a) => `${a.methode} ${a.pfad}`),
      [
        "GET /iserv/auth/login",
        "POST /iserv/auth/login",
        "GET /iserv/auth/home",
        "GET /iserv",
        "GET /iserv/",
        "GET /iserv/auth/auth",
        "GET /iserv/app/authentication/redirect",
        "GET /iserv/",
        "GET /iserv/calendar/api/eventsources",
      ],
    );
    // Der Meta-Refresh trug „&amp;" — angekommen ist „&".
    const redirect = fake.protokoll.find((a) => a.pfad === "/iserv/app/authentication/redirect");
    assert.equal(redirect?.query, "?state=s-123.abc&code=c-456");
  });

  it("schickt die Cookies passend zum Pfad", async () => {
    const { fake, client } = aufbau();
    await client().getJson("/iserv/calendar/api/eventsources");

    const daten = fake.protokoll.find((a) => a.pfad === "/iserv/calendar/api/eventsources");
    assert.deepEqual(daten?.cookies.sort(), ["IServSAT", "IServSATId", "IServSession"]);
    const auth = fake.protokoll.find((a) => a.pfad === "/iserv/auth/auth");
    assert.ok(auth?.cookies.includes("IServAuthSession"));
  });

  it("verwendet die Session wieder — auch in einem neuen Client", async () => {
    const { fake, client } = aufbau();
    const erster = client();
    await erster.getJson("/iserv/calendar/api/eventsources");
    await erster.getJson("/iserv/calendar/api/eventsources");
    assert.equal(erster.logins, 1);

    const zweiter = client();
    await zweiter.getJson("/iserv/calendar/api/eventsources");
    assert.equal(zweiter.logins, 0);
    assert.equal(fake.posts().length, 1);
  });

  it("meldet sich bei einer verworfenen Session genau einmal neu an", async () => {
    const { fake, client } = aufbau();
    await client().getJson("/iserv/calendar/api/eventsources");
    fake.sessionsVerwerfen();

    const c = client();
    const antwort = await c.getJson("/iserv/calendar/api/eventsources");

    assert.deepEqual(antwort, EVENTSOURCES);
    assert.equal(c.logins, 1);
    assert.equal(fake.posts().length, 2);
  });

  it("meldet sich nach 15 Stunden vorher neu an", async () => {
    const { fake, speicher, zugang } = aufbau();
    let jetzt = Date.parse("2026-10-05T06:15:00Z");
    const neu = () =>
      createIservClient(zugang, { fetch: fake.fetch, deadline: jetzt + 60_000, speicher, now: () => jetzt });

    await neu().getJson("/iserv/calendar/api/eventsources");
    jetzt += 14 * 3_600_000;
    assert.equal((await (async () => { const c = neu(); await c.getJson("/iserv/calendar/api/eventsources"); return c.logins; })()), 0);
    jetzt += 2 * 3_600_000;
    const c = neu();
    await c.getJson("/iserv/calendar/api/eventsources");
    assert.equal(c.logins, 1);
  });

  it("gibt bei einer gleich wieder verworfenen Session „session“ — ohne zweite Anmeldung", async () => {
    let verwerfen = false;
    const { fake, client } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () => {
          if (verwerfen) return new Response(null, { status: 302, headers: { location: "/iserv/auth/auth" } });
          return json(EVENTSOURCES);
        },
      },
    });
    verwerfen = true;
    const fehler = await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"));

    assert.equal(fehler.art, "session");
    assert.equal(fehler.sperrt, false);
    assert.equal(fake.posts().length, 1);
  });

  it("nimmt eine Speicher-Session mit fremdem Benutzer nicht", async () => {
    const { fake, speicher, client } = aufbau();
    speicher.setzen({ origin: ORIGIN, user: "jemand.anders", jar: new CookieJar(), angemeldetAm: Date.now() });

    const c = client();
    await c.getJson("/iserv/calendar/api/eventsources");
    assert.equal(c.logins, 1);
    assert.equal(fake.posts().length, 1);
  });
});

describe("Abgelehnte Anmeldung — sperrt, genau EIN Versuch", () => {
  it("falsches Passwort → „abgelehnt“, sperrt, genau ein POST", async () => {
    const { fake, speicher, client } = aufbau({}, "falsch");
    const fehler = await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"));

    assert.equal(fehler.art, "abgelehnt");
    assert.equal(fehler.sperrt, true);
    assert.equal(fake.posts().length, 1);
    assert.equal(speicher.holen(ORIGIN, BENUTZER), null);
  });

  const faelle: [FakeOptionen["loginErgebnis"], IservFehlerArt, boolean][] = [
    ["zweiter-faktor", "zweiter-faktor", true],
    ["captcha", "captcha", true],
    ["gesperrt", "gesperrt", true],
    ["passwort-abgelaufen", "passwort-abgelaufen", true],
    ["unsinn", "unerwartet", false],
  ];

  for (const [ergebnis, art, sperrt] of faelle) {
    it(`${ergebnis} → „${art}“`, async () => {
      const { fake, client } = aufbau({ loginErgebnis: ergebnis });
      const fehler = await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"));

      assert.equal(fehler.art, art);
      assert.equal(fehler.sperrt, sperrt);
      assert.equal(fake.posts().length, 1);
    });
  }

  it("hält die Startseite mit „gesperrt“ in einer Neuigkeit nicht für eine Sperre", async () => {
    // STARTSEITE trägt „Die Turnhalle ist bis Freitag gesperrt." — angemeldet ist trotzdem.
    const { client } = aufbau();
    const c = client();
    await c.getJson("/iserv/calendar/api/eventsources");
    assert.equal(c.logins, 1);
  });

  it("nennt das Passwort in keinem Satz — auch wenn IServ es in die Seite zurückschreibt", async () => {
    const { client } = aufbau({ echoPasswort: true }, `${PASSWORT}x`);
    const fehler = await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"));

    for (const text of [fehler.satz, fehler.message, String(fehler), JSON.stringify(fehler), fehler.stack ?? ""]) {
      assert.ok(!enthaeltPasswort(text), text);
    }
  });
});

describe("Antworten, die nicht passen", () => {
  it("folgt keiner Weiterleitung auf eine fremde Adresse", async () => {
    const { client } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () =>
          new Response(null, { status: 302, headers: { location: "https://boese.example.test/x?code=1" } }),
      },
    });
    const fehler = await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"));

    assert.equal(fehler.art, "fremde-adresse");
    assert.ok(!fehler.satz.includes("boese"));
  });

  it("lehnt eine fremde Feed-Adresse ab, bevor es fragt", async () => {
    const { fake, client } = aufbau();
    const fehler = await fehlerVon(client().getJson("https://fremd.example.test/iserv/x"));

    assert.equal(fehler.art, "fremde-adresse");
    assert.equal(fake.protokoll.length, 0);
  });

  it("HTML statt JSON → „format“", async () => {
    const { client } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () =>
          new Response(WARTUNGS_SEITE, { status: 200, headers: { "content-type": "text/html" } }),
      },
    });
    assert.equal((await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"))).art, "format");
  });

  it("kaputtes JSON → „format“", async () => {
    const { client } = aufbau({
      routen: { "/iserv/calendar/api/eventsources": () => new Response("[{kaputt", { status: 200 }) },
    });
    assert.equal((await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"))).art, "format");
  });

  it("500 und 429 → „voruebergehend“, ohne zu sperren", async () => {
    for (const status of [500, 503, 429]) {
      const { client } = aufbau({
        routen: { "/iserv/calendar/api/eventsources": () => json({ error: "x" }, status) },
      });
      const fehler = await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"));
      assert.equal(fehler.art, "voruebergehend", String(status));
      assert.equal(fehler.sperrt, false);
      assert.match(fehler.satz, new RegExp(`HTTP ${status}`));
    }
  });

  it("403 → „verweigert“, 404 → „fehlt“", async () => {
    const { client } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () => json({}, 403),
        "/iserv/calendar4/plugin": () => json({}, 404),
      },
    });
    assert.equal((await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"))).art, "verweigert");
    assert.equal((await fehlerVon(client().getJson("/iserv/calendar4/plugin", { plugin: "exam-plan" }))).art, "fehlt");
  });

  it("Netzfehler → „voruebergehend“", async () => {
    const zugang = new IservZugang(ORIGIN, BENUTZER, PASSWORT);
    const c = createIservClient(zugang, {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      deadline: Date.now() + 60_000,
      speicher: neuerSitzungsSpeicher(),
    });
    assert.equal((await fehlerVon(c.getJson("/iserv/calendar/api/eventsources"))).art, "voruebergehend");
  });

  it("bricht eine Antwort über 2 MB ab → „zu-gross“", async () => {
    const riesig = `[${'"x",'.repeat(600_000)}"x"]`;
    const { client } = aufbau({
      routen: { "/iserv/calendar/api/eventsources": () => new Response(riesig, { status: 200 }) },
    });
    assert.equal((await fehlerVon(client().getJson("/iserv/calendar/api/eventsources"))).art, "zu-gross");
  });

  it("fragt nicht mehr, wenn die Zeit nicht reicht → „budget“", async () => {
    const { fake, client } = aufbau();
    const fehler = await fehlerVon(client(Date.now() + 5_000).getJson("/iserv/calendar/api/eventsources"));

    assert.equal(fehler.art, "budget");
    assert.equal(fake.protokoll.length, 0);
  });
});

describe("Nur lesen", () => {
  it("außer genau einem POST an /iserv/auth/login nur GET", async () => {
    const { fake, client } = aufbau();
    const c = client();
    await c.getJson("/iserv/calendar/api/eventsources");
    await c.getJson("/iserv/calendar/feed/calendar", { cal: "/+public/calendar", start: "2026-09-21", end: "2027-10-05" });
    await c.getJson(`${ORIGIN}/iserv/calendar4/plugin?plugin=exercise`, { start: "2026-09-21", end: "2027-10-05" });

    const posts = c.anfragen.filter((a) => a.methode !== "GET");
    assert.deepEqual(posts, [{ methode: "POST", pfad: "/iserv/auth/login" }]);
    assert.deepEqual(fake.posts().map((a) => a.pfad), ["/iserv/auth/login"]);
  });

  it("verweigert jeden anderen POST, bevor er hinausginge", () => {
    assert.throws(() => erlaubteAnfrage("POST", "/iserv/calendar/api/eventsources"));
    assert.throws(() => erlaubteAnfrage("POST", "/iserv/exercise/show/1"));
    assert.doesNotThrow(() => erlaubteAnfrage("POST", "/iserv/auth/login"));
    assert.doesNotThrow(() => erlaubteAnfrage("GET", "/iserv/exercise/show/1"));
  });

  it("setzt Parameter über searchParams, nie per Verkettung", async () => {
    const { fake, client } = aufbau();
    await client().getJson("/iserv/calendar/feed/calendar?cal=/%2Bpublic/calendar", { start: "2026-09-21", end: "a&b=c" });

    const feed = fake.protokoll.find((a) => a.pfad === "/iserv/calendar/feed/calendar");
    const params = new URLSearchParams(feed?.query);
    assert.equal(params.get("cal"), "/+public/calendar");
    assert.equal(params.get("end"), "a&b=c");
    assert.equal(params.get("b"), null);
  });
});

describe("logout", () => {
  it("meldet ab und vergisst die Session", async () => {
    const { fake, speicher, client } = aufbau();
    const c = client();
    await c.getJson("/iserv/calendar/api/eventsources");
    await c.logout();

    assert.equal(speicher.holen(ORIGIN, BENUTZER), null);
    assert.ok(fake.protokoll.some((a) => a.pfad === "/iserv/auth/logout"));
  });

  it("tut ohne Session nichts", async () => {
    const { fake, client } = aufbau();
    await client().logout();
    assert.equal(fake.protokoll.length, 0);
  });
});
