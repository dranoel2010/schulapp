import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  canonicalResource,
  findClient,
  originFrom,
  redirectUriMatches,
  splitRedirectUris,
} from "@/lib/oauth";
import { getSessionUser } from "@/lib/session";

import { decideAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verbinden",
  // Eine Zustimmungsseite hat in keinem Suchindex etwas verloren; sie steht
  // ohnehin nur mit einer Handvoll Parameter in der Adresse sinnvoll da.
  robots: { index: false, follow: false },
};

/**
 * Die Zustimmung: hier sagt ein Mensch ja, und nur hier.
 *
 * Alles davor ist Vorbereitung — ein Programm meldet sich an, holt Metadaten,
 * baut eine Adresse. Alles danach ist Folge. Diese Seite ist die eine Stelle,
 * an der ein Zugang entsteht, und deshalb ist sie eine Seite mit einem Satz und
 * zwei Knöpfen und keine technische Maske.
 *
 * **Drei Ausgänge, und die Unterscheidung ist keine Förmlichkeit.**
 *
 * 1. *Der Client oder seine Rückadresse stimmt nicht.* Dann wird NICHT
 *    umgeleitet, sondern ein Satz gezeigt. Die einzige Adresse, die es in
 *    diesem Fall gäbe, stünde in der Anfrage — also genau dort, wo der Fehler
 *    herkommt. Wer sie trotzdem anspränge, hätte eine offene Weiterleitung
 *    gebaut, die einen Zugangscode mitgibt (OAuth 2.1 §4.1.2.1 sagt das
 *    ausdrücklich).
 * 2. *Die Anfrage ist unvollständig, aber die Rückadresse ist geprüft.* Dann
 *    geht die Absage dorthin zurück, wo der Client sie erwartet — er kann sie
 *    lesen und es besser machen. Ein Mensch bekommt hier nichts zu sehen, weil
 *    ihn nichts angeht, was zwei Programme miteinander ausmachen.
 * 3. *Alles stimmt.* Dann steht die Frage da.
 *
 * **Ohne Anmeldung führt der Weg über /login und zurück.** Der Rückweg steht in
 * `?weiter=` und wird dort geprüft (`safeReturnPath()` in @/lib/oauth). Ohne
 * ihn landete der Nutzer nach dem Anmelden auf der Startseite, während in der
 * Claude-App ein Fenster auf eine Antwort wartet, die nie kommt.
 */
export default async function VerbindenPage({
  searchParams,
}: PageProps<"/verbinden">) {
  const query = await searchParams;

  const clientId = first(query.client_id) ?? "";
  const redirectUri = first(query.redirect_uri) ?? "";
  const responseType = first(query.response_type) ?? "";
  const codeChallenge = first(query.code_challenge) ?? "";
  const challengeMethod = first(query.code_challenge_method) ?? "";
  const state = first(query.state) ?? "";

  const client = await findClient(clientId);

  if (!client) {
    return (
      <Absage
        titel="Diesen Zugang gibt es nicht"
        satz="Das Programm ist bei dieser App nicht angemeldet. Versuch es dort noch einmal."
      />
    );
  }

  const angemeldeteAdressen = splitRedirectUris(client.redirectUris);

  // Der Name, unter dem die Rückadresse gleich auf dem Bildschirm steht. Der
  // Host allein und nicht die ganze Adresse: „claude.ai" ist zu lesen und zu
  // prüfen, „https://claude.ai/api/mcp/auth_callback?x=1" liest niemand zu
  // Ende. Wie gekürzt wird und warum vorne, steht an `hostVon()`. Fällt das
  // Auslesen aus (eine Zeichenkette, die nicht einmal eine Adresse ist), steht
  // sie selbst da; abgewiesen wird sie ohnehin gleich darunter.
  const ziel = hostVon(redirectUri);

  if (!redirectUriMatches(angemeldeteAdressen, redirectUri)) {
    return (
      <Absage
        titel="Diese Rückadresse stimmt nicht"
        satz={`${client.name} möchte die Antwort an eine Adresse schicken, die nicht zu diesem Zugang gehört. Aus Sicherheitsgründen geht hier nichts weiter.`}
      />
    );
  }

  // Ab hier ist die Rückadresse geprüft, also darf eine Absage dorthin gehen.
  if (responseType !== "code") {
    redirect(
      fehlerAdresse(redirectUri, state, {
        error: "unsupported_response_type",
        error_description: "Dieser Server kennt nur response_type=code.",
      }),
    );
  }

  // PKCE ist Pflicht und nicht Kür: ohne den Prüfwert wäre der Code allein
  // schon der Schlüssel, und er reist durch die Adresszeile eines Browsers.
  if (codeChallenge.length === 0 || challengeMethod !== "S256") {
    redirect(
      fehlerAdresse(redirectUri, state, {
        error: "invalid_request",
        error_description: "Dieser Server verlangt PKCE mit S256.",
      }),
    );
  }

  const user = await getSessionUser();

  if (!user) {
    redirect(`/login?weiter=${encodeURIComponent(eigeneAdresse(query))}`);
  }

  const head = await headers();
  const origin = originFrom(head.get("host"), head.get("x-forwarded-proto"));

  if (!origin) {
    return (
      <Absage
        titel="Diese App kennt ihre eigene Adresse nicht"
        satz="Ohne sie lässt sich kein Zugang ausstellen, der später wieder geprüft werden kann."
      />
    );
  }

  return (
    <>
      <h1 className="hl">{client.name} mit deiner Schulapp verbinden?</h1>
      <p className="q-sub">
        Danach kann {client.name} deine Schulsachen lesen und dir Vorschläge in den Eingangskorb legen.
      </p>

      {/* Der Name ist frei gewählt — jedes Programm darf sich „Claude“ nennen.
          Die Adresse dagegen kann sich niemand aussuchen: dorthin geht der
          Zugangscode. Sie ist die einzige Angabe, an der sich ein echtes
          Programm von einem untergeschobenen unterscheiden lässt — deshalb
          steht sie oben. */}
      <p style={{ fontSize: 17, lineHeight: 1.45 }}>
        Die Antwort geht an <b style={{ fontWeight: 650, wordBreak: "break-all" }}>{ziel}</b>. Erlaube das nur, wenn du
        diese Verbindung gerade selbst geöffnet hast.
      </p>

      <h3 className="p-lab">Lesen darf es</h3>
      <p className="p-sub">
        Fächer und Themen, den Stundenplan, Hausaufgaben, Klausuren samt Lernplan, Noten, die Blätter samt Fotos
        und den Eingangskorb.
      </p>
      <h3 className="p-lab">Schreiben darf es</h3>
      <p className="p-sub">
        nur Vorschläge zu einem Blatt. Ein Vorschlag ändert nichts; er liegt im Eingangskorb, bis du ihn übernimmst.
      </p>
      <h3 className="p-lab">Nicht möglich ist</h3>
      <p className="p-sub">
        etwas anzulegen, zu ändern, zu löschen oder einen Vorschlag zu übernehmen.
      </p>

      <form action={decideAction} className="foot" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <input type="hidden" name="client_id" value={client.id} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        <input type="hidden" name="state" value={state} />
        <button className="btn primary" type="submit" name="entscheidung" value="erlauben">
          Erlauben
        </button>
        <button className="btn quiet" type="submit" name="entscheidung" value="ablehnen">
          Ablehnen
        </button>
      </form>

      <p className="p-sub" style={{ marginTop: 16 }}>
        Gilt für <span style={{ wordBreak: "break-all" }}>{canonicalResource(origin)}</span>. Du kannst die Verbindung
        jederzeit unter Einstellungen trennen.
      </p>
    </>
  );
}

/**
 * Der Ausgang für die beiden Fälle, in denen nicht zurückgeleitet werden darf.
 *
 * Bewusst ohne Knopf zurück: es gibt keinen Weg, den diese Seite anbieten
 * könnte, ohne eine Adresse zu benutzen, der gerade nicht zu trauen ist.
 */
function Absage({ titel, satz }: { titel: string; satz: string }) {
  return (
    <>
      <h1 className="hl">{titel}</h1>
      <p className="q-sub">{satz}</p>
    </>
  );
}

/**
 * Die Absage an den Client, als Adresse.
 *
 * Der `state` geht unverändert mit zurück — ohne ihn kann der Client die
 * Antwort nicht der Frage zuordnen, die er gestellt hat, und verwirft sie.
 */
function fehlerAdresse(
  redirectUri: string,
  state: string,
  fields: { error: string; error_description: string },
): string {
  const target = new URL(redirectUri);

  target.searchParams.set("error", fields.error);
  target.searchParams.set("error_description", fields.error_description);
  if (state.length > 0) target.searchParams.set("state", state);

  return target.toString();
}

/**
 * Diese Seite mit genau denselben Parametern — der Weg, der nach dem Anmelden
 * wieder hierher führt.
 *
 * Gebaut wird er aus dem, was angekommen ist, und nicht aus einem Kopf der
 * Anfrage: `searchParams` ist das, was Next gelesen hat, und damit dasselbe,
 * womit diese Seite gleich wieder rechnen wird.
 */
function eigeneAdresse(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) {
      for (const single of value) params.append(key, single);
    }
  }

  const search = params.toString();
  return search.length > 0 ? `/verbinden?${search}` : "/verbinden";
}

/** Ein Wert aus der Adresszeile; steht er doppelt drin, zählt der erste. */
function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Der Name des Rechners aus einer Adresse — „claude.ai" aus der ganzen Zeile.
 *
 * Ein sehr langer Name wird dabei VORNE gekürzt und nicht hinten. Das ist die
 * ganze Überlegung dahinter: wem ein Name gehört, entscheidet sein Ende.
 * „claude.ai.irgendwas.evil.example" beginnt vertrauenswürdig und endet bei
 * jemand anderem; wer nur den Anfang liest, liest die falsche Hälfte. Gekürzt
 * steht dann „…irgendwas.evil.example" da — mit dem Teil, auf den es ankommt.
 */
function hostVon(value: string): string {
  let host: string;
  try {
    host = new URL(value).host;
  } catch {
    host = value;
  }

  return host.length <= HOST_MAX ? host : `…${host.slice(-HOST_MAX)}`;
}

/**
 * Wie viel vom Namen des Rechners stehen bleibt.
 *
 * Vierzig Zeichen tragen jeden echten Namen samt Port („claude.ai" hat neun)
 * und passen in eine Zeile, die ein Mensch mit einem Blick erfasst. Alles
 * darüber ist entweder eine Kette von Unter-Namen, die etwas verstecken soll,
 * oder ein Name, den ohnehin niemand vorlesen kann.
 */
const HOST_MAX = 40;
