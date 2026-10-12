"use client";

import { ArbeitsblattTisch } from "@/components/kombi/tisch/arbeitsblatt/tisch-blatt";

/**
 * Platz für den Tisch (`#tisch`, Prototyp Z. 943–974): Wiederholen und
 * Lernblock. Abschnitt E/F ersetzt diese Datei und meldet `openTisch` über
 * `registriere("tisch", …)` an.
 *
 * Bis dahin hängt Abschnitt H hier den Tisch für Arbeitsblätter ein
 * (./arbeitsblatt/tisch-blatt): ein Übungsthema oder ein Lernblock vor einer
 * Mathe-Klausur öffnet das Blatt; Karten laufen weiter in der alten Sitzung.
 * Beim Zusammenführen mit E nimmt der Tisch aus E `BlattKoerper`,
 * `BlattLupe`, `DruckSeiten`, `ArbeitsblattEnde` und `useArbeitsblatt`
 * auf, und diese Zeile entfällt.
 */
export function TischEbene() {
  return <ArbeitsblattTisch />;
}
