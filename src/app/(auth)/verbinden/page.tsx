import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
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
        satz="Das Programm, das dich hierher geschickt hat, ist bei dieser App nicht angemeldet. Versuch es in dem Programm noch einmal — es meldet sich dann neu an."
      />
    );
  }

  const angemeldeteAdressen = splitRedirectUris(client.redirectUris);

  // Der Name, unter dem die Rückadresse gleich auf dem Bildschirm steht. Der
  // Host allein und nicht die ganze Adresse: „claude.ai" ist zu lesen und zu
  // prüfen, „https://claude.ai/api/mcp/auth_callback?x=1" liest niemand zu
  // Ende — und was zählt, steht vorne. Fällt das Auslesen aus (eine Adresse,
  // die nicht einmal ein URL ist), steht die Zeichenkette selbst da; abgewiesen
  // wird sie ohnehin gleich darunter.
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
      <section className="flex flex-1 flex-col justify-center px-[30px] pt-safe pb-safe md:px-8">
        <div className="mx-auto w-full max-w-[420px] py-12 md:max-w-[420px] md:py-10">
          <span
            aria-hidden="true"
            className="mb-5 flex size-[52px] items-center justify-center rounded-[16px] bg-accent text-[22px] font-semibold text-accent-foreground md:size-11 md:rounded-[14px]"
          >
            S
          </span>

          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] md:text-[26px] md:tracking-[-0.02em]">
            {client.name} mit deiner Schulapp verbinden?
          </h1>
          <p className="mt-2.5 text-base leading-[1.5] text-muted">
            Danach kann {client.name} deine Schulsachen lesen und dir
            Vorschläge in den Eingangskorb legen.
          </p>

          {/* Der Name daneben ist frei gewählt — jedes Programm im Netz darf
              sich anmelden und sich „Claude" nennen. Die Adresse dagegen kann
              sich niemand aussuchen, ohne dass es hier steht: dorthin geht der
              Zugangscode, und nur wer sie besitzt, kann ihn einlösen. Sie ist
              damit die einzige Angabe auf dieser Seite, an der sich ein echtes
              Programm von einem untergeschobenen unterscheiden lässt — und
              deshalb steht sie oben und nicht im Kleingedruckten. */}
          <p className="mt-6 rounded-[14px] border border-border bg-surface-muted px-4 py-3 text-[15px] leading-relaxed md:rounded-control">
            Die Antwort geht an{" "}
            <span className="font-medium break-all">{ziel}</span>. Erlaube das
            nur, wenn du diese Verbindung gerade selbst geöffnet hast.
          </p>

          <dl className="mt-7 space-y-4 text-[15px] leading-relaxed">
            <div>
              <dt className="font-medium">Lesen darf es</dt>
              <dd className="mt-1 text-muted">
                Fächer und Themen, den Stundenplan, Hausaufgaben, Klausuren
                samt Lernplan, Noten, die Blätter in der Ablage — auch die Fotos
                — und den Eingangskorb.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Schreiben darf es</dt>
              <dd className="mt-1 text-muted">
                nur Vorschläge zu einem Blatt. Ein Vorschlag ändert nichts; er
                liegt im Eingangskorb, bis du ihn übernimmst.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Nicht möglich ist</dt>
              <dd className="mt-1 text-muted">
                etwas anzulegen, zu ändern oder zu löschen — und auch nicht,
                einen Vorschlag selbst zu übernehmen.
              </dd>
            </div>
          </dl>

          <form action={decideAction} className="mt-8 space-y-3">
            <input type="hidden" name="client_id" value={client.id} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input type="hidden" name="state" value={state} />

            <Button
              type="submit"
              name="entscheidung"
              value="erlauben"
              size="lg"
              className="w-full"
            >
              Erlauben
            </Button>
            <Button
              type="submit"
              name="entscheidung"
              value="ablehnen"
              variant="secondary"
              size="lg"
              className="w-full"
            >
              Ablehnen
            </Button>
          </form>

          <p className="mt-5 text-center text-[13px] leading-relaxed text-subtle">
            Gilt für <span className="break-all">{canonicalResource(origin)}</span>
            . Du kannst die Verbindung jederzeit unter Einstellungen trennen.
          </p>
        </div>
      </section>

      {/* Rechts, erst ab mittlerer Breite: warum diese Frage überhaupt gestellt
          wird. Sie ist die einzige Stelle, an der ein Mensch entscheidet, und
          das soll nicht wie eine Formalie aussehen. */}
      <aside className="hidden border-l border-border bg-surface-muted p-12 md:flex md:flex-col md:justify-center">
        <div className="mx-auto w-full max-w-[380px]">
          <p className="text-[13px] uppercase tracking-[0.1em] text-subtle">
            Warum diese Frage
          </p>
          <p className="mt-4 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em]">
            Ein Agent liest deine Blätter — schreiben darf er sie nicht.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Was auf einem abfotografierten Blatt steht, hat nicht diese App
            geschrieben. Deshalb kommt nichts davon in deine Daten, ohne dass du
            es gesehen hast: ein Agent legt Vorschläge in den Eingangskorb, und
            übernehmen kannst nur du — mit demselben Formular wie immer.
          </p>
        </div>
      </aside>
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
    <section className="flex flex-1 flex-col justify-center px-[30px] pt-safe pb-safe md:col-span-2 md:px-8">
      <div className="mx-auto w-full max-w-[420px] py-12">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">
          {titel}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">{satz}</p>
      </div>
    </section>
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

/** Der Name des Rechners aus einer Adresse — „claude.ai" aus der ganzen Zeile. */
function hostVon(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
