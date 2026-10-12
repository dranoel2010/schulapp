import { redirect } from "next/navigation";

/**
 * /lernen gibt es nicht mehr als eigene Seite (Plan 2.2): der Lernplan mit
 * allen bisherigen Funktionen steht auf der Klausurseite, der Lernblock von
 * heute auf dem Überblick. Alte Links und Erinnerungen landen auf der
 * Startseite.
 */
export default function LernenPage() {
  redirect("/");
}
