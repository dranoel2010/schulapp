import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { schreibeZugang, ZUGANG_DATEI, type Zugang } from "./mcp.mts";

/**
 * Die einmalige Zustimmung: der Postbote holt sich seinen eigenen Zugang.
 *
 *   npx tsx harness/zugang.mts [https://schulapp-teal.vercel.app]
 *
 * Was hier passiert, ist genau das, was die Claude-App auch tut — nur dass der
 * Client kein Fenster hat und deshalb selbst eines aufmacht. Am Ende steht die
 * Verbindung in den Einstellungen der App, neben Claude, mit eigenem
 * Trennen-Knopf.
 *
 * **Der feste Port ist kein Schönheitsfehler, sondern Pflicht.** Die
 * Zustimmungsseite verzeiht beim Hinweg einen anderen Port (`redirectUriMatches()`
 * in @/lib/oauth), der Tausch danach aber nicht: dort wird die Rückadresse
 * zeichengleich verglichen. Wer sich also einen freien Port suchte, müsste ihn
 * mit anmelden — und hätte beim nächsten Mal einen anderen. Ein fester Port,
 * der belegt sein kann, ist der ehrlichere Handel; belegt heißt hier: ein Satz
 * und Abbruch, nicht ein stiller anderer Port.
 *
 * **127.0.0.1 und nicht localhost.** Der Server vergleicht den Namen des
 * Rechners, und die beiden sind für ihn zwei verschiedene (dieselbe Datei,
 * dieselbe Funktion). Wer hier mischt, bekommt die Absage-Seite „Diese
 * Rückadresse stimmt nicht" und wird gar nicht erst umgeleitet.
 */

const VORGABE_ORIGIN = "https://schulapp-teal.vercel.app";
const PORT = 41751;
const RUECKADRESSE = `http://127.0.0.1:${PORT}/callback`;

const origin = (process.argv[2] ?? VORGABE_ORIGIN).replace(/\/+$/, "");

/** Die Adressen des Ausstellers — abgeholt, nicht geraten. */
type Metadaten = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  issuer: string;
};

async function metadaten(): Promise<Metadaten> {
  const antwort = await fetch(`${origin}/.well-known/oauth-authorization-server`);

  if (!antwort.ok) {
    throw new Error(
      `${origin} beschreibt sich nicht als Aussteller (${antwort.status}). Stimmt die Adresse?`,
    );
  }

  return (await antwort.json()) as Metadaten;
}

/** Meldet den Postboten als Client an — ohne Passwort, so ist es vorgesehen. */
async function anmelden(endpunkt: string): Promise<string> {
  const antwort = await fetch(endpunkt, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Postbote",
      redirect_uris: [RUECKADRESSE],
    }),
  });

  const koerper = (await antwort.json()) as { client_id?: string; error_description?: string };

  if (!antwort.ok || !koerper.client_id) {
    throw new Error(`Anmeldung abgelehnt: ${koerper.error_description ?? antwort.status}`);
  }

  return koerper.client_id;
}

/**
 * Wartet auf die Antwort der Zustimmungsseite und gibt den Code zurück.
 *
 * Der Server läuft nur auf 127.0.0.1 und nur für diese eine Antwort. `state`
 * wird zeitkonstant verglichen — er ist der einzige Schutz davor, dass jemand
 * anderes dem wartenden Dienst einen Code unterschiebt.
 */
function wartenAufCode(state: string): Promise<string> {
  return new Promise((fertig, scheitern) => {
    const server = createServer((anfrage, antwort) => {
      const adresse = new URL(anfrage.url ?? "/", `http://127.0.0.1:${PORT}`);

      if (adresse.pathname !== "/callback") {
        antwort.writeHead(404).end();
        return;
      }

      const seite = (satz: string) =>
        `<!doctype html><meta charset="utf-8"><title>Postbote</title>` +
        `<body style="font:16px system-ui;margin:3rem;max-width:32rem"><p>${satz}</p></body>`;

      const fehler = adresse.searchParams.get("error");
      const code = adresse.searchParams.get("code");
      const zurueck = adresse.searchParams.get("state") ?? "";
      const iss = adresse.searchParams.get("iss");

      const antwortenUndSchliessen = (satz: string, dann: () => void) => {
        antwort.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        antwort.end(seite(satz));
        server.close(dann);
      };

      if (fehler) {
        antwortenUndSchliessen(
          `Abgelehnt (${fehler}). Der Postbote bekommt keinen Zugang. Du kannst dieses Fenster schließen.`,
          () => scheitern(new Error(`Zustimmung abgelehnt: ${fehler}`)),
        );
        return;
      }

      if (!code || !gleich(zurueck, state)) {
        antwortenUndSchliessen("Diese Antwort gehört nicht zu dieser Anfrage.", () =>
          scheitern(new Error("state stimmt nicht — die Antwort kam nicht von deiner Anfrage.")),
        );
        return;
      }

      if (iss && iss.replace(/\/+$/, "") !== origin) {
        antwortenUndSchliessen("Diese Antwort kommt von einem anderen Server.", () =>
          scheitern(new Error(`Antwort von ${iss}, erwartet war ${origin}.`)),
        );
        return;
      }

      antwortenUndSchliessen(
        "Danke — der Postbote hat jetzt Zugang. Du kannst dieses Fenster schließen.",
        () => fertig(code),
      );
    });

    server.on("error", (grund: NodeJS.ErrnoException) => {
      scheitern(
        grund.code === "EADDRINUSE"
          ? new Error(
              `Port ${PORT} ist belegt. Beende, was dort lauscht, und versuch es noch einmal — ein anderer Port ginge nicht, die Rückadresse ist angemeldet.`,
            )
          : grund,
      );
    });

    server.listen(PORT, "127.0.0.1");
  });
}

/** Zwei Zeichenketten zeitkonstant vergleichen. */
function gleich(a: string, b: string): boolean {
  const links = Buffer.from(a);
  const rechts = Buffer.from(b);

  return links.length === rechts.length && timingSafeEqual(links, rechts);
}

/** Öffnet den Browser. Klappt es nicht, steht die Adresse ohnehin im Terminal. */
function oeffne(adresse: string): void {
  const befehl =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

  try {
    spawn(befehl, [adresse], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Kein Browser, kein Problem: der Mensch kopiert die Adresse selbst.
  }
}

async function main(): Promise<void> {
  console.log(`Postbote meldet sich an bei ${origin}`);

  const beschreibung = await metadaten();
  const clientId = await anmelden(beschreibung.registration_endpoint);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const adresse =
    `${beschreibung.authorization_endpoint}?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(RUECKADRESSE)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${encodeURIComponent(state)}` +
    `&scope=mcp&resource=${encodeURIComponent(`${origin}/api/mcp`)}`;

  console.log("\nIm Browser öffnet sich jetzt die Zustimmungsseite deiner App.");
  console.log("Falls nicht, öffne sie selbst:\n");
  console.log(`  ${adresse}\n`);

  const warten = wartenAufCode(state);
  oeffne(adresse);

  const code = await warten;

  // Der Code lebt sechzig Sekunden — hier liegt nichts mehr dazwischen.
  const antwort = await fetch(beschreibung.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: RUECKADRESSE,
      code_verifier: verifier,
      resource: `${origin}/api/mcp`,
    }),
  });

  const koerper = (await antwort.json()) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!antwort.ok || !koerper.refresh_token) {
    throw new Error(
      `Tausch abgelehnt: ${koerper.error ?? antwort.status} — ${koerper.error_description ?? ""}`.trim(),
    );
  }

  const zugang: Zugang = {
    origin,
    resource: `${origin}/api/mcp`,
    clientId,
    redirectUri: RUECKADRESSE,
    refreshToken: koerper.refresh_token,
  };

  schreibeZugang(zugang);

  console.log(`Zugang liegt in ${ZUGANG_DATEI} (nur für dich lesbar).`);
  console.log("In der App steht der Postbote jetzt unter Einstellungen → Verbundene Programme.");
  console.log("\nJetzt kann er laufen:\n  npx tsx harness/postbote.mts");
}

main().catch((grund: unknown) => {
  console.error(`\n${grund instanceof Error ? grund.message : String(grund)}`);
  process.exit(1);
});
