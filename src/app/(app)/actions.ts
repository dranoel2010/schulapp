"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { destroySession } from "@/lib/session";

/** Abmelden: Sitzung in der Datenbank löschen, Cookie weg, zurück zur Anmeldung. */
export async function logout(): Promise<void> {
  await destroySession();

  // Sonst könnten zwischengespeicherte Seiten noch die Daten von eben zeigen.
  revalidatePath("/", "layout");

  redirect("/login");
}
