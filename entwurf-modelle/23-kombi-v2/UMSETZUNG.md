# Umsetzung von Modell 23 (Kombi V2) in der echten App

Stand: 12.10.2026, Branch `modell-23` (von `origin/main`). Dieser Plan ist verbindlich für den Bau. Er stützt sich auf fünf Bestandsaufnahmen (Prototyp-Ansichten, Prototyp-Design, App-Seiten, Datenschicht, Next.js-Doku) und auf die Vorlagen im Ordner.

Zweite Fassung, ebenfalls 12.10.2026: Eine Prüfung fand 39 Lücken. Sie sind eingearbeitet, vor allem in 2.4 (Vertrag zwischen Shell, Stapel und Router, ganz neu), 3.3–3.9, in den Abschnitten A–H, in 5 und in Frage 3, die neu gestellt ist.

Auftrag des Nutzers: **„ok baue es fertig, nutze genau dieses Design, weiche nicht ab.“**

**Vorlage, in dieser Rangfolge:**
1. `entwurf-modelle/23-kombi-v2/index.html` (4690 Zeilen: CSS Z. 12–840, Markup Z. 843–975, JS Z. 976–4687). Alle Zeilenangaben in diesem Plan beziehen sich auf diese Datei.
2. `23-kombi-v2/notiz.md` mit den Abschnitten „Abweichungen“ und „Vierte Prüfrunde“. Sie geht der Vorgabe vor.
3. `ZUSATZ-ARBEITSBLAETTER.md`.
4. `KOMBI-VORGABE-V2.md`, nur wo 1–3 schweigen. Die Abnahmekriterien V2 15 gelten mit den Änderungen aus `notiz.md`. Insbesondere gilt Kriterium 64 ohne Material Symbols.
5. Sollbilder: `23-kombi-v2/screens/` mit 305 Bildern (`ab-*`, `r3-*`, `r4-*`), hell und dunkel, 390×844 und 375×667.

---

## 1. Grundsätze

1. **Das Design ist exakt das des Prototyps.** Übernommen werden Pixelwerte, Farb-Tokens, Schriften, Gewichte, Radien, Abstände, Texte (Wortlaut, Groß- und Kleinschreibung, geschützte Leerzeichen), Kurven, Dauern und Versätze.
   - Das CSS aus Z. 12–840 wird **wörtlich** übernommen. Klassennamen bleiben gleich, damit jede Zeile des Prototyps eine Gegenstelle im Bau hat.
   - Die Animationen laufen wie im Prototyp über WAAPI und `requestAnimationFrame` (`moveTo`, `flip`, `SPRING`, `clip-path`-Wachsen). Sie werden **nicht** auf React `<ViewTransition>`, Framer oder Tailwind-Animationen umgebaut.
   - Abweichen darf der Bau nur dort, wo der Prototyp Daten erfindet (Abschnitt 15 des Ansichten-Berichts). Die Festwerte `KLAUSUREN[0]`, `'ma-qf'`, `F('ma')`, `'b7'` und `JEV` werden durch echte Daten ersetzt. Die Gestalt bleibt dabei gleich.
   - **Ausnahme Lernplan auf der Klausurseite.** Der Prototyp erfindet dort genau einen Block für heute (`planRows`, Z. 3009) und kennt deshalb weder vergangene noch versehentlich erledigte Blöcke, keine Warnung und keinen leeren Plan. Die echte App hat das alles (heute `/lernen`, `study-plan-view.tsx`). Der Bau ergänzt es in der Gestalt vorhandener Elemente: Planzeilen wie `.task`, Hinweise als `.p-sub`, Leerzustand mit `.textline`. Neue Elemente entstehen nicht (Einzelheiten in F).
   - **Fehler- und Ladezustände** kennt der Prototyp nur an wenigen Stellen („Hängt, wird erneut versucht“, „Abschrift fehlgeschlagen“, „Kein Zugriff auf die Kamera“). Wo die echte App warten oder scheitern kann, nimmt der Bau **nur** diese vorhandenen Gestalten (Toast, `.p-sub`, Statuszeile in `--ink-3`/`--error`). Die Regeln stehen in 2.4 und A.
2. **Keine Funktion der App geht verloren.** Jede heutige Route bleibt erreichbar, als Nachschlage-Seite oder als Unterseite im neuen Stil (Abschnitt 2). Das gilt auch für die API-Routen, die Crontab-Endpunkte, OAuth und Web-MCP, Push, Google Kalender, IServ, Ferien, Fach-PDF, Eingangskorb, Bausteine und „Fragen bauen lassen“.
3. **Der Takt der Wiederholung bleibt unverändert** (Entscheidung vom 15.9.2026).
   - `planeFaelligkeiten()`, `createItem()`, `neuPlanen()`, `versuchFesthalten()` und `urteilFesthalten()` bleiben, wie sie sind.
   - `done_at` wird weiterhin nur bei „Saß“ gesetzt. Einzige mögliche Ausnahme ist die Auswertung eines Arbeitsblatts, falls Frage 3 mit (a) beantwortet wird.
   - Themen werden nur gebündelt und nach den bestehenden `recall_schedule`-Terminen sortiert. „Wieder dran“ und „Nächstes Thema …“ lesen vorhandene Termine und rechnen nie neue aus.
4. **Zielgerät: Android, Chrome, als installierte Web-App (standalone)**, nachmittags zu Hause.
   - Geprüft wird auf 390×844 und 360×800, dazu die Sollbild-Größe 375×667.
   - Kriterien, die von iPhone oder Safari sprechen, gelten sinngemäß für Android.
   - Die Android-Zurück-Taste schließt immer die oberste Ebene: Sheet → Bestätigung → Lupe → Tisch → Kamera → Menü → Seite. Das entspricht der Escape-Reihenfolge des Prototyps (Z. 4620–4687).
5. **Hell und Dunkel richten sich nach dem System**, ohne Neuladen. Es gibt keinen Umschalter, die Einstellungen zeigen nur die feste Zeile „Hell und dunkel · wie am Handy“. `data-theme="light|dark"` überstimmt weiterhin (Kriterium 62), aber nur als Prüfschalter.
6. **Jede Tippfläche misst mindestens 44×44 px.** Das wird je Abschnitt gemessen.
7. **Keine Zahl ohne Datenquelle** (Kriterium 66). Jede Zahl kommt aus der Datenbank oder dem Tagesprotokoll.
8. **Lernblöcke haben keine Uhrzeit** (Memory „Lernblöcke ohne Uhrzeit“). Der Uhrstand eines laufenden Blocks (Restzeit, Pause) wird gespeichert, eine Startzeit wird nie als Tageszeit angezeigt oder geplant.
9. **Fachbegriffe bleiben englisch, wo sie es sind:** Parser, Interface, Token, Layer, Route Handler.
10. **Next.js 16.3.1 mit dem alten Caching-Modell.**
    - `force-dynamic` bleibt.
    - Kein `cacheComponents`, kein `"use cache"`, kein `middleware.ts` oder `proxy.ts`.
    - Request-APIs sind async.
    - Vor jedem Abschnitt die passende Seite unter `node_modules/next/dist/docs/01-app/` lesen.

---

## 2. Zuordnung: Prototyp → App

### 2.1 Architektur der Oberfläche

- **Shell.** `src/app/(app)/layout.tsx` rendert die Server-Daten der Sitzung und darin eine Client-Insel `<KombiShell>`. Sie enthält:
  - `#app` mit den Ebenen `home`, `flow` und `pages`;
  - die Zeile (Dock mit Menü);
  - Toast, Scrim, Sheet, Kamera, Tisch und `#druck`.

  `AppNav`, `MobileTopBar`, `PageBody` und die md-Seitenspalte entfallen. **Am Rechner keine Handyspalte (Antwort des Nutzers 12.10.2026, Frage 1: „nein“).** Ab 600px Breite gibt es keinen 1px-Rand und keine feste 390px-Spalte: Hintergrund `--bg` über das ganze Fenster, der Inhalt (Seiten, Ebenen, Tisch, Zeile) steht in einer zentrierten Spalte `max-width: 680px` mit derselben Gestaltung wie am Handy. Keine Seitenleiste, keine Desktop-Tabellen, keine eigenen Desktop-Bausteine. Seiten und Bausteine nie auf 390px festschreiben, immer fließend bauen.
- **Tageszeit-Ansichten** (`morgens`, `ablauf`, `ueberblick`, `frueh`) sind Zustand auf der Route `/` und keine eigenen Routen (V2 16.4). Tisch, Kamera und Ablaufschritte sind Ebenen in der Shell. Ohne `cacheComponents` würde eine Route beim Wechsel ihren Zustand verlieren.
- **Nachschlage-Seiten** (`PAGES`, Z. 3051–3202) sind ein **Client-Stapel in der Shell**. Damit bleibt die Ebene darunter sichtbar und rückt beim Öffnen auf −24 % mit Deckkraft .4.
  - Jede Seite hat zusätzlich eine echte URL. `openPage` schreibt sie per `history.pushState`, ein `popstate` (Android-Zurück) ruft `popPage` auf. Wie sich das mit dem Next-Router verträgt, regelt der Vertrag in 2.4.
  - Die Daten einer Seite holt der Stapel über einen Route Handler `GET /api/seite/[art]`. Er gibt serialisierbares JSON zurück, prüft `requireUser()` und ruft die Loader aus `src/lib/seiten/*.ts` auf. Laden, Fehler und Offline regelt 2.4.
  - Ein direkter Aufruf oder ein Neuladen der URL rendert die Route serverseitig mit demselben Loader und derselben Seitenkomponente. Die Seite liegt dann als einzige im Stapel über der Startseite, „Zurück“ führt nach `/`.
- **Formular-Unterseiten** (neu anlegen, bearbeiten, Themenpflege, Eingangskorb, Bausteine, Einstellungsabschnitte) bleiben echte Routen. Sie werden als oberste Ebene in denselben `.page`-Container gerendert und fahren wie `openPage` ein (2.4, Punkt 5).
  - Sie bekommen den Seitenrahmen `pageShell`: Zurück-Pfeil `.pback`, Titel `.p-title` 22/650, Untertitel `.p-sub` und die Zeilen `.lrow`, `.set-row`, `.rowBtn`.
  - Ihre Felder bekommen neue Formular-Bausteine im Stil des Prototyps: 17px, Linie `--line`, Radius 12, Höhe 52. Erreichbar sind sie aus den Nachschlage-Seiten.
  - Die Zeile bleibt auf allen Seiten außer Tisch und Kamera sichtbar, an derselben Stelle (Kriterium 52).

### 2.2 Tabelle

| Prototyp | Route / Ort in der App | Komponente (neu) | Bisherige Funktion, die erhalten bleibt |
|---|---|---|---|
| Ebene `home`: `morgens`, `ueberblick`, `frueh` (Z. 1902–2084) | `/` | `src/components/kombi/home/{morgens,ueberblick,datumszeile}.tsx` | Tageskalender `day-timeline` und Desktop-Dashboard entfallen. Ihre Inhalte stehen in Woche, Klausur und Noten. |
| Ebene `flow`: `s-blaetter`, `s-ha` (Z. 2086–2260) | `/` (Zustand) | `kombi/ablauf/{band,schritt-blaetter,schritt-ha,sheet-item}.tsx` | Die Aufnahme ersetzt `capture-pane` und `camera-pane`. `camera.ts` und `prepare-page.ts` werden weiter verwendet. |
| Zeile mit Menü (Z. 2262–2989) | in der Shell | `kombi/zeile/{zeile,menu,tokens,parser.ts,suche.ts}` | Ersetzt das Kachelmenü (`tile-grid`) und `/hausaufgaben/neu` als Hauptweg. Das Formular bleibt als Unterseite (siehe unten). |
| Kamera `#cam` (Z. 3368–3758) | in der Shell | `kombi/kamera/*` | Mehrseiten-Aufnahme, Dateiwahl („Aus Fotos“) |
| Tisch `#tisch` (Z. 3760–4350) | in der Shell | `kombi/tisch/{tisch,karte,stapel,themenende,lernblock-uhr}.tsx` | `/abruf/sitzung` (`session-view.tsx`) |
| Arbeitsblatt, Lupe, `#druck` (Z. 4352–4618) | in der Shell | `kombi/tisch/arbeitsblatt/*`, `kombi/a4/*` | neu |
| Sheet (Z. 3333–3366) | in der Shell | `kombi/sheet.tsx` | – |
| `woche` | `/stundenplan` | `kombi/seiten/woche.tsx` | Das Bearbeiten wandert auf Unterseiten: `/stundenplan/bearbeiten` (Raster aus `week-grid.tsx`), `/stundenplan/[tag]/[stunde]`, `/stundenplan/zeiten`, `/stundenplan/epoche`. Der Einstieg ist eine Zeile „Stundenplan bearbeiten“ am Ende der Woche-Seite und in den Einstellungen. Auf `/stundenplan/bearbeiten` steht zusätzlich die Zeile „Epoche wechseln“ → `/stundenplan/epoche`. |
| `hausaufgaben` | `/hausaufgaben` | `kombi/seiten/hausaufgaben.tsx` | `/hausaufgaben/[id]` wird zum Bearbeiten aus „Bearbeiten“ im Linkswisch geöffnet, wenn `details` gesetzt ist oder bearbeitet werden soll (siehe D). Kurztext ohne Details bearbeitet die Zeile (`startEdit`). `/hausaufgaben/neu` bleibt erreichbar (Zeile „Mit Details eintragen“ am Seitenende). Wie im Prototyp (Z. 3026–3048): „Erledigt“ zeigt nur Aufgaben, die in den letzten 2 Tagen erledigt wurden; ist „Für ⟨Tag⟩“ leer, steht dort wörtlich „Für ⟨Tag⟩ ist nichts offen.“ Ältere erledigte Aufgaben sind über die Suche der Zeile erreichbar. |
| `klausuren` | `/klausuren` | `kombi/seiten/klausuren.tsx` | Am Ende die Zeile „Klausur eintragen“ → `/klausuren/neu`. Vergangene Klausuren stehen **wie im Prototyp in derselben sortierten Liste**, ohne eigenen zugeklappten Abschnitt. |
| `klausur` | `/klausuren/[id]` | `kombi/seiten/klausur.tsx` | Lernplan mit Abhaken und Zurücknehmen, Fortschritt, Warnungen und Leerzustand (F, Ausnahme in 1.1). Unten „Bearbeiten“ → `/klausuren/[id]/bearbeiten`, das bisherige Formular mit Löschen. Dazu „Lernplan neu erstellen“ (`generatePlanAction`), darunter „Termine neu rechnen“ (`neuPlanenAction`, Erklärsatz siehe F) und „Stoff und Fragen“ → `/abruf/klausur?id=`. |
| `noten` | `/noten` | `kombi/seiten/noten.tsx` | Am Ende „Note eintragen“ → `/noten/neu`. Die Desktop-Tabelle entfällt. |
| `notenfach` | `/noten/fach/[id]` | `kombi/seiten/notenfach.tsx` | **„Note eintragen“ wird gebaut** → `/noten/neu?fach=`. Ein Tipp auf eine Notenzeile führt zu `/noten/[id]` (bearbeiten, löschen). Der Zielrechner steht als Zeile „Was brauche ich für …?“ → `/noten/fach/[id]/ziel`. |
| `blatt` | `/material/[id]` | `kombi/seiten/blatt.tsx` | Unten Zeilen für „Blatt bearbeiten“, „Seite dazu“ (Kamera mit `attach`), „Seite löschen“, „Abschreiben lassen“, „Wieder in den Eingangskorb“, „Blatt löschen“ (mit Bestätigung im Stil `.t-confirm` auf Papier) → `/material/[id]/bearbeiten` bzw. Actions. **„Blatt bearbeiten“** öffnet `/material/[id]/bearbeiten` mit **allen** bisherigen Feldern von `material-form.tsx` und `updateMaterialAction`: Fach, Titel, Datum (`capturedOn`), Notiz, Themen (`setMaterialTopics`) und je Seite das Abschrift-Feld (`transcriptsFromForm`). Abtippen ist ohne `ANTHROPIC_API_KEY` oder nach einem gescheiterten Lauf der einzige Weg zur Abschrift. Unter „Abschreiben lassen“ stehen als `.p-sub`: die Laufzeile (`laufAnzeige(letzter)`, während eines Laufs „Claude liest gerade …“), die Kostenzeile („Alle Läufe an diesem Blatt: ⟨kostenSatz⟩“) und, falls vorhanden, der Hinweis auf den Vorschlag im Korb. Unter „Fach und Thema“ ist jedes Thema eine `.textline` mit Chevron → `/material?thema=` (Einstieg in den Themenfilter). Scheiterte die Abschrift, steht wie im Prototyp (Z. 3238) „Abschrift fehlgeschlagen“ mit „Erneut versuchen“ (`abschriftErneutAction`, 3.8). |
| `ablage` | `/material` | `kombi/seiten/ablage.tsx` | Der Filter `?fach=`/`?thema=` bleibt als Parameter: Ein Tipp auf eine Gruppenüberschrift filtert nach Fach, die Themenzeilen der Blattseite filtern nach Thema. Ist der Eingangskorb nicht leer, steht oben die Zeile „Eingangskorb · n Blätter“ → `/material/eingang`. |
| `faecher` | `/faecher` | `kombi/seiten/faecher.tsx` | Am Ende, vor „Fach anlegen“, eine zugeklappte Zeile „Archiviert · n“ (Gestalt wie die Zeile „Erledigt“ der Hausaufgaben-Seite), nur wenn n > 0. Aufgeklappt je Fach ein `rowBtn` → `/faecher/[id]`; dort steht bei archivierten Fächern „Wieder aufnehmen“ (`setArchivedAction(false)`). Danach „Fach anlegen“ → `/faecher/neu` (mit Schnellanlage). |
| `fach` | `/faecher/[id]` | `kombi/seiten/fach.tsx` | Unten: „Themen verwalten“ → `/faecher/[id]/themen`, „Alle Abschriften als PDF“ → `/api/fach/[id]/pdf`, „Fach bearbeiten“ → `/faecher/[id]/bearbeiten` (Kürzel, Farbe, Lehrer, Raum, Gewichtung, Archivieren, Löschen). |
| `einstellungen` | `/einstellungen` | `kombi/seiten/einstellungen.tsx` | Die drei Zeilen des Prototyps stehen oben, darunter Zeilen zu den Unterseiten `/einstellungen/{erinnerungen,ferien,abschrift,installieren,verbindungen,kalender,iserv,daten,konto}`. Abmelden steht unter „Konto“. Die Anker `#kalender` und `#iserv` werden auf die Unterseiten umgeleitet; der Google-Callback zeigt auf `/einstellungen/kalender`. |
| Epoche (keine eigene Seite) | `fach(EPOCHE.fach)` | – | `/stundenplan/epoche` (Umtragen) bleibt als Unterseite. Erreichbar über „Epoche wechseln“ an drei Stellen: Fach-Seite des Epochenfachs, `/stundenplan/bearbeiten` und die Einstellungszeile „Epoche“. Liefert `epochenFach()` keinen Treffer (noch keine Epoche, kein Hauptunterricht), öffnet die Einstellungszeile direkt `/stundenplan/epoche` statt `fach(EPOCHE.fach)`. |
| – (nur App) | `/lernen` | – | Leitet nach `/` um. Der Lernplan mit allen bisherigen Funktionen von `/lernen` steht auf der Klausurseite (F), verpasste Blöcke siehe 3.5. Push-Erinnerungen zeigen nicht mehr auf `/lernen` (F). |
| – (nur App) | `/abruf` | – | Leitet nach `/` um. Die Verwaltung liegt auf `/abruf/bausteine`, `/abruf/eingang` und `/abruf/klausur` im neuen Stil, erreichbar aus Fach (Bausteine des Fachs), Klausur („Stoff und Fragen“) und Einstellungen („Fragen-Vorschläge“, nur wenn welche offen sind). Der Knopf „Termine neu rechnen“ (`neuPlanenAction`, heute `abruf/page.tsx` Z. 194) zieht als Zeile mit Erklärsatz nach `/abruf/bausteine` und zusätzlich auf die Klausurseite (F). Er ändert den Takt nicht, er ist der bestehende Rettungsweg nach einer nachgetragenen oder verschobenen Klausur. |
| – (nur App) | `/abruf/sitzung` | – | Leitet nach `/` um. Der Tisch ersetzt die Sitzung, `session-view.tsx` wird gelöscht. |
| – (nur App) | `/login`, `/setup`, `/verbinden`, `/datenschutz`, `/offline`, `not-found` | bestehende Dateien, neu gestaltet | Papier `--bg`, linke Kante 22px, Titel 28/650 (`h1.hl`), Felder wie oben, Primärknopf `.btn` (52px, Pille, `--accent-fill`), ohne Zeile und ohne Shell. |
| „Wohin?“ (AREAS, Z. 2359) | Menü der Zeile | – | Neun Bereiche wie im Prototyp. Eingangskorb und Abruf-Verwaltung erscheinen dort nicht, sie sind über die Suche („eingang“, „bausteine“) und die genannten Zeilen erreichbar. |

**Neue Ziele für die Zeile:** `ZIEL` und `answerFor` bekommen „eingangskorb/eingang“ → `/material/eingang` und „bausteine/fragen“ → `/abruf/bausteine`. Das sind nur weitere Navigationsantworten in der Gestalt von „ablage“.

### 2.3 Gestaltung der App-eigenen Unterseiten

Wörtlich aus dem Prototyp übernommen, nichts neu erfunden:
- Seitenrahmen `pageShell` (Z. 2991ff.)
- Abschnittslabel `plab`
- Zeilen `.lrow` und `.set-row` (60px)
- Textzeilen `.textline` mit Chevron
- Primärknopf `.btn`
- Textknopf `.textbtn`
- Umschalter `.seg2`
- Fachpillen `.fp`
- Bestätigung im Stil `.t-confirm` (auf Papier mit `--sheet`)
- Fehlertext in `--error`

Formularfelder gibt es im Prototyp nicht. Sie bekommen genau die Maße der Zeile: Höhe 52, Radius 12, Fläche `--raise`, Schrift 17/450, Label 15/560 in `--ink-2`, Fokus `outline 2px var(--accent)`.

### 2.4 Vertrag zwischen Shell, Stapel und Router (gilt ab A)

Der Stapel arbeitet am Next-Router vorbei. Laut `node_modules/next/dist/docs/01-app/…/linking-and-navigating` übernimmt der Router eine per `pushState` geschriebene URL als aktuelle URL. Ohne festen Vertrag würden `refresh()`, echte Links und Android-Zurück den Stapel zerstören. Dieser Vertrag steht vor A und wird in A mit Playwright abgesichert.

1. **Wo `TagDaten` geladen werden.** `ladeTag()` läuft **nicht** im Layout und nicht nur in `page.tsx` von `/`. Die Shell holt `TagDaten` selbst:
   - Beim Server-Rendern von `/` übergibt `src/app/(app)/page.tsx` die Daten als Startwert an die Shell (kein zweiter Abruf beim Kaltstart).
   - Bei jedem anderen Einstieg (direkter Aufruf von `/noten`, einer Formular-Unterseite usw.) lädt die Shell `TagDaten` nach dem ersten Malen über `GET /api/tag/daten` nach. Bis dahin liegt unter dem Stapel die Startseite im Gerüst (Datumszeile, Zeile), ohne Inhalt.
   - Das Layout lädt nur die Sitzung und den Nutzer. Formular-Unterseiten laden so nie den ganzen Tag.
2. **Kein `refresh()` aus Stapel-Seiten.** Die Actions aus 3.9 und alle anderen Actions der neuen Oberfläche geben ihre neuen Daten zurück bzw. melden nur Erfolg. Sie rufen **nicht** `refresh()` auf. Danach lädt die Shell gezielt nach:
   - `TagDaten` über `/api/tag/daten`;
   - die oberste Stapelseite über `/api/seite/[art]`.
   Nur Formular-Unterseiten (echte Routen) dürfen `redirect()` bzw. `refresh()` verwenden, weil sie keinen Client-Stapel über sich haben.
3. **Der Stapel liegt in `history.state`.** Jeder Eintrag, den `openPage` schreibt, trägt `{kombi: 1, stapel: [{art, params}], tiefe}`. Damit stellen Zurück und Neuladen den Stapel wieder her (die Daten kommen erneut über `/api/seite`).
4. **`popstate` nur mit Stapel-Markierung.** Die Shell wertet `popstate` nur aus, wenn `event.state?.kombi` gesetzt ist, dann ruft sie `popPage` bzw. stellt den Stapel aus `state.stapel` her. Alle anderen Einträge gehören dem Next-Router. Die Shell ruft dort nichts auf.
5. **Echte Navigation leert den Stapel.** Wechselt `usePathname()` auf eine Route, die nicht aus dem Stapel stammt (Link zu `/noten/neu`, Umleitung nach dem Speichern), legt die Shell die Route-`children` als **oberste Ebene** in denselben `.page`-Container und lässt sie wie `openPage` einfahren (über dem Stapel nach rechts schieben, Ebene darunter auf −24 % mit Deckkraft .4, Randwisch zurück). Der Stapel darunter bleibt in `history.state` des vorigen Eintrags erhalten. Zurück aus `/noten/neu` landet also auf der Fach-Seite, von der man kam, und nicht auf `/`.
6. **Laden.** Ein Tipp auf eine Nachschlage-Zeile startet den Fetch. Die Seite fährt erst mit fertigen Daten ein. Sind nach 150 ms noch keine Daten da, fährt sie trotzdem ein, nur mit dem Titel aus `pageShell`, der Inhalt folgt ohne eigene Animation. Seiten, die vom Überblick oder aus der Zeile direkt erreichbar sind, werden bei `pointerdown` vorgeladen, wie das Vorwärmen der Kamera.
7. **Fehler.** Scheitert der Fetch (Server, DNS über den Funnel), erscheint keine Seite, sondern der Toast „Keine Verbindung“ mit „Erneut“.
8. **Offline.** `public/sw.js` legt `GET /api/seite/*`, `/api/tag/daten` und `/api/tag/stand` **network-first in einen eigenen Cache** `schulapp-v3-daten` (die Regel „alles unter `/api/` unberührt“, heute Z. 79, bekommt diese drei Ausnahmen; Dateien wie das Fach-PDF bleiben ausgenommen). Ohne Netz kommt die letzte Fassung aus dem Cache. Gibt es auch dort nichts, gilt Punkt 7. Eine Seite aus dem Cache trägt unter dem Titel ein `.p-sub` „Ohne Verbindung · Stand ⟨Uhrzeit⟩“. Das ist kein neues Element.
9. **Optimistische Actions.** Scheitert eine optimistische Action (Abhaken, Wischen, Eintragen, „Fach ändern“), steht der Toast „Nicht gespeichert“ mit „Erneut“ in der Gestalt des bestehenden Toasts. Der Zustand springt erst **nach** dem Erscheinen des Toasts zurück, nie still. Dazu kapselt `src/lib/kombi/aktion.ts` den Aufruf (`useOptimistic` plus `try/catch`, Fehler-Toast, dann `revert`).

**Prüfung (Playwright, in A):**
- auf `/hausaufgaben` (Stapel) eine Aufgabe abhaken → Startseite darunter bleibt, Seite bleibt, kein Server-Render von `/hausaufgaben` in `children`;
- Fach → Noten → Note eintragen → speichern → Android-Zurück zweimal → Fach-Seite, dann Startseite;
- Neuladen auf `/noten/fach/[id]` → eine Seite im Stapel über der Startseite;
- Flugmodus (`context.setOffline(true)`) nach einem Besuch: Hausaufgaben und Woche öffnen aus dem Cache, eine nie besuchte Seite zeigt den Toast.

---

## 3. Datenverträge

### 3.1 Uhr, Tag und Ansicht (neu: `src/lib/tag.ts`)

| Funktion | Aufgabe | Grundlage |
|---|---|---|
| `jetzt(req?)` | Liefert `new Date()`. Nur wenn `SCHULAPP_TESTUHR=1` gesetzt ist, liest sie das Cookie `testuhr` (gesetzt über `?jetzt=`, `?zeit=`, `&tag=` wie Z. 1060). | neu; auf dem NAS nie gesetzt |
| `appTag(now)` | `berlinDay(now − 4 h)`, Tageswechsel um 04:00 | `dates.ts` |
| `schultag(userId, tag)` | Mo–Fr, mindestens eine Stunde, nicht in `free_periods` | `lessonsForWeekday`, `freePeriodOn` |
| `schulschluss(userId, tag)` | spätestes `ends_at` der Stunden des Tages | `listPeriods`, `lessonsForWeekday` |
| `naechsterSchultag(userId, tag)` | nächster Tag, für den `schultag` gilt | neu |
| `ansicht(userId, now)` | `{ansicht, schritt, stand}` nach V2 3.2 und Z. 1335 | Tagesprotokoll |
| `GET /api/tag/stand` | `{ansicht, schritt, tag, fingerabdruck}`; abgefragt beim Öffnen und bei `visibilitychange` | Muster `/api/material/stand` |

**Uhr durchreichen:** Alle Lesefunktionen, die heute selbst `todayInBerlin()` aufrufen, bekommen einen Parameter `heute` mit dem bisherigen Wert als Vorgabe. Betroffen sind `listExams`, Teile von `materials.ts`, `exams.ts`, `inbox.ts` und `klausur-stoff.ts`. Nur so greift die Testuhr überall.

**`appTag` zum Lesen, Kalendertag zum Schreiben im Abrufkern:**
- `appTag(jetzt())` gilt für Ansicht, Tagesprotokoll, Lernblock, Abruf-**Lesen** (`faelligeThemen`, Zahl auf dem Überblick) und alle Anzeigen. Zwischen 00:00 und 04:00 zeigt die Oberfläche also den Vortag.
- Die **Schreibwege des Abrufkerns** (`versuchThemaAction`, `urteilThemaAction` → `versuchFesthalten`, `urteilFesthalten`) bleiben bei `todayInBerlin()`. `recall_attempts.answered_on` ist laut Schema-Kommentar der Berliner Kalendertag, `gap_days` ist die gemessene Stellgröße (A11) und lässt sich später nicht berichtigen. Alte Zeilen, `tagesbericht()`, die MCP-Lesewerkzeuge, der Erinnerungs-Cron und `abstandSeitZuletzt` rechnen mit dem Kalendertag. So ändert sich weder ein Termin noch die Bedeutung eines gespeicherten Messwerts.
- Folge: Wer um 00:30 übt, sieht die Fragen des App-Tags (Vortag), die Versuche tragen aber das Kalenderdatum. `themaTagesbericht` liest deshalb Versuche mit `answered_on IN (appTag, appTag + 1)` und `created_at ≥ Beginn des App-Tags (04:00)`. Ein Test deckt 00:30 ab.

### 3.2 Daten je Ansicht

Alles für die Startseite lädt `ladeTag(userId, now)` in `src/lib/kombi/tag-daten.ts` parallel. Es ersetzt `loadHomeData` und gibt ein reines Objekt (`TagDaten`) an `<KombiShell>`: beim Rendern von `/` als Startwert aus `page.tsx`, sonst über `GET /api/tag/daten` (2.4, Punkt 1).

| Ansicht / Baustein | Braucht | Bestehende Quelle | Neu |
|---|---|---|---|
| Datumszeile, Überschrift (`headlineFor` Z. 1633) | Tag, Ansicht, nächster Schultag, Zahl offener Aufgaben, Ferien | `freeLabel`, `freePeriodOn` | `naechsterSchultag`, `offeneFuer` |
| Morgens: Abgeben | Aufgaben fällig am Tag, offen und erledigt | `homeworkForRange(tag, tag)` | – |
| Morgens: Stunden | Stunden des Tages mit Zeit, Fach, Raum; Hauptunterricht | `loadWeek`, `periodTimes`, `lessonRoom` | `epochenFach()` (= `guessEpochSubject` nach `timetable.ts` verschoben), `juengstesThema(userId, subjectId)` |
| Morgens: Klausur heute | Klausur am Tag mit Stunde und Thema | `listExams(heute)` | Stunde der Klausur = erste Stunde des Fachs an dem Tag |
| Überblick: HA | offene Aufgaben bis zum nächsten Schultag, ohne heutige Abgaben an Schultagen; Zahl der späteren | `listHomework` | `offeneFuer(userId, tag)` (Z. 1782) |
| Überblick: Klausur | Klausuren in ≤ 14 Tagen; Planeintrag heute; nächster Lernblock | `upcomingExams`, `blocksForDay` | `naechsterLernblock(userId, tag)`; Uhrstand (3.5) |
| Überblick: Wiederholen | fällige Themen, Zahl, erstes Thema, Unterzeile, nächster Termin | `faelligHeute` (erweitert) | `faelligeThemen`, `naechsterTerminUeberhaupt` (3.4) |
| Überblick: Zuletzt abgelegt | 3 jüngste Blätter mit Vorschau, Titel, Fach, `filedAt`, Status | `/api/material/[id]/vorschau` | `blaetterKurz(userId, {limit:3})` mit `filedAt`, Themen, Abschriftstand |
| Überblick: Eingangskorb | Zahl der Blätter im Korb | `inboxCount` (wie heute `loadHomeData`) | Bei `inboxCount > 0` eine Zeile in der Gestalt „Und eine weitere …“ unter „Zuletzt abgelegt“: „n Blätter im Eingangskorb ›“ bzw. „Ein Blatt im Eingangskorb ›“ → `/material/eingang`. So bleiben Blätter sichtbar, die an einem früheren Tag im Korb liegen geblieben sind. |
| Ablauf Schritt 1 | Blätter dieses App-Tags mit Status | `korbblattStand`, `blaetterStand` | `blaetterVomTag(userId, tag)` (über `created_at`) |
| Ablauf Schritt 2 | Fächer von heute; nächste Stunde je Fach; heute eingetragene, offene und heute erledigte Aufgaben | `lessonsForWeekday`, `nextLessonDate` | `naechsteStundeFaellig(userId, subjectId, ab)` (Logik aus `hausaufgaben/neu/page.tsx` mit freien Tagen); Protokoll |
| Zeile | Fächer mit `short`, `kurz` und Alias, offene Aufgaben, Klausuren, Themen, Bereiche; dazu alles für die Inline-Antworten (siehe unten) | `listSubjects`, `listHomework`, `listExams`, `listTopics` | `zeilenVorrat(userId, tag)`, geladen über `GET /api/zeile/vorrat` beim ersten Öffnen des Menüs (danach aus dem Speicher der Shell, nach jeder Action neu); Volltextsuche `GET /api/suche?q=` (3.7) |
| Tisch | Fragen eines Themas, Lösung erst nach dem Versuch | `versuchFesthalten`, `urteilFesthalten`, `retireItem` | `fragenZumThema`, `fragenFuerLernblock` (3.4, 3.5) |

**`zeilenVorrat` für die Inline-Antworten.** Die Zeile zeigt im Prototyp beim Tippen sofort Antworten (Z. 2380–2435). Damit nichts nachlädt oder flackert, enthält der Vorrat:
- `morgenAnswer`/`tagAns`: Stunden der nächsten zwei Schultage mit Zeit, Fach (`kurz`), Raum und Hauptunterricht, dazu freie Tage („Ferien“, „Keine Schule“);
- `notenAnswer`: Noten je Fach kompakt (Schnitt, letzte Noten);
- `klausurAnswer`: die Planzeilen der Klausuren in ≤ 14 Tagen;
- `whAnswer`: `faelligeThemen` mit Fach;
- `lernblockOpt`: der Lernblock von heute mit Zustand;
- die Epoche (`epochenFach()`, Thema).
Alles ist serialisierbar und bleibt unter 30 KB.

**Anzeigename `kurz` der Fächer.** Der Prototyp nutzt `F(x).kurz` an 16 Stellen („Mathe abgehakt“, Klausurzeile, Aufgabenzeilen). `subjects.short` ist in der App ein Kürzel wie „M“ (schema.ts Z. 123) und taugt dafür nicht. `src/lib/kombi/fach-alias.ts` führt deshalb neben den Aliasen eine Tabelle Name → kurz, wörtlich aus dem Prototyp Z. 1095–1100 (Mathematik → Mathe, Biologie → Bio, sonst der Name). `zeilenVorrat`, `ladeTag` und alle Loader geben `kurz` mit. Es ist keine neue Spalte.

**Loader der Nachschlage-Seiten** (`src/lib/seiten/*.ts`):

| Seite | Loader |
|---|---|
| woche | `loadWeek`, `homeworkForRange`, `listExams`, `freePeriodOn` |
| hausaufgaben | `listHomework({includeDone})`, erledigte nur mit `done_at ≥ jetzt − 2 Tage`; Gruppen wie `hausaufgabenGroups` Z. 3026 |
| klausur | `getExam`, `stoffZuKlausur`, `gradesBySubject`, Lernplan wie heute `/lernen` (alle Blöcke, `plan.warnings`, Fortschritt, Minuten am Tag, Tage Vorlauf) |
| noten | `gradeSummary` |
| notenfach | `gradesBySubject` |
| blatt | `getMaterial`, Leser-Läufe des Blatts (`laufAnzeige`, `kostenSatz`), Vorschlag im Korb |
| ablage | `listMaterials` gruppiert |
| faecher und fach | `listSubjects({includeArchived: true})` (archivierte getrennt), `findNextLesson`, `listTopics`, `themaArt` |
| einstellungen | wie heute |

### 3.3 Tagesprotokoll (neu)

**Wie alle SQL-Dateien dieses Plans entstehen.** Genau wie in `leser-tabellen.sql` beschrieben: erst `src/db/schema.ts` bzw. `schema-recall.ts` ändern, dann `drizzle-kit generate` gegen den Stand vor und nach der Änderung laufen lassen und die erzeugten Anweisungen **wörtlich** übernehmen. So tragen Fremdschlüssel die Drizzle-Namen (`tagesprotokoll_user_id_users_id_fk`, nicht das Postgres-eigene `…_fkey`). Jeder CHECK wird im Schema mit `check(name, …)` benannt, der GIN-Ausdrucksindex mit ``index(name).using('gin', sql`…`)``. Ein späteres `db:push` oder `generate` findet dann keinen Unterschied. Die Blöcke unten zeigen nur, **was** entsteht; maßgeblich ist die erzeugte Datei.

**SQL `scripts/kombi-tagesprotokoll.sql`** (Muster wie `freie-tage-tabelle.sql`: rein additiv, Schema in `src/db/schema.ts` nachgezogen):

```sql
CREATE TABLE "tagesprotokoll" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "tag" date NOT NULL,                -- App-Tag, Wechsel 04:00
  "typ" text NOT NULL,                -- geprüft im Code, kein CHECK (s. u.)
  "ref" text,
  "daten" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "tagesprotokoll" ADD CONSTRAINT "tagesprotokoll_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "tagesprotokoll_user_tag_idx" ON "tagesprotokoll" USING btree ("user_id","tag");
```

**`typ` ohne CHECK.** Die erlaubten Typen stehen als `PROTOKOLL_TYPEN` (`as const`) in `src/lib/protokoll.ts` und werden in `protokollieren()` per zod geprüft. Ein späterer neuer Typ bleibt damit additiv und braucht kein `DROP CONSTRAINT`, das `scripts/sql-einspielen.ts` ablehnt (siehe 3.6). Die 18 Typen: `ablauf_schritt`, `ablauf_beendet`, `ablauf_uebersprungen`, `aufgabe_eingetragen`, `aufgabe_abgehakt`, `aufgabe_geoeffnet`, `aufgabe_geloescht`, `blatt_abgelegt`, `seite_dazu`, `thema_art`, `thema_beendet`, `frage_zurueckgezogen`, `lernblock_gestartet`, `lernblock_pausiert`, `lernblock_fortgesetzt`, `lernblock_erledigt`, `blatt_gedruckt`, `blatt_ausgewertet`.

**Die 18 Typen, `ref` und `daten`** stehen in der Tabelle im Ansichten-Bericht, Abschnitt 13. Zusätzlich:
- „Fach ändern“ schreibt **kein** Protokoll, wie im Prototyp.
- `doAendern` schreibt keins.

**Bibliothek `src/lib/protokoll.ts`:**
- `protokollieren(userId, tag, typ, ref?, daten?) → id`
- `protokollLoeschen(userId, id)`: Rückgängig, Kriterium 57.
- `ablaufStand(userId, tag)` → `'erledigt' | 'übersprungen' | null`
- `ablaufSchritt(userId, tag)`: der letzte `ablauf_schritt`, sonst `'blaetter'`
- `eingetragenHeute(userId, tag)`: `aufgabe_eingetragen` minus `aufgabe_geloescht`
- `lernblockEreignisseLoeschen(userId, tag, key)`: für „Block beenden“ unter 1 Minute

**Rückgängig:** Jede Action, die protokolliert, gibt die Protokoll-ID zurück. Rückgängig ruft die Gegen-Action und danach `protokollLoeschen` auf.

**Rückgängig beim Löschen einer Aufgabe** fügt die Aufgabe mit ihrer **alten `id`** und allen Werten (auch `created_at`, `done_at`, `details`) wieder ein (`homeworkWiederherstellen(userId, zeile)`), erst danach wird der Eintrag `aufgabe_geloescht` gelöscht. So stimmt `eingetragenHeute()` (hängt an der ID), und Verweise wie der Kalender-Abgleich bleiben gültig. `aufgabeLoeschenAction` gibt dazu die vollständige Zeile zurück, die der Client bis zum Ablauf des Toasts hält.

### 3.4 Wiederholen nach Themen (nur lesen, `src/recall/themen.ts`)

1. `faelligHeute` liefert zusätzlich `subjectId`, `subjectTopicId` und `examId`. Das ist nur eine erweiterte Auswahl, die Reihenfolge bleibt.
2. `faelligeThemen(userId, heute, {subjectId?})`:
   - bündelt nach `resolveTopic(subject_topic_id)`;
   - fasst Fragen ohne Thema je Fach zu „⟨Fach⟩ · ohne Thema“ zusammen;
   - sortiert:
     1. angefangen: heute Versuche an noch fälligen Fragen des Themas **oder** ein Arbeitsblatt des Themas mit `gedruckt_am` heute und leerem `ausgewertet_am` (wie `blattAngefangen`, Z. 1405). Die Unterzeile unter „Wiederholen“ lautet dann wörtlich „Weiter mit ⟨Fach · Thema⟩, Blatt auswerten“;
     2. ältestes `due_on`;
     3. nähere Klausur des Fachs (`naechsteKlausur` exportieren);
     4. mehr fällige Fragen;
     5. alphabetisch.
   - In Ferien ist die Liste leer.
   - Jedes Thema trägt `art` (3.6), `umfang` („n Fragen“ oder „Arbeitsblatt“) und `istEpoche`.
   - **Ausgewertete Übungsthemen** (nötig bei Frage 3 (b), bei (a) wirkungslos, aber trotzdem gebaut, damit beide Antworten tragen): Ein Thema mit einem Arbeitsblatt, dessen `ausgewertet_am` gesetzt ist, gilt erst wieder als fällig ab dem kleinsten offenen `due_on`, das **nach** dem App-Tag von `ausgewertet_am` liegt. Fällige Termine davor werden beim Lesen übergangen, nicht geändert. Wie im Prototyp (`themaOffen` → `blattFertig`, Z. 1395–1399) bleibt das Thema danach aus der Liste.
   - **Arbeitsblatt mit Status `fehlgeschlagen`** (3.6): Das Thema fällt für diesen Tag auf Abfragen mit Karten zurück, sofern es Fragen hat (`umfang` „n Fragen“). Hat es keine Fragen, erscheint es nicht in `faelligeThemen`. Es blockiert also weder Wiederholen noch den Lernblock.
3. `zahlFaelligeThemen`.
4. `fragenZumThema(userId, heute, topicKey)`: die fälligen Fragen nur dieses Themas, in der Reihenfolge von `faelligHeute`.
5. `naechsterTerminThema(userId, topicKey, heute)` liefert das kleinste offene `due_on > heute` („Wieder dran“). Für ein ausgewertetes Übungsthema gilt dieselbe Regel wie oben (kleinstes offenes `due_on` nach `ausgewertet_am`), damit „Wieder dran“ und „Wiederholen · n Themen“ am nächsten Tag übereinstimmen. `naechsterTerminUeberhaupt(userId, heute)` liefert „Nächstes Thema ⟨Tag⟩“.
6. `themaTagesbericht(userId, topicKey, heute)`: Fragen und „beim ersten Mal“ aus `recall_attempts` von heute, für das Themenende.

Die Warteschlange je Thema läuft im Client, „Daneben“ legt die Frage ans Ende. Für den Fortsetzen-Stand reicht die Datenbank: noch fällige Fragen plus heutige Versuche. `db.sitzung` aus dem Prototyp entfällt, eine eigene Tabelle gibt es nicht.

### 3.5 Lernblock (Uhrstand)

**SQL `scripts/kombi-lernblock-uhr.sql`**, additiv:

```sql
ALTER TABLE "study_blocks" ADD COLUMN "laeuft_seit" timestamp with time zone;
ALTER TABLE "study_blocks" ADD COLUMN "pausiert_seit" timestamp with time zone;
ALTER TABLE "study_blocks" ADD COLUMN "pause_ms" integer DEFAULT 0 NOT NULL;
ALTER TABLE "study_blocks" ADD COLUMN "minuten_gelernt" integer;
```

`laeuft_seit` ist nur Uhrstand und wird nie angezeigt.

**Angefangene Blöcke überstehen jedes Neuplanen.** Ein laufender oder pausierter Block hat `status = 'open'`. Heute würden ihn diese Funktionen zerstören:
- `generatePlan()` (Klausur speichern, „Lernplan neu erstellen“) und `catchUpMissed()` löschen alle offenen Blöcke und legen neue an;
- `moveOffFreeDays()` (Ferien eintragen) verlegt offene Blöcke;
- `setTopics()` löscht `exam_topics`, daran hängen die Blöcke per cascade.
Die Uhr ginge verloren, `arbeitsblaetter.study_block_id` fiele auf null, und die Einträge `lernblock_*` im Protokoll zeigten auf eine ID, die es nicht mehr gibt.

Regel in `src/lib/exams.ts`: Ein Block mit `laeuft_seit IS NOT NULL` oder `pause_ms > 0` zählt als **angefangen**. `generatePlan`, `catchUpMissed` und `moveOffFreeDays` behandeln ihn wie `done`/`skipped`: nicht löschen, nicht verlegen. Seine Minuten zählen in der Neuverteilung als belegt. `setTopics` löscht ein Klausurthema mit angefangenem Block nicht, sondern lässt es stehen, bis der Block beendet ist (der Block behält sein Thema). Eine Hilfsfunktion `blockAngefangen(block)` steht in `lernblock.ts` und wird in `exams.ts` verwendet.

**Bibliothek `src/lib/lernblock.ts`:**
- `blockStarten`, `blockPausieren`, `blockFortsetzen`: jeweils mit Protokoll.
- `blockRest(block, now)`.
- `blockBeenden(userId, blockId, now)`: unter 1 Minute zurück auf Ruhe und `lernblockEreignisseLoeschen`; sonst wird „Als erledigt zählen?“ gefragt.
- `blockErledigt(userId, blockId, minuten, perWH?)`: `setBlockStatus(done)`, `minuten_gelernt`, Protokoll `lernblock_erledigt`.
- `fragenFuerLernblock(userId, blockId, heute)`: `faelligHeute`, gefiltert auf die Klausurthemen (`exam_topics.subject_topic_id`) und `recall_items.exam_id`, sortiert nach `exam_topics.sort_order`.
- `materialFuerLernblock`: über `stoffZuKlausur` („Material · Scheitelpunktform, 2 Seiten“).

**Benennung der Planeinträge:**

| Eintrag | Anzeige |
|---|---|
| `learn` | „Lernblock · ⟨Thema⟩“ |
| `review` | „Lernblock · Wiederholung“ |
| ohne Thema | „Lernblock · Gesamtwiederholung“ |
| „Probeklausur“ | gibt es nicht (siehe Frage 4) |

**Verpasste Blöcke** (`MissedPrompt`): erscheinen als Zeile unter der Lernblockzeile im Überblick, gleiche Gestalt wie „Und eine weitere …“: „Ein Lernblock von Freitag ist offen ›“. Sie öffnen die Klausurseite, dort stehen „Nachholen“ und „Auslassen“ als `.textbtn`.

### 3.6 Art je Thema und Arbeitsblätter

**SQL `scripts/kombi-themen-art.sql`:**

```sql
ALTER TABLE "subject_topics" ADD COLUMN "art" text;
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_art_check"
  CHECK ("art" IS NULL OR "art" IN ('abfragen','ueben'));
```

`themaArt(topic, subject)`:
- gespeicherter Wert, falls gesetzt;
- sonst Mathematik und Physik → `ueben`;
- Deutsch, Französisch und Englisch mit Grammatik-Stichwort im Thementitel → `ueben`. Stichwortliste in `src/lib/themen-art.ts`: Grammatik, Zeit, Zeitform, passé, imparfait, subjonctif, tense, Konjunktiv, Passiv, Kasus, Satzglied, Kommasetzung …;
- sonst `abfragen`.

Umstellen schreibt die Spalte und Protokoll `thema_art`. Rückgängig setzt den alten Wert und löscht den Eintrag.

**SQL `scripts/kombi-arbeitsblaetter.sql`** (rein additiv; Namen der Constraints laut `drizzle-kit generate`, siehe 3.3):

```sql
CREATE TABLE "arbeitsblaetter" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "subject_topic_id" uuid,            -- leer bei Gesamtwiederholung / Klausurthema ohne Fach-Thema
  "study_block_id" uuid,
  "tag" date NOT NULL,
  "status" text DEFAULT 'wartet' NOT NULL,
  "frist_bis" timestamp with time zone,  -- wie leser_laeufe: danach gilt 'laeuft' als hängen geblieben
  "versuche" integer DEFAULT 0 NOT NULL, -- Bau-Versuche an diesem Tag, Obergrenze 2
  "inhalt" jsonb,                     -- Form wie UEBUNG (Z. 1231)
  "erzeugt_am" timestamp with time zone,
  "gedruckt_am" timestamp with time zone,
  "ausgewertet_am" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "arbeitsblaetter_status_check" CHECK ("arbeitsblaetter"."status" in ('wartet','laeuft','fertig','fehlgeschlagen')),
  CONSTRAINT "arbeitsblaetter_ziel_check" CHECK ("arbeitsblaetter"."subject_topic_id" is not null or "arbeitsblaetter"."study_block_id" is not null)
);
-- Fremdschlüssel: user_id → users (cascade), subject_topic_id → subject_topics (cascade),
-- study_block_id → study_blocks (set null); Namen wie von drizzle-kit erzeugt.
CREATE UNIQUE INDEX "arbeitsblaetter_thema_tag_idx" ON "arbeitsblaetter" ("user_id","subject_topic_id","tag")
  WHERE "subject_topic_id" IS NOT NULL;
CREATE UNIQUE INDEX "arbeitsblaetter_block_idx" ON "arbeitsblaetter" ("user_id","study_block_id")
  WHERE "study_block_id" IS NOT NULL;
CREATE TABLE "arbeitsblatt_wertung" (
  "arbeitsblatt_id" uuid NOT NULL,    -- → arbeitsblaetter (cascade)
  "nr" integer NOT NULL,
  "richtig" boolean NOT NULL,
  CONSTRAINT "arbeitsblatt_wertung_arbeitsblatt_id_nr_pk" PRIMARY KEY ("arbeitsblatt_id","nr")
);
ALTER TABLE "leser_laeufe" ADD COLUMN "arbeitsblatt_id" uuid;  -- → arbeitsblaetter (set null)
```

**Die zwei CHECKs von `leser_laeufe`** müssen für die neue Art `'arbeitsblatt'` neu gesetzt werden. Das steht in einer **eigenen** Datei `scripts/kombi-arbeitsblaetter-checks.sql`, weil es die einzige nicht additive Anweisung ist:

```sql
ALTER TABLE "leser_laeufe" DROP CONSTRAINT "leser_laeufe_art_check";
ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_art_check"
  CHECK ("leser_laeufe"."art" in ('einordnen', 'nachlese', 'von-hand', 'fragen', 'arbeitsblatt'));
ALTER TABLE "leser_laeufe" DROP CONSTRAINT "leser_laeufe_ziel_check";
ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_ziel_check" CHECK (
     ("leser_laeufe"."art" = 'fragen' and "leser_laeufe"."exam_id" is not null and "leser_laeufe"."material_id" is null)
  or ("leser_laeufe"."art" = 'arbeitsblatt' and "leser_laeufe"."arbeitsblatt_id" is not null
      and "leser_laeufe"."material_id" is null and "leser_laeufe"."exam_id" is null)
  or ("leser_laeufe"."art" not in ('fragen', 'arbeitsblatt') and "leser_laeufe"."material_id" is not null and "leser_laeufe"."exam_id" is null));
```

- `scripts/sql-einspielen.ts` verbietet heute jedes `DROP CONSTRAINT` (Muster Z. 52) und bräche die Transaktion samt Tabellen ab. Es bekommt eine **dokumentierte, enge Ausnahme**: `DROP CONSTRAINT "x"` ist erlaubt, wenn in derselben Datei unmittelbar danach `ADD CONSTRAINT "x"` mit **demselben Namen** folgt (Tausch einer Bedingung). Alles andere bleibt verboten. Ein Test in `scripts/sql-einspielen.test.ts` prüft: Tausch erlaubt, nacktes `DROP CONSTRAINT` abgelehnt, `DROP TABLE` abgelehnt.
- Die Checks-Datei wird **nach** `kombi-arbeitsblaetter.sql` eingespielt (Spalte `arbeitsblatt_id` muss stehen).
- Im Schema (`src/db/schema.ts` Z. 1146–1159) beide `check()` nachziehen; `LeserLaufArt` bekommt `'arbeitsblatt'`. Die Anzeige der Läufe und Kosten (Einstellungen „Handschrift abschreiben“, `laeufe.ts`, `nas.sh stand`) kennt die Art und beschriftet sie „Arbeitsblatt“.
- Test gegen den Harness (B): einen Lauf mit `art='arbeitsblatt'`, gesetzter `arbeitsblatt_id` und leerem `material_id` einfügen; einen mit gesetztem `material_id` abweisen.

**Blöcke und Themen ohne Fach-Thema.** Ein Block der Gesamtwiederholung hat kein `topic_id`, und `exam_topics.subject_topic_id` darf leer sein. Ein solches Blatt hängt deshalb nur am Block (`study_block_id`, eigener Unique-Index). Als Quelle dienen die Abschriften aller Klausurthemen mit Fach-Thema (`stoffZuKlausur`). Gibt es kein einziges Klausurthema mit Fach-Thema und keine Abschrift, wird kein Blatt gebaut. Der Block läuft dann wie im Prototyp über Karten (`fragenFuerLernblock`) und Material (`materialFuerLernblock`).

**Hängende und gescheiterte Läufe.**
- Beim Start setzt der Bau `status='laeuft'`, `frist_bis = now() + 15 min` und erhöht `versuche`. Die Warteschlange an `globalThis` überlebt keinen Neustart des Containers (DSM-Update donnerstags). Deshalb gilt eine Zeile mit `laeuft` und abgelaufener `frist_bis` als hängen geblieben.
- Hängende und `fehlgeschlagen`e Zeilen werden per **UPDATE** neu angestoßen, nie neu angelegt (der Unique-Index bleibt gültig). Höchstens **2 Versuche je Blatt und Tag**, gegen Opus-Kosten. Danach bleibt `fehlgeschlagen` ein Endstatus für den Tag.
- `fehlgeschlagen` und `fertig` sind Endstatus: Das Nachfragen der Oberfläche (alle 3 s) endet dort.
- Rückfall bei `fehlgeschlagen` siehe 3.4 und H.

**Inhalt `inhalt`:**

```
{teil, minuten, papier: 'kaestchen'|'linien',
 quellen: [{materialId, datum, zitat}],
 aufgaben: [{kurz, q, teile?, platz, zitat, l: [['p'|'teile'|'eq'|'erg'|'hint', …]]}]}
```

### 3.7 Suche

**SQL `scripts/kombi-suche.sql`:**

```sql
CREATE INDEX "material_pages_volltext_idx" ON "material_pages"
  USING gin (to_tsvector('german', coalesce("transcript",'')));
CREATE INDEX "materials_titel_volltext_idx" ON "materials"
  USING gin (to_tsvector('german', coalesce("title",'')));
```

`sucheBlaetter(userId, q, limit)` in `src/lib/suche.ts`:
- Präfix-tsquery aus jedem Wort (`wort:*`), alle Wörter müssen treffen;
- Rang: Titel ×4, Thema ×2, Text ×1;
- Ausschnitt per `ts_headline` ohne ⟨⟩;
- ä/ae, ö/oe, ü/ue und ß/ss normalisiert die Funktion vor der Abfrage, weil `unaccent` in PGlite fehlt.

Route Handler `GET /api/suche?q=`, wird 150 ms nach dem letzten Tastendruck aufgerufen (Z. 2451). Alle anderen Gruppen der Suche rechnet der Client über `zeilenVorrat`.

### 3.8 Blätter ohne Fachwahl

`materials.subject_id` bleibt NOT NULL.

**Aufnahme:** Route Handler `POST /api/blaetter` (multipart, ein Blatt je Anfrage, mehrere Anfragen parallel per `fetch`). Er ist kein Server Action, weil Actions seriell laufen und die 5-MB-Grenze haben.
- Er setzt ein vorläufiges Fach über `captureSubject()` bzw. die letzte Stunde des Tages, legt das Blatt an, protokolliert `blatt_abgelegt` und stößt `zuteilungAnstossen` an.
- Mit `attach=<materialId>` hängt er eine Seite an (`addPage`, Protokoll `seite_dazu`).
- Die Seiten bereitet der Client wie heute mit `prepare-page.ts` vor.

**Anzeige:** Solange `filed_at` leer ist, zeigt die Oberfläche das Fach **nicht**, sondern „Wird eingeordnet …“.

**Status für `sheetItem` und Miniaturen** (`statusTexts` Z. 3631), aus `blaetterVomTag`:

| Lage | Status |
|---|---|
| Upload läuft | `hochladen` (nur Client) |
| `filed_at` leer, Jev läuft | `einordnen` |
| eingeordnet, Abschrift offen | `abschrift_laeuft` |
| Abschrift da | `abschrift_da` |
| Lauf fehlgeschlagen | `fehlgeschlagen` |
| offline | `haengt` (Client, `online`-Ereignis) |
| liegt im Korb (kein Jev, Skizze) | `im_korb`, neu |

`im_korb` wird gestaltet wie „Hängt …“: dieselbe Zeile in `--ink-3` mit dem Text „Liegt im Eingangskorb“. Ein Tipp öffnet `/material/eingang/[id]`.

**Fehlerzustand `fehlgeschlagen`** wird wörtlich aus `statusTexts`/`paintSheet` (Z. 3631, 3638–3652) übernommen: dritte Zeile „⟨Titel⟩ · Abschrift fehlgeschlagen“ in `--error`, darunter der Knopf „Erneut versuchen“ (`.retry`). Auf der Blatt-Seite steht „Abschrift fehlgeschlagen“ (Z. 3238) mit demselben Knopf.
- Neue Action `abschriftErneutAction(materialId)` in `src/app/(app)/kombi-actions.ts`: prüft `requireUser()` und Besitz, stößt den Leser-Lauf auf dem bestehenden Weg von „Abschreiben lassen“ neu an und liefert den Status `abschrift_laeuft`. Die Zeile springt sofort auf „Wird abgeschrieben …“.
- Prüfschritt: Mit der Testweiche `?fehler=abschrift` (nur mit `SCHULAPP_TESTUHR`) scheitert der nächste Lauf künstlich; Knopf tippen, Lauf läuft erneut.

**Aktualisierung:** über `blaetterStand()` (`/api/material/stand`), abgefragt alle 2 s, solange ein Blatt nicht fertig ist, sonst gar nicht (kein `setInterval` im Leerlauf). Wird ein Blatt eingeordnet, erscheint auf dem Überblick der Toast „⟨Fach⟩ · ⟨Thema⟩“.

**„Fach ändern“:** `fachAendern(materialId, subjectId)` setzt das Fach, setzt `filed_at` und stößt für das neue Fach die Themenbestimmung von Jev mit festem Fach an (`autoFile` mit Fachvorgabe). Solange sie läuft, steht als Thema „Thema folgt“. Toast „Nach ⟨Fach⟩ verschoben“, kein Protokoll.

### 3.9 Aufgaben aus der Zeile

| Funktion | Zweck |
|---|---|
| `naechsteStundeFaellig(userId, subjectId, ab)` | Fälligkeit „nächste Stunde“, freie Tage übersprungen |
| `dubletteFinden(userId, subjectId, due, normText)` | „Steht schon drin“ |
| Action `aufgabeEintragenAction` | `createHomework` + Protokoll, gibt `{id, protokollId}` zurück |
| Action `aufgabeAbhakenAction` | `setHomeworkDone` + `aufgabe_abgehakt`/`aufgabe_geoeffnet` |
| Action `aufgabeLoeschenAction` | `deleteHomework` + `aufgabe_geloescht`, gibt die vollständige Zeile zurück; Rückgängig fügt sie mit der alten `id` wieder ein (3.3) |
| Action `aufgabeAendernAction` | `updateHomework`, ohne Protokoll |

Alle Actions prüfen `requireUser()` und validieren mit zod. Sie rufen **kein** `refresh()` auf, die Shell lädt gezielt nach (2.4, Punkt 2). Abhaken, Wischen und Eintragen sind optimistisch über `aktion.ts` (2.4, Punkt 9).

**Google-Kalender-Abgleich.** Der Abgleich hängt heute in der Action-Schicht: `src/app/(app)/hausaufgaben/actions.ts` ruft nach `createHomework`, `updateHomework`, `setHomeworkDone` und `deleteHomework` jeweils `requestCalendarSync(user.id)` auf (Z. 101, 130, 147, 156). Die Zeile wird der Hauptweg zum Eintragen, also gilt dasselbe für jede der vier neuen Actions **und für jedes Rückgängig** (Wiederherstellen einer gelöschten Aufgabe, Zurücknehmen eines Abhakens). Damit das nicht wieder vergessen wird, kommt der Aufruf in eine gemeinsame Hilfsfunktion `nachAufgabeGeschrieben(userId)` in `src/lib/homework-nachlauf.ts`, die die alten Actions in `hausaufgaben/actions.ts` und die neuen in `kombi-actions.ts` teilen. Dasselbe Muster gilt für Klausuren (`klausuren/actions.ts` Z. 134, 208, 222), falls die neue Oberfläche eine Klausur-Action bekommt.

---

## 4. Abschnitte in Bau-Reihenfolge

Jeder Abschnitt endet lauffähig. Prüfweg nach Abschnitt 5, Sollbilder aus `screens/`.

**Ein Abschnitt ist abgenommen, wenn:**
- `npx tsc --noEmit`, `npm run lint` und `npm test` grün sind;
- der lokale Produktionsbau läuft;
- die Playwright-Bilder bei 390×844 und 360×800, hell und dunkel, neben den Sollbildern liegen und abgeglichen sind;
- keine Konsolenfehler auftreten;
- kein Bedienelement unter 44×44 misst.

Erst dann beginnt der nächste (V2 16.4 Nr. 8).

**Bis H geht nichts auf den NAS.** Die Abschnitte sind einzeln abnehmbar, aber nicht einzeln im Betrieb nutzbar: Schon A nimmt `AppNav` und `MobileTopBar` weg, Kamera, Tisch und Nachschlage-Seiten kommen erst in C, E und G. Ein Deploy nach jedem Abschnitt nähme dem Nutzer über Wochen Blätter fotografieren, Wiederholen, Noten, Klausuren und Ablage (Verstoß gegen Grundsatz 2). Deshalb:
- Der NAS läuft bis zur Abnahme von H unverändert mit `main`. `modell-23` wird nicht nach `main` gemischt.
- Abnahme je Abschnitt lokal (5.1–5.5) und am Handy über ein **Testbild mit eigenem Funnel** auf dem Mac (`next start` mit `--experimental-https` oder `tailscale funnel 3100` von diesem Rechner), mit der Saat aus 5.1, nie mit der NAS-Datenbank.
- Zusätzlich gilt: Alte Wege (Kachelmenü, `capture-pane`, `/abruf/sitzung`, `MobileTopBar`) werden erst gelöscht, wenn ihr Ersatz im selben oder einem früheren Abschnitt steht. Die Löschungen stehen deshalb bei dem Abschnitt, der den Ersatz bringt (siehe A, B, C, E, G).

### A — Design-Grundlage und Shell

**Vorlage:** Z. 12–840 (CSS), 843–975 (Markup), 976–1050 (Werkzeuge), 1489–1625 (Hülle, Toast, `moveTo`, `flip`, `reconcile`, `updFade`), 2262–2989 nur das Gerüst der Zeile (Dock, Menü auf und zu, `vvFit`), 2991–3331 (`pageShell`, `openPage`, `popPage`, Randwisch).

**Ändern:**
- `src/app/globals.css`:
  - Die Tokens aus Z. 13–84 einsetzen (hell, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, `:root[data-theme="dark"]`), dazu die a4-Tokens, die Schatten und `--pad`, `--safe-*`, `--top`, `--foot-space`.
  - Die Easings als `--ease-*` und die Feder als `--ease-spring` mit `--dur-spring: 392ms`.
  - Die Grundwerte aus Z. 86–101.
  - Die alten Tokens (`--background`, `--surface`, `--foreground`, `--muted`, `--border`, `--accent` usw.) werden **auf die neuen abgebildet**: `--background: var(--bg)`, `--accent: #2A44C0/#8D9CFF` wie im Prototyp usw. So bleiben noch nicht umgebaute Seiten lesbar. `@theme inline` zeigt auf die neuen Namen.
  - Am Ende von G werden die alten Namen entfernt.
- **Neu** `src/app/kombi.css`: die Komponentenklassen aus Z. 103–840 wörtlich, ebenso Druck (Z. 813) und reduced-motion (Z. 821–832). Global importiert im Root-Layout nach `globals.css`. Toter Code, den kein JS des Prototyps nutzt (`.wmenu`, `.now-pill`, `.when .dot`, `.when .md`, `.when.preview`, `.pill:hover`), wird **nicht** übernommen, ohne Ausnahme.
- `src/app/layout.tsx`:
  - `Schibsted_Grotesk({subsets:['latin','latin-ext'], style:['normal','italic'], variable:'--font-sans', display:'swap'})` und `Newsreader({…, axes:['opsz'], variable:'--font-serif'})`, **ohne `weight`**. Die Klassen kommen auf `<html>`.
  - `--sans: var(--font-sans), system-ui, sans-serif` und `--serif: var(--font-serif), serif`.
  - Geist und Geist Mono entfallen.
  - Statt `generateViewport` ein fester `export const viewport`:
    ```
    {width:'device-width', initialScale:1, viewportFit:'cover',
     interactiveWidget:'resizes-content', colorScheme:'light dark',
     themeColor:[{media:'(prefers-color-scheme: light)', color:'#F7F7F5'},
                 {media:'(prefers-color-scheme: dark)', color:'#141416'}]}
    ```
  - `data-theme` gibt es nur noch als Prüfschalter (`?theme=`, nur mit `SCHULAPP_TESTUHR`).
- `src/app/manifest.ts`: `background_color` und `theme_color` auf `#F7F7F5`.
- `public/sw.js`: `VERSION = "schulapp-v3"`, dazu der Daten-Cache für `/api/seite/*`, `/api/tag/daten`, `/api/tag/stand` (2.4, Punkt 8).
- `next.config.ts`: `deploymentId: process.env.NEXT_DEPLOYMENT_ID` (nur aus der Umgebung, **kein** `git`-Aufruf: `.dockerignore` schließt `.git/` aus, und `next.config.ts` wird bei `next start` erneut ausgewertet). Dazu `headers()` für `/sw.js` mit `Cache-Control: no-cache`.
  - `Dockerfile`: `ARG NEXT_DEPLOYMENT_ID=""` und `ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID` in der Bau-Stufe vor `npm run build`, **und** in der Laufzeitstufe dieselbe `ENV` (Wert über ein zweites `ARG` durchgereicht), damit Bau und Laufzeit dieselbe ID sehen.
  - `scripts/nas.sh hoch`: `--build-arg NEXT_DEPLOYMENT_ID="$(git rev-parse HEAD)"` beim Bau (im Klon auf dem NAS gibt es `.git`). Leer gelassen schaltet Next den Schutz einfach ab, ein Fehler entsteht nicht.
  - Lokal: `NEXT_DEPLOYMENT_ID=$(git rev-parse HEAD) npm run build`.
- `src/app/(app)/layout.tsx`: `AppNav`, `MobileTopBar` und `PageBody` raus, `<KombiShell nutzer={…}>{children}</KombiShell>` rein. Das Layout lädt nur Sitzung und Nutzer, `TagDaten` holt die Shell nach dem Vertrag in 2.4, Punkt 1. (Bis H ist das nur lokal, siehe Abschnitt 4.)
- **Kaltstart ohne Aufblitzen** (Vorlage Z. 4675–4686): Ein Inline-Skript im `<head>` des Root-Layouts setzt `document.documentElement.classList.add('pre')` vor dem ersten Malen, aber nur, wenn `matchMedia('(prefers-reduced-motion: reduce)')` nicht greift. `kombi.css` blendet unter `html.pre` die Einblend-Blöcke aus (`opacity:0`). Die Shell nimmt `pre` nach `document.fonts.ready` weg und startet die Einblendung (8px von unten, 25 ms versetzt, `fill: backwards`). Ohne JS gibt es kein `pre`, der Inhalt steht sofort. Als Sicherung nimmt ein `setTimeout` von 1200 ms im Inline-Skript `pre` in jedem Fall weg.

**Neu:**
- `src/lib/kombi/motion.ts`: `E`, `spring()`/`SPRING` mit den 47 Stützpunkten, `reduce()`, `moveTo`, `swapText`, `flash`, `flip`, `rubber`, `raf2`, `buzz`.
- `src/lib/kombi/theme-color.ts`: setzt `content` beider `meta[name=theme-color]` für `paper`, `camera` und `table`, stellt sie zurück und reagiert auf Änderungen von `prefers-color-scheme`.
- `src/components/kombi/icon.tsx`: die 12 Pfade aus Z. 1016–1033, `span.ic` mit `s18` und `s20`.
- `src/components/kombi/shell.tsx`: Ebenen, Kontext `useKombi()` mit `openPage`, `popPage`, `toast`, `openSheet`, `openCam`, `openTisch` und `setView`; Zurück-Taste über `popstate` nur mit Stapel-Markierung, Stapel in `history.state`, Leeren bei echter Navigation, Formular-Unterseiten als oberste Ebene (alles nach 2.4).
- `src/app/api/tag/daten/route.ts` (`ladeTag` als JSON), `src/lib/kombi/aktion.ts` (optimistische Actions mit Fehler-Toast „Nicht gespeichert“ · „Erneut“, 2.4 Punkt 9).
- `src/components/kombi/{zeile.tsx,toast.tsx,sheet.tsx,seite.tsx}`.
- `src/lib/kombi/text.ts`: `tn`, `fx`, `esc` sowie die Datumsformate `kurz`, `lang`, `voll`, `dm` und `weekdayOrDate`, immer mit `timeZone: 'Europe/Berlin'`, damit Server und Client gleich formatieren.

**Löschen:** In A nichts. `src/components/nav/app-nav.tsx`, `swipe-pager`, `pager-context`, `day-timeline` und `dashboard` fallen in B (Ersatz: Startseite), `tile-grid`, `capture-pane` und `camera-pane` erst in C (Ersatz: Ablauf mit Kamera), siehe Abschnitt 4.

**Abnahme:**
- Leere Startseite mit Datumszeile und Zeile an der Stelle aus `screens/ab-00-*`.
- Hell und Dunkel wechseln ohne Neuladen (Kriterium 58).
- Nur Schibsted und Newsreader werden geladen, im Netzwerk-Panel ohne `fonts.googleapis.com`.
- Das Menü der Zeile geht per `clip-path` auf und zu.
- Toast mit Rückgängig; Fehler-Toast „Nicht gespeichert“ mit künstlich scheiternder Action.
- Zurück-Taste schließt Menü und Seite.
- Der Vertrag aus 2.4 mit den vier Playwright-Prüfungen dort (Abhaken auf Stapelseite, Zurück über Formular, Neuladen, Flugmodus). Für die Prüfung gibt es in A eine Probe-Stapelseite; die echten Seiten folgen in G.
- Kaltstart: Aufnahme mit Playwright-Video (`recordVideo`) bei 4× CPU-Drosselung, kein Bild zeigt Inhalt, der verschwindet und wiederkommt.
- `deploymentId` gesetzt: `/_next/…`-Anfragen tragen `?dpl=⟨rev⟩`.

**Tests:**
- `src/lib/kombi/motion.test.ts`: Die Feder ergibt 392 ms und 47 Punkte.
- `src/lib/kombi/text.test.ts`: Datumsformate in UTC und Berlin gleich.
- `scripts/pruef-kombi/stapel.mjs`: die Prüfungen aus 2.4.

### B — Startseite: Tageszeit, Morgens, Überblick (ohne Wiederholen), Zahnrad

**Vorlage:** Z. 1052–1132 (Uhr, Schulhelfer), 1335 (`ansicht`), 1627–1725 (`renderWhen`, `headlineFor`, `setHeadline`, `setView`, `visibilitychange`), 1727–1900 (Aufgabenzeile, Wischen, Durchstreichen), 1902–2084 ohne `#ovWh`, 4620–4687 (Kaltstart).

**Zuerst: Test-Harness für die Datenbank.** Das Repo hat bisher keinen DB-Test. `db` aus `src/db/index.ts` öffnet ohne `DATABASE_URL` immer `.data/pglite`. Ein Test, der `@/db` importiert, liefe also gegen die echte lokale Datenbank, bei laufendem Dev-Server mit zwei PGlite-Instanzen auf denselben Dateien (hat sie laut Skript-Kommentar schon einmal zerstört). Deshalb vor allen anderen Tests:
- `src/test/db-harness.ts`, als `setupFiles` in der Test-Konfiguration für alle `*.db.test.ts`: setzt `globalThis.__schulappDb` **vor dem ersten Import von `@/db`** auf `drizzle(new PGlite())` (Speicher) und legt das Schema per `pushSchema` aus `drizzle-kit/api` aus `schema.ts` und `schema-recall.ts` an. Jede Testdatei bekommt eine frische Instanz.
- Die neuen `kombi-*.sql` werden zusätzlich gegen eine Basis geprüft, die aus dem Schema **vor** der Änderung erzeugt ist (Stand `main`, per `pushSchema` aus einer Kopie der alten Schema-Dateien unter `src/test/schema-basis/`): einspielen mit derselben Prüfung wie `sql-einspielen.ts`, danach muss `pushSchema` mit dem neuen Schema **keine** Änderung mehr melden. Das prüft zugleich die Namen aus 3.3.
- Wächter-Test `src/test/db-harness.test.ts`: Nach dem Import von `@/db` ist `__schulappDb` die Speicher-Instanz, und `.data/pglite` wurde nicht geöffnet (Spion auf `PGlite`-Konstruktor mit `dataDir`).
- Tests „gegen PGlite“ in diesem Plan meinen immer diesen Harness.

**Neu:**
- `scripts/kombi-tagesprotokoll.sql`, Schema-Ergänzung, `src/lib/protokoll.ts`, `src/lib/tag.ts`, `src/lib/kombi/tag-daten.ts`;
- `src/app/api/tag/stand/route.ts`;
- `src/components/kombi/home/*`, `src/components/kombi/aufgabe-zeile.tsx` (alle Modi `mo`, `ov`, `ab`, `subj`, `page`, `page-sp`, `woche`, `menu`);
- die Actions aus 3.9 in `src/app/(app)/kombi-actions.ts`;
- die Testuhr-Weiche in `src/lib/tag.ts` samt Cookie-Setzer in `src/app/api/testuhr/route.ts` (antwortet 404 ohne `SCHULAPP_TESTUHR`).

**Ändern:**
- `src/app/(app)/page.tsx` lädt `ladeTag` und rendert die Ansicht.
- `guessEpochSubject()` zieht nach `src/lib/timetable.ts` um, die Epoche-Seite importiert es.
- Neu `juengstesThema()` in `materials.ts`.

**Datumszeile:**
- Das Datum zeigt wie im Prototyp (`renderWhen`, Z. 1627–1631) in **allen** Ansichten nur `voll(tag)`, Format „Montag, 12. Oktober“. In `frueh` ist das das Datum des nächsten Schultags. Es gibt **kein** „morgens“ dahinter und **keine** Pille „Jetzt“: Der Prototyp hat Vorrang vor V2 3.4 und Kriterium 12, die das vorsehen.
- Zurück aus `frueh` geht es wie im Prototyp über die Zeile („Überblick“ unter „Wohin?“) und über `visibilitychange`.
- Das Menü der Datumszeile (Überblick, Morgen früh, Nach der Schule; 300px breit laut `notiz.md`) baut der Prototyp **nicht** im Markup. Er erreicht „Morgen früh“ und „Nach der Schule“ über die Vorschläge der Zeile (Z. 2592ff.). **Der Bau folgt dem Prototyp:** keine Datumsmenü-Ebene, „frueh“ und „Nach der Schule“ nur über die Zeile. `.now-pill`, `.wmenu` und `.when.preview` werden nicht übernommen (A).
- Das Zahnrad öffnet `einstellungen`.

**Eingangskorb auf dem Überblick:** die Zeile „n Blätter im Eingangskorb ›“ aus 3.2.

**Löschen** (Ersatz steht jetzt): `src/components/nav/app-nav.tsx`, `src/components/home/{swipe-pager,pager-context,day-timeline,dashboard}.tsx`. `tile-grid`, `capture-pane` und `camera-pane` bleiben bis C über eine vorläufige Zeile „Blatt fotografieren“ auf dem Überblick erreichbar (nur lokal, siehe Abschnitt 4).
  - *Abweichung im Bau (B, Prüferbefund 6):* Die vorläufige Zeile „Blatt fotografieren“ ist **nicht** gebaut. Fotografieren bleibt über den Kameraknopf der Zeile erreichbar, der bis C nach `/material` mit `CaptureButton` führt — keine Funktion geht verloren, und der Überblick bleibt im Bild gleich dem Prototyp. `tile-grid`, `capture-pane` und `camera-pane` bleiben bis C ohne Aufrufer stehen und gehen mit C.

**Abnahme:**
- V2 Kriterien 1–11, 14–18 und 26–30.
- 32 (ohne Start, der in F kommt) und 33.
- Sollbilder `ab-00-zeit-*`, `r4-*morgens*` und die Überblick-Bilder ohne Wiederholen-Teil.
- Abhaken mit Toast „Mathe abgehakt“ und Rückgängig; die Zeile bleibt 350 ms stehen.

**Tests:**
- Harness und Wächter (oben).
- `src/lib/tag.test.ts`: `appTag` um 00:30 und 04:01, `ansicht` für alle 4 Fälle, Ferien, Samstag.
- `src/lib/protokoll.test.ts` gegen den Harness, darunter: Aufgabe löschen → Rückgängig → dieselbe `id` steht wieder, `eingetragenHeute()` zählt sie einmal, kein Eintrag `aufgabe_geloescht` mehr; unbekannter `typ` wird abgewiesen.
- Kalender-Abgleich: Alle vier Aufgaben-Actions und beide Rückgängig-Wege rufen `nachAufgabeGeschrieben` auf (Spion auf `requestCalendarSync`).
- Kaltstart: Seite mit `prefers-reduced-motion: reduce` hat nie `html.pre`.
- `src/lib/kombi/offene-fuer.test.ts`.
- `headlineFor`-Fälle mit Wortlaut („Zwei Aufgaben für Dienstag“, „Noch eine Aufgabe für Dienstag“, „… für Montag, 19.10.“).

### C — Ablauf nach der Schule (Blätter mit Kamera, Hausaufgaben)

**Vorlage:** Z. 2086–2260 (Ablauf), 3368–3758 (Kamera, `sheetItem`, `ablegen`, `landSheets`, `flyThumb`), 3608–3683 (Statuszeilen, Fach ändern).

**Neu:**
- `src/components/kombi/ablauf/*`, `src/components/kombi/kamera/*` (Sucher, Streifen, Kamerabogen, „Aus Fotos“, Vorwärmen bei `pointerdown`, `clip-path`-Wachsen aus dem Sucher);
- `src/app/api/blaetter/route.ts` (POST, 3.8);
- `src/lib/kombi/blaetter.ts` (`blaetterVomTag`, `blaetterKurz`, `fachAendern`);
- `abschriftErneutAction` (3.8) mit Fehlerzustand und Knopf „Erneut versuchen“.

**Kamera ohne Zugriff** (`finderMsg`, Z. 3381–3423, 3459), wörtlich:
- Im Sucher `.f-msg` zuerst „Kamera startet“.
- Bei Ablehnung oder ohne `getUserMedia` (Android-Chrome lehnt nach einmaligem Ablehnen oder ohne HTTPS still ab): „Kein Zugriff auf die Kamera“ mit dem Knopf „Foto auswählen“, der `#fileCap` (`<input type=file accept=image/* capture=environment>`) öffnet.
- In diesem Zustand öffnet auch ein Tipp auf den Auslöser die Dateiwahl.
- „Aus Fotos“ bleibt daneben bestehen.

**Ablauf aus dem Menü** (`ui.ablaufMenu`, `ablaufEnde()`, Z. 2244–2260), wörtlich übertragen:
- Der Zustand `ablaufAusMenu` gehört zur Ansicht auf `/` (Client-Zustand der Shell, kein Protokoll).
- „Nach der Schule“ erscheint in der Zeile nur an Schultagen nach Schulschluss und nur bei Stand `übersprungen`.
- Wird der Ablauf aus dem Menü geöffnet und dann wieder übersprungen, schreibt das **kein** zweites `ablauf_uebersprungen`. Abschließen schreibt `ablauf_beendet` wie sonst.

**Ändern:**
- `src/lib/auto-file.ts`: Fachvorgabe als Parameter.
- `src/components/material/camera.ts` und `prepare-page.ts` werden weiterverwendet und nur bei Bedarf angepasst.
- Die alten `capture-button.tsx` und `viewfinder.tsx` entfallen, sobald auch die Blatt-Seite „Seite dazu“ über die neue Kamera läuft (G).

**Löschen** (Ersatz steht jetzt): `src/components/home/{tile-grid,capture-pane,camera-pane}.tsx` und die vorläufige Zeile aus B.

**Abnahme:**
- Kriterien 5, 13 und 19–25.
- 55 (≤ 1,5 s bis zum ersten Bild, mit Testkamera gemessen), 56.
- Zeilenhöhe beim Einordnen bleibt 129px.
- „Seite dazu“ am obersten Blatt.
- Die Kamera schließt mit Ablegen.
- theme-color in der Kamera ist `#0B0B0C`.
- Sollbilder `r3-*` und `r4-*` für Ablauf und Kamera.
- Kamera mit **verweigerter** Berechtigung: Playwright **ohne** `--use-fake-ui-for-media-stream`, Berechtigung `camera` nicht erteilt → „Kein Zugriff auf die Kamera“, „Foto auswählen“ und Auslöser öffnen die Dateiwahl (`page.waitForEvent('filechooser')`).
- Gescheiterte Abschrift mit `?fehler=abschrift`: rote Zeile, „Erneut versuchen“, danach „Wird abgeschrieben …“.

**Tests:**
- Route Handler gegen den Harness: legt ein Blatt an, setzt ein vorläufiges Fach und `filed_at` null.
- `fachAendern`.
- `blaetterVomTag` über die 04:00-Grenze.
- Ablauf: Überspringen → „Nach der Schule“ → Überspringen ergibt genau einen Eintrag `ablauf_uebersprungen`.

### D — Eingabezeile: Parser, Eintragen, Suche

**Vorlage:** Z. 2262–2989 vollständig, `PARSER_SAETZE` Z. 4621.

**Neu:**
- `src/components/kombi/zeile/parser.ts`, rein und ohne DOM: `matchFach`, `findDue`, `fmtTask`, `parse`, die Wortlisten;
- `suche.ts`: `textWords`, `wordHit`, `hl`, `answerFor`, `suche`, `suggestions`;
- `menu.tsx`, `tokens.tsx`, `fachpillen.tsx`;
- `scripts/kombi-suche.sql`, `src/lib/suche.ts`, `src/app/api/suche/route.ts`;
- `zeilenVorrat` in `tag-daten.ts`.

**Fachaliase und `kurz`:** `FAECHER.alias` kommen aus `subjects.short` und einer festen Aliasliste je Fachname in `src/lib/kombi/fach-alias.ts`, etwa „Mathe“ → Mathematik oder „Bio“ → Biologie. Daneben steht die Tabelle Name → `kurz` (3.2). Beides wird aus dem Prototyp Z. 1094–1100 übernommen.

**Inline-Antworten:** `morgenAnswer`/`tagAns`, `notenAnswer`, `klausurAnswer`, `whAnswer`, `lernblockOpt` und Epoche lesen aus dem erweiterten `zeilenVorrat` (3.2) und erscheinen beim Tippen ohne Nachladen.

**Kalender:** Eintragen, Abhaken, Löschen, Ändern und Rückgängig aus der Zeile stoßen den Google-Abgleich an (3.9).

**Abnahme:**
- Kriterien 22, 51–54.
- „Wohin?“ mit neun Bereichen.
- Dublette „Steht schon drin“.
- Rückfrage „Bis wann ist ⟨Fach⟩ fällig?“.
- Geistflug ins Ziel.
- Volltextsuche findet „dampf“ in der Abschrift „Die Dampfmaschine“.
- Die Tastatur verdeckt die Zeile nicht (Android, `interactive-widget`).

**Tests:**
- `parser.test.ts` mit allen 23 Sätzen aus `PARSER_SAETZE`, Soll gleich Ist.
- Die vier Inline-Antworten „morgen“, „noten mathe“, „mathe klausur“ und „wiederholen mathe“ gegen einen festen `zeilenVorrat`, mit Wortlaut wie im Prototyp.
- „Mathe abgehakt“: Toast-Text aus `kurz`, nicht aus `short` („M“) oder `name`.
- Nach `aufgabeEintragenAction` über die Zeile wurde ein Kalender-Abgleich angestoßen (Spion auf `requestCalendarSync`).
- `findDue` mit Datum über den Jahreswechsel.
- `sucheBlaetter` gegen den Harness mit ä/ae.

### E — Wiederholen nach Themen (Tisch, Karten, Themenende)

**Vorlage:** Z. 1378–1413 (fällige Themen), 2016–2058 (`whState`, `renderWH`), 3760–4350 ohne Lernblock-Teile, 3333–3366 (Sheet „Blatt ansehen“).

**Neu:**
- `src/recall/themen.ts` (3.4);
- `src/components/kombi/tisch/*`;
- Actions `versuchThemaAction` und `urteilThemaAction`: rufen die bestehenden `versuchFesthalten` und `urteilFesthalten` mit `todayInBerlin()` auf (nicht `appTag`, siehe 3.1), unverändert in der Wirkung;
- `themaBeendenAction`: Protokoll `thema_beendet` {n};
- `frageZurueckziehenAction`: `retireItem` + Protokoll.

**Aufdecken ohne Warten** (`reveal()`, Z. 3929): Die Lösung kommt erst nach dem Versuch vom Server (A2), der Prototyp dreht aber sofort. Deshalb:
- Die Drehung startet beim Tipp sofort, gleichzeitig läuft `versuchThemaAction`.
- Die Rückseite wird am Halbdreh-Punkt (90°, Karte hochkant) gefüllt, wenn die Antwort da ist. Sonst hält die Karte hochkant an, bis die Antwort kommt, und dreht dann weiter.
- Der Versuch wird **nicht** vorab beim Verlassen des Felds abgeschickt: Was als Versuch gilt, bleibt wie im Prototyp der Inhalt beim Aufdecken.
- Scheitert die Anfrage, dreht die Karte zurück, und es erscheint der Toast „Keine Verbindung“ mit „Erneut“.

**Ändern:**
- `faelligHeute` (zusätzliche Felder);
- `naechsteKlausur` wird exportiert;
- `/abruf/sitzung` und `/abruf` leiten nach `/` um, `session-view.tsx` wird gelöscht (Ersatz steht jetzt). Vorher zieht „Termine neu rechnen“ nach `/abruf/bausteine` (2.2), damit er nicht verloren geht; die Seite bekommt ihren neuen Stil erst in G.

**Abnahme:**
- Kriterien 31, 34–50 und 44 (der Knopf zählt beim Schrumpfen schon um).
- „Stelle im Blatt“ wächst bis 30px über die Knöpfe.
- Die Lösung kommt erst nach dem Versuch an den Browser (A2), geprüft im Netzwerk-Panel.
- Mit künstlicher Latenz von 800 ms (Playwright `route` mit Verzögerung): Die Karte dreht sofort an, hält hochkant und zeigt die Rückseite gefüllt; ohne Netz dreht sie zurück und zeigt „Keine Verbindung“.
- Sollbilder Tisch beim Antworten, mit Lösung, Themenende, Zurückziehen (`r4-*`).
- theme-color `#2A44C0` / `#121A4E`.
- Reduzierte Bewegung nur als Überblenden.

**Tests:**
- `themen.test.ts` gegen PGlite:
  - Sortierung nach 2.5;
  - Alias-Kette;
  - „ohne Thema“;
  - angefangenes Thema zuerst, auch über ein gedrucktes, nicht ausgewertetes Arbeitsblatt (die Tabelle `arbeitsblaetter` legt der Harness aus dem Schema an, auch wenn H noch nicht gebaut ist; sonst wandert dieser Fall nach H);
  - Ferien leer;
  - Versuch um 00:30: `answered_on` ist der Kalendertag, das Themenende zählt ihn trotzdem zum App-Tag;
  - **Termine unverändert:** Snapshot von `recall_schedule` vor und nach einer ganzen Runde. Nur `done_at` bei „Saß“ hat sich geändert.

### F — Lernblock und Klausur

**Vorlage:** Z. 1343–1376 (Plan und Block), 1970–2014 (Klausurzeile, `updateBlockUI`), 3009 (`planRows`), 3112 (Seite `klausur`), 4041–4237 (Kopf, Material, `blockBeenden`, `zeitUm`, `clockLoop`), 4238–4313 (`openTisch` im Block).

**Neu:**
- `scripts/kombi-lernblock-uhr.sql`, `src/lib/lernblock.ts`;
- Actions für Start, Pause, Fortsetzen, Beenden und Erledigt;
- `src/components/kombi/seiten/klausur.tsx`, `klausuren.tsx`;
- Zeile „verpasster Lernblock“ (3.5);
- Schutz angefangener Blöcke in `generatePlan`, `catchUpMissed`, `moveOffFreeDays`, `setTopics` (3.5).

Alle Festwerte (`KLAUSUREN[0]`, `'ma-qf'`, `F('ma')`, `'b7'`) kommen aus `planHeute()[0]`, also aus `blocksForDay` und der Klausur des Blocks.

**Lernplan auf der Klausurseite** (übernimmt alles von `/lernen` und `study-plan-view.tsx`, Ausnahme in 1.1):
- Jeder Block jedes Tages ist eine Planzeile in der Gestalt von `.task`. Der heutige Block trägt wie im Prototyp „Starten“/„Weiter“.
- Ein **Tipp** auf eine Planzeile oder der **Linkswisch** schaltet erledigt ↔ offen über `setBlockStatusAction`, optimistisch (2.4 Punkt 9), mit Toast „Lernblock erledigt“ bzw. „Lernblock wieder offen“ und Rückgängig. So lässt sich ein versehentlich erledigter Block wieder öffnen und ein gestriger ohne Uhr abhaken. Ein laufender Block (3.5) schaltet nicht per Tipp, sondern öffnet die Uhr.
- Über dem Lernplan als `.p-sub`: die Fortschrittszeile „n von m Blöcken erledigt · k gestrichen“, „⟨min⟩ min am Tag · ⟨n⟩ Tage Vorlauf“ und, falls vorhanden, der `warningText` aus `plan.warnings` (`tight`: nur ein Lerntag; `no-days`: Prüfung heute), Wortlaut wie heute.
- **Ohne Themen:** statt des Plans ein `.p-sub` mit dem heutigen Leertext und darunter die Zeile „Themen eintragen“ (`.textline` mit Chevron) → `/klausuren/[id]/bearbeiten`.
- Unten, nach „Lernplan neu erstellen“: die Zeile **„Termine neu rechnen“** (`neuPlanenAction`) mit dem Erklärsatz als `.p-sub`: „Nach einer neuen oder verschobenen Klausur: legt die Wiederholungstermine wieder vor die Klausur. Am Takt ändert sich nichts.“ Toast danach mit der Zahl der neu gelegten Termine, wie heute auf `/abruf`.

**Push-Erinnerungen** (`src/app/api/cron/reminders/route.ts` Z. 165, 189, 199, heute alle `url: "/lernen"`):
- „Heute lernen“ (`dailyMessage`, Z. 165): ein Block oder alle Blöcke zur selben Klausur → `/klausuren/[examId]`; Blöcke zu mehreren Klausuren → `/` (Überblick mit der Lernblockzeile);
- Countdown für eine Klausur (Z. 189) → `/klausuren/[examId]`;
- Countdown für mehrere Klausuren (Z. 199) → `/klausuren`;
- die Testbenachrichtigung unter `/einstellungen/erinnerungen` → `/` (mitprüfen, wohin sie heute zeigt).
Ein Tipp auf die Benachrichtigung öffnet die Seite im Stapel über der Startseite (2.1, direkter Aufruf).

**Abnahme:**
- Kriterium 32 vollständig.
- Lernblock-Zustände aus der Tabelle in Abschnitt 5 des Ansichten-Berichts: Starten, Restzeit, Weiter, Pausiert bei, Auswerten, Erledigt.
- Die Uhr überlebt Schließen und Neuladen (Server-Stand).
- „Als erledigt zählen? n Minuten gelernt“.
- Unter 1 Minute bleibt keine Spur im Protokoll.
- Kriterium 47.
- Gestrigen Block per Tipp abhaken, erledigten wieder öffnen, Rückgängig.
- Warnung `tight` und Leerzustand ohne Themen sichtbar (Saat mit passender Klausur).
- „Termine neu rechnen“ nach Verschieben der Klausur: kein Termin liegt danach hinter der Klausur.
- Testbenachrichtigung antippen → `/`; Lernblock-Erinnerung (per Cron-Aufruf mit Testuhr) → Klausurseite.

**Tests:**
- `lernblock.test.ts`: Restzeit über Pause und Neuladen.
- `fragenFuerLernblock` filtert auf die Klausurthemen.
- Block starten, Klausur speichern (`generatePlan`), Ferien darüberlegen (`moveOffFreeDays`), `catchUpMissed`: Block, Uhrstand (`laeuft_seit`, `pause_ms`) und Tag stehen unverändert.
- Erinnerungs-URLs: keine enthält mehr `/lernen`.

### G — Nachschlage- und Unterseiten im neuen Stil

**Vorlage:** Z. 2991–3331 (alle `PAGES`), 3203–3241 (`themaArtRow`).

**Neu:** Seitenkomponenten und Loader nach Abschnitt 2.2 und 3.2; `src/app/api/seite/[art]/route.ts`; Formular-Bausteine `src/components/kombi/form/*`. Laden, Fehler, Offline und Formular-Ebenen nach 2.4.

**Ändern**, jeweils im Stil nach 2.3:
- alle `page.tsx` der Routen aus 2.2 (Server-Variante derselben Komponente);
- alle Formular-Unterseiten: Hausaufgaben, Klausuren, Noten mit Zielrechner, Fächer, Themenpflege, Stundenplan-Editor, Zeiten, Epoche, Material bearbeiten, Eingangskorb, Bausteine, Abruf-Eingang, Klausur-Stoff;
- **Material bearbeiten** (`/material/[id]/bearbeiten`) mit allen bisherigen Feldern: Fach, Titel, Datum, Notiz, Themen und je Seite das Abschrift-Feld (2.2, Zeile `blatt`); auf der Blattseite Laufzeile und Kostenzeile als `.p-sub` unter „Abschreiben lassen“, Themen als `.textline` → `/material?thema=`;
- **Fächer:** Archiv-Zeile „Archiviert · n“ auf `faecher`, „Wieder aufnehmen“ auf der Fach-Seite archivierter Fächer;
- **Hausaufgaben:** „Erledigt“ nur 2 Tage, Leertext „Für ⟨Tag⟩ ist nichts offen.“; **Klausuren:** vergangene in derselben Liste (2.2);
- **Epoche wechseln** zusätzlich auf `/stundenplan/bearbeiten` und in der Einstellungszeile „Epoche“ (mit Rückfall ohne erkannte Epoche);
- `/abruf/bausteine` im neuen Stil mit der Zeile „Termine neu rechnen“ samt Erklärsatz (wie F);
- die Einstellungen in Unterseiten aufteilen;
- `(auth)`-Seiten, `verbinden`, `datenschutz`, `offline`, `not-found`;
- `/lernen` leitet um.

Am Ende: `src/components/ui/*`, `src/components/grades/average-bar.tsx` und alle verbliebenen alten Komponenten löschen, die alten Token-Namen aus `globals.css` entfernen.

**Abnahme:**
- Jede Route aus der Liste in Abschnitt 2 ist per Klick erreichbar, Liste abgehakt. Dazu diese Funktionen, die nur über eine Zeile erreichbar sind:
  - [ ] „Termine neu rechnen“ auf `/abruf/bausteine` und auf der Klausurseite;
  - [ ] Abschrift einer Seite von Hand abtippen (`/material/[id]/bearbeiten`), Fach und Datum eines Blatts ändern;
  - [ ] Themenfilter `/material?thema=` über die Blattseite;
  - [ ] archiviertes Fach wieder aufnehmen;
  - [ ] Epoche wechseln ohne erkanntes Epochenfach;
  - [ ] Eingangskorb über den Überblick;
  - [ ] Block auf der Klausurseite abhaken und zurücknehmen.
- Wisch vom linken Rand geht zurück, Android-Zurück ebenso.
- Fach → Noten → Note eintragen → Android-Zurück zweimal: Fach-Seite, dann Startseite; die Formularseite fährt ein und aus wie `openPage`.
- Flugmodus nach einem Besuch: Hausaufgaben und Woche öffnen aus dem Cache mit „Ohne Verbindung · Stand …“.
- Seiten fahren erst mit Daten ein (Playwright mit 800 ms Latenz: nach 150 ms nur der Titel, dann der Inhalt).
- Ein direkter Aufruf jeder URL rendert ohne Fehler.
- Google-Callback landet auf `/einstellungen/kalender`.
- Abmelden funktioniert.
- Sollbilder Noten, Klausur, Fach, Ablage, Blatt, Woche, Einstellungen.

**Tests:** Loader-Tests für jede Seite gegen den Harness (serialisierbar, keine Drizzle-Objekte; Hausaufgaben ohne Erledigte älter als 2 Tage; Fächer mit archivierten getrennt); `scripts/probe-kombi-routen.mjs` ruft alle Routen ab und erwartet 200 oder die Umleitung.

### H — Arbeitsblätter und Art je Thema

**Vorlage:** Z. 1227–1281 (`artAbgeleitet`, `UEBUNG`), 3203–3241, 4352–4618 (A4, Vorschau, Bewerten, Drucken, Lupe), Druck-CSS Z. 777–820.

**Neu:**
- `scripts/kombi-themen-art.sql`, `scripts/kombi-arbeitsblaetter.sql`, `scripts/kombi-arbeitsblaetter-checks.sql` (3.6) samt Ausnahme in `scripts/sql-einspielen.ts`;
- `LeserLaufArt` um `'arbeitsblatt'` erweitert, Lauf- und Kostenanzeige beschriftet die Art;
- `src/lib/themen-art.ts`;
- `src/lib/arbeitsblatt/{bauen.ts,auftrag.ts,schema.ts,quelle.ts}`:
  - Muster `fragenlauf.ts`: Warteschlange an `globalThis`, `claudeRufen` mit zod-Schema, `laufVermerken`;
  - Eingabe sind die Abschriften der Blätter des Themas;
  - jede Aufgabe trägt ein `zitat`, das wörtlich in der Abschrift stehen muss, außerhalb von ⟨⟩ (wie `createItem`, A5);
  - Aufgaben ohne Treffer werden verworfen;
  - weniger als 5 gültige Aufgaben ergeben den Status `fehlgeschlagen`;
  - Frist, Versuche und Neuanstoß per UPDATE wie in 3.6 („Hängende und gescheiterte Läufe“).
- **Vorab bauen:** Per `after()` beim Laden von `/` und im Cron `cron/reminders` für Übungsthemen, die heute oder morgen fällig sind, und für Lernblöcke von heute und morgen. Höchstens ein Blatt je Thema und Tag (Unique-Index) **und höchstens eins je Termin**: Für ein Thema, dessen jüngstes Blatt ausgewertet ist, wird erst wieder gebaut, wenn nach `ausgewertet_am` ein neuer Termin fällig wird (3.4). Ohne diese Regel entstünde bei Frage 3 (b) jeden Tag ein neues Blatt und ein Opus-Aufruf.
- **Blatt für einen Block ohne Fach-Thema** (Gesamtwiederholung, Klausurthema ohne `subject_topic_id`): hängt nur am Block, Quelle sind alle Klausurthemen mit Fach-Thema; ohne jede Quelle kein Blatt, der Block läuft mit Karten und Material (3.6).
- `src/components/kombi/a4/{seite.tsx,kaestchen.tsx,loesung.tsx}`: rendert `inhalt` als Text (nie `innerHTML`); die Formeln über `fx` als React-Elemente.
- `src/components/kombi/tisch/arbeitsblatt/*` (Vorschau, Lupe, Wertung).
- Actions:
  - `gedrucktAction`: `gedruckt_am`, Protokoll `blatt_gedruckt`;
  - `bewertenAction`: `arbeitsblatt_wertung`;
  - `auswertenAction`: `ausgewertet_am`, Protokoll `blatt_ausgewertet` {n, richtig}; beim Blatt des heutigen Lernblocks zusätzlich `blockErledigt(…, perWH)`;
  - `artAction`.
- **PDF:** `src/lib/pdf/arbeitsblatt-document.ts` und `src/app/api/arbeitsblatt/[id]/pdf/route.ts` mit pdfkit. Die Gestaltung bildet das A4 des Prototyps nach (Maße in mm, Kästchen 5 mm, Linien 9 mm). Schriften: statische TTF-Instanzen von Schibsted Grotesk (450, 650) und Newsreader (Kursiv, opsz 24) unter `assets/schriften/`, DejaVu als Rückfall.

**Drucken:**
- „Arbeitsblatt drucken“ legt die zwei A4-Seiten in `#druck` und ruft `window.print()` auf. Das ist dieselbe Gestaltung wie Vorschau und Lupe.
- Öffnet `window.print()` in der installierten Android-App keinen Druckdialog (zuerst prüfen!), öffnet derselbe Knopf stattdessen das PDF der Route. Der Android-PDF-Betrachter druckt.
- Die Wahl trifft der Client einmal per Erkennung `matchMedia('(display-mode: standalone)')`, sobald das Gerät gemessen ist.

**Ohne fertiges Blatt:** Ist das Blatt beim Öffnen noch nicht fertig (`wartet`, `laeuft`), steht an der Stelle der Vorschau der Text „Das Blatt wird gerade gebaut.“ in 15/450 `--t-on`. Die Seite fragt alle 3 s nach, aber nur bis zu einem Endstatus (`fertig`, `fehlgeschlagen`) oder bis `frist_bis` abgelaufen ist. Das ist die einzige neue Gestalt; der Prototyp kennt keinen Ladezustand.

**Blatt `fehlgeschlagen`** (unter 5 quellgebundene Aufgaben oder 2 gescheiterte Versuche):
- **Tisch:** An der Stelle der Vorschau steht derselbe ruhige Satz in derselben Gestalt: „Für dieses Thema ließ sich heute kein Blatt bauen.“ Darunter der vorhandene Weg „Dieses Thema lieber abfragen“, der für heute auf Karten umschaltet (ohne `art` zu speichern). Hat das Thema keine Fragen, entfällt der Weg, und das Thema erscheint nicht in `faelligeThemen` (3.4).
- **Überblick:** Die Unterzeile unter „Wiederholen“ nennt das Thema mit „n Fragen“ statt „Arbeitsblatt“, bzw. das Thema fehlt.
- **Lernblock:** Der Block läuft mit Karten (`fragenFuerLernblock`) und Material, wie ein Block ohne Blatt.
- Das Nachfragen endet sofort.

**Abnahme:**
- Die 6 Kriterien aus `ZUSATZ-ARBEITSBLAETTER.md`.
- Die Vorschau zeigt Seite 1 ganz und die Überschrift von Seite 2.
- Die Lupe bricht auf Bildschirmbreite um.
- Der Druck ergibt zwei A4-Seiten ohne Ränder des Browsers.
- Das PDF stimmt mit dem Druck überein (Bild nebeneinander).
- „Gelöstes Blatt fotografieren · bald“ ist sichtbar und ohne Funktion.
- Sollbilder `ab-*`.

**Tests:**
- Quellbindung (erfundene Aufgabe wird verworfen);
- `themaArt`-Ableitung;
- `buildArbeitsblattPdf` ohne Datenbank (Seitenzahl 2, Schriften eingebettet);
- Termine nach der Auswertung: bei (a) haben genau die am Auswertungstag fälligen Termine der Fragen des Themas `done_at`, alle anderen `due_on` sind unverändert; bei (b) ist `recall_schedule` vollständig unverändert (Snapshot);
- **Thema ausgewertet am 12.10. mit nächstem Termin 16.10. erscheint am 13.10. nicht** in `faelligeThemen`, „Wieder dran“ nennt den 16.10., und am 16.10. ist es wieder da (gilt für (a) und (b));
- Vorab-Bauen: Nach der Auswertung entsteht am 13., 14. und 15.10. kein neues Blatt;
- Lauf mit `art='arbeitsblatt'` einfügen (3.6), Lauf mit hängender `frist_bis` wird per UPDATE neu angestoßen, dritter Versuch am selben Tag wird abgelehnt;
- Blatt für Gesamtwiederholungs-Block ohne Fach-Thema wird angelegt;
- `fehlgeschlagen`: Thema mit Fragen erscheint als „n Fragen“, ohne Fragen gar nicht.

---

## 5. Prüfweg

1. **Lokale Datenbank und Saat.**
   - Den Entwicklungsserver **aus**schalten: zwei PGlite-Instanzen auf `.data/pglite` zerstören sie. Vorher `npm run db:backup`.
   - **Ältere Tabellen von `main` zuerst.** `kombi-arbeitsblaetter.sql` und `-checks.sql` brauchen `leser_laeufe`. Fehlt sie der lokalen `.data/pglite` (Fehler `relation "leser_laeufe" does not exist`), entweder vorher die älteren SQL-Dateien in der README-Reihenfolge einspielen (`leser-tabellen.sql`, `leser-laeufe-tabelle.sql` usw.) oder, einfacher, eine **frische Datenbank** aufbauen: `npm run db:backup`, `.data/pglite` beiseite legen, `npm run db:push`, dann die Saat. `db:push` legt das ganze Schema einschließlich der kombi-Tabellen an; die SQL-Dateien sind dann schon erfüllt.
   - Die neuen SQL-Dateien **einzeln in dieser Reihenfolge** mit `npx tsx scripts/sql-einspielen.ts <datei>` einspielen: `kombi-tagesprotokoll.sql`, `kombi-lernblock-uhr.sql`, `kombi-suche.sql`, `kombi-themen-art.sql`, `kombi-arbeitsblaetter.sql`, `kombi-arbeitsblaetter-checks.sql`. Die letzte geht nur mit der Tausch-Ausnahme aus 3.6 durch. Danach `npx tsx scripts/saat-abruf.mts` (Konto „Probe“, Passwort `probe1234`, steht in der Datei).
   - **Neu `scripts/saat-kombi.mts`** legt im Konto „Probe“ die Beispieldaten aus V2 Abschnitt 2 an (Woche, Hausaufgaben, Mathe-Klausur Fr 16.10. mit Lernplan, Noten, Blätter mit Abschrift, drei fällige Themen am Montag). Damit lassen sich Prototyp und App mit denselben Daten nebeneinanderlegen.
2. **Produktionsbau:** `npm run build && SCHULAPP_TESTUHR=1 npx next start -p 3100`. Auf dem NAS wird `SCHULAPP_TESTUHR` nie gesetzt.
3. **Uhr:**
   - App: `http://localhost:3100/api/testuhr?jetzt=2026-10-12T07:10`, danach `/`.
   - Prototyp: `index.html?jetzt=2026-10-12T07:10&reset`.
   - Beide mit denselben Zeitpunkten aus V2 15.1.
4. **Playwright** (`playwright-core`, Skripte unter `scripts/pruef-kombi/*.mjs`):
   - Chromium mit `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, **nie eine echte Kamera**.
   - **Vor jedem Kameratest** das Label der Videospur prüfen (`track.label` muss die Testkamera sein, z. B. `fake_device_0`). Sonst bricht das Skript ab.
   - Größen 390×844, 360×800 und 375×667, je mit `colorScheme: 'light'` und `'dark'`, Gerät mit Touch und `isMobile`.
   - Je Kriterium ein Bild der App und eins des Prototyps mit gleichem Namen nach `scratchpad/kombi-vergleich/`. Abgleich mit Augen und Pixel-Differenz; Abweichungen werden behoben oder begründet.
   - Messung: Konsole ohne Fehler, alle Bedienelemente ≥ 44×44, Kontraste ≥ 4,5.
5. **Statisch:** `npx tsc --noEmit`, `npm run lint`, `npm test`. Alles grün vor jedem Commit.
6. **Am Handy:** Jeder Abschnitt wird am Android-Handy durchgeklickt, hell und dunkel (Memory „Im Browser durchklicken“, „Grüne Prüfungen finden es nicht“), und zwar bis H **nicht** in der installierten NAS-App, sondern am Testbild des Macs über einen eigenen Funnel bzw. `next dev --experimental-https` (Abschnitt 4). Das Testbild lässt sich am Handy zusätzlich als Web-App installieren, um standalone, theme-color und Zurück-Taste zu prüfen. Für die Kamera gibt es über LAN ohne HTTPS keinen Zugriff.
7. **NAS, erst nach Abnahme von H:**
   - `scripts/nas.sh`: `PFLICHTSPALTEN` um je eine Zeile pro neuer SQL-Datei ergänzen, damit `hoch` ohne eingespielte SQL anhält:
     ```
     tagesprotokoll typ scripts/kombi-tagesprotokoll.sql
     study_blocks pause_ms scripts/kombi-lernblock-uhr.sql
     subject_topics art scripts/kombi-themen-art.sql
     arbeitsblaetter inhalt scripts/kombi-arbeitsblaetter.sql
     leser_laeufe arbeitsblatt_id scripts/kombi-arbeitsblaetter.sql
     ```
     Den getauschten CHECK und die GIN-Indizes prüft `hoch` nicht, sie stehen nur in der Anleitung (die Suche läuft ohne Index nur langsamer; ein fehlender CHECK-Tausch zeigt sich beim ersten Arbeitsblatt-Lauf als Fehler im Lauf, nicht als 500).
   - Die SQL-Dateien **zuerst** in die NAS-Datenbank einspielen (`psql -v ON_ERROR_STOP=1 --single-transaction`, in der Reihenfolge aus 5.1), **dann** das neue Bild bauen (`scripts/nas.sh hoch`, mit `NEXT_DEPLOYMENT_ID` aus A).
   - Danach `/api/tag/stand` prüfen und am Handy öffnen. Die SW-Version zählt hoch, daher lädt die App einmal neu.
   - Google-Kalender: eine Aufgabe über die Zeile eintragen und abhaken, im Kalender „Schule“ prüfen.

---

## 6. Risiken und offene Fragen

**Risiken**
- **Umfang:** fast die ganze Oberfläche neu. Deshalb streng in der Reihenfolge A–H, jeder Abschnitt abgenommen, bevor der nächste beginnt.
- **Versionsversatz nach dem Neubau** („Failed to find Server Action“): `deploymentId`, SW-Version und eine Fehlerbehandlung, die in diesem Fall neu lädt.
- **`window.print()` in der installierten Android-App** ist ungeprüft. Der PDF-Weg fängt das ab.
- **Arbeitsblätter kosten je Blatt einen Opus-Aufruf** und dauern Minuten. Deshalb vorab bauen; die Kosten erscheinen in den Einstellungen unter „Handschrift abschreiben“ bei den Läufen.
- **04:00-Tag:** Anzeige, Protokoll und Lesen verwenden `appTag`, die Schreibwege des Abrufkerns bleiben beim Kalendertag (3.1). Wo das zwischen 0 und 4 Uhr auseinanderläuft, sichern Tests in B und E ab.
- **Stapel am Router vorbei:** Der Vertrag in 2.4 ist die heikelste Stelle des Baus. Er wird in A zuerst gebaut und mit Playwright geprüft, bevor eine echte Seite darauf steht.
- **Lange Zeit ohne Deploy:** Bis H läuft der NAS mit `main`. Fixes, die in dieser Zeit auf `main` nötig werden, werden nach `modell-23` übernommen (rebase oder merge), damit am Ende kein Versatz entsteht.
- **theme-color zur Laufzeit** greift am DOM vorbei. Next setzt das Tag bei Navigationen eventuell zurück, deshalb nach jedem `popPage` und `closeTisch` erneut setzen.
- **Container in UTC:** Alle Zeiten laufen über `Europe/Berlin`, gleich formatiert auf Server und Client, sonst gibt es Hydration-Fehler.

**Fragen an den Nutzer** (der Bau nimmt bis zur Antwort den Vorschlag; Antwort etwa „1 ja, 3 b“):
1. **Desktop:** ~~Auch am Rechner nur die 390px-Spalte?~~ **Antwort 12.10.2026: nein.** Umsetzung siehe 2.1: volle Fensterbreite, Inhalt zentriert bis 680px, sonst gleiche Gestaltung.
2. **Umschalter Hell/Dunkel** in den Einstellungen streichen, nur noch nach System? **Antwort 12.10.2026: ja.**
3. **Ausgewertetes Arbeitsblatt und Termine** (neu gestellt). `ZUSATZ-ARBEITSBLAETTER.md` verlangt: „Das Ergebnis geht in die Wiederholung ein und plant das Thema wie eine Kartenrunde neu ein“, der Prototyp zeigt danach „Wieder dran: Dienstag, 13.10.“. Alle Termine eines Bausteins sind schon im Voraus geplant (`planeFaelligkeiten`), es muss also nichts neu gerechnet werden.
   - (a) Die am Auswertungstag fälligen Termine (`due_on ≤ heute`, offen) der Fragen des Themas bekommen `done_at`, genau wie nach einer Kartenrunde, in der jede Frage am Ende „Saß“. Die übrigen Termine und alle Abstände bleiben. Folge: `done_at` hat eine zweite Quelle (Auswertung statt „Saß“). Das Thema ist am nächsten Tag nicht fällig, „Wieder dran“ stimmt ohne Sonderregel.
   - (b) Die Termine bleiben offen. Dann bleibt ein altes `due_on ≤ heute` stehen, das Thema wäre ohne Gegenmaßnahme **ab morgen jeden Tag** fällig und stünde als ältestes ganz vorn, und das Vorab-Bauen erzeugte jeden Tag ein neues Blatt (je ein Opus-Aufruf). (b) geht deshalb nur zusammen mit einer Leseregel: `faelligeThemen` blendet ein ausgewertetes Übungsthema bis zum nächsten offenen Termin nach `ausgewertet_am` aus, und gebaut wird höchstens ein Blatt je Termin (3.4, H). Die alten Termine bleiben dauerhaft offen; wird das Thema später auf „abfragen“ umgestellt, sind sie sofort alle fällig.

   **Antwort 12.10.2026: a, bestätigt.** *Vorschlag war: a.* Es passt zum Wortlaut der Zusatz-Vorgabe, rechnet keinen Termin neu und braucht keine Sonderregel beim Lesen. Die Leseregel und die Grenze „ein Blatt je Termin“ werden trotzdem gebaut, sie schaden bei (a) nicht. Die Entscheidung vom 15.9.2026 betrifft den Takt, nicht `done_at`; trotzdem ist (a) eine neue Quelle und soll von dir bestätigt werden.
4. **„Probeklausur“** im Lernplan: weglassen (der Plan kennt nur Lernen und Wiederholung) oder als neue Art einführen? *Vorschlag: weglassen.*
5. **Grammatik erkennen:** Ist die Stichwortliste im Thementitel recht (3.6), plus Umstellen von Hand? *Vorschlag: ja.*
6. **Fragen und Termine ohne Klausur** (Französisch, Epoche, V2 16.3 Nr. 3 und 4): erst nach deiner Bestätigung. Bis dahin erscheinen solche Themen nur, solange sie Termine haben. *Vorschlag: getrennt entscheiden, nicht Teil dieses Baus.*
7. **Arbeitsblätter vorab bauen:** für Übungsthemen, die heute oder morgen fällig sind, und für Lernblöcke von heute und morgen, höchstens eins je Thema und Tag? *Vorschlag: ja.*
8. **Fachfarben:** Der Prototyp zeigt keine. Die Farben bleiben gespeichert und im Fach-Formular, werden aber nirgends angezeigt? *Vorschlag: ja.*
9. **Bis zum Ende nichts auf den NAS:** Die installierte App bleibt bis zur Abnahme von H auf dem heutigen Stand, geprüft wird am Handy über ein Testbild vom Mac (Abschnitt 4). Das dauert mehrere Abschnitte lang. *Vorschlag: ja*, sonst fehlen dir zwischendurch Kamera, Wiederholen, Noten und Ablage.
10. **Übungszeit nach Mitternacht:** Antworten zwischen 0 und 4 Uhr werden weiter mit dem Kalendertag gespeichert (wie bisher und wie der Takt rechnet), nur die Anzeige zählt sie zum Vortag (3.1). *Vorschlag: so lassen.* Soll stattdessen auch das Speichern den 04:00-Tag nutzen, ändert das die Bedeutung von `answered_on` und `gap_days`.
11. **Vergangene Klausuren und erledigte Hausaufgaben:** wie im Prototyp vergangene Klausuren in derselben Liste ohne „Vorbei“-Abschnitt, erledigte Hausaufgaben nur 2 Tage lang (2.2). *Vorschlag: ja, wie der Prototyp.*
