import { addDays, daysBetween } from "@/lib/dates";

/**
 * Wann ein Baustein wieder drankommt.
 *
 * Alles hier ist reine Rechnung: keine Datenbank, keine Systemuhr. „Heute"
 * kommt von außen, dieselbe Eingabe ergibt immer dieselbe Ausgabe — dieselbe
 * Bauweise wie @/lib/study-plan und aus demselben Grund: sonst sind die Tests
 * an einem bestimmten Tag rot.
 *
 * ── Was diese Datei bewusst NICHT tut ────────────────────────────────────────
 *
 * Sie lernt nichts. Es gibt keine Leichtigkeitsnote, keinen Faktor, keine
 * Kurve, die sich an das Antwortverhalten anpasst — und das ist die am besten
 * belegte Entscheidung des ganzen Vorhabens: expandierende gegen feste
 * Abstände ergeben g = 0,034 [-0,10; 0,17] bei I² = 0 Prozent und ohne
 * Publikationsbias; bei vier oder weniger Begegnungen je Baustein sogar -0,04.
 * Das ist kein schwacher Effekt, sondern ein sauberer Nullbefund.
 *
 * Dazu kommt der Kaltstart: Fünfzehn Epochenabende liefern nicht die paar
 * hundert Wiederholungen, aus denen ein adaptives Verfahren etwas ableiten
 * könnte. Was es ableiten würde, wäre Rauschen mit einer Nachkommastelle.
 *
 * Die Anforderung an diese Rechnung lautet deshalb: **termintreu,
 * umschaltbar, langweilig.** Wer sie später „verbessern" will, misst zuerst
 * die Zahl oben nach.
 *
 * ── Wo die Vorgabewerte herkommen ────────────────────────────────────────────
 *
 * Aus Abschnitt 5 des Architektenberichts, und dort steht zu jedem einzelnen,
 * warum die Forschung ihn nicht festlegt. Sie stehen hier als benannte
 * Konstanten und nicht als Ziffern im Code, damit sichtbar bleibt, dass es
 * Setzungen sind. In Stufe 1 ziehen sie in eine Tabelle um — dann sind sie
 * änderbar, ohne neu auszuliefern.
 */

/** Vor der Klausur wird verdichtet, danach gestreckt (A8). */
export type Betriebsart = "klausur" | "erhaltung";

export type GeplanteFaelligkeit = {
  /** "YYYY-MM-DD" */
  dueOn: string;
  /** Die wievielte Begegnung, von 1 an durchgezählt über beide Betriebsarten */
  round: number;
  mode: Betriebsart;
  sortOrder: number;
};

/**
 * `kein-termin`  Zu diesem Fach steht keine Klausur an — geplant wird im
 *                Grundtakt, aber ohne Ziel, auf das hin verdichtet wird.
 * `keine-tage`   Zwischen heute und der Klausur liegt kein nutzbarer Tag.
 * `zu-knapp`     Es reicht nicht für die vier Begegnungen aus A6.
 */
export type PlanWarnung = "kein-termin" | "keine-tage" | "zu-knapp";

export type Faelligkeitsplan = {
  faelligkeiten: GeplanteFaelligkeit[];
  warnungen: PlanWarnung[];
};

export type PlanEingabe = {
  /** "YYYY-MM-DD" — der Tag, an dem gerechnet wird */
  heute: string;
  /** "YYYY-MM-DD" — der Tag, an dem der Baustein entstand */
  aufgenommenAm: string;
  /** "YYYY-MM-DD" oder null, wenn zu diesem Fach keine Klausur ansteht */
  klausurtag: string | null;
  /** P2 — Abstand in Tagen vor der Klausur */
  takt?: number;
  /** P2 — in der letzten Woche jeden Tag statt im Takt */
  letzteWocheTaeglich?: boolean;
  /** P6 — Abstand in Tagen nach der Klausur */
  erhaltungstakt?: number;
  /** P7 — wie viele Termine nach der Klausur */
  erhaltungstermine?: number;
  /** Ferien, Feiertage, Tage ohne Abend */
  sperrtage?: string[];
  /** A6 — wie oft ein Baustein bis zur Klausur mindestens fällig wird */
  mindestRunden?: number;
};

/**
 * P2: Alle zwei bis drei Tage. Drei, weil bei zehn Tagen Prüfabstand die
 * Abstände 1, 2, 4 und 7 Tage gleichwertig waren — wo die Forschung keinen
 * Unterschied findet, entscheidet der Abend, und drei Tage füllen ihn weniger.
 */
const TAKT = 3;

/**
 * P6: Drei Wochen. Cepedas Optimum für einen Prüfabstand von 70 Tagen liegt
 * bei 21 Tagen — allerdings aus zwei Sitzungen mit Trivia-Fakten, und Bahricks
 * 56-Tage-Takt stammt aus N = 4, bei dem die vier Personen die Autoren selbst
 * sind. Das ist die schwächste Zahl im ganzen Bericht.
 */
const ERHALTUNGSTAKT = 21;

/**
 * P7: Zwei bis drei. Von keiner Quelle beantwortet — der Bericht nennt es
 * ausdrücklich „die offenste Stelle des Entwurfs".
 */
const ERHALTUNGSTERMINE = 3;

/**
 * A6: Viermal. Die Dosis beider Feldexperimente (87 gegen 76 Prozent,
 * d = 0,69), und der größte Sprung liegt zwischen einmal und zweimal
 * (0,444 auf 0,601).
 */
const MINDEST_RUNDEN = 4;

/** Die letzte Woche vor der Klausur — dort wird täglich statt im Takt. */
const ENDSPURT_TAGE = 7;

/**
 * Wie viele Tage ein Plan höchstens umfasst, wenn keine Klausur ansteht.
 *
 * Ohne Termin gibt es kein Ziel, auf das hin verdichtet wird, und ohne Grenze
 * liefe die Schleife bis ans Ende der Zeit. Vier Runden im Grundtakt sind
 * genau A6 — mehr zu planen, ohne zu wissen, worauf, wäre geraten.
 */
const OHNE_TERMIN_RUNDEN = MINDEST_RUNDEN;

/**
 * Der nächste Tag, der nicht gesperrt ist.
 *
 * Ein gesperrter Tag verschiebt nach hinten und fällt nicht aus: A16 erlaubt
 * ausdrücklich, Zeit und neue Bausteine zu deckeln, und verbietet ebenso
 * ausdrücklich, fällige Wiederholungen zu deckeln. Die Zahl der
 * Abrufgelegenheiten IST die belegte Stellgröße.
 *
 * `grenze` ist der letzte erlaubte Tag; gibt es bis dahin keinen freien, kommt
 * `null` zurück und der Termin entfällt — dann ist die Sperre länger als die
 * Restzeit, und das ist eine Tatsache und kein Fehler.
 */
function naechsterFreierTag(
  tag: string,
  gesperrt: ReadonlySet<string>,
  grenze: string | null,
): string | null {
  let kandidat = tag;

  while (gesperrt.has(kandidat)) {
    kandidat = addDays(kandidat, 1);
    if (grenze !== null && daysBetween(kandidat, grenze) < 0) return null;
  }

  if (grenze !== null && daysBetween(kandidat, grenze) < 0) return null;
  return kandidat;
}

/**
 * Die Tage vor der Klausur, an denen dieser Baustein fällig wird.
 *
 * Zwei Rhythmen hintereinander: bis eine Woche vor der Klausur im Grundtakt,
 * danach täglich. Der Endspurt ist keine Panikmache, sondern die billigste
 * Stelle, an der A6 noch zu erfüllen ist, wenn ein Baustein spät entstanden
 * ist — und genau das ist im Epochenunterricht der Normalfall: Der Stoff des
 * vorletzten Tages hat keine drei Takte mehr Zeit.
 */
function tageVorDerKlausur(
  start: string,
  klausurtag: string,
  takt: number,
  endspurtTaeglich: boolean,
  gesperrt: ReadonlySet<string>,
): string[] {
  // Am Klausurtag selbst wird nicht mehr geübt — da wird geschrieben.
  const letzterTag = addDays(klausurtag, -1);
  if (daysBetween(start, letzterTag) < 0) return [];

  const endspurtBeginn = endspurtTaeglich
    ? addDays(klausurtag, -ENDSPURT_TAGE)
    : null;

  const tage: string[] = [];
  let kandidat = start;

  while (daysBetween(kandidat, letzterTag) >= 0) {
    const frei = naechsterFreierTag(kandidat, gesperrt, letzterTag);
    if (frei === null) break;

    // Ein verschobener Termin darf nicht auf einem schon belegten Tag landen.
    if (tage.at(-1) !== frei) tage.push(frei);

    const imEndspurt =
      endspurtBeginn !== null && daysBetween(endspurtBeginn, frei) >= 0;
    kandidat = addDays(frei, imEndspurt ? 1 : takt);
  }

  return tage;
}

/**
 * Der Terminplan für einen Baustein.
 *
 * ── A7 ist hier eine Eigenschaft und keine Prüfung ───────────────────────────
 *
 * Kein Fälligkeitsdatum der Betriebsart `klausur` liegt hinter dem
 * Klausurtermin, und kein Abstand ist länger als die Restzeit. Das steht nicht
 * als `if` am Ende, sondern folgt daraus, dass alle Tage aus dem Fenster
 * zwischen Start und Klausurtag stammen. Der Grund für die Regel: Bei zehn
 * Tagen Prüfabstand war ein Abstand von 14 Tagen nicht mehr besser als
 * massiertes Lernen, sondern schlechter (d = -0,46). Ein Wiederholungstermin
 * nach der Klausur ist für die Klausur keiner.
 *
 * ── A8: die zwei Betriebsarten ───────────────────────────────────────────────
 *
 * Der Umschaltpunkt ist der Tag nach der Klausur und wird vom Kalender
 * ausgelöst, nicht vom Nutzer gewählt — das Optimum hängt am Behaltensziel
 * (1 / 11 / 21 / 21 Tage bei Prüfabstand 7 / 35 / 70 / 350) und nicht am
 * Gefühl. Der Erhaltungsmodus steht bewusst schon in der ersten Fassung,
 * obwohl er die am schlechtesten belegte Anforderung ist: Wird er später
 * nachgerüstet, fehlt für die erste Epochenlücke jede Datenlage, die über ihn
 * entscheiden könnte.
 */
export function planeFaelligkeiten(eingabe: PlanEingabe): Faelligkeitsplan {
  const {
    heute,
    aufgenommenAm,
    klausurtag,
    takt = TAKT,
    letzteWocheTaeglich = true,
    erhaltungstakt = ERHALTUNGSTAKT,
    erhaltungstermine = ERHALTUNGSTERMINE,
    sperrtage = [],
    mindestRunden = MINDEST_RUNDEN,
  } = eingabe;

  const gesperrt = new Set(sperrtage);
  const warnungen: PlanWarnung[] = [];

  // Der erste Termin liegt einen Takt nach der Aufnahme — der Abend, an dem
  // der Baustein entstand, IST die erste Begegnung. Liegt die Aufnahme in der
  // Vergangenheit, wird ab heute geplant: ein Termin von gestern ist keiner.
  //
  // Der Startpunkt hängt am Takt und wird deshalb als Funktion gebraucht: Wird
  // unten verdichtet, um A6 noch zu erfüllen, rückt auch der erste Termin
  // näher. Stünde er fest, liefe die Verdichtung ins Leere — genau dann, wenn
  // sie gebraucht wird, nämlich bei einem spät entstandenen Baustein.
  const startFuer = (abstand: number): string => {
    const frühestens = addDays(aufgenommenAm, abstand);
    return daysBetween(frühestens, heute) > 0 ? heute : frühestens;
  };

  const faelligkeiten: GeplanteFaelligkeit[] = [];
  const eintragen = (dueOn: string, mode: Betriebsart) => {
    faelligkeiten.push({
      dueOn,
      round: faelligkeiten.length + 1,
      mode,
      sortOrder: faelligkeiten.length,
    });
  };

  if (klausurtag === null) {
    // Ohne Termin gibt es nichts, worauf hin verdichtet wird. Der Grundtakt
    // läuft trotzdem: verteiltes Abrufen wirkt auch ohne Prüfung (g = 0,74),
    // nur die Verdichtung am Ende hat kein Ende, auf das sie zuliefe.
    warnungen.push("kein-termin");

    let tag = startFuer(takt);
    for (let i = 0; i < OHNE_TERMIN_RUNDEN; i += 1) {
      const frei = naechsterFreierTag(tag, gesperrt, null);
      if (frei === null) break;
      eintragen(frei, "klausur");
      tag = addDays(frei, takt);
    }

    return { faelligkeiten, warnungen };
  }

  let tage = tageVorDerKlausur(
    startFuer(takt),
    klausurtag,
    takt,
    letzteWocheTaeglich,
    gesperrt,
  );

  // A6 verlangt vier Begegnungen. Reicht der Grundtakt dafür nicht, wird er
  // verkürzt, bis es passt — und nicht etwa der Plan gestreckt. Bei zehn Tagen
  // Prüfabstand waren 1, 2, 4 und 7 Tage Abstand gleichwertig; enger zu takten
  // kostet also nichts Belegtes, während eine Begegnung weniger messbar kostet
  // (0,601 gegen 0,444 zwischen zweimal und einmal).
  for (
    let engerer = takt - 1;
    tage.length < mindestRunden && engerer >= 1;
    engerer -= 1
  ) {
    tage = tageVorDerKlausur(
      startFuer(engerer),
      klausurtag,
      engerer,
      letzteWocheTaeglich,
      gesperrt,
    );
  }

  if (tage.length === 0) warnungen.push("keine-tage");
  else if (tage.length < mindestRunden) warnungen.push("zu-knapp");

  for (const tag of tage) eintragen(tag, "klausur");

  // Nach der Klausur: der zweite, weitere Takt über die Epochenlücke. Er läuft
  // vom Klausurtag aus und nicht vom letzten Übungstag — sonst verschöbe ein
  // knapper Endspurt die ganze Erhaltung mit nach vorn.
  let erhaltungstag = klausurtag;
  for (let i = 0; i < erhaltungstermine; i += 1) {
    erhaltungstag = addDays(erhaltungstag, erhaltungstakt);

    const frei = naechsterFreierTag(erhaltungstag, gesperrt, null);
    if (frei === null) break;

    eintragen(frei, "erhaltung");
    erhaltungstag = frei;
  }

  return { faelligkeiten, warnungen };
}

/**
 * Was heute ansteht.
 *
 * Überfälliges gehört dazu, und zwar nach vorn. Ein Termin, der gestern nicht
 * geschafft wurde, verschwindet nicht — er wartet. Das ist die Gegenseite zu
 * der Entscheidung, in `recall_schedule` keinen Zustand „übersprungen" zu
 * führen: Was man nicht wegdrücken kann, muss irgendwann gezeigt werden.
 */
export function istFaellig(
  faelligkeit: { dueOn: string; doneAt: Date | null },
  heute: string,
): boolean {
  return faelligkeit.doneAt === null && daysBetween(faelligkeit.dueOn, heute) >= 0;
}
