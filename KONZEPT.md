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

## Technik

- **Next.js (App Router) + TypeScript + Tailwind**
- **PWA** — installierbar auf dem Homescreen, offline lesbar
- **Postgres** als Datenbank, Zugriff über eine typsichere Schicht (Drizzle)
- **Vercel** als Hosting, Deploy per Git-Push
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
             Herkunft (von Hand | vom Agenten)
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

Ein Vorschlag trägt seine **Herkunft** — von Hand oder von einem Agenten. Das
ist keine Statistik. Ein Vorschlag vom Agenten ist aus dem Inhalt eines Blattes
abgeleitet, also aus etwas, das die App nicht geschrieben hat; er wird deshalb
als solcher angeschrieben, bevor man ihn bestätigt.

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

Nicht in die App hinein, sondern außen herum. Die App ist ohne sie vollständig:
fotografieren, zuordnen, wiederfinden, Vorschlag von Hand anlegen, bestätigen.

Der Agent läuft in Claude und ruft die App — nicht umgekehrt. Ein MCP-Server
ruft nie ein Modell auf, er wird gerufen; deshalb kostet dieser Weg kein
API-Guthaben, sondern läuft über das Abo. Die Tools sitzen dabei **neben** den
Server Actions auf derselben `src/lib` und nicht darüber: eine Server Action
endet mit `redirect()`, und das wirft intern — ein Tool bekäme nie ein Ergebnis.

**Angestoßen wird der Agent von Hand, in der Claude-App.** Das ist entschieden,
und zwar aus drei Gründen, von denen keiner der Preis ist. Ein Blatt kostet als
Bild rund 1 900 Tokens — so viel wiegt die Lesefassung mit 1000 Pixeln, die der
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
nachgetippt werden.

Drittens stimmt „sicherheitsseitig sind alle Wege gleich" nur für die
Schreibrichtung. Dort gilt er ohne Abstriche: kein Vorschlag kommt ohne
Bestätigung in den Bestand, egal wer ihn geschrieben hat. Für die Leserichtung
gilt er nicht. Fragt die App selbst ein Modell, bekommt sie einen Schlüssel,
der Geld ausgeben kann, und eine ausgehende Verbindung zu einem Dritten — und
sie wird selbst zu der Stelle, die ein nicht vertrauenswürdiges Blatt einem
Modell vorlegt. In der Claude-App ist der Schadensradius einer verunglückten
Anweisung auf einem Blatt ein Chatverlauf.

Seit dem 24.8.2026 ist dieser Weg gebaut und gelaufen: die Anmeldung eines
Programms, die Zustimmung, der Tausch, elf Werkzeuge, ein Blatt als Bild und
ein Vorschlag im Korb — alles gegen die echte Adresse geprüft. Was der zweite
Grund verlangt, steht damit offen: fünf Blätter durchschicken und hinsehen.

**Der andere Weg bleibt offen, und offen halten ihn genau zwei Zeilen.** Sollte
sich der Handgriff als lästig erweisen, kommt ein Knopf an den Eingangskorb,
der denselben Vorschlag von der App aus holt. Dafür muss sich am Korb nichts
ändern: ein Vorschlag trägt seine Herkunft (`manuell` oder `agent`), und ein
solcher Knopf wäre bloß ein weiterer Schreiber auf dieselbe Tabelle. Was
ausdrücklich nicht kommt, ist der Aufruf nach jeder Aufnahme: er feuert im
Unterricht, auf einer Verbindung, die es im Schulnetz oft nicht gibt, und
bräuchte dafür eine Warteschlange und einen Fehlerzustand je Blatt — während
ein Knopf den zweiten Versuch geschenkt bekommt.

Zwei Regeln stehen darüber:

**Alles, was die KI kann, muss ich auch können.** Jede Fähigkeit des Agenten
braucht einen Weg in der Oberfläche. Umgekehrt gilt es nicht — der Agent bekommt
nur `read_*` und `propose_*`, kein Anlegen, kein Ändern, kein Löschen.

**Der Agent schreibt nie in den Bestand.** Er legt Vorschläge an; erst ein
Mensch übernimmt sie, durch dieselbe Tür wie ein Formular. Das ist keine
Vorsichtsmaßnahme, sondern die Bedingung: Wer nicht vertrauenswürdige Blätter
liest und gleichzeitig schreiben darf, ist angreifbar über das Blatt selbst.
Aus demselben Grund gehören Zettel nie in eine Claude-Code-Sitzung, sondern in
die Claude-App — dort steht kein Bash und kein Zugriff auf das Repo daneben.

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

Elf Werkzeuge, zehn davon lesen: Fächer, Themen, Stundenplan, Hausaufgaben,
Klausuren samt Lernplan, Noten, die Ablage, ein Blatt, das Foto einer Seite,
der Eingangskorb. Das elfte legt einen Vorschlag an. Kein Anlegen, kein
Ändern, kein Löschen — und ausdrücklich auch kein Übernehmen eines Vorschlags.

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
das war der Punkt.

## Offene Punkte

- Fächerliste (kommt beim ersten Einrichten in der App)
- **Ob die Erkennung bei Formeln taugt, ist noch nicht gemessen.** Für
  Fließtext ist es das: ein abfotografierter Aufsatz kam am 23.8.2026 wörtlich
  richtig zurück, mit einem einzigen als unsicher markierten Wort — und die
  Vermutung stimmte. Mathematik ist ein anderes Problem und wird das Fach mit
  den meisten Blättern: Brüche, Indizes, Exponenten, beschriftete Skizzen. Der
  Weg dorthin kostet jetzt gar nichts mehr — ein Mathe-Blatt aufnehmen und den
  Agenten `read_page` rufen lassen. Erst danach lässt sich sagen, ob ein Knopf
  „Vorschläge holen" an der App überhaupt lohnt (siehe oben): bei schlechter
  Erkennung wird ohnehin jeder Vorschlag nachgetippt, und dann füllt ein
  automatischer Aufruf den Korb mit Arbeit, statt sie abzunehmen.
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
- Erinnerung an fällige Hausaufgaben per Push — der Lernplan hat sie schon,
  die Aufgaben noch nicht
- Vertretung und Ausfall einer einzelnen Stunde — der Wochenplan ist fest,
  eine Ausnahme für einen Tag kennt er nicht
- Freie Tage vom Lernplan ausnehmen (Wochenende, Urlaub) — im Datenmodell
  vorgesehen, in der Oberfläche noch nicht angeboten
