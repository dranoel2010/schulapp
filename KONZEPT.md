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
| Stundenplan | Fester Wochenplan, Mo–Fr |
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
Fach ──┬── Stundenplan-Slot   Wochentag, Stunde, Raum
       ├── Hausaufgabe        Titel, fällig, erledigt
       ├── Klausur            Datum, Themen, Gewicht
       │      └── Lernblock   Tag, Dauer, Thema, Status
       └── Note               Wert, Art (schriftl./mündl.), Gewicht, Datum
```

**Fach**: Name, Kürzel, Farbe, Lehrkraft, Raum, Gewichtung schriftlich/mündlich

**Noten** werden intern als Dezimalzahl gespeichert, damit der Schnitt stimmt:

| Note | 1+ | 1 | 1− | 2+ | 2 | 2− | … | 6 |
|---|---|---|---|---|---|---|---|---|
| Wert | 0,7 | 1,0 | 1,3 | 1,7 | 2,0 | 2,3 | … | 6,0 |

## Lernphasen-Logik

**Plan erzeugen** — aus Klausurdatum + Themenliste:

- Standard-Lernzeitraum: 10 Tage vor der Klausur (einstellbar pro Klausur)
- Standard-Block: 45 Minuten pro Lerntag (einstellbar)
- Themen werden über die Lerntage verteilt, nicht alle auf den letzten Tag
- Jedes Thema kommt **zweimal** vor: einmal lernen, einmal wiederholen
- Die letzten zwei Tage sind Wiederholung aller Themen
- Freie Tage (z.B. Wochenende oder Termine) lassen sich ausnehmen

**Verpasster Lerntag** — die App fragt nach:
> "Gestern Mathe nicht geschafft — heute nachholen oder streichen?"

Beim Nachholen wird auf die verbleibenden Tage neu verteilt, damit der Plan
realistisch bleibt.

**Push-Nachrichten**: tägliche Erinnerung an den Lernblock, plus Countdown-
Meldung einige Tage vor der Klausur.

## Reihenfolge des Baus

1. **Fundament** — Projekt, Datenbank, Login, Fächer anlegen, Deployment
   *Ziel: liegt als Icon auf dem Homescreen*
2. **Klausuren & Lernphasen** — Termine, Themen, Plan-Generator, Countdown,
   Fortschritt, Nachfrage bei verpassten Tagen, Push
3. **Stundenplan & Hausaufgaben** — Wochenplan, Aufgaben, Startseite
   "Was ist heute und morgen?"
4. **Noten** — Eintragen, Schnitt pro Fach und gesamt,
   "Was brauche ich noch für eine 2?"

## Offene Punkte

- Fächerliste (kommt beim ersten Einrichten in der App)
- Genaue Gewichtung schriftlich/mündlich pro Fach (in den Einstellungen)
- Offline **schreiben** (Hausaufgabe im Schulnetz ohne Empfang eintragen) —
  bewusst später, erst wird offline nur gelesen
