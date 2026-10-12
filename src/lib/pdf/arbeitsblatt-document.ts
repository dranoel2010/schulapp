import { readFileSync } from "node:fs";
import { join } from "node:path";

import PDFDocument from "pdfkit";

import type { ArbeitsblattInhalt, Aufgabe } from "@/lib/arbeitsblatt/schema";
import { dm, voll } from "@/lib/kombi/text";

import { covers, readFontCoverage, type FontCoverage } from "./font-coverage";
import { FONT_DIR } from "./fonts";

/**
 * Das Arbeitsblatt als PDF (Modell 23, Plan H): zwei Seiten A4, Seite 1 mit
 * den Aufgaben und Platz zum Rechnen oder Schreiben, Seite 2 mit den
 * Lösungen. Die Gestaltung bildet das A4 des Prototyps nach (`.a4` in
 * src/app/kombi.css, `a4HTML` Z. 4352ff.): dieselben Maße in mm, dieselben
 * Größen in pt, dieselben Farben. Kästchen 5 mm, Linien 9 mm.
 *
 * Für den Weg in der installierten Android-App, in der `window.print()`
 * womöglich keinen Druckdialog öffnet: der Knopf öffnet dann dieses PDF, und
 * der PDF-Betrachter druckt (Plan H, „Drucken“).
 *
 * Schriften: statische Instanzen von Schibsted Grotesk (450, 560, 650,
 * kursiv 450) und Newsreader kursiv (opsz 24) für Formeln, DejaVu als
 * Auffangnetz für Zeichen, die dort fehlen (⟨⟩, Tiefzahlen, √ in
 * Newsreader). Variable Schriften lassen sich mit pdfkit nicht einbetten
 * (./fonts) — deshalb die statischen Dateien unter assets/schriften/.
 *
 * Reine Abbildung: kein Zugriff auf die Datenbank. `buildArbeitsblattPdf`
 * bekommt Inhalt und Kopf und gibt Bytes zurück.
 */

const MM = 72 / 25.4;
const SEITE_B = 210 * MM;
const SEITE_H = 297 * MM;
const RAND = { oben: 14 * MM, rechts: 17 * MM, unten: 11 * MM, links: 18 * MM };
const BREITE = SEITE_B - RAND.links - RAND.rechts;

/** Die Farben des Blatts — wie --a4-* in globals.css; Papier bleibt hell. */
const FARBE = {
  tinte: "#16181E",
  tinte2: "#4B505E",
  tinte3: "#676C7A",
  linie: "#C3C7D1",
  akzent: "#2A44C0",
  raster: "#C6CBD6",
  rasterRand: "#9FA4B2",
  zeile: "#B5BAC6",
} as const;

type Schrift = "r450" | "r560" | "r650" | "k450" | "m" | "dv";

const DATEIEN: Record<Exclude<Schrift, "dv">, string> & { dv: string } = {
  r450: "SchibstedGrotesk-450.ttf",
  r560: "SchibstedGrotesk-560.ttf",
  r650: "SchibstedGrotesk-650.ttf",
  k450: "SchibstedGrotesk-Kursiv-450.ttf",
  m: "Newsreader-Kursiv-24.ttf",
  dv: "DejaVuSans.ttf",
};

type Schriften = Record<Schrift, { bytes: Buffer; abdeckung: FontCoverage }>;

let geladen: Schriften | null = null;

/** Lädt die Schriften einmal je Prozess (wie `loadPdfFonts`). */
export function arbeitsblattSchriften(): Schriften {
  if (geladen) return geladen;
  const s = {} as Schriften;
  for (const [name, datei] of Object.entries(DATEIEN) as [Schrift, string][]) {
    const pfad = join(process.cwd(), FONT_DIR, datei);
    let bytes: Buffer;
    try {
      bytes = readFileSync(pfad);
    } catch (error) {
      throw new Error(
        `Die Schriftdatei ${FONT_DIR}/${datei} lässt sich nicht öffnen (gesucht unter ${pfad}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    s[name] = { bytes, abdeckung: readFontCoverage(bytes, `${FONT_DIR}/${datei}`) };
  }
  geladen = s;
  return s;
}

// ── Satz ─────────────────────────────────────────────────────────────────────

type Stil = { schrift: Schrift; groesse: number; farbe: string; sperrung?: number };
type Stueck = { text: string; stil: Stil } | { luecke: number; stil: Stil; abstand?: true };

type Doc = PDFKit.PDFDocument;

/** Text mit {Formeln} in Stücke: Formeln in Newsreader kursiv, 1,13-fach. */
function mitFormeln(text: string, stil: Stil, opt: { luecken?: boolean } = {}): Stueck[] {
  const out: Stueck[] = [];
  const re = /\{([^}]+)\}/g;
  let last = 0;
  const normal = (t: string) => {
    if (!opt.luecken) {
      if (t) out.push({ text: t, stil });
      return;
    }
    const teile = t.split("___");
    teile.forEach((teil, i) => {
      if (teil) out.push({ text: teil, stil });
      if (i < teile.length - 1) out.push({ luecke: 22 * MM, stil });
    });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    normal(text.slice(last, m.index));
    out.push({ text: m[1], stil: { ...stil, schrift: "m", groesse: stil.groesse * 1.13 } });
    last = m.index + m[0].length;
  }
  normal(text.slice(last));
  return out;
}

/** Ein Wort in Läufe je Schrift: was die Schrift nicht kann, kommt aus DejaVu. */
function laeufe(text: string, stil: Stil, s: Schriften): { text: string; schrift: Schrift }[] {
  const out: { text: string; schrift: Schrift }[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const schrift: Schrift = /\s/u.test(ch) || covers(s[stil.schrift].abdeckung, cp) ? stil.schrift : "dv";
    const letzter = out[out.length - 1];
    if (letzter && letzter.schrift === schrift) letzter.text += ch;
    else out.push({ text: ch, schrift });
  }
  return out;
}

function setze(doc: Doc, s: Schriften, schrift: Schrift, groesse: number) {
  doc.font(s[schrift].bytes as unknown as string).fontSize(groesse);
}

function breiteVon(doc: Doc, s: Schriften, text: string, stil: Stil): number {
  let w = 0;
  for (const l of laeufe(text, stil, s)) {
    setze(doc, s, l.schrift, stil.groesse);
    w += doc.widthOfString(l.text, { characterSpacing: stil.sperrung ?? 0 });
  }
  return w;
}

type Wort =
  | { text: string; stil: Stil; breite: number; raum: boolean }
  | { luecke: number; stil: Stil; breite: number; raum: false; abstand?: true };

/** Zerlegt Stücke in Wörter und Zwischenräume, gemessen. */
function woerter(doc: Doc, s: Schriften, stuecke: Stueck[]): Wort[] {
  const out: Wort[] = [];
  for (const st of stuecke) {
    if ("luecke" in st) {
      out.push(
        st.abstand
          ? { luecke: st.luecke, stil: st.stil, breite: st.luecke, raum: false, abstand: true }
          : { luecke: st.luecke, stil: st.stil, breite: st.luecke + 2.4 * MM, raum: false },
      );
      continue;
    }
    for (const teil of st.text.split(/(\s+)/u)) {
      if (!teil) continue;
      const raum = /^\s+$/u.test(teil);
      const text = raum ? " " : teil;
      out.push({ text, stil: st.stil, breite: breiteVon(doc, s, text, st.stil), raum });
    }
  }
  return out;
}

/**
 * Setzt einen Absatz mit Umbruch ab `x`, `y` (Oberkante der ersten Zeile).
 * Gibt die Unterkante und die Grundlinie der ersten Zeile zurück.
 */
function absatz(
  doc: Doc,
  s: Schriften,
  stuecke: Stueck[],
  x: number,
  y: number,
  breite: number,
  zeilenhoehe: number,
  basisGroesse: number,
): { unten: number; ersteGrundlinie: number } {
  const ws = woerter(doc, s, stuecke);
  const zeilen: Wort[][] = [];
  let zeile: Wort[] = [];
  let w = 0;
  for (const wort of ws) {
    if (wort.raum && zeile.length === 0) continue;
    if (!wort.raum && zeile.length > 0 && w + wort.breite > breite + 0.01) {
      while (zeile.length && zeile[zeile.length - 1].raum) zeile.pop();
      zeilen.push(zeile);
      zeile = [];
      w = 0;
    }
    zeile.push(wort);
    w += wort.breite;
  }
  if (zeile.length) zeilen.push(zeile);
  if (zeilen.length === 0) zeilen.push([]);

  // Grundlinie: halbe Zeilenhöhe plus etwa ein Drittel der Schriftgröße
  const grundlinie = (top: number) => top + zeilenhoehe / 2 + basisGroesse * 0.34;
  zeilen.forEach((z, i) => {
    const top = y + i * zeilenhoehe;
    const gl = grundlinie(top);
    let cx = x;
    for (const wort of z) {
      if ("luecke" in wort && wort.abstand) {
        cx += wort.breite;
        continue;
      }
      if ("luecke" in wort) {
        const x0 = cx + 1.2 * MM;
        doc
          .save()
          .lineWidth(0.22 * MM)
          .strokeColor(FARBE.tinte2)
          .moveTo(x0, gl + 0.15 * wort.stil.groesse)
          .lineTo(x0 + wort.luecke, gl + 0.15 * wort.stil.groesse)
          .stroke()
          .restore();
        cx += wort.breite;
        continue;
      }
      if (!wort.raum) {
        let lx = cx;
        for (const l of laeufe(wort.text, wort.stil, s)) {
          setze(doc, s, l.schrift, wort.stil.groesse);
          doc.fillColor(wort.stil.farbe).text(l.text, lx, gl, {
            lineBreak: false,
            baseline: "alphabetic",
            characterSpacing: wort.stil.sperrung ?? 0,
          });
          lx += doc.widthOfString(l.text, { characterSpacing: wort.stil.sperrung ?? 0 });
        }
      }
      cx += wort.breite;
    }
  });
  return { unten: y + zeilen.length * zeilenhoehe, ersteGrundlinie: grundlinie(y) };
}

function linie(doc: Doc, x: number, y: number, breite: number, staerke: number, farbe: string) {
  doc.save().lineWidth(staerke).strokeColor(farbe).moveTo(x, y).lineTo(x + breite, y).stroke().restore();
}

// ── Bausteine ────────────────────────────────────────────────────────────────

const ABC = "abcdefgh";

const stil = (schrift: Schrift, groesse: number, farbe: string = FARBE.tinte): Stil => ({ schrift, groesse, farbe });

/** Platz zum Rechnen: Kästchen 5 mm (Höhe in mm) oder Linien 9 mm (Zahl). Breite 165 mm. */
function platz(doc: Doc, papier: "kaestchen" | "linien", n: number, x: number, y: number): number {
  const W = 165 * MM;
  if (papier === "kaestchen") {
    const H = n * MM;
    doc.save().lineWidth(0.18 * MM).strokeColor(FARBE.raster);
    for (let gx = 5; gx < 165; gx += 5) doc.moveTo(x + gx * MM, y).lineTo(x + gx * MM, y + H);
    for (let gy = 5; gy < n; gy += 5) doc.moveTo(x, y + gy * MM).lineTo(x + W, y + gy * MM);
    doc.stroke();
    doc.lineWidth(0.22 * MM).strokeColor(FARBE.rasterRand).rect(x + 0.11 * MM, y + 0.11 * MM, W - 0.22 * MM, H - 0.22 * MM).stroke();
    doc.restore();
    return y + H;
  }
  const H = (n * 9 + 1) * MM;
  doc.save().lineWidth(0.22 * MM).strokeColor(FARBE.zeile);
  for (let i = 1; i <= n; i += 1) doc.moveTo(x, y + i * 9 * MM).lineTo(x + W, y + i * 9 * MM);
  doc.stroke().restore();
  return y + H;
}

const ohneKlammern = (t: string) => t.replace(/[{}]/g, "");

/**
 * Die Teile a), b), … — kurze nebeneinander (Zeilen mit 7 mm Abstand),
 * lange je eine Zeile. Mit Lücken (___) Zeilenhöhe 2,05.
 */
function teile(
  doc: Doc,
  s: Schriften,
  liste: string[],
  kursiv: boolean,
  x: number,
  y: number,
  breite: number,
  groesse: number,
  mitMarke = true,
): number {
  const luecken = liste.some((t) => t.includes("___"));
  const lh = groesse * (luecken ? 2.05 : 1.45);
  const textStil = stil(kursiv ? "k450" : "r450", groesse);
  const marke = stil("r560", groesse, FARBE.tinte2);
  const kurz = liste.every((t) => ohneKlammern(t).length <= 22);

  if (kurz) {
    let cy = y + (luecken ? 0 : 1 * MM);
    let cx = x;
    const reihe = luecken ? 0 : 0.8 * MM;
    for (const [i, t] of liste.entries()) {
      const marken: Stueck[] = mitMarke ? [{ text: `${ABC[i]})`, stil: marke }] : [];
      const text = mitFormeln(t, textStil, { luecken: true });
      // „a)“, dann 1,2 mm Abstand (`.lb{margin-right:1.2mm}`), dann der Teil — nie umbrochen
      const mw = mitMarke ? breiteVon(doc, s, `${ABC[i]})`, marke) + 1.2 * MM : 0;
      const tw = woerter(doc, s, text).reduce((a, b) => a + b.breite, 0);
      if (cx > x && cx + mw + tw > x + breite) {
        cx = x;
        cy += lh + reihe;
      }
      if (mitMarke) absatz(doc, s, marken, cx, cy, mw + 4, lh, groesse);
      absatz(doc, s, text, cx + mw, cy, tw + 4, lh, groesse);
      cx += mw + tw + 7 * MM;
    }
    return cy + lh;
  }

  let cy = y;
  for (const [i, t] of liste.entries()) {
    const stuecke: Stueck[] = [
      ...(mitMarke ? [{ text: `${ABC[i]})`, stil: marke } as Stueck, { luecke: 1.4 * MM, stil: marke, abstand: true } as Stueck] : []),
      ...mitFormeln(t, textStil, { luecken: true }),
    ];
    cy = absatz(doc, s, stuecke, x, cy, breite, lh, groesse).unten;
  }
  return cy;
}

function kopfzeile(doc: Doc, s: Schriften, fach: string, was: string, datum: string): number {
  const g = 8.5;
  const lh = g * 1.3;
  absatz(doc, s, [{ text: fach, stil: stil("r650", g, FARBE.akzent) }, { text: ` · ${was}`, stil: stil("r560", g, FARBE.tinte2) }], RAND.links, RAND.oben, BREITE, lh, g);
  const dw = breiteVon(doc, s, datum, stil("r560", g));
  absatz(doc, s, [{ text: datum, stil: stil("r560", g, FARBE.tinte2) }], RAND.links + BREITE - dw, RAND.oben, dw + 1, lh, g);
  return RAND.oben + lh + 6 * MM;
}

function titel(doc: Doc, s: Schriften, text: string, y: number): number {
  const g = 21;
  return absatz(doc, s, [{ text, stil: { ...stil("r650", g), sperrung: -0.025 * g } }], RAND.links, y, BREITE, g * 1.08, g).unten;
}

function unterzeile(doc: Doc, s: Schriften, text: string, y: number): number {
  const g = 10.5;
  return absatz(doc, s, mitFormeln(text, stil("r450", g, FARBE.tinte2)), RAND.links, y + 1.6 * MM, BREITE, g * 1.35, g).unten;
}

function quellenzeile(doc: Doc, s: Schriften, stuecke: Stueck[], y: number): number {
  const g = 8.5;
  const top = y + 3.2 * MM;
  linie(doc, RAND.links, top, BREITE, 0.25 * MM, FARBE.tinte);
  return absatz(doc, s, stuecke, RAND.links, top + 2.6 * MM, BREITE, g * 1.35, g).unten;
}

function fuss(doc: Doc, s: Schriften, links: Stueck[], seite: string) {
  const g = 8;
  const lh = g * 1.3;
  const rechtsBreite = breiteVon(doc, s, seite, stil("r560", g)) + 12;
  // Höhe des linken Texts messen: so hoch wie nötig, unten bündig
  const probe = woerter(doc, s, links).reduce((a, b) => a + b.breite, 0);
  const zeilen = Math.max(1, Math.ceil(probe / (BREITE - rechtsBreite)));
  const top = SEITE_H - RAND.unten - zeilen * lh - 2.6 * MM;
  linie(doc, RAND.links, top, BREITE, 0.2 * MM, FARBE.linie);
  absatz(doc, s, links, RAND.links, top + 2.6 * MM, BREITE - rechtsBreite, lh, g);
  absatz(doc, s, [{ text: seite, stil: stil("r560", g, FARBE.tinte2) }], RAND.links + BREITE - rechtsBreite + 12, top + 2.6 * MM, rechtsBreite, lh, g);
}

/** „Aus deinen Blättern vom 8.10.: »Scheitelpunktform, Übungen«“ */
function quellenStuecke(inhalt: ArbeitsblattInhalt, g: number, farbe: string = FARBE.tinte2): Stueck[] {
  const tage = [...new Set(inhalt.quellen.map((q) => dm(q.datum)))];
  const out: Stueck[] = [{ text: `Aus deinen Blättern vom ${tage.join(" und ")}: `, stil: stil("r450", g, farbe) }];
  inhalt.quellen.slice(0, 3).forEach((q, i) => {
    if (i > 0) out.push({ text: ", ", stil: stil("r450", g, farbe) });
    out.push({ text: `»${q.titel || q.zitat}«`, stil: stil("r560", g, FARBE.tinte) });
  });
  return out;
}

function nummer(doc: Doc, s: Schriften, nr: number, grundlinie: number) {
  setze(doc, s, "r650", 12);
  doc.fillColor(FARBE.akzent).text(String(nr), RAND.links, grundlinie, { lineBreak: false, baseline: "alphabetic" });
}

// ── Seiten ───────────────────────────────────────────────────────────────────

export type ArbeitsblattPdfDaten = {
  fach: string;
  thema: string;
  /** 'YYYY-MM-DD' — steht im Kopf */
  tag: string;
  inhalt: ArbeitsblattInhalt;
};

const EINZUG = 8 * MM;

function seiteAufgaben(doc: Doc, s: Schriften, d: ArbeitsblattDatenMitDatum, k: number) {
  const { inhalt } = d;
  let y = kopfzeile(doc, s, d.fach, "Arbeitsblatt", d.datum);
  y = titel(doc, s, d.thema, y);
  y = unterzeile(doc, s, `${inhalt.teil} · ${inhalt.aufgaben.length} Aufgaben, von leicht nach schwer · etwa ${inhalt.minuten} Minuten`, y);
  y = quellenzeile(doc, s, quellenStuecke(inhalt, 8.5), y);
  y += 5.4 * MM;
  const g = 10.5 * k;
  for (const [i, a] of inhalt.aufgaben.entries()) {
    if (i > 0) y += 4.6 * MM * k;
    const q = absatz(doc, s, mitFormeln(a.q, stil("r450", g)), RAND.links + EINZUG, y, BREITE - EINZUG, g * 1.45, g);
    nummer(doc, s, i + 1, q.ersteGrundlinie);
    y = q.unten;
    if (a.teile) y = teile(doc, s, a.teile, Boolean(a.fr), RAND.links + EINZUG, y, BREITE - EINZUG, g);
    if (a.platz) y = platz(doc, inhalt.papier, a.platz, RAND.links + EINZUG, y + 2.4 * MM);
  }
  fuss(
    doc,
    s,
    [{ text: `${inhalt.papier === "kaestchen" ? "Rechne in den Kästchen." : "Schreib auf die Linien."} Die Lösungen stehen auf Seite 2.`, stil: stil("r450", 8, FARBE.tinte3) }],
    "1 / 2",
  );
  return y;
}

function loesung(doc: Doc, s: Schriften, a: Aufgabe, kursiv: boolean, x: number, y: number, breite: number, k: number): { unten: number; ersteGrundlinie: number } {
  const g = 10.5 * k;
  let cy = y;
  let erste: number | null = null;
  let vorher: string | null = null;
  for (const [art, wert] of a.l) {
    if (vorher !== null) cy += art === "erg" || art === "hint" ? 1.2 * MM : 0.8 * MM;
    if (art === "p") {
      const r = absatz(doc, s, mitFormeln(wert, stil("r450", g)), x, cy, breite, g * 1.5, g);
      erste ??= r.ersteGrundlinie;
      cy = r.unten;
    } else if (art === "erg") {
      const r = absatz(doc, s, mitFormeln(wert, stil("r650", g)), x, cy, breite, g * 1.5, g);
      erste ??= r.ersteGrundlinie;
      cy = r.unten;
    } else if (art === "hint") {
      const gh = 9 * k;
      const r = absatz(doc, s, [{ text: "Achtung: ", stil: stil("r650", gh) }, ...mitFormeln(wert, stil("r450", gh, FARBE.tinte2))], x, cy, breite, gh * 1.4, gh);
      erste ??= r.ersteGrundlinie;
      cy = r.unten;
    } else if (art === "teile") {
      const top = cy;
      cy = teile(doc, s, wert, kursiv, x, cy, breite, g);
      const kurzeTeile = wert.every((t) => ohneKlammern(t).length <= 22) && !wert.some((t) => t.includes("___"));
      erste ??= top + (kurzeTeile ? 1 * MM : 0) + (g * 1.45) / 2 + g * 0.34;
    } else if (art === "eq") {
      cy += vorher === null ? 0 : 0.6 * MM;
      const lw = Math.max(...wert.map(([l]) => (l ? woerter(doc, s, mitFormeln(l, stil("r450", g))).reduce((a2, b) => a2 + b.breite, 0) : 0)));
      const eqw = breiteVon(doc, s, "=", stil("r450", g));
      for (const [ri, [l, r]] of wert.entries()) {
        if (ri > 0) cy += 0.9 * MM;
        const lh = g * 1.5;
        if (l) absatz(doc, s, mitFormeln(l, stil("r450", g)), x, cy, lw + 2, lh, g);
        absatz(doc, s, [{ text: "=", stil: stil("r450", g) }], x + lw + 1.8 * MM, cy, eqw + 2, lh, g);
        const rr = absatz(doc, s, mitFormeln(r, stil("r450", g)), x + lw + 3.6 * MM + eqw, cy, breite - lw - 3.6 * MM - eqw, lh, g);
        erste ??= rr.ersteGrundlinie;
        cy = rr.unten;
      }
    }
    vorher = art;
  }
  return { unten: cy, ersteGrundlinie: erste ?? y + 10 };
}

function seiteLoesungen(doc: Doc, s: Schriften, d: ArbeitsblattDatenMitDatum, k: number) {
  const { inhalt } = d;
  let y = kopfzeile(doc, s, d.fach, "Lösungen", d.datum);
  y = titel(doc, s, "Lösungen", y);
  y = unterzeile(doc, s, `${d.thema} · ${inhalt.teil}${inhalt.papier === "kaestchen" ? ", mit Rechenweg" : ""}`, y);
  y = quellenzeile(
    doc,
    s,
    [{ text: "Erst nach dem Lösen ansehen. Danach trägst du in der App je Aufgabe ein, ob sie richtig war.", stil: stil("r450", 8.5, FARBE.tinte2) }],
    y,
  );
  y += 5.4 * MM;
  const kursiv = inhalt.papier === "linien";
  for (const [i, a] of inhalt.aufgaben.entries()) {
    if (i > 0) y += 4.4 * MM * k;
    const r = loesung(doc, s, a, kursiv, RAND.links + EINZUG, y, BREITE - EINZUG, k);
    nummer(doc, s, i + 1, r.ersteGrundlinie);
    y = r.unten;
  }
  fuss(doc, s, quellenStuecke(inhalt, 8, FARBE.tinte3), "2 / 2");
  return y;
}

type ArbeitsblattDatenMitDatum = ArbeitsblattPdfDaten & { datum: string };

/** Wo die Linie über dem Fuß liegt (eine Fußzeile): Inhalt darf nicht über sie laufen. */
const FUSS_GRENZE = SEITE_H - RAND.unten - 8 * 1.3 - 2.6 * MM;

function zeichne(daten: ArbeitsblattDatenMitDatum, s: Schriften, k: number): { doc: Doc; passt: boolean } {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: true,
    info: { Title: `${daten.fach} · ${daten.thema} · Arbeitsblatt`, Author: "Schulapp" },
  });
  const u1 = seiteAufgaben(doc, s, daten, k);
  doc.addPage({ size: "A4", margin: 0 });
  const u2 = seiteLoesungen(doc, s, daten, k);
  return { doc, passt: u1 <= FUSS_GRENZE && u2 <= FUSS_GRENZE };
}

/**
 * Das PDF. Passt der Inhalt nicht auf die Seite (lange Aufgaben), wird der
 * Satz der Aufgaben etwas enger und kleiner, höchstens auf 85 %; nie eine
 * dritte Seite.
 */
export async function buildArbeitsblattPdf(daten: ArbeitsblattPdfDaten): Promise<Buffer> {
  const s = arbeitsblattSchriften();
  const d: ArbeitsblattDatenMitDatum = { ...daten, datum: `${voll(daten.tag)} ${daten.tag.slice(0, 4)}` };
  let gewaehlt: Doc | null = null;
  for (const k of [1, 0.94, 0.88, 0.85]) {
    const { doc, passt } = zeichne(d, s, k);
    if (passt || k === 0.85) {
      gewaehlt = doc;
      break;
    }
    doc.end();
  }
  const doc = gewaehlt!;
  const teile: Buffer[] = [];
  return new Promise<Buffer>((fertig, fehler) => {
    doc.on("data", (b: Buffer) => teile.push(b));
    doc.on("end", () => fertig(Buffer.concat(teile)));
    doc.on("error", fehler);
    doc.end();
  });
}

/** Dateiname: „Arbeitsblatt Mathematik Quadratische Funktionen 2026-10-12.pdf“ */
export function arbeitsblattDateiname(daten: Pick<ArbeitsblattPdfDaten, "fach" | "thema" | "tag">): string {
  return `Arbeitsblatt ${daten.fach} ${daten.thema} ${daten.tag}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}
