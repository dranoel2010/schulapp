import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, getSessionUser } from "@/lib/session";

/** Für Seiten, die ohne Anmeldung keinen Sinn ergeben. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export const hasAccount = cache(async (): Promise<boolean> => {
  return (await findOnlyUser()) !== undefined;
});

export async function createAccount(
  name: string,
  password: string,
): Promise<User> {
  // Absichtlich ungecacht: cache() würde hier einen Stand von vorhin liefern.
  if (await findOnlyUser()) {
    throw new Error("Es gibt schon ein Konto — die App ist für eine Person.");
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ name, passwordHash })
    .returning();

  if (!user) {
    throw new Error("Das Konto konnte nicht angelegt werden.");
  }

  await createSession(user.id);
  return user;
}

export async function login(password: string): Promise<boolean> {
  const user = await findOnlyUser();
  if (!user) return false;

  if (!(await verifyPassword(password, user.passwordHash))) return false;

  await createSession(user.id);
  return true;
}

/**
 * Der Nutzer dieser App, ohne den Umweg über eine Sitzung.
 *
 * Gebraucht an genau einer Stelle: beim festen Token für den MCP-Endpunkt
 * (`MCP_TOKEN`, siehe @/lib/oauth). Ein Token, das kein Cookie ist, weiß nicht,
 * wem es gehört — und in einer App mit einem einzigen Konto ist das auch keine
 * Frage. Über eine Sitzung geht dieser Weg ausdrücklich nicht: die gibt es dort
 * nicht, und `cookies()` außerhalb einer Anfrage wirft.
 */
export async function onlyUser(): Promise<User | null> {
  return (await findOnlyUser()) ?? null;
}

/**
 * Es gibt genau einen Nutzer. Sortiert nach Anlagedatum, damit auch bei einer
 * von Hand in die Datenbank geschriebenen zweiten Zeile immer dasselbe Konto
 * gemeint ist — sonst wäre die Reihenfolge Zufall.
 */
async function findOnlyUser(): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .orderBy(users.createdAt)
    .limit(1);
  return user;
}
