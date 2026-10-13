# Modell 23 in der App

Stand: 13.10.2026, Branch `modell-23`. Noch nicht auf dem NAS, noch nicht in `main`.

## Was jetzt in der App ist

Die App sieht aus und verhält sich wie der Prototyp „Kombi V2“. Alle Abschnitte A bis H sind gebaut:

- **Startseite nach Tageszeit:** Morgens siehst du, was heute abgegeben wird und was in die Tasche muss. Nach der Schule kommt der Ablauf, sonst der Überblick. Oben rechts öffnet das Zahnrad die Einstellungen.
- **Nach der Schule:** Kamera öffnen, Blatt fotografieren. Du wählst kein Fach, Jev ordnet ein. „Seite dazu“ hängt eine Seite an. Danach trägst du die Hausaufgaben ein.
- **Die Zeile unten:** eintragen und suchen in einem Feld, dazu der Kameraknopf. Was du tippst, wird eine Aufgabe, oder du findest damit Blätter und Themen.
- **Wiederholen nach Themen:** auf dem blauen Tisch, ein Thema am Stück, das fälligste zuerst. Der Takt der Wiederholung ist unverändert.
- **Lernblock und Klausur:** Lernblock mit Uhr und Pause, ohne Startzeit. Der Lernplan steht auf der Klausurseite.
- **Arbeitsblätter:** Für Übungsthemen (Mathe, Grammatik) baut die App ein druckbares Blatt mit Lösungsblatt. Danach sagst du, wie es lief. Das zählt wie eine Kartenrunde.
- **Alle alten Seiten** gibt es weiter, im neuen Stil: Noten, Klausuren, Ablage, Fächer, Stundenplan, Eingangskorb, Einstellungen, Kalender, Push.
- Hell und Dunkel richten sich nach dem Handy. Den Umschalter gibt es nicht mehr.

## Lokal ausprobieren

Den Entwicklungsserver vorher ausschalten.

```bash
npm run db:backup
mv .data/pglite .data/pglite-alt        # frische Datenbank
npm run db:push                          # legt alle Tabellen an, auch die neuen
npx tsx scripts/saat-abruf.mts           # Konto „Probe“, Passwort probe1234
npx tsx scripts/pruef-kombi/saat-startseite.mts   # Beispieldaten wie im Prototyp
npm run build && SCHULAPP_TESTUHR=1 npx next start -p 3100
```

Dann im Browser `http://localhost:3100` öffnen und mit „Probe“ anmelden. Die Uhr stellst du so:

- `http://localhost:3100/api/testuhr?jetzt=2026-10-12T07:10` für morgens
- `…?jetzt=2026-10-12T14:10` für nach der Schule, `…T20:30` für abends
- `…/api/testuhr?reset` für die echte Uhr

Wenn du deine alte lokale Datenbank zurück willst: Server aus, `.data/pglite` löschen, `.data/pglite-alt` zurück umbenennen.

Am Handy geht die Kamera nur über HTTPS. Dafür auf dem Mac `tailscale funnel 3100` starten und die Funnel-Adresse in Chrome öffnen. Immer mit der Probe-Datenbank, nie mit der vom NAS.

## Auf den NAS: SQL zuerst, dann hochfahren

**Nur zusammen mit dem IServ-Ferienabgleich** (Branch `iserv-ferien`, abgezweigt von `modell-23`). Die Ferien-Seite gibt es in Modell 23 nicht mehr (dein Wunsch vom 12.10.). Der Abgleich holt Ferien und unterrichtsfreie Tage selbst aus IServ und trägt sie als freie Tage ein. Ohne ihn könnte niemand Ferien eintragen, und die App würde in den Ferien Lernblöcke planen.

**Vor dem Push** wird der ganze Branch nach echten Namen und Schuldaten durchsucht, weil das Repo öffentlich ist. Gepusht wird erst nach deinem Ja.

Die Datenbank auf dem NAS kennt die neuen Tabellen noch nicht. Die sieben Dateien müssen **vor** `nas.sh hoch` hinein, **in genau dieser Reihenfolge**:

1. `scripts/kombi-tagesprotokoll.sql`
2. `scripts/kombi-lernblock-uhr.sql`
3. `scripts/kombi-suche.sql`
4. `scripts/kombi-themen-art.sql`
5. `scripts/kombi-arbeitsblaetter.sql`
6. `scripts/kombi-arbeitsblaetter-checks.sql` (geht nur nach 5)
7. `scripts/kombi-iserv-ferien.sql` (Ferien aus IServ: zwei Spalten an `free_periods`)

Jede Datei einzeln so (Dateinamen austauschen):

```bash
sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec -T db sh -c "exec psql -X -v ON_ERROR_STOP=1 --single-transaction -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f -" < repo/scripts/kombi-tagesprotokoll.sql'
```

Vorher sichern. Im Kopf jeder Datei steht, was du vorher und nachher zählen sollst.

Ablauf im Ganzen:

1. `modell-23` in `main` mischen und pushen. `nas.sh hoch` holt nur `main`.
2. Auf dem NAS das Repo aktualisieren, damit die SQL-Dateien unter `repo/scripts/` liegen.
3. Die sieben SQL-Dateien einspielen, wie oben.
4. `scripts/nas.sh hoch`. Es hält an, wenn eine Datei fehlt.
5. `/api/tag/stand` aufrufen, dann am Handy öffnen. Die App lädt einmal neu.
6. Eine Aufgabe über die Zeile eintragen und abhaken. Dann im Google-Kalender „Schule“ nachsehen.
7. Ferien prüfen: **Vor** dem Einspielen von `kombi-iserv-ferien.sql` die von Hand eingetragenen Ferien zählen, die noch kommen (seit dem 4.10. gab es die Ferienseite, für die Herbstferien steht also wahrscheinlich schon eine Zeile da):
   ```sql
   SELECT kind, title, starts_on, ends_on FROM free_periods
    WHERE kind IN ('ferien', 'frei') AND ends_on >= current_date ORDER BY starts_on;
   ```
   Diese Zeilen bleiben stehen; der Abgleich fasst sie nie an. Nach dem nächsten Abruf bei IServ (der Kalender-Lauf fragt höchstens alle drei Stunden, zwischen 6 und 21 Uhr) stehen die Ferien unter Einstellungen › IServ › „Freie Tage“, mit „aus IServ“, die alten Zeilen daneben mit „von Hand eingetragen“. In „Schule“ stehen die Herbstferien trotzdem genau einmal: Eine Hand-Zeile, deren Tage die IServ-Ferien ganz abdecken, fällt in Google weg (und umgekehrt). Nur eine Hand-Zeile, die über die IServ-Ferien hinausragt, bliebe als zweiter Balken — dann ist sie wohl falsch eingetragen; löschen lässt sie sich nur per SQL (`DELETE FROM free_periods WHERE id = '…' AND quelle IS NULL`, vorher `npm run db:backup` bzw. Sicherung). Die Zählzeilen dazu stehen im Kopf von `kombi-iserv-ferien.sql`. Wer nicht warten will: `UPDATE iserv_state SET last_attempt_at = NULL` und dann `kalender.sh`.

## Was offen ist

- **Dein Durchklicken am Handy.** Geprüft haben bisher nur Tests, Agenten und Playwright. Fehler, die man nur in der Hand merkt, fehlen noch. Bitte hell und dunkel, mit echter Kamera und mit Drucken.
- **Drucken in der installierten Android-App** (`window.print()`) ist ungeprüft. Notfalls geht der Weg über das PDF.
- **Kleinigkeiten aus dem Prototyp:** Morgens rutscht eine abgehakte Abgabe unter die andere. Auf kleinen Handys steht „Gelöstes Blatt fotografieren“ erst nach Scrollen im Bild. Ein Suchmenü mit nur einem Treffer hat viel Leerfläche.
- **„Gelöstes Blatt fotografieren“** ist noch „bald“. Eine automatische Korrektur gibt es nicht.
- **Die eigene Saat `saat-kombi.mts`** aus dem Plan gibt es nicht. Stattdessen gibt es `scripts/pruef-kombi/saat-startseite.mts` und `saat-zeile.mts`.
- **Noch nicht gepusht:** Der Branch liegt nur auf dem Mac.

## Fragen, die deine Entscheidung brauchen

Bis zu deiner Antwort gilt der Vorschlag. Antwort etwa „4 ja, 6 nein“.

4. **„Probeklausur“ im Lernplan:** weglassen oder als neue Art einführen? *Vorschlag: weglassen.*
5. **Grammatik erkennen:** Die App erkennt Grammatik an Stichwörtern im Thementitel, du kannst es von Hand umstellen. Passt das? *Vorschlag: ja.*
6. **Fragen ohne Klausur** (Französisch, Epoche): Solche Themen erscheinen nur, solange sie Termine haben. Willst du das später getrennt entscheiden? *Vorschlag: ja, nicht in diesem Bau.*
7. **Arbeitsblätter vorab bauen:** für Übungsthemen und Lernblöcke von heute und morgen, höchstens eins je Thema und Tag. Jedes Blatt ist ein Opus-Aufruf. *Vorschlag: ja.*
8. **Fachfarben:** bleiben gespeichert, werden aber nirgends mehr gezeigt. *Vorschlag: ja.*
9. **Wann auf den NAS:** erst nach deinem Durchklicken am Handy? *Vorschlag: ja.*
10. **Üben nach Mitternacht:** Antworten zwischen 0 und 4 Uhr zählen beim Speichern zum neuen Tag, in der Anzeige zum alten. *Vorschlag: so lassen.*
11. **Vergangenes:** Vergangene Klausuren stehen in derselben Liste, erledigte Hausaufgaben bleiben 2 Tage sichtbar. *Vorschlag: ja, wie der Prototyp.*

Die Fragen 1 bis 3 hast du am 12.10. schon beantwortet: volle Breite am Rechner, kein Hell/Dunkel-Umschalter, und ein ausgewertetes Arbeitsblatt zählt wie eine Kartenrunde.
