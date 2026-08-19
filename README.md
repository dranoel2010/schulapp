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

## Stand

Phase 1 ist umgesetzt: Anmeldung, Fächerverwaltung, App-Hülle, PWA.
Als Nächstes kommen Klausuren und Lernphasen — siehe KONZEPT.md.
