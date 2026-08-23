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
| `npm test` | 319 Tests in 67 Suiten — die reine Rechnung: Lernplan, Datumsrechnung, Stundenplan, Fälligkeiten, Notenskala, Themen-Titel, Bildmaße, die Zahlen der Startseite, das Formular der Ablage, die Prüfschemata des Eingangskorbs und das MCP-Protokoll |
| `npm run lint` | ESLint |

## Aufbau

```
src/
  app/
    (auth)/         Einrichtung und Anmeldung — ohne Navigation
    (app)/          alles hinter der Anmeldung
      page.tsx        Start: am Handy drei wischbare Seiten — Kamera,
                      Kachelmenü, Tagesspur —, am Rechner das Dashboard
      stundenplan/    das Wochenraster Mo–Fr; ein Feld antippen
                      bearbeitet es, zeiten/ stellt das Stundenraster ein
      hausaufgaben/   Liste zum Abhaken, anlegen und ändern
      lernen/         der Lernplan — abhaken, Fortschritt, Countdown
      klausuren/      Termine eintragen und ändern
      noten/          Schnitt je Fach und gesamt, eintragen und ändern;
                      fach/ zeigt ein Fach mit allen seinen Noten
      material/       die Ablage: abfotografierte Blätter mit Fach, Themen
                      und Datum; [id] zeigt eins mit allen seinen Seiten
      eingang/        der Eingangskorb: Vorschläge zu einem Blatt, [id]
                      zeigt den Vorschlag mit dem Formular, das ihn
                      übernimmt, neu/ legt einen von Hand an
      faecher/        Fächer mit Farbe, Kürzel und Gewichtung
      einstellungen/  Erinnerungen, Darstellung, Konto, verbundene Agenten
    (auth)/oauth/     die Zustimmung: hier erlaubt ein Mensch einem Agenten
                      den Zugriff — mit der Anmeldung, die es schon gibt
    api/
      material/       liefert die Bilder aus: /api/material/<seite> das
                      Vollbild, .../vorschau die Vorschau
      mcp/            der MCP-Endpunkt: hier ruft ein Agent die Werkzeuge
      oauth/          register/ meldet einen Client an, token/ tauscht
                      Code gegen Token
      push/, cron/    Anmeldung der Geräte und der stündliche Anstoß
    .well-known/      die Metadaten, an denen ein Client den Weg findet
                      (RFC 9728 und RFC 8414)
    layout.tsx      Wurzel: Schriften, Metadaten, Service Worker,
                    hell/dunkel
    manifest.ts     PWA-Manifest
  components/
    ui/             Bausteine: Button, Input, Field, Card, EmptyState
    nav/            Navigation
    home/           die vier Ansichten der Startseite: Kamera, Kachelmenü
                    und Tagesspur am Handy, Dashboard am Rechner
    study/          Lernblock und Nachfrage bei verpassten Tagen
    homework/       das Kästchen zum Abhaken, überall gleich
    grades/         die Fachzeile mit Schnitt, Balken und Fachfarbe
    material/       der Auslöser: Kamera öffnen, Bild verkleinern,
                    Seite für Seite hochladen
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
    topics.ts       Themen-Titel putzen und falten — dieselbe Schreibweise
                    zweimal ist dasselbe Thema (reine Rechnung, getestet)
    subject-topics.ts  Datenzugriff für das Themen-Vokabular eines Fachs:
                    anlegen, umbenennen, zusammenlegen, wieder trennen
    timetable.ts    Stundenraster und Wochenplan, dazu die Wochentags-
                    und Kalenderwochen-Rechnung (getestet)
    homework.ts     Datenzugriff für Hausaufgaben
    due-label.ts    „heute“, „Do“, „24.9.“ — die Fälligkeit in Kurzform
    push.ts         Push-Nachrichten an die angemeldeten Geräte
    home.ts         die Zahlen der Startseite, einmal geladen für Kamera-
                    Seite, Kachelmenü, Tagesspur und Dashboard (getestet)
    grade-scale.ts  die Notenskala 1+ bis 6 und alles, was man damit
                    ausrechnet — Schnitt, Gewichtung, Ziel (getestet)
    grades.ts       Datenzugriff für Noten und die Schnitte je Fach
    images.ts       auf welche Maße ein Foto verkleinert wird und wie
                    eine Dateigröße auf Deutsch heißt (getestet)
    materials.ts    Datenzugriff für die Blätter, ihre Seiten und die
                    Themen daran; Titelvorschlag und Formular getestet
    proposals.ts    Datenzugriff für den Eingangskorb, dazu die
                    Prüfschemata der drei Arten und der Abdruck, an dem
                    ein doppelter Vorschlag hängen bleibt (getestet)
    mcp-protocol.ts JSON-RPC, Kopfzeilen und Fehlercodes des Model
                    Context Protocol — reine Rechnung, getestet
    mcp-tools.ts    die dreizehn Werkzeuge: zehn read_*, drei propose_*
    oauth.ts        Clients, Codes, Token, PKCE und die Metadaten
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

**Die Kamera ist eine Wischgeste weit weg.** Am Handy hat die Startseite drei
Seiten: links die Kamera, in der Mitte das Kachelmenü, rechts die Tagesspur.
Der Weg zum Auslöser ist damit die Wischrichtung, in der nicht der Tagesablauf
steht — im Unterricht bleiben für ein Arbeitsblatt zwei Sekunden. Das
Kachelraster hat deshalb keine siebte Kachel bekommen: es passt so, wie es ist,
auf einen Bildschirm.

**Die Blätter liegen in der Datenbank, nicht in einem Speicherdienst.** Ein
Foto steht als `bytea` neben allen anderen Daten; `npm run db:backup` sichert
es mit, es braucht keinen zweiten Zugang und kein Token, und lokal wie in der
Cloud läuft derselbe Code. Verkleinert wird schon im Browser — lange Kante
1600px als JPEG, dazu eine Vorschau mit 320px. Ein Blatt wiegt danach rund 250
KB statt mehrerer Megabyte, jede Anfrage trägt genau eine Seite, und der Server
braucht keine Bildbibliothek. Die Vorschau steht als eigene Spalte daneben,
weil die Ablage bis zu zweihundert Bilder auf einmal zeigt: als Vorschauen
sind das rund 3 MB, als Vollbilder wären es rund 50 MB.

**Der Eingangskorb ist die einzige Tür für alles, was nicht von Hand kommt.**
Ein Vorschlag ist kein Datensatz, sondern die Frage, ob einer entstehen soll.
Er hängt zwingend an einem abfotografierten Blatt — was vorgeschlagen wird,
stand auf Papier, das man selbst fotografiert hat. Übernommen wird er durch
dieselbe Tür wie ein Formular: unter einem Aufgaben-Vorschlag steht wörtlich
das Formular von *Neue Aufgabe*, unter einem Termin das von *Neue Klausur*
samt Vorlauf, Tagesbudget und Lernplan. Der Vorschlag füllt Felder vor, mehr
tut er nicht. Und was der Korb kann, geht auch von Hand: unter
*Eingangskorb → Vorschlag von Hand* legt man einen selbst an.

**Der Agent liest und schlägt vor — schreiben kann er nicht.** Nicht
abgeschaltet und nicht hinter einem Scope versteckt: es gibt kein Werkzeug zum
Anlegen, Ändern oder Löschen. Das ist die Bedingung des ganzen Vorhabens, denn
auf einem abfotografierten Arbeitsblatt kann stehen, was will — wer solche
Blätter liest und zugleich schreiben dürfte, wäre über das Blatt selbst
angreifbar. Aus demselben Grund gehören Zettel in die Claude-App und nicht in
eine Claude-Code-Sitzung: dort steht kein Bash und kein Zugriff aufs Repo
daneben.

**Die Noten rechnen ehrlich.** Der Fachschnitt besteht aus zwei Töpfen,
schriftlich und mündlich, gewichtet nach dem, was am Fach eingestellt ist. Ist
ein Topf noch leer, zählt er gar nicht — nicht als Vier und nicht als Null.
Der Gesamtschnitt ist das Mittel der Fachschnitte, jedes Fach einmal;
archivierte Fächer bleiben draußen, ihre Noten aber sichtbar. Und wo eine Zahl
fehlt, steht ein Strich und keine geschätzte.

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
Zuletzt kamen vier Tabellen dazu: `proposals` für den Eingangskorb und
`oauth_clients`, `oauth_codes`, `oauth_tokens` für die Anmeldung des Agenten.
Davor waren es mit der Ablage `materials`, `material_pages` und
`material_topics`. **Ohne Push bleibt nicht nur der jeweilige Bereich stehen,
sondern die ganze Startseite** — sie lädt die letzten Blätter und die Zahl der
offenen Vorschläge mit.

> Bricht `db:push` wegen der Rückfrage unten ab, liegt dieselbe Änderung als
> reines SQL bereit — eine Datei je Stufe:
>
> ```bash
> npx tsx scripts/sql-einspielen.ts scripts/material-tabellen.sql
> npx tsx scripts/sql-einspielen.ts scripts/eingang-tabellen.sql
> ```
>
> Sie ist rein additiv (nur `CREATE TABLE`, die Fremdschlüssel der neuen
> Tabellen und `CREATE INDEX`) und wörtlich aus dem Schema erzeugt — ein
> späteres `db:push` sieht danach keinen Unterschied. Der Server muss dafür aus
> sein, und das Skript weist jede Datei zurück, in der eine Anweisung mit
> `drop`, `truncate`, `delete` oder `update` **beginnt** oder in der irgendwo
> ein `DROP TABLE`, `DROP COLUMN` und ihresgleichen steht. Geprüft wird pro
> Anweisung und erst, nachdem alle Kommentare entfernt sind — `ON DELETE
> cascade` in einem Fremdschlüssel darf deshalb durch.

> **Vorsicht bei einer Rückfrage von `db:push`.** Das Werkzeug kann anbieten,
> die Tabelle `lessons` zu leeren, weil es den eindeutigen Schlüssel
> `lessons_user_slot_key` neu anlegen will. Der Schlüssel **existiert bereits**
> und es gibt keine doppelten Stunden — die Rückfrage ist ein Fehlalarm der
> Schema-Erkennung. Die Antwort ist niemals „truncate": ein Ja löscht den
> ganzen Stundenplan. Bricht der Lauf deswegen ab, lässt sich die eigentliche
> Änderung von Hand als SQL einspielen; welche Tabellen und Spalten es sein
> müssen, steht in `src/db/schema.ts`.

Die lokale Datenbank ist bewusst nicht in Git (`.data/` ist ignoriert). Das
Verzeichnis legt `db:push` selbst an — drizzle-kit tut es nicht und bricht sonst
beim allerersten Lauf mit `ENOENT` ab, bevor die App es je angelegt hat.

**Ein Prozess auf einmal — und das ist keine Empfehlung.** Läuft der
Entwicklungsserver, arbeiten `npm run db:push`, `npm run db:studio` oder eigene
Skripte auf einem Stand, den der Server nicht sieht: was sie schreiben, kommt
bei ihm nie an. Schlimmer ist der Rückweg. Am 21.8.2026 hat ein Skript
nebenher eine Sitzung eingetragen, während der Server lief; danach ließ sich
`.data/pglite` gar nicht mehr öffnen (`RuntimeError: Aborted()`), und es half
nur die Sicherung. Also **erst den Server stoppen, dann die Datenbank
anfassen** — ohne Ausnahme, auch für eine einzelne Zeile. In der Cloud mit
einem echten Postgres entfällt das.

> Nach `Strg-C` bleibt in `.data/pglite` eine `postmaster.pid` liegen: `next
> dev` beendet sich, ohne PGlite noch zu schließen. Das allein ist harmlos —
> eine Kopie mit dieser Datei öffnet sich beim nächsten Mal anstandslos. Sie zu
> löschen repariert deshalb auch nichts, wenn wirklich etwas kaputt ist.

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
Berliner Zeit.

Ausgelöst wird sie von `.github/workflows/erinnerungen.yml` und **nicht** von
`vercel.json`. Der Grund ist eine Grenze des Hobby-Tarifs: dort ist höchstens
ein Cron-Lauf pro Tag erlaubt, und ein stündlicher Ausdruck lässt schon das
Deployment scheitern („Hobby accounts are limited to daily cron jobs"). Einmal
am Tag geht die Rechnung aber nicht auf, weil die Route die passende Stunde
selbst sucht.

Dafür müssen im GitHub-Repo unter *Settings → Secrets and variables → Actions*
zwei Werte stehen: `CRON_SECRET` (dasselbe wie in der Umgebung der App) und
`APP_URL` (die Adresse der laufenden App, ohne Schrägstrich am Ende).

GitHubs Planer ist nicht auf die Minute genau und kann unter Last einige
Minuten spät kommen. Verschiebt sich ein Lauf über die volle Stunde hinaus,
fällt die Erinnerung dieser Stunde aus — sie wird nicht nachgeholt. Für eine
tägliche Lernerinnerung ist das verschmerzbar; wer es genauer braucht, nimmt
den Vercel-Pro-Tarif und trägt den Cron wieder in `vercel.json` ein.

Lokal testest du sie so:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

## Der Agent (Web MCP)

Die App bietet ihre Fähigkeiten als **MCP-Werkzeuge** an, unter
`https://<deine-adresse>/api/mcp`. Ein Agent in Claude ruft sie; die App ruft
nie ein Modell. Deshalb kostet dieser Weg kein API-Guthaben, sondern läuft über
das Abo.

**Dreizehn Werkzeuge, und alle heißen `read_` oder `propose_`:**

| Werkzeug | Was es tut |
|---|---|
| `read_faecher` | Fächer mit Kürzel, Lehrkraft, Raum, Gewichtung |
| `read_stundenplan` | Wochenplan Mo–Fr samt Stundenraster |
| `read_hausaufgaben` | offene (auf Wunsch alle) Aufgaben |
| `read_klausuren` | Termine mit Countdown; mit `id` samt Themen und Lernplan |
| `read_noten` | Gesamtschnitt und Schnitt je Fach |
| `read_themen` | das Themen-Vokabular eines Fachs |
| `read_material` | die abfotografierten Blätter |
| `read_blatt` | ein Blatt samt dem **Foto** einer Seite |
| `read_lernplan` | die Lernblöcke eines Tages |
| `read_eingang` | was schon im Eingangskorb liegt |
| `propose_themen` | Themen für ein Blatt vorschlagen |
| `propose_hausaufgabe` | eine Aufgabe vom Blatt vorschlagen |
| `propose_klausur` | einen Termin vom Blatt vorschlagen |

Es gibt **kein** Werkzeug zum Anlegen, Ändern oder Löschen. Ein `propose_*`
legt eine Karte in den Eingangskorb; wirksam wird sie erst, wenn ein Mensch sie
dort übernimmt.

### In der Claude-App anschließen

1. Die App deployen — sie muss über HTTPS aus dem öffentlichen Netz erreichbar
   sein. Claude verbindet sich aus Anthropics Rechenzentrum heraus, nicht vom
   eigenen Gerät; `localhost` funktioniert dort also **nicht**.
2. In Claude unter *Einstellungen → Connectors* einen eigenen Connector
   hinzufügen und als Adresse `https://<deine-adresse>/api/mcp` eintragen.
3. Claude meldet sich selbst an, schickt dich auf die Zustimmungsseite dieser
   App, und dort meldest du dich mit deinem Passwort an und tippst auf
   *Erlauben*.

Den Zugriff nimmst du in den *Einstellungen* der App unter *Verbundene Agenten*
jederzeit wieder zurück.

### Zum Ausprobieren: Claude Code und curl

Für den Versuch auf dem eigenen Rechner gibt es einen zweiten Weg — einen
festen Token in `MCP_TOKEN`. Er ist nicht für die Claude-App gedacht (die kann
keinen Kopf mitschicken), sondern für Claude Code und für curl:

```bash
# .env.local
MCP_TOKEN=$(openssl rand -base64 32)
```

```bash
claude mcp add --transport http schulapp http://localhost:3000/api/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

Ist `MCP_TOKEN` leer, gibt es diesen Weg nicht — dann bleibt nur OAuth.

### Was unter der Haube passiert

Der Server spricht das Protokoll selbst, ohne SDK, und bedient zwei
Protokoll-Zeitalter nebeneinander: die Revision `2026-07-28` (zustandslos, jede
Anfrage trägt ihre Version im `_meta`, Kopfzeilen werden gegen den Rumpf
geprüft) und die älteren `2025-*` mit `initialize`-Handschlag. GET und DELETE
auf `/api/mcp` antworten mit `405`; Sitzungen gibt es nicht.

Die Anmeldung ist OAuth 2.1 mit PKCE, und die App ist ihr eigener
Autorisierungsserver: `/.well-known/oauth-protected-resource`,
`/.well-known/oauth-authorization-server`, `/api/oauth/register`,
`/oauth/authorize`, `/api/oauth/token`. Es gibt genau einen Scope
(`schulapp`) und kein Client-Geheimnis — ein Geheimnis, das eine fremde App für
uns aufbewahrt, wäre keines.

`APP_URL` braucht es nur, wenn die App unter mehreren Adressen erreichbar ist
oder hinter etwas steht, das Host und Protokoll nicht durchreicht. Sonst liest
der Server die Adresse aus der Anfrage.

> **In der Cloud lohnt es sich trotzdem.** Ohne `APP_URL` stammt auch der
> Vergleichswert der Ursprungsprüfung aus der Anfrage — für den Angriff, gegen
> den sie steht (eine Webseite, die eine Adresse auf den eigenen Rechner
> auflösen lässt), trägt sie dann nur, weil ohnehin ein Token nötig ist. Mit
> `APP_URL` steht auf einer Seite des Vergleichs ein Wert, den keine Anfrage
> bewegen kann.

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

**Noten** — eintragen mit Art (schriftlich oder mündlich), Gewicht und Datum.
Die Übersicht zeigt den Gesamtschnitt und je Fach den Schnitt, aufgeteilt in
schriftlich und mündlich; ein Fach antippen führt zu seinen einzelnen Noten und
zur Frage „was brauche ich noch für eine 2?".

**Material** — Blätter abfotografieren und wiederfinden. Der Auslöser sitzt am
Handy eine Wischgeste links vom Kachelmenü und schlägt das Fach der Stunde vor,
die gerade läuft. Ein Blatt trägt mehrere Seiten, ein Fach, ein Datum, eine
Notiz und beliebig viele Themen aus dem Vokabular seines Fachs. Die Ablage
unter *Material* filtert nach Fach.

**Eingangskorb** — Vorschläge zu einem Blatt, die man übernimmt oder
verwirft. Übernommen wird mit demselben Formular, mit dem man auch von Hand
einträgt; angelegt werden sie von einem Agenten oder von Hand unter
*Vorschlag von Hand*. Entschiedenes bleibt vierzehn Tage stehen.

**Web MCP** — die App bietet ihre Fähigkeiten als Werkzeuge an: zehn zum Lesen,
drei zum Vorschlagen. Ein Agent in Claude verbindet sich über OAuth, liest die
abfotografierten Blätter samt Foto und legt Vorschläge in den Eingangskorb.

Alles steht auch auf der Startseite: als Kachel, in der Tagesspur, auf der
Kameraseite und im Dashboard; wartet etwas im Eingangskorb, steht am Handy ein
schmaler Streifen über den Kacheln und am Rechner eine Zeile in der
Material-Karte. Damit sind alle fünf Ausbaustufen aus KONZEPT.md gebaut. Was
als Nächstes ansteht, steht dort unter *Offene Punkte*.
