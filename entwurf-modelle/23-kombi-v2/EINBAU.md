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
- **Grammatikblatt in der Sprache des Fachs:** Ein Grammatikthema in Englisch gibt ein Blatt auf Englisch, in Französisch auf Französisch, in Deutsch auf Deutsch. Kurze Arbeitsanweisungen auf Deutsch dürfen dabeistehen. In der Zeile öffnet „Blatt Grammatik Englisch“ das Blatt zum fälligsten Englisch-Grammatikthema, „Blatt Grammatik“ das fälligste überhaupt. Weitere Themen stehen darunter zur Wahl. Ist keins heute fällig und gibt es mehrere Sprachen, fragt die Zeile „In welcher Sprache?“. Dafür braucht es kein SQL.
- **Probeklausur:** Klausuren und Tests bekommen im Lernplan eine Probeklausur, 45 Minuten, bei genug Vorlauf zwei Tage vorher, sonst einen. Fällt der Tag aufs Wochenende oder einen freien Tag, nimmt die App den Schultag davor. Sie ist in jedem Fach ein Arbeitsblatt aus dem Stoff der Klausur und wird ausgewertet wie eins. Bestehende Klausuren bekommen sie, sobald ihr Plan neu berechnet wird („Lernplan neu erstellen“ oder Speichern). Dafür braucht es kein SQL.
- **Wiederholen ohne Klausur:** Themen in Fächern ohne anstehende Klausur oder Test (Englisch, Französisch, alles außerhalb der Epoche) werden weiter abgefragt. Hat eine Frage keinen offenen Termin mehr, legt die App beim Laden der Startseite einen neuen an, 14 Tage nach dem letzten Mal (bei Übungsthemen nach der letzten Blattauswertung). Auf der Startseite steht davon höchstens ein Thema am Tag im Knopf „Wiederholen“, das fälligste. Abfragethemen kommen als Karten, Übungsthemen als Arbeitsblatt. Themen mit Klausur und Themen der Epoche zählen nicht mit, sie kommen alle; auch die Epoche ohne Klausur bekommt den Takt weiter. Steht heute ein Lernblock an, kommt das Thema ohne Klausur nach den übrigen. Wartet ein fälliges Thema nur wegen der Grenze, heißt es nach dem Thema des Tages „Nächstes Thema“ morgen (in den Ferien: der erste Tag danach). Kommt in einem Fach ein Test oder eine Klausur dazu und hat eine Frage dort vor dem Termin nichts mehr offen, rechnet das Nachlegen ihre Termine bis dahin nach (wie „Termine neu rechnen“), damit ein angekündigter Test das Abfragen nicht abschaltet. Bei Übungsthemen zählt für „das fälligste zuerst“ der Termin nach der letzten Blattauswertung, nicht ein älterer davor. Am Ende einer Runde steht auch bei Themen ohne Klausur „Wieder dran“ mit dem Tag, an dem sie wiederkommen (in den Ferien der erste Tag danach). Gleichzeitiges Laden legt keinen Termin doppelt an: das Nachlegen nimmt eine Sperre je Nutzer. In den Ferien kommt nichts. Wer ein Fach selbst öffnet, sieht dort alles Fällige. Dafür braucht es kein SQL. Zum Ausprobieren: nach `saat-startseite.mts` noch `npx tsx scripts/pruef-kombi/saat-dauertakt.mts`.
- **Archiv:** Vergangenes kommt nach zwei Wochen ins Archiv, gelöscht wird nichts. Eine Klausur steht nach ihrem Tag noch bis Tag 14 in der Liste „Klausuren“, unten und blasser, die jüngste zuerst. Ab Tag 15 steht sie im Archiv (der Tag wechselt um 4 Uhr, Berliner Zeit). Erledigte Hausaufgaben stehen wie bisher zwei Tage unter „Erledigt“, danach im Archiv. Die Zeile findet sie noch zwei Wochen, danach nur noch das Archiv. Am Ende beider Listen steht die Zeile „Archiv“, sobald etwas darin ist. In der Zeile öffnet „archiv“ es auch, als erstes Wort oder allein nach einem Fach; „Geschichte Archiv besuchen“ bleibt eine Aufgabe. Im Archiv öffnet ein Tipp auf eine Aufgabe sie wieder, sie steht dann wieder in „Hausaufgaben“, auch nach dem Zurück auf die Liste darunter. Eine vergangene Klausur zeigt keinen Lernplan-Hinweis, kein „Themen eintragen“ und kein „Termine neu rechnen“ mehr, nur Kopf, Thema, „Stoff und Fragen“ und „Bearbeiten“ (ein Lernplan mit Blöcken bleibt als Rückblick). Dafür braucht es kein SQL. Zum Ausprobieren: nach `saat-startseite.mts` noch `npx tsx scripts/pruef-kombi/saat-archiv.mts`.
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

**Erst wenn der IServ-Ferienabgleich gebaut ist.** Die Ferien-Seite gibt es in Modell 23 nicht mehr (dein Wunsch vom 12.10.). Die Ferien sollen künftig von selbst aus IServ kommen. Bis das gebaut ist, könnte niemand Ferien eintragen, und die App würde in den Ferien Lernblöcke planen.

**Vor dem Push** wird der ganze Branch nach echten Namen und Schuldaten durchsucht, weil das Repo öffentlich ist. Gepusht wird erst nach deinem Ja.

Die Datenbank auf dem NAS kennt die neuen Tabellen noch nicht. Die sechs Dateien müssen **vor** `nas.sh hoch` hinein, **in genau dieser Reihenfolge**:

1. `scripts/kombi-tagesprotokoll.sql`
2. `scripts/kombi-lernblock-uhr.sql`
3. `scripts/kombi-suche.sql`
4. `scripts/kombi-themen-art.sql`
5. `scripts/kombi-arbeitsblaetter.sql`
6. `scripts/kombi-arbeitsblaetter-checks.sql` (geht nur nach 5)

Jede Datei einzeln so (Dateinamen austauschen):

```bash
sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec -T db sh -c "exec psql -X -v ON_ERROR_STOP=1 --single-transaction -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f -" < repo/scripts/kombi-tagesprotokoll.sql'
```

Vorher sichern. Im Kopf jeder Datei steht, was du vorher und nachher zählen sollst.

Ablauf im Ganzen:

1. `modell-23` in `main` mischen und pushen. `nas.sh hoch` holt nur `main`.
2. Auf dem NAS das Repo aktualisieren, damit die SQL-Dateien unter `repo/scripts/` liegen.
3. Die sechs SQL-Dateien einspielen, wie oben.
4. `scripts/nas.sh hoch`. Es hält an, wenn eine Datei fehlt.
5. `/api/tag/stand` aufrufen, dann am Handy öffnen. Die App lädt einmal neu.
6. Eine Aufgabe über die Zeile eintragen und abhaken. Dann im Google-Kalender „Schule“ nachsehen.

## Was offen ist

- **Dein Durchklicken am Handy.** Geprüft haben bisher nur Tests, Agenten und Playwright. Fehler, die man nur in der Hand merkt, fehlen noch. Bitte hell und dunkel, mit echter Kamera und mit Drucken.
- **Drucken in der installierten Android-App** (`window.print()`) ist ungeprüft. Notfalls geht der Weg über das PDF.
- **Kleinigkeiten aus dem Prototyp:** Morgens rutscht eine abgehakte Abgabe unter die andere. Auf kleinen Handys steht „Gelöstes Blatt fotografieren“ erst nach Scrollen im Bild. Ein Suchmenü mit nur einem Treffer hat viel Leerfläche.
- **„Gelöstes Blatt fotografieren“** ist noch „bald“. Eine automatische Korrektur gibt es nicht.
- **Die eigene Saat `saat-kombi.mts`** aus dem Plan gibt es nicht. Stattdessen gibt es `scripts/pruef-kombi/saat-startseite.mts` und `saat-zeile.mts`.
- **Noch nicht gepusht:** Der Branch liegt nur auf dem Mac.

## Fragen, die deine Entscheidung brauchen

Bis zu deiner Antwort gilt der Vorschlag. Antwort etwa „4 ja, 6 nein“.

7. **Arbeitsblätter vorab bauen:** für Übungsthemen und Lernblöcke von heute und morgen, höchstens eins je Thema und Tag. Jedes Blatt ist ein Opus-Aufruf. *Vorschlag: ja.*
9. **Wann auf den NAS:** erst nach deinem Durchklicken am Handy? *Vorschlag: ja.*
10. **Üben nach Mitternacht:** Antworten zwischen 0 und 4 Uhr zählen beim Speichern zum neuen Tag, in der Anzeige zum alten. *Vorschlag: so lassen.*

Die Fragen 1 bis 3 hast du am 12.10. schon beantwortet: volle Breite am Rechner, kein Hell/Dunkel-Umschalter, und ein ausgewertetes Arbeitsblatt zählt wie eine Kartenrunde. Frage 4 am 13.10.: die Probeklausur kommt als neue Art in den Lernplan, gebaut wie oben. Frage 5 am 13.10.: Grammatik bleibt am Stichwort erkannt und von Hand umstellbar, das Blatt richtet sich nach der Sprache des Fachs, gebaut wie oben. Frage 6 am 13.10.: Themen ohne Klausur werden trotzdem regelmäßig abgefragt, gebaut wie oben („Wiederholen ohne Klausur“). Frage 8 am 13.10.: dir egal, gewählt ist der Vorschlag: Fachfarben bleiben gespeichert und stehen nur im Fach-Formular. Frage 11 am 13.10.: Vergangenes kommt nach zwei Wochen ins Archiv, gebaut wie oben („Archiv“).
