"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAccount, hasAccount, login } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirect-path";

/**
 * Rückgabe beider Formular-Aktionen, passend zu useActionState.
 * `name` kommt nur bei der Einrichtung zurück: React leert das Formular nach
 * jedem Absenden, so bleibt der eingetippte Name wenigstens stehen.
 */
export type AuthFormState = {
  error?: string;
  name?: string;
};

const MIN_PASSWORD = 8;

const setupSchema = z
  .object({
    name: z.string().min(1, "Sag mir noch, wie ich dich nennen soll."),
    password: z
      .string()
      .min(
        MIN_PASSWORD,
        `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`,
      ),
    passwordRepeat: z.string(),
  })
  .refine((values) => values.password === values.passwordRepeat, {
    message: "Die beiden Passwörter sind nicht gleich.",
    path: ["passwordRepeat"],
  });

const loginSchema = z.object({
  password: z.string().min(1, "Gib dein Passwort ein."),
});

/** Im Formular ist immer nur eine Meldung zu sehen — die erste reicht. */
function firstMessage(issues: readonly { message: string }[]): string {
  return issues[0]?.message ?? "Da stimmt etwas mit deinen Eingaben nicht.";
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Wohin es nach der Anmeldung geht — geprüft, obwohl die Anmeldeseite es schon
 * geprüft hat.
 *
 * Das versteckte Feld kommt aus dem Browser und ist damit eine Eingabe wie
 * jede andere; zwischen „angezeigt“ und „abgeschickt“ kann jemand es ändern.
 * Die Regel steht in @/lib/redirect-path und nicht hier, weil beide Türen
 * dieselbe brauchen.
 */
function nextPath(formData: FormData): string {
  return safeNextPath(text(formData, "weiter"));
}

export async function setupAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = text(formData, "name").trim();
  const parsed = setupSchema.safeParse({
    name,
    password: text(formData, "password"),
    passwordRepeat: text(formData, "passwordRepeat"),
  });

  if (!parsed.success) {
    return { error: firstMessage(parsed.error.issues), name };
  }

  // Zwischen Seitenaufruf und Absenden kann schon ein Konto entstanden sein.
  if (await hasAccount()) {
    redirect("/login");
  }

  try {
    // createAccount startet die Sitzung gleich mit.
    await createAccount(parsed.data.name, parsed.data.password);
  } catch {
    return {
      error: "Das Konto ließ sich nicht anlegen. Versuch es gleich nochmal.",
      name,
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({ password: text(formData, "password") });

  if (!parsed.success) {
    return { error: firstMessage(parsed.error.issues) };
  }

  if (!(await hasAccount())) {
    redirect("/setup");
  }

  if (!(await login(parsed.data.password))) {
    return { error: "Das war nicht das richtige Passwort. Probier es nochmal." };
  }

  revalidatePath("/", "layout");
  redirect(nextPath(formData));
}
