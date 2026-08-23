import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasAccount } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirect-path";
import { getSessionUser } from "@/lib/session";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Anmelden",
};

/**
 * Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste.
 * Was kein Pfad auf diesem Server ist, fällt auf die Startseite zurück — die
 * Regel dafür steht in @/lib/redirect-path und gilt auch in `loginAction()`.
 */
function nextPath(value: string | string[] | undefined): string {
  return safeNextPath(Array.isArray(value) ? value[0] : value);
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  if (!(await hasAccount())) {
    redirect("/setup");
  }

  // "weiter" trägt den Weg, auf dem jemand hierhergeschickt wurde — heute
  // genau einer: die Anmeldung des Agenten unter /oauth/authorize. Wer schon
  // angemeldet ist, geht ihn sofort weiter, statt auf der Startseite zu landen
  // und noch einmal von vorn anfangen zu müssen.
  const next = nextPath((await searchParams).weiter);

  if (await getSessionUser()) {
    redirect(next);
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
            Ein Passwort, dann bist du drin.
          </p>

          <div className="mt-8 md:mt-7">
            <LoginForm next={next === "/" ? undefined : next} />
          </div>
        </div>
      </section>

      {/* Rechts, erst ab mittlerer Breite. Bewusst ohne Zahlen: vor der
          Anmeldung kennt die App weder Klausuren noch Lernblöcke, und
          erfundene Werte wären eine Lüge. Hier steht nur, was die App tut. */}
      <aside className="hidden border-l border-border bg-surface-muted p-12 md:flex md:flex-col md:justify-center">
        <div className="mx-auto w-full max-w-[380px]">
          <p className="text-[13px] uppercase tracking-[0.1em] text-subtle">
            Dein Lernplan
          </p>
          <p className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.03em]">
            Jede Klausur bekommt einen Plan, der von allein weiterläuft.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Du trägst Datum und Themen ein, den Rest teilt die App auf die Tage
            davor auf — jedes Thema einmal zum Durcharbeiten, einmal zum
            Wiederholen. Was heute dran ist, steht auf der Startseite, und wenn
            du magst, erinnert dich das Handy daran.
          </p>
        </div>
      </aside>
    </>
  );
}
