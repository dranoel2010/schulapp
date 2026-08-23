"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { createAuthCode, getClient, redirectUrisOf } from "@/lib/oauth";

import type { ConsentState } from "./consent-form";

/**
 * Die Entscheidung über einen Zugriff.
 *
 * Alles, was der Ablauf braucht, kommt aus versteckten Feldern — und wird hier
 * noch einmal von Grund auf geprüft. Die Seite hat dieselben Prüfungen schon
 * gemacht, bevor sie das Formular überhaupt gezeigt hat; sie noch einmal zu
 * machen kostet drei Abfragen und schließt die Lücke zwischen „angezeigt“ und
 * „abgeschickt“: dazwischen kann jemand die Felder im Browser geändert haben.
 *
 * **Ohne gültigen Client und ohne eingetragene Rücksprungadresse wird nirgends
 * hin umgeleitet.** Das ist die wichtigste Regel des ganzen Ablaufs: eine
 * Umleitung auf eine Adresse, die nicht beim Client steht, wäre eine offene
 * Weiterleitung — und mit dem Code daran ein Weg, fremde Daten abzuholen. In
 * dem Fall bleibt der Nutzer hier und liest einen Satz.
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function decideAction(
  _state: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const user = await requireUser();

  const clientId = text(formData, "client_id");
  const redirectUri = text(formData, "redirect_uri");
  const state = text(formData, "state");

  const client = await getClient(clientId);
  if (!client || !redirectUrisOf(client).includes(redirectUri)) {
    return {
      message:
        "Diese Anfrage lässt sich nicht mehr zuordnen. Fang in der Claude-App noch einmal an.",
    };
  }

  if (text(formData, "entscheidung") !== "erlauben") {
    redirect(back(redirectUri, { error: "access_denied", state }));
  }

  const challenge = text(formData, "code_challenge");
  if (text(formData, "code_challenge_method") !== "S256" || !challenge) {
    redirect(
      back(redirectUri, {
        error: "invalid_request",
        error_description: "PKCE mit S256 ist Pflicht.",
        state,
      }),
    );
  }

  const code = await createAuthCode({
    clientId,
    userId: user.id,
    redirectUri,
    codeChallenge: challenge,
    resource: text(formData, "resource") || null,
  });

  redirect(back(redirectUri, { code, state }));
}

/**
 * Die Rücksprungadresse mit den Parametern des Ergebnisses.
 *
 * Angehängt wird an die Abfrage, die schon dasteht — ein Client darf in seiner
 * Rücksprungadresse eigene Parameter führen, und die dürfen nicht verloren
 * gehen. `state` kommt unverändert zurück; daran erkennt der Client seine
 * eigene Anfrage wieder und merkt, wenn ihm jemand eine fremde unterschiebt.
 */
function back(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);

  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  return url.toString();
}
