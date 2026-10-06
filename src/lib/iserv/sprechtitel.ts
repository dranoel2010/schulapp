import { addDays, daysBetween, timeInBerlin } from "@/lib/dates";
import { klassenIn, normalisiere } from "@/lib/iserv/klasse";
import type { IservItem } from "@/lib/iserv/types";

/**
 * Der Titel eines IServ-Termins, so wie ein Sprach-Bot ihn vorlesen kann.
 *
 * Am 6.10.2026 hat der Nutzer einem Sprach-Bot Zugriff auf den Kalender
 * „Schule“ gegeben, und der Bot liest die Titel nur vor. Aus IServ kommen sie
 * aber als Schreibtisch-Notizen: „1. + 2. Pädagogischer Tag_unterrichtsfrei
 * (3. Pädagogischer Tag: Mo, 30.11.26)“, „Kl. 10_Vorstellung der
 * Praktikumsberichte“, „Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026“. Vorgelesen
 * wird daraus Buchstabensalat. Der Wunsch des Nutzers: statt „IServ: …“
 * einfach nur so etwas wie „Pädagogischer Tag, Tag 1 von 2, frei“. Deshalb
 * steht im Titel
 *
 *   - kein „IServ:“ — das Kennzeichen ist die Farbe Pfau,
 *   - kein „_“ — aus dem Trenner wird ein Komma, für den Bot eine kurze Pause,
 *   - kein Datum, kein Wochentag und keine Uhrzeit, die Google schon zeigt,
 *   - kein Kürzel, das der Bot buchstabiert („Kl.“, „EA“, „HA“, „Nr.“ …),
 *   - keine eigene Klasse — hinein kommt ohnehin nur, was sie betrifft (aber
 *     kein Satztrümmer: mitten im Satz bleibt sie stehen),
 *
 * und ein mehrtägiger Termin bekommt je Tag einen eigenen Termin mit
 * „Tag 1 von 2“. Was an einem Tag frei ist, endet auf „, frei“. Ferien bleiben
 * EIN Balken und heißen nur „Herbstferien“.
 *
 * Nichts geht verloren: Der Originaltitel steht in der Beschreibung des
 * Termins („Titel in IServ: …“, siehe `iservEvents()` in
 * @/lib/calendar/events).
 *
 * Reine Rechnung, deterministisch, ohne Netz, ohne Datenbank und ohne KI:
 * Titel aus IServ gehen an keinen Dienst. Der Sprechtitel hängt nur am
 * Originaltitel, an den Tagen, an den Uhrzeiten in Berlin und an der Klasse —
 * nichts darin ändert sich, ohne dass sich der Termin ändert.
 *
 * **Der Filter entscheidet weiter am Originaltitel.** Ob ein Termin in den
 * Kalender kommt, sagt @/lib/iserv/klasse (`urteil()`, ISERV_AUCH, ISERV_NIE)
 * am Titel, wie IServ ihn schickt. Diese Datei ändert nur, wie er dort heißt.
 *
 * ── Die Regeln in `sprechName()`, in dieser Reihenfolge ─────────────────────
 *
 *   0  Vorbereitung   NFKC, geschütztes Leerzeichen, Leerraum; Gender-Formen
 *                     („Schüler:innen“ → „Schülerinnen und Schüler“); ein von
 *                     IServ gekappter Titel (99 Zeichen, „…“) verliert sein
 *                     Wortstück und einen angefangenen letzten Satz
 *   1  Ferien         nur ganztägig, „…ferien“ am Anfang → „Herbstferien“,
 *                     fertig (kein „, frei“, kein Aufteilen)
 *   2  Klammern       mit Ziffer ganz weg (anderer Termin, Datum), sonst ein
 *                     eigenes Segment: „Sportfest (Aula)“ → „Sportfest, Aula“
 *   3  Klassen        nennt der Titel die eigene Klasse, fallen die
 *                     Klassenangaben am Rand der Segmente weg; was mitten im
 *                     Satz steht, bleibt und wird ausgeschrieben
 *   4  je Segment     (getrennt an „_“)
 *        a Datum weg   „am 12.11.“, „14.09.-25.09.26“, „Mo, 30.11.26“
 *        b Uhrzeit weg nur mit Beginn und Ende, und nur Beginn oder Ende
 *        c Klassen weg nur nach 3, samt „der“/„für die“ davor
 *        d aufräumen
 *        e frei        ist das GANZE Segment „unterrichtsfrei“ o. ä., fällt es
 *                      weg und der Titel endet auf „, frei“
 *        f Rest        ein Lehrerkürzel oder nur Wochentage („Mo.–Fr.“) als
 *                      eigenes Segment fallen weg
 *   5  Ordnungszahlen „1. + 2. Pädagogischer Tag“ über genau 2 Tage (oder
 *                     „1. - 3.“ über 3) → „Pädagogischer Tag“ (der Zähler
 *                     kommt aus dem Aufteilen)
 *   6  fügen          mit „, “
 *   7  sprechbar      „3.Pädagogischer“ → „3. Pädagogischer“, Kürzel
 *                     ausgeschrieben, „11h“ → „11 Uhr“, „11:00 Uhr“ → „11 Uhr“
 *   8  Rückfall       bleibt nichts übrig: „Unterrichtsfrei“ oder der
 *                     Originaltitel, nur sprechbar gemacht
 *
 * ── Der Zusammenbau in `sprechTermine()` ────────────────────────────────────
 *
 *   Aufgabe                    „Abgabe <Name> bis 23:59 Uhr“      ein Termin
 *   Ferien                     „Herbstferien“                     ein Balken
 *   ganztägig, 2 bis 31 Tage   „<Name>, Tag 1 von 2, frei“ …      je Tag einer
 *   Punkt (nur Beginn)         „<Name> um 11:30 Uhr“              ein Termin
 *   sonst                      „<Name>“ (+ „, frei“)              ein Termin
 *
 * Über 31 Tage (`MAX_TAGE_EINZELN`, eine Epoche über Wochen) bleibt es ein
 * Balken ohne Zähler, und ein mehrtägiger Termin mit Uhrzeit bleibt ein
 * Termin mit Uhrzeit.
 *
 * ── Wortgrenzen ──────────────────────────────────────────────────────────────
 *
 * Wie in @/lib/iserv/klasse: `\b` taugt nicht, weil „_“ für JavaScript ein
 * Wortzeichen ist und Umlaute keine sind. Die Grenzen sind eigene
 * Lookarounds über A–Z, a–z und ÄÖÜäöüß (`VB` davor, `NB` danach).
 */

/** Längster ganztägiger Termin, der noch je Tag einen Termin bekommt. */
export const MAX_TAGE_EINZELN = 31;

const BU = "A-Za-zÄÖÜäöüß";
/** kein Buchstabe davor / danach */
const VB = `(?<![${BU}])`;
const NB = `(?![${BU}])`;

// ── Datum ────────────────────────────────────────────────────────────────────
const WOCHENTAG = String.raw`${VB}(?:(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonnabend|Sonntag)|(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?)\s*,?\s*`;
// Tag.Monat[.Jahr] — Monat 1–12, nicht vor „Uhr“/„h“ (12.10 Uhr ist eine Uhrzeit)
const DATUM = String.raw`(?<![\d.])(?:0?[1-9]|[12]\d|3[01])\.\s?(?:0?[1-9]|1[0-2])(?:\.(?:\s?\d{4}|\d{2}(?!\d))?|(?!\d))(?!\s?(?:Uhr|h)${NB})(?!\s?\d)`;
const EIN_DATUM = String.raw`(?:${WOCHENTAG})?${DATUM}`;
const DATUMS_AUSDRUCK = new RegExp(
  String.raw`(?:${VB}(?:am|vom|ab|bis|von)\s+)?${EIN_DATUM}(?:\s*(?:-|–|bis|und|\/)\s*${EIN_DATUM})?\.?`,
  "gi",
);

// ── Uhrzeit ──────────────────────────────────────────────────────────────────
const ZEIT_UHR = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(?:Uhr|h)${NB}`; // „9 Uhr“, „12:20 Uhr“, „11h“
const ZEIT_DP = String.raw`(\d{1,2}):(\d{2})(?!\d)`; // „12:30“
const ZEIT = String.raw`(?:${ZEIT_UHR}|${ZEIT_DP})`;
const ZEIT_VORWORT = String.raw`(?:${VB}(?:Beginn|Start|Ende|ab|um|von|bis)\s*:?\s*)?`;
const ZEIT_BEREICH = new RegExp(
  String.raw`${ZEIT_VORWORT}(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?\s*(?:Uhr\s*)?(?:-|–|bis)\s*${ZEIT}`,
  "gi",
);
const ZEIT_EINZELN = new RegExp(String.raw`${ZEIT_VORWORT}(?<![\d.:])${ZEIT}`, "gi");
const ZEIT_IRGENDWO = new RegExp(String.raw`(?<![\d.:])${ZEIT}`, "gi");

/** „9“, undefined → „09:00“ */
function hhmm(h: string | undefined, m: string | undefined): string {
  return `${String(Number(h)).padStart(2, "0")}:${m ?? "00"}`;
}

/** „11:00“ → „11 Uhr“, „08:05“ → „8:05 Uhr“ */
export function sprechZeit(zeit: string): string {
  const [h, m] = zeit.split(":");
  return m === "00" ? `${Number(h)} Uhr` : `${Number(h)}:${m} Uhr`;
}

/** Alle Uhrzeiten im Text als „HH:MM“. */
function zeitenIn(text: string): string[] {
  const zeiten: string[] = [];
  for (const t of text.matchAll(ZEIT_IRGENDWO)) {
    zeiten.push(t[1] !== undefined ? hhmm(t[1], t[2]) : hhmm(t[3], t[4]));
  }
  return zeiten;
}

// ── Klassen ──────────────────────────────────────────────────────────────────
const KL = String.raw`(?:Kl(?:asse(?:n)?)?\.?|Jg\.?|Jahrg(?:a|ä)nge?(?:s?stufen?)?)`;
const NUM = String.raw`\d{1,2}[a-d]?\.?`;
const LISTE = String.raw`${NUM}(?:\s*(?:-|–|\+|\/|,|&|und|bis)\s*${NUM})*`;
const VORWORT_KL = String.raw`(?:${VB}(?:für|ab)\s+(?:die\s+|der\s+)?)?`;
const ANGABE_FORMEN = [
  String.raw`${VORWORT_KL}(?<![\d.])${LISTE}\s*${KL}${NB}`, // „10.Kl“, „7. - 12. Kl“, „10. Klasse“
  String.raw`${VORWORT_KL}${VB}${KL}\s*${LISTE}(?!\d|\.\d|\s*(?:Uhr|h)${NB})`, // „Kl. 10“, „Klassen 1-12“
  String.raw`${VB}(?:erst|zweit|dritt|viert|fünft|sechst|siebt|siebent|acht|neunt|zehnt|elft|zwölft|dreizehnt)(?:e[nrs]?)?\s?-?kl(?:a|ä)ss(?:e|en|ler|lerinnen)?${NB}`,
];
const KLASSEN_ANGABE = new RegExp(ANGABE_FORMEN.join("|"), "gi");

// Wegnehmen nur am Rand eines Segments — mitten im Satz blieben Trümmer
// („Elternabend der“, „Die haben Projekttag“). Eine Kette ist eine oder
// mehrere Angaben: „Kl. 10 und Kl. 11“, „12.Kl+13.KL“.
const KETTE = String.raw`(?:${ANGABE_FORMEN.join("|")})(?:\s*(?:,|\+|&|\/|und|sowie|oder)\s*(?:${ANGABE_FORMEN.join("|")}))*`;
/** Was am Ende mit der Klasse gehen muss: „der 10. Klasse“, „für die Kl. 10“, „mit Kl. 10“ */
const DAVOR = String.raw`(?:${VB}(?:für|ab|an|in|bei|mit|von|aus|zu|zur|zum|der|des|die|den|dem)\s+(?:(?:der|des|die|den|dem)\s+)?)?`;
const KLASSEN_AM_ENDE = new RegExp(String.raw`\s*${DAVOR}${KETTE}\s*$`, "i");
const KLASSEN_AM_ANFANG = new RegExp(String.raw`^\s*${KETTE}\s*`, "i");

/**
 * Schritt 4c: die eigene Klasse aus einem Segment — nur, wo danach ein Satz
 * bleibt. Am Ende samt Artikel oder Präposition davor („Elternabend der 10.
 * Klasse“ → „Elternabend“). Am Anfang nur, wenn danach ein Trenner oder ein
 * Nomen kommt („Kl. 10: Elternabend“, „Kl. 10 Exkursion“) — bei einem Verb
 * („Für die Klassen 10 und 12 ist …“) bleibt sie stehen und wird in Schritt 7
 * nur ausgeschrieben.
 */
function ohneEigeneKlasse(segment: string): string {
  let s = segment.replace(KLASSEN_AM_ENDE, "");
  const anfang = s.match(KLASSEN_AM_ANFANG);
  if (anfang) {
    const rest = s.slice(anfang[0].length);
    const erstes = rest.charAt(0);
    if (rest === "" || /[:–-]/.test(erstes) || (erstes !== erstes.toLowerCase())) s = rest;
  }
  return s.replace(/^\s*(?:und|sowie|oder)\s+/i, "").replace(/\s+(?:und|sowie|oder)\s*$/i, "");
}

// ── Frei ─────────────────────────────────────────────────────────────────────
const FREI_TEIL = String.raw`(?:unterrichtsfrei|schulfrei|keine?n?\s+unterricht|unterricht\s+f(?:ä|ae)llt\s+aus|schule(?:\s+und\s+hort)?\s+(?:ist\s+|bleibt\s+)?geschlossen)`;
const FREI_SEGMENT = new RegExp(String.raw`^${FREI_TEIL}[.!]*$`, "i");

// ── Ferien ───────────────────────────────────────────────────────────────────
// „Herbstferien_…“ ja; „Ferien-AG …“, „Ferienbetreuung …“, „Ende der Herbstferien“ nein
const FERIEN_ANFANG = new RegExp(String.raw`^([${BU}]*ferien)(?![${BU}-])`, "i");

// ── Lehrerkürzel als eigenes Segment: „Ab“, „Xy/Zw“ ──────────────────────────
const KUERZEL = /^[A-ZÄÖÜ][a-zäöüß]?\.?(?:\s*[/,&+]\s*[A-ZÄÖÜ][a-zäöüß]?\.?)*$/;

// ── Ein Segment nur aus Wochentagen: „Mo.–Fr.“, „bis Fr.“ (meist aus einer Klammer) ──
const WT = String.raw`(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonnabend|Sonntag|Mo|Di|Mi|Do|Fr|Sa|So)\.?`;
const NUR_WOCHENTAGE = new RegExp(
  String.raw`^(?:(?:[Aa]m|[Aa]b|[Bb]is|[Vv]on|[Vv]om)\s+)?${WT}(?:\s*(?:-|–|bis|und|\/|,|\+|&)\s*${WT})*$`,
);

// ── Ordnungszahlen der Tage am Anfang: „1. + 2.“, „1. - 3.“ ──────────────────
const ORDNUNGSZAHLEN = /^((?:\d{1,2}\.\s*(?:\+|und|&|\/|,|-|–|bis)\s*)+\d{1,2}\.)\s*/;
const ORDNUNGS_BEREICH = /^(\d{1,2})\.\s*(?:-|–|bis)\s*(\d{1,2})\.$/;

/** Wie viele Tage „1. + 2.“ (zwei) oder „1. - 3.“ (drei, ein Bereich) zählen. */
function gezaehlteTage(ordnungszahlen: string): number {
  const bereich = ordnungszahlen.match(ORDNUNGS_BEREICH);
  if (bereich) return Number(bereich[2]) - Number(bereich[1]) + 1;
  return (ordnungszahlen.match(/\d{1,2}\./g) ?? []).length;
}

// ── Von IServ gekappt ────────────────────────────────────────────────────────
/**
 * IServ schickt höchstens 99 Zeichen; ein längerer Titel endet dann auf „…“.
 * Nur dann gilt das letzte Wort als Bruchstück — ein kurzer Titel, der
 * absichtlich auf „…“ endet („Und dann…“), bleibt, wie er ist.
 */
const GEKAPPT_AB = 99;
/**
 * Wo ein Satz oder Satzteil endet: ein Satzende, nach dem ein neuer Satz
 * beginnt (nicht „4. Stunde“, nicht „Kl. 10“), oder ein Komma.
 */
const SATZGRENZE = /[^\d\s.][.!?](?=\s+[A-ZÄÖÜ])|,(?=\s)/g;

/**
 * Schritt 0: das abgebrochene Ende eines gekappten Titels. Das Wortstück
 * fällt weg. Ist der angefangene letzte Satz oder Satzteil im letzten Segment
 * kürzer als das, was davor steht, fällt auch er weg („… der Schule. Danach
 * gehen w…“ → „… der Schule.“); ist er länger, trägt er die Nachricht und
 * bleibt („Wichtig, diesmal beginnt die Versammlung eine halbe Stunde früher
 * als bei allen…“).
 */
function ohneGekapptesEnde(titel: string, t: string): string {
  if (titel.length < GEKAPPT_AB || !/(?:…|\.\.\.)$/.test(t)) return t;
  const ohne = t.replace(/\s*\S*?(?:…|\.\.\.)$/, "").trim();
  if (!ohne) return t;
  const segmentAnfang = ohne.lastIndexOf("_") + 1;
  const segment = ohne.slice(segmentAnfang);
  const grenze = [...segment.matchAll(SATZGRENZE)].at(-1);
  if (grenze?.index === undefined) return ohne;
  const bis = grenze.index + grenze[0].length;
  const davor = segment.slice(0, bis).trim();
  const angefangen = segment.slice(bis).trim();
  return davor && angefangen.length < davor.length ? ohne.slice(0, segmentAnfang + bis) : ohne;
}

// ── Abkürzungen, die ein Bot buchstabiert ────────────────────────────────────
// Der Punkt ist überall optional: Am Ende eines Segments nimmt ihn schon
// Schritt 4d weg („nach der 4. Std.“ → „nach der 4. Std“).
const ABKUERZUNGEN: readonly (readonly [RegExp, string])[] = [
  [new RegExp(String.raw`${VB}K[lL]\.?${NB}`, "g"), "Klasse"],
  [new RegExp(String.raw`${VB}Jg\.?${NB}`, "g"), "Jahrgang"],
  [new RegExp(String.raw`${VB}EA${NB}`, "g"), "Elternabend"],
  [new RegExp(String.raw`${VB}HA${NB}`, "g"), "Hausaufgabe"],
  [new RegExp(String.raw`${VB}Std\.?${NB}`, "g"), "Stunde"],
  [new RegExp(String.raw`${VB}bzw\.?${NB}`, "g"), "beziehungsweise"],
  [new RegExp(String.raw`${VB}z\.\s?B\.?${NB}`, "g"), "zum Beispiel"],
  [new RegExp(String.raw`${VB}ca\.?${NB}`, "g"), "circa"],
  [new RegExp(String.raw`${VB}ggf\.?${NB}`, "g"), "gegebenenfalls"],
  [new RegExp(String.raw`${VB}inkl\.?${NB}`, "g"), "inklusive"],
  [new RegExp(String.raw`${VB}Nr\.?${NB}`, "g"), "Nummer"],
  [new RegExp(String.raw`${VB}S\.\s?(?=\d)`, "g"), "Seite "],
  [new RegExp(String.raw`${VB}usw\.?${NB}`, "g"), "und so weiter"],
  [new RegExp(String.raw`${VB}u\.\s?a\.?${NB}`, "g"), "unter anderem"],
  [/\s*&\s*/g, " und "],
  [/\s*\+\s*/g, " und "],
  // Uhrzeiten sprechbar: „11h“ → „11 Uhr“, „12.30 Uhr“ → „12:30 Uhr“, „11:00 Uhr“ → „11 Uhr“
  [/(\d{1,2})[.:](\d{2})\s*h(?![A-Za-zÄÖÜäöüß])/g, "$1:$2 Uhr"],
  [/(?<![\d.:])(\d{1,2})\s*h(?![A-Za-zÄÖÜäöüß])/g, "$1 Uhr"],
  [/(\d{1,2})\.(\d{2})\s*Uhr/g, "$1:$2 Uhr"],
  [/(\d{1,2}):00\s*Uhr/g, "$1 Uhr"],
];

/**
 * Leerraum zusammen, kein Leerzeichen vor Satzzeichen, keine Trenner am Rand,
 * kein Schlusspunkt — außer nach einer Ziffer („4.“) und in Auslassungspunkten.
 */
function aufraeumen(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:/+&–-]+/, "")
    .replace(/[\s,;:/+&–-]+$/, "")
    .replace(/(?<![\d.])\.$/, "")
    .trim();
}

/** Schritt 7: Ordnungszahl mit Abstand, Kürzel ausgeschrieben, Uhrzeiten sprechbar. */
function sprechbar(text: string): string {
  let s = text.replace(/(\d)\.(?=[A-Za-zÄÖÜäöüß])/g, "$1. ");
  for (const [muster, ersatz] of ABKUERZUNGEN) s = s.replace(muster, ersatz);
  return aufraeumen(s);
}

/** NFKC, geschütztes Leerzeichen als Leerzeichen, Leerraum zusammengefasst. */
function vorbereiten(titel: string): string {
  return titel.normalize("NFKC").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function grossAnfang(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type SprechName = {
  /** Der Name, ohne Tageszähler und ohne „, frei“ */
  name: string;
  /** Eine eigene Frei-Angabe stand im Titel („_unterrichtsfrei“) */
  frei: boolean;
  /** Ferien: ein Balken, nur der Name */
  ferien: boolean;
};

export type SprechEingabe = Pick<
  IservItem,
  "titel" | "ganztaegig" | "ersterTag" | "letzterTag" | "beginn" | "ende"
>;

/** Der Name, wie ein Bot ihn vorliest — ohne Tageszähler und ohne „, frei“. */
export function sprechName(item: SprechEingabe, klasse: number): SprechName {
  // 0 Vorbereitung
  let t = vorbereiten(item.titel);
  t = t.replace(/([A-ZÄÖÜ][a-zäöüß]+)[:*_]innen(?![a-zäöüß])/g, "$1innen und $1");
  // Von IServ gekappt („… mit Führung durch die Fachr…“; NFKC macht aus „…“ drei Punkte)
  t = ohneGekapptesEnde(item.titel, t);

  // 1 Ferien
  const ferien = item.ganztaegig ? t.match(FERIEN_ANFANG) : null;
  if (ferien) return { name: grossAnfang(ferien[1]), frei: false, ferien: true };

  // 2 Klammern: mit Ziffer (Datum, anderer Termin, PLZ) ganz weg, sonst ein
  // eigenes Segment — ein Einschub braucht für den Bot eine Pause
  // („Brückentag_unterrichtsfrei (Hort geöffnet)“ → „Brückentag, Hort geöffnet, frei“)
  t = t.replace(/\s*[([]([^()[\]]*)[)\]]/g, (_ganz: string, innen: string) => (/\d/.test(innen) ? "" : `_${innen}_`));

  const mitUhrzeit =
    !item.ganztaegig && item.beginn !== null && item.ende !== null && item.ende > item.beginn;
  const eigeneZeiten = mitUhrzeit
    ? new Set([timeInBerlin(new Date(item.beginn as string)), timeInBerlin(new Date(item.ende as string))])
    : new Set<string>();
  const tage = daysBetween(item.ersterTag, item.letzterTag) + 1;

  // 3 Klassen: Nennt eine Klassenangabe die eigene Klasse, fallen alle am Rand
  // eines Segments weg (4c) — hinein kam der Termin ohnehin nur, weil er die
  // Klasse betrifft.
  const eigeneGenannt = [...t.matchAll(KLASSEN_ANGABE)].some((m) =>
    klassenIn(normalisiere(m[0])).has(klasse),
  );

  // 4 je Segment
  let frei = false;
  const segmente: string[] = [];
  for (const roh of t.split("_")) {
    let s = roh.trim();

    // 4a Datum
    s = s.replace(DATUMS_AUSDRUCK, " ");

    // 4b Uhrzeit, die Google schon als Beginn oder Ende zeigt
    if (mitUhrzeit) {
      s = s.replace(
        ZEIT_BEREICH,
        (ganz: string, h1?: string, m1?: string, h2?: string, m2?: string, h3?: string, m3?: string) => {
          const a = hhmm(h1, m1);
          const b = h2 !== undefined ? hhmm(h2, m2) : hhmm(h3, m3);
          return eigeneZeiten.has(a) || eigeneZeiten.has(b) ? " " : ganz;
        },
      );
      s = s.replace(ZEIT_EINZELN, (ganz: string, h1?: string, m1?: string, h2?: string, m2?: string) => {
        const a = h1 !== undefined ? hhmm(h1, m1) : hhmm(h2, m2);
        return eigeneZeiten.has(a) ? " " : ganz;
      });
    }

    // 4c eigene Klasse — nur am Rand des Segments
    if (eigeneGenannt) s = ohneEigeneKlasse(s);

    // 4d aufräumen
    s = aufraeumen(s);

    // 4e eine reine Frei-Angabe — steht sie mitten im Satz, sagt der Satz es schon
    if (FREI_SEGMENT.test(s)) {
      frei = true;
      continue;
    }

    // 4f Lehrerkürzel (nie das erste Segment), nur Wochentage, leere Segmente
    if (segmente.length > 0 && KUERZEL.test(s)) continue;
    if (NUR_WOCHENTAGE.test(s)) continue;
    if (s) segmente.push(s);
  }

  // 5 Ordnungszahlen der Tage („1. + 2. Pädagogischer Tag“ über 2 Tage,
  // „1. - 3. Pädagogischer Tag“ über 3)
  if (segmente.length > 0 && item.ganztaegig && tage >= 2) {
    const m = segmente[0].match(ORDNUNGSZAHLEN);
    if (m && gezaehlteTage(m[1]) === tage) {
      segmente[0] = segmente[0].slice(m[0].length);
    }
  }

  // 6 Fügen: mit Komma — für den Bot eine kurze Pause
  // 7 sprechbar machen
  let name = sprechbar(segmente.join(", "));

  // 8 Rückfall
  if (!name) {
    if (frei) return { name: "Unterrichtsfrei", frei: false, ferien: false };
    name = sprechbar(vorbereiten(item.titel).replace(/_/g, ", "));
  }

  return { name: grossAnfang(name), frei, ferien: false };
}

export type SprechTermin = {
  /** null: ein Termin für den ganzen Eintrag; sonst der Tag (YYYY-MM-DD) dieses Tages-Termins */
  tag: string | null;
  titel: string;
};

/**
 * Die Termine, die aus einem Eintrag in Google werden — meist einer, bei
 * einem mehrtägigen ganztägigen Termin einer je Tag. Ungekürzt; die Grenze
 * für Google zieht @/lib/calendar/events.
 */
export function sprechTermine(
  item: SprechEingabe & Pick<IservItem, "quelle">,
  klasse: number,
): SprechTermin[] {
  const { name, frei, ferien } = sprechName(item, klasse);
  const fr = frei ? ", frei" : "";
  const punkt =
    !item.ganztaegig && (item.ende === null || item.beginn === null || item.ende <= item.beginn);
  const zeit = !item.ganztaegig && item.beginn ? timeInBerlin(new Date(item.beginn)) : null;

  // a) Aufgabe: immer genau ein Termin; die Abgabezeit nicht doppelt
  if (item.quelle === "aufgaben") {
    const kopf = /^abgabe(?![a-zäöüß])/i.test(name) ? name : `Abgabe ${name}`;
    const mitZeit = zeit && punkt && !zeitenIn(name).includes(zeit);
    return [{ tag: null, titel: mitZeit ? `${kopf} bis ${sprechZeit(zeit)}` : kopf }];
  }

  // b) Ferien: ein Balken
  if (ferien) return [{ tag: null, titel: name }];

  // c) ganztägig über 2 bis 31 Tage: je Tag ein Termin, Wochenenden eingeschlossen
  const tage = daysBetween(item.ersterTag, item.letzterTag) + 1;
  if (item.ganztaegig && tage >= 2 && tage <= MAX_TAGE_EINZELN) {
    return Array.from({ length: tage }, (_, i) => ({
      tag: addDays(item.ersterTag, i),
      titel: `${name}, Tag ${i + 1} von ${tage}${fr}`,
    }));
  }

  // d) Punkt: die Uhrzeit in den Titel — außer er nennt schon eine
  if (zeit && punkt && zeitenIn(name).length === 0) {
    return [{ tag: null, titel: `${name} um ${sprechZeit(zeit)}${fr}` }];
  }

  // e) sonst ein Termin
  return [{ tag: null, titel: `${name}${fr}` }];
}

/** Was die Karte „Als Nächstes“ zeigt: der Titel in Google, bei Tages-Terminen ohne Zähler. */
export function kartenTitel(item: SprechEingabe & Pick<IservItem, "quelle">, klasse: number): string {
  const termine = sprechTermine(item, klasse);
  if (termine.length === 1) return termine[0].titel;
  const { name, frei } = sprechName(item, klasse);
  return `${name}${frei ? ", frei" : ""}`;
}
