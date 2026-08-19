import { randomBytes } from "node:crypto";

import { eq, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";

import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";

export const SESSION_COOKIE = "schulapp_session";

/**
 * Ein Jahr. Die App gehört einer Person auf ihren eigenen Geräten — ständiges
 * Neuanmelden wäre nur lästig.
 */
const SESSION_MAX_AGE = 365 * 24 * 60 * 60;

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  await db.insert(sessions).values({ token, userId, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }

  store.delete({ name: SESSION_COOKIE, path: "/" });
}

/**
 * Der angemeldete Nutzer, oder null. Mit cache() gebündelt: egal wie viele
 * Server Components pro Anfrage fragen, die Datenbank wird einmal gelesen.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    // Bei der Gelegenheit gleich alle alten Sitzungen wegräumen. Das Cookie
    // bleibt liegen, weil es sich beim Rendern nicht löschen lässt — es zeigt
    // ohnehin ins Leere und wird beim nächsten Anmelden überschrieben.
    await db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
    return null;
  }

  return row.user;
});
