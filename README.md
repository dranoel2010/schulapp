# Schulapp

Eine Schul-App für **einen** Menschen. Stundenplan, Hausaufgaben, Klausuren mit
einem Lernplan, der sich selbst schreibt, Noten — und eine Kamera, die Zettel
frisst.

Sie läuft auf einem NAS im eigenen Heimnetz und ist von jedem Gerät dieselbe.
Kein Konto für andere, keine Freigaben, keine Klassen: was hier steht, steht für
eine Person.

Was gebaut wird und warum, steht in [KONZEPT.md](KONZEPT.md).

## Wie es benutzt wird

Wer wissen will, was diese App tut, liest diesen Abschnitt. Alles darunter ist
für den, der sie baut.

### Der Zettel

Das Herzstück, und der Grund für fast alles, was seit dem 21. August dazukam:
**ein Blatt fotografieren und nie wieder einsortieren müssen.**

1. **Wischen und tippen.** Am Handy liegt links von der Startseite die Kamera —
   nicht eine Seite mit einem Knopf, sondern das laufende Bild. Darauf steht
   nichts als das Fach, ein Kreis und die Zahl dessen, was angekommen ist. Ein
   Antipper ist ein Blatt, und die Kamera bleibt offen: fünf Zettel aus einer
   Epoche sind fünf Antipper.

2. **Es landet im Eingangskorb.** Verkleinert wird schon im Browser, dreifach:
   das Vollbild zum Ansehen, ein Vorschaubild für die Listen und eine
   Lesefassung für den Agenten. Das Fach ist dabei geraten — aus dem
   Stundenplan, sonst aus dem zuletzt fotografierten Blatt — und steht sichtbar
   auf dem Kamerabild.

3. **Jemand liest — je Seite genau einer.** Gleich nach dem Hochladen schickt
   die App jede Seite durch Docling, eine Texterkennung auf dem NAS. Ist das
   sauberer Druck, ist die Seite damit gelesen. Den Rest — Handschrift,
   Formeln, alles Unsichere — liest Claude: Läuft [der Postbote](harness/README.md),
   schaut er alle 15 Sekunden in den Korb, **schreibt diese Seiten wörtlich ab**,
   schlägt Titel und Tag vor und vermerkt in einer Notiz, was er **nicht**
   sicher weiß. Fach und Themen bestimmt danach Jev (siehe
   [Jev ordnet ein](#jev-ordnet-ein--seit-dem-4102026-ohne-eingangskorb)).

4. **Ein Druck.** Im Korb steht der Vorschlag mit Fach, Titel, Themen, Notiz und
   der Abschrift. *Übernehmen* schreibt ihn ans Blatt und hakt es ab. *Erst
   ansehen* führt zu einem Formular, in dem sich alles noch ändern lässt, samt
   Gegenüberstellung dessen, was sich ändern würde. *Verwerfen* wirft ihn weg.

### Die Abschrift

Seit dem 5.9.2026 bleibt nicht nur das Foto, sondern auch **der Text darauf**.
Das ist der Unterschied zwischen einem Bilderstapel und einer Ablage, in der man
suchen kann.

Wo das Modell sich nicht sicher war, steht die Stelle in ⟨spitzen Klammern⟩ —
und genau die zeigt das Formular hervorgehoben an, mit der Zahl daneben. Man
korrigiert also nicht den ganzen Text, sondern die drei Stellen, an denen es
darauf ankommt. Die Zahl zählt beim Tippen mit; wenn sie auf null steht, ist man
fertig.

**Gedrucktes liest die App selbst** (seit dem 6.10.2026). Eine solche Seite
trägt den Vermerk „maschinell gelesen (Docling)" — am Blatt, im Korb, im PDF
und im Wiki —, und sie hat **keine** spitzen Klammern: Docling weiß nicht, wo
es unsicher war. Gegengelesen hat sie niemand. Wer ihren Text im Formular
ändert, macht daraus eine Abschrift von Hand, und der Vermerk geht. Wann die
App selbst liest und wann Claude, steht unter
[Ein Leser je Seite](#ein-leser-je-seite--die-app-entscheidet).

**Leer und ungelesen sind zweierlei.** Eine Seite, auf der wirklich nichts steht,
ist gelesen. Eine, die zu unscharf war, ist es nicht und kommt nach einem
besseren Foto wieder dran. Die App hält das an jeder Stelle auseinander — im
Formular, im PDF und im Wiki.

Aus dieser einen gespeicherten Abschrift entstehen die beiden Ausgaben:

- **Ein PDF je Fach.** Ein Knopf auf der Fachseite legt alle Blätter des Fachs
  zu einem Dokument zusammen, nach Thema gegliedert, jedes mit Foto und sauber
  gesetztem Text. Zum Lernen am Stück lesbar, zum Ausdrucken.
- **Eine tägliche Übergabe ans Wiki.** Einmal am Tag legt die App ihren ganzen
  Bestand als Markdown in einen Ordner, aus dem ein eigener Agent ihn in ein
  Obsidian-Vault einordnet. Die App ordnet dabei **nicht** selbst ein — sie
  liefert flach und beschriftet ab. Mehr unter [Die Wiki-Übergabe](#die-wiki-übergabe).

**Der Agent ändert nie etwas selbst.** Er darf lesen und vorschlagen, sonst
nichts — kein Anlegen, kein Löschen, kein Bestätigen. Die letzte Entscheidung
trifft immer ein Mensch. Und was auf einem Blatt steht, ist für ihn Inhalt und
niemals eine Anweisung: eine Aufforderung auf dem Papier landet als Beobachtung
in der Notiz und wird nicht befolgt.

**Ohne Postboten funktioniert alles genauso**, nur trägt man Fach, Titel und
Themen dann selbst ein — im Korb oder direkt am Blatt.

### Der Alltag

| Bereich | Was er tut |
|---|---|
| **Stundenplan** | Festes Wochenraster Mo–Fr, ein Feld antippen bearbeitet es. Das Stundenraster ist einstellbar. Für Waldorfschulen trägt *Epoche wechseln* den Hauptunterricht in einem Zug auf ein anderes Fach um. |
| **Hausaufgaben** | Liste zum Abhaken, überfällige zuerst. Eine neue Aufgabe ist von sich aus zur nächsten Stunde ihres Fachs fällig. Abgehaktes wird ausgeblendet, nie gelöscht. |
| **Klausuren** | Termin mit Themen eintragen — den Lernplan schreibt die App: Blöcke über die Tage davor verteilt, mit Tagesbudget über alle Klausuren hinweg. Verpasst man einen Tag, fragt sie nach, statt still umzuplanen. |
| **Noten** | Eintragen mit Art, Gewicht und Datum. Schnitt gesamt und je Fach, getrennt nach schriftlich und mündlich — und die Frage, die kein Zeugnis beantwortet: *was brauche ich noch für eine 2?* |
| **Material** | Die Ablage aller Blätter, filterbar nach Fach **und** Thema. |
| **Erinnerung** | Eine Push-Nachricht am Tag, wenn etwas ansteht. |

Die Lernblöcke haben **bewusst keine Uhrzeit**. Die App sagt, was heute dran
ist, nicht wann — sie ist kein Tagesplaner.

### Auf dem Handy und am Rechner

Am Handy hat die Startseite drei Seiten, zwischen denen man wischt: **links die
Kamera, in der Mitte das Kachelmenü, rechts der Tagesablauf.** Am Rechner steht
stattdessen ein Dashboard mit denselben Zahlen. Umgeschaltet wird allein über
die Fensterbreite.

Die App lässt sich über Chrome installieren und liegt danach wie eine richtige
App auf dem Startbildschirm.

## Erster Start

Zum Entwickeln ist nur Node.js nötig (getestet mit Version 24) — kein Docker und
kein Datenbankserver. Im Betrieb ist beides im Spiel: dort läuft die App seit dem
30.8.2026 in zwei Containern auf einem NAS, siehe [Betrieb](#betrieb).

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
| `npm test` | 1022 Tests in 206 Suiten (Stand 5.10.2026) — die reine Rechnung: Lernplan, Datumsrechnung, Stundenplan, Fälligkeiten, Notenskala, Themen-Titel, Bildmaße, die Zahlen der Startseite, das Formular der Ablage, die Vorbelegung aus einem Vorschlag, die Verteilung der Fehlermeldungen, die angehakten Felder des Epochenwechsels — für den Web MCP die Rückadressen, PKCE, der Rückweg nach dem Anmelden, der Umschlag des Protokolls, die Auflösung von Fach und Thema und der Werkzeugkasten — und seit der Abschrift die ⟨spitzen Klammern⟩, die Auslegung der Formularfelder, die Deckung der beiden Schriften, der Bildkopf, der Dateiname und die Markdown-Verpackung feindlichen Textes — und für den Google Kalender die Entscheidungstabelle des Abgleichs, die Event-IDs, das Ende ganztägiger Termine, die Verschlüsselung des Refresh Tokens, PKCE, die Einordnung jeder Fehlerantwort von Google, die Queue der Abgleiche, der Fehlersatz ohne die Parameter einer gescheiterten Abfrage und der ganze Abgleich gegen eine Attrappe von Google |
| `npm run lint` | ESLint |

## Aufbau

```
src/
  app/
    (auth)/         Einrichtung, Anmeldung und Zustimmung — ohne Navigation
      verbinden/      „Claude mit deiner Schulapp verbinden?" — die eine
                      Stelle, an der ein Zugang für einen Agenten entsteht
    (app)/          alles hinter der Anmeldung
      page.tsx        Start: am Handy drei wischbare Seiten — Kamera,
                      Kachelmenü, Tagesspur —, am Rechner das Dashboard
      stundenplan/    das Wochenraster Mo–Fr; ein Feld antippen
                      bearbeitet es, zeiten/ stellt das Stundenraster ein,
                      epoche/ trägt den Hauptunterricht auf ein anderes Fach um
      hausaufgaben/   Liste zum Abhaken, anlegen und ändern
      lernen/         der Lernplan — abhaken, Fortschritt, Countdown
      abruf/          Fragen aus den eigenen Blättern, in festem Takt wieder
                      vorgelegt: sitzung/ ist der Abend selbst, bausteine/
                      der Bestand und bausteine/neu/ das Anlegen von Hand.
                      Die Musterlösung wird NICHT mit der Seite ausgeliefert
                      — sie kommt erst nach dem abgeschickten Versuch zurück
      klausuren/      Termine eintragen und ändern
      noten/          Schnitt je Fach und gesamt, eintragen und ändern;
                      fach/ zeigt ein Fach mit allen seinen Noten
      material/       die Ablage: abfotografierte Blätter mit Fach, Themen
                      und Datum; [id] zeigt eins mit allen seinen Seiten,
                      eingang/ ist der Eingangskorb — was noch keiner
                      durchgesehen hat, und die Vorschläge dazu
      faecher/        Fächer mit Farbe, Kürzel und Gewichtung
      einstellungen/  Erinnerungen, Ferien, Google Kalender, Darstellung, Konto,
                      verbundene Programme
    .well-known/      wo ein Agent diese App findet: die Beschreibung des
                      geschützten Servers und die des Ausstellers
    api/
      mcp/            der MCP-Server — eine Adresse, zwölf Werkzeuge
      oauth/          Anmeldung eines Programms und der Tausch von Code
                      gegen Token
      material/       liefert die Bilder aus: /api/material/<seite> das
                      Vollbild, .../vorschau die Vorschau; stand/ der
                      Fingerabdruck, an dem Ablage, Blatt, Korb und
                      Vorschlag merken, dass sie nachladen müssen
      google/         „Mit Google verbinden": connect/ springt per POST zu
                      Google, callback/ nimmt die Zustimmung entgegen
      push/, cron/    Anmeldung der Geräte, der stündliche Anstoß für die
                      Erinnerungen und den Google Kalender (cron/kalender)
                      und die tägliche Übergabe ans Wiki
    layout.tsx      Wurzel: Schriften, Metadaten, Service Worker,
                    hell/dunkel
    manifest.ts     PWA-Manifest
  components/
    ui/             Bausteine: Button, Input, Field, Card, EmptyState
    nav/            Navigation
    home/           die vier Ansichten der Startseite: Kamera, Kachelmenü
                    und Tagesspur am Handy, Dashboard am Rechner. Die
                    Kameraseite läuft nur, wenn sie vorn ist
    study/          Lernblock und Nachfrage bei verpassten Tagen
    homework/       das Kästchen zum Abhaken, überall gleich
    grades/         die Fachzeile mit Schnitt, Balken und Fachfarbe
    material/       die Kamera: laufendes Bild, Standbild einfrieren,
                    verkleinern, Seite für Seite hochladen
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
    transcripts.ts  die Abschrift auf dem Bildschirm: die ⟨spitzen Klammern⟩
                    des Agenten finden, kürzen, und die Formularfelder
                    benennen und wieder auslesen — reine Rechnung, ohne
                    Datenbank, damit das Kamera-Formular sie importieren
                    darf (getestet)
    inbox.ts        der Eingangskorb: was noch keiner durchgesehen hat, die
                    Vorschläge dazu und die Vorbelegung des Handformulars
                    daraus (getestet)
    oauth.ts        der eigene kleine OAuth-Server: Anmeldung eines
                    Programms, Zustimmungs-Codes, Token und die
                    Verbindungen, die in den Einstellungen stehen (getestet)
    mcp/
      protocol.ts   der Umschlag: JSON-RPC, die zwei Zeitalter des
                    Protokolls, Begrüßung und Auskunft (getestet)
      tools.ts      der Werkzeugkasten — je Werkzeug ein zod-Schema, aus
                    dem auch das Verzeichnis entsteht (getestet)
      resolve.ts    „Mathe" ist ein Fach: id, Name oder Kürzel, und eine
                    Rückfrage, wenn es mehrere sein könnten (getestet)
      run.ts        was die Werkzeuge tun — auf derselben @/lib wie die
                    Oberfläche
    pdf/
      subject-pdf.ts  das Fach-PDF von der Datenbank bis zu den Bytes: die
                    eine Tür zwischen Route und Dokument, samt den Grenzen
                    für Blätter und Bilddaten (getestet)
      subject-document.ts  der Satz selbst — Fach → Thema → Blatt, jedes
                    Blatt mit Foto und Abschrift; rechnet nichts aus, was
                    nicht hereingereicht wurde, und ist deshalb ohne
                    Datenbank prüfbar (getestet)
      fonts.ts      Geist setzen, DejaVu auffangen: laden, einstellen und
                    den Text zeichenweise auf beide verteilen (getestet)
      font-coverage.ts  welche Zeichen eine Schriftdatei wirklich zeichnen
                    kann — aus ihrer cmap gelesen, nicht geraten (getestet)
      image-info.ts Format und Maße eines Fotos aus den Bytes, weil pdfkit
                    nur JPEG und PNG einbetten kann (getestet)
      filename.ts   wie die Datei heißt, die dabei herauskommt, und was von
                    dem Namen übrig bleibt, wenn nur ASCII erlaubt ist
                    (getestet)
    wiki/
      run.ts        der Lauf: vergleichen, schreiben, und erst danach die
                    Abdrücke festhalten — die Reihenfolge ist die ganze
                    Sicherung dieser Stufe
      collect.ts    was hineinkommt: der Bestand eines Nutzers, vollständig
                    — was hier fehlt, gilt als gelöscht
      documents.ts  aus einer Datenbankzeile wird eine Datei: flach, mit
                    der festen Kennung „<art>-<uuid>" (getestet)
      markdown.ts   die Schicht, die feindlichen Text einpackt — kurze
                    Werte maskiert, freier Text im Codeblock (getestet)
      manifest.ts   der Übergabeschein, den der Agent zuerst liest, in
                    Klartext und nicht als JSON (getestet)
      folder.ts     das Schreiben: versteckter Ordner, dann ein Umbenennen
                    — der einzige Ort, an dem die App Dateien anlegt
                    (getestet)
      deliveries.ts das Gedächtnis der Übergabe: die Tabelle
                    `wiki_deliveries`
      example.ts    ein erfundener, absichtlich bösartiger Bestand — die
                    Probe ohne Datenbank
    calendar/       der Google Kalender — eine Einbahnstraße von der App in
                    einen eigenen Kalender „Schule"
      config.ts     die Umgebung: Client, Schlüssel, Redirect URI (getestet)
      token-crypto.ts  das Refresh Token, mit AES-256-GCM verschlossen
                    (getestet)
      events.ts     aus einer Zeile wird ein ganztägiger Termin, dazu die
                    feste Event-ID mit Generation (getestet)
      plan.ts       die Entscheidungstabelle: anlegen, ändern, löschen — oder
                    nie wieder, weil der Nutzer gelöscht hat (getestet)
      execute.ts    die Schritte gegen Google, ohne Datenbank-Import —
                    durchgespielt gegen eine Attrappe von Google (getestet)
      google-oauth.ts  Anmeldung bei Google: PKCE, Code-Tausch, Refresh,
                    Revoke — per fetch, ohne SDK (getestet)
      google-api.ts sechs Aufrufe der Calendar API, Wiederholen und die
                    Einordnung jeder Fehlerantwort (getestet)
      report.ts     was die Karte und der Cron sagen (getestet)
      error-text.ts ein Fehler als Satz, ohne die Parameter einer
                    gescheiterten Abfrage (getestet)
      sources.ts    woher die Termine kommen — eine Quelle ist eine Funktion
      store.ts      die zwei Tabellen
      queue.ts      die Queue: ein Lauf zur Zeit, und wer wartet, wartet nicht
                    ewig (getestet)
      sync.ts       der Lauf und der Cron
      connect.ts    Verbinden, Trennen, Kalender neu anlegen
    cron-auth.ts    die eine Prüfung des CRON_SECRET für alle drei Cron-Türen
                    (getestet)
    form-errors.ts  wo eine zod-Meldung landet — unter ihrem Feld oder über
                    dem ganzen Formular (getestet)
    theme.ts        hell, dunkel oder dem Gerät überlassen

  recall/         der Abrufkern — ein Paket im Haus, kein Ordner daneben
    schema.ts       drei eigene Tabellen mit Präfix `recall_`; src/db/schema.ts
                    bleibt unberührt, weil das der Vertrag ist und dies eine
                    Wette (g = 0,095 gegen ein gut geführtes Heft, n. s.)
    schedule.ts     wann ein Baustein wieder drankommt: fester Takt, harter
                    Klausurtermin, zwei Betriebsarten — und ausdrücklich kein
                    lernender Algorithmus (g = 0,034 bei I² = 0 %) (getestet)
    items.ts        anlegen, auflisten, zurückziehen — und die Tür, an der die
                    Quellbindung durchgesetzt wird: das Zitat muss wörtlich in
                    der Abschrift stehen und darf keine ⟨Klammern⟩ enthalten
    sessions.ts     der Abend: was fällig ist, der Versuch, das Urteil. Ein
                    Termin schließt nur bei einem korrekten Abruf — was
                    danebengeht, kommt noch am selben Abend wieder
    source.ts       die EINZIGE Stelle, an der der Kern in den Bestand der
                    Schulapp sieht. Wird er herausgelöst, ist es diese Datei
    grenzen.test.ts hält genau das fest — kein .tsx im Kern, nur vier erlaubte
                    Importe, kein Schreiben in fremde Tabellen (getestet)

harness/          der Postbote — gehört NICHT zur App, sondern benutzt sie
  zugang.mts        einmal zustimmen, danach ein eigener Zugang
  postbote.mts      alle 15 Sekunden nachsehen und Claude ansetzen
  nachlese.mts      schreibt Blätter nach, die längst eingeordnet sind —
                    kein zweiter Dienst, sondern ein Lauf auf Zuruf
  kaefig.mts        der Lauf ohne Bash, ohne Dateien, ohne fremde Server
  auftrag.mts       was Claude an einem Blatt tun soll
  mcp.mts           der Draht zur App: ein MCP-Client aus fetch und sonst
                    nichts, dazu der eigene Zugang in zugang.json
  sperre.mts        immer nur einer — zwei Läufe auf derselben zugang.json
                    nehmen einander das Erneuerungs-Token
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

**Die Kamera ist eine Wischgeste weit weg — und sie ist die Seite selbst.** Am
Handy hat die Startseite drei Seiten: links die Kamera, in der Mitte das
Kachelmenü, rechts die Tagesspur. Der Weg zur Kamera ist damit die
Wischrichtung, in der nicht der Tagesablauf steht.

Auf dieser linken Seite steht nichts als das laufende Kamerabild, das Fach, ein
Kreis und die Zahl dessen, was angekommen ist. Ein Antipper ist ein Blatt, und
die Kamera bleibt offen: fünf Zettel aus einer Epoche sind fünf Antipper.
Gemessen: dreimal getippt in 129 ms, alle drei Blätter nach 1,0 s in der
Datenbank. Der Auslöser wartet nicht auf die Leitung — aufgenommen wird sofort,
hochgeladen wird eines nach dem anderen in einer Schlange dahinter.

**Zwei Sätze, die hier bis Ende August standen, stimmen nicht mehr, und beide
sind an derselben Stelle gescheitert.** Der erste hieß, nach der Aufnahme bleibe
der Auslöser stehen und darunter erscheine das Blatt im Raster der letzten
Aufnahmen. Das war die richtige Antwort auf die Frage „wie kommt man zum
zweiten Foto" — solange das Gerät nach jedem Bild die Kamera zuklappte. Es
löste aber nur die Hälfte: die Kamera ging trotzdem jedes Mal neu auf.

Der zweite hieß, das Kachelraster habe „deshalb keine siebte Kachel bekommen".
Es hat jetzt eine — „Blätter", über beide Spalten. Sie musste kommen, als die
Kameraseite nur noch Kamera wurde: dort standen vorher der Weg in die Ablage
und der in den Eingangskorb, und beide hielten genau den auf, der zum
Fotografieren gewischt hat. Navigation gehört ins Kachelmenü. Es ist eine
Kachel und nicht zwei, und sie zeigt dorthin, wo wirklich etwas zu tun ist:
liegt etwas im Korb, führt sie in den Korb und trägt die Warnfarbe; sonst in
die Ablage.

**Das Fach wird vermutet, nicht erfragt.** Vorschlag ist die Stunde, die gerade
läuft; sonst das Fach des zuletzt aufgenommenen Blattes; sonst das einzige
aktive. Vorher endete diese Kette bei „dann wähl es selbst", und die Kamera ging
nicht auf, bevor das geschehen war — abends, wenn der Stundenplan schweigt,
stand also vor jedem Foto ein Auswahlfeld. Jetzt steht die Vermutung sichtbar
auf dem Kamerabild, ist mit einem Antipper zu ändern, und wenn sie falsch ist,
schlägt der Postbote das richtige Fach vor, sobald er das Blatt liest. Eine
Vermutung, die man sieht und die sich später korrigiert, ist besser als ein
Formular vor der Kamera.

Am Rechner bleibt alles beim Alten: dort zeigte dieselbe Abfrage die Webcam über
dem Bildschirm, und die ist auf kein Blatt zu richten. `(pointer: coarse)`
entscheidet, und wo es nicht zutrifft — oder wo die Kamera verweigert wird —
steht der gewohnte Auslöser mit Knopf und Galerie.

**Die Blätter liegen in der Datenbank, nicht in einem Speicherdienst.** Ein
Foto steht als `bytea` neben allen anderen Daten; `npm run db:backup` sichert
es mit, es braucht keinen zweiten Zugang und kein Token, und lokal wie in der
Cloud läuft derselbe Code. Verkleinert wird schon im Browser — lange Kante
1600px als JPEG, dazu eine Vorschau mit 320px und eine Lesefassung mit 1000px
für den Agenten. Eine Seite wiegt mit allen drei Fassungen zusammen rund 250
bis 400 KB statt mehrerer Megabyte (an zwei Testblättern gemessen: 165 + 69 + 14
und 212 + 89 + 19 KB), jede Anfrage trägt genau eine Seite, und der Server
braucht keine Bildbibliothek. Jede der drei Größen steht als eigene Spalte da, weil jede
einen eigenen Leser hat: die Ablage zeigt bis zu zweihundert Vorschauen auf
einmal (rund 3 MB; als Vollbilder wären es rund 50 MB), die Detailseite ein
Vollbild, und der Agent bekommt die Lesefassung, weil ein Werkzeug-Ergebnis
bei rund 150 000 Zeichen endet.

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
Datenschicht wie ein von Hand ausgefülltes Formular. Deshalb ließ sich alles,
was der Agent heute vorschlägt, schon von Hand anlegen und ändern, bevor es ihn
gab — und sein Werkzeug `propose_sheet` geht durch dieselbe Tür. Woher ein
Vorschlag kam, steht an ihm (`origin`), und der Korb schreibt es dazu.

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

## Der Web MCP

Die App bietet ihre Fähigkeiten als Werkzeuge an, und ein Agent in der
Claude-App benutzt sie. Das ist die vierte Stufe von Phase 5 — der Weg, auf dem
aus einem abfotografierten Blatt ein Vorschlag wird, ohne dass jemand tippt.

**Verbinden** (einmal, am Rechner):

1. In der Claude-App unter *Customize → Connectors* auf *+* und
   *Add custom connector*.
2. Als Adresse `https://<deine-app>/api/mcp` eintragen.
3. Claude schickt dich auf die Zustimmungsseite dieser App. Dort steht, was das
   Programm lesen darf und was es schreiben darf — *Erlauben* drücken.

Danach steht die Verbindung auch am Handy: Connectors gelten für das Konto,
nicht für das Gerät. Was verbunden ist, steht unter *Einstellungen →
Verbundene Programme* und lässt sich dort trennen.

Bist du beim Zustimmen nicht angemeldet, führt der Weg über `/login` und von
dort zurück auf dieselbe Seite (`?weiter=`) — sonst stündest du nach dem
Anmelden auf der Startseite, während in der Claude-App ein Fenster auf eine
Antwort wartet.

**Die Werkzeuge.** Elf lesen, eines schreibt:

| Werkzeug | Was es liefert |
|---|---|
| `read_subjects` | Fächer mit Kürzel, Lehrkraft, Raum, Gewichtung |
| `read_topics` | das Themen-Vokabular eines Fachs mit der Zahl der Blätter |
| `read_timetable` | Wochenplan und Stundenraster |
| `read_homework` | Hausaufgaben, offene zuerst |
| `read_exams` | Klausuren mit Lernplan-Fortschritt; einzeln mit allen Themen |
| `read_grades` | Gesamtschnitt und Schnitt je Fach; einzeln mit allen Noten |
| `read_material` | die Ablage, gefiltert nach Fach und Thema |
| `read_sheet` | ein Blatt mit allen Seiten |
| `read_page` | das Foto einer Seite, als Bild zum Lesen |
| `read_transcript` | dasselbe Blatt als Text: die Abschrift je Seite — leer heißt gelesen und es stand nichts darauf, `null` heißt, es hat noch niemand gelesen |
| `read_inbox` | Eingangskorb: was wartet und welche Vorschläge daran hängen |
| `propose_sheet` | legt einen Vorschlag in den Eingangskorb |

Ein Fach darf dabei beim Namen genannt werden — „Mathe" genügt. Passt der Name
auf mehrere Fächer, fragt das Werkzeug zurück, statt eines zu raten.

**Was der Agent nicht kann, und zwar mit Absicht:** anlegen, ändern, löschen —
und auch keinen Vorschlag übernehmen. Er legt Vorschläge in den Eingangskorb;
übernommen werden sie von Hand, im selben Formular wie immer, durch dieselbe
Prüfung wie ein von Hand ausgefüllter Vorschlag. Wer nicht vertrauenswürdige
Blätter liest und gleichzeitig schreiben darf, ist über das Blatt selbst
angreifbar; deshalb gibt es diese Werkzeuge nicht.

**Das Foto hat eine eigene Größe.** Ein Werkzeug-Ergebnis endet in der
Claude-App bei rund 150 000 Zeichen, und ein Bild reist als Base64 — aus drei
Bytes werden vier Zeichen. Das Vollbild (1600px, gemessen 165 KB) käme nicht
durch, die Vorschau (320px) wäre unlesbar. Deshalb liegt an jeder Seite eine
dritte Fassung mit 1000 Pixeln, gerechnet im Browser wie die anderen beiden
(an zwei Testblättern gemessen: 69 und 89 KB, also 94 000 bis 121 000 Zeichen).
Der Server braucht dafür keine Bildbibliothek. Wiegt eine Seite trotz der
Qualitätsleiter mehr als 105 000 Bytes, sagt `read_page` das geradeheraus (und nennt die Größe wie überall in der App binär, also „103 KB“), statt ein
Ergebnis zu schicken, das unterwegs abgeschnitten wird.

**Der Zugang läuft über OAuth**, weil die Claude-App für einen selbst gebauten
Anschluss nichts Einfacheres anbietet, das man verantworten kann. Die App ist
dabei ihr eigener Aussteller: `/.well-known/oauth-protected-resource/api/mcp`
(und, für Clients, die es andersherum versuchen, dieselbe Beschreibung an der
Wurzel) und `/.well-known/oauth-authorization-server` beschreiben sie, `/api/oauth/register`
meldet ein Programm an, `/verbinden` fragt den Menschen, `/api/oauth/token`
tauscht. Ein Zugriffs-Token gilt eine Stunde und für genau eine Adresse; das
Erneuerungs-Token wird bei jedem Gebrauch gegen ein neues getauscht, dessen
Vierteljahr wieder von vorn läuft — eine Verbindung, die in Gebrauch ist, läuft
also nie ab. Gespeichert werden von beiden nur die Abdrücke. Wer ein
verbrauchtes Erneuerungs-Token noch einmal vorzeigt, verliert die ganze
Verbindung: das ist entweder ein Client, der eine Antwort verloren hat, oder
jemand, der das Token gestohlen hat, und beides beantwortet OAuth gleich.

**Zum Ausprobieren am eigenen Rechner** braucht es einen Tunnel: Claude verbindet
sich aus der Cloud, `localhost` erreicht es nie.

## Der Postbote — vom Foto bis zum Vorschlag ohne Handgriff

Wer nicht jedes Mal selbst in der Claude-App fragen will, lässt `harness/`
laufen: ein kleines Programm auf dem eigenen Rechner, das alle 15 Sekunden in
den Eingangskorb sieht und Claude auf jedes Blatt ansetzt, das noch keinen
Vorschlag hat.

```bash
npx tsx harness/zugang.mts     # einmal zustimmen
npx tsx harness/postbote.mts   # laufen lassen
```

Es gehört ausdrücklich **nicht zur App**: was Claude abschreibt, schreibt es
außerhalb ab. Welche Seiten das sind, entscheidet seit dem 6.10.2026 die App —
sauberen Druck liest sie selbst mit Docling, der Postbote bekommt den Rest
(siehe [Ein Leser je Seite](#ein-leser-je-seite--die-app-entscheidet)). Er
benutzt sie von außen, durch dieselbe Tür wie die
Claude-App, mit eigener Zustimmung und eigenem Trennen-Knopf in den
Einstellungen. Er läuft über Claude Code und damit über das Abo — kein
API-Schlüssel, keine Rechnung.

Der Lauf, in den ein fremdes Blatt gerät, ist dabei leer geräumt: `--tools ""`
nimmt die eingebauten Werkzeuge weg, `--strict-mcp-config` alle anderen Server.
Übrig bleiben die Werkzeuge dieser App, gemessen und nachgezählt. Warum das
nötig ist und was sonst noch dahintersteht, steht in
[harness/README.md](harness/README.md).

### Jev ordnet ein — seit dem 4.10.2026 ohne Eingangskorb

Ziel: ein Foto machen, sonst nichts. Legt der Postbote seinen Vorschlag an,
entscheidet die App gleich danach mit **Jev** (TypeSafe, ein Entscheidungsmodell,
das keinen Text schreibt) über Fach und Themen und übernimmt den Vorschlag
samt Titel, Notiz und Abschrift — durch dieselbe Tür wie der Knopf
„Übernehmen" (`applyProposal()` in `src/lib/inbox-apply.ts`). Der Agent darf
weiterhin nur vorschlagen; übernommen wird von der App.

Im Korb bleibt ein Blatt nur noch, wenn das nicht geht: `TYPESAFE_API_KEY`
fehlt, Jev antwortet nicht, oder auf dem Blatt ist fast nichts lesbar (eine
reine Skizze). Und ein Blatt, das schon abgelegt ist, fasst Jev nie an — die
Nachlese schickt Abschriften durch dieselbe Tür.

**Nachgereichte Seiten.** Hängt jemand an ein schon eingeordnetes Blatt eine
Seite an — oder kommt eine Seite dazu, während der Postbote das Blatt gerade
liest —, entscheidet die App auch für sie, wer liest. Liest Docling, steht die
Abschrift gleich da. Liest Claude, holt der Postbote sie von selbst nach, und
die App übernimmt die reine Abschrift ohne Jev und ohne Rückfrage. Welche Seite
als nachgereicht gilt, bestimmt die App (`nachgereichtUngelesen()` in
`src/lib/materials.ts`): ungelesen an einem eingeordneten Blatt, und dann nach
`leser` — „claude" immer, „offen" und „docling" nie (die liest die App selbst),
und eine Seite von vor dem 6.10.2026 (`leser` leer) wie bis dahin: nach dem
Einordnen hochgeladen oder jünger als eine schon abgeschriebene Seite desselben
Blattes. Die fünfzehn Altblätter vom August haben keine abgeschriebene Seite,
ihre Seiten sind alle älter als das Einordnen, und sie bleiben damit außen vor —
und schreibt ein Lauf ihre alten Seiten trotzdem mit ab, bleibt der Vorschlag
für einen Menschen im Korb (`onlyTranscribesAttachedPages()` in `src/lib/auto-file.ts`).
Dasselbe gilt für eine von Hand gestartete Nachlese.

**Reihenfolge auf dem NAS.** Der neue Auftrag des Postboten lässt das Fach
weg, weil Jev es bestimmt. Deshalb kommt `harness/` erst aufs NAS, wenn dort
`TYPESAFE_API_KEY` in der App ankommt und Jev antwortet — sonst bekäme ein
Blatt gar keinen Fachvorschlag. `scripts/jev-und-docling.sh` hält diese
Reihenfolge ein: Es fragt Jev aus dem App-Container heraus
(`scripts/nas-probe-jev.mjs`) und stellt den Postboten nur um, wenn die
Antwort stimmt.

Gemessen vor dem Einbau an 20 abgelegten Blättern: 19 Mal dasselbe Fach wie
der Mensch, und das zwanzigste war falsch abgelegt. Den Ausschlag gaben die
bisherigen Themen als Hinweis an jedem Fach. Je Blatt zwei Anfragen, etwa eine
halbe Sekunde, Kosten weit unter einem Hundertstel Cent.

Der Schlüssel gehört in die `.env` auf dem NAS und muss im Container ankommen.
Lokal steht er in `.env.local`.

### Ein Leser je Seite — die App entscheidet

Seit dem 6.10.2026 liest jede Seite genau **ein** Leser, und welcher, entscheidet
die App. Bis dahin las jede Seite zweimal: Docling rechnete sie für den
Postboten vor (`read_docling`), und Claude schrieb sie danach trotzdem ganz vom
Foto ab, mit Doclings Text als Vorlage — wer was übernimmt, entschied ein Satz im
Prompt. Das kostete Kontingent für Text, der schon dastand, und die
Entscheidung lag dort, wo sie niemand prüfen kann.

- **Docling** (IBM, offen, ein eigener Container auf dem NAS) liest jede neue
  Seite genau einmal, angestoßen von der App gleich nach dem Hochladen. Sein
  Rohtext bleibt in `material_pages.docling_text` und wird nie neu gerechnet.
- Ist das **sauberer Druck**, wird er die Abschrift der Seite — gekennzeichnet,
  und Claude sieht diese Seite nie.
- **Alles andere liest Claude**, über den Postboten, vom Foto und ohne Vorlage:
  Handschrift, Formeln, Seiten mit wenig Text und jede Seite, über die die App
  nicht entscheiden kann.

**Die Regel** steht in `src/lib/leser/regel.ts`, billig zuerst, und jede Stufe
kann nur zu Claude schicken, nie zu Docling:

| | Docling liest allein, wenn … | sonst steht in `leser_grund` |
|---|---|---|
| a | Docling Erfolg meldet und der Text nicht leer ist | `nicht-erfolg`, `leer` |
| b | mindestens 60 Wörter aus mindestens drei Buchstaben dastehen | `zu-wenig-woerter` |
| c | nichts nach einer Formel aussieht: `$`, `formula-not-decoded`, ein LaTeX-Befehl, `=` `≤` `≥` `√` `^` `²` `³`, ein Buchstabe direkt vor einer Ziffer (`x3`) oder vor `(` (`f(x)`), ein Strich (`f'`) | `formel` |
| d | die Abschrift in eine Seite passt (8 000 Zeichen) | `zu-lang` |
| e | Jev den Text mit mindestens 0,5 für „überwiegend richtig geschriebene, sinnvolle Wörter und Sätze" hält | `jev-unsicher` |

Ein Wörterbuch gibt es nicht. Ob sauberer Druck oder Kauderwelsch aus
Handschrift, entscheidet Jev; die Regel davor hält nur fern, wo ein Lesefehler
teuer wäre — in einer Formel ist ein verlesenes Vorzeichen zitierfähig — oder wo
es nichts zu entscheiden gibt. Die Formelmuster sind keine Theorie: an einem
gerenderten Arbeitsblatt fehlte Docling zweimal der Strich in `f'(x)`, und aus
`x³` wurde `x3`. Und Jev bekommt den Text erst, wenn a bis d bestanden sind —
der OCR-Text einer Handschriftseite geht meistens an gar kein Modell.

**Jeder Fehler heißt Claude, und nichts wartet:** Docling nicht eingerichtet,
in der Pause, im Zeitablauf oder mit einem Fehler (`docling-fehlt`,
`docling-pause`, `docling-ausfall`, `docling-fehler`), Jev nicht eingerichtet
oder nicht erreichbar (`jev-fehlt`, `jev-fehler`). Wiederholt wird kein
Fehlschlag von Docling oder Jev; eine Seite, die Claude bekommen hat, bleibt
bei Claude. Die eine Ausnahme ist ein Fehler der Zuteilung selbst, nach dem die
Seite nicht einmal für Claude festgehalten werden konnte — meist war die
Datenbank kurz weg: die Seite ruht dann zehn Minuten und bekommt einen neuen
Versuch, statt bis zum nächsten Neustart auf `offen` zu hängen.

Zwei Gründe stehen nur in Randfällen da: `schon-gelesen` — die Seite hatte
eine Abschrift von Hand oder von Claude, bevor die App entschied, also fragt
sie Docling gar nicht erst (oder schreibt Doclings Abschrift nicht mehr, wenn
jemand während der Rechnung getippt hat); `nachgeholt` — Doclings Abschrift
stand schon, nur die Entscheidung fehlte nach einem Abbruch, und Docling
rechnet nicht ein zweites Mal.

**Gemessen** an 37 echten Seiten vom 5.10.2026 — von Hand als gedruckt,
gemischt oder Handschrift bestimmt, Docling gegen Claudes Abschrift verglichen:
Jev ≥ 0,5 und mindestens 60 Wörter ließen 12 Seiten Docling allein, keine davon
falsch; mit dem Formelverdacht dazu sind es 11. „Falsch" hieße: keine reine
Druckseite, oder Docling trifft weniger als 80 % von Claudes Wörtern. Am
6.10.2026 durch den eingebauten Code selbst nachgerechnet, mit echter Frage an
Jev: 11 Seiten, alle gedruckt, keine falsch, die knappste mit Jev 0,56; Jev wich
von den Werten des Vortags um höchstens 0,04 ab. Abgelehnt wurden 20 an der
Wortzahl, 3 am Formelverdacht und 3 von Jev. Die Schwellen sind an genau diesen
Seiten gewählt, zwei davon dasselbe Handout zweimal fotografiert — was sie im
Betrieb taugen, zeigt erst `leser_grund`.

Wer die Regel ändert, erhöht `REGEL_VERSION` und misst vorher an denselben
Seiten nach — durch genau `leserWaehlen()` aus `src/lib/leser/zuteilung.ts`,
ohne Text auszugeben. Seiten und Messskript liegen bewusst **außerhalb** des
Repos: es sind Schülerseiten, und ein Skript im Repo, das sie mit dem
Jev-Schlüssel an Jev schickt, wäre eine Einladung, genau das zu tun. Für die
Abnahme reichen Jevs Werte aus der Messung; neu gefragt wird Jev dafür nicht.

**Was an einer Seite steht** (`material_pages`, angelegt von
`scripts/leser-tabellen.sql`):

| Spalte | heißt |
|---|---|
| `leser` | `offen` — die App entscheidet gerade, Claude bekommt die Seite nicht; `docling` — Docling liest allein; `claude` — Claude liest vom Foto; leer (`NULL`) — eine Seite von vor dem 6.10.2026, gelesen wie bisher |
| `leser_grund` | Regelfassung, Wortzahl, Formelverdacht, Länge der Abschrift, Jevs Wahrscheinlichkeit, Doclings Rechenzeit — und der Grund aus der Tabelle oben (`sauber`, wenn Docling liest) |
| `docling_text` | Doclings Rohtext, auch zu Handschriftseiten. Nie in Listen, nie an Claude |
| `maschinell` | die heutige Abschrift hat die App aus Docling geschrieben. Jede andere Schreibung — ein Mensch im Formular, Claude über einen Vorschlag — setzt es zurück; derselbe Text, unverändert mitgeschickt, behält es |

Die App schreibt eine Docling-Abschrift nur in eine Seite ohne Abschrift. Und
was zu einer Seite mit `leser` „docling" oder „offen" oder zu einer schon
gelesenen Seite hereinkommt — von einem älteren Postboten oder aus einem Chat
in der Claude-App —, verwirft `propose_sheet` und nennt es in der Antwort
(`verworfen`), statt zu scheitern; die übrigen Seiten bleiben im Vorschlag.

**Gekennzeichnet** ist eine maschinell gelesene Seite überall, wo ihre Abschrift
erscheint: an der Blattseite („maschinell gelesen (Docling)", am Abschriftfeld
der Satz, dass niemand gegengelesen hat, und „wird gerade gelesen", solange die
App noch entscheidet), im Korb („1 Seite liest die App gerade.", „N von M
Seiten maschinell gelesen"), im Fach-PDF und in der Wiki-Übergabe
(„Maschinell gelesen (Docling) – von niemandem gegengelesen." über der
Abschrift, nur an solchen Seiten — der Altbestand wird deshalb nicht neu
geliefert), im Fragen-Eingang an jeder Frage, deren Zitat von einer solchen
Seite stammt, und im Web MCP (`leser` und `maschinell` in `read_sheet`,
`maschinell` in `read_transcript` und `read_exam_material`). Wichtig dabei: Eine
maschinell gelesene Seite hat **keine ⟨spitzen Klammern⟩** — Docling weiß
nicht, wo es unsicher war.

**Ein Blatt, das Docling ganz gelesen hat, braucht keinen Postboten.** Sind alle
Seiten entschieden und gelesen und ist die letzte mindestens 20 Sekunden alt —
dieselbe Ruhe wie beim Postboten, denn die Rückseite kommt erst nach der
Vorderseite —, legt die App **einmal** selbst einen Vorschlag an, mit der
Herkunft „von der App": als Titel die erste Überschrift der ersten Seite,
wörtlich und gekürzt (sonst bleibt der Platzhalter), keine Abschriften, denn die
stehen schon am Blatt. Danach ordnet Jev ein wie nach einem Postboten-Lauf.
Scheitert Jev, bleibt der Vorschlag im Korb für einen Menschen; einen zweiten
Versuch gibt es nicht. Geprüft wird das nur nach einem Ereignis — eine Seite ist
entschieden, die Ruhe ist um, oder ein Mensch hat eine Seite gelöscht (dann kann
das Blatt gerade ganz von Docling gelesen sein). Ein gemischtes Blatt geht wie
bisher an den Postboten, der aber nur noch die Claude-Seiten bekommt. Kann
Claude keine davon lesen, legt er trotzdem einen Vorschlag an, nur mit der
Notiz, welche Seite es war. Jev ordnet danach mit allen Abschriften ein, und
übernommen wird immer nur Ungelesenes — eine Docling-Abschrift ersetzt dabei
nichts still, auch nicht beim Übernehmen von Hand im Korb: schreibt die App
zwischen Anzeigen und Übernehmen eine Abschrift, bleibt die Seite unberührt,
und der Korb sagt es.

**Angestoßen** wird das nach jedem Hochladen (`after()` in
`src/app/(app)/material/actions.ts`, läuft nach der Antwort an den Browser) und
bei jedem `read_inbox` des Postboten. Das Zweite ist das Netz nach einem
Neustart: Seiten, die noch auf `offen` stehen, nimmt der nächste Anstoß mit.
Einen Takt gibt es nicht. Eine Queue je Prozess sorgt dafür, dass Docling eine
Seite nach der anderen rechnet und keine zweimal.

**Im Protokoll der App** steht je Seite eine Zeile, und eine je Vorschlag der
App (die ids hier ausgedacht):

```
Leser 3f2a9c01: docling (sauber, 160 Wörter, Formel –, Jev 0.89, Docling 5.2 s)
Leser 7b1e44d0: claude (zu-wenig-woerter, 31 Wörter, Formel –, Jev –, Docling 6.8 s)
Leser 9c0d1e2f: Vorschlag der App angelegt, Jev: Geografie
```

```bash
sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose logs --tail=200 app' | grep -E 'Leser|Docling|Jev'
```

**Die Notbremse.** `LESER_REGEL=aus` schaltet Docling als Leser ab, ohne Bau:
Jede neue Seite bekommt beim Anlegen `leser` „claude", Seiten, die noch offen
stehen, gehen ohne Docling an Claude (`aus`) — der Stand vor Docling.
Abschriften, die Docling schon geschrieben hat, bleiben, gekennzeichnet. Eine
Zeile unter `services.app.environment` der `docker-compose.override.yml`
(`sudo vi` — die Datei gehört `jev-und-docling.sh` und
`kalender-einrichten.sh`, und keines der beiden trägt die Zeile ein). Vorsicht:
Scheitert ein erneuter Lauf von `jev-und-docling.sh`, löscht es die Datei (siehe
unten), und der nächste Lauf legt sie frisch an — ohne die Notbremse. Nach
jedem Lauf dieses Skripts also mit dem `printenv` unten nachsehen.

```yaml
      LESER_REGEL: "aus"
```

Danach nur die App neu erzeugen, ohne Bau, und nachsehen, ob der Wert ankam:

```bash
sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose up -d app'
sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec -T app printenv LESER_REGEL'
```

Zurück: die Zeile löschen, dieselben zwei Befehle.

| Variable | wofür | ohne sie |
|---|---|---|
| `DOCLING_URL` | wo Docling antwortet (`http://docling:5001`, gesetzt von `jev-und-docling.sh`) | jede neue Seite liest Claude (`docling-fehlt`) |
| `TYPESAFE_API_KEY` | Jev: die Einstufung der Docling-Seiten und das Einordnen | jede neue Seite liest Claude (`jev-fehlt`), und eingeordnet wird von Hand |
| `LESER_REGEL` | `aus` ist die Notbremse; Groß- und Kleinschreibung egal | die Regel gilt |

#### Docling auf dem NAS

Docling liest **gedruckten Text, Tabellen und abgesetzte Formeln** — Handschrift
nicht, dafür ist es nicht gebaut. Gemessen an einem gerenderten Arbeitsblatt
(Mac, warm): rund 6 Sekunden je Seite; an den 37 echten Seiten: gedruckt rund
94 % der Wörter, Handschrift rund 32 %, und das als Kauderwelsch. Gefragt wird
über den **asynchronen** Weg (`/v1/convert/file/async`, dann nachfragen, dann
abholen) und mit `code_formula_preset=codeformulav2` — warum, steht an
`convertPage()` und `doclingForm()` in `src/lib/docling.ts`. Nach drei Minuten
je Seite gibt die App auf.

Auf dem NAS richtet es **`scripts/jev-und-docling.sh`** ein, zusammen mit dem
Jev-Schlüssel — nach einem `hoch`:

```bash
sudo ~/nas.sh hoch
sudo bash /volume1/docker/schulapp/repo/scripts/jev-und-docling.sh
```

Es legt eine `docker-compose.override.yml` neben die Compose-Datei (Docling
nur im inneren Netz, kein `ports:`; die App bekommt `DOCLING_URL` und
`TYPESAFE_API_KEY`), prüft aus dem App-Container heraus, ob Jev antwortet und
Docling rechnet, und gleicht den Postboten erst an, wenn Jev richtig
geantwortet hat. Was es vorher nachsieht und wie es sich rückgängig machen
lässt, steht im Kopf des Skripts.

> **Die Override-Datei gehört seit dem Google Kalender zweien.**
> `kalender-einrichten.sh` trägt dort die drei `GOOGLE_*`-Namen ein (siehe
> *Google Kalender*). Wer die Datei löscht, schaltet den Kalender mit ab — und
> das tut nicht nur der Rückweg oben im Skript (`rm docker-compose.override.yml`),
> sondern auch `jev-und-docling.sh` selbst, wenn ein erneuter Lauf am Bild, am
> Formelmodell oder an Compose scheitert. Danach `kalender-einrichten.sh` noch
> einmal; es sieht dann die fehlende Datei samt Jev-Schlüssel in der `.env`, hält
> an und sagt, dass zuerst `jev-und-docling.sh` laufen muss — legte es die Datei
> selbst an, trüge sie seine Marke, und `jev-und-docling.sh` fasste sie nie wieder an.

**Das Bild allein reicht nicht.** `docling-serve-cpu` bringt das Formelmodell
nicht mit (seine Modellliste: layout, tableformer, picture_classifier,
rapidocr, easyocr), setzt aber `DOCLING_SERVE_ARTIFACTS_PATH` — und dann lädt
Docling nichts nach, sondern scheitert an **jeder** Seite mit „Model
'docling-project/CodeFormulaV2' not found in artifacts_path". Am 5.10.2026 mit
genau dieser Modellablage nachgestellt: ohne das Modell ein Fehler, mit ihm
8,5 s für die erste und 2,1 s für die zweite Probeseite (Mac), bei 2,2 GB
Speicher mit einem Arbeiter. Das Skript lädt es deshalb in ein Docker-Volume
(`docling-tools models download code_formula`, 610 MB). Ob es die
Formelanreicherung überhaupt noch braucht, seit Formelseiten nie an Docling
allein gehen, ist nicht gemessen (siehe *Offene Punkte* in KONZEPT.md).

Hängt Docling oder antwortet es nicht (Zeitablauf, 404, 5xx), pausiert die App
es für zehn Minuten — ein Fehler an einer einzelnen Seite reicht dafür nicht.
Jede Seite in der Pause liest Claude (`docling-pause`), nachgeholt wird nichts,
und im Protokoll steht `Docling pausiert bis …` mit dem Grund.

#### Auf das NAS bringen — dieser Stand

Vier Dinge machen diesen Stand anders als ein gewöhnliches `hoch`: Die
Datenbank braucht vier neue Spalten, und zwar **vor** dem Bau (der neue Code
scheitert ohne sie an jeder Seite, der alte verträgt sie); die SQL-Datei liegt
erst nach dem Holen im Klon; App und Postbote müssen zusammen wechseln; und
`~/nas.sh` ist noch die alte Kopie, die weder die Spalten prüft noch den
Postboten angleicht. Daraus folgt diese Reihenfolge — vorher muss der Stand auf
GitHub in `main` liegen:

1. **Sichern** — ein Abzug der Datenbank neben die Compose-Datei:
   ```bash
   sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec -T db sh -c "exec pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --format=custom" > abzug-$(date +%Y%m%d)-vor-leser.dump && ls -l abzug-*-vor-leser.dump'
   ```
2. **Die neue `nas.sh` zuerst.** `fetch` holt nur und ändert weder den Klon
   noch die App:
   ```bash
   sudo git -C /volume1/docker/schulapp/repo fetch origin main
   sudo git -C /volume1/docker/schulapp/repo show origin/main:scripts/nas.sh > /tmp/nas.sh.neu && sudo cp /tmp/nas.sh.neu ~/nas.sh
   ```
3. **Den Postboten anhalten**, damit kein Lauf in den Wechsel fällt — `hoch`
   startet ihn nach dem Angleichen wieder. Endet ein `hoch` vorher (der HALT in
   Schritt 4, ein gescheiterter Bau), bleibt er aus; `nas.sh` sagt das dann und
   nennt `sudo ~/nas.sh postbote` — mit der App, die dann läuft, verträgt er
   sich:
   ```bash
   sudo sh -c 'cd /volume1/docker/postbote && /usr/local/bin/docker compose stop postbote'
   ```
4. **`sudo ~/nas.sh hoch`** — holt den Stand und hält vor dem Bau an:
   „HALT: Der Datenbank fehlt material_pages.leser". Darunter steht die Zeile
   zum Einspielen, mit Benutzer und Datenbank aus dem db-Container. Gebaut ist
   nichts, die App läuft weiter wie bisher.
5. **Zählen, einspielen, nachsehen.** psql öffnen:
   ```bash
   sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec db sh -c "exec psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\""'
   ```
   darin die beiden Zähl-Abfragen aus dem Kopf von `scripts/leser-tabellen.sql`
   und `\q`. Dann die Zeile, die `hoch` genannt hat. Dann wieder psql:
   `\d material_pages`, `SELECT leser, count(*) FROM material_pages GROUP BY 1;`
   (erwartet: nur leer, so viele wie vorher Seiten) und
   `SELECT count(*) FROM material_pages WHERE maschinell;` (erwartet: 0).
6. **Noch einmal `sudo ~/nas.sh hoch`** — „Von GitHub kam nichts Neues — aber
   es läuft noch …", baut nach, wartet auf die App, gleicht die Harness-Kopie
   an (die alte liegt danach unter `/volume1/docker/postbote/harness-alt-<Zeit>`)
   und startet den Postboten. Erst „Fertig." heißt: App und Postbote laufen
   auf dem neuen Stand.
7. **Probe** mit zwei Blättern: ein gedrucktes Handout und eine Seite mit
   Handschrift. Erwartet im Protokoll der App (Befehl oben) je Seite eine Zeile
   `Leser …` — das Handout `docling (sauber, …)`, die Handschrift `claude (…)`
   — und gut zwanzig Sekunden später zum Handout `Vorschlag der App angelegt,
   Jev: <Fach>`. Im Protokoll des Postboten
   (`sudo sh -c 'cd /volume1/docker/postbote && /usr/local/bin/docker compose logs --tail=40 postbote'`)
   für das Handout kein Lauf, für die Handschrift genau einer mit nur dieser
   Seite. Am Handout steht „maschinell gelesen (Docling)" an der Blattseite, im
   Fach-PDF und nach der nächsten Wiki-Übergabe auch dort.
8. **Nach ein paar Tagen zählen**, in psql wie in Schritt 5:
   ```sql
   SELECT leser, leser_grund->>'grund' AS grund, count(*)
     FROM material_pages WHERE leser IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;
   ```
   und die ersten rund zwanzig Seiten, die Docling allein gelesen hat, neben
   ihrem Foto durchsehen.

Wurde Schritt 2 übersprungen, baut die alte `~/nas.sh` in Schritt 4 sofort.
Dann muss das Einspielen vorher gelaufen sein, mit der Datei aus `origin/main`
— im Klon liegt sie da noch nicht:

```bash
sudo sh -c 'cd /volume1/docker/schulapp && git -C repo show origin/main:scripts/leser-tabellen.sql | /usr/local/bin/docker compose exec -T db sh -c "exec psql -X -v ON_ERROR_STOP=1 --single-transaction -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f -"'
```

Den Postboten holt danach
`sudo cp /volume1/docker/schulapp/repo/scripts/nas.sh ~/nas.sh && sudo ~/nas.sh hoch`
nach: Es baut nichts, gleicht aber an.

**Rückweg:** `sudo ~/nas.sh zurueck`, ohne SQL — der alte Code sieht die
Spalten nicht. Der Postbote geht dabei mit zurück: `zurueck` gleicht seine
Kopie an den alten Stand an, sobald die alte App antwortet. Ohne das liefe der
neue Postbote gegen die alte App, die `read_docling` anbietet, das sein Käfig
verbietet — und jeder Lauf, der danach greift, endete als „nichts“. Eine
Nebenwirkung bleibt: Der alte Code kennt `maschinell` nicht. Ändert in der
Zwischenzeit jemand die Abschrift einer Docling-Seite (Formular, Korb, ein
Vorschlag aus einem Chat), behält sie die Kennzeichnung und steht nach dem
nächsten `hoch` als „maschinell gelesen" da, obwohl ein Mensch sie geschrieben
hat. Nach einem längeren Rückweg deshalb vor dem nächsten `hoch` nachsehen:
`SELECT id FROM material_pages WHERE maschinell;` und diese Seiten am Foto
prüfen. Meist reicht ohnehin die Notbremse.

## Datenbank

**Seit dem 30.8.2026 läuft die App auf einem Synology-NAS im Heimnetz** — in
zwei Containern, die App und ein Postgres 18 daneben. Erreichbar ist sie über
Tailscale Funnel unter `https://treskownas.tail3a40b0.ts.net`, ohne einen
offenen Port im Router. `DATABASE_URL` setzt die Compose-Datei auf dem NAS und
zeigt auf den Datenbank-Container.

> **Davor, vom 23. bis 30.8.2026:** Vercel als Hosting, eine Neon-Datenbank in
> Frankfurt, die Adresse `schulapp-teal.vercel.app`. Wo im Repo noch die alte
> Adresse steht, ist es Vorgeschichte und keine Auskunft.
>
> **„Abgeschaltet" wäre allerdings zu viel gesagt** — am 11.9.2026 nachgesehen:
> Das Vercel-Projekt ist **pausiert, nicht gelöscht** (`live: false`, die letzte
> Produktionsfassung steht weiterhin auf `READY`, beide Adressen sind zugeordnet),
> und die Neon-Datenbank antwortet noch und hält den eingefrorenen Stand vom
> Umzugstag: ein Nutzer, 15 Blätter, 15 Seiten, keine Noten. Ein Klick auf
> *Unpause* weckt also eine zweite, ältere Schulapp — mit einer zweiten
> Datenbank, in der Schulinhalte liegen. Wer das nicht will, löscht beides
> bewusst; es ist der letzte Stand von vor dem Umzug, und danach ist er weg.

Dass die eine Datenbank **auch beim Entwickeln** gilt, war und bleibt Absicht:
liefe `npm run dev` gegen eine eigene Datei-Datenbank, gäbe es zwei Bestände.
Eine Hausaufgabe, am Laptop eingetragen, käme am Handy nie an — und gemerkt
hätte man es erst, wenn sie in der Schule fehlt.

Mit dem Umzug aufs NAS hat sich diese Frage gedreht, und am 11.9.2026 ist sie
entschieden worden. Die `DATABASE_URL` in der lokalen `.env.local` zeigte
weiterhin auf Neon — und das war schlimmer als „ins Leere": Neon antwortet noch.
Ein `npm run dev` hätte also nicht in die echte Datenbank geschrieben, sondern
in die alte Cloud-Kopie, die niemand mehr ansieht. Genau die Verwechslung, gegen
die der Absatz oben argumentiert, nur andersherum.

Die Zeile ist deshalb aus `.env.local` heraus: Lokal läuft wieder die
Datei-Datenbank, ein Spielplatz, der niemandem wehtut. Wer wirklich gegen den
Bestand des NAS entwickeln will, öffnet dort den Postgres-Port — das ist eine
Entscheidung und kein Handgriff nebenbei.

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
und die beiden Tabellen `material_proposals` und `material_proposal_topics`,
mit dem Web MCP die Spalte `material_pages.reading` und die drei Tabellen
`oauth_clients`, `oauth_codes` und `oauth_grants`, mit Ferien und
Klassenfahrt die Tabelle `free_periods` (`scripts/freie-tage-tabelle.sql`), mit
dem Google Kalender die beiden Tabellen `google_calendar_connections` und
`google_calendar_events` (`scripts/google-kalender-tabellen.sql` — auf dem NAS
per psql und VOR dem Neubau; warum, steht unter *Google Kalender*), mit „ein
Leser je Seite" die vier Spalten `leser`, `leser_grund`, `docling_text` und
`maschinell` an `material_pages` (`scripts/leser-tabellen.sql`, ebenfalls VOR
dem Neubau). **Bei dieser einen ist `db:push` auf einem Bestand der falsche
Weg:** drizzle-kit legt `leser` gleich mit der Vorgabe „offen" an, und Postgres
setzte damit jede vorhandene Seite auf „offen" — die App schickte den ganzen
Altbestand durch Docling und an Claude, die fünfzehn Altblätter eingeschlossen.
Die SQL-Datei legt die Spalte erst leer an und setzt die Vorgabe danach.
**Ohne Push bleibt nicht nur
der Materialbereich stehen, sondern die ganze Startseite** — sie lädt die
letzten Blätter mit.

> Bricht `db:push` wegen der Rückfrage unten ab, liegt dieselbe Änderung als
> reines SQL bereit:
>
> ```bash
> npx tsx scripts/sql-einspielen.ts scripts/material-tabellen.sql   # die Ablage
> npx tsx scripts/sql-einspielen.ts scripts/eingangskorb-tabellen.sql
> npx tsx scripts/sql-einspielen.ts scripts/mcp-tabellen.sql        # der Web MCP
> ```
>
> `mcp-tabellen.sql` hat eine Bedingung, und zwar nur einmal: `reading` kommt
> als NOT NULL ohne Vorgabe dazu, das geht nur auf einer leeren
> `material_pages`. Am 24.8.2026 war sie leer. Wer sie später braucht, füllt
> die Spalte vorher aus dem Vollbild.
>
> Sie sind rein additiv (`CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, die
> Fremdschlüssel der neuen Tabellen und `CREATE INDEX`) und wörtlich aus dem
> Schema erzeugt — ein späteres `db:push` sieht danach keinen Unterschied. Der
> Server muss dafür aus sein, und das Skript weist jede Datei zurück, in der
> eine Anweisung mit `drop`, `truncate`, `delete` oder `update` **beginnt** oder
> in der irgendwo ein `DROP TABLE`, `DROP COLUMN` und ihresgleichen steht.
> Geprüft wird pro Anweisung und erst, nachdem alle Kommentare entfernt sind —
> `ON DELETE cascade` in einem Fremdschlüssel darf deshalb durch.
>
> **Gegen eine entfernte Datenbank läuft `sql-einspielen.ts` bewusst nicht**
> (dort gibt es keine Datei, die man vorher kopieren könnte).

> ## ⚠ Der Fehler, der Erfolg meldet
>
> **Weder `npm run db:push` noch `npx tsx scripts/sql-einspielen.ts` erreichen
> die laufende Datenbank.** Beide schreiben in die Datei-Datenbank unter
> `.data/pglite`, und beide melden danach, es sei gutgegangen.
>
> Der Grund ist unspektakulär und deshalb tückisch: `DATABASE_URL` steht nur in
> `.env.local`, und diese Datei liest **allein Next**. Weder `node` noch `tsx`
> kennen sie, und das dotenv, das drizzle-kit mitbringt, sucht nach `.env` und
> `.env.vault` — ein `.env` gibt es in diesem Repo nicht. Nachgemessen am
> 5.9.2026: `npx tsx -e "console.log(process.env.DATABASE_URL ? 'SET':'UNSET')"`
> antwortet `UNSET`.
>
> Zwei Folgen, beide still. Erstens landet die Änderung in einer Datei, die mit
> der laufenden App nichts zu tun hat; der Fehler zeigt sich Tage später als
> Laufzeitfehler in einer Abfrage. Zweitens **feuert der eingebaute Schutz in
> `sql-einspielen.ts` nie** — er verweigert den Dienst bei gesetzter
> `DATABASE_URL`, und gesetzt ist sie beim Aufruf eben nicht.
>
> Auf dem NAS geht eine Wanderung deshalb von Hand hinein, in einer
> Transaktion, mit Abbruch beim ersten Fehler:
>
> ```bash
> ssh leonard@192.168.178.90
> cd /volume1/docker/schulapp
> sudo docker compose exec -T db \
>   psql -v ON_ERROR_STOP=1 --single-transaction \
>        -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
>   < repo/scripts/abschrift-tabellen.sql
> ```
>
> Und danach wird nachgesehen, statt es zu glauben:
>
> ```bash
> sudo docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
>   -c '\d material_pages'
> ```

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

Ausgelöst wird sie seit dem 11.9.2026 **von einer Zeile in `/etc/crontab` auf
dem NAS**, fünf nach jeder vollen Stunde: Sie ruft `erinnerungen.sh`, und das
Skript schreibt Zeitstempel, Rückgabewert und die Antwort der Route im Wortlaut
in ein Protokoll neben die Compose-Datei. Scheitert ein Lauf, entsteht im Vault
eine `SCHULAPP-STOERUNG.md` — höchstens eine je Tag, sonst stünden nach einer
durchgefallenen Nacht vierundzwanzig gleichlautende Absätze darin.

Bis dahin lag der Auslöser bei GitHub, in `.github/workflows/erinnerungen.yml`.
Dort war er gelandet, weil der Hobby-Tarif von Vercel höchstens einen Cron-Lauf
pro Tag erlaubt und ein stündlicher Ausdruck schon das Deployment scheitern ließ
(„Hobby accounts are limited to daily cron jobs") — einmal am Tag geht die
Rechnung aber nicht auf, weil die Route die passende Stunde selbst sucht. Mit
dem Umzug aufs NAS hat dieser Grund aufgehört zu gelten, und der Workflow hat es
niemandem gesagt: Über die öffentliche GitHub-API nachgezählt, scheiterten
**zwölf Läufe in Folge** am Schritt „Erinnerungs-Route aufrufen", zurück bis
mindestens zum 9.9. — seit dem Umzug am 30.8.2026 ist keine einzige Erinnerung
angekommen.

Die Ursache ist eingekreist und liegt nicht in der App: Der Funnel antwortet von
außen mit dem Geheimnis aus der `.env` des NAS in 0,77 s mit **200**, ohne
Geheimnis mit **401**. App, Funnel und Route sind also in Ordnung; GitHub legt
das alte `CRON_SECRET` aus der Vercel-Zeit vor, denn beim Umzug wurde es neu
erzeugt. **Repariert wurde deshalb nicht das Geheimnis, sondern der Ort** —
genau so, wie der Kopf von `erinnerungen.yml` es selbst vorschlägt: Der Auslöser
sitzt jetzt neben der App auf demselben Gerät, erreicht sie ohne Funnel und ohne
GitHub, und das Geheimnis liegt dort, wo die App es ohnehin hat.

> **Der Workflow ist damit stillgelegt und darf NICHT repariert werden.** Der
> `schedule:`-Block ist heraus; wer ihn wieder einsetzt und dazu das Secret im
> Repo nachzieht, hat keinen Auslöser geheilt, sondern zwei für dieselbe Stunde
> — zwei Erinnerungen je Stunde auf demselben Handy. Und stillgelegt ist er
> erst, wenn dieser Stand im Standardzweig steht: Zeitpläne liest GitHub von
> dort und nicht aus einem Arbeitsverzeichnis. Bis dahin läuft der alte weiter
> — folgenlos nur, weil er an der 401 hängenbleibt.

Lokal testest du sie so:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
```

An fällige **Hausaufgaben** erinnert die Push nicht. Das übernimmt Google, wenn
der Kalender verbunden ist: am Vortag zur selben Erinnerungsstunde — siehe
*Google Kalender*.

## Das Fach-PDF

`/faecher/<id>` hat einen Knopf *PDF erzeugen*. Er führt auf
`/api/fach/<id>/pdf`, und dort entsteht das Dokument beim Abruf — es liegt
nirgends herum und wird nirgends zwischengespeichert.

Gegliedert wird **Fach → Thema → Blatt**, und jedes Blatt steht genau einmal:
unter seinem ersten Thema, die übrigen stehen am Blatt. Unter jedem seiner
Themen abgedruckt verdoppelte sich das Dokument samt Fotos, und „habe ich das
schon gelesen?" wäre nicht mehr zu beantworten.

**Zwei Schriften, und das ist keine Spielerei.** Gesetzt wird in Geist, damit
das Dokument aussieht wie die App. Aber Geist fehlen `∈ ⊂ α β γ Δ θ σ` — und
`⟨ ⟩`, also ausgerechnet die Klammern, mit denen unsichere Stellen markiert
sind. Für genau diese Zeichen schaltet der Satz auf DejaVu Sans um, Zeichen für
Zeichen. Ohne das stünde in jedem Mathe-PDF an jeder Formel ein leeres Kästchen,
und gemerkt hätte man es erst nach dem Ausdrucken. Die Messung dahinter steht in
[assets/schriften/README.md](assets/schriften/README.md).

Was fehlt, wird gesagt statt verschwiegen: ein Foto im WebP-Format kann pdfkit
nicht einbetten, ein Blatt kann die Bildgrenze reißen, ein Zeichen kann keiner
der beiden Schriften bekannt sein. Jeder dieser Fälle steht an seiner Stelle im
Dokument, und der Schluss zählt sie noch einmal auf.

| Grenze | Wert | Warum |
|---|---|---|
| `PDF_SHEET_LIMIT` | 150 Blätter | Drei volle Runden der Auswahlschicht; deckt ein Schuljahr |
| `PDF_IMAGE_BYTES` | 40 MB | Nicht eine Anzahl, weil achtzig Fotos je nach Blatt 16 oder 240 MB sind. Greift sie, läuft das Dokument als reiner Text weiter — die Abschriften bleiben vollständig |

## Die Wiki-Übergabe

Einmal täglich legt die App ihren ganzen Bestand als Markdown in einen Ordner —
seit dem 11.9.2026 im Obsidian-Vault selbst, in dessen Eingang
`topics/schule/inbox`, und nicht mehr daneben: Ein Ordner außerhalb wäre eine
Schleuse, die Obsidian gar nicht sieht, und ob sie volläuft oder leer bleibt,
fiele dann niemandem auf. Ein **eigener Agent** holt die Lieferung dort ab und
ordnet sie an ihren Platz ein.

**Die App ist Lieferant, nicht Bibliothekar.** Sie baut keine Fächer-Ordner nach
und entscheidet nicht, wo im Vault etwas landet — das wäre eine Ordnung, die der
Agent hinterher wieder auflösen müsste. Sie liefert flach und datiert:

```
<WIKI_EXPORT_DIR>/2026-09-05/
  MANIFEST.md
  fach-<uuid>.md
  blatt-<uuid>.md
  klausur-<uuid>.md
  …
```

Drei Entscheidungen tragen das:

- **Die Kennung ist dreierlei in einem** — Dateiname, Feld `id` im Frontmatter
  und Zeilenschlüssel in der Tabelle `wiki_deliveries`. Sie ändert sich nie, auch
  nicht beim Umbenennen. Ohne sie könnte der Agent „neu" nicht von „schon
  abgelegt, nur geändert" unterscheiden, und nach zwei Wochen läge alles
  vierzehnfach im Vault. Nebenbei ist sie die Sicherung gegen einen Pfad aus dem
  Ordner heraus: ein Dateiname entsteht nie aus einem Titel.
- **Nur was sich geändert hat.** Verglichen wird ein Hash über den *fertig
  gerenderten* Dateitext. Deshalb darf in keiner Datei etwas stehen, das sich von
  Tag zu Tag ändert, ohne dass sich der Inhalt ändert — kein „übergeben am".
- **Ganz oder gar nicht.** Geschrieben wird in einen versteckten Ordner und dann
  in einem Zug umbenannt; die Abdrücke in der Tabelle folgen erst danach. Der
  Agent sieht nie einen halben Ordner, und der schlimmste Fall ist eine doppelte
  Lieferung unter derselben Kennung — nie eine Lücke, die niemandem auffällt.

**Fremder Text wird eingepackt, nicht geglaubt.** Auf einem abfotografierten
Blatt kann alles stehen, und die Abschrift bringt es wörtlich in die Datei. Kurze
Werte (Titel, Fach, Thema) gehen maskiert in eine Zeile; freier Text steht
wörtlich in einem Codeblock, dessen Zaun länger ist als die längste
Rückwärtsstrich-Folge darin. Auch die Raute wird maskiert — sonst verschlagwortet
sich ein Blatt in Obsidian selbst. Und die `MANIFEST.md` sagt dem Agenten in
Klartext, dass in einem Codeblock Inhalt steht und kein Auftrag.

Angestoßen wird der Lauf **auf dem NAS selbst** und nicht als GitHub Action: er
läuft damit unabhängig von GitHub und vom Tailscale Funnel und kennt die
60-Sekunden-Frist von `curl` nicht. Vorgesehen war dafür der
**DSM-Aufgabenplaner**; seit dem 11.9.2026 steht stattdessen eine Zeile in
`/etc/crontab`, die um 02:30 `wiki-uebergabe.sh` ruft und Zeitstempel,
Rückgabewert und die Antwort der Route im Wortlaut in ein Protokoll schreibt.
Der Grund ist der Rückkanal: Der Planer meldet sein Ergebnis per E-Mail, und auf
diesem NAS ist keine eingerichtet — `/etc/crontab` beginnt mit `MAILTO=""`, eine
SMTP-Konfiguration gibt es nicht. Er wäre also still, und ein stiller Fehlschlag
ist genau das, wogegen diese Stufe sonst argumentiert. Das Skript legt deshalb
bei einem Rückgabewert ungleich null eine `SCHULAPP-STOERUNG.md` in den Vault;
Synology Drive trägt sie binnen Minuten auf den Windows-Rechner, und in Obsidian
steht dann eine Datei, die vorher nicht da war. Die Uhrzeit ist 02:30 und nicht
03:30, weil DSM donnerstags um 03:45 sein Update einspielt und neu startet — ein
erster, vollständiger Lauf darf da nicht hineinlaufen.

Die Schritte stehen vollständig im Kopf von `src/app/api/cron/wiki/route.ts` —
samt dem Volume-Mount des Vaults in den Container und der Umgebungsvariablen
`WIKI_EXPORT_DIR`. Fehlt sie, antwortet die Route mit einem Fehler und **nicht**
mit „nichts zu tun": ein grüner Lauf, der jede Nacht nichts tut, fällt niemandem
auf.

## Google Kalender

Seit dem 5.10.2026 (Stufe 1 und 2 von 5) trägt die App **Klausuren, offene
Hausaufgaben und freie Tage** als ganztägige Termine in einen eigenen Kalender
„Schule" im Google Kalender des Schülers ein. Verbunden wird in den
*Einstellungen*, Karte *Google Kalender*. **Lernblöcke und Abruf-Termine kommen
nie hinein** — sie sind ein Vorschlag der App für den eigenen Abend, keine
Verabredung mit der Schule, und ein Kalender voller Lernblöcke machte aus der
App den Tagesplaner, der sie nicht sein soll. Seit Stufe 5 kommen, wenn
eingerichtet, die Termine aus IServ dazu, die die Klasse betreffen (Abschnitt
„IServ" unten); Schulhomepage und Termine von Blättern docken später an
(Stufen 3–4). Jede ist eine weitere Quelle in `src/lib/calendar/sources.ts`,
Plan und Ausführung bleiben dafür unverändert.

**Eine Einbahnstraße.** Die App ist die Quelle, Google das Ziel:

- Ändert sich etwas in der App, wird der Termin in Google überschrieben — auch
  das, was jemand in Google daran geändert hat.
- Wird etwas in der App gelöscht (auch über ein gelöschtes Fach, per
  Fremdschlüssel), wird der Termin in Google gelöscht. Eine abgehakte
  Hausaufgabe verschwindet; wird sie wieder geöffnet, kommt sie zurück.
- **Löscht der Nutzer einen Termin in Google, trägt die App ihn nie wieder
  ein** — auch nicht, wenn er sich in der App später ändert.

Eine Liste aller Termine holt die App sich dafür nie (`events.list` gibt es
nicht). Sie bemerkt eine Löschung in Google erst, wenn sie den Termin selbst
anfassen will — ihn ändern (Google meldet ihn dann als `cancelled`) oder löschen
(Google sagt „schon gelöscht"). Einen Termin, den die App nicht anfasst, kann
sie auch nicht zurückholen; mehr braucht die Zusage nicht. Damit fällt die
ganze Fehlerklasse „eine unvollständige Liste sieht aus wie viele Löschungen"
weg.

Was die App sich je Termin merkt, steht in `google_calendar_events`, mit vier
Zuständen: **geliefert** (steht so in Google), **entfernen** (die App löscht
gerade — die Absicht steht VOR dem Löschen in der Zeile), **entfernt** (die App
hat gelöscht) und **verworfen** (der Nutzer hat in Google gelöscht — nie
wieder). „verworfen" entsteht nur aus einem Nachweis: Google meldet
`cancelled`, ein erster Löschversuch bekommt „schon gelöscht", oder Google kennt
die ID nicht mehr, nachdem eine Probe bestätigt hat, dass der Kalender selbst
noch da ist. Ohne die Probe sähe ein gelöschter Kalender aus wie hundert vom
Nutzer gelöschte Termine.

Vor dem ersten Löschversuch sieht die App deshalb nach (GET), wie vor jedem
Ändern: Ist der Termin dort schon gelöscht, war es der Nutzer, bevor die App
ihn loswerden wollte — verworfen, ohne DELETE. Nur wenn er noch steht, schreibt
sie die Absicht und löscht. Sonst wäre eine Löschung des Nutzers, auf die ein
gescheiterter DELETE folgt (503, Timeout), von der eigenen nicht zu
unterscheiden, und der Termin käme beim Wieder-Öffnen zurück. Weist Google den
DELETE sicher ab (Drosselung, kein Zugang), geht die Zeile zurück auf
„geliefert".

Die Event-ID ist fest: Präfix je Art (`sak` Prüfung, `sah` Hausaufgabe, `saf`
frei), die UUID ohne Bindestriche und eine **Generation** dahinter. Ein
doppeltes Anlegen endet bei Google deshalb in 409 und wird übernommen, statt
einen zweiten Termin zu erzeugen. Eine gelöschte ID verwendet die App nie
wieder — Google reserviert sie —, sondern zählt die Generation hoch.

**Farben:** Tomate für Prüfungen, Heidelbeere für Hausaufgaben, Basilikum für
freie Tage. **Erinnerungen:** Hausaufgaben am Vortag zur eingestellten
Erinnerungsstunde (Standard 17 Uhr); Klausuren bekommen keine Google-Erinnerung,
weil die App selbst drei Tage und einen Tag vorher eine Push-Nachricht schickt;
freie Tage auch nicht. Alle Termine sind „frei" (`transparent`) und blockieren
keine Zeit.

### Google Cloud einrichten

Einmal, im Google-Konto des Schülers:

1. In der Google Cloud Console ein **eigenes Projekt** anlegen.
2. Unter *APIs & Dienste* die **Google Calendar API** aktivieren.
3. *Google Auth Platform* bzw. *OAuth-Zustimmungsbildschirm*: Zielgruppe
   **Extern**, Status **„In production"** — NICHT „Testing", sonst laufen die
   Zugänge nach sieben Tagen ab und die Karte meldet „Verbindung unterbrochen".
   Als Scope genau `https://www.googleapis.com/auth/calendar.app.created`: Die
   App darf damit eigene Kalender anlegen und nur darin Termine bearbeiten, an
   die anderen Kalender kommt sie nicht heran. Eine Prüfung durch Google braucht
   es für die Eigennutzung nicht; Google warnt dafür beim Verbinden („Google hat
   diese App nicht überprüft"), über *Erweitert* geht es weiter.
4. Unter *Clients* einen **OAuth-Client vom Typ „Webanwendung"** anlegen, mit
   beiden Redirect URIs:
   `https://treskownas.tail3a40b0.ts.net/api/google/callback` und
   `http://localhost:3000/api/google/callback`.
5. Steht beim Verbinden auf Googles eigener Seite `redirect_uri_mismatch`, passt
   die Adresse nicht Zeichen für Zeichen zum Eintrag aus Schritt 4. Die App baut
   sie nie aus der Anfrage, sondern nimmt die Funnel-Adresse oder
   `GOOGLE_REDIRECT_URI`.

### Umgebungsvariablen

| Variable | Pflicht | Inhalt |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ja | der OAuth-Client vom Typ „Webanwendung" aus dem Cloud-Projekt |
| `GOOGLE_CLIENT_SECRET` | ja | dazu |
| `GOOGLE_TOKEN_KEY` | ja | 32 zufällige Bytes in base64 (`openssl rand -base64 32`). Damit ist das Refresh Token in der Datenbank verschlüsselt (AES-256-GCM). Verlust oder Wechsel heißt neu verbinden. Im Passwortmanager sichern. |
| `GOOGLE_REDIRECT_URI` | nein | Fehlt der Wert, gilt `https://treskownas.tail3a40b0.ts.net/api/google/callback`. Lokal: `http://localhost:3000/api/google/callback`. Muss Zeichen für Zeichen in der Cloud Console stehen. |
| `CRON_SECRET` | schon da | dasselbe wie für Erinnerungen und Wiki |

Lokal stehen sie in `.env.local`, auf dem NAS in der `.env` und unter
`services.app.environment` der `docker-compose.override.yml`. Es gibt keinen
`NEXT_PUBLIC_`-Wert, der Bau braucht also kein Argument. **Fehlt eine
Pflichtvariable, ist die Funktion aus** — wie Jev ohne `TYPESAFE_API_KEY`: Die
Auslöser tun nichts, die Karte sagt, was fehlt (ohne eine einzige Abfrage), und
der Cron antwortet 200, solange nichts verbunden ist, und 500, sobald etwas
verbunden ist. Das gilt mit eingespielten Tabellen: Der Cron fragt die Tabelle
der Verbindungen auch ohne Variablen ab, und fehlt sie, antwortet er 500
(„relation … does not exist").

### Reihenfolge auf dem NAS

**Vorher, am Rechner:** Der Stand mit der Kalender-Anbindung muss committet und
nach `main` gepusht sein — `nas.sh hoch` holt nur, was auf GitHub steht
(`git pull --ff-only`). Endet `hoch` mit „Nichts Neues — der Stand war schon
aktuell", fehlt der Push, und das Skript unten gibt es auf dem NAS noch gar
nicht („No such file or directory"). Erst wenn `hoch` mit **„Fertig."** endet,
läuft der neue Code.

**Dann, auf dem NAS, zwei Zeilen** — erst der neue Code, dann ein Skript, das
alles Übrige erledigt und sich bei jedem Schritt selbst prüft:

```bash
sudo ~/nas.sh hoch
sudo bash /volume1/docker/schulapp/repo/scripts/kalender-einrichten.sh
```

Am besten vom Rechner aus, mit stabiler Verbindung. Reißt sie ab, solange das
Skript noch fragt, hält es an und sagt, was schon geändert ist; reißt sie
danach ab, läuft es zu Ende, und das Ergebnis steht in
`/volume1/docker/schulapp/kalender-einrichten.log`.

`scripts/kalender-einrichten.sh` sieht zuerst nach, ohne etwas zu ändern (gibt
es alle Werkzeuge, die es braucht, läuft die App mit dem neuen Code, antwortet
die Datenbank), und tut dann der Reihe nach, was die Handschritte unten
beschreiben: die Tabellen einspielen, nur wenn sie fehlen; Client-ID und Secret
abfragen (beide unsichtbar — Google zeigt sie untereinander, und wer die falsche
Zeile erwischt, hätte sonst das Secret auf dem Bildschirm) und
`GOOGLE_TOKEN_KEY` selbst erzeugen; die drei Namen in die
`docker-compose.override.yml` eintragen, neben Jev und Docling, ohne dort eine
Zeile wegzunehmen; die App neu erzeugen, ohne Bau, und aus dem Container
nachsehen, ob die Werte angekommen sind; `kalender.sh` anlegen, die Zeile in
`/etc/crontab` ergänzen und crond neu laden; zum Schluss `kalender.sh` einmal
als Probe. Danach bleibt nur Schritt 5 unten: im Browser verbinden.

Ein zweiter Lauf ändert nichts. Was schon in der `.env` steht, bleibt stehen;
ersetzt wird nur auf ausdrücklichen Wunsch:

- `--neuer-schluessel` — ein neuer `GOOGLE_TOKEN_KEY`. Ist ein Kalender
  verbunden, fragt das Skript nach: Der Zugang lässt sich danach nicht mehr
  entschlüsseln, die Karte zeigt „blockiert", das Handy bekommt eine Push
  „Google Kalender getrennt", und der Cron meldet 500, bis jemand *Neu
  verbinden* drückt. Die Probe am Ende erwartet genau diesen 500.
- `--neue-zugangsdaten` — Client-ID und Secret. Ein neues Secret desselben
  Clients lässt die Verbindung gelten; dafür fragt das Skript nicht nach. Eine
  **andere** Client-ID dagegen schon: Ein Zugang gilt nur für den Client, der
  ihn ausgestellt hat, die Karte meldet dann stündlich „Google lehnt die
  Zugangsdaten der App ab (invalid_client)", und es heißt *Trennen*, danach *Mit
  Google verbinden*.

Fehlt `GOOGLE_TOKEN_KEY` in der `.env`, obwohl ein Kalender verbunden ist, erzeugt
das Skript keinen neuen, sondern hält an: Dann ist der Schlüssel verloren
gegangen, und der richtige Weg ist der alte aus dem Passwortmanager.

Vor jeder Änderung legt es eine Sicherung daneben (`.env.vor-kalender-…`,
`docker-compose.override.yml.vor-kalender-…`, `/etc/crontab.vor-kalender-…`) und
erneuert `/etc/crontab.sicherung-<datum>`; die Liste steht am Ende seiner
Ausgabe und in `kalender-einrichten.log`. Secret und Schlüssel gibt es nie aus.

Dass dabei erst gebaut und dann eingespielt wird, also andersherum als in
Schritt 1 und 2 unten, ist gefahrlos: Ohne `GOOGLE_*`-Variablen fasst der neue
Code die Tabellen nicht an, und die Variablen kommen erst nach den Tabellen.
(Die Cron-Route fragt die Tabelle zwar auch ohne Variablen ab, aber sie ruft
vor dem Skript niemand, denn die Crontab-Zeile setzt erst das Skript.)

**crond und die Crontab.** Wie crond auf DSM 7 neu geladen wird, ist für die
beiden älteren Zeilen nicht festgehalten. Das Skript versucht `synosystemctl
restart crond`, dann `systemctl restart crond`, dann `synoservice --restart
crond`, und sagt, welcher Weg gegriffen hat. Greift keiner, hält es nicht an;
dann zeigt `sudo tail -n 3 /volume1/docker/schulapp/kalender.log` nach der
nächsten Viertel nach, ob die Zeile trotzdem wirkt. Zweierlei ist dabei nicht
belegt, und das Skript glaubt es deshalb nicht, sondern sieht nach:

- Ein Neustart von crond beendet unter systemd auch Läufe, die crond gerade
  gestartet hat. Arbeitet `erinnerungen.sh`, `wiki-uebergabe.sh` oder
  `kalender.sh` (per `pgrep`), wartet das Skript bis zu drei Minuten; arbeitet
  danach noch einer, lässt es crond in Ruhe und sagt es.
- Ob DSM beim Neustart von crond `/etc/crontab` aus der Datenbank des
  Aufgabenplaners neu schreibt — die Datei trägt dessen Zeilen
  (`synoschedtask --run id=…`) —, weiß niemand. Täte es das, wären alle drei
  Schulapp-Zeilen weg. Das Skript vergleicht die Datei deshalb nach dem
  Neustart mit dem Stand davor. Fehlt danach eine Zeile, legt es den Stand von
  davor zurück, hebt DSMs Fassung als `/etc/crontab.nach-crond-<zeit>` auf,
  startet crond **nicht** noch einmal neu und hält an. Was auf dem echten NAS
  geschah, gehört dann hierher.

**Werkzeuge.** `diff` und `cmp` braucht das Skript nicht: Ob DSM sie hat, ist
für dieses NAS nicht belegt (`nas.sh` nimmt `cmp` nur für einen Hinweis,
`jev-und-docling.sh` vergleicht mit `md5sum`). Was es sonst braucht (`awk`,
`sed`, `mktemp`, `curl`, `seq`, `tee` …), prüft es in Schritt 0, bevor es etwas
ändert.

**Die Störungsnotiz** von `kalender.sh` heißt `SCHULAPP-STOERUNG-KALENDER.md`
und liegt neben der `SCHULAPP-STOERUNG.md` von Erinnerungen und Wiki-Übergabe,
nicht darin. Wie die beiden anderen ihre Notiz schreiben und woran sie „heute
schon eine" erkennen, steht nur auf dem NAS; mit einer eigenen Datei hängt
keiner der drei Auslöser davon ab.

> **Wie weit geprüft.** Gelaufen ist das Skript an einem nachgebauten NAS
> (Docker, curl, psql, crond und pgrep als Attrappen, Compose-Dateien mit
> echter YAML-Prüfung), in 55 Abläufen mit 389 Prüfungen — darunter ein crond,
> der beim Neustart die Crontab neu schreibt, ein Auflegen mitten im
> Neuerzeugen der App und ein System ohne `diff` und `cmp`. Die Attrappe läuft
> am Mac (bash 3.2, BSD-Werkzeuge); DSM-Eigenheiten zeigt sie nicht. Auf dem
> echten NAS ist das Skript noch nicht gelaufen.

Die Handschritte erklären, was das Skript tut, und helfen weiter, wenn es
irgendwo anhält. Befehle mit `docker` stehen in der Form, die auf diesem NAS
geht: `sudo` kennt `/usr/local/bin` nicht, und den Ordner darf nur root
betreten.

1. **Die Tabellen einspielen**, per psql in einer Transaktion (die Zeilen
   stehen im Kopf von `scripts/google-kalender-tabellen.sql`), und mit `\d`
   nachsehen. Zuerst, weil `/einstellungen` mit gesetzten Variablen und ohne
   Tabellen mit 500 antwortet; ohne Variablen fasst die Seite sie gar nicht an.
   Die Zeile im Kopf der SQL-Datei stimmt so: Liest psql ohne `-c` und `-f`
   aus einer Umleitung (`exec -T`, kein Terminal), behandelt es stdin wie
   `-f -`, und `--single-transaction` gilt für die ganze Datei (nachgesehen in
   `src/bin/psql/startup.c`, REL_13 bis REL_18). Nur in einem Terminal, ohne
   Umleitung, bricht psql mit „-1 can only be used in non-interactive mode" ab —
   dann ist nichts eingespielt. Das Skript schreibt `-f -` trotzdem dazu; es
   sagt ausdrücklich, was gemeint ist.
2. `sudo ~/nas.sh hoch`.
3. **Die Werte in die `.env` eintragen** — mit einem Editor (`sudo vi
   /volume1/docker/schulapp/.env`), nicht per `echo` (sonst stehen sie in der
   Shell-History) — und drei Zeilen in die `docker-compose.override.yml` unter
   `services.app.environment`, neben das, was Jev und Docling dort haben (die
   Datei nicht neu schreiben):
   ```yaml
   GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
   GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
   GOOGLE_TOKEN_KEY: ${GOOGLE_TOKEN_KEY:-}
   ```
   Danach nur die App neu erzeugen, nicht alle Dienste:
   ```bash
   sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose up -d app'
   ```
4. **Probe aus dem Container**, ob Google erreichbar ist (erwartet: `400`, denn
   die Anfrage ist absichtlich leer):
   ```bash
   sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec -T app node -e "fetch(\"https://oauth2.googleapis.com/token\",{method:\"POST\"}).then(r=>console.log(r.status))"'
   ```
5. In den Einstellungen **verbinden** — von einem Gerät, auf dem Tailscale an
   ist, und **im Browser** (Safari oder Chrome), nicht aus der installierten
   App vom Home-Bildschirm. Die App ist eine PWA (`display: standalone`); auf
   dem iPhone öffnet sie Google in einem eigenen Fenster, das ihre Cookies
   womöglich nicht teilt, und dann fehlen bei der Rückkehr das Cookie des
   Verbindens und die Anmeldung — die Karte meldet „kam nicht in diesem Browser
   zurück", oder es geht zu `/login`. (Am Handy noch nicht geprüft; vor der
   Abnahme einmal ausprobieren.) Die Verbindung gilt danach für den Nutzer,
   also auch in der installierten App.
6. **Den Cron einrichten:** `kalender.sh` neben die Compose-Datei (`curl
   --max-time 300` gegen `http://127.0.0.1:3000/api/cron/kalender`, Protokoll
   in `kalender.log`, Störungsnotiz in `SCHULAPP-STOERUNG-KALENDER.md` bei
   `exit != 0`), die Zeile
   `15  *  *  *  *  root  /volume1/docker/schulapp/kalender.sh` in
   `/etc/crontab` eintragen, crond neu laden, das Skript einmal von Hand laufen
   lassen, `grep kalender /etc/crontab` und die Sicherung
   `/etc/crontab.sicherung-<datum>` erneuern. Die Fassung von `kalender.sh`
   steht in `kalender_sh_inhalt()` in `scripts/kalender-einrichten.sh` — sie
   liest nur `CRON_SECRET` aus der `.env` und gibt es curl über stdin (`-K -`).
   Der Kopf von `src/app/api/cron/kalender/route.ts` zeigt noch die ältere
   Skizze mit `. .env` und `curl -H "Authorization: Bearer $CRON_SECRET"`;
   damit stünde das Geheimnis in der Prozessliste.

### Wo ein Fehler auftaucht

Nichts scheitert still — die Erinnerungen waren zwölf Läufe tot, ohne dass es
jemand merkte. Ein Fehler steht an vier Stellen:

- in der **Karte** in den Einstellungen: Zustand, letzter Abgleich, letzter
  Fehler, und eine Warnung, wenn der stündliche Cron seit mehr als zwei Stunden
  nicht mehr lief;
- als **eine Push-Nachricht**, wenn die Verbindung in „blockiert" übergeht —
  genau eine, die Datenbank entscheidet, welcher Lauf sie schickt;
- als **500 der Cron-Route**, daraus werden `kalender.log` und die
  Störungsnotiz `topics/schule/SCHULAPP-STOERUNG-KALENDER.md` im Vault
  (höchstens eine am Tag);
- im **Container-Protokoll** mit dem Präfix `Google-Kalender:`
  (`sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose logs app' | grep Google-Kalender`).

**Blockiert** heißt: Ohne einen Handgriff geht nichts mehr, und bis dahin ruft
kein Lauf Google an. Drei Gründe: Google nimmt den Zugang nicht mehr an
(`invalid_grant` — entzogen, oder das Projekt steht noch auf „Testing"; *Neu
verbinden*), der gespeicherte Zugang lässt sich nicht entschlüsseln
(`GOOGLE_TOKEN_KEY` gewechselt; *Neu verbinden*), oder den Kalender „Schule"
gibt es nicht mehr (*Neu anlegen* — die App tut es nicht von selbst, vielleicht
war es Absicht). Jeder Lauf erneuert den Zugang, auch ohne Arbeit; der
stündliche ist damit zugleich die Gesundheitsprüfung.

**Zurückgesetzt wird nur über „Kalender neu anlegen"** in der Karte — ein
frischer Kalender, und das Gedächtnis geht mit. **Nie** über
`delete from google_calendar_events` allein: Was der Nutzer in Google gelöscht
hat, käme dann zurück, und Termine, die es in der App nicht mehr gibt, blieben
in Google für immer stehen, weil niemand mehr weiß, dass sie der App gehören.
Anders als bei `wiki_deliveries` ist diese Tabelle kein Abdruck, den man
wegwerfen kann.

**Ein Neustart mitten im Lauf** (DSM-Update, `nas.sh hoch`) richtet keinen
Schaden an: Jede Zeile wird direkt nach Googles Antwort geschrieben, und die
Queue im Speicher (`@/lib/calendar/queue`), die zwei Läufe nacheinander statt
nebeneinander laufen lässt, geht einfach verloren. Der nächste Auslöser —
spätestens der Cron — macht weiter.

**Wer auf einen Lauf wartet, wartet nicht ewig:** „Jetzt abgleichen" kommt nach
spätestens einer halben Minute zurück (die Karte sagt dann „läuft gerade"), der
Cron nach 285 Sekunden, vor dem `--max-time 300` von curl. Der Lauf arbeitet
dann weiter. Für den Cron ist das ein 500 mit Satz — kommt er jede Stunde,
hängt ein Lauf, und
`sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose restart app'`
löst ihn.

**Trennen** zieht den Zugang bei Google zurück. Bestätigt Google das nicht
(nicht erreichbar, Schlüssel gewechselt), vergisst die App den Zugang trotzdem,
und die Karte sagt, dass er bei Google womöglich noch gilt und unter
myaccount.google.com/permissions von Hand zu entfernen ist.

**Lokal testen** schreibt in das echte Google-Konto und legt dort einen zweiten
Kalender „Schule" an (die lokale Datenbank kennt den vom NAS nicht). Danach in
der App trennen und den Kalender in Google löschen.

## IServ

Seit dem 5.10.2026 (Stufe 5) liest die App, wenn sie eingerichtet ist, IServ
der Schule mit — **nur lesen**, mit dem Konto des Schülers — und trägt in den
Kalender „Schule" ein, **was seine Klasse betrifft**. Der Satz des Nutzers
dazu, wörtlich: „aber nur die für meine Klasse kommen in den Kalender, das ist
wichtig". Jede Regel unten folgt daraus: **Im Zweifel bleibt ein Termin
draußen** und steht in den Einstellungen in einer eigenen Liste, statt fremd
im Kalender.

### Was gelesen wird und was in „Schule" landet

Gelesen werden drei Quellen aus `/iserv/calendar/api/eventsources`:

- **der Gruppenkalender der Klasse** (bei Klasse 10 `/arbeitsmaterial.10/calendar`,
  erkannt an der Zahl am Ende von Name oder Label) — **ganz**;
- **die Aufgaben** (Plugin `exercise`) — **ganz**. Das Format ist eine
  Annahme: Am 5.10.2026 gab es keine offene Aufgabe. Die Feldnamen der ersten
  nicht leeren Antwort zeigt die Karte („Aufgaben-Format erkannt: …");
- **der öffentliche Schulkalender** (`/+public/calendar`) — **gefiltert**. Er
  trägt alles: Elternabende jeder Klasse, Gremien, Kreise,
  Oberstufen-Probeklausuren, Hort. Hinein kommt nur, was
  1. ausdrücklich die eigene Klasse nennt („Kl. 10_…", „10. Klasse",
     „Jg. 10", „Zehntklässler"),
  2. einen Bereich nennt, der sie einschließt („…_7. - 12. Kl",
     „Klassen 1-12", „ab Klasse 7"), oder
  3. für alle gilt UND den Unterricht betrifft: unterrichtsfrei, Ferien (nur
     ganztägig), Schulsamstag, Unterrichtsende, „Schule geschlossen".

  Draußen bleiben jede andere einzelne Klasse (auch als Zahlwort:
  „Achtklassspiel", „Elfte Klasse"), Elternabende — **auch „EA 10. Kl."**,
  denn der ist für die Eltern —, Gremien und Kreise („…kreis", SGK,
  Kollegium, Konferenz, Elternbeirat), Oberstufen-Kurse (LF/gf/LK/GK,
  Abitur), Hort, Ferienbetreuung, Schließzeit, Info- und Einführungsabende,
  und alles, wozu der Titel keinen Bezug zur Klasse erkennen lässt (ein
  Arbeitssamstag, ein Konzert, ein MSA-Termin). Ein Elternabend oder
  Hort-Termin, der ausdrücklich sagt, dass Unterricht ausfällt
  („Elternsprechtag_… Unterricht endet …", „…_Schule und Hort
  geschlossen"), kommt **knapp** hinein — die Karte listet diese eigens.

  **Keine erkannte Klasse heißt nicht „für alle".** Punkt 3 nimmt nur Titel,
  die auch nichts Klassenähnliches tragen. „Klassenfahrt, kein Unterricht",
  „Unterrichtsende für die 12er", „9a_…", „Jahrgänge 11-13", „Q1",
  „Abschlussklassen", „für die 9." sind Zweifel, nie Termine für alle. Eine
  Klasse mit Datum direkt dahinter („Kl. 11_ 19.10.-30.10. …") wird gelesen,
  „Kl. 9 - 10 Uhr" ist Klasse 9, nicht 9 bis 10.

Nicht gelesen werden gesetzliche Feiertage (Plugin `holiday`), weitere
Gruppenkalender (AGs, Kurse), Abos, der Klausurplan (Plugin `exam-plan` —
an dieser Schule gibt es das Modul nicht; erkannt würde es, übernommen noch
nicht, und nie als Prüfung in der App) und die Landesferien aus
`dieschulapp/api/…/vacations`, die an dieser Waldorfschule falsch sind.

Gemessen am echten öffentlichen Kalender vom 5.10.2026 (92 Termine, −14 bis
+180 Tage, nur gelesen, nicht im Repo): **19 hinein (2 davon knapp), 8
Zweifel, 65 draußen** — vor und nach der Verschärfung vom 6.10.2026 gleich.
Die Regeln stehen am Kopf von `src/lib/iserv/klasse.ts`, die Fälle in
`src/lib/iserv/klasse.test.ts` — dort, wie in allen Fixtures, nur erfundene
Titel nach denselben Mustern. **Rohantworten einer echten Probe gehören nie
ins Repo:** Auch der „öffentliche" Kalender ist nur für Mitglieder der Schule
sichtbar.

**Nachsteuern ohne Code:** `ISERV_AUCH` holt Titel hinein, `ISERV_NIE` hält
sie draußen (Titelteile, mit `;` getrennt, als ganzes Wort gesucht; NIE
schlägt AUCH). `ISERV_AUCH` holt **nie eine fremde Klasse oder Stufe**:
„konzert" holt „Konzert der Chor-AG", aber nicht „Konzert der 5. Klasse".
Beispiele: `ISERV_AUCH="msa"`, `ISERV_AUCH="ea 10"`,
`ISERV_NIE="nachschreibetermin"`. Die Liste „Unklar, deshalb nicht im
Kalender" in den Einstellungen ist der Ort, an dem man sieht, was es braucht.

### Wie es im Kalender aussieht

Präfix **„IServ: "** vor dem Titel, Farbe **Pfau**, keine Erinnerung von
Google, frei (`transparent`). **Uhrzeit nur, wenn IServ sie nennt**: mit
Beginn und Ende steht der Termin mit Uhrzeit da; nennt IServ nur einen
Zeitpunkt („Unterrichtsende um 11:30 Uhr", 11:30–11:30), steht er ganztägig
mit der Uhrzeit im Titel („IServ: 11:30 Unterrichtsende um 11:30 Uhr"). Aufgaben
stehen am Abgabetag, mit Uhrzeit als „IServ: Aufgabe bis 23:59: …". Die Event-ID
ist „sai" + 32 Hex aus der uid des Termins (und seinem Vorkommen bei Serien);
`id`, `hash` und `when` aus IServ ändern sich bei jedem Abruf und kommen
deshalb nicht in den Termin — sonst schriebe jeder Lauf jeden Termin neu.

**Freie Tage:** IServ schreibt **nie** in die freien Tage der App
(`free_periods`) — was frei ist, trägt der Mensch von Hand ein. Damit Ferien
nicht doppelt im Kalender stehen, entfällt eine ganztägige **Ferien- oder
Frei-Meldung aus dem öffentlichen Kalender** (Ferien, unterrichtsfrei,
schulfrei, „Schule geschlossen"), wenn die App jeden ihrer Werktage schon als
frei kennt (Herbstferien Sa–Sa sind gedeckt, wenn die App Mo–Fr kennt). Kennt
sie sie nicht, bleibt der IServ-Termin stehen — und ist der Hinweis, dass in
den Einstellungen etwas fehlt. **Nie** entfallen: Termine des
Klassenkalenders (eine Abgabe am letzten Ferientag bleibt), Aufgaben, Termine
mit Uhrzeit, Schulsamstage und alles, was keine Ferien sind (eine Fahrt der
eigenen Klasse während einer Klassenfahrt-Zeit der App).

### Takt, Anmeldung, Sperre

IServ wird **höchstens alle drei Stunden** gefragt, nur zwischen 6 und 21 Uhr
— vom stündlichen Lauf des Kalenders um :15, eine eigene Crontab-Zeile gibt es
nicht. Der allererste Abruf kommt zu jeder Stunde; nach genau einem
Fehlschlag gibt es eine schnelle Wiederholung in der nächsten Stunde. „Jetzt
abgleichen" und die Läufe nach einer Änderung fragen IServ **nie** — sie lesen
den gespeicherten Stand (`iserv_snapshots`).

Eine Anmeldung kostet etwa acht Anfragen und steht in den „Letzten
Anmeldungen" des Schülers. Deshalb lebt die Session im Speicher und wird
wiederverwendet, bis IServ sie verwirft oder sie 15 Stunden alt ist (IServ
beendet sie nach 16); ein Abruf mit gültiger Session sind vier Anfragen. **Kein
Logout im Betrieb** — er nähme der nächsten Stunde die Session. Höchstens eine
Anmeldung je Lauf. Nach der Anmeldung geht nur GET hinaus; der Client wirft,
bevor er etwas anderes als die Anmeldung senden würde.

**Die erste Ablehnung sperrt** — falsches Passwort, zweiter Faktor, Captcha,
gesperrtes Konto, abgelaufenes Passwort. Danach fragt kein Lauf IServ, bis ein
Mensch handelt: sonst sperrte die App das Konto des Schülers mit
Fehlversuchen. Es kommt **eine** Push-Nachricht, die Karte sagt, was zu tun
ist, und der Cron meldet jede Stunde 500. Aufgehoben wird mit „Erneut
versuchen" in der Karte oder `iserv-einrichten.sh --neues-passwort`.

**Schutz gegen „alles gelöscht":** Eine leere Antwort einer Quelle, die
vorher auch nur einen kommenden Termin hatte, oder eine halbierte (ab zehn
Terminen), wird zurückgehalten und erst übernommen, wenn sie dreimal genau so
kommt (also nach frühestens sechs Stunden). Der öffentliche Kalender leer
gilt **nie** — ein Schuljahr ohne Schultermin gibt es nicht. Antwortet IServ
nicht, bleibt der letzte gute Stand im Kalender. **Vergangenes bleibt:** Was
vor dem Fenster (14 Tage zurück) liegt und IServ nicht mehr liefert, bleibt
mit dem Urteil von damals eingefroren stehen.

**Ein Kalender, der fehlt, ist kein leerer Kalender.** Findet die App den
Klassenkalender oder das Aufgaben-Plugin nicht mehr, antwortet ein gerade
genannter Feed mit 404, oder stimmt die Einstellung der Klasse nicht
(mehrdeutig, `ISERV_KLASSENKALENDER` nicht vorhanden, `ISERV_KLASSE` vom
letzten Schuljahr), bleibt der alte Stand, und der Lauf heißt „teilweise"
(Cron 500, Karte). Für die Klasse kommt dazu **eine** Push-Nachricht „IServ:
Klasse prüfen" beim Übergang. Findet die App keinen Kalender der Klasse aus
`ISERV_KLASSE`, aber einen der nächsten, nimmt sie bis zur Korrektur
**keinen** Termin mit der eingestellten Klasse aus dem Schulkalender — sonst
landeten die Termine der neuen 10. Klasse beim Elftklässler. Gibt es den
Klassenkalender wirklich nicht mehr, endet „teilweise" von selbst, sobald
seine Termine vergangen sind; wer nicht warten will, löscht von Hand
`delete from iserv_snapshots where source = 'klasse'` — dann verschwinden
seine Termine aus Google.

### Umgebungsvariablen

| Variable | Pflicht | Inhalt |
|---|---|---|
| `ISERV_URL` | ja | nur der Server der Schule, z.B. `https://iserv.example.de` — ohne Pfad |
| `ISERV_USER` | ja | der Account des Schülers |
| `ISERV_PASSWORD` | ja | sein Passwort. In der `.env` in **einfachen Anführungszeichen**, ohne `'`, ohne Zeilenumbruch, ohne Leerzeichen am Rand — `erinnerungen.sh` liest die `.env` per `.` ein. Steht **nur** hier: nie in der Datenbank, im Protokoll, in der Karte, in der Cron-Antwort, und nie bei einem KI-Agenten (der Web MCP und der Postbote lesen nichts aus IServ). |
| `ISERV_KLASSE` | ja | 1–13. **Zum Schuljahr anheben** (`iserv-einrichten.sh --neue-klasse`); es gibt bewusst keinen Standardwert. Findet die App keinen Kalender der Klasse, aber einen für die nächste, meldet sie es laut (Push, Cron 500, Karte) und nimmt bis zur Korrektur keinen Termin mit der alten Klasse. |
| `ISERV_AUCH` | nein | Titelteile, die immer hineinkommen, mit `;` getrennt |
| `ISERV_NIE` | nein | Titelteile, die nie hineinkommen — schlägt `ISERV_AUCH` |
| `ISERV_KLASSENKALENDER` | nein | die id des Klassenkalenders (`/<gruppe>/calendar`), wenn die Erkennung nicht eindeutig ist |

Lokal in `.env.local`; auf dem NAS in der `.env` **und** unter
`services.app.environment` der `docker-compose.override.yml` als
`NAME: ${NAME:-}`. **Fehlt eine Pflichtvariable, ist IServ aus:** kein Netz,
keine Abfrage der IServ-Tabellen, die Karte nennt nur die fehlenden Namen.
IServ braucht den Google Kalender — ohne Verbindung ruht es.

### Reihenfolge auf dem NAS

Voraussetzung: Der Google Kalender ist eingerichtet (`kalender-einrichten.sh`,
`kalender.sh`, die Zeile in `/etc/crontab`). Dann:

1. **Am Rechner:** den Stand mit der IServ-Anbindung committen und nach `main`
   pushen — das macht der Mensch.
2. **Auf dem NAS:**
   ```bash
   sudo ~/nas.sh hoch
   sudo bash /volume1/docker/schulapp/repo/scripts/iserv-einrichten.sh
   ```

`scripts/iserv-einrichten.sh` sieht zuerst nach, ohne etwas zu ändern (ist
der Kalender eingerichtet, läuft der neue Code, antwortet die Datenbank),
spielt die Tabellen ein, nur wenn sie fehlen (`scripts/iserv-tabellen.sql`, in
einer Transaktion — VOR den Variablen, sonst antwortet `/einstellungen` mit
500), fragt Adresse, Account, Passwort (unsichtbar, zweimal) und Klasse ab,
schreibt sie in die `.env`, trägt die sieben Namen in die Override-Datei ein
(ohne dort etwas wegzunehmen), erzeugt die App neu (ohne Bau), prüft aus dem
Container, ob das Passwort ankam (nur „stimmt"/„stimmt nicht" über eine
Prüfsumme), und ruft zum Schluss `kalender.sh` einmal. Erwartet ist im Feld
`iserv` der Antwort `"status":"gelesen"`. Bei `"blockiert"`: **nicht
wiederholen**, erst Account und Passwort im Browser bei IServ prüfen, dann
`--neues-passwort`. Schalter: `--neues-passwort` (ersetzt das Passwort, hebt
die Sperre auf und macht den Abruf sofort fällig — die Probe am Ende prüft
das neue Passwort gleich), `--neue-klasse`. Eine Adresse schlägt das Skript
nicht vor; sie steht im Browser, wenn man bei IServ angemeldet ist. Das Passwort steht nie im Protokoll,
auf dem Bildschirm oder in einer Prozessliste. Gelaufen ist das Skript noch
nirgends — geprüft sind nur `bash -n` und seine Bausteine.

### Probe am Mac

Was würde die App sehen und eintragen? Nur lesen, ohne Datenbank, ohne
Google, ohne Datei:

```bash
ISERV_URL=https://<server der schule> ISERV_KLASSE=10 npx tsx scripts/iserv-probe.mts [--alle]
```

Account und Passwort fragt sie ab, das Passwort **immer** unsichtbar über die
Tastatur — nie aus der Umgebung und nie ohne Terminal: Auf der Befehlszeile
stünde es in der Shell-History, und startete ein KI-Agent die Probe, in
dessen Protokoll. Sie zeigt die
erkannten Quellen, die nächsten zehn Termine genau so, wie sie in Google
stünden, alle Zweifelsfälle mit Grund und die knapp genommenen; `--alle` jeden
Titel des öffentlichen Kalenders mit Regel. Die freien Tage der App kennt sie
nicht. Zum Schluss meldet sie sich ab. **Jede Probe ist eine Anmeldung** — nicht
in Schleifen starten, nach „abgelehnt" nicht wiederholen.

### Wo ein Fehler auftaucht

- in der **Karte IServ** in den Einstellungen: Zustand, zuletzt gelesen,
  Quellen mit Zahlen, Warnung, letzter Fehler, „seit einem Tag nichts";
- als **eine Push-Nachricht** beim Übergang nach „blockiert", eine, wenn
  seit 24 Stunden kein Stand ankam, und eine, wenn die Klasse nicht mehr
  stimmt („IServ: Klasse prüfen");
- als **500 des Kalender-Crons** (also in `kalender.log` und der
  Störungsnotiz `SCHULAPP-STOERUNG-KALENDER.md`), wenn der Abruf scheiterte,
  nur teilweise gelang, blockiert ist oder seit 24 Stunden nichts kam; im Feld
  `iserv` stehen nur Zustand und ein fester Satz, nie ein Titel;
- im **Container-Protokoll** mit dem Präfix `IServ:` — nur Zustand, Zahlen,
  feste Sätze.

**IServ wieder abschalten:** die `ISERV_*`-Zeilen aus `.env` und
Override-Datei nehmen, App neu erzeugen. Die schon eingetragenen
IServ-Termine **bleiben in Google stehen** (die Art `iserv` fehlt dann im
Abgleich und wird nicht angefasst). Wer sie loswerden will, löscht sie in
Google — dann sind sie verworfen und kommen auch nach einem Wiedereinschalten
nicht zurück — oder legt den Kalender in der Karte neu an.

### Offene Fragen an den Nutzer

Alle lassen sich über `ISERV_AUCH` und `ISERV_NIE` umstellen, ohne Code:

- **„EA 10. Kl."** (Elternabend der eigenen Klasse) bleibt draußen. Hinein mit
  `ISERV_AUCH="ea 10"`.
- Der **MSA-Termin** bleibt draußen (Zweifel). In Berlin ist der MSA am Ende
  von Klasse 10; hinein mit `ISERV_AUCH="msa"`.
- Der **Infotag mit Monatsfeier** (ein Schulsamstag?) und der **Fasching der
  Unterstufe mit „danach kein Unterricht"** bleiben draußen (Zweifel).
- Der **Elternsprechtag** (Unterricht endet früher) und ein **Feiertag mit
  „Schule und Hort geschlossen"** sind knapp drin; der Elternsprechtag steht
  mit seiner Uhrzeit im Kalender.
- Die **Nachschreibetermine** (7.–12. Kl) sind drin; heraus mit
  `ISERV_NIE="nachschreibetermin"`.
- Weitere Gruppenkalender (außer dem der Klasse) und die gesetzlichen
  Feiertage aus IServ werden nicht übernommen.
- Ohne `ISERV_*`-Variablen bleiben schon eingetragene IServ-Termine in Google
  stehen.
- IServ-Termine bekommen keine Google-Erinnerung, auch Aufgaben nicht.

## Betrieb

Die App läuft seit dem 30.8.2026 auf einem Synology-NAS im Heimnetz, in zwei
Containern: `app` (Next auf Port 3000) und `db` (Postgres 18). Nach außen führt
ein Tailscale Funnel unter `https://treskownas.tail3a40b0.ts.net` — der Router
bleibt dabei zu, es gibt keine Portfreigabe.

```
/volume1/docker/schulapp/
  repo/                <- der Klon dieses Repos, zugleich der Build-Kontext
  docker-compose.yml   <- beide Container; liegt NUR auf dem NAS
  .env                 <- die Geheimnisse; liegt NUR auf dem NAS
  data/postgres.alt-…  <- die ALTEN Datenbankdateien, seit 11.9.2026 stillgelegt
  wiki-uebergabe.sh    <- was die Crontab-Zeile um 02:30 ruft
  wiki-uebergabe.log   <- eine Zeile je Lauf: Zeit, Rückgabewert, Antwort
  erinnerungen.sh      <- dasselbe, stündlich, für die Erinnerungen
  erinnerungen.log     <- ebenso; beide beschneidet ihr Skript auf 500 Zeilen
  kalender.sh          <- dasselbe, stündlich um :15, für den Google Kalender
  kalender.log         <- ebenso, auch auf 500 Zeilen beschnitten

/volume1/@docker/volumes/schulapp_pgdata/_data   <- die Datenbank selbst,
                          bewusst AUSSERHALB der Freigabe; warum, steht unten
```

**Nur `repo/` kommt aus Git**, alles andere gehört zu dieser einen Maschine. Die
Compose-Datei beschreibt sie, und die `.env` trägt die Geheimnisse — darunter
die VAPID-Schlüssel und das `CRON_SECRET`, die beim Umzug **neu erzeugt wurden**.
Die Werte in der lokalen `.env.local` sind seitdem nicht mehr die gültigen. Die
Skripte und ihre Protokolle hängen genauso an diesem NAS: Sie kennen
seine Pfade, seinen Vault und die Crontab-Zeilen, die sie rufen. Im Repo wären
sie eine Anleitung, die für jede andere Maschine falsch ist — dieselbe
Begründung wie bei der Compose-Datei, und ein Protokoll ist ohnehin ein
Messwert und kein Quelltext.

Eine neue Fassung geht so hinein (SSH ist in DSM vorher kurz einzuschalten):

```bash
ssh leonard@192.168.178.90
cd /volume1/docker/schulapp
sudo git -C repo pull
sudo docker compose up -d --build
```

Gebaut wird mit dem `Dockerfile` im Repo — zweistufig, Node 22 auf Alpine, und
der Server läuft als Benutzer `node` statt als root. Auf dem NAS überschreibt
die Compose-Datei das allerdings mit `user: "1026:100"` — Leonard und die Gruppe
`users` —, weil der Container in den abgeglichenen Vault schreibt und die
Dateien dort einem Menschen gehören müssen; die Begründung steht im Kopf von
`src/app/api/cron/wiki/route.ts`. Eine Sache muss die Compose-Datei dabei
mitgeben, und sie fällt sonst niemandem auf:

```yaml
build:
  args:
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
```

Next backt jeden `NEXT_PUBLIC_`-Wert beim **Bauen** ein. Steht der Schlüssel in
der Compose-Datei nur unter `environment`, ist er zur Laufzeit zwar gesetzt und
wirkt trotzdem nicht: die Anmeldung für Push scheitert still, und in den
Einstellungen steht nur noch der Satz über die fehlenden Schlüssel. Das
Dockerfile schreibt deshalb drei Warnzeilen ins Bau-Protokoll, wenn das Argument
leer ankommt.

> **Erledigt:** Auf dem NAS lag ein unversioniertes `Dockerfile` im selben
> Ordner, von Hand angelegt, bevor eines im Repo stand — und solange es so hieß,
> brach `git pull` dort mit „untracked working tree files would be overwritten"
> ab. Die Handfassung steht inzwischen unter eigenem Namen daneben
> (`Dockerfile-vom-NAS-20260905-214552`), im Repo-Ordner liegt das eingecheckte,
> und der Pull läuft durch — am 11.9.2026 zuletzt, drei Commits auf einmal.

Der Postbote läuft ebenfalls auf dem NAS, unter `/volume1/docker/postbote` mit
einer eigenen `zugang.json`. Ein zweiter darf nirgendwo sonst laufen; warum,
steht in [harness/README.md](harness/README.md). Und weil ein Zugang immer für
die Adresse gilt, unter der zugestimmt wurde, braucht er nach dem Umzug eine
**neue** Zustimmung gegen die NAS-Adresse — die alte zeigt auf Vercel und wird
nirgends automatisch nachgezogen.

### Vier Wörter vom Handy aus

Die vier Zeilen oben stimmen, aber sie haben zwei Lücken, die erst auffallen,
wenn kein Rechner da ist: Auf einer Glastastatur sind sie zu lang, und einen
Rückweg haben sie nicht. Im ganzen Repo stand bis zum 15.9.2026 nirgends, wie
man einen Stand wieder loswird, den man gerade live geschoben hat.

`scripts/nas.sh` fasst beides zusammen. Es läuft **auf dem NAS** und braucht
root. Eine Kopie liegt dort als `~/nas.sh`, und das ist kein Luxus: Der Klon
unter `/volume1/docker/schulapp` gehört root und ist ohne sudo nicht einmal
lesbar — man käme sonst an das Skript nicht heran, mit dem man ihn aktualisiert.

| Wort | Was es tut |
|---|---|
| `stand` | Welcher Commit ist live, laufen die Container, antwortet die App, wann hat der Postbote zuletzt gearbeitet. Ändert nichts. |
| `hoch` | Pull, Bau, Start — und danach warten, bis die App wirklich antwortet, und die Harness-Kopie des Postboten angleichen. Ging der Bau schief, baut das nächste `hoch` nach. Fehlt der Datenbank eine Spalte, die der neue Stand braucht, hält es vor dem Bau an. |
| `zurueck` | Auf den Stand vor dem letzten `hoch` — mit dem Rückfallbild in Sekunden, sonst per Neubau. |
| `postbote` | Postbote anschalten, und vorher die liegengebliebene `lauf.lock` wegräumen. |

Fünf Dinge darin sind keine Abkürzung, sondern eine Richtigstellung:

**Der Rückweg wird vor dem Pull gemerkt, nicht danach.** `HEAD@{1}` taugt dafür
nicht — nach einem Pull, der nichts geholt hat, gibt es den Eintrag gar nicht.

**`zurueck` koppelt HEAD ab, mit Absicht.** Ein `reset --hard` auf `main` würde
beim nächsten Pull kommentarlos wieder auf den kaputten Stand vorspulen. Der
nächste `hoch` holt HEAD von selbst auf `main` zurück.

**Was läuft, sagt nicht der Klon.** Am 5.10.2026 scheiterte ein Bau an einem
Netzaussetzer — *nachdem* der Pull schon durch war. Der Klon stand auf dem neuen
Stand, die App lief auf dem alten, und ein zweites `hoch` sah „nichts Neues" und
baute nicht. Seitdem merkt sich `nas.sh` in `.gebauter-stand`, welcher Commit
gebaut ist, und zwar mit der ID des Bildes dazu: Baut jemand an `nas.sh` vorbei
von Hand (die vier Zeilen oben), passt die ID nicht mehr, und der Zettel gilt
als unbekannt statt als falsch. `stand` sagt, wenn Klon und App auseinanderliegen,
und welches Wort es behebt.

**Das Rückfallbild.** Ein Bau, der *scheitert*, ist harmlos: der alte Container
läuft weiter. Gefährlich ist der Bau, der *gelingt* und eine kaputte App
hochbringt — dann trägt das Vorgängerbild keinen Namen mehr. `hoch` taggt
deshalb vor dem Bau das Bild, das gerade läuft, als `<name>:rueckfall`; welcher
Commit darin steckt, steht in `.rueckfall-stand`. `zurueck` nimmt dieses Bild,
wenn es genau zum Ziel passt: zurücktaggen und `up -d` ohne `--build`, Sekunden
statt eines zweiten Baus. Zwei Regeln halten
den Rückweg sauber: Rückweg wird nur ein Stand, der vor dem Bau *geantwortet*
hat — sonst bleibt der alte stehen. Und ein Rückfallbild bekommt nur ein Stand,
den `nas.sh` selbst gebaut hat; ist er bloß angenommen (der erste Lauf, nach
einem Handbau), baut `zurueck` lieber neu, als ein falsches Bild zu starten.

(Vom 16.9. bis zum 5.10.2026 fehlte das Taggen ganz: Beim Umbau in `1700f06`
verschwand die Funktion, der Aufruf blieb, und `hoch` meldete
`sichere_bild: command not found`.)

**Die Kopie veraltet still.** `~/nas.sh` ist eine Kopie, kein Link. `hoch`
vergleicht sie am Ende mit `scripts/nas.sh` im Klon und druckt den
`sudo cp`-Befehl, wenn die beiden auseinanderliegen.

**App und Postbote wechseln zusammen.** Unter `/volume1/docker/postbote/harness`
liegt ebenfalls eine Kopie, und seit dem 6.10.2026 entscheidet die App, welche
Seiten der Postbote bekommt — ein Postbote vom alten Stand liest Seiten, die
die App längst gelesen hat. `hoch` gleicht die Kopie deshalb selbst an, sobald
die neue App antwortet: Prüfsummen von `*.mts` und `README.md` vergleichen
(über die Dateien, die der Klon hat — eine Datei, die aus dem Repo
verschwindet, ließe sonst jedes `hoch` scheitern), bei einem Unterschied die
alte Fassung nach `harness-alt-<Zeit>` sichern, den Postboten anhalten, kopieren,
nachrechnen und über `postbote` wieder starten. `zugang.json`, `gesehen.json`
und `lauf.lock` kopiert es nie. Geht das Kopieren schief, legt es die alte
Fassung zurück und startet den Postboten mit ihr. Und weil die erste Fassung
mit diesem Abgleich von einer älteren `~/nas.sh` gebaut werden kann, holt ein
`hoch` ohne Neues den Abgleich nach, wenn die App antwortet — nach einem Blick
in die Datenbank, denn dort läuft die neue App schon. `zurueck` gleicht die
Kopie genauso an den alten Stand an, sobald der wieder antwortet: ein neuer
Postbote gegen eine alte App liefe sonst in ein Werkzeug, das sein Käfig nicht
erlaubt, und jeder Lauf endete als „nichts“. Scheitert `hoch` vorher (Spalte
fehlt, Bau schief, App antwortet nicht) und ist der Postbote aus, sagt es das
und nennt `sudo ~/nas.sh postbote`.

**Vor dem Bau sieht es in die Datenbank.** Additive Spalten verträgt der alte
Code; der neue scheitert ohne sie an jeder Seite. Liegt im neuen Stand eine
SQL-Datei, die in `PFLICHTSPALTEN` steht (bisher nur
`scripts/leser-tabellen.sql` für `material_pages.leser`), und fehlt die Spalte,
hält `hoch` vor dem Bau an, druckt die Zeile zum Einspielen mit Benutzer und
Datenbank aus dem db-Container, und das nächste `hoch` baut nach. Antwortet die
Datenbank nicht, sagt es das und baut trotzdem — eine Prüfung, die selbst
klemmt, soll nicht jeden `hoch` sperren.

> **Wie weit gelaufen.** `stand`, `hoch` und `postbote` laufen auf dem NAS
> seit dem 16.9.2026. Die Fassung vom 5.10.2026 — Nachbauen nach gescheitertem
> Bau, Rückfallbild, `zurueck` ohne Neubau — ist am nachgebauten NAS geprüft
> (Git echt, Docker und curl als Attrappe, 22 Abläufe mit 57 Prüfungen, dazu
> zwei Runden Gegenlesen), auf dem echten noch nicht. Ebenso die Fassung vom
> 6.10.2026 mit Spaltenprüfung und Abgleich: fünfzehn Abläufe mit 97 Prüfungen
> (Git und md5sum echt; Docker, curl und psql als Attrappe — fehlende Spalte,
> auch im Zweig „Nichts Neues“, Datenbank stumm, Kopieren scheitert
> mittendrin, Anhalten scheitert, kein Postbote, Bau scheitert, Abgleich
> nachholen, eine liegengebliebene alte Datei beim Postboten, `zurueck` samt
> Postbote, der Hinweis auf einen ausgeschalteten Postboten), dazu fünf
> absichtlich beschädigte Fassungen, die alle auffielen. Auf dem echten NAS
> noch nicht.

### Der Ausfall vom 11.9.2026 — die Freigabe entzieht der Datenbank die Rechte

Am 11.9.2026 antwortete die App ab 17:38 auf **jeder** Seite mit 500. Der
Vorfall ist hier so ausführlich festgehalten, weil seine Ursache zwei Stunden
vor der Wirkung liegt und der Zusammenhang deshalb nicht zu sehen ist.

**Was geschah.** Der gemeinsame Ordner `/volume1/docker` bekam um 15:17 eine
Synology-ACL, die sich nach unten vererbte. In `data/`, `data/postgres/` und
`data/postgres/18/` standen danach nur noch Einträge für `root` — kein
`everyone`, wie ihn die Nachbarordner behalten haben. Im ACL-Modus zählen die
`777`-Bits nicht mehr, und Postgres läuft im Bild als uid 70. Es stand damit in
keinem einzigen Eintrag und kam an sein eigenes Datenverzeichnis nicht mehr
heran.

**Warum erst zwei Stunden später.** Ein laufendes Postgres hält seine Dateien
offen und merkt entzogene Rechte nicht. Es stolpert erst beim nächsten
Checkpoint — um 17:37:59:

```
PANIC:  could not open file ".../18/docker/global/pg_control": Permission denied
LOG:    checkpointer process (PID 120) was terminated by signal 6: Aborted
FATAL:  could not stat data directory "/var/lib/postgresql/18/docker": Permission denied
mkdir: can't create directory '/var/lib/postgresql/18/': Permission denied
```

Danach lief der Container in einer Neustartschleife, und die App meldete
`getaddrinfo ENOTFOUND db` — den Namen `db` gibt es im Docker-Netz nur, solange
der Container läuft.

**Warum es wie ein Fehler im Code aussah.** Am selben Tag waren drei Commits
aufs NAS gezogen und neu gebaut worden. Die fassen aber nur `harness/` und
`scripts/` an, keinen App-Quelltext — der Neubau war unschuldig.

**Woran man es erkennt.** Die Startseite zeigte `ERROR 1912664400`, `/login` den
Digest `2211390317`. Das sind keine Fehlernummern, sondern Next-Digests,
gebildet aus dem jeweiligen Fehler — zwei verschiedene Stacks, dieselbe Wurzel.
Die verräterische Messung dauert zehn Sekunden:

| Antwort | Bedeutung |
|---|---|
| `/manifest.webmanifest`, `/favicon.ico` → 200 | Server und Funnel sind gesund |
| jede gerenderte Seite → 500 in ~0,3 s | zu schnell für einen Timeout, also kein Netz-Problem |
| **auch `/login` → 500** | die Datenbank; `login/page.tsx` ruft als erstes `hasAccount()` |

Dass sogar die nackte Anmeldeseite fällt, ist der Fingerzeig: Ohne Postgres
kommt sie keinen Schritt weit.

**Warum es den Postboten nicht traf.** Er läuft als uid 1000 und schreibt nach
`/volume1/docker/postbote/claude-home`. Dieser Ordner ist Linux-Modus geblieben,
und die ACL des Elternordners lässt `everyone` wenigstens durchlaufen. Postgres
dagegen musste durch drei Ebenen, die ihm genau das verwehrten.

**Was dagegen getan wurde.** Auf `data/`, `data/postgres/` und `data/postgres/18/`
steht nun je ein ergänzter Eintrag für uid 70:

```bash
synoacltool -addace <pfad> "user:70:allow:rwxpdDaARWc--:fd--"
```

Ergänzt und nicht gelöscht — das ist umkehrbar und lässt die übrigen Einträge
stehen. Die Datenbank kam ohne Datenverlust hoch, die Wiederherstellung lief
sauber durch, und ein anschließender sauberer Neustart brauchte gar keine mehr.

Das war allerdings ein Pflaster: Drei Einträge, die ein Klick in DSM auf
*Ordnerrechte → auf Unterordner anwenden* wieder überschreibt. Deshalb ist die
Datenbank am selben Abend aus der Freigabe herausgezogen worden.

### Die Datenbank liegt seit dem 11.9.2026 in einem Docker-Volume

`db.volumes` zeigt nicht mehr auf `./data/postgres`, sondern auf das Volume
`pgdata`. Dessen Dateien liegen unter
`/volume1/@docker/volumes/schulapp_pgdata/_data` — **außerhalb jeder Freigabe**,
und der ganze `@docker`-Zweig ist nachgemessen Linux-Modus ohne eine einzige
ACL. Dorthin reicht keine Rechtevergabe aus DSM, und damit ist der Ausfall von
oben strukturell nicht mehr möglich, statt nur repariert.

So lief der Umzug — nachvollziehbar, falls er je rückgängig gemacht werden muss:

```bash
cd /volume1/docker/schulapp
sudo docker volume create --label com.docker.compose.project=schulapp \
     --label com.docker.compose.volume=pgdata schulapp_pgdata
sudo docker compose stop app db          # sauber anhalten, nicht abwürgen
# erst weiter, wenn im Log "database system is shut down" steht
sudo docker run --rm -v /volume1/docker/schulapp/data/postgres:/von:ro \
     -v schulapp_pgdata:/nach alpine:3 sh -c 'cp -a /von/. /nach/'
# dazwischen die docker-compose.yml ändern, siehe darunter
sudo docker compose up -d
sudo mv data/postgres data/postgres.alt-20260911   # erst nach der Prüfung
```

Die Etiketten beim `volume create` sind kein Schmuck: Ohne sie hält Compose das
Volume für fremd und legt daneben ein eigenes an — mit einer leeren Datenbank.

In der Compose-Datei wurde aus der einen Zeile unter `db.volumes`

```yaml
    volumes:
      - pgdata:/var/lib/postgresql   # vorher: ./data/postgres:/var/lib/postgresql
```

und am Dateiende kam der Block dazu, der das Volume überhaupt erklärt:

```yaml
volumes:
  pgdata:
```

**Gemessen wurde dabei:** 1403 Dateien auf beiden Seiten, **jede einzelne
Prüfsumme gleich**, Eigentümer erhalten. Postgres meldete beim Start
„Skipping initialization" — es hat den Bestand also erkannt und nicht neu
angelegt — und kam ohne Wiederherstellung hoch. Alle elf Tabellenzahlen vorher
und nachher identisch. Ausfall: **51 Sekunden**. Ein anschließender Neustart des
Containers lief sauber durch.

Der alte Ordner ist **nicht gelöscht**, er steht als
`data/postgres.alt-20260911` daneben (74 MB) — und dass die App nach dem
Umbenennen unverändert weiterlief, ist zugleich der Beweis, dass wirklich das
Volume gelesen wird.

**Sicherungen dieses Tages**, beide auf dem NAS und damit nicht gegen einen
Plattenschaden gut:

- `/volume1/docker/schulapp/abzug-20260911-vor-umzug.dump` — 9,4 MB, 132
  Objekte, `pg_dump --format=custom` aus der wieder gesunden Datenbank.
- `/volume1/docker/schulapp-postgres-20260911-1800.tgz` — 26 MB, 1434 Dateien,
  der Dateistand vor jedem Eingriff.

**Und eine Lücke, die der Vorfall sichtbar gemacht hat:** Von 17:38 bis zur
Meldung durch einen Menschen hat niemand etwas bemerkt. `erinnerungen.log`
schrieb um 18:05 brav `exit=22 curl: (22) … error: 500`, und
`wiki-uebergabe.log` hätte um 02:30 dasselbe getan. Gelesen wird beides nicht.

## Stand

Umgesetzt sind Anmeldung, Fächerverwaltung, App-Hülle und PWA.

**Klausuren und Lernphasen** — Termine mit Themen, automatisch verteilte
Lernblöcke, Countdown, Nachfrage bei verpassten Lerntagen, tägliche Erinnerung
per Push.

**Stundenplan** — festes Wochenraster Mo–Fr, ein Feld antippen bearbeitet es,
das Stundenraster ist einstellbar (1 bis 12 Stunden). Für Waldorfschulen trägt
*Epoche wechseln* den Hauptunterricht in einem Zug auf ein anderes Fach um,
statt Feld für Feld: man hakt die Stunden ab, die mitwandern sollen, und die
Fachstunden desselben Fachs bleiben stehen.

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

**Web MCP** — die App bietet ihre Fähigkeiten als Werkzeuge an, und ein Agent
in der Claude-App benutzt sie: elf zum Lesen, eines legt einen Vorschlag in
den Eingangskorb. Verbunden wird über die Zustimmungsseite `/verbinden`,
getrennt unter *Einstellungen*. Wie das im Einzelnen läuft, steht oben unter
*Der Web MCP*.

**Der Postbote** — dasselbe ohne Handgriff. Ein Programm auf dem eigenen
Rechner sieht alle 15 Sekunden in den Korb und setzt Claude auf jedes Blatt an,
das noch keinen Vorschlag hat; es gehört nicht zur App, sondern benutzt sie von
außen durch dieselbe Tür. Es steht in [`harness/`](harness/README.md) und läuft
nur, wenn man es startet.

**Ein Leser je Seite** — seit dem 6.10.2026 liest die App sauberen Druck selbst
(Docling) und schreibt ihn gekennzeichnet als Abschrift; der Postbote bekommt
nur noch Handschrift, Formeln und alles Unsichere. Ein Blatt, das ganz gedruckt
ist, ordnet die App mit Jev ein, ohne dass Claude es je sieht. Wie sie
entscheidet und was sie dabei festhält, steht oben unter *Ein Leser je Seite*.

**Von selbst aktuell** — Ablage, Blattseite, Eingangskorb und Vorschlagsseite
fragen `/api/material/stand`: alle 5 Sekunden, solange ein Blatt gelesen wird,
sonst alle 30, und nur bei sichtbarem Tab. Der Stand ist ein Fingerabdruck aus
einer einzigen Abfrage über die Blätter; neu geladen wird nur, wenn er sich
geändert hat. Wer gerade tippt oder Ungespeichertes im Formular hat, bekommt
statt des Nachladens einen leisen Hinweis — Eingaben gehen vor.

**Google Kalender** — Klausuren, offene Hausaufgaben und freie Tage stehen
als ganztägige Termine in einem eigenen Kalender „Schule" im Google Kalender,
nach jedem Speichern und stündlich abgeglichen. Was der Nutzer dort löscht,
bleibt draußen. Verbunden wird unter *Einstellungen*; wie es läuft, steht oben
unter *Google Kalender*. Gebaut sind Stufe 1 (Verbinden), 2 (der Bestand) und
5 (IServ: was die Klasse betrifft, nur lesen — Abschnitt *IServ*);
Schulhomepage und Termine von Blättern folgen als weitere Quellen.

Alles steht auch auf der Startseite: als Kachel, in der Tagesspur, auf der
Kameraseite und im Dashboard. Damit sind die vier geplanten Ausbaustufen aus
KONZEPT.md gebaut und die fünfte dazu — Themen-Vokabular, Ablage, Eingangskorb
und der Weg für einen Agenten. Was jetzt aussteht, ist keine Stufe mehr,
sondern eine Messung: ob die Erkennung auch bei Formeln taugt.
