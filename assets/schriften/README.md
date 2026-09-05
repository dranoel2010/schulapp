# Die Schriften für das Fach-PDF

Hier liegen Schriftdateien, die **der Server** beim Erzeugen eines PDF liest. Sie gehören
ausdrücklich nicht nach `public/`: der Browser braucht sie nie, dort läuft die App mit
`next/font/google` und bekommt Geist als woff2 ausgeliefert.

## Warum zwei Schriften und nicht eine

Weil keine von beiden allein reicht. Gemessen am 5.9.2026, indem die cmap-Tabelle der
Dateien ausgelesen und gegen die Zeichen gehalten wurde, die auf Leos Blättern wirklich
vorkommen:

| Gruppe | Geist | DejaVu Sans |
|---|---|---|
| Deutsch (ä ö ü ß „ " – … § €) | vollständig | vollständig |
| Französisch (à â ç é è ê î ô û ÿ œ « ») | vollständig | vollständig |
| Hochzahlen und Tiefzahlen (⁰–⁹ ₀–₉) | vollständig | vollständig |
| Brüche (½ ⅓ ¼ ¾ ⅔) | vollständig | vollständig |
| Koordinaten (° ′ ″) | vollständig | vollständig |
| Mathematik | **fehlen: ∈ ⊂ α β γ Δ θ σ** | vollständig |
| Haken und Kreuze (✓ ✗) | **fehlen** | vollständig |
| Die ⟨spitzen Klammern⟩ (U+27E8, U+27E9) | **fehlen** | vollständig |

Geist hat also ≈ ≤ ≥ ∞ π √ ∑ → ± × ÷ ≠ ∫ λ μ Ω — aber nicht die griechischen
Kleinbuchstaben und nicht die Mengenzeichen. Und genau die stehen in Mathe- und
Physikheften. Mathematik hat acht Wochenstunden; das ist absehbar das Fach mit den meisten
Blättern.

**Die letzte Zeile kam beim Bauen des PDF dazu und ist die wichtigste.** ⟨ und ⟩ sind die
Zeichen, mit denen ein Agent markiert, was er nicht sicher lesen konnte (`UNCERTAIN_OPEN` in
src/lib/transcripts.ts). Sie stehen nicht in Mathe-Sonderfällen, sondern in fast jeder
Abschrift. Ohne DejaVu stünde in jedem PDF an jeder unsicheren Stelle ein leeres Kästchen —
das Auffangnetz ist damit nicht die Ausnahme, sondern der Normalfall.

Nachgezählt wurde am selben Tag auch die Gesamtzahl: DejaVu Sans deckt **genau 5918
Codepoints** ab, Geist-Regular 726. Der cmap-Leser in src/lib/pdf/font-coverage.ts rechnet
diese Zahl im Test nach; verschiebt sie sich, stimmt entweder die Datei nicht mehr oder der
Leser.

Zum Vergleich mit ausprobiert und verworfen: **Noto Sans** hat die griechischen Buchstaben,
aber keine mathematischen Operatoren (die liegen bei Noto in einer eigenen Datei — Noto ist
nach Schriftsystemen getrennt). **STIX Two Text** ebenso. Nur DejaVu Sans hat mit 5918
Zeichen wirklich alles.

## Wie sie zusammenarbeiten

**Geist ist die Schrift, DejaVu ist das Auffangnetz.** Das PDF wird in Geist gesetzt, damit
es aussieht wie die App — dieselbe Schrift, die auf dem Bildschirm steht. Nur für die
einzelnen Zeichen, die Geist nicht hat, wird auf DejaVu umgeschaltet.

Der Weg dorthin ist keine Vermutung zur Laufzeit: welche Zeichen eine Schrift kann, steht in
ihrer cmap-Tabelle und lässt sich einmal auslesen. Der Text wird danach in Abschnitte
zerlegt — alles, was Geist kann, in Geist; der Rest in DejaVu.

Die Alternative wäre gewesen, das ganze PDF in DejaVu zu setzen. Dann sähe es aus wie ein
Behördenformular und nicht wie diese App.

## Die Dateien

| Datei | Größe | Herkunft |
|---|---|---|
| `Geist-Regular.ttf` | 126 KB | Statische Fassung, aus `next/dist/compiled/@vercel/og` kopiert |
| `Geist-Variabel.ttf` | 169 KB | Variable Fassung aus dem Google-Fonts-Verzeichnis, für Schnitte jenseits von Regular |
| `DejaVuSans.ttf` | 740 KB | Version 2.37 |

Die statische Fassung liegt hier als **eigene Kopie** und wird nicht aus `node_modules`
gelesen. Der Unterschied ist wichtig: eine Datei tief in einem fremden Paket ist keine
Zusage — sie kann mit dem nächsten `npm install` an einer anderen Stelle liegen oder gar
nicht mehr da sein, und dann fehlt dem PDF ohne Vorwarnung die Schrift.

Die variable Fassung ist mitgekommen, weil Vercel keine statischen Schnitte jenseits von
Regular veröffentlicht und Google Fonts für Geist kein `static/`-Verzeichnis führt. Ob
pdfkit aus ihr einen fetten Schnitt ziehen kann, ist ungeprüft; kann es das nicht, entsteht
die Hierarchie im PDF über Größe, Farbe und Abstand statt über Fettung — was ohnehin näher
an der Gestaltung der App liegt.

## Lizenzen

Beide Schriften dürfen mitgeliefert und eingebettet werden.

- **Geist** — SIL Open Font License 1.1, © 2024 The Geist Project Authors. Text in
  `LIZENZ-Geist.txt`.
- **DejaVu Sans** — Bitstream-Vera-Lizenz für die ererbten Umrisse, die Änderungen von
  DejaVu sind gemeinfrei. Text in `LIZENZ-DejaVu.txt`.

## Warum dieser Ordner im Dockerfile stehen muss

Das Laufzeit-Bild übernimmt nicht den ganzen Baum, sondern nur `node_modules`, `.next`,
`public`, `package.json` und `next.config.ts`. Ein Ordner, der dort nicht ausdrücklich
genannt ist, kommt im Container nicht an — und das PDF scheiterte erst im Betrieb, mit einer
Meldung über eine fehlende Datei. Deshalb steht `assets/` als eigene Zeile im Dockerfile.
