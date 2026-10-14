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
- **Probeklausur:** Klausuren und Tests bekommen im Lernplan eine Probeklausur, 45 Minuten, bei genug Vorlauf zwei Tage vorher, sonst einen. Liegt die Klausur am Montag, ist es der Sonntag davor. Ein Wochenendtag ist erlaubt (Test am Dienstag: Probe am Sonntag), Ferien und freie Tage sind sonst ganz frei, die Probe ist die einzige Ausnahme: fällt ihr Tag in Ferien, liegt sie am letzten Ferientag vor der Klausur (Herbstferien bis Sonntag, Klausur am Montag: Probe am Sonntag in den Ferien; Klausur am Donnerstag, Dienstag frei: Probe am freien Dienstag). Lernen und Wiederholen bleiben aus den Ferien draußen. Geht der Tag aus einem anderen Grund nicht, nimmt die App den nächstfrüheren erlaubten Tag, nie einen späteren; nie den Klausurtag, nie einen vergangenen. Nur eine verpasste Probe rückt beim Nachholen auf den Tag vor der Klausur. Ist der Test morgen, ist heute die Probeklausur. Die Unterzeile sagt in Mathematik und Physik „mit Taschenrechner, 45 Minuten“, sonst „ohne Hilfsmittel, 45 Minuten“, und Opus baut das Blatt danach. Auf dem Tisch heißt es „Probeklausur · 45 Minuten“ und „Probeklausur drucken“. Sie ist in jedem Fach ein Arbeitsblatt aus dem Stoff der Klausur und wird ausgewertet wie eins. Bestehende Klausuren bekommen sie, sobald ihr Plan neu berechnet wird („Lernplan neu erstellen“ oder Speichern); eine Probe, die nach der alten Regel am Freitag vor einer Montagsklausur steht, zieht dabei oder beim Nachholen auf den Sonntag, auch wenn der Sonntag in den Ferien liegt. Am Tag der Probe zeigt die Startseite im Ferienmodus ihren Klausurblock, die Erinnerung kommt nur für die Probe; an den übrigen Ferientagen bleibt alles still. Dafür braucht es kein SQL.
- **Wiederholen ohne Klausur:** Themen in Fächern ohne anstehende Klausur oder Test (Englisch, Französisch, alles außerhalb der Epoche) werden weiter abgefragt. Hat eine Frage keinen offenen Termin mehr, legt die App beim Laden der Startseite einen neuen an, 14 Tage nach dem letzten Mal (bei Übungsthemen nach der letzten Blattauswertung). Auf der Startseite steht davon höchstens ein Thema am Tag im Knopf „Wiederholen“, das fälligste. Abfragethemen kommen als Karten, Übungsthemen als Arbeitsblatt. Themen mit Klausur und Themen der Epoche zählen nicht mit, sie kommen alle; auch die Epoche ohne Klausur bekommt den Takt weiter. Steht heute ein Lernblock an, kommt das Thema ohne Klausur nach den übrigen. Wartet ein fälliges Thema nur wegen der Grenze, heißt es nach dem Thema des Tages „Nächstes Thema“ morgen (in den Ferien: der erste Tag danach). Kommt in einem Fach ein Test oder eine Klausur dazu und hat eine Frage dort vor dem Termin nichts mehr offen, rechnet das Nachlegen ihre Termine bis dahin nach (wie „Termine neu rechnen“), damit ein angekündigter Test das Abfragen nicht abschaltet. Bei Übungsthemen zählt für „das fälligste zuerst“ der Termin nach der letzten Blattauswertung, nicht ein älterer davor. Am Ende einer Runde steht auch bei Themen ohne Klausur „Wieder dran“ mit dem Tag, an dem sie wiederkommen (in den Ferien der erste Tag danach). Gleichzeitiges Laden legt keinen Termin doppelt an: das Nachlegen nimmt eine Sperre je Nutzer. In den Ferien kommt nichts. Wer ein Fach selbst öffnet, sieht dort alles Fällige. Dafür braucht es kein SQL. Zum Ausprobieren: nach `saat-startseite.mts` noch `npx tsx scripts/pruef-kombi/saat-dauertakt.mts`.
- **Archiv:** Vergangenes kommt nach zwei Wochen ins Archiv, gelöscht wird nichts. Eine Klausur steht nach ihrem Tag noch bis Tag 14 in der Liste „Klausuren“, unten und blasser, die jüngste zuerst. Ab Tag 15 steht sie im Archiv (der Tag wechselt um 4 Uhr, Berliner Zeit), und die Zeile schlägt sie dann auch nicht mehr vor. Erledigte Hausaufgaben stehen wie bisher zwei Tage unter „Erledigt“, danach im Archiv. Die Zeile findet sie noch zwei Wochen, danach nur noch das Archiv. Am Ende beider Listen steht die Zeile „Archiv“, sobald etwas darin ist. In der Zeile öffnet „archiv“ es auch, als erstes Wort oder allein nach einem Fach; „Geschichte Archiv besuchen“ bleibt eine Aufgabe. Im Archiv öffnet ein Tipp auf eine Aufgabe sie wieder, sie steht dann wieder in „Hausaufgaben“, auch nach dem Zurück auf die Liste darunter. Eine vergangene Klausur zeigt keinen Lernplan-Hinweis, kein „Themen eintragen“ und kein „Termine neu rechnen“ mehr, nur Kopf, Thema, „Stoff und Fragen“ und „Bearbeiten“ (ein Lernplan mit Blöcken bleibt als Rückblick). Dafür braucht es kein SQL. Zum Ausprobieren: nach `saat-startseite.mts` noch `npx tsx scripts/pruef-kombi/saat-archiv.mts`.
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

Die Datenbank auf dem NAS kennt die neuen Tabellen noch nicht. Die sieben Dateien müssen **vor** `nas.sh hoch` hinein, **in genau dieser Reihenfolge**:

1. `scripts/kombi-tagesprotokoll.sql`
2. `scripts/kombi-lernblock-uhr.sql`
3. `scripts/kombi-suche.sql`
4. `scripts/kombi-themen-art.sql`
5. `scripts/kombi-arbeitsblaetter.sql`
6. `scripts/kombi-arbeitsblaetter-checks.sql` (geht nur nach 5)
7. `scripts/kombi-upload-schluessel.sql` (Spalte `material_pages.upload_key`: ein Foto, das der Browser nach verlorener Antwort noch einmal schickt, legt kein zweites Blatt an. Wiederholbar.)

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

## Was offen ist

- **Dein Durchklicken am Handy.** Geprüft haben bisher nur Tests, Agenten und Playwright. Fehler, die man nur in der Hand merkt, fehlen noch. Bitte hell und dunkel, mit echter Kamera und mit Drucken.
- **Drucken in der installierten Android-App** (`window.print()`) ist ungeprüft. Notfalls geht der Weg über das PDF.
- **Kleinigkeiten aus dem Prototyp:** Morgens rutscht eine abgehakte Abgabe unter die andere. Auf kleinen Handys steht „Gelöstes Blatt fotografieren“ erst nach Scrollen im Bild. Ein Suchmenü mit nur einem Treffer hat viel Leerfläche.
- **„Gelöstes Blatt fotografieren“** ist noch „bald“. Eine automatische Korrektur gibt es nicht.
- **Die eigene Saat `saat-kombi.mts`** aus dem Plan gibt es nicht. Stattdessen gibt es `scripts/pruef-kombi/saat-startseite.mts` und `saat-zeile.mts`.
- **Noch nicht gepusht:** Der Branch liegt nur auf dem Mac.

## Deine Antworten

Offene Fragen gibt es keine mehr. Beantwortet am 12.10. (1 bis 3), am 13.10. (4 bis 11) und am 14.10. (12):

1. Am Rechner keine Handyspalte, Inhalt mittig bis 680px.
2. Kein Hell/Dunkel-Umschalter.
3. Ein ausgewertetes Arbeitsblatt zählt wie eine Kartenrunde.
4. Die Probeklausur kommt als neue Art in den Lernplan, gebaut wie oben.
5. Grammatik bleibt am Stichwort erkannt und von Hand umstellbar, das Blatt richtet sich nach der Sprache des Fachs, gebaut wie oben.
6. Themen ohne Klausur werden trotzdem regelmäßig abgefragt, gebaut wie oben („Wiederholen ohne Klausur“).
7. Ja: Arbeitsblätter für Übungsthemen und Lernblöcke von heute und morgen werden vorab gebaut, höchstens eins je Thema und Tag. Gebaut.
8. Dir egal, gewählt ist der Vorschlag: Fachfarben bleiben gespeichert und stehen nur im Fach-Formular.
9. Ja: auf den NAS erst nach deinem Durchklicken am Handy.
10. So lassen: Antworten zwischen 0 und 4 Uhr zählen beim Speichern zum neuen Tag, in der Anzeige zum alten.
11. Vergangenes kommt nach zwei Wochen ins Archiv, gebaut wie oben („Archiv“).
12. Probeklausur (14.10.): Test morgen heißt heute Probe, so lassen; Klausur am Montag heißt Probe am Sonntag, ein Wochenendtag ist erlaubt; in Mathematik und Physik mit Taschenrechner; auf dem Tisch heißt sie Probeklausur. Gebaut wie oben.
13. Probeklausur nach Ferien (14.10.): „ne am letzten tag von den ferien“. Reichen Ferien bis direkt vor die Klausur, liegt die Probe am letzten Ferientag, nicht am letzten Schultag davor. Nur die Probe darf in die Ferien. Gebaut wie oben.
