# Der Postbote

Sieht alle paar Minuten in den Eingangskorb der Schulapp und setzt Claude auf
jedes Blatt an, das noch keinen Vorschlag hat. Vom Foto bis zum Vorschlag ohne
einen Handgriff.

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

## Laufen lassen

```bash
npx tsx harness/postbote.mts               # läuft, bis du Strg-C drückst
npx tsx harness/postbote.mts --einmal      # eine Runde, dann Schluss
npx tsx harness/postbote.mts --blatt <id>  # genau dieses Blatt, auch wenn es schon dran war
npx tsx harness/postbote.mts --intervall 300
npx tsx harness/postbote.mts --modell sonnet
```

So sieht eine Runde aus:

```
16:14:52  Postbote wach. https://schulapp-teal.vercel.app/api/mcp
16:14:54  1 Blatt/Blätter zu bearbeiten.
16:14:54  → e8545329 „Blatt vom 25.8." (Geografie)
16:15:30     Vorschlag liegt im Korb: Vulkanismus (35 s, entspricht 0.33 $)
16:15:30     dazu: Thema „Vulkanismus" ist im Geografie-Vokabular neu
```

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
zählt **genau elf** auf — alle aus dieser App. Nach Bash gefragt: „KEIN-BASH".

Der Unterschied ist wichtig: **ohne `--tools ""` führt derselbe Lauf `echo`
aus**, obwohl Bash nicht in der Erlaubnisliste steht. `--allowedTools` ist eine
Regel über Erlaubnis, und die Einstellungen des Rechners können sie weiten.
Wegnehmen schlägt Verbieten.

Dazu: Der Lauf arbeitet in einem leeren, frisch angelegten Verzeichnis, das
danach gelöscht wird. Und er darf von den elf Werkzeugen nur fünf — vier zum
Lesen (`read_sheet`, `read_page`, `read_subjects`, `read_topics`) und
`propose_sheet`. Sonst nichts.

## Das Fach ist seine Aufgabe

Wer fotografiert, soll sich nicht um das Fach kümmern müssen. Die App belegt es
vor — mit der Stunde, die gerade läuft, sonst mit dem Fach des zuletzt
fotografierten Blattes —, und das ist eine Vermutung und keine Entscheidung.
Entschieden wird sie hier: der Lauf liest das Blatt, liest mit `read_subjects`
die vorhandenen Fächer und schlägt vor, wohin es gehört.

Gemessen am 25.8.2026, mit drei Blättern, die absichtlich im falschen Fach
lagen:

| Blatt | eingetragen | vorgeschlagen |
|---|---|---|
| englische Buchzusammenfassung | Mathematik | **Englisch** |
| französische Vokabelliste | Mathematik | **Französisch** |

`read_subjects` ist dabei nicht optional. Ohne dieses Werkzeug war die ganze
Fachzuordnung eine Fassade: der Lauf konnte ein Fach vorschlagen, kannte aber
die Fächer nicht, die es gibt — und `propose_sheet` trifft eine Schreibweise
nur, wenn sie auf Name oder Kürzel eines vorhandenen Fachs passt. „Erdkunde"
für ein Fach namens „Geografie" wäre still nichts geworden.

Erkennt er das Fach nicht — eine Seite Handschrift ohne Überschrift, eine
Tabelle ohne ein einziges Fachwort —, lässt er es stehen und schreibt in die
Notiz, dass er es nicht bestimmen konnte. Ein geratenes Fach ist schlimmer als
ein offen gelassenes: das Blatt liegt danach dort, wo es niemand sucht.

## Nur einer auf einmal

Zwei Postboten auf derselben `zugang.json` beenden einander. Das
Erneuerungs-Token wird bei jedem Gebrauch getauscht; der eine holt sich ein
frisches, der andere legt das alte vor — und das ist genau das Muster, auf das
die App wartet. Sie kann „mein zweites Ich" nicht von „jemand hat das Token"
unterscheiden und lehnt ab.

Deshalb legt der Postbote beim Start `lauf.lock` an. Läuft dort noch ein
Prozess, startet der zweite gar nicht erst und sagt, welche Nummer zu beenden
wäre. Nach einem Absturz steht in der Datei eine Nummer, unter der niemand mehr
läuft — dann gilt sie nicht und wird weggeräumt.

## Was er nicht tut

**Er schreibt nichts in den Bestand.** Er legt Vorschläge an; übernehmen kannst
nur du, im Formular, wie immer. Das ist dieselbe Regel wie für jeden Agenten an
dieser App, und der Postbote ist keine Ausnahme davon, sondern ihr erster
Anwendungsfall.

**Er stupst nichts an und wird nicht angestupst.** Die App ruft ihn nicht —
sie läuft in der Cloud, dein Rechner steht hinter deinem Router, und eine
ausgehende Verbindung nach draußen hat sie bewusst nicht. Der Korb ist die
Warteschlange: ein Blatt ohne Vorschlag ist die offene Aufgabe.

**Er wiederholt sich nicht.** Welche Blätter schon einen Lauf hatten, steht in
`gesehen.json`. Ohne diese Liste käme ein verworfener Vorschlag beim nächsten
Durchgang wieder.

## Was es kostet

Nichts an Geld — es läuft über dein Claude-Abo, nicht über einen API-Schlüssel.
Ein `ANTHROPIC_API_KEY` in der Umgebung wird beim Start ausdrücklich entfernt,
damit nicht versehentlich doch abgerechnet wird.

Es kostet Kontingent: ein Blatt entspricht rund 0,30 $, wenn man denselben Lauf
über die API bezahlt hätte. `--modell sonnet` drückt das deutlich.

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

## Wenn etwas klemmt

| Was dasteht | Was es heißt |
|---|---|
| `Kein Zugang unter …` | `npx tsx harness/zugang.mts` läuft noch nicht |
| `Die Verbindung gilt nicht mehr` | getrennt, abgelaufen oder ein Token doppelt benutzt — neu zustimmen |
| `Kontingent erschöpft (429)` | das Abo ist für den Moment leer; er versucht es später wieder |
| `Port 41751 ist belegt` | dort lauscht etwas anderes; die Rückadresse ist angemeldet und lässt sich nicht ausweichen |
| `Es läuft schon ein Postbote` | genau das — die Nummer steht daneben, `kill` sie oder lass den anderen laufen |
| `Der Lauf wollte etwas, das er nicht darf` | der Käfig hat zugeschlagen — steht auf dem Blatt eine Anweisung? |
