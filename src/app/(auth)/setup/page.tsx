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
      {/* Links (am Handy: alles) — das Formular. */}
      <section className="flex flex-1 flex-col justify-center px-[30px] pt-safe pb-safe md:px-8">
        <div className="mx-auto w-full max-w-[420px] py-12 md:max-w-[360px] md:py-10">
          <span
            aria-hidden="true"
            className="mb-5 flex size-[52px] items-center justify-center rounded-[16px] bg-accent text-[22px] font-semibold text-accent-foreground md:size-11 md:rounded-[14px]"
          >
            S
          </span>

          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[28px] md:tracking-[-0.02em]">
            Schulapp
          </h1>
          <p className="mt-2.5 text-base leading-[1.5] text-muted">
            Einmal einrichten, dann gehört die App dir.
          </p>

          <div className="mt-8 md:mt-7">
            <SetupForm />
          </div>
        </div>
      </section>

      {/* Rechts, erst ab mittlerer Breite. Vor der Einrichtung gibt es keine
          Daten, über die sich etwas sagen ließe — hier steht deshalb nur, was
          beim Anlegen des Kontos passiert. */}
      <aside className="hidden border-l border-border bg-surface-muted p-12 md:flex md:flex-col md:justify-center">
        <div className="mx-auto w-full max-w-[380px]">
          <p className="text-[13px] uppercase tracking-[0.1em] text-subtle">
            Erste Einrichtung
          </p>
          <p className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.03em]">
            Ein Konto, ein Passwort — mehr verlangt die App nicht.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Keine E-Mail, keine Anmeldung bei einem fremden Dienst: Name und
            Passwort bleiben in dieser App. Zurücksetzen lässt sich das Passwort
            nicht — schreib es dir auf, bevor du weitermachst.
          </p>
        </div>
      </aside>
    </>
  );
}
