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

3. **Jemand sieht hin.** Läuft [der Postbote](harness/README.md), schaut er alle
   zwei Minuten in den Korb und setzt Claude auf jedes Blatt an, das noch keinen
   Vorschlag hat. Er liest das Blatt, entscheidet über das Fach, schlägt Titel
   und Themen vor, **schreibt jede Seite wörtlich ab** und vermerkt in einer
   Notiz, was er **nicht** sicher weiß.

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
| `npm test` | 659 Tests in 128 Suiten — die reine Rechnung: Lernplan, Datumsrechnung, Stundenplan, Fälligkeiten, Notenskala, Themen-Titel, Bildmaße, die Zahlen der Startseite, das Formular der Ablage, die Vorbelegung aus einem Vorschlag, die Verteilung der Fehlermeldungen, die angehakten Felder des Epochenwechsels — für den Web MCP die Rückadressen, PKCE, der Rückweg nach dem Anmelden, der Umschlag des Protokolls, die Auflösung von Fach und Thema und der Werkzeugkasten — und seit der Abschrift die ⟨spitzen Klammern⟩, die Auslegung der Formularfelder, die Deckung der beiden Schriften, der Bildkopf, der Dateiname und die Markdown-Verpackung feindlichen Textes |
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
      klausuren/      Termine eintragen und ändern
      noten/          Schnitt je Fach und gesamt, eintragen und ändern;
                      fach/ zeigt ein Fach mit allen seinen Noten
      material/       die Ablage: abfotografierte Blätter mit Fach, Themen
                      und Datum; [id] zeigt eins mit allen seinen Seiten,
                      eingang/ ist der Eingangskorb — was noch keiner
                      durchgesehen hat, und die Vorschläge dazu
      faecher/        Fächer mit Farbe, Kürzel und Gewichtung
      einstellungen/  Erinnerungen, Darstellung, Konto, verbundene Programme
    .well-known/      wo ein Agent diese App findet: die Beschreibung des
                      geschützten Servers und die des Ausstellers
    api/
      mcp/            der MCP-Server — eine Adresse, zwölf Werkzeuge
      oauth/          Anmeldung eines Programms und der Tausch von Code
                      gegen Token
      material/       liefert die Bilder aus: /api/material/<seite> das
                      Vollbild, .../vorschau die Vorschau
      push/, cron/    Anmeldung der Geräte, der stündliche Anstoß für die
                      Erinnerungen und die tägliche Übergabe ans Wiki
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
    form-errors.ts  wo eine zod-Meldung landet — unter ihrem Feld oder über
                    dem ganzen Formular (getestet)
    theme.ts        hell, dunkel oder dem Gerät überlassen

harness/          der Postbote — gehört NICHT zur App, sondern benutzt sie
  zugang.mts        einmal zustimmen, danach ein eigener Zugang
  postbote.mts      alle paar Minuten nachsehen und Claude ansetzen
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
laufen: ein kleines Programm auf dem eigenen Rechner, das alle paar Minuten in
den Eingangskorb sieht und Claude auf jedes Blatt ansetzt, das noch keinen
Vorschlag hat.

```bash
npx tsx harness/zugang.mts     # einmal zustimmen
npx tsx harness/postbote.mts   # laufen lassen
```

Es gehört ausdrücklich **nicht zur App**: die App hat keinen Schlüssel und ruft
nie ein Modell. Der Postbote benutzt sie von außen, durch dieselbe Tür wie die
Claude-App, mit eigener Zustimmung und eigenem Trennen-Knopf in den
Einstellungen. Er läuft über Claude Code und damit über das Abo — kein
API-Schlüssel, keine Rechnung.

Der Lauf, in den ein fremdes Blatt gerät, ist dabei leer geräumt: `--tools ""`
nimmt die eingebauten Werkzeuge weg, `--strict-mcp-config` alle anderen Server.
Übrig bleiben die Werkzeuge dieser App, gemessen und nachgezählt. Warum das
nötig ist und was sonst noch dahintersteht, steht in
[harness/README.md](harness/README.md).

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
`oauth_clients`, `oauth_codes` und `oauth_grants`. **Ohne Push bleibt nicht nur
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

/volume1/@docker/volumes/schulapp_pgdata/_data   <- die Datenbank selbst,
                          bewusst AUSSERHALB der Freigabe; warum, steht unten
```

**Nur `repo/` kommt aus Git**, alles andere gehört zu dieser einen Maschine. Die
Compose-Datei beschreibt sie, und die `.env` trägt die Geheimnisse — darunter
die VAPID-Schlüssel und das `CRON_SECRET`, die beim Umzug **neu erzeugt wurden**.
Die Werte in der lokalen `.env.local` sind seitdem nicht mehr die gültigen. Die
beiden Skripte und ihre Protokolle hängen genauso an diesem NAS: Sie kennen
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
Rechner sieht alle zwei Minuten in den Korb und setzt Claude auf jedes Blatt an,
das noch keinen Vorschlag hat; es gehört nicht zur App, sondern benutzt sie von
außen durch dieselbe Tür. Es steht in [`harness/`](harness/README.md) und läuft
nur, wenn man es startet.

Alles steht auch auf der Startseite: als Kachel, in der Tagesspur, auf der
Kameraseite und im Dashboard. Damit sind die vier geplanten Ausbaustufen aus
KONZEPT.md gebaut und die fünfte dazu — Themen-Vokabular, Ablage, Eingangskorb
und der Weg für einen Agenten. Was jetzt aussteht, ist keine Stufe mehr,
sondern eine Messung: ob die Erkennung auch bei Formeln taugt.
