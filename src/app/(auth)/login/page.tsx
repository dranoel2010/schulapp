import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { hasAccount } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Anmelden",
};

export default async function LoginPage() {
  if (!(await hasAccount())) {
    redirect("/setup");
  }

  if (await getSessionUser()) {
    redirect("/");
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Willkommen zurück</h2>
      <p className="mt-1 text-sm text-muted">
        Ein Passwort, dann bist du drin.
      </p>

      <div className="mt-5">
        <LoginForm />
      </div>
    </Card>
  );
}
