# Der Postbote

Sieht alle 15 Sekunden in den Eingangskorb der Schulapp und setzt Claude auf
jedes Blatt an, das noch keinen Vorschlag hat: er schreibt ab, was auf den
Seiten steht, und legt einen Vorschlag mit Titel, Tag und höchstens einem Thema
an. Fach und Themen entscheidet danach Jev in der App (seit dem 4.10.2026). Vom
Foto bis zum eingeordneten Blatt ohne einen Handgriff.

Welche Seiten Claude dabei bekommt, entscheidet seit dem 6.10.2026 die App:
sauberen Druck liest sie selbst mit Docling, Claude bekommt den Rest, nur als
Foto (siehe [Welche Seiten Claude bekommt](#welche-seiten-claude-bekommt)).

**Er gehört nicht zur App.** Die App weiß nichts von ihm, hat keinen Schlüssel
und ruft nie ein Modell. Der Postbote ist ein Programm auf deinem Rechner, das
sie von außen benutzt — durch dieselbe Tür wie die Claude-App: den Web MCP.

```
Foto  →  Eingangskorb  →  Postbote sieht nach  →  Claude im Käfig  →  Vorschlag
                                                                         ↓
                                                            du übernimmst ihn
```

## Einrichten

Einmal zustimmen. Es öffnet sich die Zustimmungsseite deiner App; dort steht,
wohin die Antwort geht (`127.0.0.1:41751` — dein eigener Rechner).

```bash
npx tsx harness/zugang.mts
```

Danach steht der Postbote in der App unter *Einstellungen → Verbundene
Programme*, neben Claude, mit eigenem **Trennen**-Knopf.

### Die Adresse hat sich geändert

Die App lief bis zum 30.8.2026 unter `https://schulapp-teal.vercel.app` und
läuft seitdem auf dem NAS unter `https://treskownas.tail3a40b0.ts.net`
(Tailscale Funnel).

Ein Zugang gilt für die Adresse, unter der zugestimmt wurde — sie steht als
`origin` und `resource` in `zugang.json`, und das Token ist für genau diese
`resource` ausgestellt. Umschreiben lässt sich das nicht: **ein Postbote gegen
die neue Adresse braucht eine neue Zustimmung.** Es ist eine andere App mit
einer anderen Datenbank; von der alten Zustimmung weiß sie nichts.

```bash
npx tsx harness/zugang.mts
```

Die Adresse muss seit dem 11.9.2026 nicht mehr mitgegeben werden: `VORGABE_ORIGIN`
in `zugang.mts` zeigt jetzt aufs NAS. Vorher stand dort die Vercel-Adresse, und
weil das Projekt dort inzwischen pausiert ist, endete ein Aufruf ohne Adresse in
einem 503 — einer Meldung, die nach einem kaputten Netz aussieht und keine war.

Auf diesem Rechner lag bis zum 11.9.2026 noch die alte `zugang.json` gegen
Vercel. Sie ist entfernt worden; das Token darin war für eine App ausgestellt,
die es unter dieser Adresse nicht mehr gibt. Der Postbote auf dem NAS hat seine
eigene und war davon nie betroffen.

## Laufen lassen

```bash
npx tsx harness/postbote.mts               # läuft, bis du Strg-C drückst
npx tsx harness/postbote.mts --einmal      # eine Runde, dann Schluss
npx tsx harness/postbote.mts --blatt <id>  # genau dieses Blatt, auch wenn es schon dran war
npx tsx harness/postbote.mts --intervall 300
npx tsx harness/postbote.mts --ruhe 60     # ein Blatt erst 60 s nach seiner letzten Seite
npx tsx harness/postbote.mts --modell sonnet
```

Ein Blatt ist erst dran, wenn seine letzte Seite 20 Sekunden alt ist
(`--ruhe`) — sonst liefe der Lauf los, bevor die Rückseite da ist. Gemessen
wird an `lastPageAt`, das die App mitliefert; `--blatt` wartet nicht, und
`--einmal` ohne `--ruhe` auch nicht (seit dem 4.10.2026): eine einzelne Runde,
die ein frisches Blatt nur ansieht und still endet, sähe aus wie „nichts zu
tun". Wartet ein Blatt doch, steht `1 Blatt/Blätter warten noch auf Ruhe.` da —
einmal, nicht in jeder Runde.

`--ruhe` und `--intervall` nehmen Sekunden, 0 oder mehr. Alles andere („20s",
eine fehlende Zahl) bricht den Start ab, bevor die Sperre genommen wird. Bis
zum 4.10.2026 wurde daraus still NaN, und der Dienst sah in den Korb, ohne je
etwas zu tun.

So sieht eine Runde aus (die Zahlen sind ein Beispiel):

```
16:14:52  Postbote wach. https://treskownas.tail3a40b0.ts.net/api/mcp
16:14:54  1 Blatt/Blätter zu bearbeiten.
16:14:54  → e8545329 „Blatt vom 25.8." (Mathematik)
16:16:39     eingeordnet: Geografie — Vulkanismus (105 s, entspricht 0.41 $)
16:16:39     Abschrift: 2 von 3 Seiten — 1 nicht zu lesen, bleibt offen
16:16:39     dazu: Seite 3 ist verwackelt
16:16:39     Züge 5, Ausgabe 3.120 Tok (davon Denken 410), Cache gelesen 88.000, API 61 s, Wand 105 s
```

„eingeordnet" heißt: Jev hat übernommen, Fach und Themen sind die des Blattes.
Steht dort „liegt im Korb", wartet der Vorschlag auf dich. Die letzte Zeile ist
die Messung je Lauf — API-Zeit gegen Wanduhr zeigt, wie viel davon Werkzeuge
und Start waren.

## Der Käfig

Ein abfotografiertes Blatt ist nicht vertrauenswürdig — darauf kann alles
stehen, auch eine Anweisung. Deshalb läuft Claude hier nicht wie sonst, sondern
mit drei Schaltern, die **Fähigkeiten wegnehmen statt sie zu verbieten**:

| Schalter | Wirkung |
|---|---|
| `--tools ""` | keine eingebauten Werkzeuge: kein Bash, keine Dateien, kein Netz |
| `--strict-mcp-config` | nur der mitgegebene Server — deine anderen Connectors sind draußen |
| `--mcp-config` | genau einer: die Schulapp, mit dem Token des Postboten |

Gemessen am 25.8.2026: Ein so gestarteter Lauf, nach seinen Werkzeugen gefragt,
zählte **genau elf** auf — alle aus dieser App. Nach Bash gefragt: „KEIN-BASH".
(Elf waren es an jenem Tag; seit dem 5.9.2026 sind es zwölf. Die Zahl steht hier
als die gemessene — was sie zeigt, ist nicht ihre Höhe, sondern dass nichts
Fremdes dabei war.)

Der Unterschied ist wichtig: **ohne `--tools ""` führt derselbe Lauf `echo`
aus**, obwohl Bash nicht in der Erlaubnisliste steht. `--allowedTools` ist eine
Regel über Erlaubnis, und die Einstellungen des Rechners können sie weiten.
Wegnehmen schlägt Verbieten.

Dazu: Der Lauf arbeitet in einem leeren, frisch angelegten Verzeichnis, das
danach gelöscht wird. Und er darf von allen Werkzeugen nur fünf: `read_sheet`,
`read_page`, `read_subjects`, `read_topics` und `propose_sheet`. Sonst nichts.
Der Auftrag braucht davon nur `read_page` und `propose_sheet`; die übrigen
bleiben erlaubt, weil ein verweigerter Aufruf den ganzen Lauf zu „nichts"
machte.

`read_docling` stand vom 4. bis zum 6.10.2026 auf der Liste, und mit ihm
`MCP_TOOL_TIMEOUT=200000` für `claude`, weil Docling im Lauf bis zu 180 s je
Seite rechnen durfte. Beides ist weg: die App fragt Docling jetzt selbst,
nach dem Hochladen, und kein Werkzeug wartet mehr darauf.

## Claude schreibt ab, Jev ordnet ein

Bis zum 4.10.2026 entschied der Lauf das Fach selbst, mit `read_subjects`. Seit
dem entscheidet Jev in der App über Fach und Themen, gleich nachdem der
Vorschlag angelegt ist — warum, steht im Kopf von `src/lib/auto-file.ts`. Der
Auftrag sagt deshalb ausdrücklich „Lass subject weg" und erlaubt höchstens ein
Thema, so wie es auf dem Blatt steht. Der Satz trägt Last: ein Fach, dessen
Schreibweise keines trifft, ließe `propose_sheet` scheitern — und mit ihm die
Abschrift.

Die Seiten-ids und den eingetragenen Tag gibt der Postbote mit. Er liest das
Blatt vor jedem Lauf selbst (`read_sheet`) und überspringt es, wenn es
inzwischen eingeordnet ist — auch bei `--blatt`.

## Welche Seiten Claude bekommt

Seit dem 6.10.2026 liest jede Seite genau **ein** Leser, und die App
entscheidet, welcher. Nach dem Hochladen schickt sie jede neue Seite einmal
durch Docling; ist das Ergebnis sauberer Druck (eine feste Regel, dann Jev),
wird es die Abschrift der Seite, gekennzeichnet als „maschinell gelesen
(Docling)". Alles andere — Handschrift, Formeln, ein Docling, das nicht
antwortet — liest Claude, vom Foto und ohne Vorlage. Bis dahin las jede Seite
zweimal: Docling rechnete sie für den Lauf vor, und Claude schrieb sie danach
trotzdem ab.

An jeder Seite steht in `read_sheet`, wer sie liest (`leser`):

| `leser` | heißt | der Postbote |
|---|---|---|
| `offen` | die App entscheidet noch (meist ein paar Sekunden) | lässt das **ganze Blatt** in dieser Runde liegen und merkt es sich **nicht** — in 15 Sekunden ist es wieder dran |
| `docling` | die App hat die Seite selbst gelesen | gibt sie dem Lauf nicht |
| `claude` | die Seite ist für Claude | gibt sie dem Lauf, wenn sie noch keine Abschrift hat |
| `null` | eine Seite von vor dem 6.10.2026 | wie bisher: dem Lauf, wenn sie keine Abschrift hat |

Liest Claude nur einen Teil eines Blattes, sagt der Auftrag das dazu („Die
übrigen Seiten dieses Blattes hat die App schon gelesen — schreib nur diese
ab"), und fehlt die erste Seite, lässt der Lauf den Titel weg — steht am Blatt
noch der Platzhalter, nimmt die App die erste Überschrift, die Docling auf der
ersten Seite gelesen hat. Kann Claude keine seiner Seiten lesen, legt er den
Vorschlag trotzdem an, nur mit einer Notiz, welche Seite es war — sonst läge das
Blatt ohne Vorschlag im Korb, obwohl die App die übrigen Seiten gelesen hat. Jev
ordnet dann mit den Docling-Abschriften ein, und die unlesbare Seite bekommt am
eingeordneten Blatt einen zweiten Versuch in der Nachlese. Bleibt für Claude
gar nichts, läuft nichts: `alle Seiten gelesen — kein Lauf, einordnen tut die
App.` Die App legt dann nach der Ruhe selbst einen Vorschlag an („von der App")
und lässt Jev einordnen — auch, wenn ein Mensch die letzte Claude-Seite eines
Blattes löscht.

Was trotzdem zu einer Seite der App hereinkommt — von einem älteren Postboten
oder aus einem Chat —, verwirft `propose_sheet` und nennt es in der Antwort
unter `verworfen`. Der Aufruf scheitert daran nicht: die übrigen Seiten bleiben
im Vorschlag. Eine App von vor dem 6.10.2026 kennt `leser` nicht; dann liest
Claude wie bisher jede Seite ohne Abschrift — nur bietet eine solche App noch
`read_docling` an, das der neue Käfig verbietet, und ein verweigerter Aufruf
macht den Lauf zu „nichts“. Zu einer alten App gehört deshalb der alte
Postbote; `nas.sh zurueck` gleicht ihn mit an.

## Die Abschrift

Seit dem 5.9.2026 schreibt der Lauf zusätzlich ab, was auf den Seiten steht —
wörtlich, Seite für Seite. Sie reist als `transcripts` im Vorschlag mit und
wird, wie alles andere daran, erst dann geschrieben, wenn der Vorschlag
übernommen wird — von Jev oder von dir.

Sie hängt an der **Seite** und nicht am Blatt, weil je Seite gelesen wird und an
ein Blatt bis zu zwölf Seiten passen. Je Seite ruft der Lauf `read_page` und
schreibt ab, was auf dem Foto steht, bevor die nächste drankommt.

Was der Auftrag dafür verlangt:

- **Abschreiben, nicht zusammenfassen.** Jede Zeile so, wie sie dasteht. Was
  eine Zusammenfassung weglässt, findet später niemand wieder.
- **Die Schreibweise des Schülers bleibt stehen**, auch die falsche, und die
  Groß-/Kleinschreibung auch. Wer korrigiert, macht aus dem Heft ein anderes
  Heft — und der Mensch sucht danach nach seiner eigenen Schreibweise.
- **Unsicheres kommt in ⟨spitze Klammern⟩.** `⟨Kettenregel⟩` heißt „so lese ich
  es, sicher bin ich nicht"; `⟨unleserlich⟩` heißt, dass da nichts zu erkennen
  war. Geraten wird nie ohne Klammern: eine Lücke sieht man, eine glatte
  Erfindung nicht.
- **Höchstens 8 000 Zeichen je Seite.** Ein Werkzeugergebnis endet in der
  Claude-App bei rund 150 000 Zeichen; zwölf Seiten mal 8 000 sind 96 000 und
  lassen Luft für den Rest.

### Leer ist nicht dasselbe wie fehlt

Auf diesem Unterschied steht die ganze Sache:

| Was ankommt | Was es heißt |
|---|---|
| ein leerer Text | gelesen, es stand nichts darauf — die leere Rückseite ist erledigt |
| die Seite fehlt ganz | diese Seite hat noch niemand gelesen — sie ist später wieder dran |

Deshalb **lässt der Lauf eine Seite, die er nicht lesen kann, weg**, statt sie
zu raten oder leer zu melden, und schreibt in die Notiz, welche es war.

Und deshalb ist eine unvollständige Abschrift **kein** Grund, den Vorschlag
ganz zu lassen. Die alte Regel „unscharfes Foto → kein Vorschlag" galt, solange
alles an einer Frage hing: in welches Fach gehört das Blatt? Die Abschrift hängt
dagegen an der Seite — elf gestochen scharfe Seiten wegzuwerfen, weil die
zwölfte verwackelt ist, wäre der schlechtere Handel. Das Foto wird von allein
nicht besser; die verwackelte Seite bleibt offen und ist nach einer neuen
Aufnahme wieder dran.

Nur wenn **keine einzige** Seite zu lesen ist, bleibt es beim alten Ergebnis:
kein Vorschlag.

### Was sie am Lauf ändert

| | bis 5.9.2026 | bis 4.10.2026 | bis 6.10.2026 | ab 6.10.2026 |
|---|---|---|---|---|
| Züge (`--max-turns`) | 20 | 40 | 52 | **40** |
| Frist | 3 Minuten | 15 Minuten | 5 Minuten + 4 je Seite, höchstens 45 | **max(15 Minuten, 5 + 1 je Seite)** |

Die Rechnung steht in `kaefig.mts` (`MAX_ZUEGE`, `fristFuer()`). Die Züge sind
für den ungünstigsten Fall gezählt — vier Aufrufe, zwölf `read_page` und zwölf
Züge zum Aufschreiben, dazu zwölf Luft —, denn wer mitten in der Abschrift aus
den Zügen läuft, liefert nichts ab. Vom 4. bis zum 6.10.2026 kam je Seite noch
`read_docling` dazu (52 Züge, vier Minuten je Seite); seit die App Docling
selbst fragt, gilt wieder die Rechnung von davor. Die Frist ist nie kürzer als
die Viertelstunde von vorher und wächst erst ab elf Seiten, gezählt werden nur
die Seiten, die Claude liest — siebzehn Minuten bei zwölf. Geschätzt; was ein
Lauf wirklich braucht, zeigt die Messzeile darunter. Nachlese von Hand und
Fragenlauf behalten die festen 15 Minuten.

## Ein zähes Blatt hält die Runde nicht auf

Nicht jedes „später" heißt dasselbe, und seit dem 5.9.2026 unterscheidet der
Postbote die beiden:

| Was passiert | Was er tut |
|---|---|
| Kontingent leer (429), API weg, `claude` startet nicht | **Runde abbrechen und pausieren** — das nächste Blatt liefe in dieselbe Wand |
| Die Frist ist abgelaufen | **dieses Blatt überspringen**, weiter mit dem nächsten |

Das Kontingent gehört dem Abo, die Frist gehört dem Blatt: dass dieses eine
zwölf volle Seiten hat, sagt über das nächste nichts. Mit fünfzehn Minuten
Frist hätte ein einziges zähes Blatt sonst jede Runde aufgehalten.

Die Pause beginnt bei 5 Minuten und verdoppelt sich bei jeder weiteren Absage
bis höchstens 30; ein Lauf, der wieder durchkommt, und jeder Neustart setzen
sie zurück. Sie lebt nur im laufenden Prozess und ist keine zweite
Warteschlange. Das ersetzt den Schutz, den bis zum 4.10.2026 die drei Blätter
je Runde boten: bei 15 Sekunden Takt ist der nächste Dreierpack sofort dran.

Gemerkt wird in beiden Fällen nichts — das Blatt ist beim nächsten Durchgang
wieder dran. Ein Blatt, das jedes Mal in die Frist läuft, kommt allerdings auch
jedes Mal wieder; es von Hand in `gesehen.json` einzutragen ist der Weg, es
loszuwerden (die bloße id genügt, der Postbote zieht sie selbst um).

Die nachgereichten Seiten hält es seit dem 4.10.2026 nicht mehr auf. Kam in
einer Runde kein Lauf aus dem Korb zu einem Ergebnis und gab es keine Pause,
liest der Postbote den Korb noch einmal und geht danach zur Nachlese — außer
ein frisches Blatt wartet noch auf seine Ruhe oder ist während der Läufe
hereingekommen: das geht vor.

## Nur einer auf einmal

Zwei Postboten auf derselben `zugang.json` beenden einander. Das
Erneuerungs-Token wird bei jedem Gebrauch getauscht; der eine holt sich ein
frisches, der andere legt das alte vor — und das ist genau das Muster, auf das
die App wartet. Sie kann „mein zweites Ich" nicht von „jemand hat das Token"
unterscheiden und lehnt ab.

Deshalb legt der erste, der startet, `lauf.lock` an — Postbote und Nachlese
teilen sich die Sperre, und weil sie damit eine Abmachung zwischen zweien ist,
steht sie in `sperre.mts` und nicht in einem von beiden. Läuft unter der
notierten Nummer noch ein Prozess, startet der zweite gar nicht erst und sagt,
welche Nummer zu beenden wäre. Nach einem Absturz steht dort eine Nummer, unter
der niemand mehr läuft — dann gilt sie nicht und wird weggeräumt.

Auf dem NAS läuft der Postbote als Dienst und hält die Sperre folglich immer.
Wer nachlesen will, hält ihn so lange an: `docker compose stop postbote`,
hinterher `start`. Und der Haken dabei: `docker stop` schickt SIGTERM, und Node
führt dabei keine `exit`-Handler mehr aus. Die Sperrdatei bleibt also liegen,
mit einer Nummer, die es im nächsten Container zufällig wieder geben kann — sie
gehört danach von Hand weg, sonst sperrt sie den nächsten Lauf grundlos aus.

## Was er nicht tut

**Er schreibt nichts in den Bestand.** Er legt Vorschläge an; übernommen werden
sie in der App — von Jev nach dessen Regel, sonst von dir im Formular. Das ist
dieselbe Regel wie für jeden Agenten an dieser App, und der Postbote ist keine
Ausnahme davon, sondern ihr erster Anwendungsfall.

**Er stupst nichts an und wird nicht angestupst.** Die App ruft ihn nicht — sie
kennt ihn gar nicht, und eine ausgehende Verbindung zu irgendeinem Dienst hat
sie bewusst nicht. Wo die beiden stehen, ist deshalb gleichgültig: die App
inzwischen auf dem NAS, der Postbote auf einem Rechner daneben oder auf dem
Raspberry. Der Korb ist die Warteschlange: ein Blatt ohne Vorschlag ist die
offene Aufgabe.

**Er wiederholt sich nicht.** Welche Blätter schon einen Lauf hatten, steht in
`gesehen.json`, als `korb:<Blatt>:<letzte Seite>` — hängst du ein besseres
Foto an, ist das Blatt mit dieser Seite ein neuer Fall und kommt wieder dran.
Dazu, als `nachlese:<Blatt>:<letzte Seite>`, welche nachgereichten Seiten.
Alte Einträge (nur die id) zieht der Postbote beim nächsten Blick in den Korb
von selbst um. Ohne diese Liste käme ein verworfener Vorschlag beim
nächsten Durchgang wieder.

## Nachgereichte Seiten

Seit Jev einordnet, liegt ein Blatt nur Sekunden im Korb. Kommt die Rückseite
danach („Seite hinzufügen" an einem eingeordneten Blatt), sähe der Korb sie nie.
Die App nennt solche Seiten deshalb an jedem Blatt beim Namen
(`unreadAttachedPageIds`, dazu die Zahl `unreadAttachedPages`): Seiten ohne
Abschrift an einem eingeordneten Blatt, und welche davon, sagt seit dem
6.10.2026 `leser`:

| `leser` | nachgereicht? |
|---|---|
| `claude` | immer — die App hat die Seite Claude gegeben |
| `offen`, `docling` | nie — die liest die App selbst |
| `null` (von vor dem 6.10.2026) | wie bis dahin: wenn sie nach dem Einordnen dazukam oder jünger ist als eine schon abgeschriebene Seite desselben Blattes |

Die letzte Zeile fängt bei alten Seiten die, die WÄHREND eines Laufs dazukam —
älter als das Einordnen, aber jünger als die Seiten, die der Lauf
abgeschrieben hat. Bei neuen Seiten braucht es diese Rechnung nicht mehr: die
App weiß, dass sie für Claude ist.

Steht am Blatt noch eine Seite auf `offen`, wartet auch die Nachlese — kein
Lauf, kein Eintrag in `gesehen.json`, wie im Korb. Gemerkt wird ein Blatt
unter dem Zeitpunkt seiner jüngsten Seite, und das wäre schon die offene: fiele
sie nach dem Lauf Claude zu, stünde sie unter einem gemerkten Schlüssel und
käme nie dran.

Ist im Korb nichts zu tun, schreibt der Postbote genau diese Seiten mit dem
Auftrag der Nachlese ab, höchstens drei Blätter je Runde. Der Auftrag nennt
die Seiten-ids und sagt ausdrücklich, dass jede andere ungelesene Seite liegen
bleibt (`nachleseAuftragFuer(id, nurSeiten)`). Einen Vorschlag, der nur
Abschriften noch ungelesener Seiten nennt, übernimmt die App sofort; alles
andere bleibt im Korb. Gezählt wird danach an genau diesen Seiten:

```
16:20:05  1 Blatt/Blätter mit nachgereichten Seiten.
16:20:05  → 3f0a91c2 „Kettenregel" (Mathematik) — 1 Seite nachgereicht und ungelesen
16:21:32     abgeschrieben und übernommen: 1 von 1 Seite (87 s, entspricht 0.22 $)
```

Gesucht wird mit `read_material {nachgereicht: true}` — die App filtert selbst,
vor ihrer Grenze von zweihundert Zeilen — und höchstens einmal je Minute
(`NACHLESE_SEKUNDEN`), nicht in jeder Runde. Eine App, die `nachgereicht` oder
`unreadAttachedPageIds` noch nicht kennt, bekommt keine Nachlese: ohne die
Liste schriebe der Auftrag jede ungelesene Seite ab.

Die fünfzehn Altblätter vom August bleiben liegen — ihre Seiten stehen auf
`null`, keine hat eine Abschrift, und alle sind älter als ihr Einordnen. Ob sie
abgeschrieben werden, entscheidest du mit `nachlese.mts`. Bekommt ein Altblatt
eine neue Seite, geht nur diese ihren Weg: die App liest sie selbst, oder sie
wird nachgereicht und abgeschrieben. Die alten Seiten zieht sie nicht mit.

## Die Nachlese

Der Postbote arbeitet aus dem Eingangskorb, und der Korb ist die Warteschlange:
ein Blatt, das du durchgesehen hast, ist für ihn erledigt. Das war richtig,
solange das Einordnen die ganze Arbeit war. Mit der Abschrift ist daraus eine
Lücke geworden — die Blätter von vorher sind eingeordnet, ohne dass je jemand
gelesen hätte, was auf ihnen steht, und sie kämen nie wieder an die Reihe. Fach-
PDF und Wiki-Übergabe zeigten für sie auf Dauer „noch niemand gelesen".

Dafür gibt es `nachlese.mts`:

```
npx tsx harness/nachlese.mts                    # zeigt nur, was anläge
npx tsx harness/nachlese.mts --blatt <id>       # genau dieses eine Blatt
npx tsx harness/nachlese.mts --alle             # alle, der Reihe nach
npx tsx harness/nachlese.mts --alle --anzahl 3  # höchstens drei
```

**Ohne Angabe tut sie nichts.** Fünfzehn Blätter sind fünfzehn Käfigläufe auf
demselben Kontingent, aus dem auch der Postbote lebt; ein Aufruf ohne Argumente
listet deshalb nur auf. Das ist die Umkehrung der Vorsicht beim Postboten — dort
ist Laufen der Normalfall — und sie steht hier, weil eine Nachlese nichts
verpasst, wenn sie eine Stunde später startet.

**Sie ist kein zweiter Postbote.** Kein Dienst, keine Schleife, kein Gedächtnis:
sie läuft, wenn du sie startest, und ist danach fertig. Ihr Gedächtnis ist die
Datenbank — eine Seite mit `transcriptChars: null` IST die offene Aufgabe, so
wie beim Postboten das Blatt ohne Vorschlag. Auch den Käfig teilt sie mit ihm,
mitsamt Erlaubnisliste, Frist und Kontingent; einzig der Auftrag ist ein
anderer.

**Ihr Auftrag nennt genau ein Feld: `transcripts`.** Das Blatt ist ja schon
eingeordnet, und ein Vorschlag ersetzt beim Übernehmen, was er nennt. Ein
besserer Titel oder eine hilfreichere Notiz wäre deshalb kein Beitrag, sondern
ein stiller Tausch gegen deine eigene Arbeit — am wenigsten auffällig
ausgerechnet bei der Notiz, und die gibt niemand wieder her. Seiten, die schon
eine Abschrift haben, lässt sie aus demselben Grund weg: eine bestätigte
Abschrift durch eine ungeprüfte zu ersetzen wäre kein Fortschritt.

Nach jedem Lauf liest sie den eigenen Vorschlag zurück und sagt, ob er das
Schweigen gehalten hat. Die Prosa im Auftrag ist eine Bitte; erst diese Zeile
ist eine Messung.

Seit dem 4.10.2026 übernimmt die App einen Vorschlag, der nichts als
Abschriften ungelesener Seiten nennt, sofort — bei `--alle` landen die
Abschriften also ohne Gegenüberstellung am Blatt. Die Nachlese meldet dann
„von der App übernommen" und zählt die Seiten nach.

## Der Fragenlauf

Der Postbote und die Nachlese arbeiten an Blättern. Der Fragenlauf arbeitet an
**Klausuren** — und er ist der Weg, den du vorgegeben hast: eine Prüfung
eintragen, Themen daran hängen, und der Lernstoff entsteht aus den Themen.

```
npx tsx harness/fragen.mts                 # alle Prüfungen, die dran sind
npx tsx harness/fragen.mts --trocken       # nur zeigen, was er täte
npx tsx harness/fragen.mts --klausur <id>  # genau diese, auch wenn sie nicht dran wäre
npx tsx harness/fragen.mts --modell sonnet
```

**Die Kette ist die des Datenmodells, nicht eine neue:**

```
exams → exam_topics.subject_topic_id → subject_topics ← material_topics
      → materials → material_pages.transcript
```

Die Klausur sagt, WAS geprüft wird; ihre Themen sind der Schlüssel; darüber
hängen genau die Blätter, die dazugehören. Kein Blatt wird ausgewählt.

**Er entscheidet VOR dem Lauf, ob sich einer lohnt** — und zwar mit zwei Zahlen,
die `read_exam_material` selbst liefert (`stock`). Er startet kein Modell, wenn

- noch unentschiedene Fragen im Eingang liegen (dann ist der Mensch am Zug),
- die Klausur noch keine Themen hat (dann fehlt der Schlüssel zum Stoff),
- zu den Themen keine abgeschriebene Seite gehört (dann ist nichts zu binden —
  und meist steckt ein Thema im falschen Fach),
- der Mensch die Fragen zu dieser Klausur schon abgelehnt hat und keine einzige
  übernommen ist (aus demselben Stoff käme dasselbe heraus),
- die Klausur ihr Ziel an Bausteinen erreicht hat (`ZIEL_JE_KLAUSUR`, 24).

Das ist dieselbe Rolle, die beim Postboten der Blick in den Korb spielt: Es
kostet keinen Token und beantwortet die Frage, ob es etwas zu tun gibt.

**Er hat kein Gedächtnis, und braucht keines.** Der Postbote muss sich merken,
welche Blätter dran waren (`gesehen.json`); hier gibt die App die Auskunft
selbst. Nichts kann zwischen Dienst und App auseinanderlaufen, und nach Wochen
Stillstand ist nichts aufzuräumen.

**Sein Käfig ist derselbe, seine Erlaubnisliste nicht.** Er darf genau zwei
Werkzeuge rufen: `read_exam_material` und `propose_questions`. Kein
`read_page`, kein `read_material`, kein `propose_sheet` — ein Weg zu Blättern
außerhalb dieser Klausur ist kein fehlendes Werkzeug, sondern die Absicht.
Umgekehrt kennt die Liste des Postboten die beiden neuen nicht.

**Was im Korb landet, ist ein Vorschlag und nichts sonst.** Beim Übernehmen
geht jede Frage durch dieselbe Prüfung wie eine von Hand angelegte, und die
härteste ist das Zitat: Es muss wörtlich in der Abschrift stehen. Eine
nacherzählte Stelle fällt durch — sichtbar, mit Grund im Protokoll, denn die
Zahl dieser Abweisungen ist das einzige Maß dafür, wie zuverlässig der Lauf
arbeitet.

**Die 24 sind eine Schätzung und gehören dir.** Ein Baustein bekommt bei vier
Wochen Vorlauf 13 bis 16 Termine; für einen Abend sind sechs bis acht Fragen
vorgesehen. Bei 24 Bausteinen ist die Spitzenwoche damit schon überfüllt — mehr
Fragen machen die Abende nicht besser, sondern unerfüllbar. Die Zahl steht in
`fragen.mts` bei `ZIEL_JE_KLAUSUR`.

## Was es kostet

Nichts an Geld — es läuft über dein Claude-Abo, nicht über einen API-Schlüssel.
Ein `ANTHROPIC_API_KEY` in der Umgebung wird beim Start ausdrücklich entfernt,
damit nicht versehentlich doch abgerechnet wird.

Es kostet Kontingent: ein einseitiges Blatt entspricht rund 0,30 $, wenn man
denselben Lauf über die API bezahlt hätte. `--modell sonnet` drückt das
deutlich.

Die Abschrift macht es teurer, und zwar an der teuren Stelle: sie ist Ausgabe,
und Ausgabe wiegt schwerer als Eingabe. Ein Blatt mit zwölf vollen Seiten ist
der Fall, an dem man es merkt — bis zu 96 000 Zeichen, die geschrieben werden
wollen. Was ein Blatt wirklich gekostet hat, steht am Ende seiner Zeile.

## Zwei Dateien, die nicht in Git gehören

- `zugang.json` — darin steht das Erneuerungs-Token. Es ist **neunzig Tage lang
  der Schlüssel zu allem, was die App über die Schule weiß**, liegt mit 0600 da
  und wird bei jedem Gebrauch getauscht. Weg heißt: neu zustimmen.
- `gesehen.json` — die Merkliste. Kein Geheimnis, gilt aber nur für dieses
  Gerät.

Beide stehen in `.gitignore`.

## Auf den Raspberry umziehen

Schritt für Schritt in **[RASPBERRY.md](RASPBERRY.md)** — mit dem Teil, der
nicht offensichtlich ist: wie die Zustimmung auf einen Rechner ohne Bildschirm
kommt (SSH-Weiterleitung für Port 41751).

Kurz: Der Postbote braucht Node, ein angemeldetes Claude Code und diesen Ordner
— **sonst nichts**, keine npm-Abhängigkeit und nicht das Repo drumherum.
`zugang.json` bleibt zu Hause; der Pi bekommt eine eigene Zustimmung, sonst
nehmen sich beide das Token weg. Und es läuft immer nur einer, sonst liegen zwei
Vorschläge am selben Blatt.

## Der Handgriff nach jedem Commit

Genau das „sonst nichts" hat einen Preis: Wo der Postbote läuft, liegt eine
**Kopie dieses Ordners und kein Klon**. Auf dem NAS ist das
`/volume1/docker/postbote/harness/`, und `git pull` im Repo daneben rührt sie
nicht an.

Das war schon einmal die Fehlerursache, und es war eine teure: Anfang September
lief der Postbote sieben Tage mit Code vom 29.8. und scheiterte in fast jeder
Runde mit „fetch failed". Gesucht wurde tagelang beim Zugang — dort, wo der
Fehler nie war.

Seit dem 6.10.2026 gleicht `nas.sh hoch` die Kopie selbst ab, nachdem die neue
App läuft, und `nas.sh zurueck` ebenso an den alten Stand: es vergleicht die
Prüfsummen von `*.mts` und `README.md`, sichert die alte Kopie
(`harness-alt-<Zeit>` daneben), kopiert nur diese Dateien — `zugang.json` und
`gesehen.json` werden nie kopiert oder überschrieben —, hält den Postboten
dafür an und startet ihn danach über `nas.sh postbote` neu, das die nach dem
Anhalten liegengebliebene `lauf.lock` wegräumt. Der Grund ist dieser Stand
selbst: App und Postbote müssen zusammen wechseln. Der alte Postbote verträgt
die neue App, liest aber jede Seite, auch die, die die App schon gelesen hat —
Kontingent für nichts. Der neue Postbote gegen die alte App ist schlimmer: die
bietet `read_docling` an, sein Käfig verbietet es, und ein verweigerter Aufruf
macht den ganzen Lauf zu „nichts“.

Der Abgleich hängt an der neuen `nas.sh`, und die Datenbank braucht für diesen
Stand vorher neue Spalten. Die Reihenfolge steht im README des Repos unter
„Ein Leser je Seite“ → „Auf das NAS bringen — dieser Stand“: erst die neue
`nas.sh` nach `~/nas.sh`, dann `hoch` (hält vor dem Bau an und nennt die
SQL-Zeile), dann `scripts/leser-tabellen.sql` einspielen, dann noch einmal
`hoch`. Nicht andersherum — eine alte `~/nas.sh` baut den neuen Stand, ohne
nach der Spalte zu sehen.

Nachprüfen geht weiter von Hand, und nach jedem Commit, der `harness/` berührt,
lohnt der Blick:

```bash
ssh nas 'cd /volume1/docker/schulapp/repo/harness && md5sum *.mts README.md | sort' > /tmp/repo.txt
ssh nas 'cd /volume1/docker/postbote/harness   && md5sum *.mts README.md | sort' > /tmp/nas.txt
diff /tmp/repo.txt /tmp/nas.txt && echo "gleich"
```

Die `README.md` steht in der Liste mit Absicht. Am 11.9.2026 stimmten alle
sieben `.mts` überein und nur sie war alt — die Fassung dort kannte die
Nachlese noch gar nicht. Eine Anleitung, die das halbe Werkzeug verschweigt,
fällt niemandem auf, solange man sie nicht liest.

## Wenn etwas klemmt

| Was dasteht | Was es heißt |
|---|---|
| `Kein Zugang unter …` | `npx tsx harness/zugang.mts` läuft noch nicht |
| `Die Verbindung gilt nicht mehr` | getrennt, abgelaufen oder ein Token doppelt benutzt — neu zustimmen |
| `Pause bis 14:35: Kontingent erschöpft (429)` | das Abo ist für den Moment leer; die Runde hört auf, gefragt wird erst wieder zur genannten Uhrzeit (5 Minuten, verdoppelt bis 30). Ein Neustart setzt die Pause zurück |
| `Pause bis …: …` mit anderem Grund | nicht das Blatt ist schuld, sondern der Dienst: API oder `claude` selbst |
| `Frist von N Minuten überschritten` | dieses Blatt war zu zäh — es wird übersprungen und ist nächste Runde wieder dran |
| `Diese Runde ging schief: …` | steht nur einmal da, solange derselbe Fehler bleibt; `Die Runde ging wieder durch.` sagt, wann er vorbei ist |
| `claude antwortete nicht in JSON` | meistens: nicht angemeldet oder eine andere Fassung von `claude` |
| `Abschrift: 2 von 3 Seiten` | eine Seite war nicht zu lesen; sie gilt weiter als ungelesen — neu abfotografieren |
| `--ruhe erwartet eine Zahl von Sekunden …` | Tippfehler beim Start (`20s`, Zahl vergessen); der Postbote ist gar nicht erst angelaufen |
| `2 Blatt/Blätter warten noch auf Ruhe.` | ihre letzte Seite ist jünger als `--ruhe`; sie sind dran, sobald nichts mehr nachkommt. Steht einmal da, nicht jede Runde |
| `1 Blatt/Blätter liest die App gerade selbst — kein Lauf: …` | an dem Blatt steht eine Seite auf `leser: offen` — die App fragt gerade Docling und Jev (an einer Formelseite bis zu drei Minuten). Gemerkt wird nichts; danach ist das Blatt dran. Steht dieselbe id länger als zehn Minuten da, im Log der App nach `Leser …: Zuteilung gescheitert` sehen — eine Seite, die nicht einmal für Claude festgehalten werden konnte (meist war die Datenbank weg), bekommt nach zehn Minuten von selbst einen neuen Versuch. Eilt es: die App neu starten (`docker compose restart app` im App-Ordner) oder die Notbremse ziehen (README, „Ein Leser je Seite“) |
| `alle Seiten gelesen — kein Lauf, einordnen tut die App.` | für Claude ist an diesem Blatt nichts übrig; die App legt selbst einen Vorschlag an. Liegt er danach im Korb, konnte Jev ihn nicht einordnen — dann bist du dran |
| `Nachgereichte Seiten bleiben liegen — read_material sagt: …` | die App kennt `nachgereicht` noch nicht — sie ist älter als der Postbote. App aktualisieren |
| `⚠ dazu ist 1 Seite gelesen, die nicht im Auftrag stand` | der Lauf hat eine Seite mit abgeschrieben, die er nicht anfassen sollte — und die App hat sie übernommen. Sieh nach, ob es ein Altblatt war |
| `Port 41751 ist belegt` | dort lauscht etwas anderes; die Rückadresse ist angemeldet und lässt sich nicht ausweichen |
| `Es läuft schon ein Postbote` | genau das — die Nummer steht daneben, `kill` sie oder lass den anderen laufen |
| `Der Lauf wollte etwas, das er nicht darf` | der Käfig hat zugeschlagen — steht auf dem Blatt eine Anweisung? |
| `Not logged in · Please run /login` | auf diesem Rechner ist `claude` selbst nicht angemeldet. Im Container: `docker compose run --rm -it postbote claude`, darin `/login` — die Anmeldung landet im eingehängten `claude-home` und überlebt Neustart und Neubau |
| `Die Nachlese kann nicht starten` | der Postbote hält die Sperre. Ihn anhalten — und eine nach `docker stop` liegengebliebene `lauf.lock` entfernen |
| `API Error: Output blocked by content filtering policy` | nicht die Frist und nicht das Kontingent: dieses Blatt kommt mit diesem Modell nie durch. Am 7.9.2026 dreimal gleich gemessen, an denselben zwei englischen Blättern — im Stapellauf und zwanzig Minuten später noch einmal einzeln. Einmal `--modell sonnet` versuchen; scheitert das auch, die Seite von Hand im Formular eintippen. Liegenlassen kostet in **jedem** künftigen Stapellauf wieder eine halbe Minute, denn die Nachlese hat keine Merkliste — ihr Gedächtnis ist die Datenbank, und dort steht das Blatt weiter als ungelesen |
