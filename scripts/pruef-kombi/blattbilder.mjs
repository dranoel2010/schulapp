/**
 * Die Blattfotos der Beispieldaten als JPEG (für scripts/pruef-kombi/
 * saat-startseite.mts): dieselbe Zeichnung wie `paperImg()` im Prototyp
 * (entwurf-modelle/23-kombi-v2/index.html, Z. 1431), damit die Miniaturen
 * unter „Zuletzt abgelegt“ in App und Prototyp dasselbe Blatt zeigen.
 *
 *   node scripts/pruef-kombi/blattbilder.mjs <zielordner>
 *
 * Legt b1.jpg … b7.jpg (300 × 424) im Zielordner ab.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { browserStarten } from "./gemeinsam.mjs";

const ziel = process.argv[2];
if (!ziel) {
  console.error("Zielordner fehlt.");
  process.exit(1);
}
mkdirSync(ziel, { recursive: true });

const BLAETTER = [
  { id: "b7", fach: "Mathematik", titel: "Scheitelpunktform, Übungen", datum: "8.10.", seiten: 2,
    abschrift: [["h", "Die Scheitelpunktform"], ["f", "f(x) = a(x − d)² + e"], ["p", "Der Scheitelpunkt ist S(d | e). Ist a negativ, ist die Parabel nach unten geöffnet. Ist |a| größer als 1, ist die Parabel gestreckt."],
      ["p", "{f(x) = (x − 3)²} ist die Normalparabel, um 3 nach rechts verschoben. Die Symmetrieachse ist die senkrechte Gerade durch den Scheitelpunkt."],
      ["h", "Nullstellen"], ["f", "x = −p/2 ± √((p/2)² − q)"], ["p", "Ist {(p/2)² − q} kleiner als 0, gibt es keine Lösung. Eine quadratische Funktion hat keine, eine oder zwei Nullstellen."],
      ["h", "Aufgaben"], ["p", "4. Bestimme die Nullstellen von {x² − 6x + 8}."], ["p", "6. Bring {f(x) = x² + 4x + 1} in Scheitelpunktform."]] },
  { id: "b6", fach: "Geschichte", titel: "Die erste Eisenbahn in Deutschland", datum: "8.10.", seiten: 1,
    abschrift: [["h", "Die erste Eisenbahn in Deutschland"], ["p", "1835 fuhr die erste Eisenbahn in Deutschland von Nürnberg nach Fürth. Die Lokomotive hieß Adler und kam aus England."],
      ["p", "Mit der Eisenbahn wuchs der Bedarf an Kohle und Stahl. Das Ruhrgebiet wurde zum Zentrum der Industrie."]] },
  { id: "b5", fach: "Geschichte", titel: "Arbeit in der Fabrik, Kinderarbeit", datum: "6.10.", seiten: 3,
    abschrift: [["h", "Arbeit in der Fabrik"], ["p", "Ein Arbeitstag dauerte 12 bis 16 Stunden, sechs Tage in der Woche."],
      ["p", "Auf dem Land gab es nicht genug Arbeit für die wachsende Bevölkerung. Viele zogen deshalb in die Städte zu den Fabriken."],
      ["h", "Kinderarbeit"], ["p", "Der Factory Act von 1833 verbot Kinderarbeit unter 9 Jahren in Textilfabriken. Kinder von 9 bis 13 Jahren durften höchstens 9 Stunden am Tag arbeiten. Fabrikinspektoren kontrollierten das."],
      ["p", "Die Not der Arbeiter nannte man die soziale Frage: enge Wohnungen, lange Arbeitszeit, niedriger Lohn und keine Absicherung bei Krankheit, Unfall und Alter."]] },
  { id: "b4", fach: "Französisch", titel: "Exercices 3 et 4", datum: "5.10.", seiten: 1,
    abschrift: [["h", "Exercices 3 et 4"], ["p", "1. Elle ___ (aller) au cinéma."], ["p", "2. Ils ___ (arriver) hier."], ["p", "3. Nous ___ (partir) à huit heures."],
      ["p", "4. Je me ___ (lever) tôt."], ["p", "5. Marie et Paul ___ (rester) à la maison."], ["p", "6. Elles sont venues hier."]] },
  { id: "b3", fach: "Geschichte", titel: "Spinnmaschine und Fabrik", datum: "2.10.", seiten: 2,
    abschrift: [["h", "Spinnmaschine und Fabrik"], ["p", "1764 baute James Hargreaves die Spinning Jenny. Eine Person spann damit an mehreren Spindeln zugleich."],
      ["p", "In der Manufaktur arbeiteten viele Menschen von Hand, jeder an einem Arbeitsschritt. In der Fabrik trieben Dampf oder Wasser die Maschinen an."]] },
  { id: "b2", fach: "Französisch", titel: "Passé composé avec être", datum: "1.10.", seiten: 1,
    abschrift: [["h", "Passé composé avec être"], ["p", "Mit être: aller, venir, partir, arriver, entrer, sortir, monter, descendre, naître, mourir, rester, tomber und alle reflexiven Verben."],
      ["p", "Das Partizip richtet sich nach dem Subjekt: il est allé, elle est allée, ils sont allés, elles sont allées."], ["p", "Partizipien: naître → né, mourir → mort, venir → venu."]] },
  { id: "b1", fach: "Geschichte", titel: "Die Dampfmaschine", datum: "30.9.", seiten: 2,
    abschrift: [["h", "Die Dampfmaschine"], ["p", "Die Industrialisierung begann um 1760 in England."],
      ["p", "Gründe: Kohle und Eisenerz im eigenen Land, Kapital aus Handel und Kolonien und eine wachsende Bevölkerung."],
      ["p", "Thomas Newcomen baute 1712 die erste brauchbare Dampfmaschine. Newcomens Maschine pumpte Wasser aus Bergwerken."],
      ["p", "James Watt verbesserte sie 1769. Er baute einen eigenen Kondensator, getrennt vom Zylinder. Die Maschine brauchte dadurch viel weniger Kohle."]] },
];

const browser = await browserStarten();
const page = await browser.newPage();
const bilder = await page.evaluate((liste) => {
  // paperImg() aus dem Prototyp, Seite 0
  return liste.map((b) => {
    const key = b.id + ":0";
    const W = 300, H = 424, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    let seed = 0;
    for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    const rnd = () => (seed = (seed * 137 + 71) % 9973) / 9973;
    x.fillStyle = "#E7E6E1"; x.fillRect(0, 0, W, H);
    const lg = x.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, "rgba(255,255,255,.35)"); lg.addColorStop(1, "rgba(0,0,0,.06)");
    x.fillStyle = lg; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate((rnd() - .5) * .018); x.translate(-W / 2, -H / 2);
    x.filter = "blur(.35px)";
    let y = 40; const L = 26, R0 = W - 26;
    x.fillStyle = "#56565A"; x.font = "600 9px Helvetica, Arial, sans-serif";
    x.fillText(`${b.fach}   Klasse 10   ${b.datum}`, L, 22);
    for (const [t, txt] of b.abschrift) {
      if (y > H - 24) break;
      const head = t === "h", form = t === "f";
      x.font = head ? "700 15px Helvetica, Arial, sans-serif" : form ? "italic 13px Georgia, serif" : "400 10.5px Helvetica, Arial, sans-serif";
      x.fillStyle = head ? "#232326" : "#3A3A3E";
      const words = String(txt).replace(/[{}]/g, "").split(" "); let line = "";
      const lh = head ? 20 : form ? 19 : 14.5;
      if (head && y > 40) y += 8;
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (x.measureText(test).width > R0 - L && line) { x.fillText(line, L, y); y += lh; line = w; if (y > H - 24) break; }
        else line = test;
      }
      if (line && y <= H - 24) { x.fillText(line, L, y); y += lh; }
      y += head ? 2 : 5;
    }
    x.restore();
    return { id: b.id, url: c.toDataURL("image/jpeg", 0.8) };
  });
}, BLAETTER);
for (const b of bilder) {
  writeFileSync(path.join(ziel, `${b.id}.jpg`), Buffer.from(b.url.split(",")[1], "base64"));
}
await browser.close();
console.log(`${bilder.length} Blattbilder nach ${ziel}`);
