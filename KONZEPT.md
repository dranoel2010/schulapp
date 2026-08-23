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
Fach ─── Blatt ──┬── Seite    Reihenfolge, Maße, Vollbild, Vorschau
                 └── Thema    Verweis ins Vokabular des Fachs
```

**Die Fotos liegen in der Datenbank**, als `bytea` neben allen anderen Daten.
Ein Ort statt zweier: die Sicherung deckt sie mit ab, es braucht keinen zweiten
Dienst und kein zweites Token, und lokal wie in der Cloud läuft derselbe Code.
Das passt zu dem, was die App über sich behauptet — alle Daten liegen auf dem
eigenen Server.

Damit das trägt, wird **schon im Browser verkleinert**: lange Kante 1600 Pixel
als JPEG, dazu eine Vorschau mit 320 Pixeln. Ein Blatt wiegt danach rund 250 KB
statt mehrerer Megabyte, ein Schuljahr also grob 50 bis 120 MB. Der Server
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

**Aufgenommen wird am Handy links.** Die Startseite hat dort drei wischbare
Seiten: Kamera, Kachelmenü, Tagesspur. Der Weg zum Auslöser ist die
Wischrichtung, in der nicht der Tagesablauf steht. Vorgeschlagen wird das Fach
der Stunde, die gerade läuft — aber nur, wenn es die App wirklich weiß und das
Fach nicht abgewählt ist. Ein falsch vorbelegtes Fach rutscht unbemerkt durch,
und ein Blatt im falschen Fach findet später niemand wieder.

## Der Eingangskorb

Ein **Vorschlag** ist kein Datensatz der App, sondern die Frage, ob einer
entstehen soll. Er liegt im Korb, bis ein Mensch ihn übernimmt oder verwirft.

```
Blatt ─── Vorschlag    Art, Herkunft, Zustand, Inhalt, Begründung
```

**Jeder Vorschlag hängt an einem Blatt**, und zwar zwingend. Das ist die
Aussage dieser Stufe und keine Sparsamkeit beim Fremdschlüssel: aus den
Blättern wird Lernstoff, und was vorgeschlagen wird, stand auf Papier, das der
Nutzer selbst fotografiert hat. Wer das Blatt löscht, ist die Vorschläge dazu
mit los.

Drei Arten, weil ein Blatt drei Dinge trägt: die **Themen**, um die es geht,
eine **Hausaufgabe**, die daraufsteht, und einen **Termin**, der angekündigt
ist. Der Inhalt liegt als `jsonb`, und hier ist eine Sammelspalte richtig: nach dem
Inhalt eines Vorschlags wird nie gefragt, er wird einmal als Ganzes gelesen,
und seine Form hängt an der Art. Geprüft wird er zweimal, beim Anlegen und beim
Lesen.

**Übernommen wird durch dieselbe Tür wie ein Formular.** Unter einem
Aufgaben-Vorschlag steht wörtlich das Formular von „Neue Aufgabe“, unter einem
Termin das von „Neue Klausur“ samt Vorlauf, Tagesbudget und Lernplan, unter
Themen derselbe Griff wie auf der Seite des Blattes. Der Vorschlag füllt Felder
vor, mehr tut er nicht — geprüft und geschrieben wird mit denselben Schemata,
die auch für die Eingabe von Hand gelten.

**Derselbe Vorschlag steht kein zweites Mal im Korb.** Ein eindeutiger Index
über Art, Blatt und Inhalt gilt für die offenen Karten; ein Agent, der dasselbe
Blatt zweimal liest, füllt den Korb damit nicht. Verworfen oder übernommen
zählt der Abdruck nicht mehr — dann ist derselbe Vorschlag eine neue Frage an
einen Menschen, der schon einmal geantwortet hat.

Entschiedenes wird nie gelöscht, nur ruhig: vierzehn Tage bleibt es im Korb
stehen, dieselbe Frist wie bei den abgehakten Hausaufgaben.

## Wie die KI angeschlossen wird

Nicht in die App hinein, sondern außen herum. Die App ist ohne sie vollständig:
fotografieren, zuordnen, wiederfinden, Vorschlag von Hand anlegen, bestätigen.

Der Agent läuft in Claude und ruft die App — nicht umgekehrt. Ein MCP-Server
ruft nie ein Modell auf, er wird gerufen; deshalb kostet dieser Weg kein
API-Guthaben, sondern läuft über das Abo. Die Tools sitzen dabei **neben** den
Server Actions auf derselben `src/lib` und nicht darüber: eine Server Action
endet mit `redirect()`, und das wirft intern — ein Tool bekäme nie ein Ergebnis.

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

**Der Server spricht MCP selbst, ohne Paket.** Ein Werkzeug-Server ohne
Ressourcen, Prompts und Rückfragen braucht fünf Methoden, einen Umschlag und
eine Handvoll Kopfzeilen. Er bedient zwei Protokoll-Zeitalter nebeneinander:
die Revision `2026-07-28`, die den `initialize`-Handschlag und die Sitzung
abgeschafft hat, und die älteren, die ihn noch erwarten — ein Server, der nur
das Neue kann, ist für jeden noch nicht umgestellten Client tot.

**Die Anmeldung ist OAuth, und die App ist ihr eigener Autorisierungsserver.**
Das ist keine Vorliebe: die Claude-App verbindet sich aus Anthropics
Rechenzentrum heraus und bietet beim Anlegen eines Connectors nur die Adresse
und OAuth an — ein fester Token im Kopf lässt sich dort nicht eintragen. Übrig
blieben zwei Wege: ohne Anmeldung (also die Noten und Blätter eines Schülers
offen im Netz), oder OAuth. Die Zustimmung nimmt die Anmeldung, die es schon
gibt: wer nicht angemeldet ist, kommt auf die Anmeldeseite und danach zurück.
Kein zweiter Dienst, kein zweites Konto.

Es gibt genau einen Scope, weil es genau eine Sache gibt, die der Agent darf:
lesen und vorschlagen. Und dass er nicht schreiben kann, liegt nicht an diesem
Scope — es gibt schlicht kein Werkzeug dafür. Ein Scope, den man weglassen
kann, ist eine Einstellung; eine Fähigkeit, die es nicht gibt, ist eine Zusage.

## Offene Punkte

- Fächerliste (kommt beim ersten Einrichten in der App)
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
- **Der MCP-Server hat keine Bremse.** Die Spezifikation verlangt, dass ein
  Server seine Werkzeugaufrufe begrenzt; hier tut es keiner. Für einen Server
  mit genau einem Nutzer und einem Agenten ist das heute folgenlos, und die
  ehrliche Bremse wäre eine, die zählt — also eine Tabelle mehr. Sie kommt,
  sobald es einen Grund gibt, nicht vorher
- Ein Vorschlag lässt sich nur ganz übernehmen oder ganz verwerfen. „Von diesen
  fünf Themen die ersten drei“ geht über das Formular (Chips wegtippen), aber
  es bleibt danach ein übernommener Vorschlag und keine halbe Antwort. Ob das
  fehlt, zeigt sich erst im Gebrauch
- Der Agent sieht ein Blatt nur, wenn er danach fragt. Eine Benachrichtigung in
  die andere Richtung — „hier liegt ein neues Blatt“ — kennt MCP für Server
  ohne offenen Strom nicht, und einen offenen Strom will dieser Server nicht
  führen
