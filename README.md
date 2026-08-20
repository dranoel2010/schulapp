# Schulapp

Persönliche Schul-App: Stundenplan, Hausaufgaben, Klausuren mit Lernplan und Noten —
für eine Person, auf Handy und Laptop, mit synchronen Daten.

Was gebaut wird und warum, steht in [KONZEPT.md](KONZEPT.md).

## Erster Start

Voraussetzung ist nur Node.js (getestet mit Version 24). Kein Docker, kein
Datenbankserver.

```bash
npm install
npm run db:push     # legt die Tabellen an
npm run dev         # http://localhost:3000
```

Beim ersten Aufruf landest du auf der Einrichtungsseite und legst Namen und
Passwort fest. Danach bist du angemeldet und bleibst es ein Jahr lang.

## Auf dem Handy testen

Im selben WLAN erreichst du den Entwicklungsserver vom Handy aus:

```bash
npm run dev -- -H 0.0.0.0
```

Dann im Handy-Browser `http://<IP-deines-Laptops>:3000` öffnen. Die IP findest du
mit `ipconfig getifaddr en0`.

Das echte App-Gefühl (eigenes Symbol, Vollbild, Installation über Chrome) gibt es
erst im gebauten Zustand, weil der Service Worker absichtlich nur dort läuft:

```bash
npm run build && npm run start
```

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Produktionsbuild |
| `npm run start` | Produktionsserver (Service Worker aktiv) |
| `npm run db:push` | Schemaänderungen in die Datenbank übertragen |
| `npm run db:studio` | Datenbank im Browser ansehen |
| `npm run db:backup` | Kopie der lokalen Datenbank nach `.backups/` |
| `npm test` | Tests der reinen Rechnung: Lernplan, Datumsrechnung, Stundenplan, Fälligkeiten |
| `npm run lint` | ESLint |

## Aufbau

```
src/
  app/
    (auth)/         Einrichtung und Anmeldung — ohne Navigation
    (app)/          alles hinter der Anmeldung
      page.tsx        Start: am Handy Kachelmenü und Tagesspur, am
                      Rechner das Dashboard
      stundenplan/    das Wochenraster Mo–Fr; ein Feld antippen
                      bearbeitet es, zeiten/ stellt das Stundenraster ein
      hausaufgaben/   Liste zum Abhaken, anlegen und ändern
      lernen/         der Lernplan — abhaken, Fortschritt, Countdown
      klausuren/      Termine eintragen und ändern
      faecher/        Fächer mit Farbe, Kürzel und Gewichtung
      einstellungen/  Erinnerungen, Darstellung, Konto
    layout.tsx      Wurzel: Schriften, Metadaten, Service Worker,
                    hell/dunkel
    manifest.ts     PWA-Manifest
  components/
    ui/             Bausteine: Button, Input, Field, Card, EmptyState
    nav/            Navigation
    home/           die drei Ansichten der Startseite
    study/          Lernblock und Nachfrage bei verpassten Tagen
    homework/       das Kästchen zum Abhaken, überall gleich
  db/
    schema.ts       Datenmodell (Vertrag — Änderungen hier betreffen alles)
    index.ts        Datenbankverbindung
  lib/
    auth.ts         Anmeldung, Konto, requireUser()
    session.ts      Sitzungen und Cookie
    password.ts     Passwort-Hashing (scrypt)
    colors.ts       Farbpalette der Fächer
    subjects.ts     Datenzugriff für Fächer
    dates.ts        Kalenderdaten "YYYY-MM-DD", Rechnen in UTC
    study-plan.ts   Lernplan-Generator (reine Rechnung, getestet)
    exams.ts        Datenzugriff für Prüfungen, Themen, Lernblöcke
    timetable.ts    Stundenraster und Wochenplan, dazu die Wochentags-
                    und Kalenderwochen-Rechnung (getestet)
    homework.ts     Datenzugriff für Hausaufgaben
    due-label.ts    „heute“, „Do“, „24.9.“ — die Fälligkeit in Kurzform
    push.ts         Push-Nachrichten an die angemeldeten Geräte
    home.ts         die Zahlen der Startseite, einmal geladen für
                    Kachelmenü, Tagesspur und Dashboard
    theme.ts        hell, dunkel oder dem Gerät überlassen
```

**Lernen und Verwalten sind getrennt.** Unter *Klausuren* trägt man Termine
ein und ändert sie; eine Klausur antippen öffnet direkt das Formular. Unter
*Lernen* steht der Plan und wird abgehakt. Das ist Absicht — es sind zwei
verschiedene Tätigkeiten, und vermischt taugt keine von beiden etwas.

**Der Stundenplan ist eine Woche, kein Kalender.** Er wiederholt sich, deshalb
gibt es kein Blättern zwischen Wochen; die Kalenderwoche oben ist nur eine
Beschriftung. Ein Feld antippen heißt, es zu bearbeiten — auch ein leeres.
Die Uhrzeiten stehen nicht im Raster, sondern im Stundenraster unter
*Stundenzeiten*; erst die Tagesansicht braucht sie.

**Stundenplan und Hausaufgaben gehören zusammen.** Eine neue Aufgabe ist von
sich aus zur nächsten Stunde ihres Fachs fällig, und eine heute fällige
Aufgabe erscheint in der Tagesspur in der Zeile dieser Stunde. Genau deshalb
wurden beide in derselben Phase gebaut.

## Datenbank

Lokal läuft **PGlite**: ein echtes Postgres, das als Datei unter `.data/pglite`
im Projekt liegt. Kein Server, keine Installation, und trotzdem dieselbe
SQL-Sprache wie später in der Cloud.

Sobald `DATABASE_URL` gesetzt ist, verbindet sich dieselbe App stattdessen mit
einem echten Postgres. Der Anwendungscode merkt davon nichts.

```bash
# Beispiel für später
DATABASE_URL=postgres://user:pass@host/db
```

Nach Änderungen an `src/db/schema.ts` immer `npm run db:push` ausführen. Phase 3
bringt drei neue Tabellen mit (`periods`, `lessons`, `homework`) — ohne Push
laufen Stundenplan und Hausaufgaben nicht.

Die lokale Datenbank ist bewusst nicht in Git (`.data/` ist ignoriert).

**Ein Prozess auf einmal.** PGlite öffnet die Datenbankdatei exklusiv. Läuft der
Entwicklungsserver, arbeiten `npm run db:push`, `npm run db:studio` oder eigene
Skripte auf einem Stand, den der Server nicht sieht — und umgekehrt. Also erst
den Server stoppen, dann die Datenbank anfassen. In der Cloud mit einem echten
Postgres entfällt das.

**Den Server geordnet beenden.** Mit `Strg-C` im Terminal. Wird der Prozess hart
abgeschossen (`kill`, `pkill` ohne Signal), kann PGlite ohne gültigen Prüfpunkt
zurückbleiben und die Datenbank lässt sich nicht mehr öffnen. Vor größeren
Eingriffen lohnt sich deshalb:

```bash
npm run db:backup
```

Die Sicherungen liegen unter `.backups/` und sind nicht in Git.

## Erinnerungen (Push)

Die tägliche Lern-Erinnerung läuft über Web-Push. Dafür braucht es einmalig
VAPID-Schlüssel; sie stehen in `.env.local` (nicht in Git). Neue erzeugst du mit:

```bash
npx web-push generate-vapid-keys
```

Einschalten kannst du sie in den Einstellungen der App. Zwei Bedingungen:

- **Nur im gebauten Zustand** (`npm run build && npm run start`), weil der
  Service Worker in der Entwicklung absichtlich nicht läuft.
- Am zuverlässigsten, wenn die App über Chrome installiert wurde.

Der Versand wird von `/api/cron/reminders` ausgelöst. Die Route ist durch
`CRON_SECRET` geschützt und wird **stündlich** aufgerufen — welche Stunde für
dich gemeint ist, entscheidet die Route anhand deiner Erinnerungszeit in
Berliner Zeit. In der Cloud übernimmt das der Eintrag in `vercel.json`; lokal
testest du sie so:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

## Stand

Umgesetzt sind Anmeldung, Fächerverwaltung, App-Hülle und PWA.

**Klausuren und Lernphasen** — Termine mit Themen, automatisch verteilte
Lernblöcke, Countdown, Nachfrage bei verpassten Lerntagen, tägliche Erinnerung
per Push.

**Stundenplan** — festes Wochenraster Mo–Fr, ein Feld antippen bearbeitet es,
das Stundenraster ist einstellbar (1 bis 12 Stunden).

**Hausaufgaben** — Liste zum Abhaken, überfällige zuerst, eine neue Aufgabe ist
von sich aus zur nächsten Stunde ihres Fachs fällig. Abgehaktes bleibt vierzehn
Tage stehen und wird nur ausgeblendet, nie gelöscht.

Beides steht auch auf der Startseite: als Kachel, in der Tagesspur und im
Dashboard. Als Nächstes kommen die Noten — siehe KONZEPT.md.
