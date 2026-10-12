# Weiterarbeit an Modell 23 · Kombi V2

## Übernommener Stand am 12.10.2026

Bei der Übernahme war diese Datei nicht vorhanden. Die vorhandene `notiz.md`
dokumentiert Claudes Stand bis zur vierten Prüfrunde. `index.html` enthält
den interaktiven Prototyp, einschließlich Tageszeitansichten, Kameraablauf,
Hausaufgaben, Wiederholung, Lernblock und druckbaren Arbeitsblättern mit
manueller Auswertung. Die früheren Prüfergebnisse stammen aus der Notiz
und wurden hier nicht vollständig erneut geprüft.

## Erste Fortsetzung durch Codex

- Verdeckte Reservekarten und Kartenrückseiten sind jetzt `inert` und für
  Screenreader ausgeblendet. Vor dem Aufdecken ist nur die aktuelle Frage
  erreichbar, danach nur deren Lösung. Auch die abgehende Karte wird
  während ihrer Animation aus der Bedienung genommen.
- Die Knöpfe zum Aufdecken und Bewerten wechseln ihre Zugänglichkeit
  gemeinsam mit dem Kartenstatus.
- Titel unter „Zuletzt abgelegt“ sind wie in der vierten Prüfrunde beschrieben
  einzeilig mit Auslassung. Der vollständige Titel bleibt im zugänglichen
  Namen des Blattknopfs erhalten.

## Geprüft

Im Codex-Browser am bestehenden Prototyp: Wiederholung geöffnet,
„England, um 1760“ eingegeben, aufgedeckt, mit „Saß“ bewertet und zum
Überblick zurückgekehrt. Der Accessibility-Baum zeigt jeweils nur die
aktuelle Kartenseite, der Fortsetzungsstand nennt anschließend neun
verbleibende Fragen. Keine erfassten Browserfehler. Der Test hat eine
Antwort im lokalen Prototypstand gespeichert.

Bildnachweis: `screens/codex-01-ueberblick.jpg`.

## Noch offen

- Die Noteneingabe ist laut bisheriger Notiz absichtlich noch ein Platzhalter.
- „Gelöstes Blatt fotografieren“ ist als „bald“ markiert; automatische
  Korrektur ist nicht implementiert.
- Aufgaben der Übungsblätter und die Einordnung neuer Fotos sind simuliert.
- Fokusführung der gesamten überlagernden Ansichten, kleine Geräte,
  Dunkelmodus, reduzierte Bewegung und Druck wurden in dieser Fortsetzung
  noch nicht erneut vollständig geprüft.

Diese Änderungen betreffen ausschließlich den Prototyp. Die bereits
vorhandenen Änderungen der eigentlichen Next.js-App wurden nicht bearbeitet.

## Fortsetzung durch Claude am 12.10.2026 abends

Grundlage waren die 13 Befunde aus der zweiten Prüfrunde (1 hoch, 12 mittel).
Ihre Behebung war in der Nacht am Nutzungslimit gescheitert. Die Runden 3 und 4
galten deshalb nur scheinbar als sauber, in Wahrheit sind sie gar nicht gelaufen.
Jeder Punkt wurde im aktuellen Stand nachgemessen und nach dem Ändern in Chrome
(390×844 und 375×667) geprüft.

**Behoben**
1. Karte auf dem iPhone SE: Die Frage wurde vom Antwortfeld verdeckt, weil die
   Kartenhöhe gemessen wurde, bevor die Schrift fertig umgebrochen war. Jetzt wird
   nach dem Öffnen, nach dem Laden der Schriften und bei jedem neuen Umbruch neu
   gemessen (ResizeObserver).
2. Aufleuchten neuer Zeilen: `--mark` war nicht definiert, deshalb leuchtete gar
   nichts. Jetzt ist es ein leiser, neutraler Ton in Hell und Dunkel, der nicht mehr
   über die Spalte ragt.
3. „Wird eingeordnet …“ zeigt nur einen Platzhalter. Das war schon richtig.
4. „Zuletzt abgelegt“: Die Titel stehen in zwei Zeilen statt abgeschnitten.
5. „Wie lief es?“: „Richtig“ hat einen Haken auf hellem Grund, „Falsch“ ein Kreuz
   auf dunklem Grund. Die nicht gewählte Hälfte tritt zurück.
6. „Gelöstes Blatt fotografieren · bald“ steht ganz im Bild, weil die Zeilen
   kompakter sind.
7. Nach dem ersten Foto ist „Noch ein Blatt“ ein heller, leiser Zweitknopf. Nur
   „Weiter zu Hausaufgaben“ bleibt dunkel.
8. Suche: Treffer im Titel stehen vor Treffern im Thema, diese vor Treffern im Text.
   Der oberste Treffer sagt, was er ist („Blatt · …“). Bei „dampf“ steht „Die
   Dampfmaschine“ oben.
9. Abhaken in den Suchtreffern ändert nur die eine Zeile, die Liste sortiert sich
   nicht unter dem Finger um.
10. Liegt ein Knopf in der Ausblendzone über der Zeile, entfällt der Verlauf.
11. Beim Schließen der Lesegröße blendet zuerst der große Text aus (80 ms), dann
    fliegt die leere Seite zurück. Es liegen keine zwei Texte mehr übereinander.
    Zurück geht es zu der Seite, die gerade am meisten im Bild ist.
12. Lernblock nach dem Drucken: Die Zeile zeigt „Auswerten · Arbeitsblatt gedruckt,
    noch nicht ausgewertet“ statt wieder „Starten“.
13. Ablegen in der Kamera: Der Sucher wird schon beim Ablegen flach, und die Kamera
    schrumpft in einem Zug darauf. Bis das Blatt gelandet ist, steht weder
    „Keine Blätter, weiter“ noch „Weiter“ da.

**Bewusst so gelassen:** „Heute zwei Abgaben“ zählt am Morgen auch erledigte
Aufgaben mit. Gemeint ist, was heute abgegeben wird, also was in die Tasche muss.

**Geprüft:** 16 Kombinationen (zwei Größen × Hell/Dunkel × 07:20, 14:10, 16:40, 20:30):
keine JS-Fehler, kein seitliches Verrutschen, keine Tippfläche unter 44×44.
`impeccable detect`: 0 Befunde. Kameratests liefen nur mit der Testkamera von
Chrome (`--use-fake-device-for-media-stream`), geprüft vor jedem Test.

**Noch offen:** keine unabhängige Prüfrunde nach diesen Änderungen, denn die
Hilfsagenten waren am Limit. Am echten iPhone nicht geprüft: Tastatur, Druckdialog,
echte Kamera.

## Unabhängige Prüfung und zweite Fortsetzung, 12.10.2026 abends

Ein unabhängiger Prüfer hat den Stand durchgespielt: ein ganzer Tag, Hell und Dunkel,
zwei Größen. Er hat 2 hohe, 5 mittlere und 7 kleine Befunde gefunden. Behoben:

- **Hoch:** „Zuletzt abgelegt“ war leer, sobald der Überblick knapp wurde, weil
  `.short .tcell span` auch die Miniatur traf. Jetzt verschwinden nur Titel und Fach.
- **Hoch:** Lernblock mit Arbeitsblatt: kein „Zeit um“ und kein „Als erledigt zählen?“
  mehr. Erledigt ist der Block erst nach „Wie lief es?“.
- Suche: Der Erledigt-Stand bleibt eingefroren, solange das Menü offen ist. Neu
  sortiert wird erst bei der nächsten Eingabe. Die Server-Suche löst sich nicht mehr
  alle 190 ms selbst neu aus (das war die Ursache des Umsortierens).
- Verlauf: Die Regel gilt jetzt auch für „Wiederholen“. Ist ein Knopf nur angeschnitten
  (unter 40 % im Bild), bleibt der Verlauf und nimmt die harte Kante weg.
- Lernblockzeile nach dem Druck: „Gedruckt, noch nicht ausgewertet“, zwei Zeilen statt drei.
- Nach „Überspringen“ steht in den Vorschlägen „Nach der Schule“. Das öffnet den Ablauf
  mit „Schließen“ (V2 5.4). Das Menü in der Datumszeile bleibt weg, wie von Codex entschieden.
- „packen“ meint morgens vor Schulschluss den heutigen Tag.
- Blattzeilen: Der Titel steht nur, wenn er mehr sagt als das Thema („Zellatmung ·
  Abschrift folgt“ wurde zu „Abschrift folgt“).
- Flacher Sucher: Ein Kamerazeichen ersetzt den Auslöserring, der wie ein Radiobutton wirkte.

Neu auf Wunsch des Nutzers: ein Zahnrad oben rechts in der Datumszeile, es öffnet die
Einstellungen. Das Menü über der Tastatur hat unten einen Verlauf, wenn noch Einträge
folgen. Der Nutzer hat ein Android-Handy und nutzt die App installiert ohne Adresszeile.
Geprüft wird deshalb auch auf 360×800.

**Noch offen (klein):** Morgens rutscht eine abgehakte Abgabe unter die andere. Auf
375×667 steht „Gelöstes Blatt fotografieren“ erst nach Scrollen im Bild. Ein Suchmenü
mit nur einem Treffer hat viel Leerfläche. Die Untertitel in Schritt 2 sind uneinheitlich.
Der Rückflug aus der Lesegröße wächst nicht ganz in die A4-Form zurück.

**Geprüft:** 390×844 und 360×800, Hell und Dunkel, 07:20, 14:10, 16:40 und 20:30:
keine Fehler, kein Querscrollen, keine Tippfläche unter 44×44. `impeccable detect`: 0.
