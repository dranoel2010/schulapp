# Schulapp — Konzept

Persönliche Schul-App für einen Nutzer. Langfristig angelegt, wächst in Phasen.

## Zweck

Zwei Dinge sollen sie wirklich gut können:

1. **Organisation** — Stundenplan, Hausaufgaben, Termine an einem Ort
2. **Noten & Fortschritt** — Schnitt im Blick, Ziele verfolgen

Der Einstieg ist **Klausuren & Lernphasen**: Prüfungstermine mit Countdown und
automatisch geplanten Lernblöcken davor.

## Rahmenbedingungen

| Punkt | Entscheidung |
|---|---|
| Nutzer | Nur ich (ein Account) |
| Geräte | Android-Handy + Laptop, Daten synchron |
| Notensystem | Deutsche Noten 1–6 mit +/− |
| Stundenplan | Fester Wochenplan, Mo–Fr, 1 bis 12 Stunden am Tag |
| Erinnerungen | Push-Nachrichten aufs Handy |

## Technik

- **Next.js (App Router) + TypeScript + Tailwind**
- **PWA** — installierbar auf dem Homescreen, offline lesbar
- **Postgres** als Datenbank, Zugriff über eine typsichere Schicht (Drizzle)
- **Vercel** als Hosting, Deploy per Git-Push
- **Ein Login** mit Passwort + Session-Cookie

Begründung: ein Codestand für beide Geräte, Sync ergibt sich aus dem Server,
kein App-Store, Änderungen sind Minuten später auf dem Handy.

> Push läuft auf Android (Chrome) zuverlässig — auch im normalen Tab, als
> installierte PWA aber am besten (eigenes Icon, Vollbild). Am Laptop ebenso.

## Datenmodell

```
Nutzer ─── Stundenraster      Nummer, Beginn, Ende   (1.–12. Stunde)

Fach ──┬── Stundenplan-Slot   Wochentag, Stunde, Raum, Notiz
       ├── Hausaufgabe        Titel, Notiz, fällig, erledigt-Zeitpunkt
       ├── Klausur            Datum, Themen, Gewicht
       │      └── Lernblock   Tag, Dauer, Thema, Status
       └── Note               Wert, Art (schriftl./mündl.), Gewicht, Datum
```

Das **Stundenraster** hängt am Nutzer, nicht am Fach: wann die 3. Stunde
beginnt, gilt für die ganze Schule. Es steht in der Datenbank statt im Code,
weil jede Schule andere Zeiten hat — ein falsches Raster macht den ganzen
Stundenplan wertlos. Beim ersten Öffnen wird eine Vorgabe angelegt, die man
danach ändert.

**Erledigt** ist bei einer Hausaufgabe ein Zeitpunkt, kein Ja/Nein. Ein
Zeitpunkt kann nicht in Widerspruch zu einem Häkchen geraten, und „heute
abgehakt" lässt sich daraus ablesen. Abgehakte Aufgaben verschwinden nach
vierzehn Tagen aus der Liste — gelöscht wird nie, nur ausgeblendet.

**Fach**: Name, Kürzel, Farbe, Lehrkraft, Raum, Gewichtung schriftlich/mündlich

**Noten** werden nicht als „2+" gespeichert, sondern als Zahl — sonst ließe
sich kein Schnitt rechnen:

| Note | 1+ | 1 | 1− | 2+ | 2 | 2− | … | 5− | 6 |
|---|---|---|---|---|---|---|---|---|---|
| Wert | 0,7 | 1,0 | 1,3 | 1,7 | 2,0 | 2,3 | … | 5,3 | 6,0 |

In der Datenbank steht davon das Zehnfache als ganze Zahl (7, 10, 13 … 60);
warum, steht unten bei der Notenlogik.

## Lernphasen-Logik

**Plan erzeugen** — aus Klausurdatum + Themenliste. Die Regeln sind bewusst
festgeschrieben, weil sie durch Tests abgesichert sind:

1. Lerntage sind alle Tage von spätestens *Klausurdatum − 10* bis zum Tag
   **vor** der Klausur. Der Prüfungstag selbst ist nie ein Lerntag.
2. Von diesen Tagen sind die letzten zwei Wiederholungstage — bei nur zwei
   oder drei verfügbaren Tagen der letzte, bei einem einzigen keiner.
3. Die Themen werden **gleichmäßig über den ganzen Zeitraum** verteilt, nicht
   vorne zusammengedrängt.
4. An den Wiederholungstagen kommt jedes Thema noch einmal dran.
5. Die Minuten eines Tages werden auf seine Blöcke aufgeteilt, auf 5 Minuten
   gerundet, mindestens 10 — die Tagessumme überschreitet nie das Budget.
6. Vorlauf (10 Tage) und Tagesbudget (45 Minuten) sind pro Klausur änderbar.

Gerechnet wird ausschließlich mit Kalenderdaten in UTC, nie mit Zeitstempeln.
Dadurch verschiebt die Sommerzeit-Umstellung keinen einzigen Lerntag.

**Verpasster Lerntag** — die App fragt nach:
> "Gestern Mathe nicht geschafft — heute nachholen oder streichen?"

Beim Nachholen wird auf die verbleibenden Tage neu verteilt, damit der Plan
realistisch bleibt.

**Push-Nachrichten**: tägliche Erinnerung an den Lernblock, plus Countdown-
Meldung einige Tage vor der Klausur.

## Notenlogik

**Gespeichert wird in Zehnteln**, als ganze Zahl: 7 ist eine 1+, 10 eine 1, 13
eine 1−, 60 eine 6. Der Grund ist der Schnitt — 1,3 + 2,3 ergibt in Fließkomma
3,5999999999999996 und nicht 3,6, in Zehnteln dagegen genau 36. Die Skala hat
16 Stufen und endet bei 5−, dann kommt die 6: eine 6 trägt keine Tendenz.

**Der Fachschnitt** setzt sich aus zwei Töpfen zusammen, schriftlich und
mündlich. Wie stark jeder wiegt, steht am Fach (`weightWritten` in Prozent) und
nicht an der einzelnen Note. Innerhalb eines Topfes zählt das Gewicht der Note:
eine Klausur zählt doppelt gegenüber einem Test.

Fehlt ein Topf ganz — noch keine mündliche Note eingetragen —, dann zählt er
**nicht als Null und nicht als Vier, sondern gar nicht**. Sonst wäre der
Schnitt nach der ersten Klausur des Schuljahrs eine Lüge.

**Der Gesamtschnitt** ist das schlichte Mittel der Fachschnitte: jedes Fach
zählt einmal, egal wie viele Noten darin stehen. Das ist die Rechnung, die ein
Zeugnis meint. Archivierte Fächer zählen nicht mit — ein abgewähltes Fach soll
den heutigen Schnitt nicht mehr bewegen, seine alten Noten bleiben aber
erhalten und sichtbar.

**„Was brauche ich noch für eine 2?"** — gesucht wird die schlechteste Note,
mit der der Fachschnitt das Ziel gerade noch hält. Verglichen wird die auf zwei
Nachkommastellen gerundete Zahl, also genau die, die auch angezeigt wird; sonst
stünde „2,00" da und die App sagte trotzdem, das Ziel sei verfehlt. Drei
Ausgänge: das Ziel hält jede Note, es hält ab dieser Note, oder es ist mit
einer Note nicht mehr zu schaffen.

## Reihenfolge des Baus

1. ~~**Fundament** — Projekt, Datenbank, Login, Fächer anlegen~~ **fertig**
2. ~~**Klausuren & Lernphasen** — Termine, Themen, Plan-Generator, Countdown,
   Fortschritt, Nachfrage bei verpassten Tagen, Push~~ **fertig**
3. ~~**Stundenplan & Hausaufgaben** — Wochenplan, Aufgaben, Startseite
   "Was ist heute und morgen?"~~ **fertig**
4. ~~**Noten** — Eintragen, Schnitt pro Fach und gesamt,
   "Was brauche ich noch für eine 2?"~~ **fertig**

## Offene Punkte

- Fächerliste (kommt beim ersten Einrichten in der App)
- Halbjahre: die Noten liegen alle in einem Topf. Ein Schuljahr später will man
  „Schnitt Q1" sagen können — dafür fehlt ein Zeitraum im Datenmodell
- Zeugnisnote je Fach von Hand überschreiben (die Lehrkraft rundet anders als
  die Rechnung)
- Offline **schreiben** (Hausaufgabe im Schulnetz ohne Empfang eintragen) —
  bewusst später, erst wird offline nur gelesen
- Erinnerung an fällige Hausaufgaben per Push — der Lernplan hat sie schon,
  die Aufgaben noch nicht
- Vertretung und Ausfall einer einzelnen Stunde — der Wochenplan ist fest,
  eine Ausnahme für einen Tag kennt er nicht
- Freie Tage vom Lernplan ausnehmen (Wochenende, Urlaub) — im Datenmodell
  vorgesehen, in der Oberfläche noch nicht angeboten
