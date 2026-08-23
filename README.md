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
| `npm test` | 309 Tests in 56 Suiten — die reine Rechnung: Lernplan, Datumsrechnung, Stundenplan, Fälligkeiten, Notenskala, Themen-Titel, Bildmaße, die Zahlen der Startseite, das Formular der Ablage, die Vorbelegung aus einem Vorschlag und die Verteilung der Fehlermeldungen |
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
                      und Datum; [id] zeigt eins mit allen seinen Seiten,
                      eingang/ ist der Eingangskorb — was noch keiner
                      durchgesehen hat, und die Vorschläge dazu
      faecher/        Fächer mit Farbe, Kürzel und Gewichtung
      einstellungen/  Erinnerungen, Darstellung, Konto
    api/
      material/       liefert die Bilder aus: /api/material/<seite> das
                      Vollbild, .../vorschau die Vorschau
      push/, cron/    Anmeldung der Geräte und der stündliche Anstoß
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
                    Themen daran, dazu der Filter nach einem Thema;
                    Titelvorschlag und Formular getestet
    inbox.ts        der Eingangskorb: was noch keiner durchgesehen hat, die
                    Vorschläge dazu und die Vorbelegung des Handformulars
                    daraus (getestet)
    form-errors.ts  wo eine zod-Meldung landet — unter ihrem Feld oder über
                    dem ganzen Formular (getestet)
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

**Der Eingangskorb ist die einzige Tür in den Bestand.** Ein frisch
aufgenommenes Blatt heißt „Blatt vom 21.8." und trägt kein Thema — es liegt im
Korb (`materials.filed_at` ist leer), bis jemand hingesehen hat. Daneben liegen
Vorschläge: ein Fach, ein Titel, ein Tag, eine Notiz, Themen — jedes Feld darf
fehlen, und leer heißt überall „das bleibt, wie es am Blatt steht" — mit einer
Ausnahme: wechselt ein Vorschlag das Fach, fallen die Themen des Blattes weg,
weil sie dem Vokabular des alten Fachs gehören. Ein
Vorschlag ändert nichts. Übernehmen heißt: dasselbe Handformular wie überall
sonst, vorbelegt und Feld für Feld änderbar, und erst der Knopf darunter
schreibt — durch dieselbe Prüfung (`materialInputSchema`) und dieselbe
Datenschicht wie ein von Hand ausgefülltes Formular. Deshalb lässt sich alles,
was ein Agent später vorschlagen wird, heute schon von Hand anlegen und ändern;
alle Vorschläge, die es gibt, sind genau so entstanden.

**„Was habe ich zur Kettenregel?"** beantwortet die Ablage: `?thema=…` neben
`?fach=…`, eine zweite Chip-Zeile mit den Themen des gewählten Fachs, und die
Themen eines Blattes sind im Kopf seiner Seite antippbar. Ein Thema gehört zu
genau einem Fach — damit bestimmt das Thema das Fach, und wenn in der Adresse
beides steht und sich widerspricht, gewinnt das Thema. Die Zahl in der
Themenpflege („3 Blätter") und der Filter rechnen dabei mit demselben
SQL-Ausdruck über `coalesce(merged_into, id)` — sie meinen also dieselbe Menge
Blätter. Die Liste zeigt davon höchstens `LIST_LIMIT` und sagt es, wenn sie an
dieser Grenze steht; die Zahl daneben ist ungedeckelt und damit die größere,
sobald ein Thema über zweihundert Blätter trägt.

**Die Noten rechnen ehrlich.** Der Fachschnitt besteht aus zwei Töpfen,
schriftlich und mündlich, gewichtet nach dem, was am Fach eingestellt ist. Ist
ein Topf noch leer, zählt er gar nicht — nicht als Vier und nicht als Null.
Der Gesamtschnitt ist das Mittel der Fachschnitte, jedes Fach einmal;
archivierte Fächer bleiben draußen, ihre Noten aber sichtbar. Und wo eine Zahl
fehlt, steht ein Strich und keine geschätzte.

## Datenbank

**Seit dem 23.8.2026 liegt die Datenbank in der Cloud** — ein Postgres bei Neon
in Frankfurt. Die App läuft unter `schulapp-teal.vercel.app`, und `DATABASE_URL`
steht sowohl in der Vercel-Umgebung als auch lokal in `.env.local`.

Dass sie **auch beim Entwickeln** gilt, ist Absicht und keine Bequemlichkeit:
liefe `npm run dev` weiter gegen die Datei-Datenbank, gäbe es zwei Bestände.
Eine Hausaufgabe, am Laptop eingetragen, käme am Handy nie an — und gemerkt
hätte man es erst, wenn sie in der Schule fehlt.

Ohne `DATABASE_URL` fällt dieselbe App auf **PGlite** zurück: ein echtes
Postgres, das als Datei unter `.data/pglite` im Projekt liegt. Kein Server,
keine Installation, dieselbe SQL-Sprache. Der Anwendungscode merkt vom
Unterschied nichts. Der alte lokale Stand liegt dort unberührt weiter; wer ihn
wieder benutzen will, nimmt `DATABASE_URL` aus `.env.local` heraus.

```bash
DATABASE_URL=postgres://user:pass@host/db
```

Die Zugangsdaten gehören in `.env.local` und nirgendwo sonst — `.env*` ist in
`.gitignore`, und `.vercelignore` hält `.data/` und `.backups/` vom Hochladen
fern. Der Umzug selbst lief über `scripts/daten-umzug.ts`.

Nach Änderungen an `src/db/schema.ts` immer `npm run db:push` ausführen. Mit
der Ablage kamen die drei Tabellen `materials`, `material_pages` und
`material_topics` dazu, mit dem Eingangskorb die Spalte `materials.filed_at`
und die beiden Tabellen `material_proposals` und `material_proposal_topics`. **Ohne Push bleibt nicht nur der Materialbereich
stehen, sondern die ganze Startseite** — sie lädt die letzten Blätter mit.

> Bricht `db:push` wegen der Rückfrage unten ab, liegt dieselbe Änderung als
> reines SQL bereit:
>
> ```bash
> npx tsx scripts/sql-einspielen.ts scripts/material-tabellen.sql   # die Ablage
> npx tsx scripts/sql-einspielen.ts scripts/eingangskorb-tabellen.sql
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

Die lokale Datenbank ist bewusst nicht in Git (`.data/` ist ignoriert).

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

Dafür muss im GitHub-Repo unter *Settings → Secrets and variables → Actions*
ein Wert stehen: `CRON_SECRET`, dasselbe wie in der Umgebung der App. Und zwar
als **Repository secret** — ein *Environment secret* sieht dieser Workflow
nicht, weil sein Job keiner Umgebung zugeordnet ist.

Die Adresse der App steht dagegen im Klartext in `erinnerungen.yml`. Sie war
einmal ein zweites Secret, und genau daran ist der erste Lauf gescheitert: war
`APP_URL` nicht gesetzt, rief `curl` die Route ohne Host auf und brach mit Exit
3 ab — im Protokoll stand nur „Process completed with exit code 3", was nach
einem kaputten Workflow aussieht und keiner war. Ein Geheimnis war die Adresse
ohnehin nie; sie steht auf jedem Handy in der Adressleiste. Wer die App
woanders betreibt, überschreibt sie mit einem Secret oder einer Variablen
namens `APP_URL`, ohne die Datei anzufassen.

GitHubs Planer ist nicht auf die Minute genau und kann unter Last einige
Minuten spät kommen. Verschiebt sich ein Lauf über die volle Stunde hinaus,
fällt die Erinnerung dieser Stunde aus — sie wird nicht nachgeholt. Für eine
tägliche Lernerinnerung ist das verschmerzbar; wer es genauer braucht, nimmt
den Vercel-Pro-Tarif und trägt den Cron wieder in `vercel.json` ein.

Lokal testest du sie so:

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

**Noten** — eintragen mit Art (schriftlich oder mündlich), Gewicht und Datum.
Die Übersicht zeigt den Gesamtschnitt und je Fach den Schnitt, aufgeteilt in
schriftlich und mündlich; ein Fach antippen führt zu seinen einzelnen Noten und
zur Frage „was brauche ich noch für eine 2?".

**Material** — Blätter abfotografieren und wiederfinden. Der Auslöser sitzt am
Handy eine Wischgeste links vom Kachelmenü und schlägt das Fach der Stunde vor,
die gerade läuft. Ein Blatt trägt mehrere Seiten, ein Fach, ein Datum, eine
Notiz und beliebig viele Themen aus dem Vokabular seines Fachs. Die Ablage
unter *Material* filtert nach Fach **und nach Thema**.

**Eingangskorb** — unter *Material → Eingangskorb*. Darin liegt, was
aufgenommen, aber noch nicht durchgesehen wurde, und jeder Vorschlag, der auf
eine Entscheidung wartet. Abhaken, Vorschlag von Hand anlegen und ändern,
verwerfen — und übernehmen, mit dem vollen Handformular und einer
Gegenüberstellung dessen, was der Vorschlag am Blatt ändern würde. Der Weg
dorthin steht in der Ablage immer und auf der Startseite dann, wenn wirklich
etwas wartet.

Alles steht auch auf der Startseite: als Kachel, in der Tagesspur, auf der
Kameraseite und im Dashboard. Damit sind die vier geplanten Ausbaustufen aus
KONZEPT.md gebaut und von der fünften die ersten drei — das Themen-Vokabular,
die Ablage und der Eingangskorb. Was noch fehlt, ist der Weg für einen Agenten
(Web MCP). Wie er angestoßen wird, ist entschieden und steht in KONZEPT.md: von
Hand, in der Claude-App.
