# Schulapp — Konzept

Persönliche Schul-App für einen Nutzer. Langfristig angelegt, wächst in Phasen.

## Zweck

Zwei Dinge sollen sie wirklich gut können:

1. **Organisation** — Stundenplan, Hausaufgaben, Termine an einem Ort
2. **Noten & Fortschritt** — Schnitt im Blick, Ziele verfolgen

Der Einstieg ist **Klausuren & Lernphasen**: Prüfungstermine mit Countdown und
automatisch geplanten Lernblöcken davor.

## Rahmenbedingungen

| Punkt | Entscheidung |
|---|---|
| Nutzer | Nur ich (ein Account) |
| Geräte | Android-Handy + Laptop, Daten synchron |
| Notensystem | Deutsche Noten 1–6 mit +/− |
| Stundenplan | Fester Wochenplan, Mo–Fr, 1 bis 12 Stunden am Tag |
| Erinnerungen | Push-Nachrichten aufs Handy |
| Kalender | Einbahnstraße in einen eigenen Google-Kalender „Schule“; was der Nutzer dort löscht, bleibt weg |

## Technik

- **Next.js (App Router) + TypeScript + Tailwind**
- **PWA** — installierbar auf dem Homescreen, offline lesbar
- **Postgres** als Datenbank, Zugriff über eine typsichere Schicht (Drizzle)
- **Hosting:** anfangs Vercel mit Deploy per Git-Push; seit dem 30.8.2026 zwei
  Docker-Container auf einem Synology-NAS im Heimnetz, öffentlich über Tailscale
  Funnel. Gezogen wird mit `git pull`, gebaut auf dem NAS
- **Ein Login** mit Passwort + Session-Cookie

Begründung: ein Codestand für beide Geräte, Sync ergibt sich aus dem Server,
kein App-Store, Änderungen sind Minuten später auf dem Handy.

> Push läuft auf Android (Chrome) zuverlässig — auch im normalen Tab, als
> installierte PWA aber am besten (eigenes Icon, Vollbild). Am Laptop ebenso.

## Datenmodell

```
Nutzer ─── Stundenraster      Nummer, Beginn, Ende   (1.–12. Stunde)

Fach ──┬── Stundenplan-Slot   Wochentag, Stunde, Raum, Notiz
       ├── Hausaufgabe        Titel, Notiz, fällig, erledigt-Zeitpunkt
       ├── Klausur            Datum, Themen, Gewicht
       │      └── Lernblock   Tag, Dauer, Thema, Status
       └── Note               Wert, Art (schriftl./mündl.), Gewicht, Datum
```

Das **Stundenraster** hängt am Nutzer, nicht am Fach: wann die 3. Stunde
beginnt, gilt für die ganze Schule. Es steht in der Datenbank statt im Code,
weil jede Schule andere Zeiten hat — ein falsches Raster macht den ganzen
Stundenplan wertlos. Beim ersten Öffnen wird eine Vorgabe angelegt, die man
danach ändert.

**Erledigt** ist bei einer Hausaufgabe ein Zeitpunkt, kein Ja/Nein. Ein
Zeitpunkt kann nicht in Widerspruch zu einem Häkchen geraten, und „heute
abgehakt" lässt sich daraus ablesen. Abgehakte Aufgaben verschwinden nach
vierzehn Tagen aus der Liste — gelöscht wird nie, nur ausgeblendet.

**Fach**: Name, Kürzel, Farbe, Lehrkraft, Raum, Gewichtung schriftlich/mündlich

**Noten** werden nicht als „2+" gespeichert, sondern als Zahl — sonst ließe
sich kein Schnitt rechnen:

| Note | 1+ | 1 | 1− | 2+ | 2 | 2− | … | 5− | 6 |
|---|---|---|---|---|---|---|---|---|---|
| Wert | 0,7 | 1,0 | 1,3 | 1,7 | 2,0 | 2,3 | … | 5,3 | 6,0 |

In der Datenbank steht davon das Zehnfache als ganze Zahl (7, 10, 13 … 60);
warum, steht unten bei der Notenlogik.

## Lernphasen-Logik

**Plan erzeugen** — aus Klausurdatum + Themenliste. Die Regeln sind bewusst
festgeschrieben, weil sie durch Tests abgesichert sind:

1. Lerntage sind alle Tage von spätestens *Klausurdatum − 10* bis zum Tag
   **vor** der Klausur. Der Prüfungstag selbst ist nie ein Lerntag.
2. Von diesen Tagen sind die letzten zwei Wiederholungstage — bei nur zwei
   oder drei verfügbaren Tagen der letzte, bei einem einzigen keiner.
3. Die Themen werden **gleichmäßig über den ganzen Zeitraum** verteilt, nicht
   vorne zusammengedrängt.
4. An den Wiederholungstagen kommt jedes Thema noch einmal dran.
5. Die Minuten eines Tages werden auf seine Blöcke aufgeteilt, auf 5 Minuten
   gerundet, mindestens 10 — die Tagessumme überschreitet nie das Budget.
6. Vorlauf (10 Tage) und Tagesbudget (45 Minuten) sind pro Klausur änderbar.

Gerechnet wird ausschließlich mit Kalenderdaten in UTC, nie mit Zeitstempeln.
Dadurch verschiebt die Sommerzeit-Umstellung keinen einzigen Lerntag.

**Verpasster Lerntag** — die App fragt nach:
> "Gestern Mathe nicht geschafft — heute nachholen oder streichen?"

Beim Nachholen wird auf die verbleibenden Tage neu verteilt, damit der Plan
realistisch bleibt.

**Push-Nachrichten**: tägliche Erinnerung an den Lernblock, plus Countdown-
Meldung einige Tage vor der Klausur.

## Notenlogik

**Gespeichert wird in Zehnteln**, als ganze Zahl: 7 ist eine 1+, 10 eine 1, 13
eine 1−, 60 eine 6. Der Grund ist der Schnitt — 1,3 + 2,3 ergibt in Fließkomma
3,5999999999999996 und nicht 3,6, in Zehnteln dagegen genau 36. Die Skala hat
16 Stufen und endet bei 5−, dann kommt die 6: eine 6 trägt keine Tendenz.

**Der Fachschnitt** setzt sich aus zwei Töpfen zusammen, schriftlich und
mündlich. Wie stark jeder wiegt, steht am Fach (`weightWritten` in Prozent) und
nicht an der einzelnen Note. Innerhalb eines Topfes zählt das Gewicht der Note:
eine Klausur zählt doppelt gegenüber einem Test.

Fehlt ein Topf ganz — noch keine mündliche Note eingetragen —, dann zählt er
**nicht als Null und nicht als Vier, sondern gar nicht**. Sonst wäre der
Schnitt nach der ersten Klausur des Schuljahrs eine Lüge.

**Der Gesamtschnitt** ist das schlichte Mittel der Fachschnitte: jedes Fach
zählt einmal, egal wie viele Noten darin stehen. Das ist die Rechnung, die ein
Zeugnis meint. Archivierte Fächer zählen nicht mit — ein abgewähltes Fach soll
den heutigen Schnitt nicht mehr bewegen, seine alten Noten bleiben aber
erhalten und sichtbar.

**„Was brauche ich noch für eine 2?"** — gesucht wird die schlechteste Note,
mit der der Fachschnitt das Ziel gerade noch hält. Verglichen wird die auf zwei
Nachkommastellen gerundete Zahl, also genau die, die auch angezeigt wird; sonst
stünde „2,00" da und die App sagte trotzdem, das Ziel sei verfehlt. Drei
Ausgänge: das Ziel hält jede Note, es hält ab dieser Note, oder es ist mit
einer Note nicht mehr zu schaffen.

## Reihenfolge des Baus

1. ~~**Fundament** — Projekt, Datenbank, Login, Fächer anlegen~~ **fertig**
2. ~~**Klausuren & Lernphasen** — Termine, Themen, Plan-Generator, Countdown,
   Fortschritt, Nachfrage bei verpassten Tagen, Push~~ **fertig**
3. ~~**Stundenplan & Hausaufgaben** — Wochenplan, Aufgaben, Startseite
   "Was ist heute und morgen?"~~ **fertig**
4. ~~**Noten** — Eintragen, Schnitt pro Fach und gesamt,
   "Was brauche ich noch für eine 2?"~~ **fertig**
5. **Material und Themen** — die Blätter kommen in die App, und aus ihnen wird
   Lernstoff. In Stufen:
   1. ~~**Themen-Vokabular** — jedes Fach führt seine Themen, Klausuren greifen
      daraus, Pflege unter `/faecher/<id>/themen`~~ **fertig**
   2. ~~**Kamera und Ablage** — Blätter aufnehmen, speichern, Fach und Thema
      zuordnen. Ohne KI, und für sich schon nützlich~~ **fertig**
   3. ~~**Eingangskorb** — Vorschläge, die man bestätigt, mit vollem
      Handformular~~ **fertig**
   4. ~~**Web MCP** — die App bietet ihre Fähigkeiten als Tools an, ein Agent in
      Claude benutzt sie~~ **fertig**
6. **Termine im Google Kalender** — die App schreibt per Calendar API in einen
   eigenen Kalender „Schule". In Stufen; jede neue Quelle ist eine Funktion in
   `SOURCES` (`src/lib/calendar/sources.ts`), Plan und Ausführung bleiben dafür
   unverändert:
   1. ~~**Verbinden** — „Mit Google verbinden" in den Einstellungen, OAuth mit
      genau einem Scope~~ **fertig**
   2. ~~**Bestand** — Klausuren, offene Hausaufgaben, freie Tage~~ **fertig**
   3. **Schulhomepage**
   4. **Termine von Blättern**
   5. **IServ**

## Die Ablage

Ein **Blatt** ist ein abfotografiertes Stück Papier: ein Arbeitsblatt, ein
Tafelbild, eine Kopie. Es hat ein Fach, ein Datum, einen Titel, eine Notiz und
beliebig viele Themen aus dem Vokabular seines Fachs — dieselben Themen, aus
denen auch die Klausuren schöpfen. Ein Blatt kann mehrere Seiten haben.

```
Fach ─── Blatt ──┬── Seite    Reihenfolge, Maße, Vollbild, Lesefassung, Vorschau
                 └── Thema    Verweis ins Vokabular des Fachs
```

**Die Fotos liegen in der Datenbank**, als `bytea` neben allen anderen Daten.
Ein Ort statt zweier: die Sicherung deckt sie mit ab, es braucht keinen zweiten
Dienst und kein zweites Token, und lokal wie in der Cloud läuft derselbe Code.
Das passt zu dem, was die App über sich behauptet — alle Daten liegen auf dem
eigenen Server.

Damit das trägt, wird **schon im Browser verkleinert**: lange Kante 1600 Pixel
als JPEG, dazu eine Vorschau mit 320 Pixeln und — seit dem Web MCP — eine
Lesefassung mit 1000 Pixeln für den Agenten. Eine Seite wiegt mit allen drei
Fassungen zusammen rund 250 bis 400 KB statt mehrerer Megabyte (an zwei
Testblättern gemessen: 165 + 69 + 14 und 212 + 89 + 19 KB), ein Schuljahr also
grob 50 bis 160 MB.
Der Server
braucht dadurch keine Bildbibliothek, und jede Anfrage trägt genau eine Seite —
mehrere Bilder in einem Zug würden jede Größengrenze sprengen, die ein
Funktionsaufruf in der Cloud hat.

Die **Vorschau ist eine eigene Spalte** und kein zurechtgeschnittenes Vollbild.
Die Ablage zeigt bis zu zweihundert Bilder auf einmal; als Vorschauen sind das
rund 3 MB, in voller Größe wären es rund 50 MB.

Ausgeliefert werden die Bilder über eine eigene Adresse je Seite
(`/api/material/<seite>`), die Sitzung und Besitzer prüft. Sie darf hart
zwischengespeichert werden, weil die Bytes einer Seite sich nie ändern: ein
neues Foto ist eine neue Zeile mit einer neuen Adresse. Aber nur privat — kein
geteilter Cache hebt ein fremdes Schulblatt auf.

**„Was habe ich zur Kettenregel?" ist eine Frage an die Ablage.** Sie filtert
deshalb nicht nur nach Fach, sondern auch nach Thema (`?thema=…` neben
`?fach=…`): unter der Fach-Zeile steht eine zweite Chip-Zeile mit den Themen
des gewählten Fachs, und die Themen eines Blattes sind im Kopf seiner Seite
antippbar. Ein Thema gehört zu genau einem Fach — damit ist die Frage
vollständig gestellt, das Fach steckt in ihr schon drin, und wenn in der
Adresse beides steht und sich widerspricht, gewinnt das Thema.

Gezeigt werden nur Themen, unter denen auch etwas liegt; ein Chip auf eine
leere Liste ist eine Sackgasse. Und die Zahl in der Themenpflege („3 Blätter")
und die Länge der gefilterten Liste rechnen mit **demselben** SQL-Ausdruck über
`coalesce(merged_into, id)` — sonst sagte die eine Ansicht drei und die andere
zeigte eines, und von außen wäre nicht zu sehen, welche lügt.

**Aufgenommen wird am Handy links.** Die Startseite hat dort drei wischbare
Seiten: Kamera, Kachelmenü, Tagesspur. Der Weg zum Auslöser ist die
Wischrichtung, in der nicht der Tagesablauf steht. Vorgeschlagen wird das Fach
der Stunde, die gerade läuft — aber nur, wenn es die App wirklich weiß und das
Fach nicht abgewählt ist. Ein falsch vorbelegtes Fach rutscht unbemerkt durch,
und ein Blatt im falschen Fach findet später niemand wieder.

## Der Eingangskorb

Ein frisch ausgelöstes Foto heißt „Blatt vom 21.8." und trägt kein Thema. Es
ist damit gespeichert und wiederauffindbar, aber noch nicht eingeordnet — und
genau dieser Zustand ist der Korb. Am Blatt steht dafür ein **Zeitpunkt und
kein Häkchen** (`filed_at`), aus demselben Grund wie bei den Hausaufgaben: ein
Häkchen kann mit dem Rest der Zeile in Widerspruch geraten, ein Zeitpunkt
nicht — und „seit wann liegt das da?" ist ohne eine zweite Spalte beantwortet.
Gesetzt wird er an drei Stellen, und alle drei heißen dasselbe: ein Mensch hat
hingesehen. Abhaken im Korb, Speichern am Blattformular, Übernehmen eines
Vorschlags. Zurücknehmen geht auch; die Spalte geht dann wieder auf leer, und
gelöscht wird dabei nichts.

Daneben liegen **Vorschläge**. Ein Vorschlag ist der Entwurf eines
Blattformulars: Fach, Titel, Tag, Notiz, Themen — **jedes Feld darf leer
bleiben, und leer heißt überall dasselbe**, nämlich „dazu sage ich nichts, es
bleibt, wie es am Blatt steht". Wer nur die Themen erkennt, muss keinen Titel
erfinden.

```
Blatt ─── Vorschlag ─── Thema   freier Text, noch kein Verweis ins Vokabular
             Herkunft (von Hand | vom Agenten | von der App)
             Fach, Titel, Tag, Notiz — jedes einzeln, jedes darf fehlen
```

**Eine Ausnahme hat „leer heißt: es bleibt".** Wechselt ein Vorschlag das
Fach und schweigt zu den Themen, fallen die Themen des Blattes trotzdem weg.
Sie gehören dem Vokabular des alten Fachs — „Kettenregel" ist ein Thema von
Mathematik —, und stehenzulassen hieße, sie im neuen Fach neu anzulegen: ein
Fachwort in Physik, das dort nie jemand getippt hat, und Themen lassen sich
nirgends löschen. Dieselbe Entscheidung trifft das Blattformular schon, nur
sichtbarer: dort leert ein Fachwechsel die Chips vor den Augen. Nennt der
Vorschlag eigene Themen, gelten die — auch im neuen Fach; dann ist es keine
Mitnahme, sondern eine Aussage, und sie steht in der Gegenüberstellung.

Die Themen eines Vorschlags sind **freier Text** und ausdrücklich kein Verweis
ins Vokabular. Am Blatt ist es einer, damit „Kettenregel" und „kettenregel "
dasselbe Thema sind. Ein Vorschlag darf aber ein Thema nennen, das es im
Vokabular noch gar nicht gibt — beim Lesen eines Blattes ist das der Normalfall.
Müsste er dafür eine Vokabel anlegen, schriebe er in den Bestand, und zwar
bevor jemand zugestimmt hat. Aus Text wird eine Vokabel erst beim Übernehmen,
durch dieselbe Tür wie beim Tippen im Formular.

**Er ändert nichts.** Übernehmen heißt: dasselbe Handformular wie überall
sonst, mit den Werten des Vorschlags vorbelegt, Feld für Feld änderbar — und
erst der Knopf darunter schreibt, durch dieselbe Prüfung und dieselbe
Datenschicht wie ein von Hand ausgefülltes Formular. Es gibt keine zweite Tür
in den Bestand. Daneben steht, was der Vorschlag am Blatt ändern würde,
gegenübergestellt; ändert er nichts, sagt die Seite auch das.

Ein Vorschlag trägt seine **Herkunft** — von Hand, von einem Agenten oder,
seit dem 6.10.2026, von der App selbst. Das ist keine Statistik. Ein Vorschlag
vom Agenten ist aus dem Inhalt eines Blattes abgeleitet, also aus etwas, das
die App nicht geschrieben hat; er wird deshalb als solcher angeschrieben, bevor
man ihn bestätigt. Für den Vorschlag der App gilt dasselbe, und er trägt
dieselbe Farbe: Die App legt ihn genau einmal an, für ein Blatt, dessen Seiten
Docling alle gelesen hat und zu dem deshalb kein Agent mehr kommt. Er enthält
nur einen Titel — die erste Überschrift der ersten Seite, wörtlich, sonst den
Platzhalter —, denn die Abschriften stehen schon am Blatt. Danach ordnet Jev
ihn ein wie jeden anderen; im Korb liegt er nur, wenn das nicht ging, und dann
sagt die Vorschlagsseite, woher er kommt.

**Es gibt keinen Zustand „übernommen" oder „verworfen".** Eine Zeile in der
Vorschlagstabelle ist ein offener Vorschlag, sonst nichts — entschieden heißt:
die Zeile ist weg. Ein Entwurf trägt keine Geschichte; was aus ihm wurde, steht
danach am Blatt, und das Blatt ist die Sache, die Geschichte trägt. Mit einem
Zustand liefe die Tabelle mit toten Entwürfen voll, die niemand mehr liest, und
jede Abfrage des Korbs müsste darum herumfiltern.

Bis Stufe 4 entstanden **alle Vorschläge von Hand**. Das war keine
Übungsaufgabe, sondern der Beweis, dass die Tür trägt, bevor jemand
hindurchgeht — und sie trug: das Werkzeug des Agenten (`propose_sheet`) legt
seinen Vorschlag heute durch dieselbe Prüfung und dieselbe Datenschicht wie das
Formular, ohne dass an ihnen eine Zeile geändert werden musste.

## Wie die KI angeschlossen wird

Zuerst nicht in die App hinein, sondern außen herum — und seit dem 11.10.2026
auch hinein, für das Abschreiben (Entscheidung vom 11.10.2026, unten). Die App
ist ohne KI vollständig: fotografieren, zuordnen, wiederfinden, Vorschlag von
Hand anlegen, bestätigen. Das gilt weiter: Ohne API-Schlüssel läuft sie wie
zuvor, nur liest niemand Handschrift.

Auf dem Weg über den Web MCP läuft der Agent in Claude und ruft die App — nicht
umgekehrt. Ein MCP-Server ruft nie ein Modell auf, er wird gerufen; deshalb
kostet dieser Weg kein API-Guthaben, sondern läuft über das Abo. Die Tools sitzen dabei **neben** den
Server Actions auf derselben `src/lib` und nicht darüber: eine Server Action
endet mit `redirect()`, und das wirft intern — ein Tool bekäme nie ein Ergebnis.

**Angestoßen wird der Agent von Hand, in der Claude-App.** Das war am 24.8.2026
entschieden, und zwar aus drei Gründen, von denen keiner der Preis war; seit dem
11.10.2026 gilt es nur noch für Chats (unten). Ein Blatt kostet als Bild rund
1 900 Tokens — so viel wiegt die Lesefassung mit 1000 Pixeln, die der
Agent bekommt; bei zweihundert Blättern im Schuljahr ist das gut ein Euro, je
nach Modell. Über einen Euro entscheidet man nicht.

Entschieden hat es dies:

Erstens liegt dieser Weg ohnehin auf dem Weg. Die App bietet ihre Fähigkeiten
als Tools an — das ist Stufe 4 und stand unabhängig davon fest, weil die Frage
„was habe ich zur Kettenregel?" einen Agenten braucht, der lesen kann. Der
Handgriff in der Claude-App ist genau dieser Weg plus die Gewohnheit, ihn zu
gehen. Ein Aufruf aus der App heraus käme obendrauf und ersetzte nichts.

Zweitens ließe sich der andere Weg gar nicht beurteilen, bevor dieser einmal
gelaufen ist. Ob die Erkennung bei einer Handschrift taugt, weiß man erst,
wenn man fünf Blätter durchgeschickt hat — und das kostet auf diesem Weg
nichts. Taugt sie nicht, wäre ein Aufruf nach jeder Aufnahme das Gegenteil
einer Erleichterung: er füllte den Korb mit Vorschlägen, die ohnehin von Hand
nachgetippt werden. (Für Handschrift ist es seit dem 11.10.2026 gemessen, an
31 Seiten — und das Ergebnis trägt den Aufruf, siehe unten.)

Drittens stimmt „sicherheitsseitig sind alle Wege gleich" nur für die
Schreibrichtung. Dort gilt er ohne Abstriche: kein Vorschlag kommt ohne
Bestätigung in den Bestand, egal wer ihn geschrieben hat. Für die Leserichtung
gilt er nicht. Fragt die App selbst ein Modell, bekommt sie einen Schlüssel,
der Geld ausgeben kann, und eine ausgehende Verbindung zu einem Dritten — und
sie wird selbst zu der Stelle, die ein nicht vertrauenswürdiges Blatt einem
Modell vorlegt. In der Claude-App ist der Schadensradius einer verunglückten
Anweisung auf einem Blatt ein Chatverlauf. (Seit dem 11.10.2026 ist die App
genau diese Stelle. Wie sie das trägt — ohne ein einziges Werkzeug im Aufruf —,
steht in der Entscheidung vom 11.10.2026.)

Seit dem 24.8.2026 ist dieser Weg gebaut und gelaufen: die Anmeldung eines
Programms, die Zustimmung, der Tausch, die Werkzeuge, ein Blatt als Bild und
ein Vorschlag im Korb — alles gegen die echte Adresse geprüft. Was der zweite
Grund verlangt, steht damit offen: fünf Blätter durchschicken und hinsehen.

**Und der andere Weg ist gegangen worden — anders als beide Skizzen.** Am
25.8.2026, einen Tag nach Stufe 4, kam der Wunsch: vom Foto bis zum Vorschlag
ohne Handgriff. Gebaut wurde dafür weder der Knopf am Korb noch der Aufruf aus
der App, sondern ein Dritter: **der Postbote** (`harness/`), ein kleines
Programm auf dem eigenen Rechner, später auf dem NAS. Es sah alle paar Minuten
in den Korb und setzte Claude auf jedes Blatt an, das noch keinen Vorschlag
hatte. (Ab dem 4.10.2026 alle 15 Sekunden; stillgelegt am 11.10.2026 — beides
weiter unten.)

Das hielt alles, was oben steht. Die App bekam keinen Schlüssel und rief nie
ein Modell — der Postbote tat es, von außen, durch dieselbe Tür wie die
Claude-App. Er meldete sich als eigener Client an und holte sich eine eigene
Zustimmung; damit stand er in den Einstellungen als eigene Zeile und ließ sich
einzeln trennen. Und weil er über Claude Code lief, kostete er kein
API-Guthaben, sondern Kontingent.

**Was damals ausdrücklich nicht kommen sollte, war der Aufruf nach jeder
Aufnahme.** Er feuerte im Unterricht, auf einer Verbindung, die es im
Schulnetz oft nicht gibt, und bräuchte eine Warteschlange und einen
Fehlerzustand je Blatt. Der Postbote brauchte beides nicht, denn **der
Eingangskorb war die Warteschlange**: ein Blatt ohne Vorschlag war die offene
Aufgabe, und wer eine Runde verpasste, holte sie in der nächsten nach.
Angestupst wurde dabei nichts — die App wusste von ihm nichts, und sie sollte
nichts von ihm wissen. Seit dem 11.10.2026 gibt es den Aufruf doch, mit
beidem, was ihm fehlte; der Anlass steht unten.

**Nachtrag vom 4.10.2026: das Foto ist der einzige Handgriff.** Auf Wunsch
ordnet seitdem die App selbst ein: nach dem Vorschlag des Postboten
entscheidet **Jev** (TypeSafe, ein Entscheidungsmodell) über Fach und Themen,
und die App übernimmt — durch dieselbe Tür wie der Knopf im Korb. Und
**Docling**, eine Texterkennung im eigenen Container, liest das Gedruckte —
seit dem 6.10.2026 nicht mehr dem Postboten vor, sondern für die App selbst
(siehe unten). Damit ruft die App selbst zwei Dienste, und der Satz oben („Die
App bekommt keinen Schlüssel und ruft nie ein Modell") gilt nicht mehr; der
Agent darf aber weiterhin nur vorschlagen. Der Postbote sah ab da alle 15
Sekunden nach, wartete bei einem leeren Kontingent bis zu 30 Minuten, und
Seiten, die an ein schon eingeordnetes Blatt angehängt wurden, las er von
selbst nach — die fünfzehn Altblätter vom August ausdrücklich nicht. Den
Agenten rief die App weiter nicht: angestupst wurde er nicht, der Korb blieb
seine Warteschlange. Das galt bis zum 11.10.2026; die Regeln — Ruhe, Pause,
Nachlese, die Altblätter — hat der Leser der App übernommen.

**Entscheidung vom 6.10.2026: ein Leser je Seite, und die App entscheidet.**
Bis dahin las jede Seite zweimal. Docling rechnete sie für den Postboten vor,
Claude schrieb sie danach trotzdem ganz vom Foto ab, mit Doclings Text als
Vorlage — und wer was übernimmt, entschied ein Satz im Prompt, also eine
Stelle, die niemand prüfen kann. Seitdem
liest Docling jede neue Seite genau einmal, angestoßen von der App nach dem
Hochladen, und eine feste Regel samt Einstufung durch Jev entscheidet: Ist es
sauberer Druck — mindestens 60 Wörter, nichts, was nach einer Formel aussieht,
und Jev hält es für richtig geschriebene, sinnvolle Sätze —, wird Doclings Text
die Abschrift der Seite. Alles andere liest Claude, vom Foto und ohne Vorlage.
Jeder Fehler unterwegs heißt Claude, und nichts wartet. Gemessen an 37 echten
Seiten: 11 lasen Docling allein, keine davon falsch.

Das ist ein Aufruf nach jeder Aufnahme, und oben steht, dass es den nicht gibt.
Gemeint war dort der Agent, ausgelöst vom Handy im Unterricht, ohne
Warteschlange und ohne Zustand je Blatt. Dieser hier ruft keinen Agenten, läuft
auf dem NAS nach der Antwort an das Handy, und beides, was ihm fehlte, hat er:
eine Queue je Prozess, die Docling eine Seite nach der anderen rechnen lässt,
und an jeder Seite `leser` und `leser_grund` — wer liest, und warum. Fünf Tage
später kam auch der Agent selbst in die App, auf demselben Muster
(Entscheidung vom 11.10.2026, unten).

Und dabei **schreibt die App die Abschrift direkt, ohne Vorschlag.** Das ist
der erste Weg in den Bestand, an dem kein Mensch und kein Vorschlag steht, und
er hat einen benannten Anlass. Die Regel „der Agent schreibt nie in den
Bestand" (unten) schützt vor einem Leser, der einen Satz auf dem Blatt als
Anweisung nehmen kann; deshalb muss zwischen ihm und dem Bestand eine
Bestätigung stehen. **Docling ist kein solcher Leser.** Es erkennt Zeichen und
befolgt nichts, und was es liefert, ist dieselbe Art Text, die ein Mensch beim
Abtippen liefert, nur mit anderen Fehlern. Die Bestätigung gibt hier die feste
Regel plus Jevs Einstufung — ein Entscheidungsmodell, das nur mit einer
Wahrscheinlichkeit antwortet und keinen Text schreibt. Und der Weg ist eng
gehalten: geschrieben wird nur in eine Seite, die noch keine Abschrift hat,
und **gekennzeichnet** („maschinell gelesen (Docling)") an der Blattseite, im
Korb, im PDF, im Wiki und im Fragen-Eingang — denn eine solche Abschrift hat
keine ⟨spitzen Klammern⟩; Docling weiß nicht, wo es unsicher war. Wer den Text
ändert, macht daraus eine Abschrift von Hand, und die Kennzeichnung geht. Ein
Vorschlag mit genau diesem Text wäre nur ein Umweg gewesen: übernommen hätte
ihn Jev und nicht ein Mensch, geprüft also auch dort niemand — und das Ziel
ist, dass das Foto der einzige Handgriff bleibt.

Was die Entscheidung **nicht** ändert: Agenten schreiben weiter nur über
`propose_sheet` und `propose_questions`, und `src/lib/mcp/tools.test.ts` prüft
das unverändert. Die Zuteilung ist App-Code und kein Werkzeug; ein Chat kann
sie höchstens anstoßen (`read_inbox` nimmt Seiten mit, die noch auf eine
Entscheidung warten), aber weder auslösen, was gelesen wird, noch das Ergebnis
bestimmen. Und `propose_sheet` verwirft Abschriften zu Seiten, die die App
liest oder gelesen hat, statt sie anzunehmen — so kann auch ein Chat in der
Claude-App keine Docling-Abschrift überschreiben.

**Entscheidung vom 11.10.2026: die App ruft das Modell selbst.** Der Anlass
ist eine Messung und ein Satz. Gemessen wurde an diesem Tag, ob Sonnet 5.5
für die Abschrift reicht: 31 echte Seiten mit Handschrift, je zweimal
abgeschrieben von Opus 5.5 und von Sonnet 5.5, nur vom Foto, und zwei Richter
zählten blind am Foto die Fehler. Opus kam je Durchgang über alle Seiten auf
10 bis 13 bestätigte schwere Fehler, Sonnet auf 37 bis 52. Und Sonnets
häufigster Fehler ist der, den diese App am wenigsten verträgt: es verbessert still die
Schreibweise des Schülers — aus einer „Hypothenuse“ wird die „Hypotenuse“, ohne Klammer (ein erfundenes Beispiel derselben Art). Eine
Abschrift, deren Fehler nicht markiert sind, nimmt den ⟨Klammern⟩ ihren Sinn,
und auf den Klammern steht das ganze Vertrauen in eine Abschrift, die niemand
gegenliest. Daneben fiel auf, dass die Abschriften, die bis dahin im Betrieb
gespeichert worden waren, so schlecht abschnitten wie Sonnet; woran das lag —
ein älteres Modell, die Vorgaben des Programms, Doclings Vorlage bis zum
6.10. —, ist nicht untersucht. Danach hat der Nutzer entschieden, alles auf die API
umzuziehen.

Damit drehen sich drei Sätze weiter oben um, und sie werden hier beantwortet
statt überklebt:

- **„Die App bekommt keinen Schlüssel und ruft nie ein Modell“** (Postbote,
  25.8.2026) und **„Den Agenten ruft die App weiter nicht“** (4.10.2026): Sie
  ruft ihn jetzt, mit einem Schlüssel, der Geld ausgeben kann. Der Postbote
  ist stillgelegt, nicht gelöscht: Sein Code liegt weiter unter `harness/`
  (der Nutzer am 11.10.2026: „für den Fall der Fälle“), sein Ordner
  stillgelegt auf dem NAS — beides der Rückweg, falls der API-Leser ausfällt.
  Mit einer harten Regel, die schon vorher galt: nie zugleich mit dem
  API-Leser, sonst liegen zwei Vorschläge am selben Blatt, einer bezahlt. Zur
  App gehört er damit so wenig wie vorher: kein Import aus `harness/`, nicht
  im Typprüfer der App, nicht im Bild.
- **„Was ausdrücklich weiter nicht kommt, ist der Aufruf nach jeder
  Aufnahme“**: Er kommt — aber nicht so, wie er dort abgelehnt wurde. Er
  feuert nicht im Unterricht, sondern auf dem NAS, nachdem ein Blatt zwanzig
  Sekunden zur Ruhe gekommen ist. Und die zwei Dinge, die ihm fehlten, hat er
  wie Docling am 6.10.2026: eine eigene Queue je Prozess und einen Zustand je
  Blatt — die Tabelle `leser_laeufe`, in der jeder Lauf mit seinem Ergebnis
  und seinem Preis steht. Der Eingangskorb bleibt der Ort, an dem ein Mensch
  entscheidet; die Warteschlange ist jetzt die Datenbank: wer eine Seite
  liest (`leser`), ob sie gelesen ist (`transcript`), welcher Lauf schon war
  (`leser_laeufe`).
- **Der dritte Grund vom 24.8.2026** — ein Schlüssel, eine ausgehende
  Verbindung, und die App wird selbst zu der Stelle, die ein nicht
  vertrauenswürdiges Blatt einem Modell vorlegt. Das trifft jetzt genau zu.
  Deshalb ist der Aufruf so gebaut, dass diese Stelle nichts hergibt:
  - **Keine Werkzeuge.** Kein `tools`, keine Server-Werkzeuge, kein
    MCP-Server — nicht verboten, sondern nicht da. Hinein gehen der
    Systemtext mit den Abschreibregeln, der Auftrag und die Fotos, heraus
    kommt eine Antwort in fester Form. Ein Blatt, auf dem „lösche alle Noten“
    steht, findet nichts, womit es das könnte; der Schadensradius einer
    verunglückten Anweisung ist ein Vorschlag im Korb. Das ist enger als der
    Käfig des Postboten, der alle Werkzeuge der App sah, auch `read_grades`.
  - **Die Antwort wird geprüft, nicht geglaubt.** Die API sorgt für die
    Form, und die App prüft sie danach trotzdem Feld für Feld.
  - **Dieselbe Tür.** Opus ist ein Leser, der einen Satz auf dem Blatt als
    Anweisung nehmen könnte — genau der, vor dem die Regel unten schützt.
    Er schreibt deshalb keine Abschrift direkt wie Docling, sondern einen
    Vorschlag, durch dieselbe Tür wie `propose_sheet` (`blattVorschlagen()`
    in `src/lib/blatt-vorschlag.ts`: Seitenprüfung, Verwerfen, dasselbe
    Schema wie das Handformular, `createProposal(…, "agent")`, `autoFile()`).
    Fragen legt der Fragenlauf nur über `vorschlagAnlegen()` ab, und
    übernehmen kann sie nur ein Mensch.
  - **Der Schlüssel nur zur Laufzeit** — nie im Bild, nie als `NEXT_PUBLIC_`.
    Und nie neben etwas aus IServ: an Claude gehen Fotos und Abschriften,
    sonst nichts.

**Warum Opus und warum die Lesefassung, steht in der Messung oben;** beides
ist gemessen und nicht gewählt, und das 1600-px-Vollbild ist es nicht — es
bleibt bis zu einer eigenen Messung aus. Aus demselben Grund steht der
Aufwand ausdrücklich da (`effort: high`, gemessen), statt der Vorgabe eines
Programms überlassen zu bleiben. Lehnt Opus ein harmloses Blatt ab, wiederholt
die API die Anfrage auf einem Rückfallmodell, und wer wirklich gelesen hat,
steht im Vermerk.

**Was es kostet, war bisher kein Grund und ist jetzt eine Zahl.** Eine Seite
Handschrift kostete in der Messung 0,15 bis 0,28 $; eine Antwort kann
höchstens 16 000 Tokens plus 8 000 je Seite lang werden, ab sechs Seiten
64 000, also 1,28 $ Ausgabe. Gespart wird nicht am Modell — die Messung
schließt Sonnet aus —, sondern an dem, was gar nicht erst zu Claude geht:
Gedrucktes liest Docling, und das Gedächtnis sorgt dafür, dass ein Blatt im
selben Stand nur einmal bezahlt wird. Verwerfen, Abhaken, „wieder in den
Korb“ und ein Neustart lösen kein zweites Lesen aus, und die Zeile eines
Laufs steht schon vor dem Aufruf da, sodass auch ein Neustart mitten im Strom
gezählt wird. Was trotzdem bezahlt abbricht und am Blatt liegen kann — die
eigene Frist, ein Strom, der mitten in der Antwort abreißt, eine Ablehnung
mit ausgelastetem Rückfall —, zählt je Stand höchstens zweimal, danach liest
es nur noch der Knopf. Ein abgerissener Strom und ein ausgelasteter Rückfall
verfallen nach einem Tag (sie lassen sich keinem Blatt sicher zuordnen, und
kein Ausfall soll ein Blatt für immer stilllegen), höchstens vier zählen
insgesamt; Frist, Ablage und ein Neustart mitten im Aufruf verfallen nicht; was nichts gekostet hat, wie ein 400 vor dem Strom,
zählt nie, und ein Ausfall der API — Überlastung, Grenzen, Konto, auch mitten
im Strom gemeldet — auch nicht: der trifft jedes Blatt, und er legte sonst
eines nach dem anderen still (zwei Nachprüfungen vom 11.10.2026: erst
zählte jede Pause, dann gar kein Abbruch im Strom, und ein Blatt, an dem der
Strom jedes Mal abriss, kostete jeden Anstoß aufs Neue). Ein verworfener Vorschlag von außen — aus einem
Chat, oder einer des Postboten — hinterlässt dieselbe Spur wie ein eigener
Lauf. Die Frist ist aus `max_tokens` gerechnet und
nicht umgekehrt: eine Antwort, die nicht aufhört, endet an der Grenze der
Tokens, einmal bezahlt, und nicht an der Frist, wo sie wiederkäme. Der
Workspace des Schlüssels hat ein Ausgabelimit, und was die Läufe gekostet
haben, steht am Blatt und in den Einstellungen — mit „mindestens“, sobald ein
bezahlter Abbruch ohne Messung dabei war. Ohne Schlüssel läuft die App wie
zuvor, nur liest niemand Handschrift — und das sagt sie, statt still zu
warten. (Zahlen und Regeln dieses Absatzes nach der Abnahme vom 11.10.2026.)

**Kein Takt, auch jetzt nicht.** Angestoßen wird der Leser vom Ende jeder
Zuteilung, vom Start der App (`register()` in `src/instrumentation.ts` — das
Netz nach einem Neustart, das bis dahin das `read_inbox` des Postboten war;
antwortet die Datenbank beim Start noch nicht, mit vier Wiederholungen über
gut sechs Minuten), von Weckern im Speicher für Ruhe, Pause und den zweiten
Versuch einer gescheiterten Zuteilung, und von Hand: „Abschreiben lassen“ am
Blatt, „Fragen bauen lassen“ an einer Klausur. Fragen baut die App nie von
selbst.

Zwei Regeln stehen darüber:

**Alles, was die KI kann, muss ich auch können.** Jede Fähigkeit des Agenten
braucht einen Weg in der Oberfläche. Umgekehrt gilt es nicht — der Agent bekommt
nur `read_*` und `propose_*`, kein Anlegen, kein Ändern, kein Löschen. Seit die
App den Agenten selbst ruft, heißt das auch: auslösen können. Was er von selbst
liest, liest er auf Knopfdruck auch („Abschreiben lassen“), und den Fragenlauf
gibt es nur auf Knopfdruck.

**Der Agent schreibt nie in den Bestand.** Er legt Vorschläge an; erst ein
Mensch übernimmt sie, durch dieselbe Tür wie ein Formular — oder seit dem
4.10.2026 Jev, durch dieselbe Tür. Das ist keine Vorsichtsmaßnahme, sondern
die Bedingung: Wer nicht vertrauenswürdige Blätter liest und gleichzeitig
schreiben darf, ist angreifbar über das Blatt selbst. Die eine Abschrift, die
ohne Vorschlag in den Bestand kommt — Doclings, seit dem 6.10.2026 —, ist
keine Ausnahme davon: Docling ist kein Agent, der Anlass steht oben. Der Leser,
den die App seit dem 11.10.2026 selbst ruft, ist dagegen einer, und für ihn
gilt die Regel ohne Abstriche: Er schreibt nur über die Tür von
`propose_sheet`, und `src/lib/blatt-vorschlag.test.ts` und
`src/lib/leser/claude-leser.test.ts` prüfen an ihrem Quelltext, dass nichts
anderes schreibt.

Daraus folgte lange ein zweiter Satz: Zettel gehörten nie in eine
Claude-Code-Sitzung, sondern in die Claude-App — „dort steht kein Bash und kein
Zugriff auf das Repo daneben". **Der Satz stimmte, und er stimmt so nicht
mehr.** Am 25.8.2026 nachgemessen: entscheidend ist nicht, welches Programm
das Blatt liest, sondern was in der Sitzung daneben steht. Und das lässt sich
leeren.

Drei Schalter nahmen einem Lauf des Postboten die Fähigkeiten, statt sie ihm
nur zu verbieten: `--tools ""` entfernte die eingebauten Werkzeuge,
`--strict-mcp-config` ließ nur den mitgegebenen Server gelten, `--mcp-config`
gab genau einen mit. Ein so gestarteter Lauf, nach seinen Werkzeugen gefragt,
zählte elf auf — alle aus dieser App; nach Bash gefragt, sagte er, er habe
keines. Ohne den ersten Schalter führte derselbe Lauf `echo` aus, obwohl Bash
nicht in der Erlaubnisliste stand: eine Erlaubnisregel können die
Einstellungen des Rechners weiten, eine fehlende Fähigkeit nicht.

Die Regel hieß deshalb ab da: **ein Blatt gehört in keine Sitzung, in der
mehr steht als die Werkzeuge dieser App** — und wer das behauptet, muss es
zeigen können. Für einen Chat in der Claude-App gilt sie so weiter.

Seit dem 11.10.2026 gilt sie in der App in ihrer engsten Form: **ein Blatt
gehört in keinen Aufruf, in dem überhaupt ein Werkzeug steht.** Gezeigt wird
das nicht mehr, indem man einen Lauf nach seinen Werkzeugen fragt, sondern am
Code: `claudeAnfrage()` in `src/lib/claude/client.ts` baut die Anfrage aus
einer festen Liste von Feldern, und `client.test.ts` prüft, dass es genau
diese sind — kein `tools`, kein `tool_choice`, kein MCP-Server. Eine
Erlaubnisliste gibt es dort nicht mehr, weil es nichts gibt, was erlaubt
werden könnte.

### Wie der Zugang abgesichert ist

Die App bringt ihren **eigenen OAuth-Server** mit. Das ist keine Vorliebe für
Protokolle: die Claude-App nimmt für einen selbst gebauten Anschluss genau drei
Arten von Anmeldung an, und zwei davon scheiden aus. „Ohne Anmeldung" hieße,
dass jeder im Netz die Blätter lesen kann. Ein fester Schlüssel in einer
Kopfzeile ist dort eine Beta, die man bei Anthropic beantragen muss. Bleibt der
vorgesehene Weg — und für einen einzigen Nutzer ist er kleiner, als sein Name
vermuten lässt: eine Anmeldung ohne Passwort für das Programm, **eine Seite mit
einem Knopf für den Menschen** (`/verbinden`), ein Tausch von Code gegen Token.

Vier Dinge daran sind nicht verhandelbar, und jedes hat einen Fall, den es
verhindert:

- **PKCE.** Der Zustimmungs-Code reist durch die Adresszeile eines Browsers.
  Ohne den Prüfwert wäre er allein schon der Schlüssel.
- **Die Rückadresse wird Zeichen für Zeichen geprüft.** Sie ist die Stelle, an
  die der Code geschickt wird; wer sie fälschen darf, braucht kein Passwort.
- **Das Token gilt für genau eine Adresse.** Ein Token für einen anderen
  MCP-Server, das jemand hierher weiterreicht, ist kein Zugang — sonst wäre
  jeder Server, bei dem der Nutzer angemeldet ist, ein Schlüssel zu allen
  anderen.
- **Gespeichert werden nur Abdrücke.** Anders als das Sitzungs-Token im
  eigenen Cookie gehen diese Zeichenketten durch fremde Hände.

Und eine Regel, die nicht im Protokoll steht, sondern in diesem Konzept:
**alles, was verbunden ist, steht in den Einstellungen und lässt sich dort
trennen.** Ein Zugang, den man nur erteilen und nicht zurücknehmen kann, ist
kein Zugang, sondern ein Geschenk.

### Was der Agent kann

Zwölf Werkzeuge, elf davon lesen: Fächer, Themen, Stundenplan, Hausaufgaben,
Klausuren samt Lernplan, Noten, die Ablage, ein Blatt, das Foto einer Seite,
die Abschrift eines Blattes, der Eingangskorb. Das zwölfte legt einen Vorschlag
an. Kein Anlegen, kein Ändern, kein Löschen — und ausdrücklich auch kein
Übernehmen eines Vorschlags.

Das elfte Lesewerkzeug, `read_transcript`, kam am 5.9.2026 mit der Abschrift
dazu. Es steht neben `read_page` und nicht darin: `read_page` liefert das Foto,
`read_transcript` den Wortlaut, der am Blatt gespeichert ist — übernommen von
einem Menschen oder von Jev, oder seit dem 6.10.2026 von der App aus Docling
geschrieben und dann je Seite mit `maschinell` gekennzeichnet. Getrennt sind sie,
weil ein Blatt mit zwölf Seiten als Bilder nie in ein Werkzeugergebnis passte —
als Text passt es.

Jedes davon steht auch in der Oberfläche; die Regel „alles, was die KI kann,
muss ich auch können" ist damit eingehalten, ohne dass eine Seite dazukommen
musste. Umgekehrt gilt sie nicht: den Epochenwechsel, das Zusammenlegen von
Themen und das Abhaken eines Lernblocks gibt es nur für Menschen.

**Ein Fach nennt der Agent beim Namen.** „Mathe" ist eine zulässige Angabe,
nicht nur die id — sonst müsste er vor jeder Frage eine Liste holen, um ein
Wort zu übersetzen, das der Mensch ihm gerade gesagt hat. Passt der Name auf
mehrere Fächer, fragt das Werkzeug zurück, statt eines zu raten: ein Blatt im
falschen Fach findet später niemand wieder.

**Das Foto braucht eine eigene Größe.** Ein Tool-Ergebnis endet in der
Claude-App bei rund 150 000 Zeichen, und ein Bild reist dort als Base64 —
drei Bytes werden zu vier Zeichen. Das Vollbild mit 1600 Pixeln käme nicht
durch (gemessen: 165 KB, also rund 225 000 Zeichen), die Vorschau mit 320
Pixeln käme durch und wäre unlesbar. Deshalb liegt neben beiden eine dritte
Fassung mit 1000 Pixeln, gerechnet im Browser wie die anderen auch (gemessen: 69 und 89 KB, also
94 000 bis 121 000 Zeichen). Der Server bleibt damit ohne Bildbibliothek —
das war der Punkt. Der Leser der App bekommt seit dem 11.10.2026 dieselbe
Fassung, und zwar nicht, weil eine Grenze es verlangte — die API nähme das
Vollbild —, sondern weil an ihr gemessen ist.

Und wenn ein Blatt sich partout nicht kleinrechnen lässt — ein Tafelbild im
Halbdunkel —, sagt `read_page` das geradeheraus, statt ein Ergebnis zu
schicken, das unterwegs abgeschnitten wird. Die Grenze liegt bei 105 000 Bytes,
also genau 140 000 Zeichen; die zehntausend Rest tragen den Satz davor und den
Umschlag.

## Der Google Kalender

**Die App ist die Quelle, Google das Ziel.** Ändert sich etwas in der App, wird
der Termin in Google überschrieben; wird es gelöscht oder eine Hausaufgabe
abgehakt, verschwindet er dort. Aus Google liest die App nur zweierlei: ob es
den Kalender noch gibt, und — bei einem Termin, den sie gerade anfassen will —
ob er dort gelöscht wurde. Eine Liste aller Termine holt sie nie; eine
unvollständige sähe aus wie viele Löschungen.

**„verworfen" ist endgültig.** Was der Nutzer in Google löscht, trägt die App
nie wieder ein, auch nicht nach einer Änderung in der App. Bemerkt wird die
Löschung beim nächsten Anfassen — beim Ändern oder Löschen des Termins. Einen
Termin, den die App nicht anfasst, holt sie auch nicht zurück; mehr verlangt die
Zusage nicht.

**Die Generation steht in der ID.** Die Event-ID ist fest (Art, UUID,
Generation), damit ein doppeltes Anlegen in Google als 409 endet statt als
zweiter Termin. Eine gelöschte ID verwendet die App nie wieder: Wird eine
abgehakte Hausaufgabe wieder geöffnet, kommt sie mit Generation + 1 unter
neuer ID zurück.

**Eine Quelle ist eine Funktion.** Sie liefert die gewünschten Termine ihrer
Art vollständig oder wirft — dann bleibt ihre Art in diesem Lauf unberührt.
Lernblöcke und Abruf-Termine sind keine Quelle und werden es nicht: Die App soll
kein Tagesplaner werden.

## Offene Punkte

- Fächerliste (kommt beim ersten Einrichten in der App)
- **Ob die Erkennung bei Formeln taugt, ist noch nicht gemessen.** Für
  Fließtext ist es das: ein abfotografierter Aufsatz kam am 23.8.2026 wörtlich
  richtig zurück, mit einem einzigen als unsicher markierten Wort — und die
  Vermutung stimmte. Mathematik ist ein anderes Problem und wird das Fach mit
  den meisten Blättern: Brüche, Indizes, Exponenten, beschriftete Skizzen.
  Handschrift ist seit dem 11.10.2026 gemessen (31 Seiten, siehe die
  Entscheidung dieses Tages); Formeln sind darin nicht eigens ausgewertet. Der
  automatische Aufruf ist inzwischen da — taugt die Erkennung bei Formeln
  nicht, füllt er den Korb mit Vorschlägen, die nachgetippt werden, und
  kostet dafür. Messen lässt es sich mit `scripts/abschrift-messen.mts` an
  ein paar Mathe-Seiten.
- **Ein Leser je Seite — was die 37 Seiten nicht beantworten.** Die Regel ist
  an genau den Seiten gewählt, an denen sie gemessen ist, und zwei davon sind
  dasselbe Handout. Was sie im Betrieb taugt, zeigt `leser_grund`; die ersten
  rund zwanzig Seiten, die Docling allein liest, gehören neben ihr Foto gelegt.
  Offen ist im Einzelnen:
  - **Gedruckte Formelblätter fehlen im Messbestand ganz.** Sie gehen nach der
    Regel nie an Docling allein — ob das reicht oder zu viel ist, weiß niemand.
  - **Die Formelmuster greifen weit.** „Buchstabe vor Ziffer" trifft auch CO2,
    M1 und A4, „Buchstabe vor Klammer" auch „Schüler(innen)". Solche
    Druckseiten liest dann Claude. An den 37 Seiten kostete das keine; zeigt
    `leser_grund.formel` es im Betrieb öfter, könnte eine zweite Fassung der
    Regel einen einzelnen Buchstaben verlangen.
  - **Die Formelanreicherung in Docling** (`do_formula_enrichment`, ein
    Formelmodell von 610 MB) rechnet für Seiten, die ohnehin an Claude gehen.
    Liefern die 37 Seiten ohne sie dieselbe Entscheidung, kann sie weg.
  - **Titel und Tag gemischter Blätter.** Die erste Überschrift taugt nicht
    immer als Titel („3. Aufgabe"), und steht das Datum nur auf einer Seite,
    die Docling liest, bleibt der Aufnahmetag.
  - **Ein Vorschlag der App, den Jev nicht einordnen konnte,** sagt im Korb
    nicht, warum — das steht nur im Protokoll der App.
  - **Kein Takt, mit Absicht — und eine Lücke daraus.** Startet die App in den
    zwanzig Sekunden vor dem Vorschlag der App neu, bekommt ein reines
    Docling-Blatt keinen; es bleibt für einen Menschen im Korb. Der Anstoß
    beim Start (`register()` in `src/instrumentation.ts`) hilft dort nicht: Er
    lässt die Zuteilung laufen, und die prüft nur Blätter, deren Seiten offen
    sind oder die vorgemerkt waren. Die zweite Lücke von damals — ohne den
    Postboten warteten Seiten, die ein Neustart auf „offen" stehen ließ, bis
    zum nächsten Hochladen — ist seit dem 11.10.2026 zu: Diesen Anstoß gibt
    der Start der App, und zwar auch dann, wenn die Datenbank beim Start noch
    nicht antwortet (vier Wiederholungen über gut sechs Minuten); und eine
    Seite, deren Zuteilung scheiterte, stößt nach ihren zehn Minuten Ruhe ein
    Wecker wieder an. Beides kam erst mit der Abnahme vom selben Tag — davor
    war es ein einziger Versuch, und nach der Ruhe kam niemand mehr.
  - **Doclings Rohtext bleibt gespeichert,** auch der von Handschriftseiten, in
    der Datenbank auf dem NAS. An ein Modell (Jev) geht er nur, wenn er die
    Regel bis zur Länge bestanden hat.
  - **Der Vermerk fehlt noch beim Baustein-Bau im Abruf** (`/abruf/bausteine/neu`)
    — im Fragen-Eingang und in `read_exam_material` steht er.
  - **`MCP_TOOL_TIMEOUT` ist mit `read_docling` gegangen, und mit dem
    Postboten gibt es niemanden mehr, der ihn setzen könnte.** Der Wert war
    eine Einstellung von Claude Code. Der Leser der App ruft die Tür ohne MCP;
    ein Chat in der Claude-App wartet nach `propose_sheet` auf Jev, im
    ungünstigsten Fall zweimal fünfzehn Sekunden, und dort lässt sich keine
    Frist einstellen. Zeigt ein Chat dort Zeitabläufe, muss die Wartezeit auf
    Jev aus der Antwort heraus.
  - **Die Notbremse `LESER_REGEL=aus`** trägt kein Skript ein; sie ist eine
    Zeile von Hand in der Override-Datei, die vier Skripten gehört.
  - **Nach einem Rückweg (`nas.sh zurueck`) kennt der alte Code `maschinell`
    nicht.** Ändert in der Zeit jemand eine Docling-Abschrift, behält sie die
    Kennzeichnung. Ein Trigger in der Datenbank finge das ab, wäre aber die
    erste Regel dort, die eine Sitzung der App von einer anderen unterscheiden
    müsste; bis dahin steht im README, wonach nach einem längeren Rückweg zu
    sehen ist.
- **Der Claude-Leser — was die Proben nicht beantworten.** Gebaut und gegen
  eine echte Datenbank mit nachgemachter API geprüft; offen ist:
  - **Die Abnahme-Messung steht aus.** Systemtext, Auftrag und Antwortform
    sind für den Aufruf ohne Werkzeuge neu geschrieben; ob sie so gut lesen
    wie die Messung vom 11.10.2026, zeigt erst `scripts/abschrift-messen.mts`
    an echten Seiten. Dasselbe Skript entscheidet, ob das Vollbild
    (`CLAUDE_BILD=voll`) besser liest oder nur mehr kostet.
  - **Wie die API ein erschöpftes Ausgabelimit meldet, ist nicht
    nachgeprüft.** Deshalb ist kein 400 mehr ein „nichts“ (11.10.2026, in
    `src/lib/claude/ergebnis.ts`): klingt die Meldung nach Guthaben oder
    Limit, ist es eine Pause, sonst „später“ — nicht gemerkt, und eine
    abgewiesene Anfrage kostet nichts. Seit der Abnahme vom selben Tag zählt
    ein solcher 400 auch nicht mehr auf die Grenze je Blatt: dort zählen nur
    bezahlte Abbrüche, die am Blatt liegen können — ein 400 erst, wenn er
    mitten im Strom kommt, nachdem das Modell schrieb. Ebenso ungeprüft: ob die
    Probe beim Einrichten (`scripts/nas-probe-claude.mjs`) mit der
    Beta-Kennung des Rückfalls durchkommt.
  - **Das Rückfallmodell ist an Handschrift ungemessen.** Lehnt Opus ab,
    liest ein anderes Modell; der Vermerk sagt, welches. Lehnt auch das ab,
    ist das Blatt „nichts“ und wartet auf den Knopf oder auf Abtippen. War das
    Rückfallmodell nur gerade ausgelastet (die API nennt es dann in
    `stop_details.recommended_model`), ist es „später“ — einmal bezahlt, und
    höchstens zweimal je Stand.
  - **Die Frist ist aus einer angenommenen Schreibrate gerechnet** (25 Tokens
    je Sekunde, `CLAUDE_LANGSAM_TOK_S`), nicht gemessen. Schreibt die API
    langsamer, bricht die Frist eine ausufernde Antwort doch ab; die Messzeile
    „Wand … s“ im Protokoll zeigt, wie viel Luft bleibt.
  - **Was ein bezahlter Abbruch gekostet hat, weiß niemand.** Das SDK reicht
    bei einem Abbruch keine `usage` heraus; die Summe steht dann als
    „mindestens“ da. Die Teilmessung aus dem Strom zu sichern
    (`currentMessage.usage`), wäre der nächste Schritt.
  - **Was ein Fragenlauf über die API dauert und kostet, ist ungemessen** —
    die 130 Sekunden und 0,59 $ stammen aus dem Käfig des Postboten
    (12.9.2026).
  - **Mit dem Vollbild können zwölf Seiten die Grenze einer Anfrage
    reißen** (je Seite bis 3 MB); das Blatt endete dann als „nichts“. Eine
    Sperre davor gibt es nicht, solange das Vollbild ohnehin aus ist.
- **Was ein Vorschlag vom Agenten am Blatt ändern würde, steht nur beim
  Übernehmen.** Der Korb zeigt, dass einer da ist, und wer wissen will, was
  drinsteht, tippt ihn an. Bei einem Vorschlag von Hand war das richtig — man
  hatte ihn selbst geschrieben. Bei einem vom Agenten wäre eine Zeile in der
  Liste womöglich mehr wert.
- **Die Oberstufe bringt zwei Änderungen auf einmal.** In der 11. gibt es Punkte
  0–15 statt Noten 1–6, und spätestens dann braucht die App Halbjahre: heute
  liegen alle Noten in einem Topf, und eine Themenliste über zwei Schuljahre
  wird ohne Zeitraum unbrauchbar. Beides gehört zusammen angefasst, nicht
  einzeln. Bis dahin gilt die Skala 1–6, und die ist für die 10. richtig.
- Zeugnisnote je Fach von Hand überschreiben (die Lehrkraft rundet anders als
  die Rechnung)
- Offline **schreiben** (Hausaufgabe im Schulnetz ohne Empfang eintragen) —
  bewusst später, erst wird offline nur gelesen
- Die Ablage lässt sich offline nicht **durchsehen**: der Service Worker lässt
  `/api/material/…` unangetastet, weil ein Bildcache anders altert als eine
  Seite und weil ein Schulblatt nicht versehentlich liegenbleiben soll. Ein
  Blatt, das man schon einmal geöffnet hat, erscheint offline trotzdem — es
  liegt dann im gewöhnlichen Cache des Browsers, in den `private, max-age=1
  Jahr, immutable` es gelegt hat. Verlassen kann man sich darauf nicht: was
  noch nie offen war, bleibt leer, und wann der Browser diesen Cache räumt,
  entscheidet er allein. Wer die Blätter im Bus ohne Empfang durchsehen will,
  braucht dafür eine eigene Entscheidung — welche Blätter, wie lange, und wann
  sie wieder gehen
- Erinnerung an fällige Hausaufgaben — kommt mit verbundenem Google Kalender
  als Erinnerung am Vortag zur Erinnerungsstunde; ohne Verbindung und per Push
  weiterhin nicht
- Vertretung und Ausfall einer einzelnen Stunde — der Wochenplan ist fest,
  eine Ausnahme für einen Tag kennt er nicht
- Freie Tage vom Lernplan ausnehmen (Wochenende, Urlaub) — im Datenmodell
  vorgesehen, in der Oberfläche noch nicht angeboten
