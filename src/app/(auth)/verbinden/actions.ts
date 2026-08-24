"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  canonicalResource,
  findClient,
  issueCode,
  originFrom,
  redirectUriMatches,
  splitRedirectUris,
} from "@/lib/oauth";

/**
 * Die Entscheidung auf der Zustimmungsseite — der einzige Weg, auf dem ein
 * Agent Zugang zu dieser App bekommt.
 *
 * **Geprüft wird hier alles noch einmal.** Die Seite hat Client und Rückadresse
 * schon geprüft, bevor sie das Formular gezeichnet hat; die Felder darin sind
 * trotzdem Eingabe wie jede andere. Wer das Formular offen liegen lässt und den
 * versteckten Wert ändert, verschiebt sonst den Zustimmungs-Code an eine
 * Adresse, der niemand zugestimmt hat.
 *
 * **Zurückgeleitet wird nur an eine angemeldete Adresse.** Das ist die eine
 * Regel, die diese Datei zu bewachen hat: ein Formular, das eine Umleitung an
 * eine beliebige Adresse auslöst, ist eine offene Weiterleitung — und eine, die
 * einen frischen Zugangscode mitgibt.
 *
 * Ein `redirect()` wirft intern (NEXT_REDIRECT) und steht deshalb außerhalb
 * jedes try/catch — dieselbe Regel wie in den anderen Actions dieser App.
 */
export async function decideAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const clientId = text(formData, "client_id");
  const redirectUri = text(formData, "redirect_uri");
  const codeChallenge = text(formData, "code_challenge");
  const state = text(formData, "state");
  const erlaubt = text(formData, "entscheidung") === "erlauben";

  const client = await findClient(clientId);

  // Ohne gültigen Client oder passende Rückadresse wird NICHT umgeleitet,
  // sondern abgebrochen: die einzige Adresse, die es dann gäbe, wäre die aus
  // dem Formular — also genau die, der nicht zu trauen ist.
  if (!client) {
    throw new Error("Diesen Zugang gibt es nicht.");
  }

  if (!redirectUriMatches(splitRedirectUris(client.redirectUris), redirectUri)) {
    throw new Error("Diese Rückadresse gehört nicht zu diesem Zugang.");
  }

  const head = await headers();
  const origin = originFrom(head.get("host"), head.get("x-forwarded-proto"));

  if (!origin) {
    throw new Error("Diese App kennt ihre eigene Adresse nicht.");
  }

  const target = new URL(redirectUri);

  if (erlaubt) {
    const code = await issueCode({
      clientId: client.id,
      userId: user.id,
      redirectUri,
      codeChallenge,
      resource: canonicalResource(origin),
    });

    target.searchParams.set("code", code);
  } else {
    // Ein „nein" ist eine Antwort und kein Fehler des Nutzers. Der Client soll
    // sie bekommen und aufhören zu warten, statt in eine Zeitüberschreitung zu
    // laufen (RFC 6749 §4.1.2.1).
    target.searchParams.set("error", "access_denied");
    target.searchParams.set(
      "error_description",
      "Die Verbindung wurde abgelehnt.",
    );
  }

  // Der `state` kommt unverändert zurück — er ist das Mittel des Clients gegen
  // untergeschobene Antworten, und wir sind hier nur der Bote. Leer war er nur
  // dann, wenn der Client keinen geschickt hat.
  if (state.length > 0) target.searchParams.set("state", state);

  // Der Aussteller in der Antwort: damit erkennt ein Client, der mehrere
  // Server kennt, ob diese Antwort wirklich von dem kommt, den er gefragt hat.
  target.searchParams.set("iss", origin);

  redirect(target.toString());
}

/** Ein Formularfeld als Text; alles andere (etwa eine Datei) zählt als leer. */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
