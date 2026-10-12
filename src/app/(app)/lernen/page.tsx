import { redirect } from "next/navigation";

/**
 * `/lernen` gibt es in Modell 23 nicht mehr (Plan 2.2): der Lernplan mit
 * allen bisherigen Funktionen steht auf der Klausurseite `/klausuren/[id]`,
 * der heutige Lernblock im Überblick. Alte Lesezeichen und Benachrichtigungen
 * landen auf der Startseite.
 */
export default function LernenPage(): never {
  redirect("/");
}
