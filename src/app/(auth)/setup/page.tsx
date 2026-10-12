import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasAccount } from "@/lib/auth";

import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Einrichten",
};

export default async function SetupPage() {
  if (await hasAccount()) {
    redirect("/");
  }

  return (
    <>
      <h1 className="hl">Schulapp</h1>
      <p className="q-sub">
        Einmal einrichten, dann gehört die App dir. Ein Konto, ein Passwort — keine E-Mail, kein fremder Dienst.
        Zurücksetzen lässt sich das Passwort nicht, schreib es dir auf.
      </p>
      <SetupForm />
    </>
  );
}
