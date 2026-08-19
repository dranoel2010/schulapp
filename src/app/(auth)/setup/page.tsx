import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
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
    <Card>
      <h2 className="text-lg font-semibold">Einmal einrichten</h2>
      <p className="mt-1 text-sm text-muted">
        Die App gehört nur dir — es gibt genau ein Konto, und das legst du jetzt
        an. Das Passwort schützt deine Daten auf dem Server, also merk es dir
        gut: zurücksetzen kann es niemand.
      </p>

      <div className="mt-5">
        <SetupForm />
      </div>
    </Card>
  );
}
