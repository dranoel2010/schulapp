import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasAccount } from "@/lib/auth";
import { safeReturnPath } from "@/lib/oauth";
import { getSessionUser } from "@/lib/session";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Anmelden",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  if (!(await hasAccount())) {
    redirect("/setup");
  }

  // Wohin es nach dem Anmelden geht. Steht in der Adresse nichts, ist es die
  // Startseite; steht dort etwas Fremdes, ebenfalls — geprüft wird in
  // `safeReturnPath()`. Wer schon angemeldet ist, wird gleich weitergereicht:
  // sonst stünde die Anmeldeseite im Weg, obwohl niemand sie braucht, und das
  // ausgerechnet mitten in einer Zustimmung.
  const query = await searchParams;
  const weiter = safeReturnPath(first(query.weiter));

  if (await getSessionUser()) {
    redirect(weiter ?? "/");
  }

  return (
    <>
      <h1 className="hl">Schulapp</h1>
      <p className="q-sub">Ein Passwort, dann bist du drin.</p>
      <LoginForm weiter={weiter ?? undefined} />
    </>
  );
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
