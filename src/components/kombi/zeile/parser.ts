import { bare, norm, type FachEintrag } from "@/lib/kombi/fach-alias";
import { cap, wd } from "@/lib/kombi/text";
import { addTage } from "@/lib/kombi/vorrat";

/**
 * Der Parser der Zeile (Prototyp Z. 2265–2346, V1 4.4, V2 7.3): rein, ohne
 * DOM und ohne Datenbank. Er entscheidet, ob ein Satz eingetragen oder
 * gesucht wird, und zerlegt ihn in Fach, Fälligkeit und Aufgabentext.
 *
 * Die Wortlisten und Regeln sind wörtlich aus dem Prototyp übernommen; die
 * 23 Sätze aus `PARSER_SAETZE` (Z. 4621) prüft `parser.test.ts`.
 */

export type Absicht = "eintragen" | "suchen" | "aendern";

/** Kontext, mit dem die Zeile geöffnet wurde (Hausaufgabe eintragen, Ändern). */
export type ZeilenKontext = {
  intent: "eintragen" | "aendern";
  fach: string | null;
  due?: string | null;
  dueAuto?: boolean;
  dueRemoved?: boolean;
  editId?: string;
  text?: string;
  fachPills?: boolean;
  /** Beim Ändern: das volle Formular (Fach, Text, Fälligkeit, Notiz, Löschen) */
  details?: string;
};

export type ParseUmgebung = {
  faecher: readonly FachEintrag[];
  heute: string;
  /** nächster Tag mit einer Stunde des Fachs (freie Tage übersprungen) */
  naechsteStunde: (fachId: string, ab: string) => string | null;
  ctx: ZeilenKontext | null;
  override: Absicht | null;
};

export type Geparst = {
  raw: string;
  text: string;
  intent: Absicht;
  real: Absicht;
  held: boolean;
  why: "praefix" | "kontext" | "frage" | "ziel" | "fach" | "sonst";
  fach: FachEintrag | null;
  eFach: FachEintrag | null;
  due: string | null;
  dueAuto: boolean;
  dueExplicit: boolean;
  taskText: string;
  words: string[];
  n: string;
};

export const FRAGE = ["was", "wann", "wo", "wie", "wer", "welche", "welcher", "welches", "zeig", "zeige", "hab ich", "habe ich", "gibt es"];
export const ZIEL = [
  "heute", "morgen", "uebermorgen", "woche", "stundenplan", "noten", "klausur", "klausuren", "blatt", "blaetter", "ablage", "karten", "abfragen", "abfrage",
  "faecher", "einstellungen", "foto", "kamera", "lernblock", "wiederholen", "wiederholung", "ueberblick", "packen", "epoche",
  // App: weitere Navigationsantworten (Plan 2.2, „Neue Ziele für die Zeile“)
  "eingangskorb", "eingang", "bausteine",
  // Antwort 11: Vergangenes nach zwei Wochen
  "archiv",
];
export const ZIEL_REST = ["arbeit", "test", "hausaufgaben", "ha", "aufgaben", "vokabeln"];
export const FRAGE_REST = FRAGE.concat(["haben wir", "hab ich auf", "muss ich"]);
export const WH_WORDS = ["wiederholen", "wiederholung", "abfragen", "abfrage", "karten"];

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matchFach(faecher: readonly FachEintrag[], word: string, first: boolean): FachEintrag | null {
  const w = bare(word);
  if (!w) return null;
  return faecher.find((f) => f.alias.some((a) => bare(a) === w) || (first && f.k2 === w)) ?? null;
}

const WTAGE = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const PRE = "(?:(?:bis|für|fuer|zum|zur|am)\\s+(?:(?:zum|nächsten|naechsten|kommenden)\\s+)?)";

export type Faelligkeit = { date: string; match: string; index: number };

/** Ein Datum im Satz: „20.10.“, „bis Donnerstag“, „morgen“ (Prototyp `findDue`). */
export function findDue(s: string, heute: string): Faelligkeit | null {
  const t = heute;
  const mkDate = (d: number, m: number): string | null => {
    const y0 = Number(t.slice(0, 4));
    for (const y of [y0, y0 + 1]) {
      const dt = new Date(Date.UTC(y, m - 1, d, 12));
      if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
      const s2 = dt.toISOString().slice(0, 10);
      if (s2 >= t) return s2;
    }
    return null;
  };
  let m =
    s.match(new RegExp(`(?<![\\p{L}\\d])${PRE}(\\d{1,2})\\.(\\d{1,2})\\.?(?!\\d)`, "iu")) ||
    s.match(/(?<![\p{L}\d.])(\d{1,2})\.(\d{1,2})\.(?!\d)/u);
  if (m) {
    const dd = mkDate(+m[1], +m[2]);
    if (dd) return { date: dd, match: m[0], index: m.index ?? 0 };
  }
  m = s.match(
    new RegExp(
      `(?<![\\p{L}])${PRE}(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)(?![\\p{L}])\\.?`,
      "iu",
    ),
  );
  if (m) {
    const w = m[1].toLowerCase();
    const i = WTAGE.findIndex((x) => x.startsWith(w));
    let d = addTage(t, 1);
    while (wd(d) !== i) d = addTage(d, 1);
    return { date: d, match: m[0], index: m.index ?? 0 };
  }
  m = s.match(/(?<![\p{L}])(?:(?:bis|für|fuer|zum|zu|ab)\s+)?(übermorgen|uebermorgen|morgen)(?![\p{L}])/iu);
  if (m) return { date: addTage(t, /^(über|ueber)/i.test(m[1]) ? 2 : 1), match: m[0], index: m.index ?? 0 };
  return null;
}

/** Aufgabentext aufräumen: „s 90“ → „S. 90“, „nr 1-4“ → „Nr. 1–4“. */
export function fmtTask(s: string): string {
  s = s.replace(/^[\s,.:;–-]+|[\s,:;–-]+$/g, "");
  s = s
    .replace(/(?<![\p{L}])s\.?\s*(\d)/giu, "S. $1")
    .replace(/(?<![\p{L}])nr\.?\s*(\d)/giu, "Nr. $1")
    .replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
  return cap(s);
}

/** Satz zerlegen (Prototyp `parse`, Z. 2307). `hold` hält die vorige Absicht während des Tippens. */
export function parse(raw: string, u: ParseUmgebung, hold?: Absicht | null): Geparst {
  const ctx = u.ctx;
  let text = raw.replace(/\s+/g, " ").trim();
  let intent: Absicht | null = null;
  let why: Geparst["why"] = "sonst";
  if (!ctx && text.startsWith("+")) {
    intent = "eintragen";
    why = "praefix";
    text = text.slice(1).trim();
  } else if (!ctx && text.startsWith("?")) {
    intent = "suchen";
    why = "praefix";
    text = text.slice(1).trim();
  }
  const words = text.split(" ").filter(Boolean);
  let fach: FachEintrag | null = null;
  let fachAtStart = false;
  if (words.length) {
    const f = matchFach(u.faecher, words[0], true);
    if (f) {
      fach = f;
      fachAtStart = true;
    }
  }
  if (!fach)
    for (const w of words) {
      const f = matchFach(u.faecher, w, false);
      if (f) {
        fach = f;
        break;
      }
    }
  const due = findDue(text, u.heute);
  let rest = text;
  if (due) rest = rest.slice(0, due.index) + " " + rest.slice(due.index + due.match.length);
  const stripFach = fachAtStart && !(ctx && ctx.fach);
  if (stripFach) rest = rest.replace(new RegExp(`^\\s*${escRe(words[0])}`, "iu"), "");
  rest = rest.replace(/\s+/g, " ").trim();
  const restWords = rest.split(" ").filter(Boolean).map(bare).filter(Boolean);
  const n = norm(text);
  if (ctx) {
    intent = ctx.intent;
    why = "kontext";
  } else if (!intent) {
    if (/\?\s*$/.test(text) || FRAGE.some((q) => n === q || n.startsWith(q + " "))) {
      intent = "suchen";
      why = "frage";
    } else if (words.length && ZIEL.includes(bare(words[0]))) {
      intent = "suchen";
      why = "ziel";
    } else if (fachAtStart && restWords.length) {
      const r0 = norm(rest);
      if (FRAGE_REST.some((q) => r0 === q || r0.startsWith(q + " "))) {
        intent = "suchen";
        why = "frage";
      } else if (restWords.some((w) => ZIEL.includes(w))) {
        intent = "suchen";
        why = "ziel";
      } else if (restWords.length === 1 && ZIEL_REST.includes(restWords[0])) {
        intent = "suchen";
        why = "ziel";
      } else {
        intent = "eintragen";
        why = "fach";
      }
    } else {
      intent = "suchen";
      why = "sonst";
    }
  }
  const real: Absicht = intent ?? "suchen";
  let eff: Absicht = real;
  if (hold && !ctx && !u.override && why !== "praefix") eff = hold;
  if (u.override) eff = u.override === "eintragen" && ctx && ctx.intent === "aendern" ? "aendern" : u.override;
  const ctxFach = ctx?.fach ? (u.faecher.find((f) => f.id === ctx.fach) ?? null) : null;
  const eFach = ctx ? (ctx.fach ? ctxFach : fachAtStart ? fach : null) : fach;
  let eDue: string | null = due ? due.date : null;
  let dueAuto = false;
  if (!due && ctx && ctx.due) {
    eDue = ctx.due;
    dueAuto = !!ctx.dueAuto;
  }
  if (!eDue && eFach && !(ctx && ctx.dueRemoved)) {
    const nl = u.naechsteStunde(eFach.id, u.heute);
    if (nl) {
      eDue = nl;
      dueAuto = true;
    }
  }
  const taskText = fmtTask(eff === "suchen" ? text : rest);
  return {
    raw,
    text,
    intent: eff,
    real,
    held: eff !== real,
    why,
    fach,
    eFach,
    due: eDue,
    dueAuto,
    dueExplicit: !!due,
    taskText,
    words,
    n,
  };
}
