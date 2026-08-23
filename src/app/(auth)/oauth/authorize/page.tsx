import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SCOPE, getClient, redirectUrisOf } from "@/lib/oauth";
import { getSessionUser } from "@/lib/session";

import { decideAction } from "./actions";
import { ConsentForm } from "./consent-form";

/**
 * Die Zustimmung: hier erlaubt ein Mensch einem Agenten den Zugriff.
 *
 * Es ist der einzige Schritt des ganzen OAuth-Ablaufs, den jemand zu sehen
 * bekommt — und der einzige, der überhaupt etwas freigibt. Alles davor
 * (Anmelden des Clients, Metadaten) kann nichts, alles danach (Code, Token)
 * hängt an dieser Seite.
 *
 * **Die Anmeldung, die es schon gibt, ist die Anmeldung.** Wer nicht
 * angemeldet ist, kommt auf `/login?weiter=…` und danach hierher zurück. Es
 * gibt kein zweites Konto und kein zweites Passwort — die App ist ihr eigener
 * Autorisierungsserver.
 *
 * **Zwei Sorten Fehler, und sie enden verschieden.** Stimmt etwas mit dem
 * Client oder seiner Rücksprungadresse nicht, bleibt der Nutzer hier und liest
 * einen Satz: irgendwohin umzuleiten, wo eine unbestätigte Adresse steht, wäre
 * eine offene Weiterleitung. Stimmt dagegen etwas an der Anfrage selbst nicht
 * — falscher `response_type`, fehlendes PKCE —, geht die Absage an den Client
 * zurück, denn er ist der, der es falsch gemacht hat und es erfahren muss.
 *
 * Was auf dem Bildschirm steht, ist die Wahrheit über die Werkzeuge und nicht
 * eine beruhigende Formel: der Agent darf lesen und vorschlagen. Dass er nicht
 * schreiben kann, liegt nicht an diesem Scope, sondern daran, dass es kein
 * Werkzeug dafür gibt (siehe @/lib/mcp-tools).
 */

export const metadata: Metadata = {
  title: "Zugriff erlauben",
};

export const dynamic = "force-dynamic";

/** Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste. */
function first(value: string | string[] | undefined): string {
  const found = Array.isArray(value) ? value[0] : value;
  return typeof found === "string" ? found.trim() : "";
}

/** Die Adresse dieser Seite, so wie sie aufgerufen wurde. */
function selfUrl(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    const single = first(value);
    if (single) params.set(key, single);
  }

  return `/oauth/authorize?${params.toString()}`;
}

/** Eine Absage, die an den Client zurückgeht. */
function bounce(
  redirectUri: string,
  params: Record<string, string>,
): never {
  const url = new URL(redirectUri);

  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  redirect(url.toString());
}

export default async function AuthorizePage({
  searchParams,
}: PageProps<"/oauth/authorize">) {
  const query = await searchParams;

  const clientId = first(query.client_id);
  const client = await getClient(clientId);

  if (!client) {
    return (
      <Problem
        title="Diese Anfrage kennt der Server nicht"
        text="Der Client, der hierher geschickt hat, ist nicht angemeldet. Trag den Connector in der Claude-App noch einmal ein — dabei meldet er sich von selbst an."
      />
    );
  }

  const allowed = redirectUrisOf(client);
  const wanted = first(query.redirect_uri);

  // Fehlt die Adresse und hat der Client genau eine eingetragen, ist eindeutig,
  // welche gemeint ist. Bei mehreren wäre es geraten — und Raten hat an dieser
  // Stelle nichts zu suchen.
  const redirectUri = wanted || (allowed.length === 1 ? (allowed[0] ?? "") : "");

  if (!redirectUri || !allowed.includes(redirectUri)) {
    return (
      <Problem
        title="Diese Rücksprungadresse steht nicht beim Client"
        text="Hier bricht der Weg ab, und zwar mit Absicht: eine Umleitung auf eine Adresse, die niemand hinterlegt hat, wäre ein Weg, deine Daten woanders hinzuschicken."
      />
    );
  }

  const state = first(query.state);

  if (first(query.response_type) !== "code") {
    bounce(redirectUri, {
      error: "unsupported_response_type",
      error_description: "Dieser Server kennt nur response_type=code.",
      state,
    });
  }

  const challenge = first(query.code_challenge);
  if (!challenge || first(query.code_challenge_method) !== "S256") {
    bounce(redirectUri, {
      error: "invalid_request",
      error_description: "PKCE mit code_challenge_method=S256 ist Pflicht.",
      state,
    });
  }

  // Ein Client darf einen Scope nennen; er bekommt aber ohnehin nur den einen,
  // den es gibt. Nennt er einen anderen, ist das ein Missverständnis und keine
  // stillschweigende Kürzung.
  const scope = first(query.scope);
  if (scope && !scope.split(/\s+/).includes(SCOPE)) {
    bounce(redirectUri, {
      error: "invalid_scope",
      error_description: `Dieser Server kennt genau einen Scope: ${SCOPE}.`,
      state,
    });
  }

  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?weiter=${encodeURIComponent(selfUrl(query))}`);
  }

  const resource = first(query.resource);

  return (
    <section className="flex flex-1 flex-col justify-center px-[30px] pt-safe pb-safe md:col-span-2 md:px-8">
      <div className="mx-auto w-full max-w-[520px] py-12">
        <span
          aria-hidden="true"
          className="mb-5 flex size-[52px] items-center justify-center rounded-[16px] bg-accent text-[22px] font-semibold text-accent-foreground"
        >
          S
        </span>

        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">
          {client.name} möchte an deine Schulapp
        </h1>
        <p className="mt-2.5 text-base leading-[1.5] text-muted">
          Angemeldet als {user.name}. Wenn du erlaubst, darf {client.name}:
        </p>

        {/* Der Name kommt vom Client selbst — er hat ihn sich beim Anmelden
            ausgesucht, und „Claude“ kann sich jeder nennen. Was sich nicht
            aussuchen lässt, ist die Adresse, an die der Zugang danach
            ausgeliefert wird: sie ist beim Client hinterlegt und wird geprüft.
            Deshalb steht sie hier, und deshalb steht sie so nah an der Frage. */}
        <p className="mt-1.5 text-[15px] leading-snug text-subtle">
          Der Zugang geht an {new URL(redirectUri).host}. Kennst du diese
          Adresse nicht, lehn ab.
        </p>

        <ul className="mt-6 space-y-3 text-[15px] leading-snug">
          <Point>
            <strong className="font-medium text-foreground">Lesen</strong> —
            Fächer, Stundenplan, Hausaufgaben, Klausuren, Noten, Themen und die
            abfotografierten Blätter samt ihren Fotos.
          </Point>
          <Point>
            <strong className="font-medium text-foreground">Vorschlagen</strong>{" "}
            — Themen, Aufgaben und Termine zu einem Blatt in deinen
            Eingangskorb legen.
          </Point>
        </ul>

        <p className="mt-6 rounded-control border border-border bg-surface-muted px-4 py-3 text-[15px] leading-snug text-muted">
          <strong className="font-medium text-foreground">
            Ändern kann es nichts.
          </strong>{" "}
          Es gibt kein Werkzeug zum Anlegen, Ändern oder Löschen — nicht
          abgeschaltet, sondern nicht vorhanden. Was vorgeschlagen wird, steht
          erst in der App, wenn du es im Eingangskorb übernimmst.
        </p>

        <div className="mt-8">
          <ConsentForm
            action={decideAction}
            fields={{
              client_id: clientId,
              redirect_uri: redirectUri,
              code_challenge: challenge,
              code_challenge_method: "S256",
              state,
              resource,
            }}
          />
        </div>

        <p className="mt-6 text-[13px] leading-snug text-subtle">
          Den Zugriff nimmst du in den Einstellungen jederzeit wieder zurück.
        </p>
      </div>
    </section>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-muted">
      <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </li>
  );
}

/** Ein Ausgang, der nicht zurückführt: hier endet der Weg mit einem Satz. */
function Problem({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex flex-1 flex-col justify-center px-[30px] pt-safe pb-safe md:col-span-2 md:px-8">
      <div className="mx-auto w-full max-w-[520px] py-12">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-3 text-base leading-[1.5] text-muted">{text}</p>
      </div>
    </section>
  );
}
