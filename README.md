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
| `npm test` | Tests des Lernplans und der Datumsrechnung |
| `npm run lint` | ESLint |

## Aufbau

```
src/
  app/
    (auth)/         Einrichtung und Anmeldung — ohne Navigation
    (app)/          alles hinter der Anmeldung, mit Navigationsleiste
    layout.tsx      Wurzel: Schriften, Metadaten, Service Worker
    manifest.ts     PWA-Manifest
  components/
    ui/             Bausteine: Button, Input, Field, Card, EmptyState
    nav/            Navigation
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
    push.ts         Push-Nachrichten an die angemeldeten Geräte
```

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

Nach Änderungen an `src/db/schema.ts` immer `npm run db:push` ausführen.

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

Umgesetzt sind Anmeldung, Fächerverwaltung, App-Hülle, PWA sowie Klausuren und
Lernphasen: Termine mit Themen, automatisch verteilte Lernblöcke, Countdown,
Nachfrage bei verpassten Lerntagen und tägliche Erinnerung per Push.
Als Nächstes kommen Stundenplan und Hausaufgaben — siehe KONZEPT.md.
