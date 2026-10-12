# Kombi-Vorgabe V2: Der Tag führt, die Zeile bleibt

Diese Vorgabe ist verbindlich und ersetzt `KOMBI-VORGABE.md` (V1). Sie führt sechs Prototypen zusammen: 16 Gespräch, 14 Feierabend, 03 Befehlszeile, 10 Kamera, 19 Abfrage und 17 Tageszeit. Wo V2 etwas festlegt, gilt V2. Wo V2 schweigt, gilt `BRIEF.md` mit Verboten und Animationsregeln.

Grundlage sind die Antworten des Nutzers vom 11.10.2026. Wo V1 ihnen widerspricht, gelten die Antworten. Die wichtigsten Änderungen gegenüber V1:

- Die Startseite richtet sich nach der Tageszeit: morgens Tag und Packen, einmal nach der Schule ein Ablauf, sonst der Überblick (Dashboard).
- Der Ablauf hat zwei Schritte statt vier: erst Blätter fotografieren, dann Hausaufgaben. Die Schritte "Lernen" und "Fertig" entfallen.
- Neu ist "Wiederholen": fällige Fragen aus den Blättern, immer ein Thema am Stück, das fälligste zuerst.
- Noten stehen in einem eigenen Bereich und nicht auf dem Überblick.
- Auf dem Lerntisch schreibt er eine Antwort und urteilt danach mit "Saß" oder "Daneben", so wie der echte Abruf es heute schon tut. Die drei Knöpfe "Nochmal", "Unsicher", "Gewusst" aus V1 entfallen.

Zeilenangaben wie "17 Z. 908" beziehen sich auf `entwurf-modelle/<nummer>-<name>/index.html`. Angaben wie `src/recall/sessions.ts` beziehen sich auf die echte App.

Die Notiz zur ersten Umsetzung der V1 (`21-kombi/notiz.md`) beschreibt den Entwurf, enthält aber keine Prüfbefunde. Aus ihr übernimmt V2 nur den Prüfschalter `?jetzt=2026-10-16T16:40`, erweitert auf alle Tageszeiten (Abschnitt 15, Kriterium 1).

## 1. Idee

Die App zeigt zu jeder Tageszeit nur das, was er gerade braucht. Morgens vor der Schule sieht er den Tag und was er abgeben muss. Beim ersten Öffnen nach Schulschluss führt ihn ein kurzer Ablauf durch zwei Fragen: welche Blätter es gab und was er aufhat. Danach und am Abend steht der Überblick: Hausaufgaben für morgen, Klausur mit Lernblock, ein Knopf "Wiederholen" und die letzten Blätter. Unten liegt immer dieselbe dunkle Zeile zum Eintragen und Suchen, rechts daneben der Kameraknopf. Lernblock und Wiederholen finden auf einem blauen Tisch statt, der aus dem Knopf wächst, der ihn startet.

## 2. Beispieldaten

Montag, 12.10.2026. Die Schule ist eine Waldorfschule: Die erste Stunde ist jeden Tag der Hauptunterricht, und dessen Fach wechselt alle paar Wochen (Epoche). In der App gibt es dafür `/stundenplan/epoche`. Laufende Epoche ist Geschichte, Thema "Industrialisierung", seit Montag, 28.9.

Abweichung von `BRIEF.md`: Montags steht in der ersten Stunde der Hauptunterricht Geschichte statt Deutsch. Deutsch, Französisch und Englisch liegen an anderen Tagen.

### 2.1 Woche

| Tag | 1. Stunde 08:00 bis 09:30 | 2. Stunde 09:50 bis 11:20 | 3. Stunde 11:40 bis 13:10 | 4. Stunde 13:30 bis 14:15 | Schulschluss |
|---|---|---|---|---|---|
| Mo | Geschichte, Hauptunterricht (R. 104) | Mathematik (R. 208) | Biologie (Bio 1) | | 13:10 |
| Di | Geschichte, Hauptunterricht (R. 104) | Deutsch (R. 104) | Mathematik (R. 208) | Englisch (R. 112) | 14:15 |
| Mi | Geschichte, Hauptunterricht (R. 104) | Französisch (R. 110) | Englisch (R. 112) | | 13:10 |
| Do | Geschichte, Hauptunterricht (R. 104) | Biologie (Bio 1) | Mathematik (R. 208) | | 13:10 |
| Fr | Geschichte, Hauptunterricht (R. 104) | Mathematik (R. 208), Klausur | Französisch (R. 110) | | 13:10 |

### 2.2 Hausaufgaben

- Für Dienstag: Mathe "S. 84, Nr. 3–5", Deutsch "Gedichtanalyse beenden".
- Erledigt seit gestern: Englisch "Vokabeln Unit 3".
- Wird am Montag im Ablauf eingetragen: Biologie "Arbeitsblatt Zellatmung fertig", bis Do 15.10.

### 2.3 Klausur und Noten

- Mathematik, Freitag 16.10., 2. Stunde, Thema "Quadratische Funktionen". Lernplan: heute Lernblock (25 Minuten, Scheitelpunktform), Mittwoch Wiederholung, Donnerstag Probeklausur.
- Noten Mathematik: 2, 3+, 2−. Noten Geschichte: 2+ (Referat). Noten Französisch: 3, 2−.

### 2.4 Blätter

| Datum | Fach | Titel | Thema | Seiten |
|---|---|---|---|---|
| Mi 30.9. | Geschichte | Die Dampfmaschine | Industrialisierung in England | 2 |
| Do 1.10. | Französisch | Passé composé avec être | Passé composé mit être | 1 |
| Fr 2.10. | Geschichte | Spinnmaschine und Fabrik | Industrialisierung in England | 2 |
| Mo 5.10. | Französisch | Exercices 3 et 4 | Passé composé mit être | 1 |
| Di 6.10. | Geschichte | Arbeit in der Fabrik, Kinderarbeit | Industrialisierung in England | 3 |
| Do 8.10. | Geschichte | Die erste Eisenbahn in Deutschland | Industrialisierung in Deutschland | 1 |
| Do 8.10. | Mathematik | Scheitelpunktform, Übungen | Quadratische Funktionen | 2 |
| Mo 12.10. | Geschichte | Arbeiterbewegung | Industrialisierung in Deutschland | 2, wird im Ablauf fotografiert |

### 2.5 Fällige Themen am Montag

Die Termine stammen aus der echten Planungsrechnung (`src/recall/schedule.ts`): Takt drei Tage, in der letzten Woche vor einer Klausur täglich.

| Rang | Thema | Fragen fällig | Ältester offener Termin | Warum an dieser Stelle |
|---|---|---|---|---|
| 1 | Geschichte · Industrialisierung in England | 10 | Sa 10.10. | ältester Termin |
| 2 | Mathematik · Quadratische Funktionen | 12 | Mo 12.10. | gleicher Tag wie Französisch, Klausur am Freitag |
| 3 | Französisch · Passé composé mit être | 8 | Mo 12.10. | keine Klausur |

Die Fragen stehen vollständig in Abschnitt 6.8.

## 3. Tageszeiten

### 3.1 Die drei Ansichten

| Ansicht | Gilt an Schultagen | Was er sieht | Kopfzeile |
|---|---|---|---|
| Morgens | 04:00 bis Schulschluss | Den Tag und was er abgeben muss (3.3) | "Montag, 12. Oktober · Morgens" |
| Nach der Schule | erstes Öffnen nach Schulschluss, einmal am Tag | Den Ablauf mit zwei Schritten (Abschnitt 5) | Schrittband statt Datumszeile |
| Überblick | nach dem Ablauf bis 04:00, und ganztägig an Tagen ohne Schule | Das Dashboard (Abschnitt 4) | "Montag, 12. Oktober · Überblick" |

Schultag heißt: Montag bis Freitag, der Stundenplan hat an diesem Wochentag mindestens eine Stunde, und der Tag liegt in keinem freien Zeitraum (`free_periods`). Schulschluss ist das Ende der letzten Stunde des Tages aus `lessons` und `periods`. Der Tag wechselt um 04:00 Europe/Berlin, damit er um 00:30 noch den Überblick des Abends sieht.

An Tagen ohne Schule (Wochenende, Ferien, freie Tage) gibt es weder Morgens noch Ablauf, nur den Überblick. In den Ferien zeigt der Überblick "Ferien bis Freitag, 30.10." und sonst nur die letzten Blätter: keine Aufgaben, keinen Lernblock, kein Wiederholen. Frei heißt ganz frei (Memory "Ferien ganz frei", `src/lib/free-days.ts`).

### 3.2 Wie die App entscheidet

Die Ansicht berechnet der Server, nicht der Browser. Grundlage sind Uhrzeit, Stundenplan, freie Zeiträume und das Tagesprotokoll (15.7).

1. Kein Schultag: Überblick.
2. Vor Schulschluss: Morgens.
3. Nach Schulschluss, und im Protokoll steht weder `ablauf_beendet` noch `ablauf_uebersprungen`: Nach der Schule, auf dem Schritt, bei dem er zuletzt war.
4. Sonst: Überblick.

Die App fragt den Stand beim Öffnen und bei `visibilitychange` auf sichtbar ab, als leichte Abfrage wie `src/lib/blaetter-stand.ts`. Sie wechselt die Ansicht nie, während der Bildschirm sichtbar ist. Wer um 13:09 die Morgenansicht offen hat, sieht sie auch um 13:11 noch, bis er die App verlässt und wieder öffnet.

Kommt er aus dem Hintergrund zurück und die Ansicht hat sich geändert, läuft der Wechsel aus Modell 17 (7.2, Nr. 1 bis 3). Beim Kaltstart gibt es keinen Wechsel, die App öffnet direkt in der richtigen Ansicht.

### 3.3 Morgens

Die Kopfzeile ist die Datumszeile aus 17 Z. 414 bis 424: "Dienstag, 13. Oktober · Morgens" mit einem 6px-Punkt in `--accent` vor "Morgens" und einem Pfeil `expand_more`. Darunter die Überschrift in Newsreader:

| Abgaben heute | Überschrift |
|---|---|
| keine | "Heute nichts abzugeben" |
| eine | "Heute eine Abgabe" |
| zwei bis zwölf | "Heute zwei Abgaben" (ausgeschrieben) |

Die Regel stammt aus 17 `headline()` Z. 705 bis 713.

Darunter drei Gruppen:

1. **Abgeben.** Alle Hausaufgaben, die heute fällig sind, offene und erledigte. Erledigte stehen mit gefülltem Haken in `--ink-3` darunter, weil er auch sie einpacken muss. Offene lassen sich abhaken wie in 4.3. Am Dienstagmorgen: Mathe "S. 84, Nr. 3–5", Deutsch "Gedichtanalyse beenden".
2. **Stunden.** Die Stunden des Tages als kompakte Zeilen, Raster 58px | 1fr | auto: Beginn, Fach, Raum. Der Hauptunterricht trägt das Unterlabel "Hauptunterricht · Industrialisierung", wobei "Industrialisierung" der Name des Themas ist, zu dem das jüngste Blatt des Fachs gehört. Es gibt keine Zusätze wie Sportzeug, keine Packliste und kein "Jetzt läuft".
3. **Klausur heute**, nur wenn heute eine geschrieben wird: "Mathematik · 2. Stunde · Quadratische Funktionen". Klausuren an anderen Tagen stehen morgens nicht da.

Am Ende eine Textzeile "Ganze Woche", die die Woche öffnet. Die Morgenansicht passt bei den Beispieldaten auf 390×844 ohne Scrollen.

### 3.4 Nach der Schule

Der Ablauf erscheint von selbst beim ersten Öffnen nach Schulschluss. Er lässt sich mit "Überspringen" oben rechts auf jedem Schritt beenden und erscheint an diesem Tag dann nicht wieder. Verlässt er die App mitten im Ablauf, öffnet sie beim nächsten Mal am selben Tag auf demselben Schritt. Details in Abschnitt 5.

### 3.5 Überblick

Das Dashboard aus Abschnitt 4. Er sieht es nach dem Ablauf, am Abend und an Tagen ohne Schule.

### 3.6 Andere Tageszeit ansehen

Ein Tipp auf die Datumszeile öffnet ein kleines Menü (aus 17 Z. 90 bis 98 und `toggleMenu()` Z. 930 bis 939) mit bis zu drei Einträgen:

| Eintrag | Rechts daneben | Zeigt |
|---|---|---|
| Überblick | "jetzt", wenn er gilt | das Dashboard |
| Morgen früh | "Dienstag" | die Morgenansicht des nächsten Schultags, mit dessen Datum |
| Ablauf nach der Schule | "übersprungen" oder "erledigt" | den Ablauf von heute, nur an Schultagen nach Schulschluss |

Morgens heißt der erste Eintrag "Heute morgens" und der zweite "Überblick". Damit kann er abends nachsehen, was er für morgen packen muss, und einen übersprungenen Ablauf doch noch machen.

Schaut er eine Ansicht an, die gerade nicht gilt, steht das Wort in der Datumszeile in `--ink-3` mit Gewicht 450 ("morgens" klein geschrieben), und rechts erscheint die Pille "Jetzt" (17 `.now-pill` Z. 84 bis 89, `renderWhen()` Z. 715 bis 722). "Jetzt" führt zur geltenden Ansicht zurück. Die Morgenansicht des nächsten Tages trägt dessen Datum, so wie 17 es für "früh" macht (Z. 717).

### 3.7 Ein Montag

1. **07:10.** Er öffnet die App. Morgenansicht: "Montag, 12. Oktober · Morgens", Überschrift "Heute zwei Abgaben". Unter "Abgeben" steht Englisch "Vokabeln Unit 3" erledigt und Geschichte "Fragen zur Dampfmaschine" offen (für diesen Tag angenommen). Unter "Stunden" vier Zeilen bis 13:10. Er hakt Geschichte ab und schließt die App.
2. **16:40.** Erstes Öffnen nach Schulschluss. Die App öffnet ohne Wechselanimation auf dem Ablauf, Schritt "Blätter". Er fotografiert zwei Seiten "Arbeiterbewegung" bei Geschichte. Die Miniatur landet unter der Geschichte-Zeile, nach unter einer Sekunde steht dort "Geschichte · Industrialisierung in Deutschland".
3. "Weiter zu Hausaufgaben". Er trägt bei Biologie "Arbeitsblatt Zellatmung fertig" ein. Darunter steht "Schon offen" mit Mathe und Deutsch für Dienstag. Er tippt "Fertig".
4. Der Überblick kommt mit dem Tageszeitwechsel von rechts. Überschrift "Zwei Aufgaben für Dienstag". Darunter die beiden Aufgaben, "Eine weitere bis Donnerstag", die Klausur Mathematik mit "Lernblock · Scheitelpunktform · 25 Minuten", der Knopf "Wiederholen · 3 Themen" mit "Zuerst Geschichte · Industrialisierung in England", und die letzten drei Blätter.
5. **19:30.** Er öffnet die App wieder und landet direkt auf dem Überblick. Er tippt "Wiederholen". Der Tisch wächst aus dem Knopf. Oben "Geschichte · Industrialisierung in England", "Thema 1 von 3", "10 Fragen".
6. Zehn Fragen, zwei davon "Daneben". Beide kommen am Ende des Themas wieder, beim zweiten Mal "Saß". Themenende: "Industrialisierung in England sitzt." Darunter "10 Fragen, 8 beim ersten Mal." und "Wieder dran: Dienstag, 13.10.". Knöpfe "Fertig, weiter" mit "Mathematik · Quadratische Funktionen, 12 Fragen" und "Fertig".
7. Er tippt "Fertig". Der Tisch schrumpft in den Knopf, der jetzt "Wiederholen · 2 Themen" zeigt und darunter "Zuerst Mathematik · Quadratische Funktionen".

## 4. Überblick (Dashboard)

### 4.1 Aufbau von oben nach unten

Knapp, ohne Scrollen auf 390×844 bei den Beispieldaten. Auf einem iPhone SE (375×667) darf er scrollen, die Hausaufgaben für morgen und der Knopf "Wiederholen" stehen dort aber ohne Scrollen im Bild.

1. **Datumszeile**, 44px: "Montag, 12. Oktober · Überblick ⌄" (3.6). Ein Tipp auf das Datum selbst gibt es nicht, nur das Menü.
2. **Überschrift** in Newsreader 32px, höchstens zwei Zeilen: "Zwei Aufgaben für Dienstag", "Noch eine Aufgabe für Dienstag", "Für Dienstag ist alles erledigt". Ist der nächste Schultag nicht morgen, steht der Tag mit Datum: "Zwei Aufgaben für Montag, 19.10.". In den Ferien: "Ferien bis Freitag, 30.10.".
3. **Für Dienstag.** Abschnittslabel, darunter die offenen Aufgaben für den nächsten Schultag, höchstens drei. Gibt es mehr, steht als vierte Zeile "Und zwei weitere". Gibt es Aufgaben für spätere Tage, folgt eine leise Textzeile "Eine weitere bis Donnerstag" oder "Drei weitere bis Freitag" (Tag der spätesten Fälligkeit). Beide Textzeilen öffnen die Hausaufgabenliste.
4. **Klausur**, nur wenn eine in den nächsten 14 Tagen steht (4.4).
5. **Wiederholen** (4.5).
6. **Zuletzt abgelegt.** Abschnittslabel und eine Reihe mit den drei neuesten Blättern: Miniatur 76px hoch, leicht schief wie in V1, darunter Titel einzeilig mit Auslassung und Fach in `--ink-2`. Ein Tipp öffnet das Blatt. Rechts neben dem Label "Alle", das die Ablage öffnet.

Darunter die Zeile. Kein Primärknopf am Ende, keine Noten, kein Stundenplan.

### 4.2 Höhen bei 390×844

| Teil | Höhe |
|---|---|
| sicherer Rand oben | 47px |
| Datumszeile | 44px |
| Überschrift mit Abständen | 58px |
| Hausaufgaben: Label 34px, zwei Zeilen à 60px, Textzeile 32px | 186px |
| Klausur: Label 34px, Klausurzeile 52px, Lernblockzeile 60px | 146px |
| Wiederholen: 52px Knopf, 22px Unterzeile, 24px Abstand oben | 98px |
| Zuletzt abgelegt: Label 34px, Miniaturen 76px, Titel 36px | 146px |
| Zeile mit Abstand unten | 102px |
| Summe | 827px |

Wird es durch längere Titel enger, kürzt die App zuerst die Aufgabenliste auf zwei Zeilen plus "Und eine weitere", dann blendet sie die Titel unter den Miniaturen aus. Die Reihenfolge der Blöcke ändert sich nie.

### 4.3 Aufgabenzeile

Aus V1: Raster 48px | 1fr | auto, `min-height` 60px, Abhakkreis 26px in 48px Trefffläche, Fach fett vor dem Text. Abhaken per Tipp auf den Kreis oder Wisch nach rechts, Toast "Mathe abgehakt · Rückgängig". Auf dem Überblick bleibt die abgehakte Zeile 350ms stehen und klappt dann zu (7.2, Nr. 27). Die nächste Aufgabe rückt nach, die Überschrift zählt herunter (7.2, Nr. 4). Linkswisch legt "Bearbeiten" und "Löschen" frei.

### 4.4 Klausur auf dem Überblick

- Klausurzeile: 2px-Linie links in `--ink`, "Mathematik" 17px/680, daneben "Fr 16.10. · in 4 Tagen" in `--ink-2`. Ein Tipp öffnet die Klausur.
- Lernblockzeile, nur wenn heute ein Lernblock im Plan steht: "Lernblock · Scheitelpunktform · 25 Minuten", rechts der Knopf "Starten" als umrandete Pille in `--accent`, 44px hoch. Läuft er, zeigt der Knopf die Restzeit mit gefülltem Timer-Icon. Pausiert: "Pausiert bei 18:42". Nach dem Block: "Erledigt" mit `check_circle`, die Zeile bleibt bis 04:00 stehen.
- Steht heute kein Lernblock an, zeigt die zweite Zeile den nächsten: "Nächster Lernblock Mittwoch · Wiederholung", ohne Knopf.
- Mehrere Klausuren in 14 Tagen: nur die nächste steht da, darunter "Und eine weitere am Do 22.10.", das die Klausurenliste öffnet.

Der Lernplan selbst läuft wie gehabt (`src/lib/study-plan.ts`, Lernblöcke ohne Uhrzeit).

### 4.5 Wiederholen auf dem Überblick

Ein Knopf über die volle Spaltenbreite, 52px hoch, Pille in `--accent` mit Text in `--on-accent`. Links "Wiederholen" 17px/620, rechts die Zahl der fälligen Themen: "3 Themen", tabular-nums. Unter dem Knopf in `--ink-2` 14px: "Zuerst Geschichte · Industrialisierung in England". Er ist das einzige gefüllte Element auf dem Überblick.

| Zustand | Anzeige |
|---|---|
| Themen fällig | Knopf wie oben |
| ein Thema angefangen und abgebrochen | Knopf, Unterzeile "Weiter mit Geschichte · Industrialisierung in England, noch 4 Fragen" |
| heute alle durch | kein Knopf, Textzeile mit `check_circle`: "Für heute durch. Nächstes Thema Dienstag." |
| nichts fällig, nichts gemacht | Textzeile: "Heute ist nichts fällig. Nächstes Thema Mittwoch." |
| es gibt noch keine Fragen | Textzeile: "Noch keine Fragen. Sie entstehen aus den Blättern eines Themas." |
| Ferien | der Block fehlt |

Die Zahl zählt Themen, nicht Fragen. Ein Thema ist fällig, wenn mindestens eine seiner Fragen heute oder früher fällig ist und noch nicht saß.

## 5. Ablauf nach der Schule

### 5.1 Rahmen

- Oben das Schrittband mit zwei Segmenten "Blätter" und "Hausaufgaben", Trefffläche 44px, jedes antippbar. Rechts daneben der Textknopf "Überspringen" 15px/560 in `--ink-2`, 44px Trefffläche.
- Ohne Datumszeile. Der Ablauf ist die Ansicht, keine Seite darüber.
- Der Knopf zum nächsten Schritt steht am Ende des Inhalts im Scrollbereich wie in V1 2.4: links ein runder Zurück-Knopf (52px, nur in Schritt 2), rechts der Primärknopf, 52px hoch.
- Zwischen den Schritten wird nicht seitlich gewischt. Vorwärts kommt von rechts, zurück von links (7.2, Nr. 5 und 6).

### 5.2 Schritt 1: Blätter

Überschrift "Neue Blätter?" in Newsreader.

**Geändert am 11.10.2026 auf Wunsch des Nutzers: keine Fotos pro Fach.** Wörtlich: „das Fotos soll nur Fotos sein, nicht pro Fach Fotos, weil wozu habe ich das ganze“. Die App ordnet Fach und Thema selbst ein (Jev), deshalb wählt er beim Fotografieren nie ein Fach.

- Ein einziger, großer Einstieg: ein Knopf "Fotografieren" (Primärknopf, volle Breite, 56px) oder, besser, die Kamera direkt eingebettet als großer Sucher-Bereich in der Ansicht, ein Tipp auf den Auslöser nimmt auf. Keine Fachzeilen, keine Fachauswahl, kein "Anderes Fach".
- Mehrere Blätter hintereinander: jedes Foto fliegt als Miniatur in einen Streifen unter dem Sucher. Mehrseitige Blätter: "Seite dazu" an der letzten Miniatur.
- Abgelegte Blätter erscheinen als Liste unter dem Sucher, erst mit Status "Wird eingeordnet …", dann mit dem erkannten Fach und Thema (z. B. "Geschichte · Industrialisierung"). Nur dort kann man das Fach nachträglich ändern, falls die Erkennung danebenliegt.
- Primärknopf: "Keine Blätter, weiter", nach dem ersten Foto "Weiter zu Hausaufgaben".
- Abnahmekriterien 19 und 20 gelten in dieser Form nicht mehr: Stattdessen gilt: Schritt 1 zeigt keine Fächer; ein Tipp genügt, um zu fotografieren; nach drei Fotos stehen drei Blätter mit erkanntem Fach in der Liste, ohne dass ein Fach gewählt wurde.

### 5.3 Schritt 2: Hausaufgaben

Überschrift "Was hast du auf?" in Newsreader.

- Die Fächer von heute aus dem Stundenplan in Stundenreihenfolge als Fachzeilen (Raster 1fr | auto, `min-height` 64px, Fachname 18px/620, darunter "Nächste Stunde Donnerstag" in `--ink-2`), danach "Anderes Fach". Hier sind Fachzeilen richtig, weil eine Hausaufgabe ein Fach braucht. Rechts die Pille "+ Aufgabe". Sie öffnet die Zeile im Kontext Eintragen mit Fach und nächster Stunde als Tokens (V1 4.3, Regel 1). Eingetragene Aufgaben landen unter dem Fach (Geistflug, 7.2 Nr. 23).
- "Anderes Fach" öffnet die Zeile im Kontext Eintragen ohne Fach-Token, das Token "welches Fach?" gestrichelt, darüber eine Reihe Fach-Pillen.
- Darunter die Gruppe "Schon offen" mit allen offenen Aufgaben, nach Fälligkeit sortiert, Unterlabel mit Tag. Abhaken und Linkswisch wie in 4.3.
- Primärknopf: "Fertig". Er schreibt `ablauf_beendet` und wechselt zum Überblick (7.2, Nr. 1 bis 3, Richtung vorwärts).

### 5.4 Überspringen und Rückkehr

- "Überspringen" schreibt `ablauf_uebersprungen` und wechselt zum Überblick wie "Fertig".
- Danach erscheint der Ablauf an diesem Tag nicht mehr von selbst. Über das Menü der Datumszeile ist er erreichbar (3.6). Geöffnet von dort, hat er statt "Überspringen" oben rechts "Schließen".
- Was im übersprungenen oder abgebrochenen Ablauf schon eingetragen oder abgelegt wurde, bleibt.
- An Tagen ohne Schule gibt es keinen Ablauf, auch nicht im Menü.

## 6. Wiederholen nach Themen

### 6.1 Grundsatz

Wiederholen fragt die fälligen Fragen ab, immer ein Thema am Stück. Er wählt das Thema nicht. Die App nimmt das Thema, das am dringendsten fällig ist. Die Fragen stammen aus seinen Blättern: aus der laufenden Epoche und aus jedem anderen Fach, zu dem es Fragen gibt, etwa Französisch. Fragen aus verschiedenen Themen werden nie gemischt.

### 6.2 Was ein Thema ist und welches zuerst kommt

- Ein Thema ist ein Eintrag im Themenvokabular eines Fachs (`subject_topics`). Jede Frage gehört über `recall_items.subject_topic_id` zu einem Thema. Fragen ohne Thema bilden je Fach ein eigenes Thema "Geschichte · ohne Thema".
- Fällig ist eine Frage, wenn sie einen offenen Termin mit `due_on` heute oder früher hat. Je Frage zählt nur ein Termin, der älteste, wie in `faelligHeute()` (`src/recall/sessions.ts`).
- Reihenfolge der Themen:
  1. ältester offener Termin zuerst,
  2. bei Gleichstand das Thema, dessen Fach die nähere Klausur hat,
  3. dann das Thema mit mehr fälligen Fragen,
  4. dann alphabetisch nach Fach und Thema.
- Ein angefangenes, abgebrochenes Thema kommt beim nächsten Start zuerst, auch wenn inzwischen ein anderes dringender ist.
- Es gibt keine Obergrenze für Fragen je Thema. Fällige Wiederholungen werden nicht gedeckelt (Kommentar an `recall_schedule`, A16).

### 6.3 Einstieg

Ein Tipp auf "Wiederholen" lässt den Tisch aus dem Knopf wachsen (7.2, Nr. 41). Dasselbe tun die Zeile mit "wiederholen", "abfragen" oder "karten" und der Vorschlag "Wiederholen" im leeren Menü der Zeile.

Kopf des Tisches von oben nach unten:

- Links Schließen (44px), rechts "Thema 1 von 3" 13px/600 in `--t-on` mit Deckkraft .7.
- Fach und Thema: "Geschichte" 13px/600, darunter "Industrialisierung in England" 22px/720, einzeilig, sonst Auslassung. Bei der laufenden Epoche steht vor dem Fach "Epoche · ".
- Fortschritt als Striche, ein Strich je Frage bis 20 Fragen, darüber ein durchgehender Balken (19 `renderTicks()` Z. 737 bis 749). Darunter "10 Fragen", nach einem "Daneben" "10 Fragen · 1 kommt nochmal".

Es gibt keinen eigenen Startbildschirm je Thema. Die erste Karte steht sofort da.

### 6.4 Eine Runde

Jede Frage durchläuft drei Zustände. Die Abfolge stammt aus dem echten Abruf (`src/app/(app)/abruf/sitzung/session-view.tsx`): erst schreiben, dann Lösung, dann Urteil. Ein Urteil ohne vorherige Eingabe gibt es nicht (N11).

**1. Frage.** Die Karte (Radius 22, `--card`) zeigt oben das Fach links und "Frage" rechts, 13px/600. Darunter die Frage in Newsreader 27px/500. Unten in der Karte das Antwortfeld, 17px, Platzhalter "Schreib, was du weißt.", mehrzeilig, wächst bis vier Zeilen. Unter der Karte zwei Knöpfe, je 64px hoch, Radius 22: links "Weiß ich nicht" in `--t-fill-2`, rechts "Aufdecken" in `--known`. "Weiß ich nicht" schickt ein leeres Feld ab, das zählt als Versuch.

**2. Lösung.** Die Karte dreht sich um (7.2, Nr. 47). Rückseite:
- "Deine Antwort" als Label in `--card-ink-2`, darunter sein Text oder "Nichts geschrieben".
- "Musterlösung", darunter die Zeilen der Lösung als nummerierte Liste.
- Der Verwechslungssatz in `--card-ink-2`.
- Eine eingeklappte Zeile "Das stand im Heft". Aufgeklappt zeigt sie das Zitat und "Blatt ansehen", das das Blatt als Sheet von unten öffnet.
- Ganz unten der Textknopf "Stand so nicht im Heft". Er fragt "Diese Frage zurückziehen?" mit "Zurückziehen" und "Abbrechen". Zurückgezogen zählt sie nicht mehr und kommt nie wieder.

Wird die Rückseite länger als die Karte, scrollt sie innerhalb der Karte.

**3. Urteil.** Unter der Karte statt der zwei Knöpfe: links "Daneben" in `--t-fill-2`, rechts "Saß" in `--known`. Wisch nach rechts heißt Saß, nach links Daneben, mit Stempel, der dem Finger folgt. Vor dem Aufdecken gibt die Karte beim Ziehen nur zäh nach, und der Hinweis "Erst antworten." erscheint.

- "Saß" schließt den Termin der Frage (`done_at`).
- "Daneben" lässt ihn offen und legt die Frage ans Ende dieses Themas. Sie kommt in derselben Runde wieder, bis sie saß. So verlangt es A6: Ein Termin gilt erst als erledigt, wenn die Frage einmal richtig abgerufen wurde.
- Bewertungen sperren nicht. Die nächste Karte nimmt Eingaben an, während die alte noch fliegt.

**Tastatur.** Bei offener Tastatur hebt sich der Fuß des Tisches wie die Zeile über `visualViewport` (V1 4.1). Die Karte wird so hoch, wie der Platz zwischen Kopf und Knöpfen reicht, höchstens 448px. Ihre Höhe folgt der Tastatur ohne eigene Animation. Die Frage bleibt immer ganz sichtbar, der Stapel dahinter blendet aus.

### 6.5 Themenende

Ist die letzte Frage des Themas "Saß", fliegt sie weg, und an ihrer Stelle erscheint auf dem Tisch ohne Karte (7.2, Nr. 55):

- "Industrialisierung in England sitzt." in Newsreader 32px/500.
- "10 Fragen, 8 beim ersten Mal." Ohne "Daneben": "10 Fragen, alle beim ersten Mal." Kein Prozentwert, keine Serie, kein Vergleich mit früher (Kommentar an `src/app/(app)/abruf/page.tsx`).
- "Wieder dran: Dienstag, 13.10." aus dem nächsten offenen Termin des Themas. Ohne weiteren Termin entfällt die Zeile.

Darunter zwei Knöpfe, je 64px hoch:

| Knopf | Aussehen | Unterzeile | Wirkung |
|---|---|---|---|
| "Fertig, weiter" | `--known`, Text `--card-ink` | "Mathematik · Quadratische Funktionen, 12 Fragen" | das nächste Thema, ohne den Tisch zu verlassen (7.2, Nr. 56) |
| "Fertig" | `--t-fill-2` | keine | Tisch schrumpft in den Knopf auf dem Überblick (7.2, Nr. 57) |

Beim letzten Thema gibt es nur "Fertig", darüber "Alle Themen für heute durch."

### 6.6 Abbrechen

Schließen mitten im Thema fragt nicht nach. Jede Antwort ist beim Urteil schon gespeichert. Das Thema bleibt fällig, beim nächsten Start geht es dort weiter (6.2). Die Unterzeile unter dem Knopf auf dem Überblick sagt "Weiter mit ..., noch 4 Fragen".

### 6.7 Leere Zustände

- Kein Thema fällig: kein Knopf, Textzeile nach 4.5. Die Zeile mit "wiederholen" antwortet im Menü mit derselben Textzeile.
- Fragen eines Themas zwischen Start und Antwort zurückgezogen oder schon im Lernblock beantwortet: Die Karte wird übersprungen, ohne Meldung. Bleibt nichts übrig, kommt direkt das Themenende.
- Ferien: kein Wiederholen, auch nicht über die Zeile. Die Zeile antwortet "In den Ferien wird nicht wiederholt."

### 6.8 Die drei Beispielthemen

Jede Frage hat eine Musterlösung und einen Verwechslungssatz. Hier steht der Verwechslungssatz für drei Fragen je Thema, im Prototyp hat jede Frage einen.

**Thema 1: Geschichte · Industrialisierung in England (Epoche), 10 Fragen, fällig seit Sa 10.10.**

| Nr. | Frage | Musterlösung |
|---|---|---|
| 1 | In welchem Land begann die Industrialisierung, und ungefähr wann? | England; um 1760 |
| 2 | Was verbesserte James Watt 1769 an der Dampfmaschine? | eigener Kondensator, getrennt vom Zylinder; braucht viel weniger Kohle |
| 3 | Nenne zwei Gründe, warum die Industrialisierung in England begann. | Kohle und Eisenerz im Land; Kapital aus Handel und Kolonien; mehr Menschen durch Bevölkerungswachstum |
| 4 | Was war die Spinning Jenny, und wer erfand sie? | Spinnmaschine mit mehreren Spindeln zugleich; James Hargreaves, 1764 |
| 5 | Was unterscheidet eine Fabrik von einer Manufaktur? | Fabrik: Maschinen mit Antrieb, etwa Dampf; Manufaktur: Handarbeit, aufgeteilt in Arbeitsschritte |
| 6 | Wie lang war ein Arbeitstag in einer englischen Textilfabrik um 1830? | 12 bis 16 Stunden; sechs Tage in der Woche |
| 7 | Was regelte der Factory Act von 1833? | keine Kinder unter 9 Jahren in Textilfabriken; 9 bis 13 Jahre höchstens 9 Stunden am Tag; Fabrikinspektoren kontrollieren |
| 8 | Warum zogen viele Menschen vom Land in die Städte? | Arbeit in den Fabriken; auf dem Land gab es zu wenig Arbeit für die wachsende Bevölkerung |
| 9 | Was meint der Begriff "soziale Frage"? | die Not der Arbeiter im 19. Jahrhundert; enge Wohnungen, lange Arbeitszeit, niedriger Lohn, keine Absicherung bei Krankheit, Unfall und Alter |
| 10 | Wofür brauchte man Dampfmaschinen zuerst? | zum Abpumpen von Wasser aus Bergwerken |

Verwechslungssätze:
- Nr. 2: "Watt hat die Dampfmaschine nicht erfunden. Die erste brauchbare baute Thomas Newcomen 1712, Watt machte sie sparsamer."
- Nr. 5: "In der Manufaktur ist die Arbeit schon aufgeteilt. Der Unterschied ist die Maschine mit Antrieb, nicht die Arbeitsteilung."
- Nr. 7: "Der Factory Act verbot Kinderarbeit nicht ganz. Er setzte ein Mindestalter und begrenzte die Stunden."

**Thema 2: Mathematik · Quadratische Funktionen, 12 Fragen, fällig Mo 12.10., Klausur Fr 16.10.**

| Nr. | Frage | Musterlösung |
|---|---|---|
| 1 | Wie lautet die Scheitelpunktform einer quadratischen Funktion? | *f(x) = a(x − d)² + e*; Scheitelpunkt S(d \| e) |
| 2 | Welchen Scheitelpunkt hat *f(x) = (x − 2)² + 3*? | S(2 \| 3) |
| 3 | Welchen Scheitelpunkt hat *f(x) = −(x + 1)² − 4*? | S(−1 \| −4) |
| 4 | Was bewirkt ein negatives a? | Die Parabel ist nach unten geöffnet. |
| 5 | Was bewirkt \|a\| > 1? | Die Parabel ist gestreckt, also schmaler als die Normalparabel. |
| 6 | Wie lautet die pq-Formel für *x² + px + q = 0*? | *x = −p/2 ± √((p/2)² − q)* |
| 7 | Wann hat *x² + px + q = 0* keine Lösung? | wenn *(p/2)² − q* kleiner als 0 ist |
| 8 | Bestimme die Nullstellen von *x² − 6x + 8*. | x = 2 und x = 4 |
| 9 | Bring *f(x) = x² + 4x + 1* in Scheitelpunktform. | quadratische Ergänzung; *f(x) = (x + 2)² − 3*; S(−2 \| −3) |
| 10 | Wohin verschiebt *(x − 3)²* die Normalparabel? | um 3 nach rechts |
| 11 | Wie viele Nullstellen kann eine quadratische Funktion haben? | keine, eine oder zwei |
| 12 | Welche Symmetrieachse hat *f(x) = (x − 2)² + 3*? | die senkrechte Gerade x = 2 |

Verwechslungssätze:
- Nr. 2: "Das Vorzeichen in der Klammer dreht sich um: (x − 2) heißt d = 2, nicht −2."
- Nr. 6: "Vor dem Bruch steht −p/2. Wer p/2 nimmt, bekommt Nullstellen mit falschem Vorzeichen."
- Nr. 10: "Minus in der Klammer heißt nach rechts, nicht nach links."

**Thema 3: Französisch · Passé composé mit être, 8 Fragen, fällig Mo 12.10., keine Klausur**

| Nr. | Frage | Musterlösung |
|---|---|---|
| 1 | Welche Verben bilden das passé composé mit être? | Verben der Bewegung und des Zustandswechsels: aller, venir, partir, arriver, entrer, sortir, monter, descendre, naître, mourir, rester, tomber; dazu alle reflexiven Verben |
| 2 | Setze ein: Elle ___ (aller) au cinéma. | Elle est allée au cinéma. |
| 3 | Setze ein: Nous ___ (partir) à huit heures. (Jungen) | Nous sommes partis à huit heures. |
| 4 | Setze ein: Ils ___ (arriver) hier. | Ils sont arrivés hier. |
| 5 | Setze ein: Je me ___ (lever) tôt. (Ein Mädchen spricht.) | Je me suis levée tôt. |
| 6 | Übersetze: Sie (mehrere Frauen) sind gestern gekommen. | Elles sont venues hier. |
| 7 | Wie lauten die Partizipien von naître und mourir? | né; mort |
| 8 | Setze ein: Marie et Paul ___ (rester) à la maison. | Marie et Paul sont restés à la maison. |

Verwechslungssätze:
- Nr. 2: "Mit être richtet sich das Partizip nach dem Subjekt: elle, also allée mit e."
- Nr. 5: "Reflexive Verben bilden das passé composé immer mit être, auch wenn das Verb sonst avoir nimmt."
- Nr. 8: "Ein Mann in der Gruppe reicht für die männliche Pluralform: restés, nicht restées."

## 7. Die Eingabezeile

Die Zeile bleibt, wie sie in V1 Abschnitt 4 festgelegt ist: Aussehen (4.1), Aufbau des Menüs (4.2), Parser mit sechs Regeln (4.3), Rückfrage und Dubletten (4.5), Suche (4.6). Diese Abschnitte gelten wörtlich weiter. Er findet die Zeile gut, deshalb ändert V2 nur, was die neue Struktur verlangt.

### 7.1 Wo sie steht

Auf Morgens, im Ablauf, auf dem Überblick und auf allen Nachschlagebildschirmen. Ausgeblendet auf Kamera und Tisch. Sie lebt in der Shell und wird beim Tageszeitwechsel nicht neu gerendert und nicht animiert.

### 7.2 Änderungen am Parser

- Neue Zielwörter für Regel 4: wiederholen, wiederholung, überblick, packen, epoche, stundenplan bleibt.
- "abfragen", "abfrage", "karten" führen jetzt zu Wiederholen.
- "noten" führt zum Noten-Bereich, nicht mehr zu einer Notenzeile auf "Lernen".
- "morgen" zeigt als Antwort die Morgenansicht des nächsten Schultags als Zusammenfassung: Stunden und Abgaben. Darunter "Morgenansicht öffnen".
- Der Hauptunterricht hat jeden Tag eine erste Stunde. "geschichte quellen lesen" wird deshalb "Eintragen · Geschichte · bis Di 13.10.".

### 7.3 Beispiele, ergänzt

| Eingabe | Absicht | Erste Zeile | Warum |
|---|---|---|---|
| wiederholen | Suchen | Wiederholen · 3 Themen, zuerst Geschichte | Regel 4 |
| abfragen mathe | Suchen | Wiederholen · nur Mathematik · Quadratische Funktionen | Regel 4, Fach als Filter |
| geschichte quellen lesen | Eintragen | Eintragen · Geschichte · bis Di 13.10. | Regel 5, nächste Stunde ist der Hauptunterricht |
| dampfmaschine | Suchen | Blatt "Die Dampfmaschine", Treffer in der Abschrift | Regel 6, Volltext |
| ?geschichte dampfmaschine | Suchen | Blatt "Die Dampfmaschine" | Präfix |
| frz passé composé | Eintragen | Eintragen · Französisch · bis Mi 14.10. | Regel 5, Alias "frz" |
| noten | Suchen | Zeigt · Noten | Regel 4 |
| packen | Suchen | Zeigt · Dienstag, 13.10., 4 Stunden, 2 Abgaben | Regel 4 |

"abfragen mathe" ist die einzige Stelle, an der er ein Thema selbst wählt. Sie startet Wiederholen mit den fälligen Themen dieses Fachs in derselben Reihenfolge wie 6.2. Ist im Fach nichts fällig, antwortet die Zeile "In Mathematik ist heute nichts fällig."

Alle Beispiele aus V1 4.4 gelten weiter, mit den Daten von Abschnitt 2.

### 7.4 Leeres Feld: "Wohin?"

Bei leerem Feld zeigt das Menü oben bis zu zwei Vorschläge, darunter "Zuletzt geöffnet" mit höchstens drei Einträgen, darunter "Wohin?" mit allen Bereichen: Überblick, Woche, Hausaufgaben, Klausuren, Wiederholen, Noten, Ablage, Fächer, Einstellungen.

| Ansicht | Vorschläge |
|---|---|
| Morgens | Woche, Klausur Mathematik (nur in der Klausurwoche) |
| Ablauf, Schritt Blätter | Blatt aufnehmen, Morgen |
| Ablauf, Schritt Hausaufgaben | Morgen, Woche |
| Überblick | Wiederholen, Lernblock starten (nur wenn heute einer offen ist) |

Ein Vorschlag fällt weg, sobald er in dieser Öffnung benutzt wurde (16 `chipHTML()` Z. 552 bis 567).

## 8. Kamera

Die Kamera gilt wie in V1 5.1: Vorwärmen bei `pointerdown`, "Kamera startet", "Foto auswählen" bei verweigerter Freigabe, Aufbau mit Fach-Chip (zeigt vor dem Einordnen "Fach erkennen", wählbar ist dort nichts), festen Rahmenecken und Auslöser, mehrere Seiten werden ein Blatt, kein Formular nach dem Auslösen, Jev ordnet ein, Status vom Server in Worten, Umsortieren per Fachzeile.

Geändert sind nur die Einstiege und das Ziel der Miniatur:

| Einstieg | Fach-Chip | Miniatur landet |
|---|---|---|
| "Fotografieren" im Ablauf (Schritt 1) | immer "Fach erkennen", nie ein vorgewähltes Fach | in der Liste unter dem Sucher in Schritt 1 |
| Kameraknopf in der Zeile, auf dem Überblick | "Fach erkennen" | an erster Stelle unter "Zuletzt abgelegt", die anderen rücken nach rechts, das dritte fällt heraus |
| Kameraknopf in der Zeile, auf Morgens oder Nachschlagen | "Fach erkennen" | keine Flugbahn; Toast "Blatt abgelegt · Ansehen" |

Auf dem Überblick steht der Status unter dem Titel der Miniatur in 13px: "Wird eingeordnet", dann "Geschichte · Industrialisierung in Deutschland".

## 9. Lernblock und Klausur

### 9.1 Lernblock

Der Lernblock läuft auf demselben Tisch wie Wiederholen. Unterschiede:

- Er startet über "Starten" in der Lernblockzeile auf dem Überblick, über "Lernblock starten" in der heutigen Planzeile der Klausur oder über die Zeile mit "lernblock". Der Tisch wächst aus dem gedrückten Knopf.
- Oben rechts die Uhr "24:12", Schibsted 15px/560, tabular-nums. Ein Tipp pausiert und setzt fort. Darunter die 3px-Restzeitlinie über die volle Breite.
- Kopf: "Lernblock · Scheitelpunktform" statt Thema, ohne "Thema 1 von 3".
- Fragen: die heute offenen Fragen der Klausurthemen in der Reihenfolge der Klausur. Antworten und Urteilen wie in 6.4. Eine Frage, die hier saß, ist auch für Wiederholen erledigt, denn beide schreiben denselben Termin. Sind keine Fragen offen, öffnet der Lernblock direkt mit dem Material.
- Unter den Knöpfen die Zeile "Material · Scheitelpunktform, 2 Seiten". Sie öffnet das Blatt als Sheet von unten. Die Uhr läuft weiter.
- Uhr, Pause, "Zeit um" und "Block beenden" mit "Als erledigt zählen? 23 Minuten gelernt" gelten wie in V1 5.3. Unter einer Minute keine Rückfrage und keine Zählung.
- Am Ende schrumpft der Tisch in den Knopf, aus dem er kam. Die Lernblockzeile zeigt "Erledigt".
- Schließen hält den Block nicht an. Der Knopf "Starten" zeigt dann die Restzeit.

### 9.2 Klausur

Nachschlagebildschirm, Route `/klausuren/[id]`, öffnet von rechts. Inhalt wie V1: Titel 22px/720, "Freitag, 16.10. · in 4 Tagen", Thema, kompletter Lernplan als Zeitleiste (Raster 52px | 1fr, Tages-Pillen 44×26, heute in `--accent`, Klausurtag in `--ink`), Blätter zum Thema. Neu: die Zeile "Noten in Mathematik 2 · 3+ · 2−" öffnet die Fachseite im Noten-Bereich. Die Klausur ist der einzige Ort außerhalb des Noten-Bereichs, an dem Noten stehen, und nur die des eigenen Fachs.

## 10. Noten-Bereich

Ein eigener Nachschlagebereich, erreichbar über die Zeile ("noten", "Wohin?") und über die Notenzeile einer Klausur. Nicht auf dem Überblick, nicht morgens.

- **Übersicht** `/noten`: Überschrift "Noten" in Schibsted 22px/720. Je Fach mit Noten eine Zeile, Raster 1fr | auto, `min-height` 60px: links Fachname 17px/620, darunter die Noten in Reihenfolge des Eintragens "2 · 3+ · 2−" in `--ink-2`; rechts der Fachschnitt "2,3" 17px/620, tabular-nums. Der Schnitt kommt aus `average` in `src/lib/grades.ts` und rechnet nach der Gewichtung des Fachs. Fächer ohne Noten fehlen. Darüber eine Zeile "Gesamt 2,4" aus `overall`.
- **Fach** `/noten/fach/[id]`: die Noten einzeln als Zeilen mit Titel, Datum und Art, darunter "Schriftlich 2,0 · Mündlich 2,7" aus `written` und `oral`. Neue Note über den Textknopf "Note eintragen" am Ende der Liste.
- Leerer Zustand: "Noch keine Noten eingetragen."
- Keine Trends, keine Pfeile, keine Farben je Note.

## 11. Hell und dunkel

Hell oder dunkel folgt allein `prefers-color-scheme` des Handys. Es gibt keinen Umschalter in der App und keine Farbstimmung je Tageszeit. `data-theme` bleibt nur als Prüfschalter für Entwicklung und Abnahme. Tokens auf `:root`, Dunkel unter `@media (prefers-color-scheme: dark)` mit `:root:not([data-theme="light"])` und zusätzlich unter `:root[data-theme="dark"]`.

### 11.1 Farbwerte

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `--bg` | #F4F1E9 | #17160F | Papier |
| `--raise` | #E9E5DA | #221F19 | stille Pillen |
| `--raise-2` | #DFDACD | #2C2922 | gedrückt, Menüauswahl |
| `--sheet` | #FBF9F4 | #1E1C16 | Menü, Sheets |
| `--line` | rgba(36,33,28,.12) | rgba(236,232,222,.12) | Haarlinien |
| `--line-strong` | rgba(36,33,28,.22) | rgba(236,232,222,.22) | Umrandungen |
| `--ink` | #1F1D19 | #ECE8DE | Text |
| `--ink-2` | #56524A | #BDB7AA | Nebentext |
| `--ink-3` | #6F6A60 | #9A9488 | erledigt, Vorschau-Tageszeit |
| `--accent` | #2A44C0 | #8D9CFF | einziger Akzent |
| `--on-accent` | #FFFFFF | #0E1120 | Text auf Akzent |
| `--dock` | #1F1D19 | #0E0D0A | die Zeile |
| `--dock-edge` | transparent | rgba(236,232,222,.14) | 1px Rand der Zeile |
| `--dock-text` | #F4F1E9 | #ECE8DE | Text in der Zeile |
| `--dock-muted` | #B9B3A6 | #8E897E | Platzhalter, Lupe |
| `--dock-line` | #46433C | #2C2922 | Trennstrich zur Kamera |
| `--mark` | #FFDD4A | #FFDD4A | nur das Aufleuchten neuer Zeilen |
| `--error` | #B3261E | #F2B8B5 | Fehlertext |
| `--scrim` | rgba(31,29,25,.32) | rgba(0,0,0,.5) | hinter Menü und Sheets |
| `--camera` | #0B0B0C | #0B0B0C | Kamera |
| `--table` | #2A44C0 | #121A4E | Tisch |
| `--t-on` | #F4F6FF | #F4F6FF | Text auf dem Tisch |
| `--t-fill` | rgba(244,246,255,.10) | rgba(244,246,255,.10) | Flächen auf dem Tisch |
| `--t-fill-2` | rgba(244,246,255,.18) | rgba(244,246,255,.18) | "Weiß ich nicht", "Daneben", "Fertig" |
| `--card` | #FFFFFF | #1A1F3D | Karte |
| `--card-ink` | #12183A | #F4F6FF | Text auf der Karte |
| `--card-ink-2` | #5A6185 | #AAB1C9 | Nebentext auf der Karte |
| `--card-field` | #F1F3FA | #232A4D | Antwortfeld auf der Karte, neu |
| `--card-line` | rgba(18,24,58,.12) | rgba(244,246,255,.14) | Trennlinien auf der Karte, neu |
| `--known` | #FFFFFF | #EEF0F7 | "Aufdecken", "Saß", "Fertig, weiter"; Text #12183A |

### 11.2 Gemessene Kontraste

Berechnet nach WCAG 2.1 aus den Werten oben.

| Paar | Hell | Dunkel |
|---|---|---|
| `--ink` auf `--bg` | 14,9 | 14,8 |
| `--ink-2` auf `--bg` | 6,9 | 9,1 |
| `--ink-3` auf `--bg` | 4,8 | 6,0 |
| `--accent` auf `--bg` | 6,9 | 7,2 |
| `--on-accent` auf `--accent` | 7,8 | 7,4 |
| `--dock-muted` auf `--dock` | 8,1 | 5,6 |
| `--t-on` auf `--table` | 7,2 | 15,2 |
| `--card-ink-2` auf `--card` | 6,0 | 7,5 |
| `--known` auf `--table` | 7,2 | 14,4 |
| `--error` auf `--bg` | 5,8 | 10,6 |

Jeder Text erreicht mindestens 4,5. `--ink-3` steht nur in Text ab 14px.

### 11.3 Regeln für beide Schemata

- Blau ist der einzige Akzent. Auf Papier ist der Knopf "Wiederholen" die einzige blaue Fläche. Auf dem Tisch wird Blau zur ganzen Fläche.
- Die Zeile ist die einzige dunkle Fläche auf hellem Papier. Im Dunkeln setzt sie sich mit `--dock-edge` ab.
- Gelb erscheint nur als Aufleuchten, in beiden Schemata gleich.
- Schatten im Dunkeln: Zeile und Menü bekommen statt Schatten den 1px-Rand in `--line-strong`. Karten auf dem Tisch behalten ihren Schatten mit Deckkraft .55.
- Miniaturen von Blättern bekommen im Dunkeln einen 1px-Rand in `--line`, das Foto selbst wird nicht abgedunkelt.
- theme-color: Papier `#F4F1E9` / `#17160F`, Kamera `#0B0B0C`, Tisch `#2A44C0` / `#121A4E`. Gesetzt nach `matchMedia('(prefers-color-scheme: dark)')`, mit `change`-Listener.
- Wechselt das Handy das Schema, während die App offen ist, wechseln die Farben ohne Animation.

## 12. Gestaltung

### 12.1 Schriften

Wie V1 6.1: Schibsted Grotesk für alles Bedienbare und allen Text, Newsreader nur für Überschriften der Ansichten und Fragen, Material Symbols Rounded für Icons.

Newsreader steht in V2 an diesen Stellen: Überschrift der Morgenansicht, des Überblicks und der beiden Ablaufschritte, die Kartenfrage, der Satz am Themenende ("... sitzt."), Formeln in Abschrift, Karte und Musterlösung (kursiv, opsz 24, 400).

| Element | Schrift | Größe / Zeilenhöhe | Gewicht | Laufweite |
|---|---|---|---|---|
| Überschrift Morgens, Überblick | Newsreader, opsz 72 | 32 / 1.08 | 500 | −0.018em, `text-wrap: balance` |
| Überschrift Ablaufschritt | Newsreader, opsz 72 | 38 / 1.04 | 500 | −0.018em |
| Themenende | Newsreader, opsz 72 | 32 / 1.1 | 500 | −0.015em |
| Kartenfrage | Newsreader, opsz 72 | 27 / 1.2 | 500 | −0.01em |
| Formel | Newsreader kursiv, opsz 24 | 23 / 1.3 | 400 | 0 |
| Datumszeile | Schibsted | 15 / 1.3 | 450, Tageszeit 560 | 0 |
| Thema auf dem Tisch | Schibsted | 22 / 1.2 | 720 | −0.02em |
| Antwortfeld | Schibsted | 17 / 1.4 | 450 | 0 |
| Musterlösung | Schibsted | 16 / 1.45 | 450 | 0 |
| Notenschnitt | Schibsted | 17 / 1 | 620 | 0, tabular-nums |

Alle übrigen Größen aus V1 6.1 gelten weiter. Alle Zahlen tabular-nums. `font-synthesis: none`.

### 12.2 Abstände und Ecken

Wie V1 6.3, mit diesen Ergänzungen:

- Datumszeile 44px hoch, Text links bündig mit dem Seitenrand 22px, Menü 250px breit, Radius 14, 6px Innenabstand, Einträge 44px (aus 17 Z. 90 bis 98).
- Überblick: Gruppenabstand 24px statt 28px, damit er ohne Scrollen passt.
- Knopf "Wiederholen" 52px hoch, Radius 999.
- Miniaturen auf dem Überblick: drei Spalten mit 12px Abstand, Höhe 76px, Radius 3.
- Antwortfeld auf der Karte: Radius 14, Innenabstand 12px 14px, Hintergrund `--card-field`.
- Morgenansicht: Stundenzeilen 48px hoch, Raster 58px | 1fr | auto.
- Treffflächen mindestens 44×44.

### 12.3 Was es nicht gibt

Keine Karte in einer Karte, keine Zeile in Großbuchstaben über Überschriften, keine Verläufe als Fläche, keine Emojis, keine Reiterleiste, keine Zahl ohne Datengrundlage, keine Serie und keine Trefferquote in Prozent.

## 13. Animationen

### 13.1 Grundregeln

Kurven als Tokens, keine anderen:

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--ease-io:     cubic-bezier(0.77, 0, 0.175, 1);
--ease-grow:   cubic-bezier(0.6, 0, 0.2, 1);
--ease-flip:   cubic-bezier(0.2, 0.8, 0.2, 1);
```

Dazu die Feder `spring(520, 42)` als vorberechnete `linear()`-Kurve (14 `spring()` Z. 485 bis 494) für alles, was nach einer Geste losgelassen wird.

Animiert werden nur `transform` und `opacity`, per WAAPI. Unterbrechen heißt, aus der aktuellen Matrix neu starten, nicht `finish()`. In React mit stabilen Keys und FLIP auf vorhandenen Knoten.

### 13.2 Der Tageszeitwechsel aus Modell 17

Modell 17 löst den Wechsel so (17 `setMode()` Z. 908 bis 929):

- Alle Ansichten liegen in einer Rasterzelle übereinander (`.modes` und `.mode` mit `grid-area: 1/1`, Z. 104 bis 107). So können alt und neu gleichzeitig stehen, ohne dass sich die Höhe verschiebt. Die alte bekommt `.leaving` und `pointer-events: none`.
- Die Richtung folgt der Zeit: `dir = ORDER[neu] > ORDER[alt] ? 1 : -1` (Z. 696 und 910). Die Ansicht für morgens ist der nächste Morgen und liegt deshalb in der Zeit vorn.
- Die alte Ansicht blendet in 120ms aus. Gleichzeitig kommt jedes Kind der neuen 24px aus der Laufrichtung, 260ms, 30ms versetzt, `fill: 'backwards'` (Z. 923 bis 928).
- Die Überschrift tauscht im selben Zug: Beide Fassungen liegen in einer Rasterzelle (`#h1`, Z. 100 bis 101), die alte blendet in 120ms aus, die neue kommt 24px aus derselben Richtung (`setHeadline()` Z. 723 bis 734).
- Vor jedem Wechsel bricht `getAnimations({subtree:true}).forEach(a => a.cancel())` laufende Wechsel ab (Z. 912). Ein zweiter Wechsel während des ersten springt also nicht ans Ende, sondern startet neu.
- Der Scrollbereich springt nach oben (Z. 920).
- Die Fläche geht in 17 kreisförmig vom Punkt vor der Tageszeit auf (`paintSky()` Z. 892 bis 907, `clip-path: circle()` in 280ms). V2 übernimmt das nicht: Es gibt keine Farbstimmung je Tageszeit, die Fläche bleibt gleich, und `clip-path` ist weder transform noch opacity.

V2 übernimmt den Wechsel mit diesen Festlegungen:

- Reihenfolge in der Zeit: Morgens (0), Nach der Schule (1), Überblick (2), Morgen früh als Vorschau (3). Zurück zu "Jetzt" läuft rückwärts.
- Die Kinder der neuen Ansicht sind ihre Blöcke (Abschnittslabel mit Inhalt), nicht jede Zeile. Höchstens sechs Stufen.
- Die Zeile unten bewegt sich nicht.
- Der Wechsel läuft nur beim Zurückkommen aus dem Hintergrund, nach "Fertig" oder "Überspringen" im Ablauf und bei einer Auswahl im Menü der Datumszeile. Nie von selbst, während der Bildschirm sichtbar ist.

### 13.3 Liste

| # | Auslöser | Was sich bewegt | Dauer, Kurve | Quelle |
|---|---|---|---|---|
| 1 | Tageszeitwechsel | alte Ansicht opacity 1 auf 0 | 120ms, ease-out | 17 `setMode()` Z. 923 bis 926 |
| 2 | Tageszeitwechsel | Blöcke der neuen Ansicht translateX(dir·24px) und opacity 0 auf none und 1, Verzögerung i·30ms | 260ms, ease-out | 17 `setMode()` Z. 927 bis 928 |
| 3 | Tageszeitwechsel | Überschrift: alt opacity auf 0 in 120ms; neu translateX(dir·24px) und opacity 0 auf none und 1 | 260ms, ease-out | 17 `setHeadline()` Z. 723 bis 734 |
| 4 | Zahl in der Überschrift ändert sich, etwa nach Abhaken | wie 3, mit dir = 0: nur opacity 0 auf 1 in 160ms nach 100ms Ausblenden | 100 + 160ms, ease-out | 16 `swapText()` Z. 812 bis 818 |
| 5 | Ablaufschritt vor | neuer Schritt translateX(100%) auf 0, alter auf translateX(−24%) mit opacity 1 auf .4 | 300ms, ease-drawer | 14 `show()` Z. 570 bis 573 |
| 6 | Ablaufschritt zurück | neuer von translateX(−24%) und opacity .4 auf 0 und 1, alter auf translateX(100%) | 260ms, ease-drawer | 14 `show()` Z. 574 bis 578 |
| 7 | Ablaufschritt wird aktiv | Bandsegment scaleX 0 auf 1, `transform-origin: left` | 300ms, ease-out | 14 CSS Z. 66 bis 75, `setBand()` Z. 616 bis 627 |
| 8 | Kaltstart nach `document.fonts.ready` | Blöcke opacity 0 auf 1, translateY(8px) auf none, Verzögerung 40ms + min(i,3)·25ms | 220ms, ease-out | 16 `stagger()` Z. 580 bis 584 |
| 9 | Tipp auf Datumszeile | Menü opacity 0 auf 1 in 150ms ease-out; scale(.96) translateY(−4px) auf none, `transform-origin: 18px 0` | 180ms, ease-out | 17 `.menu` Z. 90 bis 94 |
| 10 | Menü der Datumszeile offen | Pfeil rotate(180deg) | 200ms, ease-out | 17 `.when .ms` Z. 82 bis 83 |
| 11 | Vorschau einer anderen Tageszeit | Pille "Jetzt" opacity 0 und translateX(6px) auf 1 und none; beim Verlassen umgekehrt | 180ms, ease-out | 17 `.now-pill` Z. 84 bis 89 |
| 12 | Vorschau | Wort der Tageszeit wechselt Farbe auf `--ink-3` ohne Animation | keine | 17 `.when.preview` Z. 81 |
| 13 | Fokus in die Zeile | Menü wächst aus der Zeile: Start mit Geometrie der Pille (translateY, scale, `clip-path: inset(... round 26px)` nur als Startmaske), Ziel none | 280ms, ease-drawer | V1 Nr. 7 |
| 14 | Menü der Zeile geöffnet | Treffer opacity 0 auf 1, translateY(6px) auf none, ab 80ms, je 25ms versetzt, höchstens 4 Stufen | 200ms, ease-out | 16 `setChips()` Z. 575 bis 576 |
| 15 | Menü öffnet und schließt | Scrim opacity 0 auf 1 | 200ms, ease | 16 `.scrim` Z. 232 |
| 16 | Menü schließen per Tipp oder Esc | umgekehrt zu 13 | 220ms, ease-drawer | V1 Nr. 10 |
| 17 | Menü nach unten ziehen | folgt dem Finger, nach oben Gummiband c = .55; schließt ab 28% Höhe oder 0,5 px/ms, sonst Feder zurück | Feder | 16 `rubber()` Z. 732, `dragToClose()` Z. 733 bis 757 |
| 18 | Tippen erkennt ein Token | opacity 0, translateY(4px) scale(.94) auf none; unveränderte Tokens bleiben stehen | 220ms, ease-out | 16 `.tok` Z. 208 bis 212, `onInput()` Z. 638 bis 662 |
| 19 | Absicht wechselt | Absicht-Token und erste Zeile: opacity 1 auf 0 in 100ms, Text tauschen, 0 auf 1 in 160ms | 100 + 160ms, ease-out | 16 `swapText()` Z. 812 bis 818 |
| 20 | Absicht wechselt | Sendeknopf-Icon rotate(−90deg) und opacity 0 auf none und 1 | 200ms, ease-out | V1 Nr. 14 |
| 21 | Vorschläge und Treffer tauschen | beide Ebenen übereinander, opacity und translateY(6px) | 180ms, ease-out | 16 `.strip` Z. 199 bis 204 |
| 22 | Antwort im Menü | Antwort-Kinder wie 8 mit Basis 90ms | 220ms, ease-out | 16 `appendTurn()` Z. 585 bis 616 |
| 23 | Enter beim Eintragen | Geistklon des Satzes fliegt vom Feld an die Zielzeile, translate(dx,dy) auf none, opacity .4 auf 1; Start erst, wenn `visualViewport` zwei Frames stabil ist | 360ms, ease-drawer | 16 `appendTurn()` Z. 585 bis 616, `ask()` Z. 617 bis 633 |
| 24 | neue Zeile kommt dazu | Zeilen darunter per FLIP translateY(d) auf none | 280ms, ease-out | 14 `addItem()` Z. 668 bis 673 |
| 25 | neue Zeile gelandet | `::before` in `--mark` opacity .3 auf 0, Verzögerung 180ms | 650ms, ease-out | 16 `.task::before` Z. 99 bis 101 |
| 26 | Primärknopf ändert Text | Label opacity auf 0 und translateY(6px), nach 160ms tauschen, zurück | 160ms ease / 200ms ease-out | 14 `.btn-label.swap` Z. 102 bis 103 |
| 27 | Abhaken auf dem Überblick | Zeile bleibt 350ms, dann opacity auf 0 und Zeilen darunter per FLIP nach oben | 340ms, ease-io | 14 `renderHw(true)` Z. 867 bis 875 |
| 28 | Abhaken im Ablauf | Zeile wandert per FLIP nach unten in die Gruppe der erledigten | 340ms, ease-io | 14 `renderHw(true)` Z. 867 bis 875 |
| 29 | Druck auf Abhakkreis | Ring scale(.88) | 160ms, ease-out | 14 CSS Z. 135 bis 136 |
| 30 | Abhaken | Füllung scale(.4) und opacity 0 auf 1; Haken scale(.5) rotate(−12deg) auf none, Verzögerung 80ms | 240ms, ease-out | 14 CSS Z. 137 bis 146 |
| 31 | Abhaken | Durchstrich je Textzeile scaleX 0 auf 1, `transform-origin: left`, Verzögerung 60ms + i·60ms | 260ms, ease-out | 14 `.hw-title::after` Z. 134 bis 148 |
| 32 | Wisch auf Aufgabenzeile | folgt dem Finger 1:1; Gegenseite Gummiband; Achse nach 10px; Start ab 24px vom linken Rand; Auslösung ab 30% Breite oder 0,6 px/ms | Feder beim Loslassen | 14 Wisch Z. 901 bis 936 |
| 33 | Toast erscheint | translateY(14px) auf none in 260ms, opacity in 200ms; 10px über der Zeile; Standzeit 4500ms | ease-out | 16 `toast()` Z. 673 bis 677 |
| 34 | Druck auf Knöpfe | Primärknopf und "Wiederholen" scale(.97), Pillen scale(.96), runde Knöpfe scale(.92) | 140ms, ease-out | 16 Z. 127, 207, 218, 245 |
| 35 | Kamera öffnen | Kamera translateY(100%) auf 0; Ansicht dahinter scale(.96) und opacity .5; theme-color nach 200ms | 340ms, ease-drawer | 14 `show()` Z. 579 bis 586 |
| 36 | Kamera schließen | umgekehrt | 300ms, ease-drawer | 14 `show()` Z. 579 bis 586 |
| 37 | Auslösen | Blitz opacity .85 auf 0; Seite per FLIP in den Stapel, rotate(−4deg) auf 0; Zähler scale(.6) auf 1 | 240ms / 420ms, ease-out / ease-drawer | 14 Shutter Z. 808 bis 835 |
| 38 | Ablegen | 76px-Miniatur fliegt an ihr Ziel aus Abschnitt 8: translate, scale, rotate(−2.2deg) auf none | 520ms, ease-drawer | 16 Shutter Z. 832 bis 849 |
| 39 | Ablegen auf dem Überblick | die zwei vorhandenen Miniaturen translateX(Spalte + 12px) auf none, die dritte opacity auf 0 | 280ms, ease-out | neu, wie 24 |
| 40 | Status eines Blatts ändert sich | Crossfade wie 19 | 100 + 160ms | 16 `swapText()` Z. 812 bis 818 |
| 41 | "Wiederholen" oder "Starten" | Tischfläche per FLIP von Knopfmaß auf Vollbild, opacity 0 auf 1 bis Offset .2; Inhalt opacity 0 und translateY(10px) auf 1 und none, Verzögerung 170ms in 220ms ease-out | 340ms, ease-grow | 14 `show()` Z. 587 bis 597 |
| 42 | Tisch geöffnet | Kartenstapel opacity 0, translateY(60px) scale(.94) auf none, je 40ms versetzt | 340ms, ease-out | 19 `openSession()` Z. 771 |
| 43 | Fokus ins Antwortfeld | Fuß des Tisches translateY(−inset) mit der Tastatur; Stapel hinter der Karte opacity auf 0 | 200ms, ease-out | wie V1 4.1, 03 Z. 96 |
| 44 | Karte ziehen vor dem Aufdecken | Gummiband `rubber(dx, 300, .35)`; Hinweis "Erst antworten." opacity 0 auf 1 | 200ms, ease | 19 Z. 898, `rubber()` Z. 632, `.hint` Z. 272 bis 273 |
| 45 | "Aufdecken" oder "Weiß ich nicht" | Knöpfe opacity auf 0 und translateY(−6px) in 120ms; danach "Daneben" und "Saß" opacity 0 und translateY(10px) auf 1 und none, je 30ms versetzt | 120ms, dann 200ms, ease-out | 19 `.s-foot` Z. 266 bis 271 |
| 46 | "Aufdecken" | Tastatur schließt zuerst; Drehung startet, wenn `visualViewport` zwei Frames stabil ist | keine eigene | neu, wie 23 |
| 47 | Karte umdrehen | `.sc-flip` rotateY(180deg), `perspective: 1400px`; gleichzeitig `.sc-lift` scale 1.02 und translateY(−3px) und zurück | 320ms, ease-flip | 19 Z. 250 bis 255, `flip()` Z. 793 bis 802 |
| 48 | "Das stand im Heft" aufklappen | Zitat opacity 0 und translateY(−4px) auf 1 und none; Inhalt darunter per FLIP | 220ms, ease-out | neu, wie 24 |
| 49 | Karte ziehen nach dem Aufdecken | translate folgt dem Finger, rotate dx·0.055deg; Stempel "Saß" oder "Daneben" opacity \|dx\|/100 | folgt dem Finger | 19 `bindTop()` Z. 893 bis 902, `setStamps()` Z. 806 bis 811 |
| 50 | Loslassen unter 120px Projektion | Karte federt zurück, Stempel opacity auf 0 in 200ms | Feder | 19 Z. 913 bis 916 |
| 51 | Loslassen über Schwelle, "Saß" oder "Daneben" | Wurf x = ±(Breite + 160) + vx·140, rotate ±16deg + vx·4, opacity auf 0 | 340ms, ease-out | 19 `rate()` Z. 824 bis 832 |
| 52 | Karte geworfen | Stapel rückt nach: translateY(14px) scale(.95), translateY(28px) scale(.9) opacity .7; je 30ms versetzt; keine Sperre | 320ms, ease-out | 19 Z. 240 bis 247, `rate()` Z. 837 bis 848 |
| 53 | "Saß" | Fortschrittsstrich scaleX 0 auf 1, `transform-origin: left` | 300ms, ease-out | 19 `.tick i` Z. 236 bis 238 |
| 54 | "Daneben" | Zählertext "10 Fragen · 1 kommt nochmal" per Crossfade wie 19; die Karte fliegt nach links und reiht sich hinten in den Stapel ein, sichtbar als kurzes translateY(28px) scale(.9) auf der hintersten Position | 340ms, ease-out | 19 `rate()` Z. 824 bis 848 |
| 55 | Thema durch | letzte Karte fliegt wie 51; Themenende opacity in 240ms ease, translateY(16px) auf none; Knöpfe je 40ms versetzt | 340ms, ease-out | 19 `.summary` Z. 274 bis 275 |
| 56 | "Fertig, weiter" | Themenende und Kopf mit Fach und Thema translateX(−24px) und opacity auf 0 in 120ms; neuer Kopf translateX(24px) auf none in 260ms; Fortschrittsstriche scaleX 0 auf 1 von links, 300ms; neuer Stapel wie 42 | 260ms, ease-out | 17 `setMode()` Z. 923 bis 928 übertragen, 19 `openSession()` Z. 771 |
| 57 | "Fertig" oder Schließen | Inhalt opacity auf 0 bis Offset .35; Fläche schrumpft auf das Maß des Knopfs, aus dem sie kam; opacity 1 bis Offset .8, dann 0 | 280ms, ease-grow | 14 `show()` Z. 598 bis 601 |
| 58 | nach 57 | Zahl im Knopf "Wiederholen" per Crossfade wie 4, Unterzeile ebenso; ist alles durch, ersetzt die Textzeile den Knopf mit opacity und scale(.94) auf none | 240ms, ease-out | 16 `.prow.done .ok` Z. 162 bis 163 |
| 59 | Lernblock läuft | Restzeitlinie scaleX(rest/gesamt) je Frame per rAF aus Zeitstempeln | keine Transition | V1 Nr. 53 |
| 60 | "Block beenden" oder Zeit um | Dialog opacity in 200ms ease, translateY(16px) auf none | 260ms, ease-out | 14 `.confirm` Z. 208 bis 209 |
| 61 | Material-Sheet öffnen | translateY(105%) auf 0; Scrim opacity in 320ms; schließen per Ziehen wie 17 | 380ms, ease-drawer | 16 `.sheet` Z. 234 bis 236 |
| 62 | Nachschlagen öffnen | neue Seite translateX(100%) auf 0, alte translateX(−24%) und opacity .4 | 300ms, ease-drawer | wie 5 |
| 63 | Wisch vom linken Rand | Seite folgt dem Finger, schließt über 50% Breite, sonst Feder zurück | Feder | 10 `gestureMove()`, `gestureEnd()` Z. 93 bis 95 |
| 64 | Wochentag wechseln | Unterstrich translateX(i·100%) in 300ms ease-io; Liste raus opacity 0 und translateX(∓20px) in 200ms, rein von der Gegenseite in 260ms | siehe links | 14 `.day-ind` Z. 238, Handler Z. 1062 bis 1077 |

### 13.4 Reduzierte Bewegung

Gezielt je Bewegung, keine Pauschalregel auf `*`. Abfrage in JS mit `matchMedia('(prefers-reduced-motion: reduce)')` bei jeder Animation.

- Tageszeitwechsel: nur opacity, alt aus in 120ms, neu ein in 160ms, ohne Versatz und ohne Staffel. 17 springt hier ganz ohne Übergang (Z. 921), V2 behält die kurze Überblendung, damit der Wechsel bemerkt wird.
- Ablaufschritte, Kamera, Tisch, Sheets und Nachschlagen: nur opacity, 160ms.
- Kein Geistflug, kein FLIP-Flug, keine Miniatur im Flug. Das Ziel leuchtet auf (25).
- Kartendrehung wird ein Überblenden in 200ms, der Wurf ein Ausblenden in 160ms.
- Haken und Durchstrich bleiben, in 120ms.
- Keine Token-Animation, kein Stagger, keine Pille "Jetzt" im Flug, sie erscheint per opacity.
- Die Restzeitlinie läuft weiter.
- Gesten folgen dem Finger, das Loslassen springt auf den Endzustand.

## 14. Nicht übernommen

Aus V1 entfällt:

- Der Ablauf mit vier Schritten "Neu", "Fällig", "Lernen", "Fertig" und die Startlogik nach Schritten (V1 2.5). Ersetzt durch Tageszeiten und zwei Schritte.
- Der Bildschirm "Fertig für heute." mit der Aufzählung der Tagesereignisse. Das Protokoll bleibt, angezeigt wird es nicht.
- Die Kopfzeile "Morgen, Dienstag · 2 Aufgaben offen" über dem Band. Ersetzt durch die Datumszeile aus 17.
- Die Kartenzeile "12 Karten sind heute dran · 7 Mathematik, 3 Englisch, 2 Biologie" und das gemischte Abfragen über Fächer hinweg.
- Die drei Bewertungsknöpfe "Nochmal", "Unsicher", "Gewusst" und das Umdrehen ohne vorherige Antwort. Der echte Abruf verlangt erst eine Antwort und kennt nur richtig oder falsch (`recall_attempts.correct`).
- Die Notenzeile auf dem Lernschritt.

Aus Modell 17 entfällt:

- Die drei Farbstimmungen je Tageszeit (17 Z. 22 bis 40) mit eigenem Akzent je Tageszeit (Korallrot, Signalgelb, Hellblau). Hell und Dunkel folgen dem Handy, Blau bleibt einziger Akzent.
- Der Kreis, in dem die neue Fläche aufgeht (`paintSky()` Z. 892 bis 907, `.sky` Z. 58 bis 59).
- Die feste Grenze "vor 12 Uhr früh, vor 18 Uhr Nachmittag, sonst Abend" (`modeFor()` Z. 1186). V2 rechnet mit Schulschluss und Ablaufstand.
- Die Trennung Nachmittag und Abend. Beides ist in V2 der Überblick.
- Der schwebende Knopf "Blatt aufnehmen" (Z. 496). Die Kamera liegt in der Zeile.
- Das Eintragen mit eigenem Formular, Fach aus dem Text geraten und Abgabetag "Di" oder "Mi" (`guessFach()` Z. 840). Eintragen läuft über die Zeile.
- Die Abfrage mit festen `CARDS` und `busy`-Sperre (Z. 1048 bis 1065).
- `window.__demo` (Z. 1192).

Weiter gilt alles, was V1 Abschnitt 8 ausschließt: Gesprächsverlauf aus 16, fest verdrahtete Beispieldaten, Formular nach dem Auslösen, Kamera als Grundebene, Fortschrittsbalken bei 92%, `setInterval` für Uhren, Wisch nach oben, Zurückdrehen der Karte, Textmarker als Knopffüllung, fester Primärknopf über der Zeile, seitliches Wischen zwischen Ablaufschritten, pauschale Bewegungsregeln, gezeichnete Statusleisten und Handyrahmen, `innerHTML`-Neurendern, Ortsangaben wie "zu Hause", IBM Plex, Martian Mono, DM Sans, Manrope, Onest, Georgia, Löschen per Textbefehl.

## 15. Abnahmekriterien

Jedes Kriterium wird am echten iPhone geprüft, in Hell und in Dunkel, nicht nur im Desktop-Browser. Die Uhr lässt sich im Prototyp mit `?jetzt=2026-10-12T07:10` stellen, in der App über eine Testuhr des Servers.

**15.1 Tageszeiten**
1. Mo 12.10. 07:10 öffnet die App auf Morgens mit "Montag, 12. Oktober · Morgens".
2. Mo 12.10. 13:09 öffnet sie auf Morgens, 13:11 auf dem Ablauf, Schritt Blätter.
3. Nach "Überspringen" öffnet sie am selben Tag um 16:40, 19:30 und 23:50 auf dem Überblick.
4. Nach "Fertig" in Schritt 2 gilt dasselbe wie in 3.
5. Wird der Ablauf in Schritt 2 verlassen, öffnet die App beim nächsten Mal am selben Tag auf Schritt 2.
6. Di 13.10. 00:30 zeigt den Überblick von Montag. 04:01 zeigt Morgens von Dienstag.
7. Sa 17.10. 09:00 öffnet auf dem Überblick, ohne Ablauf und ohne Morgens.
8. An einem Tag in `free_periods` zeigt der Überblick "Ferien bis ...", keine Aufgaben, keinen Lernblock und kein Wiederholen.
9. Ist die App um 13:05 sichtbar offen, wechselt sie um 13:11 nicht. Nach Hintergrund und Rückkehr läuft der Wechsel nach 13.3 Nr. 1 bis 3, vorwärts.
10. Beim Kaltstart gibt es keinen Wechsel, nur Nr. 8.
11. Die Ansicht kommt vom Server. Neuladen mit gelöschtem `localStorage` ändert sie nicht.
12. Im Menü der Datumszeile zeigt "Morgen früh" am Montagabend die Morgenansicht für Dienstag, 13. Oktober, mit "morgens" in `--ink-3` und der Pille "Jetzt". "Jetzt" führt rückwärts zurück.
13. Ein übersprungener Ablauf lässt sich über das Menü öffnen und hat dort "Schließen" statt "Überspringen".

**15.2 Morgens**
14. Am Di 13.10. stehen unter "Abgeben" Mathe "S. 84, Nr. 3–5" und Deutsch "Gedichtanalyse beenden". Erledigte Abgaben stehen mit Haken darunter.
15. Unter "Stunden" stehen vier Zeilen mit Beginn, Fach und Raum. Die erste trägt "Hauptunterricht · Industrialisierung".
16. Es steht kein Sportzeug, keine Packliste, keine Klausur eines anderen Tages und kein "jetzt läuft" da.
17. Am Fr 16.10. steht "Mathematik · 2. Stunde · Quadratische Funktionen".
18. Die Morgenansicht passt auf 390×844 ohne Scrollen.

**15.3 Ablauf**
19. Schritt 1 zeigt keine Fächer und keine Fachauswahl; ein Tipp genügt, um zu fotografieren.
20. Nach drei Fotos stehen drei Blätter in der Liste unter dem Sucher, jedes mit erkanntem Fach und Thema, ohne dass ein Fach gewählt wurde.
21. Der Primärknopf heißt "Keine Blätter, weiter" und nach dem ersten Blatt "Weiter zu Hausaufgaben".
22. "+ Aufgabe" bei Biologie zeigt die Tokens "Eintragen", "Biologie", "Do 15.10., nächste Stunde".
23. "Schon offen" zeigt Mathe und Deutsch für Dienstag.
24. "Überspringen" steht auf beiden Schritten, 44px Trefffläche.
25. Was vor dem Überspringen eingetragen oder abgelegt wurde, bleibt.

**15.4 Überblick**
26. Mit den Beispieldaten passt der Überblick auf 390×844 ohne Scrollen.
27. Auf 375×667 stehen die Aufgaben für Dienstag und der Knopf "Wiederholen" ohne Scrollen im Bild.
28. Die Überschrift lautet "Zwei Aufgaben für Dienstag" und zählt nach dem Abhaken auf "Noch eine Aufgabe für Dienstag" herunter.
29. Freitags lautet sie "... für Montag, 19.10.".
30. Es stehen keine Noten und kein Stundenplan auf dem Überblick.
31. "Wiederholen" zeigt "3 Themen" und "Zuerst Geschichte · Industrialisierung in England".
32. Die Lernblockzeile startet den Lernblock. Ohne Lernblock heute steht "Nächster Lernblock Mittwoch · Wiederholung".
33. Die drei neuesten Blätter stehen da, ein Tipp öffnet das Blatt, "Alle" die Ablage.
34. Der Knopf "Wiederholen" ist das einzige gefüllte blaue Element.

**15.5 Wiederholen**
35. Die Themen kommen in der Reihenfolge aus 2.5. Er kann sie nicht umsortieren.
36. Innerhalb eines Themas stehen nur Fragen dieses Themas, nie Fragen eines anderen.
37. Ohne Text im Feld lässt sich nicht urteilen, erst nach "Aufdecken" oder "Weiß ich nicht".
38. "Weiß ich nicht" speichert einen Versuch mit leerem Text.
39. "Daneben" legt die Frage ans Ende des Themas. Der Zähler zeigt "10 Fragen · 1 kommt nochmal".
40. Ein Thema endet erst, wenn jede Frage einmal "Saß" bekam.
41. Das Themenende nennt Fragen und "beim ersten Mal" als Zählung, ohne Prozent.
42. "Wieder dran" nennt den nächsten offenen Termin aus `recall_schedule`.
43. "Fertig, weiter" zeigt das nächste Thema mit Fach, Thema und Fragenzahl in der Unterzeile und wechselt ohne Verlassen des Tisches.
44. "Fertig" lässt den Tisch in den Knopf schrumpfen. Der Knopf zeigt danach "2 Themen".
45. Nach dem letzten Thema steht "Für heute durch. Nächstes Thema Dienstag." statt des Knopfs.
46. Schließen mitten im Thema und erneuter Start setzt mit den übrigen Fragen dieses Themas fort.
47. Eine Frage, die im Lernblock saß, kommt in Wiederholen nicht mehr.
48. "Stand so nicht im Heft" zieht die Frage nach Rückfrage zurück. Sie erscheint nie wieder.
49. Bei offener Tastatur sind Frage, Antwortfeld und beide Knöpfe ganz sichtbar, in Safari und als installierte PWA.
50. Fünf schnelle "Saß" hintereinander gehen alle durch.

**15.6 Zeile und Kamera**
51. Alle Beispiele aus V1 4.4 und V2 7.3 ergeben die angegebene Absicht.
52. Die Zeile steht auf Morgens, Ablauf, Überblick und Nachschlagen an derselben Stelle und bewegt sich beim Tageszeitwechsel nicht.
53. Das Feld zoomt auf iOS nicht. Bei offener Tastatur bleibt die Zeile ganz sichtbar.
54. Bei leerem Feld zeigt "Wohin?" alle neun Bereiche.
55. Zwischen Tipp auf Kamera und erstem Bild vergehen höchstens 1,5 Sekunden.
56. Auf dem Überblick landet ein Blatt an erster Stelle unter "Zuletzt abgelegt".

**15.7 Protokoll**
57. Das Tagesprotokoll aus V1 5.4 hat zusätzlich `ablauf_beendet`, `ablauf_uebersprungen`, `thema_beendet` (mit Thema und Fragenzahl). Rückgängig löscht das zugehörige Ereignis.

**15.8 Hell und Dunkel**
58. Mit Handy auf Hell sind alle Ansichten hell, mit Handy auf Dunkel alle dunkel, ohne Neuladen.
59. Jede Ansicht (Morgens, beide Ablaufschritte, Überblick, Tisch beim Antworten, Tisch mit Lösung, Themenende, Kamera, Noten) wird in beiden Schemata fotografiert und nebeneinandergelegt. Kein Text unter Kontrast 4,5.
60. Im Dunkeln setzt sich die Zeile mit ihrem Rand vom Papier ab, und "Saß" ist klar vom Tisch abgesetzt.
61. theme-color stimmt in beiden Schemata für Papier, Kamera und Tisch.
62. `data-theme="light"` und `data-theme="dark"` überstimmen das System.
63. Es gibt keinen Farbwechsel je Tageszeit.

**15.9 Gestaltung und Bewegung**
64. Nur Schibsted Grotesk, Newsreader und Material Symbols Rounded werden geladen.
65. Newsreader steht nur an den Stellen aus 12.1.
66. Keine Zahl auf dem Bildschirm, die nicht aus Daten oder Protokoll kommt.
67. Alle Animationen verändern nur `transform` und `opacity`. Ausnahme ist die Startmaske des Zeilenmenüs (13.3 Nr. 13). Geprüft im Performance-Panel beim Tageszeitwechsel und beim Abhaken.
68. Zwei Menüauswahlen schnell hintereinander starten den Wechsel neu, ohne dass zwei Ansichten stehen bleiben.
69. Mit `prefers-reduced-motion` gelten alle Punkte aus 13.4.

## 16. Für den späteren Bau

### 16.1 Was "Epoche" in der App heute ist

Es gibt keine Tabelle für Epochen. `/stundenplan/epoche` trägt den Hauptunterricht von einem Fach auf ein anderes um: `switchEpoch()` in `src/lib/timetable.ts` ändert die Zeilen in `lessons`, mehr nicht. Welches Fach gerade Epoche ist, rät `guessEpochSubject()` in `src/app/(app)/stundenplan/epoche/page.tsx`: das Fach, das in der ersten Stunde an den meisten Tagen steht. Ein Beginn oder Ende der Epoche wird nirgends gespeichert.

Für V2 reicht das. "Epoche" ist nur eine Beschriftung: vor dem Fach auf dem Tisch und im Unterlabel "Hauptunterricht · Industrialisierung". Die Reihenfolge beim Wiederholen braucht die Epoche nicht. Dafür muss `guessEpochSubject()` aus der Seite in `src/lib/timetable.ts` umziehen.

Fehlt, wenn er später "nur Blätter dieser Epoche" will: ein Beginn je Epoche, am einfachsten eine Zeile mit Fach und Datum, die `switchEpoch()` beim Umtragen schreibt.

### 16.2 Was das Datenmodell für Wiederholen nach Themen schon kann

- **Fragen mit Thema.** `recall_items` hat `subject_id` (Pflicht) und `subject_topic_id` (frei). Die Themen kommen aus `subject_topics`, das auch Blätter (`material_topics`) und Klausuren (`exam_topics`) benutzen.
- **Quellbindung.** Jede Frage trägt `page_id`, `source_quote`, `solution` (eine Sinneinheit je Zeile) und `misconception` (Pflicht, nicht leer). Das deckt Musterlösung, Verwechslungssatz und "Das stand im Heft".
- **Termine.** `recall_schedule` hat je Frage Tage ohne Uhrzeit (`due_on`), die Runde, die Betriebsart `klausur` oder `erhaltung` und `done_at`, das nur bei einer richtigen Antwort gesetzt wird.
- **Fällige Fragen.** `faelligHeute()` liefert sie, ältester Termin zuerst, je Frage nur einen Termin, heute schon falsch beantwortete hinten. `zahlFaellig()` zählt Fragen, nicht Termine.
- **Takt.** `src/recall/schedule.ts`: alle drei Tage, in der letzten Woche vor der Klausur täglich, danach dreimal im Abstand von 21 Tagen. Freie Zeiträume sind Sperrtage. Der Takt ist fest und lernt nicht, das ist Absicht und Entscheidung des Nutzers vom 12.9. und 15.9.2026.
- **Antworten.** `recall_attempts` speichert Text, richtig oder falsch und den Abstand in Tagen. Leere Antworten zählen als Versuch. Es gibt kein Überspringen.
- **Zurückziehen.** `retired_at` und "Stand so nicht im Heft" gibt es schon.
- **Kein Mischen.** Der Kommentar an `material_kind` hält fest, dass Mischen erst Stufe 2 ist und bei Begriffspaaren schadet. "Ein Thema am Stück" passt dazu.
- **Noten.** `src/lib/grades.ts` liefert Schnitt je Fach, schriftlich und mündlich getrennt, und den Gesamtschnitt.
- **Schulschluss.** `periods` hat Beginn und Ende je Stunde, `lessons` die Stunden je Wochentag. Schulschluss lässt sich daraus rechnen.

### 16.3 Was fehlt

1. **Bündeln nach Thema.** Eine Funktion, etwa `faelligeThemen(userId, heute)`, die `faelligHeute()` nach `subject_topic_id` gruppiert, Fragen ohne Thema je Fach bündelt und nach 6.2 sortiert. Für den Überblick zusätzlich eine Zählung der Themen, analog zu `zahlFaellig()`.
2. **Sitzung je Thema.** `/abruf/sitzung` fragt heute alle fälligen Fragen in einer Reihe ab. Sie braucht einen Filter auf ein Thema, und "Daneben" muss ans Ende dieses Themas statt ans Ende des Abends.
3. **Fragen ohne Klausur.** Vorschläge hängen heute an einer Klausur: `recall_proposals.exam_id`, und der Agentenlauf geht von der Klausur über ihre Themen zu den Seiten (`read_exam_material`, `propose_questions`). Für Epoche und Französisch ohne Klausur braucht es einen Weg vom Thema oder vom Blatt zu Fragen. Am naheliegendsten: Vorschläge an ein Thema binden (`subject_topic_id`, `exam_id` frei) und den Lauf nach jeder neuen Abschrift eines Themas anstoßen. Von Hand angelegte Fragen (`/abruf/bausteine/neu`) haben schon keine Klausur.
4. **Termine ohne Klausur.** Ohne Klausur plant `schedule.ts` vier Runden im Grundtakt und hört dann auf (Warnung `kein-termin`). Danach wäre eine Französisch-Frage nie wieder fällig. Für dauerhaftes Wiederholen braucht es eine Erhaltung auch ohne Klausur, etwa wie nach einer Klausur dreimal im Abstand von 21 Tagen. Das ist eine neue Regel für Fragen ohne Klausur und ändert den bestehenden Takt nicht. Der Nutzer muss sie trotzdem vorher bestätigen, denn er hat am 15.9.2026 entschieden, am Takt nichts zu ändern.
5. **Klausur gelöscht.** Fragen aus einem Klausurvorschlag gehen mit der Klausur (CASCADE, Wunsch vom 15.9.2026). Damit verschwindet etwa "Quadratische Funktionen" nach dem Löschen der Mathe-Klausur aus Wiederholen. Für Fragen, die an einem Thema statt an einer Klausur hängen (Punkt 3), gilt das nicht.
6. **Tagesprotokoll.** Das Protokoll aus V1 5.4 gibt es noch nicht. V2 braucht dazu `ablauf_beendet`, `ablauf_uebersprungen` und `thema_beendet`, und einen leichten Endpunkt für die Ansicht nach 3.2.
7. **Lernblock und Fragen.** `study_blocks` weiß nichts von `recall_items`. Für 9.1 braucht der Lernblock die offenen Fragen der Klausurthemen. Das geht über `exam_topics` und `subject_topic_id`, ohne neue Tabelle.
8. **Unterlabel des Hauptunterrichts.** "Hauptunterricht · Industrialisierung" braucht das Thema des jüngsten Blatts im Epochenfach. Die Daten dafür gibt es (`materials`, `material_topics`), eine Funktion noch nicht.
9. **Nicht nötig.** Für die Reihenfolge der Themen braucht es keinen neuen Algorithmus und keine Leichtigkeitswerte. Sie folgt allein aus den Terminen, die es schon gibt.

### 16.4 Reihenfolge beim Bau

1. `node_modules/next/dist/docs/` lesen, diese Next.js-Version hat Breaking Changes (AGENTS.md).
2. Shell in `src/app/(app)/layout.tsx` als Client-Insel: Zeile, Kamera-Ebene, Tisch-Ebene, Toast. Die drei Ansichten sind Zustand auf der Route `/`, kein Routenwechsel.
3. Tagesprotokoll und Ansicht nach 3.2, mit Testuhr.
4. Morgens und Überblick ohne Wiederholen.
5. Ablauf mit Kamera.
6. `faelligeThemen()` und Sitzung je Thema (16.3, Punkte 1 und 2), dann der Tisch.
7. Fragen ohne Klausur (16.3, Punkte 3 und 4), erst nach Bestätigung durch den Nutzer.
8. Jede Stufe wird am Handy in Hell und Dunkel durchgeklickt, bevor die nächste beginnt. Grüne Tests finden diese Fehler nicht.
