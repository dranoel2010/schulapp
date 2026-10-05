/**
 * Betrifft dieser Termin aus dem öffentlichen Schulkalender meine Klasse?
 *
 * Reine Rechnung auf dem Titel — und der Grundsatz dahinter ist der Satz des
 * Nutzers: „aber nur die für meine Klasse kommen in den Kalender, das ist
 * wichtig“. Der öffentliche Kalender einer Schule trägt alles: Elternabende
 * jeder Klasse, Gremien, Kreise, Probeklausuren der Oberstufe, Hort und
 * Ferienbetreuung. Hinein kommt davon nur, was
 *
 *   (a) ausdrücklich die eigene Klasse nennt („Kl. 10_…“, „10. Klasse“,
 *       „Zehntklässler“),
 *   (b) einen Klassenbereich nennt, der sie einschließt („7. - 12. Kl“,
 *       „Klassen 1-12“, „ab Klasse 7“), oder
 *   (c) für alle gilt UND den Unterricht betrifft (unterrichtsfrei, Ferien,
 *       Schulsamstag, Unterrichtsende).
 *
 * **Im Zweifel draußen.** Lieber ein Termin zu wenig als ein fremder im
 * Kalender. Was knapp draußen bleibt, heißt `zweifel` und steht als eigene
 * Liste in den Einstellungen, damit der Nutzer mit ISERV_AUCH und ISERV_NIE
 * nachsteuern kann, ohne dass jemand Code ändert.
 *
 * ── Die Regeln, in dieser Reihenfolge ───────────────────────────────────────
 *
 *   0  leer                          → raus
 *   1  ISERV_NIE trifft              → raus (schlägt alles)
 *   2  Klassen genannt, eigene nicht → raus („fremde-klasse“) — auch
 *                                      ISERV_AUCH holt keine fremde Klasse
 *   3  Klasse unsicher, eigene       → raus, als Zweifel (ISERV_KLASSE
 *                                      womöglich veraltet, siehe unten)
 *   4  ISERV_AUCH trifft             → rein — außer bei einer fremden Stufe
 *   5  Oberstufen-Kurs (LF/gf/…)     → raus
 *   6  Elternabend, Gremium, Hort …  → raus — außer der Unterricht ist
 *                                      ausdrücklich betroffen („knapp“ rein)
 *   7  Stufe genannt, Klasse nicht   → raus (Stufen dienen nur dem Ausschluss)
 *   8  eigene Klasse genannt         → rein
 *   9  kein Klassenbezug, Unterricht → rein („alle-unterricht“)
 *  10  sonst                         → raus, als Zweifel
 *
 * „EA 10. Kl." bleibt mit Absicht draußen: Ein Elternabend ist für die Eltern,
 * auch wenn er die eigene Klasse nennt. Er steht dann aber in den Zweifeln.
 *
 * ── „Keine Klasse gefunden“ heißt nicht „für alle“ ──────────────────────────
 *
 * Regel 9 ist die einzige, die einen Termin ohne Klassenangabe hineinholt —
 * und damit die gefährlichste: Jede Schreibweise, die der Parser nicht kennt,
 * machte sonst aus einem fremden Termin einen schulweiten. Deshalb gilt sie
 * nur, wenn der Titel auch NICHTS Klassenähnliches trägt (`KLASSENBEZUG`:
 * „Klassenfahrt“ ohne Zahl, „12er“, „9a“, „Jahrgänge“, „Q1“,
 * „Abschlussklassen“, „Prüflinge“, „für die 9.“ …). Ein solcher Titel ist ein
 * Zweifel, kein Termin für alle.
 *
 * ── Klasse unsicher ──────────────────────────────────────────────────────────
 *
 * Findet die App in IServ keinen Kalender der Klasse aus ISERV_KLASSE, aber
 * einen der nächsten, ist ISERV_KLASSE wahrscheinlich vom letzten Schuljahr
 * (@/lib/iserv/parse, `klasseVeraltet()`). Dann wäre „Kl. 10_…“ die NEUE
 * zehnte Klasse — deshalb nimmt Regel 3 bis zur Korrektur keinen Termin, der
 * die eingestellte Klasse nennt.
 *
 * ── Wortgrenzen ──────────────────────────────────────────────────────────────
 *
 * `\b` taugt hier nicht: Für JavaScript ist „_“ ein Wortzeichen (in IServ der
 * häufigste Trenner: „Kl. 10_Präsentation“), und Umlaute sind keine — „\bkl“
 * träfe sonst mitten in „Fühlkl…“. Deshalb wird „_“ beim Normalisieren zum
 * Leerzeichen, und die Grenzen sind eigene Lookarounds über a–z und äöüß.
 */

export type FilterConfig = {
  klasse: number;
  /** Normalisierte Titelteile, die immer hineinkommen (ISERV_AUCH) */
  auch: string[];
  /** Normalisierte Titelteile, die nie hineinkommen — schlägt `auch` (ISERV_NIE) */
  nie: string[];
  /**
   * ISERV_KLASSE ist womöglich veraltet (neues Schuljahr): Kein Termin, der
   * die eingestellte Klasse nennt, kommt hinein (Regel 3).
   */
  klasseUnsicher?: boolean;
};

/** Stufen einer Waldorfschule — NUR zum Ausschließen, nie zum Aufnehmen. */
export const STUFEN: Record<string, readonly [number, number]> = {
  unterstufe: [1, 4],
  mittelstufe: [5, 8],
  oberstufe: [9, 13],
};

export type Urteil =
  | { nehmen: true; regel: string; grund: string; knapp: boolean }
  | { nehmen: false; regel: string; grund: string; zweifel: boolean };

const BUCHSTABE = "a-zäöüß";
/** Wortanfang, auch vor Umlauten */
const B = `(?<![${BUCHSTABE}])`;
/** Wortende */
const E = `(?![${BUCHSTABE}])`;

/**
 * Klein, „_“ und geschütztes Leerzeichen als Leerzeichen, alle Striche als
 * „-“, Leerraum zusammengefasst. Dieselbe Funktion normalisiert auch
 * ISERV_AUCH und ISERV_NIE, damit Titel und Ausnahme gleich aussehen.
 */
export function normalisiere(titel: string): string {
  return titel
    .normalize("NFKC")
    .replace(/[_ ]/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** „Kl.", „Klasse", „Klassen…", „Jahrgang(sstufe)", „Jahrgänge", „Jg." — aber nicht „Klausur". */
const ANKER = `${B}(?:kl(?:asse(?:n[${BUCHSTABE}]*)?)?|jahrg(?:a|ä)nge?s?(?:stufen?)?|jg)${E}`;
const SEP = String.raw`(?:-|\+|\/|,|&|und|bis)`;

/**
 * Zahl(en) VOR dem Anker: „10. Kl", „7. - 12. Kl", „9./10. Kl". Das
 * Lookbehind verhindert, dass in „am 3.10. Kl. 8" der Monat als Klasse 10
 * gelesen wird.
 */
const VOR = new RegExp(
  String.raw`(?<![\d.]|\d\.\s)(\d{1,2}(?:\s*\.?\s*${SEP}\s*\d{1,2})*)\s*\.?\s*${ANKER}`,
  "g",
);
/**
 * Zahl(en) NACH dem Anker: „Kl. 10", „Klassen 1-12", „Klassen 9 und 10".
 *
 * Dahinter darf keine weitere Ziffer kleben („Jg. 2010“), kein Datum ohne
 * Abstand („Kl. 10.11.“), kein Buchstabe („10er“, „10uhr“) und keine
 * Uhrzeit („Kl. 9 - 10 Uhr“ ist Klasse 9, nicht 9 bis 10). Ein Datum NACH
 * einem Abstand stört dagegen nicht: „Kl. 11_ 19.10.-30.10.“ ist Klasse 11.
 */
const NACH = new RegExp(
  String.raw`${ANKER}\s*\.?\s*(\d{1,2}[a-z]?(?:\s*\.?\s*${SEP}\s*\d{1,2}[a-z]?)*)(?![${BUCHSTABE}]|\d|\.\d|\s*uhr${E}|\s?:\d)`,
  "g",
);
/** „ab Klasse 7", „ab der 7. Klasse" → 7 bis 13. */
const AB = new RegExp(
  String.raw`${B}ab\s+(?:der\s+)?(?:${ANKER}\s*\.?\s*(\d{1,2})|(\d{1,2})\s*\.?\s*${ANKER})`,
  "g",
);
const ALLE = new RegExp(`${B}alle klassen${E}`);

/** Klassen als Zahlwort, wie an einer Waldorfschule üblich: „Achtklassspiel", „Elfte Klasse", „Zehntklässler". */
const ZAHLWORT: Record<string, number> = {
  erst: 1,
  zweit: 2,
  dritt: 3,
  viert: 4,
  fünft: 5,
  fuenft: 5,
  sechst: 6,
  siebent: 7,
  siebt: 7,
  acht: 8,
  neunt: 9,
  zehnt: 10,
  elft: 11,
  zwölft: 12,
  zwoelft: 12,
  dreizehnt: 13,
};
const ZAHLWORT_KLASSE = new RegExp(
  `${B}(${Object.keys(ZAHLWORT).join("|")})(?:e[nrs]?)?\\s?-?kl(?:a|ä)ss`,
  "g",
);

const HOECHSTE = 13;

/** Alle genannten Klassen, Bereiche aufgelöst. Erwartet einen normalisierten Titel. */
export function klassenIn(text: string): Set<number> {
  const klassen = new Set<number>();

  const gruppe = (teilText: string) => {
    // „7. - 12" | „1-12" | „5 bis 12" | „11 und 13" | „9/10" | „9+10"
    const teile = teilText.split(/\s*\.?\s*(?:\+|\/|,|&|und)\s*/);

    for (const teil of teile) {
      const bereich = teil.match(/^(\d{1,2})[a-z]?\s*\.?\s*(?:-|bis)\s*(\d{1,2})[a-z]?\.?$/);
      if (bereich) {
        const von = Number(bereich[1]);
        const bis = Number(bereich[2]);
        if (von >= 1 && von <= bis && bis <= HOECHSTE) {
          for (let k = von; k <= bis; k += 1) klassen.add(k);
        }
        continue;
      }

      const einzeln = teil.match(/^(\d{1,2})[a-z]?\.?$/);
      if (einzeln) {
        const k = Number(einzeln[1]);
        if (k >= 1 && k <= HOECHSTE) klassen.add(k);
      }
    }
  };

  for (const treffer of text.matchAll(VOR)) gruppe(treffer[1]);
  for (const treffer of text.matchAll(NACH)) gruppe(treffer[1]);
  for (const treffer of text.matchAll(AB)) {
    const ab = Number(treffer[1] ?? treffer[2]);
    if (ab >= 1 && ab <= HOECHSTE) {
      for (let k = ab; k <= HOECHSTE; k += 1) klassen.add(k);
    }
  }
  for (const treffer of text.matchAll(ZAHLWORT_KLASSE)) {
    klassen.add(ZAHLWORT[treffer[1]]);
  }
  if (ALLE.test(text)) {
    for (let k = 1; k <= HOECHSTE; k += 1) klassen.add(k);
  }

  return klassen;
}

/**
 * Trägt der Titel etwas, das nach einer Klasse oder Gruppe aussieht, die
 * `klassenIn()` nicht auflösen konnte? Dann ist er kein Termin „für alle“
 * (Regel 9), sondern ein Zweifel. Lieber zu viel hier als zu wenig: Ein
 * Treffer schiebt einen Termin nur in die Liste der Zweifel.
 */
const KLASSENBEZUG: readonly RegExp[] = [
  // „Klasse“, „Kl.“, „Jg.“ ohne lesbare Zahl; „Klassenfahrt“, „Abschlussklassen“
  new RegExp(ANKER),
  /kl(?:a|ä)ss/,
  // „12er“, „7er-9er“
  new RegExp(`(?<![\\d.])\\d{1,2}\\s?ern?${E}`),
  // „9a“, „10b“
  new RegExp(`(?<![\\d.])\\d{1,2}[a-d]${E}`),
  // „Jahrgänge“, „Sekundarstufe“, „Sek I“
  /jahrg|stufe/,
  new RegExp(`${B}sek${E}`),
  // Oberstufen-Phasen und Prüfungsgruppen
  new RegExp(`${B}q[1-4]${E}|qualifikationsphase|einf(?:ü|ue)hrungsphase`),
  /abschluss|pr(?:ü|ue)fling|wahlpflicht/,
  new RegExp(`${B}wp[ku]${E}`),
  // „für die 9.“ — aber nicht „nach der 4. Stunde“ oder „der 3. Pädagogische Tag“
  new RegExp(
    `${B}(?:die|der|den)\\s+\\d{1,2}\\.(?!\\s?\\d)(?!\\s*(?:[${BUCHSTABE}]+\\s+)?[${BUCHSTABE}]*(?:stunde|std|woche|tag|termin|mal|block|pause|halbjahr|epoche))`,
  ),
];

function klassenBezugUnklar(text: string): boolean {
  return KLASSENBEZUG.some((muster) => muster.test(text));
}

const KURS = new RegExp(`${B}(?:lf|gf|lk|gk|abitur|abi)${E}`);

/** Wer gemeint ist, wenn nicht die Schüler: Eltern, Gremien, Kollegium, Hort. Die Reihenfolge ist die des Grundes. */
const MARKER: readonly (readonly [RegExp, string])[] = [
  [new RegExp(`${B}ea${E}`), "Elternabend"],
  [/eltern/, "für Eltern"],
  [new RegExp(`kreis(?:e|es|treffen)?${E}`), "Gremium oder Kreis"],
  [new RegExp(`${B}sgk${E}`), "Gremium (SGK)"],
  [/kollegium|konferenz|lehrkr(?:ä|ae)ft|mitgliederversammlung|vorstand|gremi/, "Kollegium oder Gremium"],
  [new RegExp(`${B}hort${E}|ferienbetreuung|schlie(?:ß|ss)zeit`), "Hort"],
  [/einf(?:ü|ue)hrungsabend|info(?:rmations)?abend/, "Info- oder Einführungsabend"],
];

/** Der Unterricht ist ausdrücklich betroffen. */
const STARK = new RegExp(
  [
    "unterrichtsende",
    "unterricht endet",
    "unterricht f(?:ä|ae)llt aus",
    "keine?n? unterricht",
    "unterrichtsfrei",
    "schulfrei",
    "schule(?: und hort)? (?:ist |bleibt )?geschlossen",
  ].join("|"),
);

/**
 * Ferien zählen NUR ganztägig: In IServ stehen Ferien immer als ganztägiger
 * Balken; eine „Ferien-AG 15:30" ist eine AG.
 */
const FERIEN = new RegExp(
  `(?:herbst|winter|weihnachts|oster|pfingst|sommer|faschings|fastnachts)?ferien(?:tag)?${E}`,
);
const SCHULTAG = /schulsamstag/;

/** Sagt der Titel selbst, dass frei ist? Ohne „Unterrichtsende“ und „Schulsamstag“ — das sind Schultage. */
const FREI = new RegExp(
  [
    "unterrichtsfrei",
    "schulfrei",
    "keine?n? unterricht",
    "unterricht f(?:ä|ae)llt aus",
    "schule(?: und hort)? (?:ist |bleibt )?geschlossen",
  ].join("|"),
);

/**
 * Ist dieser Titel eine Ferien- oder Frei-Meldung — Ferien (nur ganztägig),
 * unterrichtsfrei, schulfrei, „Schule geschlossen“? Für @/lib/iserv/auswahl:
 * Nur solche Termine entfallen, wenn die App die Tage schon als frei kennt.
 */
export function istFreiTitel(eingabe: { titel: string; ganztaegig: boolean }): boolean {
  const t = normalisiere(eingabe.titel);
  return FREI.test(t) || (eingabe.ganztaegig && FERIEN.test(t));
}

/** Ein Titelteil aus ISERV_AUCH/ISERV_NIE trifft nur als ganzes Wort — „msa" trifft nicht „gemsa". */
function enthaeltTeil(titel: string, teil: string): boolean {
  const escaped = teil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![${BUCHSTABE}0-9])${escaped}(?![${BUCHSTABE}0-9])`).test(titel);
}

/** „7–12" für einen lückenlosen Bereich, sonst „9, 11". */
function klassenText(klassen: Set<number>): string {
  const liste = [...klassen].sort((a, b) => a - b);
  const luecklos = liste.every((k, i) => i === 0 || k === liste[i - 1] + 1);

  return luecklos && liste.length > 2
    ? `${liste[0]}–${liste[liste.length - 1]}`
    : liste.join(", ");
}

export function urteil(
  eingabe: { titel: string; ganztaegig: boolean },
  cfg: FilterConfig,
): Urteil {
  const t = normalisiere(eingabe.titel);
  const K = cfg.klasse;

  // 0
  if (t === "") return { nehmen: false, regel: "leer", grund: "kein Titel", zweifel: false };

  // 1
  const nie = cfg.nie.find((teil) => enthaeltTeil(t, teil));
  if (nie) {
    return { nehmen: false, regel: "nie", grund: `Ausnahme ISERV_NIE „${nie}“`, zweifel: false };
  }

  const klassen = klassenIn(t);
  const eigene = klassen.has(K);
  const stark = STARK.test(t);
  const unterricht = stark || (eingabe.ganztaegig && FERIEN.test(t)) || SCHULTAG.test(t);
  const unklar = klassen.size === 0 && klassenBezugUnklar(t);

  const stufen = eigene
    ? []
    : Object.entries(STUFEN).filter(([name]) => t.includes(name));
  const stufeEigen = stufen.some(([, [von, bis]]) => von <= K && K <= bis);
  const stufeFremd = stufen.length > 0 && !stufeEigen;
  const stufenText = stufen
    .map(([name]) => name.charAt(0).toUpperCase() + name.slice(1))
    .join(", ");

  // 2
  if (klassen.size > 0 && !eigene) {
    return {
      nehmen: false,
      regel: "fremde-klasse",
      grund: klassen.size === 1 ? `andere Klasse ${klassenText(klassen)}` : `andere Klassen ${klassenText(klassen)}`,
      zweifel: false,
    };
  }

  // 3
  if (eigene && cfg.klasseUnsicher) {
    return {
      nehmen: false,
      regel: "klasse-unsicher",
      grund: `nennt Klasse ${K}, aber ISERV_KLASSE ist womöglich vom letzten Schuljahr`,
      zweifel: true,
    };
  }

  // 4
  const auch = cfg.auch.find((teil) => enthaeltTeil(t, teil));
  if (auch && !stufeFremd) {
    return { nehmen: true, regel: "auch", grund: `Ausnahme ISERV_AUCH „${auch}“`, knapp: false };
  }

  // 5
  if (KURS.test(t)) {
    return {
      nehmen: false,
      regel: "kurs",
      grund: "Oberstufen-Kurs (LF/gf/LK/GK/Abitur)",
      zweifel: eigene,
    };
  }

  // 6
  const marker = MARKER.find(([muster]) => muster.test(t));
  if (marker) {
    if (stark && !stufeFremd && !unklar) {
      return {
        nehmen: true,
        regel: "unterricht-trotz-marker",
        grund: `${marker[1]}, aber der Unterricht ist betroffen`,
        knapp: true,
      };
    }
    return { nehmen: false, regel: "marker", grund: marker[1], zweifel: eigene || (stark && unklar) };
  }

  // 7
  if (stufeFremd) {
    return { nehmen: false, regel: "fremde-stufe", grund: `nennt ${stufenText}`, zweifel: unterricht };
  }
  if (stufeEigen) {
    return {
      nehmen: false,
      regel: "eigene-stufe",
      grund: `nennt ${stufenText}, aber nicht Klasse ${K}`,
      zweifel: true,
    };
  }

  // 8
  if (eigene) {
    return klassen.size === 1
      ? { nehmen: true, regel: "eigene-klasse", grund: `Klasse ${K}`, knapp: false }
      : { nehmen: true, regel: "bereich", grund: `Klassen ${klassenText(klassen)}`, knapp: false };
  }

  // 9
  if (unterricht && unklar) {
    return {
      nehmen: false,
      regel: "klassenbezug-unklar",
      grund: "nennt eine Klasse oder Gruppe, die der Filter nicht lesen kann",
      zweifel: true,
    };
  }
  if (unterricht) {
    return {
      nehmen: true,
      regel: "alle-unterricht",
      grund: "für alle: Unterricht oder Ferien betroffen",
      knapp: false,
    };
  }

  // 10
  return {
    nehmen: false,
    regel: "ohne-bezug",
    grund: `kein Bezug zu Klasse ${K} erkennbar`,
    zweifel: true,
  };
}
