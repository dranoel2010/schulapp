# 24-kombi-v2-astra

Der Tag führt von den Abgaben am Morgen über Blätter und Hausaufgaben zum Überblick, während die dunkle Eingabezeile an derselben Stelle bleibt.
Schibsted Grotesk trägt die Bedienung, Newsreader die vorgegebenen Überschriften und Fragen, Material Symbols Rounded die Icons.
Papier, Blau und alle dunklen Gegenwerte folgen der V2-Palette und `prefers-color-scheme`, ohne Farbumschalter oder globale Tabellenziffern.
Der Tisch wächst aus seinem Startknopf, Karten drehen und fliegen nach den Fundstellen aus 14 und 19, während Tageszeiten nach 17, Texte und Geistflug nach 16, Tastaturanhebung nach 03 und der Randwisch nach 10 umgesetzt sind.
Die flachen Aufgabenzeilen, echten Themenzusammenhänge und die am Tagesablauf orientierte Reihenfolge ersetzen ein austauschbares Kartenraster.
`?zeit=07:10` verwendet Montag, den 12. Oktober 2026, `?jetzt=2026-10-13T00:30` prüft andere Tage, und `?jetzt=2026-10-20T09:00&ferien=1` aktiviert den freien Beispielzeitraum; der lokale Stand liegt getrennt von Modell 23 in IndexedDB unter `schulapp-24-kombi-v2-astra`.
Syntax, alle 23 Parser-Beispiele, die sieben Zeitgrenzen, alle Nachschlageseiten und alle 30 Fragen einschließlich erneuter Vorlage, Zurückziehen und gemeinsamem Lernblockstand wurden in einem Node-VM mit einer vereinfachten DOM-Nachbildung geprüft, was keine Browser-, Layout- oder Geräteprüfung ersetzt.
Die vollständige Abnahme ist nicht erfüllt, weil diese einzelne HTML-Datei keinen Server enthält und Webserver, Browserstart und Chrome-Steuerung hier blockiert waren; der erlaubte statische Lauf von `.claude/skills/impeccable/scripts/impeccable detect` meldete genau den vorgeschriebenen blauen Kartenschatten als `dark-glow`.

## Abnahme nach Abschnitt 15

**L** = Logik ausgeführt und erfüllt, **C** = im Code vorhanden, Sicht-/Geräteabnahme offen, **O** = nicht erfüllt beziehungsweise nicht prüfbar.
Die in der Vorgabe geforderte Prüfung jedes Kriteriums am echten iPhone in beiden Schemata bleibt insgesamt offen.

| Nr. | Status | Befund |
|---|---|---|
| 1 | L | Montag 07:10 wählt Morgens und das zugehörige Datum. |
| 2 | L | 13:09 Morgens, 13:11 Blätter. |
| 3 | L/C | Überspringen protokolliert; die Ansicht verwendet diesen Tagesstand, Speicherung per IndexedDB. Neuladen im Browser offen. |
| 4 | L/C | Fertig protokolliert denselben Tagesabschluss; Persistenz wie 3. |
| 5 | L/C | Schritt 2 schreibt `ablauf_schritt`; Wiederherstellung aus IndexedDB implementiert. |
| 6 | L | Dienstag 00:30 gehört Montag; 04:01 gehört Dienstag. |
| 7 | L | Samstag 09:00 öffnet Überblick ohne Ablauf. |
| 8 | L | Freier Beispielzeitraum blendet Aufgaben, Lernblock und Wiederholen aus. |
| 9 | C | Keine laufende Umschaltung; Entscheidung nur beim Sichtbarwerden, Wechsel mit Richtung. |
| 10 | C | Kaltstart setzt die Ansicht direkt, anschließend Schriftbereitschaft und Eingangsbewegung. |
| 11 | O | Kein Server; IndexedDB statt localStorage, aber keine serverseitige Entscheidung. |
| 12 | L/C | Vorschau mit Dienstagdatum, kleinem „morgens“ und Jetzt-Pille; Rückwärtsrichtung implementiert. |
| 13 | L | Wiedergeöffneter Ablauf hat „Schließen“. |
| 14 | L/C | Dienstag enthält Mathe und Deutsch; erledigte Abgaben werden darunter sortiert. |
| 15 | C | Vier Dienstagstunden mit Beginn, Raum und Hauptunterricht-Unterlabel. |
| 16 | C | Keine Packliste, Zusatzgegenstände, laufende Stunde oder fremdtägige Morgenklausur. |
| 17 | C | Freitags erscheint die Matheklausur in der Morgenansicht. |
| 18 | O | Kompaktes Layout vorgesehen; 390×844 nicht gerendert. |
| 19 | C | Eingebetteter Sucher mit Auslöser; keine Fachzeilen oder Fachauswahl in Schritt 1. |
| 20 | L/C | Drei Aufnahmen ergeben drei Blätter; Miniaturen, „Seite dazu“ und Statuswechsel zur Beispiel-Einordnung. Echte Fotos brauchen Jev. |
| 21 | C | Knopf wechselt nach Ablage auf „Weiter zu Hausaufgaben“. |
| 22 | L | Biologie-Kontext ergibt Eintragen, Biologie und Do 15.10. als nächste Stunde. |
| 23 | L | Schon offen enthält die offenen Aufgaben nach Fälligkeit. |
| 24 | C | Überspringen auf beiden Schritten; mindestens 44×44 CSS-Pixel am Knopf. |
| 25 | L/C | Überspringen löscht keine Aufgaben oder Blätter; lokales Speichern implementiert. |
| 26 | O | Überblick auf 390×844 nicht visuell verifiziert. |
| 27 | O | Kompakte SE-Regeln vorhanden, Sichtbarkeit auf 375×667 nicht verifiziert. |
| 28 | L/C | Überschrift aus offenen Aufgaben berechnet; Abhaken mit 350-ms-Verbleib und Textwechsel. |
| 29 | C | Bei nicht unmittelbar folgendem Schultag steht zusätzlich dessen Datum. |
| 30 | C | Überblick enthält weder Noten noch Stundenplan. |
| 31 | L | Drei Themen, zuerst Geschichte und Industrialisierung in England. |
| 32 | L/C | Lernblock startet denselben Tisch; andernfalls erscheint der nächste Plantermin. |
| 33 | L/C | Neueste drei Blätter mit Öffnen und Alle; Miniaturlayout ungeprüft. |
| 34 | C | Wiederholen ist die einzige dauerhaft blau gefüllte Fläche im Überblick. |
| 35 | L | Ältester Termin, Klausurnähe, Fragenzahl, Alphabet; angefangenes Thema zuerst. |
| 36 | L | Jede Runde enthält nur Fragen des aktuellen Themas. |
| 37 | L | Leeres Antwortfeld deaktiviert Aufdecken; Urteilen erst nach Antwortversuch. |
| 38 | L | Weiß ich nicht speichert einen leeren Versuch. |
| 39 | L | Daneben hängt dieselbe Frage ans Themenende, Zähler aus der Warteschlange. |
| 40 | L | Thema endet erst nach Saß aller verbleibenden Fragen. |
| 41 | L | Themenende zählt Fragen und erste richtige Versuche ohne Prozentwert. |
| 42 | L/C | Wieder dran verwendet den nächsten Termin im lokalen Fragendatensatz; kein Server-`recall_schedule`. |
| 43 | L/C | Nächstes Thema wird innerhalb desselben Tisches aufgebaut. |
| 44 | L/C | Themenzahl sinkt auf zwei; Rückflug zum gespeicherten Startrechteck implementiert. |
| 45 | L | Nach allen Themen erscheint „Für heute durch. Nächstes Thema Dienstag.“ |
| 46 | L/C | Übrige Fragen und Erstantworten werden als Fortsetzung gespeichert; Browserneustart offen. |
| 47 | L | Lernblock und Wiederholen verwenden dieselben Frageobjekte und Termine. |
| 48 | L | Rückfrage, dauerhaftes Zurückziehen und angepasste Themenzahl geprüft. |
| 49 | O | visualViewport und kompakter Kartenmodus implementiert; Safari und installierte PWA nicht geprüft. |
| 50 | L/C | Keine Animationssperre; aufeinanderfolgende Antworten und Urteile verarbeitet. Physische Schnellbedienung offen. |
| 51 | L | Alle 15 V1- und acht V2-Parser-Beispiele ergeben die richtige Absicht und Fälligkeit. |
| 52 | C | Ein einziges dauerhaft montiertes Feld in der Shell; außerhalb der Ansichtsanimation. |
| 53 | O | 17-px-Feld und Tastaturanhebung vorhanden; iOS-Zoom praktisch ungeprüft. |
| 54 | L | Wohin enthält alle neun Bereiche. |
| 55 | O | Echtes getUserMedia beginnt bei pointerdown; 1,5 Sekunden nicht messbar. |
| 56 | C | Ablage vom Überblick setzt das neue Blatt an die erste Position; Aufnahmeflug nicht gesichtet. |
| 57 | L/C | Ereignisse für Ablaufabschluss, Überspringen und Themenende; Rückgängig entfernt Aufgabenereignisse. Nur lokal. |
| 58 | C | System-Mediaquery und Änderungslistener vorhanden, kein Neuladen erforderlich. |
| 59 | O | Keine Screenshots der neun Ansichten in beiden Schemata; vollständige Kontrastabnahme offen. |
| 60 | C | Dunkler Dockrand und heller Saß-Knopf nach exakten Tokens. |
| 61 | C | theme-color für Papier, Kamera und Tisch; Schemawechsel wird beobachtet. |
| 62 | C | data-theme light/dark überstimmt das System, ohne sichtbaren App-Schalter. |
| 63 | C | Keine Farbvariable hängt an der Tageszeit. |
| 64 | C | Extern ausschließlich die drei vorgegebenen Google-Font-Familien. |
| 65 | C | Newsreader nur für Ansichtsüberschriften, Kartenfragen, Themenende und Formeln. |
| 66 | C | Anzahlen aus Datensätzen/Ereignissen, Notenschnitte aus Beispielnoten mit schriftlich/mündlich 1:1. |
| 67 | C/O | WAAPI verwendet transform/opacity; Performance-Panel nicht zugänglich. |
| 68 | C | Wechselversionen, Unterbrechung und Aufräumen verhindern verwaiste Ansichten; visuelle Schnellprüfung offen. |
| 69 | C | Reduzierte Bewegung je Animation; Crossfades, keine Flüge, Gesten ohne Feder beim Loslassen. Geräteprüfung offen. |

## Grenzen des Einzeldatei-Modells

| Bereich | Umsetzung |
|---|---|
| Server, Jev, Datenbank | Lokaler Datensatz und IndexedDB; keine externen API-Aufrufe. |
| Kamera | Echte Geräteaufnahme oder Dateiauswahl; nach verweigertem Zugriff zusätzlich „Beispielblatt aufnehmen“. |
| Einordnung und Abschrift | Nur das ausdrücklich gewählte Beispielblatt hat eine simulierte Einordnung und Abschrift; eigene Fotos bekommen keine erfundene Abschrift. |
| Volltext | Lokale Suche über die mitgelieferten Texte, 150 ms Verzögerung; kein PostgreSQL-Index. |
| Noten | Gewichte und Arten der Beispielnoten sind lokal modelliert; Schnittwerte werden berechnet, nicht als „Gesamt 2,4“ fest eingetragen. |
| Impeccable | Ein Befund zum Kartenschatten `rgba(10,18,70,.55)`; wegen V2 Abschnitt 11.3 beibehalten, nicht durch einen Ignore versteckt. |
| Prüfung | Keine Browser- oder iPhone-Freigabe behauptet; DOM-Nachbildung prüft Kontrollfluss, nicht Geometrie, CSS oder Rendering. |

## Anpassung 11.10.2026 · gemeinsame Kamera

Schritt 1 enthält einen großen Sucher, einen Auslöser und einen horizontalen Miniaturstreifen. Jedes Foto wird sofort als eigenes Blatt abgelegt; „Seite dazu“ ergänzt gezielt das letzte Blatt. Die Kamera nennt ausschließlich „Fach erkennen“. Unter dem Sucher stehen die Blätter zunächst mit „Wird eingeordnet …“, danach mit erkanntem Fach und Thema. Eine Fachkorrektur steht erst am eingeordneten Blatt zur Verfügung. Schritt 2 behält seine Fachzeilen.

Die ausdrücklich als Beispiel gestarteten Aufnahmen demonstrieren die Einordnung nach Geschichte / Industrialisierung in Deutschland. Echte Fotos werden gespeichert und zeigen ohne angeschlossenen Jev-Server „Einordnung nicht verfügbar“; ihnen werden keine erfundenen Fächer zugewiesen. Syntax und Aufnahme-Zustandswechsel separat geprüft; Chrome-Start für die Sichtprüfung scheiterte in der Sandbox (SIGABRT).
