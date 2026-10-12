# Kombi-Vorgabe: Drei Fragen, eine Zeile

Diese Vorgabe ist verbindlich. Sie legt ein UI-Modell fest, das fünf Prototypen zusammenführt: 14 Feierabend, 16 Gespräch, 03 Befehlszeile, 10 Kamera und 19 Abfrage. Wo diese Datei etwas festlegt, gilt sie. Wo sie schweigt, gilt `BRIEF.md` mit Beispieldaten, Nutzungssituation, Verboten und Animationsregeln.

Grundlage ist das Konzept "Drei Fragen, eine Zeile". Es hat in drei Bewertungen 97 von 120 Punkten bekommen, "Unterlage" 95 und "Eine Zeile" 87. Aus den beiden anderen Konzepten kommen die Teile, die in Abschnitt 10 einzeln aufgeführt sind.

Zeilenangaben wie "16 Z. 585" beziehen sich auf `entwurf-modelle/<nummer>-<name>/index.html`.

## 1. Idee

Die App führt den Nachmittag in drei Fragen: "Was ist neu?", "Was ist fällig?", "Was ist zu lernen?". Danach kommt "Fertig für heute." mit dem, was morgen ansteht. Unten liegt auf jedem Ablaufbildschirm dieselbe dunkle Zeile. In ihr trägt man mit einem Satz ein oder sucht, rechts daneben öffnet der Kameraknopf die Kamera. Lernblock und Kartenabfrage finden auf einem eigenen blauen Tisch statt, der aus dem Startknopf wächst.

## 2. Bildschirme und Navigation

### 2.1 Ebenen und Richtungen

Jede Richtung bedeutet immer dasselbe.

| Ebene | Bildschirme | Kommt von | Geht zurück |
|---|---|---|---|
| Ablauf | Neu, Fällig, Lernen, Fertig | seitlich: vorwärts von rechts, zurück von links | Bandsegment oder Zurück-Knopf |
| Werkzeug | Menü der Zeile, Kamera, Material-Sheet | von unten | nach unten |
| Modus | Lerntisch | wächst aus dem Knopf, der ihn startet | schrumpft in denselben Knopf |
| Nachschlagen | Woche, Klausur, Noten, Blatt, Ablage, Fächer, Einstellungen | von rechts | nach rechts, per Zurück-Knopf oder Wisch vom linken Rand |

Es gibt keine Reiterleiste. Zwischen den Ablaufschritten wischt man nicht seitlich, weil Rechtswischen in "Fällig" eine Aufgabe abhakt.

### 2.2 Die Bildschirme

**Kopfzeile.** Sie steht auf allen vier Ablaufbildschirmen über dem Band und ist 36px hoch. Text: "Morgen, Dienstag · 2 Aufgaben offen". Ist der nächste Schultag nicht morgen, steht dort der Tag mit Datum, etwa "Montag, 19.10. · 1 Aufgabe offen". Dieselbe Regel gilt für "Morgen, Dienstag" auf Fertig. Ein Tipp öffnet die Woche mit dem nächsten Schultag ausgewählt. Zweck: "Was habe ich morgen?" ist aus jedem Schritt einen Tipp entfernt.

**Schrittband.** Drei Segmente "Neu", "Fällig", "Lernen", jedes antippbar, Trefffläche 44px hoch. Es zeigt, wo man im Ablauf steht, und springt zu jedem Schritt. Auf "Fertig" verschmelzen die drei Spuren zu einer Linie, die Labels blenden aus.

**Neu ("Was ist neu?").** Listet die Fächer, die heute im Stundenplan standen, in Stundenreihenfolge. Danach die Zeile "Anderes Fach". Jede Fachzeile zeigt den Fachnamen, darunter "Nächste Stunde Donnerstag" und rechts zwei Pillen: "+ Aufgabe" und eine Kamera-Pille. Unter einem Fach erscheint, was heute dazu eingetragen oder abgelegt wurde. Zweck: alles Neue aus der Schule in einem Tipp pro Fach erfassen.

**Fällig ("Was ist fällig?").** Drei Gruppen. "Für Dienstag" mit allen offenen Aufgaben zum nächsten Schultag. "Später" mit allen übrigen offenen Aufgaben, nach Datum sortiert, jede mit Tag im Unterlabel. "Erledigt" mit allem, was seit gestern 00:00 abgehakt wurde. Zweck: abhaken und sehen, was noch fehlt.

**Lernen ("Was ist zu lernen?").** Jede Klausur der nächsten 14 Tage, nach Datum. Je Klausur: Titel, Datum, "in 4 Tagen", Thema, Lernplan als Zeitleiste, Noten im Fach. Darunter die Zeile "12 Karten sind heute dran · 7 Mathematik, 3 Englisch, 2 Biologie", wenn Karten fällig sind. Zweck: den heutigen Lernblock starten oder Karten wiederholen.

**Fertig ("Fertig für heute.").** Zählt in ausgeschriebenen Zahlen auf, was heute passiert ist, und zeigt darunter "Morgen, Dienstag" mit den Fächern des nächsten Schultags und den dafür offenen Aufgaben. Zweck: den Nachmittag abschließen und abends nachsehen.

**Menü der Zeile.** Wächst aus der Zeile nach oben. Zeigt bei leerem Feld "Wohin?" mit allen Bereichen, beim Tippen Treffer oder eine Antwort. Zweck: Eintragen, Suchen und Navigation an einem Ort. Details in Abschnitt 4.

**Kamera.** Dunkle Ebene über allem. Zweck: Blätter aufnehmen. Details in 5.1.

**Lerntisch.** Blaue Vollfläche mit Kartenstapel, im Lernblock zusätzlich mit Restzeit. Zweck: Lernblock und Abfrage an einem Ort. Details in 5.3.

**Woche.** Fünf Tage Mo bis Fr als Segment mit gleitendem Unterstrich, darunter die Stunden des gewählten Tags mit Zeiten, Fach, Raum und den Aufgaben, die zu diesem Tag fällig sind. Nur zum Nachsehen. Route `/stundenplan`.

**Klausur.** Titel, Datum, Thema, kompletter Lernplan, Noten, Blätter zum Thema. Route `/klausuren/[id]`.

**Noten.** Noten je Fach als Zeilen. Route `/noten`, `/noten/fach/[id]`.

**Blatt.** Umschalter "Abschrift | Original", Abschrift vorn. Darunter Fach und Themen mit Fachzeile zum Umsortieren. Route `/material/[id]`.

**Ablage.** Alle Blätter, neueste zuerst, gruppiert nach Fach. Route `/material`.

**Hausaufgabe bearbeiten.** Kein eigener Bildschirm. Linkswisch auf eine Aufgabenzeile legt "Bearbeiten" und "Löschen" frei. "Bearbeiten" öffnet die Zeile mit dem Satz und den Tokens der Aufgabe, Enter heißt dann "Ändern".

**Fächer, Einstellungen.** Bestehende Inhalte, im neuen Raster. Routen `/faecher`, `/einstellungen`.

### 2.3 Wie man wohin kommt

- Woche: Kopfzeile, "Morgen, Dienstag" auf Fertig, Zeile mit "woche" oder "morgen".
- Klausur: Klausurtitel auf Lernen, Zeile mit "klausur".
- Noten: Notenzeile auf Lernen, Zeile mit "noten".
- Blatt: Miniatur unter einem Fach, Treffer in der Zeile, Ablage.
- Ablage, Fächer, Einstellungen: nur über die Zeile ("Wohin?").
- Kamera: Kameraknopf in der Zeile, Kamera-Pille an jeder Fachzeile in Neu.
- Lerntisch: "Lernblock starten" in einer Lernplanzeile, Zeile "12 Karten sind heute dran", Zeile mit "abfragen" oder "karten".

Nachschlagebildschirme haben oben links einen runden Zurück-Knopf (44px) und lassen sich vom linken Rand zurückwischen. Der Rückweg folgt dem echten Verlauf, nicht einer festen Verdrahtung. Esc geht eine Ebene zurück.

### 2.4 Der untere Rand

Auf Ablauf- und Nachschlagebildschirmen ist die Zeile das einzige fest stehende Element unten. Der Knopf zum nächsten Schritt steht nicht fest darüber, sondern am Ende des Inhalts im Scrollbereich: links ein runder Zurück-Knopf (52px), rechts der Primärknopf (52px hoch, flex 1). Ist der Inhalt kürzer als der Bildschirm, steht er 28px unter dem letzten Eintrag. So liegen nie zwei kräftige Ziele übereinander, und auf einem iPhone SE bleibt Platz für den Inhalt.

Auf Kamera und Lerntisch ist die Zeile ausgeblendet.

### 2.5 Startlogik

Die App öffnet dort, wo der Tag steht. Den Stand berechnet der Server aus dem Tagesprotokoll (Abschnitt 5.4), nicht der Browser. Der Tag wechselt um 00:00 Europe/Berlin.

1. Heute war Schule und Neu ist nicht abgeschlossen: öffnet auf Neu.
2. Neu ist abgeschlossen, Fällig nicht: öffnet auf Fällig.
3. Fällig ist abgeschlossen und heute steht ein offener Lernblock an: öffnet auf Lernen.
4. Sonst: öffnet auf Fertig.

Abgeschlossen heißt, der Primärknopf des Schritts wurde gedrückt oder ein späterer Schritt wurde über das Band erreicht. War heute keine Schule, gilt Neu als abgeschlossen und das Segment ist ohne Füllung ausgegraut. In den Ferien öffnet die App auf Fertig mit "Ferien bis Freitag, 30.10." und zeigt keine Aufgaben und keine Lernblöcke (Memory "Ferien ganz frei").

## 3. Ablauf beim Öffnen am Montag um 16:40

Beispieldaten aus `BRIEF.md`. Für Tage außer Montag nimmt diese Vorgabe an: Dienstag Deutsch, Mathematik, Englisch. Biologie wieder am Donnerstag. Heute ist noch nichts passiert.

1. Die App öffnet ohne Splash auf Neu. theme-color ist Papier. Sobald `document.fonts.ready` meldet, staffeln sich Kopfzeile, Band, Überschrift, Fachzeilen und Zeile herein.
2. Kopfzeile "Morgen, Dienstag · 2 Aufgaben offen". Das Segment "Neu" füllt sich blau. Überschrift "Was ist neu?".
3. Fachzeilen: Deutsch "Nächste Stunde Dienstag", Mathematik "Nächste Stunde Dienstag", Biologie "Nächste Stunde Donnerstag", dann "Anderes Fach". Am Ende der Primärknopf "Nichts Neues, weiter".
4. Tipp auf "+ Aufgabe" bei Biologie. Die Zeile bekommt Fokus, die Tastatur kommt. Über dem Feld stehen die Tokens "Eintragen", "Biologie" und "Do 15.10., nächste Stunde". Er tippt "Arbeitsblatt Zellatmung fertig". Die erste Zeile über dem Feld lautet "Eintragen · Biologie · bis Do 15.10.", darunter "Stattdessen suchen: »Arbeitsblatt Zellatmung fertig«".
5. Enter. Der Satz löst sich als Geist aus dem Feld und fliegt unter die Biologie-Zeile. Die Zeilen darunter weichen aus, die neue Zeile leuchtet kurz gelb auf. Die Tastatur schließt. Der Toast "Eingetragen · Rückgängig" steht 10px über der Zeile. Der Primärknopf heißt jetzt "Weiter zu Fällig".
6. Tipp auf die Kamera-Pille bei Biologie. Die Kamera startet schon beim Druck auf die Pille. Die Kamera-Ebene kommt von unten, der Fach-Chip zeigt "Biologie". Er löst zweimal aus, der Stapel zeigt "2". Tipp auf "Ablegen".
7. Die Kamera geht nach unten weg. Eine schiefe Miniatur fliegt unter die Biologie-Zeile, daneben "Wird eingeordnet". Nach unter einer Sekunde blendet der Text auf "Biologie · Zellatmung" und darunter "Abschrift folgt" um.
8. "Weiter zu Fällig". Fällig schiebt sich von rechts herein. "Für Dienstag": Mathe "S. 84, Nr. 3–5", Deutsch "Gedichtanalyse beenden". "Später": Biologie "Arbeitsblatt Zellatmung fertig", Unterlabel "Do 15.10.". "Erledigt": Englisch "Vokabeln Unit 3". Beim ersten Besuch wackelt die erste offene Zeile einmal an.
9. Er wischt Mathe nach rechts. Die Zeile hakt sich ab, nach 350ms rutscht sie zu "Erledigt". Toast "Mathe abgehakt · Rückgängig".
10. "Weiter zu Lernen". Klausur Mathematik, Freitag 16.10., "in 4 Tagen", "Quadratische Funktionen". Lernplan: "Heute · Lernblock · Scheitelpunktform · 25 Minuten" mit blauem Knopf "Lernblock starten", "Mi · Wiederholung", "Do · Probeklausur", "Fr · Klausur". Darunter "Noten in Mathematik 2 · 3+ · 2−". Dann "12 Karten sind heute dran". Am Ende "Heute nicht lernen" und der Primärknopf "Fertig für heute".
11. "Lernblock starten". Der Knopf wächst zum blauen Tisch. Oben die Restzeitlinie und "25:00". Der Stapel zur Scheitelpunktform hebt sich herein. Er dreht Karten um und schätzt ein.
12. Nach der letzten Karte die Zusammenfassung "8 gewusst, 2 unsicher, 2 nochmal. 4 kommen morgen wieder." Er tippt "Block beenden". Frage: "Als erledigt zählen? 25 Minuten gelernt". "Ja". Der Tisch schrumpft in die Planzeile, die jetzt "Erledigt" zeigt.
13. "Fertig für heute". Das Band verschmilzt zur Linie. "Fertig für heute." und gestaffelt: "Eine Aufgabe eingetragen." "Ein Blatt abgelegt, zwei Seiten." "Eine Aufgabe abgehakt." "Lernblock erledigt." Darunter "Morgen, Dienstag": Deutsch, Mathematik, Englisch, offen "Gedichtanalyse beenden".

Öffnet er die App um 20:30 erneut, landet er nach Regel 4 direkt auf Fertig.

## 4. Die Eingabezeile

### 4.1 Aussehen

Eine Pille in `--dock`, 52px hoch, Radius 26px, 16px Abstand links und rechts, unten `max(16px, env(safe-area-inset-bottom))`. Innen 4px Abstand. Links eine Lupe (22px), dann das Feld mit Platzhalter "Eintragen oder suchen", 17px, damit iOS nicht zoomt. Rechts, getrennt durch einen 1px-Strich in `--dock-line`, der Kameraknopf (44×44, Icon `photo_camera`). Die Zeile wird nie neu gerendert. Sie lebt in der Shell, nicht in einer Route.

Attribute am Feld: `role="combobox"`, `aria-controls` auf die Trefferliste, `aria-autocomplete="list"`, `aria-activedescendant` auf die markierte Zeile, `autocapitalize="none"`, `spellcheck="false"`, `enterkeyhint="send"`. enterkeyhint wird nicht umgeschaltet, weil iOS den Wechsel während der Eingabe nicht zuverlässig übernimmt. Die Absicht zeigen allein Token, erste Zeile und Sendeknopf.

Bei Fokus wächst das Menü aus der Zeile. Die Zeile bleibt am Daumen, die Treffer stehen darüber. Die Tastaturhöhe kommt aus `visualViewport` wie in 03 Z. 96: `inset = max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)`, ab 100px wird die Zeile um `inset + 10px` angehoben. Viewport-Meta mit `interactive-widget=resizes-content, viewport-fit=cover`.

### 4.2 Aufbau des Menüs beim Tippen

Von unten nach oben:

1. Das Feld.
2. Der Token-Streifen, `aria-live="polite"`. Das erste Token ist immer die Absicht, die übrigen zeigen, was erkannt wurde.
3. Die erste Zeile. Sie sagt in Worten, was Enter tut, und ist markiert.
4. Die zweite Zeile mit der Gegenrichtung.
5. Weitere Treffer, gruppiert.

Es gibt genau zwei Absichten: Eintragen und Suchen. Fragen und Navigationswörter gehören zu Suchen. Ihre Antwort ist der oberste Treffer.

| Absicht | Token | Sendeknopf | Erste Zeile | Zweite Zeile |
|---|---|---|---|---|
| Eintragen | "Eintragen", gefüllt in `--ink`, Icon `add` | Plus | "Eintragen · Mathematik · bis Di 13.10." mit Aufgabentext darunter | "Stattdessen suchen: »…«" |
| Suchen | "Suchen", nur umrandet, Icon `search` | Pfeil | bester Treffer, z. B. "Zeigt · Dienstag, 13.10." | "Als Aufgabe eintragen", nur wenn ein Fach erkannt wurde |

Ein Tipp auf das Absicht-Token oder auf die zweite Zeile schaltet um, ohne den Satz zu ändern. Pfeiltasten bewegen die Markierung mit Umlauf, Enter löst die markierte Zeile aus, Cmd/Ctrl+K öffnet und schließt das Menü (aus 03 Z. 89 bis 93).

### 4.3 Wie die Zeile entscheidet

Der Parser prüft in dieser Reihenfolge. Die erste Regel, die greift, entscheidet.

1. **Kontext.** Kam man über "+ Aufgabe" oder "Bearbeiten", ist die Absicht Eintragen. Fach und Fälligkeit stehen als Tokens fest. Rücktaste auf leerem Feld entfernt das letzte Token. Erst ein Tipp auf das Absicht-Token wechselt zu Suchen.
2. **Präfix.** Beginnt die Eingabe mit "+", heißt es Eintragen. Beginnt sie mit "?", heißt es Suchen. Das Zeichen wird entfernt.
3. **Frage.** Endet die Eingabe mit "?" oder beginnt sie mit einem Fragewort, heißt es Suchen. Fragewörter: was, wann, wo, wie, wer, welche, welcher, welches, zeig, zeige, hab ich, habe ich, gibt es.
4. **Zielwort am Anfang.** Beginnt die Eingabe mit einem Zielwort, heißt es Suchen. Zielwörter: heute, morgen, übermorgen, woche, stundenplan, noten, klausur, klausuren, blatt, blätter, ablage, karten, abfragen, abfrage, fächer, einstellungen, foto, kamera, lernblock.
5. **Fach am Anfang.** Beginnt die Eingabe mit einem Fach und bleibt nach Abzug von Fach und Fälligkeit mindestens ein Wort übrig, das kein Zielwort ist, heißt es Eintragen.
6. **Sonst** heißt es Suchen.

Fächer kommen aus der Datenbank mit Namen und Aliassen. Vollnamen und Aliasse ("mathe", "bio", "deutsch") zählen als ganzes Wort. Kurzformen mit zwei Buchstaben (ma, de, en, ge, ph, ch, bi) zählen nur als erstes Wort. Alle regulären Ausdrücke laufen mit `u`-Flag und Wortgrenzen über `(?<![\p{L}])` und `(?![\p{L}])`, weil `\b` vor Umlauten nicht greift.

Fälligkeit erkennt der Parser wie in 16 `findDue()` Z. 377 bis 391: "bis/für/zum/am" mit Wochentag, "morgen", "übermorgen", Datum wie "20.10.", auch über den Jahreswechsel. Ohne Angabe gilt die nächste Stunde des Fachs aus dem Stundenplan. Das Token sagt das: "Do 15.10., nächste Stunde". Hat das Fach keine Stunde, steht dort das gestrichelte Token "bis wann?". Der Aufgabentext ist der Rest des Satzes, "3-5" wird zu "3–5".

Normalisierung für Suche und Dublettenprüfung: Kleinschreibung, NFD ohne Akzente, ä/ae, ö/oe, ü/ue und ß/ss gelten als gleich.

### 4.4 Beispiele

| Eingabe | Absicht | Erste Zeile | Warum |
|---|---|---|---|
| mathe s 90 nr 1-4 | Eintragen | Eintragen · Mathematik · bis Di 13.10. · "S. 90 Nr. 1–4" | Regel 5, Fälligkeit aus nächster Stunde |
| bio arbeitsblatt bis donnerstag | Eintragen | Eintragen · Biologie · bis Do 15.10. | Regel 5 |
| Deutsch Gedicht lernen bis 20.10. | Eintragen | Eintragen · Deutsch · bis Di 20.10. | Regel 5 |
| mathe klausur verschieben | Suchen | Klausur Mathematik · Fr 16.10. | Rest enthält Zielwort "klausur" |
| bio | Suchen | Biologie · Fach öffnen | kein Wort nach dem Fach |
| was ist morgen | Suchen | Zeigt · Dienstag, 13.10. | Regel 3 |
| morgen | Suchen | Zeigt · Dienstag, 13.10. | Regel 4 |
| noten mathe | Suchen | Zeigt · Noten Mathematik | Regel 4 |
| scheitelpunkt | Suchen | Blatt "Quadratische Funktionen", Treffer in der Abschrift | Regel 6, Volltext |
| gedichtanalyse | Suchen | Deutsch · Gedichtanalyse beenden · Di 13.10. | Regel 6 |
| ma heft vergessen | Eintragen | Eintragen · Mathematik · bis Di 13.10. | Kurzform als erstes Wort |
| mama anrufen | Suchen | Kein Treffer für "mama anrufen" | "ma" nur als ganzes erstes Wort |
| ?mathe heft | Suchen | Treffer zu "mathe heft" | Präfix |
| +karten erstellen | Eintragen | Eintragen · Fach fehlt | Präfix, Fach-Token "welches Fach?" gestrichelt |
| englisch | Suchen | Englisch · Fach öffnen | kein Wort nach dem Fach |

### 4.5 Rückfrage und Dubletten

Fehlt beim Enter die Fälligkeit, antwortet das Menü über der Zeile "Bis wann ist Bio fällig?" mit drei Antworten: "Morgen", der übernächste Schultag und "Nächste Stunde" falls bekannt, sonst der dritte Schultag. Ein Tipp sendet den Satz mit Datum erneut (aus 16 `answerNeu()` Z. 498 bis 501).

Beim Eintragen prüft die App leise mit. Gibt es eine offene Aufgabe mit gleichem Fach, gleichem Fälligkeitstag und gleichem normalisierten Text, lautet die erste Zeile "Steht schon drin" mit der vorhandenen Zeile. Enter öffnet dann diese Aufgabe in Fällig und legt nichts an (aus 16 Z. 502 bis 504).

Nach jedem Eintragen erscheint der Toast "Eingetragen · Rückgängig", 4,5 Sekunden.

### 4.6 Was die Suche liefert

Treffer bestehen aus denselben Zeilen-Bausteinen wie der Ablauf. Eine Aufgabe im Treffer lässt sich direkt abhaken, ein Lernblock direkt starten. Das gefundene Wort steht in `--ink` 620, der Rest in `--ink-2`.

Gruppen in fester Reihenfolge, leere Gruppen fallen weg:

1. Antwort, wenn die Eingabe eine Frage oder ein Zielwort ist. "morgen" zeigt die Stunden des nächsten Schultags mit den Aufgaben dafür. "noten mathe" zeigt die Notenzeilen. "klausur" zeigt die nächste Klausur mit Lernplan.
2. Aktionen: "Hausaufgabe eintragen", "Blatt aufnehmen", "Karten abfragen", mit Suchwörtern wie in 03 Z. 77 bis 86 (foto, scan, kamera zu Blatt aufnehmen).
3. Aufgaben.
4. Klausuren.
5. Blätter, mit Ausschnitt aus der Abschrift um den Treffer.
6. Themen.
7. Bereiche.

Aufgaben, Klausuren, Fächer, Themen und Bereiche lädt die App beim Start vor und filtert lokal. Blätter sucht der Server über einen Volltextindex in Postgres (`tsvector`, Konfiguration `german`), 150ms nach dem letzten Tastendruck. Bis die Antwort da ist, bleiben die lokalen Treffer stehen.

Das Menü zeigt immer genau eine Antwort. Eine neue Eingabe ersetzt sie. Es gibt keinen Gesprächsverlauf. Schließen verwirft die Antwort.

### 4.7 Leeres Feld: "Wohin?"

Bei leerem Feld zeigt das Menü oben bis zu zwei Vorschläge je nach Schritt, darunter "Zuletzt geöffnet" mit höchstens drei Einträgen, darunter "Wohin?" mit allen Bereichen: Woche, Hausaufgaben, Klausuren, Noten, Ablage, Karten abfragen, Fächer, Einstellungen.

| Schritt | Vorschläge |
|---|---|
| Neu | Morgen, Woche |
| Fällig | Morgen, Gedichtanalyse beenden (älteste offene Aufgabe) |
| Lernen | Lernblock starten, Noten Mathematik |
| Fertig | Morgen, Woche |

Ein Vorschlag fällt weg, sobald er in dieser Öffnung benutzt wurde. "Lernblock starten" heißt "Lernblock fortsetzen" bei laufendem Block und verschwindet nach "Erledigt" (aus 16 `chipHTML()` Z. 552 bis 567).

## 5. Kamera, Feierabend-Schritte, Abfrage

### 5.1 Kamera

**Einstiege.** Der Kameraknopf in der Zeile öffnet die Kamera mit "Fach erkennen". Die Kamera-Pille an einer Fachzeile in Neu öffnet sie mit diesem Fach vorgewählt. Einen dritten Weg gibt es nicht.

**Vorwärmen.** `getUserMedia({video: {facingMode: "environment"}})` startet bei `pointerdown` auf Knopf oder Pille, also vor der Bewegung. Ist noch kein Bild da, zeigt der Sucher eine ruhige dunkle Fläche mit "Kamera startet". Verweigert der Nutzer die Freigabe, zeigt der Sucher "Kein Zugriff auf die Kamera" und den Knopf "Foto auswählen" (`<input type="file" accept="image/*" capture="environment">`).

**Aufbau.** Hintergrund `--camera`. Oben links Schließen (44px). Oben in der Mitte der Fach-Chip mit Menü: alle Fächer und "Fach erkennen". Darunter der Sucher, Radius 3px, 23px Rand, mit vier Rahmenecken in `#FBF9F4`, 23px lang, 2px stark. Die Ecken stehen fest. Sie rasten nur ein, wenn eine echte Kantenerkennung läuft, im ersten Bau also nicht. Unten in der Mitte der Auslöser, 78px Ring mit 2px Rand und innerem Kreis. Links der Seitenstapel mit Zähler, sichtbar ab der ersten Seite. Rechts "Ablegen", sichtbar ab der ersten Seite. Darunter "Aus Fotos" als Textknopf. Die Zeile ist ausgeblendet, theme-color ist `#0B0B0C`.

**Auslösen.** Das Bild friert ein, ein Blitz läuft, die Seite schrumpft in den Stapel, der Zähler springt. Mehrere Seiten werden ein Blatt.

**Ablegen.** Die App lädt die Seiten hoch. Die Kamera geht nach unten weg. Das Blatt fliegt als schiefe 76px-Miniatur dorthin, wo man herkam: unter die Fachzeile in Neu oder, bei Start aus der Zeile, als Zeile "Blatt abgelegt" ganz oben in Neu. Es gibt kein Formular für Titel oder Fach. Jev ordnet ein.

**Status.** Der Text unter der Miniatur folgt dem echten Status vom Server:

| Status | Text |
|---|---|
| hochladen | "Wird hochgeladen" |
| einordnen | "Wird eingeordnet" |
| eingeordnet | "Biologie · Zellatmung", darunter die Fachzeile zum Umsortieren |
| Abschrift läuft | "Abschrift folgt" |
| Abschrift fertig | "Abschrift da" |
| Fehler | "Hängt, wird erneut versucht" oder "Abschrift fehlgeschlagen · Erneut versuchen" |

Es gibt keinen Fortschrittsbalken und keinen laufenden Schimmer. Die Fachzeile zum Umsortieren ist eine Reihe Fach-Pillen mit `aria-pressed`. Ein Tipp auf ein anderes Fach ordnet um und blendet den Titel über (aus 16 `refile()` Z. 819 bis 831). Ein Tipp auf die Miniatur öffnet das Blatt.

### 5.2 Feierabend-Schritte

**Neu.**
- Fächer von heute aus dem Stundenplan, Reihenfolge der Stunden, jedes Fach einmal.
- Unterzeile "Nächste Stunde <Wochentag>" aus der echten Woche berechnet, Ferien übersprungen.
- "+ Aufgabe" öffnet die Zeile im Kontext Eintragen mit Fach und nächster Stunde als Tokens.
- "Anderes Fach" öffnet die Zeile im Kontext Eintragen ohne Fach-Token. Das Token "welches Fach?" steht gestrichelt, darüber eine Reihe Fach-Pillen.
- Unter einem Fach stehen die heute dazu eingetragenen Aufgaben als Aufgabenzeile mit blauem Haken-Icon und die Blätter als Miniatur mit Status.
- Primärknopf: "Nichts Neues, weiter", nach dem ersten Eintrag oder Blatt "Weiter zu Fällig". Der Text wechselt per Überblendung.
- Leerer Zustand ohne Schule heute: Schritt wird übersprungen.

**Fällig.**
- Gruppen "Für <nächster Schultag>", "Später", "Erledigt". Freitags heißt die erste Gruppe "Für Montag".
- Aufgabenzeile: Raster 48px | 1fr | auto, mindestens 60px hoch, Abhakkreis 26px sichtbar in 48px Trefffläche. Fach fett vor dem Text, Unterlabel mit Tag nur in "Später".
- Abhaken per Tipp auf den Kreis oder Wisch nach rechts. Die Zeile bleibt 350ms an ihrem Platz und rutscht dann zu "Erledigt". Toast "<Fach> abgehakt · Rückgängig".
- Ein Tipp auf eine erledigte Zeile öffnet sie wieder.
- Wisch nach links legt "Bearbeiten" und "Löschen" frei. "Löschen" löscht sofort und zeigt den Toast "Gelöscht · Rückgängig".
- Beim ersten Besuch überhaupt wackelt die erste offene Zeile einmal an. Das merkt sich der Server je Nutzer.
- Leerer Zustand: "Für Dienstag ist nichts offen."
- Primärknopf: "Weiter zu Lernen", ohne Lernblock heute "Fertig für heute".

**Lernen.**
- Klausur ohne Karte: links eine 2px-Linie in `--ink`, Titel "Mathematik" 22px, darunter "Freitag, 16.10. · in 4 Tagen" und das Thema.
- Lernplan als Zeitleiste, Raster 52px | 1fr. Links Tages-Pillen 44×26: heute in `--accent` gefüllt, Klausurtag in `--ink` gefüllt, andere nur umrandet. Keine Uhrzeiten.
- Die heutige Planzeile trägt den Knopf "Lernblock starten" in `--accent`. Läuft ein Block, zeigt der Knopf die Restzeit mit Timer-Icon. Ist er pausiert, steht darunter "Pausiert bei 18:42". Nach dem Block steht dort "Erledigt" mit `check_circle`.
- Noten als eine Zeile: "Noten in Mathematik 2 · 3+ · 2−", tabular-nums.
- Zeile "12 Karten sind heute dran · 7 Mathematik, 3 Englisch, 2 Biologie" mit kleinem Stapel aus drei versetzten Karten links. Fehlt sie, sind keine Karten fällig.
- "Heute nicht lernen" als Textknopf. Er schließt den Schritt ab, der Plan bleibt offen, Fertig sagt "Lernblock offen. Passt auch morgen."
- Leerer Zustand ohne Klausur: "Keine Klausur in den nächsten 14 Tagen." Danach nur die Kartenzeile, falls Karten fällig sind.
- Primärknopf: "Fertig für heute".

**Fertig.**
- Überschrift "Fertig für heute." in Newsreader.
- Ereignisse aus dem Tagesprotokoll, ausgeschriebene Zahlen bis zwölf: "Eine Aufgabe eingetragen.", "Zwei Aufgaben abgehakt.", "Ein Blatt abgelegt, zwei Seiten.", "Lernblock erledigt." oder "Lernblock offen. Passt auch morgen.". Ohne Ereignis: "Heute nichts eingetragen."
- "Morgen, Dienstag": Fächer des nächsten Schultags in einer Zeile, darunter die offenen Aufgaben dafür als Aufgabenzeilen zum Abhaken. Ohne offene Aufgaben: "Für Dienstag ist nichts offen."
- Tipp auf "Morgen, Dienstag" öffnet die Woche.
- Kein Primärknopf.

### 5.3 Lerntisch: Lernblock und Abfrage

Lernblock und Kartenabfrage sind ein Ort. Der Tisch ist `--table`: hell `#2A44C0`, dunkel `#121A4E`. Es gibt keine Uhrzeit-Automatik. Die Farbwerte auf dem Tisch werden über Variablen am Container umgeschaltet (aus 19 Z. 83 bis 85). theme-color wird zur Tischfarbe.

**Einstiege.**
1. "Lernblock starten" in einer Planzeile: Lernblock mit Uhr. Der Tisch wächst aus dem Knopf.
2. "12 Karten sind heute dran": freie Wiederholung ohne Uhr. Die oberste Karte des kleinen Stapels hebt sich ab und wird zur Abfragekarte.
3. Zeile mit "abfragen" oder "karten", optional mit Fach ("abfragen mathe"): freie Wiederholung mit Filter.

**Aufbau von oben nach unten.**
- Schließen (44px, links) und im Lernblock rechts die Uhr "24:12", Schibsted 15px/560, tabular-nums. Ein Tipp auf die Uhr pausiert und setzt fort.
- Im Lernblock eine 3px-Restzeitlinie über die volle Breite.
- Fortschritt als Striche bis 20 Karten, darüber ein durchgehender Balken (aus 19 `renderTicks()` Z. 737 bis 749). Darunter "12 Karten" und nach "Nochmal" "12 Karten · 1 kommt nochmal".
- Der Stapel 336×448, Radius 22, zentriert. Kopf der Karte: Fach links, "Frage" oder "Antwort" rechts, 13px/600. Frage in Newsreader 27px/500, `text-wrap: balance`. Fuß mit Trennlinie und "Antippen zum Umdrehen".
- Unten zuerst der Knopf "Umdrehen", nach dem Umdrehen drei Knöpfe "Nochmal", "Unsicher", "Gewusst", je 64px hoch, Radius 22, Abstand 10px.
- Im Lernblock darunter eine Zeile "Material · Scheitelpunktform, 2 Seiten". Sie öffnet das Blatt als Sheet von unten. Der Block läuft weiter.

**Karten.** Die Karten kommen aus dem echten `/abruf` mit Quellbindung. Im Lernblock einer Klausur folgt die Reihenfolge der Klausur (CASCADE), in der freien Wiederholung den fälligen Karten. Die Abfragelogik der Prototypen wird nicht übernommen.

**Bedienung.**
- Tippen auf die Karte oder "Umdrehen" dreht sie um. Ein zweiter Tipp dreht nicht zurück.
- Der Umdrehen-Knopf geht, danach kommen die drei Bewertungsknöpfe. Nacheinander, nie überblendet.
- Die drei Knöpfe sind der Hauptweg. Wisch nach rechts heißt Gewusst, nach links Nochmal, beide mit Stempel, der dem Finger folgt. Einen Wisch nach oben gibt es nicht.
- Vor dem Umdrehen gibt die Karte beim Ziehen nur zäh nach, und der Hinweis "Erst umdrehen." erscheint.
- Bewertungen sperren nicht. Die nächste Karte nimmt Eingaben an, während die alte noch fliegt.
- "Nochmal" legt die Karte ans Ende dieser Sitzung.

**Uhr.** Die Restzeit rechnet aus Startzeitpunkt und Pausen, gespeichert auf dem Server. Angezeigt wird per `requestAnimationFrame`. Schließen hält den Block nicht an. Die Planzeile zeigt dann die Restzeit, die Kopfzeile bleibt unverändert. Ist die Zeit um, während noch Karten liegen, erscheint "Zeit um. Als erledigt zählen? 25 Minuten gelernt" mit "Ja" und "Noch die restlichen Karten".

**Ende.** Zusammenfassung mit der ersten Einschätzung je Karte: "8 gewusst, 2 unsicher, 2 nochmal. 4 kommen morgen wieder." Im Lernblock folgen "Block beenden" und, wenn Zeit übrig ist, "Weiter mit Material". "Block beenden" fragt "Als erledigt zählen? 23 Minuten gelernt" mit den echten Minuten. Unter einer Minute gibt es keine Rückfrage und keine Zählung. Danach schrumpft der Tisch in die Planzeile. In der freien Wiederholung führen die Zeilen "Hausaufgaben für Dienstag · 2 offen" und "Fertig für heute" weiter, Schließen legt die Karte auf die Kartenzeile zurück.

**Dunkelmodus auf dem Tisch.** Karte `#1A1F3D`, Text `#F4F6FF`. "Gewusst" hat eine eigene helle Fläche `#EEF0F7` mit Text `#12183A`.

### 5.4 Tagesprotokoll

Startlogik und Fertig lesen aus einem Ereignisprotokoll je Tag in Postgres. Ereignisse: `aufgabe_eingetragen`, `aufgabe_abgehakt`, `aufgabe_geoeffnet`, `aufgabe_geloescht`, `blatt_abgelegt` (mit Seitenzahl), `schritt_abgeschlossen` (neu, faellig, lernen), `lernblock_gestartet`, `lernblock_pausiert`, `lernblock_fortgesetzt`, `lernblock_erledigt` (mit Minuten), `nicht_lernen`. Rückgängig löscht das zugehörige Ereignis. Fertig zählt Netto: einmal abgehakt und wieder geöffnet zählt nicht.

## 6. Gestaltung

### 6.1 Schriften

Zwei Familien von Google Fonts, dazu ein Icon-Font.

| Rolle | Schrift | Laden | Quelle |
|---|---|---|---|
| Alles Bedienbare und aller Text | Schibsted Grotesk, variabel | `family=Schibsted+Grotesk:ital,wght@0,400..800;1,400..800` | 16 |
| Fragen, Formeln | Newsreader, variabel | `family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600` | 14 |
| Icons | Material Symbols Rounded | `opsz,wght,FILL,GRAD@24,400..600,0..1,0` | 14, 16 |

IBM Plex aus 14 entfällt, weil die Paarung Plex mit Newsreader in einer Bewertung als typischer KI-Look auffiel. Martian Mono aus 19 und Plex Mono entfallen, damit es bei zwei Familien bleibt.

Newsreader steht nur für Fragen und Formeln: die drei Schrittüberschriften, "Fertig für heute.", die Kartenfragen und Formeln in Abschrift und Karten (kursiv, opsz 24, 400).

| Element | Schrift | Größe / Zeilenhöhe | Gewicht | Laufweite |
|---|---|---|---|---|
| Schrittüberschrift | Newsreader, opsz 72 | 38 / 1.04 | 500 | −0.018em, `text-wrap: balance` |
| Kartenfrage | Newsreader, opsz 72 | 27 / 1.2 | 500 | −0.01em |
| Formel | Newsreader kursiv, opsz 24 | 23 / 1.3 | 400 | 0, darf umbrechen |
| Aufgabentext | Schibsted | 17 / 1.4 | 450 | 0 |
| Fach vor dem Aufgabentext | Schibsted | 17 / 1.4 | 680 | 0, danach 0.4em Abstand |
| Fachname in Neu | Schibsted | 18 / 1.3 | 620 | −0.005em |
| Unterzeile, Meta | Schibsted | 14 / 1.4 | 450 | 0, Farbe `--ink-2` |
| Abschnittslabel | Schibsted | 14 / 1.3 | 620 | 0, `--ink-2`, nie Großbuchstaben |
| Kopfzeile | Schibsted | 15 / 1.3 | 520 | 0 |
| Bandlabel | Schibsted | 13 / 1.2 | 560 | 0 |
| Knopf | Schibsted | 17 / 1 | 620 | −0.005em |
| Klausurtitel | Schibsted | 22 / 1.2 | 720 | −0.02em |
| Feld in der Zeile | Schibsted | 17 / 1.3 | 450 | 0 |
| Token | Schibsted | 13.5 / 1 | 560 | 0 |
| Uhr auf dem Tisch | Schibsted | 15 / 1 | 560 | 0, tabular-nums |
| Kartenkopf | Schibsted | 13 / 1 | 600 | 0 |

Alle Zahlen `font-variant-numeric: tabular-nums`. In Zeitangaben stehen ":" und "." in einem eigenen `span` mit proportionaler Breite (aus 16 Z. 60 bis 61, `tn()` Z. 420). Icons 22px, FILL 0, wght 400. Gefüllt sind nur der Haken im erledigten Kreis, der Timer im laufenden Knopf und `check_circle` bei "Erledigt". `font-synthesis: none`.

### 6.2 Farben

Tokens auf `:root`. Dunkelmodus unter `@media (prefers-color-scheme: dark)` mit `:root:not([data-theme="light"])` und zusätzlich unter `:root[data-theme="dark"]`.

| Token | Hell | Dunkel | Verwendung | Quelle |
|---|---|---|---|---|
| `--bg` | #F4F1E9 | #17160F | Papier | 14 / neu |
| `--raise` | #E9E5DA | #221F19 | stille Pillen | 14 / neu |
| `--raise-2` | #DFDACD | #2C2922 | gedrückt | 14 / neu |
| `--sheet` | #FBF9F4 | #1E1C16 | Menü, Sheets | 14 / neu |
| `--line` | rgba(36,33,28,.12) | rgba(236,232,222,.12) | Haarlinien | 14 / neu |
| `--line-strong` | rgba(36,33,28,.22) | rgba(236,232,222,.22) | Umrandungen | 14 / neu |
| `--ink` | #1F1D19 | #ECE8DE | Text | 14 / neu |
| `--ink-2` | #56524A | #BDB7AA | Nebentext | 14 / neu |
| `--ink-3` | #6F6A60 | #9A9488 | erledigt, leise | 14 / neu |
| `--accent` | #2A44C0 | #8D9CFF | einziger Akzent | 14 / 19 |
| `--on-accent` | #FFFFFF | #0E1120 | Text auf Akzent | 14 / neu |
| `--dock` | #1F1D19 | #0E0D0A | die Zeile | 03 umgestimmt |
| `--dock-edge` | transparent | rgba(236,232,222,.14) | 1px Rand der Zeile | neu |
| `--dock-text` | #F4F1E9 | #ECE8DE | Text in der Zeile | 03 umgestimmt |
| `--dock-muted` | #B9B3A6 | #8E897E | Platzhalter, Lupe | 03 umgestimmt |
| `--dock-line` | #46433C | #2C2922 | Trennstrich zur Kamera | 03 umgestimmt |
| `--mark` | #FFDD4A | #FFDD4A | nur das Aufleuchten neuer Zeilen | 16 |
| `--error` | #B3261E | #F2B8B5 | Fehlertext | 14 / neu |
| `--scrim` | rgba(31,29,25,.32) | rgba(0,0,0,.5) | hinter Menü und Sheets | 14 / neu |
| `--camera` | #0B0B0C | #0B0B0C | Kamera | 14 |
| `--table` | #2A44C0 | #121A4E | Lerntisch | 14, 19 |
| `--t-on` | #F4F6FF | #F4F6FF | Text auf dem Tisch | 19 |
| `--t-fill` | rgba(244,246,255,.10) | rgba(244,246,255,.10) | Flächen auf dem Tisch | 19 |
| `--t-fill-2` | rgba(244,246,255,.18) | rgba(244,246,255,.18) | Knöpfe Nochmal, Unsicher | 19 |
| `--card` | #FFFFFF | #1A1F3D | Abfragekarte | 19 |
| `--card-ink` | #12183A | #F4F6FF | Text auf der Karte | 19 |
| `--card-ink-2` | #5A6185 | #AAB1C9 | Nebentext auf der Karte | 19 |
| `--known` | #FFFFFF | #EEF0F7 | Knopf Gewusst, Text `--card-ink` hell bzw. #12183A | 19 / neu |

Regeln: Blau ist der einzige Akzent und wird nur auf dem Tisch zur Fläche. Die Zeile ist die einzige dunkle Fläche auf Papier. Gelb erscheint nur als vergängliches Aufleuchten, nie als Knopffüllung. Keine Verläufe als Fläche. Der Fuß der Ablaufbildschirme bekommt keinen Verlauf, weil dort kein fester Knopf mehr steht. Schatten nur an der Zeile (0 1px 2px rgba(20,18,14,.06), 0 10px 26px −14px rgba(20,18,14,.28)), am Menü (0 16px 70px rgba(31,29,25,.19)), an Miniaturen und an Abfragekarten (0 18px 40px −12px rgba(10,18,70,.55)).

theme-color je Ebene: Papier `#F4F1E9` / `#17160F`, Kamera `#0B0B0C`, Tisch `#2A44C0` / `#121A4E`.

### 6.3 Abstände, Raster, Ecken

- Basisbreite 390px. Seitenrand 22px (aus 14). Über 600px Breite bleibt die Spalte 390px breit und zentriert.
- Oben: `env(safe-area-inset-top)` plus 8px, dann Kopfzeile 36px, dann Band 44px (4px-Spur, Label darunter, Spalten gleich breit, Abstand 6px), dann 18px bis zur Überschrift, 20px nach der Überschrift.
- Unten: Inhalt endet mit `padding-bottom` = 52px Zeile + `max(16px, safe-area)` + 24px.
- Listen statt Karten. Haarlinie 1px `--line` nur zwischen Zeilen. Gruppenabstand 28px, Label 20px oben und 6px unten.
- Aufgabenzeile: Raster 48px | 1fr | auto, `column-gap` 10px, `min-height` 60px.
- Fachzeile in Neu: Raster 1fr | auto, `min-height` 64px, Pillen 44px hoch, Abstand 8px.
- Lernplan: Raster 52px | 1fr, Zeilenabstand 14px, Tages-Pillen 44×26 Radius 13.
- Stunden in der Woche: Raster 58px | 1fr, Zeilen 16px oben und unten.
- Klausur: 2px-Linie links, 16px Einzug.
- Ecken: alles Drückbare ist eine Pille (Radius 999). Primärknopf 52px hoch. Zeile Radius 26. Menü Radius 20. Sheets oben 28. Abfragekarte 22. Bewertungsknöpfe 22. Sucher 3. Miniaturen 3. Tokens 999.
- Treffflächen mindestens 44×44. Abhakkreis 48×48.
- Mobile-Details aus 16 Z. 5 bis 8 und 49 bis 55: `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: contain` auf Scrollbereichen, `user-select: none` auf Knöpfen, `height: 100dvh`.

## 7. Animationen

### 7.1 Grundregeln

Kurven als Tokens, keine anderen:

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--ease-io:     cubic-bezier(0.77, 0, 0.175, 1);
--ease-grow:   cubic-bezier(0.6, 0, 0.2, 1);
--ease-flip:   cubic-bezier(0.2, 0.8, 0.2, 1);
```

Dazu eine Feder `spring(520, 42)`, vorberechnet als `linear()`-Kurve in 1/120-Sekunden-Schritten (14 `spring()` Z. 485 bis 494). Sie gilt für alles, was nach einer Geste losgelassen wird. Bei Knopf-Wechseln derselben Ebene gilt sie ebenfalls.

Animiert werden nur `transform` und `opacity`, per WAAPI. Unterbrechen heißt, aus der aktuellen Matrix (`getComputedStyle(el).transform`) neu starten, nicht `finish()`. In React mit stabilen Keys und FLIP auf vorhandenen Knoten, nie per `innerHTML`.

### 7.2 Liste

| # | Auslöser | Was sich bewegt | Dauer, Kurve | Quelle |
|---|---|---|---|---|
| 1 | App-Start nach `document.fonts.ready` | Kinder des Bildschirms: opacity 0 auf 1, translateY(8px) auf none, Verzögerung 40ms + min(i,3)·25ms | 220ms, ease-out | 16 `stagger()` Z. 580 bis 584, Aufruf Z. 886 |
| 2 | Schritt vor | neuer Schritt translateX(100%) auf 0, alter auf translateX(−24%) mit opacity 1 auf .4 | 300ms, ease-drawer | 14 `show()` Z. 570 bis 573 |
| 3 | Schritt zurück | neuer von translateX(−24%) und opacity .4 auf 0 und 1, alter auf translateX(100%) | 260ms, ease-drawer | 14 `show()` Z. 574 bis 578 |
| 4 | Schritt wird aktiv | Bandsegment scaleX 0 auf 1, `transform-origin: left` | 300ms, ease-out | 14 CSS Z. 66 bis 75, `setBand()` Z. 616 bis 627 |
| 5 | Fertig erreicht | `.band-line` opacity 0 auf 1 in 260ms ease, scaleX(.98) auf none in 300ms ease-out, Verzögerung 120ms; Labels opacity auf 0 in 200ms | siehe Spalte links | 14 CSS Z. 66 bis 75 |
| 6 | Fertig erscheint | Zeilen opacity 0 auf 1, translateY(8px) auf none, je 40ms versetzt, nach doppeltem rAF | 300ms, ease-out | 14 `.stagger` Z. 227 bis 228, `show()` Z. 612 |
| 7 | Fokus in die Zeile | Menü wächst aus der Zeile: Start mit Geometrie der Pille (translateY und scale auf Pillenmaß, Ecken per `clip-path: inset(... round 26px)`), Ziel none | 280ms, ease-drawer | neu, fehlte in 03 Z. 90 |
| 8 | Menü geöffnet | Treffer opacity 0 auf 1, translateY(6px) auf none, ab 80ms, je 25ms versetzt, höchstens 4 Stufen | 200ms, ease-out | 16 `setChips()` Z. 575 bis 576 |
| 9 | Menü öffnet und schließt | Scrim opacity 0 auf 1 | 200ms, ease | 16 `.scrim` Z. 232 |
| 10 | Menü schließen per Tipp oder Esc | umgekehrt zu 7 | 220ms, ease-drawer | neu |
| 11 | Menü nach unten ziehen | folgt dem Finger per Pointer Capture, nach oben Gummiband c = .55; schließt ab 28% Höhe oder 0,5 px/ms (letzte 5 Punkte), sonst Feder zurück | Feder | 16 `rubber()` Z. 732, `dragToClose()` Z. 733 bis 757 |
| 12 | Tippen erkennt ein Token | opacity 0, translateY(4px) scale(.94) auf none; unveränderte Tokens bleiben per Signaturvergleich stehen | 220ms, ease-out | 16 `.tok` Z. 208 bis 212, `onInput()` Z. 638 bis 662 |
| 13 | Absicht wechselt | Absicht-Token und Text der ersten Zeile: opacity 1 auf 0 in 100ms, Text tauschen, 0 auf 1 in 160ms | 100 + 160ms, ease-out | 16 `swapText()` Z. 812 bis 818 |
| 14 | Absicht wechselt | Sendeknopf-Icon rotate(−90deg) und opacity 0 auf none und 1 | 200ms, ease-out | neu |
| 15 | Vorschläge und Treffer tauschen | beide Ebenen übereinander, opacity und translateY(6px) | 180ms, ease-out | 16 `.strip` Z. 199 bis 204 |
| 16 | Enter beim Eintragen | fixierter Geistklon des Satzes fliegt vom Feld an die Zielzeile: translate(dx,dy) auf none, opacity .4 auf 1. Start erst, wenn `visualViewport` nach dem Schließen der Tastatur zwei Frames lang stabil ist | 360ms, ease-drawer | 16 `appendTurn()` Z. 585 bis 616, `ask()` Z. 617 bis 633 |
| 17 | neue Zeile kommt dazu | Zeilen darunter per FLIP translateY(d) auf none | 280ms, ease-out | 14 `addItem()` Z. 668 bis 673 |
| 18 | neue Zeile gelandet | `::before` in `--mark` opacity .3 auf 0, Verzögerung 180ms | 650ms, ease-out | 16 `.task::before` Z. 99 bis 101, `answerNeu()` Z. 508 |
| 19 | Primärknopf ändert Text | Label opacity auf 0 und translateY(6px), Text nach 160ms tauschen, zurück | 160ms ease / 200ms ease-out | 14 `.btn-label.swap` Z. 102 bis 103 |
| 20 | Antwort im Menü | eigene Eingabe als einzeiliges Kürzel nach oben, translate auf none; Antwort-Kinder wie 1 mit Basis 90ms | 360ms ease-drawer / 220ms ease-out | 16 `appendTurn()` Z. 585 bis 616, `stagger()` Z. 580 bis 584 |
| 21 | Druck auf Abhakkreis | Ring scale(.88) | 160ms, ease-out | 14 CSS Z. 135 bis 136 |
| 22 | Abhaken | Füllung scale(.4) und opacity 0 auf 1; Haken scale(.5) rotate(−12deg) auf none, Verzögerung 80ms | 240ms, ease-out | 14 CSS Z. 137 bis 146, `toggleHw()` Z. 878 bis 887 |
| 23 | Abhaken | Durchstrich: je Textzeile ein 1.5px-Element (Zeilen aus `Range.getClientRects()`), scaleX 0 auf 1, `transform-origin: left`, Verzögerung 60ms + i·60ms; Titel auf `--ink-3` ohne Animation | 260ms, ease-out | 14 `.hw-title::after` Z. 134 bis 148, je Zeile neu |
| 24 | 350ms nach Abhaken (240ms bei Wiederöffnen) | Zeile wandert per FLIP nach Erledigt, andere Zeilen rücken nach; neue Gruppenlabels opacity 0 auf 1 in 200ms | 340ms, ease-io | 14 `renderHw(true)` Z. 867 bis 875 |
| 25 | Wisch auf Aufgabenzeile | folgt dem Finger 1:1; Gegenseite Gummiband dx = −(\|mx\|·40)/(40+\|mx\|); Achse nach 10px; Start nur ab 24px vom linken Rand; Auslösung ab 30% Breite oder 0,6 px/ms; Fläche darunter opacity in 200ms, Icon scale(.6) auf 1 ab 30% | Feder beim Loslassen | 14 Wisch Z. 901 bis 936, `.hw-bg` Z. 128 bis 133 |
| 26 | erster Besuch von Fällig | erste offene Zeile translateX(24px) bei Offset .45, zurück; Fläche darunter blitzt kurz auf | 400ms, ease-in-out | 14 `nudge()` Z. 893 bis 899 |
| 27 | Toast erscheint | translateY(14px) auf none in 260ms, opacity in 200ms; Lage 10px über der gemessenen Oberkante der Zeile; Standzeit 4500ms | ease-out | 16 `.toast` Z. 223 bis 229, `toast()` Z. 673 bis 677 |
| 28 | Druck auf Knöpfe | Primärknopf scale(.97), Pillen und Tokens scale(.96), runde Knöpfe scale(.92), Auslöser innen scale(.92) | 140ms, ease-out | 16 Z. 127, 207, 218, 245; 10 `.shutter span` Z. 14 |
| 29 | Kamera öffnen | Kamera translateY(100%) auf 0; Schritt dahinter scale(1) und opacity 1 auf scale(.96) und .5; theme-color nach 200ms | 340ms, ease-drawer | 14 `show()` Z. 579 bis 586; 10 Z. 71 |
| 30 | Kamera schließen | umgekehrt | 300ms, ease-drawer | 14 `show()` Z. 579 bis 586 |
| 31 | Auslösen | Bild friert ein; Blitz opacity .85 auf 0 | 240ms, ease-out | 14 Shutter Z. 808 bis 835 |
| 32 | Auslösen | Seite per FLIP in den Stapel: translate, scale auf Stapelbreite, rotate(−4deg) auf 0, opacity auf .9; Stapel ab Seite 2 scale(.9) auf 1 in 220ms; Zähler scale(.6) auf 1 in 200ms | 420ms, ease-drawer | 14 Shutter Z. 808 bis 835 |
| 33 | erste Seite aufgenommen | "Ablegen" translateX(12px) und opacity 0 auf none und 1 | 300ms, ease-out | 14 Shutter Z. 808 bis 835 |
| 34 | Fach-Chip in der Kamera | Menü opacity 0 auf 1 in 160ms ease, scale(.96) translateY(−4px) auf none in 200ms ease-out, `transform-origin: 50% 0`; Pfeil rotate(180deg) in 200ms | siehe links | 14 CSS Z. 259 bis 260 |
| 35 | Ablegen | nach Kamera-Abgang (30) fliegt die 76px-Miniatur an die Fachzeile: translate, scale, rotate(−2.2deg) auf none | 520ms, ease-drawer | 16 Shutter Z. 832 bis 849, `appendTurn()` Z. 609 bis 612 |
| 36 | Status eines Blatts ändert sich | Crossfade wie 13 | 100 + 160ms | 16 `swapText()` Z. 812 bis 818 |
| 37 | Blatt eingeordnet | Fachzeile zum Umsortieren: Kinder translateY(6px) auf none, Verzögerung 120 + i·25ms | 220ms, ease-out | 16 Z. 851 bis 868 |
| 38 | "Lernblock starten" | Tischfläche per FLIP von Knopfmaß auf Vollbild, opacity 0 auf 1 bis Offset .2; Inhalt opacity 0 und translateY(10px) auf 1 und none, Verzögerung 170ms in 220ms ease-out | 340ms, ease-grow | 14 `show()` Z. 587 bis 597 |
| 39 | Tisch geöffnet | Kartenstapel opacity 0, translateY(60px) scale(.94) auf none, je 40ms versetzt | 340ms, ease-out | 19 `openSession()` Z. 771 |
| 40 | Tisch schließen aus Lernblock | Inhalt opacity auf 0 bis Offset .35; Fläche schrumpft auf Knopfmaß, opacity 1 bis Offset .8, dann 0 | 280ms, ease-grow | 14 `show()` Z. 598 bis 601 |
| 41 | Block erledigt | "Erledigt" in der Planzeile opacity 0 und scale(.94) auf none | 240ms, ease-out | 16 `.prow.done .ok` Z. 162 bis 163 |
| 42 | Tipp auf "12 Karten sind heute dran" | oberste Karte per FLIP vom kleinen Stapel auf den Tisch, translate scale auf none, `transform-origin: 0 0`; Text opacity 0 bis Offset .3; Hinterkarten 340ms ease-out, Verzögerung 100 + i·40ms, von translateY(dy·.6) scale(.8) opacity 0; Tisch opacity 0 auf 1 in 160ms | 380ms, ease-drawer | 19 `openSession()` Z. 760 bis 769, `.s-bg` Z. 222 bis 225 |
| 43 | Tisch schließen aus freier Wiederholung | oberste Karte fliegt per FLIP auf die Kartenzeile zurück, Tisch opacity auf 0 | 300ms ease-drawer / 200ms ease | neu, symmetrisch zu 42 |
| 44 | Karte umdrehen | `.sc-flip` rotateY(180deg), `perspective: 1400px` auf eigenem Wrapper; gleichzeitig `.sc-lift` scale 1.02 und translateY(−3px) und zurück | 320ms, ease-flip | 19 Z. 250 bis 255, `flip()` Z. 793 bis 802 |
| 45 | nach dem Umdrehen | "Umdrehen" opacity auf 0 und translateY(−6px) in 120ms; danach die drei Knöpfe opacity 0 und translateY(10px) auf 1 und none, je 30ms versetzt | 120ms, dann 200ms, ease-out | 19 `.s-foot` Z. 266 bis 271, nacheinander statt überblendet |
| 46 | Karte ziehen nach dem Umdrehen | translate folgt dem Finger, rotate dx·0.055deg; Stempel opacity \|dx\|/100 | folgt dem Finger | 19 `bindTop()` Z. 893 bis 902, `setStamps()` Z. 806 bis 811 |
| 47 | Karte ziehen vor dem Umdrehen | Gummiband `rubber(dx, 300, .35)`; Hinweis "Erst umdrehen." opacity 0 auf 1 | 200ms, ease | 19 Z. 898, `rubber()` Z. 632, `.hint` Z. 272 bis 273 |
| 48 | Loslassen, Projektion v·99 unter 120px | Karte federt zurück, Stempel opacity auf 0 in 200ms | Feder | 19 Z. 913 bis 916, Kurve durch Feder ersetzt |
| 49 | Loslassen über Schwelle oder Bewertungsknopf | Wurf: x = ±(Breite + 160) + vx·140, rotate ±16deg + vx·4, opacity auf 0 | 340ms, ease-out | 19 `rate()` Z. 824 bis 832 |
| 50 | Karte geworfen | Stapel rückt nach: Positionen translateY(14px) scale(.95), translateY(28px) scale(.9) opacity .7; je 30ms versetzt; keine Sperre | 320ms ease-out, opacity 200ms ease | 19 Z. 240 bis 247, `rate()` Z. 837 bis 848 |
| 51 | Karte bewertet | Fortschrittsstrich scaleX 0 auf 1, `transform-origin: left` | 300ms, ease-out | 19 `.tick i` Z. 236 bis 238 |
| 52 | letzte Karte | Zusammenfassung opacity in 240ms ease, translateY(16px) auf none | 340ms, ease-out | 19 `.summary` Z. 274 bis 275 |
| 53 | Lernblock läuft | Restzeitlinie scaleX(rest/gesamt), gesetzt je Frame per rAF aus Zeitstempeln | keine Transition | ersetzt 14 `.clock-fill` Z. 188 und 16 `.bar` Z. 241 |
| 54 | "Block beenden" oder Zeit um | Dialog opacity in 200ms ease, translateY(16px) auf none | 260ms, ease-out | 14 `.confirm` Z. 208 bis 209 |
| 55 | Material-Sheet öffnen | translateY(105%) auf 0; Scrim opacity in 320ms; schließen per Ziehen wie 11 | 380ms, ease-drawer | 16 `.sheet` Z. 234 bis 236 |
| 56 | Nachschlagen öffnen | neue Seite translateX(100%) auf 0, alte translateX(−24%) und opacity .4 | 300ms, ease-drawer | wie 2 |
| 57 | Wisch vom linken Rand (0 bis 20px) | Seite folgt dem Finger, Projektion `x + v·.998/2`, schließt über 50% Breite, sonst Feder zurück | Feder | 10 `gestureMove()`, `gestureEnd()` Z. 93 bis 95 |
| 58 | Wochentag wechseln | Unterstrich translateX(i·100%) in 300ms ease-io; Liste raus opacity 0 und translateX(∓20px) in 200ms, rein von der Gegenseite in 260ms | siehe links | 14 `.day-ind` Z. 238, Handler Z. 1062 bis 1077 |
| 59 | Primärknopf in einer Liste mit FLIP | rückt mit der Liste wie 17 | 280ms, ease-out | 14 `addItem()` Z. 668 bis 673 |

### 7.3 Reduzierte Bewegung

Gezielt je Bewegung, keine Pauschalregel auf `*`.

- Schritte, Ebenen, Kamera, Tisch, Sheets und Nachschlagen: nur opacity, 160ms.
- Kein Geistflug, kein FLIP-Flug, keine Miniatur im Flug. Stattdessen leuchtet das Ziel auf (18).
- Kartendrehung wird ein Überblenden Vorderseite zu Rückseite in 200ms. Der Wurf wird ein Ausblenden in 160ms.
- Haken und Durchstrich bleiben, in 120ms.
- Kein Anwackeln, keine Token-Animation, kein Stagger.
- Die Restzeitlinie läuft weiter, weil sie Information ist.
- Gesten folgen weiterhin dem Finger, das Loslassen springt auf den Endzustand.
- In JS: `const reduce = matchMedia('(prefers-reduced-motion: reduce)')`, bei jeder Animation abgefragt (16 Z. 336, 14 Z. 477).

## 8. Was ausdrücklich nicht übernommen wird

- Der wachsende Gesprächsverlauf aus 16 und die eingefrorenen Antworten darin.
- Fest verdrahtete Beispieldaten aus allen Modellen: "Dienstag" als Konstante in 14 Z. 860 bis 863 und Z. 1044, `answerKlausur()` und `answerNoten()` aus 16, `CARDS` und `TOMORROW_BASE` aus 19, die Regex-Zählung `hwCounts` aus 19 Z. 937.
- Der feste Start auf Schritt 1 aus 14 Z. 1079 bis 1083.
- Die neun festen Ziele als einzige Suchtreffer aus 03 und das fest codierte Umsortieren bei "mathe" aus 03 Z. 88.
- Das Menü ohne Animation aus 03 Z. 90.
- Das Eintragen-Blatt mit eigenem Feld aus 14 Z. 691 bis 754. Eintragen läuft über die Zeile.
- Das Formular für Titel und Fach nach dem Auslösen aus 10 Z. 53.
- Die Kamera als Grundebene, die Wege Woche und Ablage im Sucher und das Herunterziehen von Heute zur Kamera aus 10 und aus dem Konzept "Unterlage". Ebenso der 10px-Streifen der Unterlage.
- Der Fortschrittsbalken bei 92% und die feste Lesedauer von 2800ms aus 16 Z. 835 und 851, die laufende Lichtreflex-Linie aus "Unterlage".
- `setInterval` für Uhren aus 14 Z. 967 bis 991, 16 Z. 761 bis 768 und 03 Z. 76.
- Die `busy`-Sperre von 300ms aus 19 Z. 816 und 850 bis 856.
- Der Wisch nach oben für "Unsicher" und `teaseUp()` aus 19 Z. 874 bis 878.
- Tippen auf die umgedrehte Karte dreht zurück, aus 19 Z. 796.
- Der Zähler "von 13" nach "Nochmal" aus 19.
- Die Segment-Dockleiste mit drei Textreitern aus 19 Z. 203 bis 210.
- Der Startstapel als `<button>` mit Block-Inhalt aus 19 Z. 437 bis 445.
- Der Textmarker als Knopffüllung, wie der gelbe Startknopf aus 16 und "Eine Zeile".
- Eine Abendfassung des Tisches nach Uhrzeit aus "Eine Zeile".
- Die Startseite "Heute" mit Abschnitten und Vorschlags-Chips über dem Dock aus "Eine Zeile". Der Ablauf ist die Startseite.
- Ein fest stehender Primärknopf über der Zeile.
- Seitliches Wischen zwischen Ablaufschritten.
- Pauschales `transition-duration: 120ms !important` aus 14 Z. 325 und `0s !important` aus 03 Z. 18.
- Abgeschaltete Übergänge bei Tastaturbedienung aus 10 Z. 73 und 03 Z. 69.
- `navigator.vibrate` als einzige Rückmeldung. Er darf aufgerufen werden, das Abhaken muss ohne ihn funktionieren.
- Gezeichnete Statusleisten, Home-Indikatoren, Handyrahmen und Testhaken wie `window.feierabendDemo` und `window.__demo`.
- `innerHTML`-Neurendern ganzer Listen.
- Ortsangaben wie "zu Hause" oder "16:40 Uhr · zu Hause" in der Oberfläche.
- IBM Plex Sans, IBM Plex Mono, Martian Mono, DM Sans, Manrope, Onest, Georgia.
- Löschen per Textbefehl in der Zeile.

## 9. Abnahmekriterien

Jedes Kriterium wird am echten iPhone geprüft, nicht nur im Desktop-Browser.

**Start und Ablauf**
1. Am 12.10. um 16:40 ohne Ereignisse öffnet die App auf Neu.
2. Nach "Weiter zu Fällig" und Neuladen öffnet sie auf Fällig. Der Stand kommt vom Server, nicht aus `localStorage`.
3. Nach erledigtem Lernblock öffnet sie auf Fertig.
4. An einem Tag ohne Schule erscheint Neu nicht als aktueller Schritt. In den Ferien zeigt Fertig "Ferien bis …" und keine Aufgaben.
5. Freitags heißt die erste Gruppe in Fällig "Für Montag", und die Kopfzeile lautet "Montag, 19.10. · …", nicht "Morgen, …".
6. Jedes Bandsegment springt zu seinem Schritt. Vorwärts kommt von rechts, rückwärts von links.
7. "Fertig für heute." nennt nur Ereignisse aus dem Protokoll. Rückgängig gemachte Ereignisse fehlen.

**Zeile**
8. Alle Beispiele aus 4.4 ergeben die angegebene Absicht.
9. Der Parser ist mit mindestens 40 echten Sätzen des Nutzers gemessen, mindestens 38 richtig.
10. Die erste Zeile sagt vor jedem Enter in Worten, was passiert. Die zweite Zeile schaltet die Absicht um.
11. Ein Tipp auf das Absicht-Token schaltet um, ohne den Text zu ändern.
12. Ein doppelter Satz erzeugt "Steht schon drin" und keine zweite Aufgabe.
13. Ohne Fälligkeit und ohne Stunde fragt die App "Bis wann ist … fällig?" mit drei Antworten.
14. Bei offener Tastatur bleibt die Zeile vollständig sichtbar, in Safari und als installierte PWA.
15. Das Feld zoomt auf iOS nicht.
16. "scheitelpunkt" findet ein Blatt über den Text der Abschrift. Treffer kommen in unter 400ms über Tailscale Funnel.
17. "faecher" und "fächer" liefern dieselben Treffer.
18. Bei leerem Feld zeigt das Menü "Wohin?" mit allen acht Bereichen.
19. Pfeiltasten, Enter, Esc und Cmd/Ctrl+K funktionieren. VoiceOver liest die markierte Zeile vor.

**Fällig**
20. Abhaken per Tipp und per Rechtswisch. Die Zeile wandert erst nach 350ms.
21. "Rückgängig" im Toast stellt den Zustand her, auch nach dem Umsortieren.
22. Zweizeilige Titel werden auf jeder Zeile korrekt durchgestrichen.
23. Ein Rechtswisch, der 0 bis 23px vom linken Rand beginnt, hakt nicht ab.
24. Senkrechtes Scrollen über Aufgabenzeilen löst keinen Wisch aus.
25. Linkswisch zeigt "Bearbeiten" und "Löschen". "Bearbeiten" öffnet die Zeile mit den Tokens der Aufgabe.

**Kamera**
26. Von jedem Ablauf- und Nachschlagebildschirm ist die Kamera mit einem Tipp erreichbar.
27. Zwischen Tipp und erstem Kamerabild vergehen höchstens 1,5 Sekunden. Bis dahin steht "Kamera startet".
28. Nach dem Ablegen gibt es kein Formular. Die Miniatur landet unter dem Fach, von dem man kam.
29. Der Status folgt dem Server. Bei einem Fehler im Einordnen oder in der Abschrift erscheint der Fehlertext aus 5.1.
30. Umsortieren per Fachzeile ändert das Fach auf dem Server.
31. Verweigerte Kamerafreigabe führt zu "Foto auswählen".

**Lerntisch**
32. Der Tisch wächst aus dem gedrückten Knopf und schrumpft in denselben zurück.
33. Ein zweiter Tipp auf die umgedrehte Karte dreht sie nicht zurück.
34. Fünf schnelle Bewertungen hintereinander gehen alle durch.
35. Nach "Nochmal" steht "12 Karten · 1 kommt nochmal".
36. Die Restzeit stimmt nach 5 Minuten gesperrtem Bildschirm auf die Sekunde.
37. Schließen des Tisches hält den Block nicht an. Die Planzeile zeigt die Restzeit.
38. "Als erledigt zählen?" nennt die echten Minuten. Unter einer Minute erscheint keine Frage.
39. Die Karten stammen aus `/abruf` und folgen im Lernblock der Klausur.
40. Im Dunkelmodus ist "Gewusst" klar vom Tisch abgesetzt.

**Gestaltung und Bewegung**
41. Nur Schibsted Grotesk, Newsreader und Material Symbols Rounded werden geladen.
42. Newsreader erscheint nur in Schrittüberschriften, "Fertig für heute.", Kartenfragen und Formeln.
43. Blau ist der einzige Akzent. Gelb erscheint nur als Aufleuchten.
44. Keine Karte in einer Karte, keine Großbuchstaben-Zeile über Überschriften, keine Verläufe als Fläche, keine Emojis.
45. Keine Zahl auf dem Bildschirm, die nicht aus Daten oder Protokoll kommt.
46. Alle Animationen verändern nur `transform` und `opacity`. Geprüft im Performance-Panel: keine Layout- oder Paint-Spitzen beim Abhaken.
47. Ein Doppeltipp auf ein Bandsegment kehrt die laufende Bewegung um, statt ans Ende zu springen.
48. Mit `prefers-reduced-motion` gelten alle Punkte aus 7.3.
49. Hell und Dunkel funktionieren über System und über `data-theme`.
50. Auf einem iPhone SE (375×667) sind in Neu mindestens drei Fachzeilen ohne Scrollen sichtbar.

## 10. Herkunft der Teile

Aus "Unterlage":
- Unter der ersten Trefferzeile steht immer die Gegenrichtung.
- Präfixe "+" und "?". Der Widerspruch zum "?" am Satzende entfällt, weil es nur zwei Absichten gibt.
- Kamerastrom startet bei `pointerdown`, bis dahin "Kamera startet".
- Ohne Fälligkeit gilt die nächste Stunde, das Token schreibt das aus.
- Die Kopfzeile "Morgen, Dienstag · 2 Aufgaben offen".
- Schibsted Grotesk als Arbeitsschrift.

Aus "Eine Zeile":
- "Wohin?" mit allen Bereichen und den zuletzt geöffneten Dingen.
- Schließen des Tisches hält den Block nicht an, die Planzeile zeigt die Restzeit.
- "Lernblock starten" als Vorschlag in der leeren Zeile.
- Gummiband vor dem Umdrehen, eigene helle Fläche für "Gewusst" im Dunkeln.
- Linkswisch für Bearbeiten und Löschen.
- Leere Zustände ohne Ersatzinhalt.
- Die Karte hebt sich von der Kartenzeile auf den Tisch.
- Formeln in Newsreader kursiv statt einer dritten Schrift.

Aus den Bewertungen:
- Das Absicht-Token heißt "Eintragen", nicht "Neu", damit es nicht mit dem Schritt "Was ist neu?" verwechselt wird.
- Primärknopf und Zeile stehen nicht übereinander. Der Primärknopf steht am Ende des Inhalts.
- Der Toast misst seine Lage an der Zeile.

## 11. Hinweise für den Bau

- Vor dem Bau `node_modules/next/dist/docs/` lesen. Diese Next.js-Version hat Breaking Changes (AGENTS.md).
- Die Shell liegt in `src/app/(app)/layout.tsx` als Client-Insel: Zeile, Kamera-Ebene, Tisch-Ebene, Toast. Routen rendern in die Bühne darüber. Der Ablauf ist die Route `/`, die Schritte sind Zustand auf dieser Route, kein Routenwechsel.
- FLIP über Routengrenzen (Geistflug, Miniatur) braucht einen gemeinsamen Client-Zustand in der Shell.
- Reihenfolge: zuerst Zeile mit Parser, Suche und Tests mit echten Sätzen. Dann der Ablauf mit Tagesprotokoll. Dann Kamera. Dann der Tisch.
- Jede Stufe wird am Handy durchgeklickt, bevor die nächste beginnt. Grüne Tests finden die Fehler dieser Art nicht.
