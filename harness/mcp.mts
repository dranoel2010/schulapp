import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Der Draht zur Schulapp — ein MCP-Client aus fetch und sonst nichts.
 *
 * **Warum keine Bibliothek.** Der Server dieser App spricht Streamable HTTP,
 * vergibt aber keine Sitzungen, hält keinen Strom offen und antwortet immer mit
 * JSON (siehe @/lib/mcp/protocol). Was davon übrig bleibt, ist eine POST-Adresse
 * mit JSON-RPC — dafür eine Bibliothek zu holen, die einen GET-Strom aufbauen
 * will, hieße einen Transport nachzubauen, den es hier nicht gibt.
 *
 * **Der Postbote hat einen eigenen Zugang, nicht den von Claude.** Er meldet
 * sich als eigener Client an und holt sich eine eigene Zustimmung. Damit steht
 * er in den Einstellungen als eigene Zeile neben Claude und lässt sich einzeln
 * trennen — was für einen Dienst, der unbeaufsichtigt läuft, die halbe Miete
 * ist. (Und es muss so sein: eine zweite Zustimmung desselben Clients zieht die
 * erste zurück, `createTokens()` in @/lib/oauth. Zwei Dienste, zwei
 * Anmeldungen.)
 *
 * **Das Erneuerungs-Token ist das eigentliche Geheimnis.** Es liegt in
 * `zugang.json` mit 0600 und ist neunzig Tage lang der Schlüssel zu allem, was
 * die App über die Schule weiß. Der Server hält davon nur einen Abdruck; geht
 * die Datei verloren, hilft nur eine neue Zustimmung. Und es wird bei jedem
 * Gebrauch getauscht: wer eine alte Fassung ein zweites Mal vorzeigt, bringt
 * die ganze Verbindung zu Fall — deshalb wird hier nach JEDER Erneuerung sofort
 * geschrieben, bevor irgendetwas anderes passiert.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));

/** Wo der Zugang liegt. Nicht in Git — siehe harness/.gitignore. */
export const ZUGANG_DATEI = path.join(HIER, "zugang.json");

/**
 * Was der Dienst über seinen Zugang wissen muss, um nach einem Neustart
 * weiterzumachen. Mehr steht nicht drin, und das Zugriffs-Token ausdrücklich
 * nicht: es gilt eine Stunde und ist in einer Datei schlechter aufgehoben als
 * im Arbeitsspeicher.
 */
export type Zugang = {
  /** Die Adresse, unter der zugestimmt wurde. Eine andere lehnt der Server ab. */
  origin: string;
  /** Wofür das Token gilt: „<origin>/api/mcp". */
  resource: string;
  clientId: string;
  /** Die angemeldete Rückadresse — für eine spätere neue Zustimmung. */
  redirectUri: string;
  /** Geheim. Neunzig Tage, gleitend: jede Erneuerung setzt die Frist neu. */
  refreshToken: string;
};

export function liesZugang(): Zugang {
  if (!existsSync(ZUGANG_DATEI)) {
    throw new FehlenderZugang();
  }

  return JSON.parse(readFileSync(ZUGANG_DATEI, "utf8")) as Zugang;
}

export function schreibeZugang(zugang: Zugang): void {
  writeFileSync(ZUGANG_DATEI, `${JSON.stringify(zugang, null, 2)}\n`, {
    mode: 0o600,
  });
  // Auch dann auf 0600 setzen, wenn die Datei schon vorher existierte — der
  // mode-Parameter oben gilt nur beim Anlegen.
  chmodSync(ZUGANG_DATEI, 0o600);
}

/** Es gibt noch keinen Zugang; der Mensch muss einmal zustimmen. */
export class FehlenderZugang extends Error {
  constructor() {
    super(
      `Kein Zugang unter ${ZUGANG_DATEI}. Einmal einrichten:\n  npx tsx harness/zugang.mts`,
    );
  }
}

/** Die Verbindung ist tot — abgelaufen, getrennt oder ein Token zweimal benutzt. */
export class ZugangVerloren extends Error {
  constructor(grund: string) {
    super(
      `${grund}\nDie Verbindung gilt nicht mehr. Neu zustimmen:\n  npx tsx harness/zugang.mts`,
    );
  }
}

/** Ein Werkzeug hat fachlich nein gesagt — kein Grund, den Dienst zu beenden. */
export class WerkzeugFehler extends Error {}

/** Was ein Werkzeug zurückgibt: der deutsche Satz und die Daten darunter. */
export type Antwort = { satz: string; daten: unknown };

/**
 * Eine offene Verbindung zur App. Hält das Zugriffs-Token im Arbeitsspeicher
 * und erneuert es, wenn es abläuft oder der Server es ablehnt.
 */
export class Verbindung {
  private zugang: Zugang;
  private token: string | null = null;
  private laeuftAb = 0;
  private naechsteId = 1;

  constructor(zugang: Zugang) {
    this.zugang = zugang;
  }

  /** Die Adresse des MCP-Servers. */
  get adresse(): string {
    return this.zugang.resource;
  }

  /**
   * Ein gültiges Zugriffs-Token — für den Käfig, der es als Datei mitbekommt.
   *
   * Es geht damit aus der Hand, und das ist der Grund, warum es kurz lebt: eine
   * Stunde, danach ist die Datei im Zweifel nur noch Papier. Erneuert wird
   * ausdrücklich VOR dem Lauf, nicht während — ein Lauf dauert Minuten, und
   * mitten darin ein neues Token zu schieben ginge nicht.
   */
  async zugriffstoken(): Promise<string> {
    return this.gueltigesToken(false);
  }

  /**
   * Ruft ein Werkzeug.
   *
   * Zwei Fehlerarten kommen zurück, und sie bedeuten Verschiedenes: ein
   * `error` im JSON-RPC heißt „diese Anfrage war falsch" (unbekanntes
   * Werkzeug, kaputter Umschlag) und ist ein Fehler des Dienstes; ein
   * `isError` im Ergebnis heißt „das habe ich verstanden und sage nein" —
   * etwa: dieses Blatt gibt es nicht. Nur das Zweite darf im Alltag vorkommen.
   */
  async werkzeug(name: string, args: Record<string, unknown> = {}): Promise<Antwort> {
    const antwort = await this.rpc("tools/call", { name, arguments: args });

    const ergebnis = antwort as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };

    const text = ergebnis.content?.find((teil) => teil.type === "text")?.text ?? "";

    if (ergebnis.isError) {
      throw new WerkzeugFehler(text || `${name} hat nein gesagt.`);
    }

    // Die Nutzdaten stehen hinter dem ersten Zeilenumbruch: ein deutscher Satz
    // für den Leser, darunter das JSON für den Aufrufer (toolResult() in
    // @/app/api/mcp/route). Ohne Umbruch gibt es keine Daten — dann war die
    // Antwort nur ein Satz.
    const umbruch = text.indexOf("\n");
    if (umbruch === -1) return { satz: text, daten: null };

    return {
      satz: text.slice(0, umbruch),
      daten: JSON.parse(text.slice(umbruch + 1)),
    };
  }

  /**
   * Eine JSON-RPC-Anfrage, mit genau einem zweiten Versuch nach einer 401.
   *
   * Der zweite Versuch ist nicht Höflichkeit, sondern der Normalfall: ein
   * Zugriffs-Token gilt eine Stunde, und ein Dienst, der stundenlang läuft,
   * fällt zwangsläufig einmal hinein. Ein dritter Versuch wäre schon eine
   * Schleife — wenn ein frisches Token abgelehnt wird, stimmt etwas anderes
   * nicht.
   */
  private async rpc(methode: string, params: Record<string, unknown>): Promise<unknown> {
    for (const zweiterVersuch of [false, true]) {
      const antwort = await fetch(this.zugang.resource, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${await this.gueltigesToken(zweiterVersuch)}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.naechsteId++,
          method: methode,
          params,
        }),
      });

      if (antwort.status === 401) {
        // Erst beim zweiten Mal aufgeben: das Token war abgelaufen oder die
        // Verbindung ist getrennt. Was davon, sagt der Erneuerungsversuch.
        if (zweiterVersuch) {
          throw new ZugangVerloren("Der Server nimmt auch ein frisches Token nicht an.");
        }
        this.token = null;
        continue;
      }

      if (antwort.status === 403 || antwort.headers.get("content-type")?.includes("text/html")) {
        // Aus dieser App kommt nie ein 403 und nie HTML. Wer beides sieht,
        // redet mit etwas davor — einem Schutz vor dem Deployment, einem Proxy.
        throw new Error(
          `Unerwartete Antwort (${antwort.status}) von ${this.zugang.resource}. Das kommt nicht aus der App — steht ein Zugriffsschutz davor?`,
        );
      }

      const koerper = (await antwort.json()) as {
        result?: unknown;
        error?: { code: number; message: string };
      };

      if (koerper.error) {
        throw new Error(`${methode}: ${koerper.error.message} (${koerper.error.code})`);
      }

      return koerper.result;
    }

    throw new ZugangVerloren("Der Server nimmt kein Token an.");
  }

  /** Ein gültiges Zugriffs-Token — aus dem Speicher oder frisch erneuert. */
  private async gueltigesToken(erzwingen: boolean): Promise<string> {
    // Eine Minute Vorlauf: ein Token, das während der Anfrage abläuft, wäre
    // eine 401, die keiner braucht.
    if (!erzwingen && this.token && Date.now() < this.laeuftAb - 60_000) {
      return this.token;
    }

    const antwort = await fetch(`${this.zugang.origin}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.zugang.refreshToken,
        client_id: this.zugang.clientId,
        resource: this.zugang.resource,
      }),
    });

    const koerper = (await antwort.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!antwort.ok || !koerper.access_token || !koerper.refresh_token) {
      throw new ZugangVerloren(
        `Erneuern abgelehnt: ${koerper.error ?? antwort.status} — ${koerper.error_description ?? ""}`.trim(),
      );
    }

    // **Sofort schreiben, vor allem anderen.** Das alte Token gilt ab jetzt
    // nicht mehr; wer es nach einem Absturz noch einmal vorzeigt, bringt die
    // ganze Verbindung zu Fall (die Falle in `refreshTokens()`). Zwischen
    // Antwort und Datei darf deshalb nichts liegen, was scheitern kann.
    this.zugang = { ...this.zugang, refreshToken: koerper.refresh_token };
    schreibeZugang(this.zugang);

    this.token = koerper.access_token;
    this.laeuftAb = Date.now() + (koerper.expires_in ?? 3600) * 1000;

    return this.token;
  }
}
