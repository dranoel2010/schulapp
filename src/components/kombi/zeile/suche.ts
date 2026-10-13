import { bare, norm, type FachEintrag } from "@/lib/kombi/fach-alias";
import { TAG, TK, dm, kurz, lang, wd } from "@/lib/kombi/text";
import {
  ERLEDIGT_LISTE_TAGE,
  ERLEDIGT_SUCHE_TAGE,
  addTage,
  fmtRest,
  inFerien,
  isSchool,
  klausurenBald,
  lessonsOn,
  nextSchool,
  nthSchool,
  relTage,
  schluss,
  type VorratAufgabe,
  type VorratKlausur,
  type VorratNote,
  type ZeilenVorrat,
} from "@/lib/kombi/vorrat";

import { grammatikAntwort, istGrammatikBlatt } from "./grammatik";
import { WH_WORDS, ZIEL, type Geparst } from "./parser";

/**
 * Die Suche der Zeile (Prototyp Z. 2348–2519, 2592–2616): Antworten beim
 * Tippen, Gruppen der Treffer, oberster Treffer und die Vorschläge im leeren
 * Menü. Rein und ohne DOM — Texte kommen als Teile (`Txt`) zurück, die das
 * Menü als Text rendert (nie `innerHTML`), und jedes Ziel als Beschreibung
 * (`Ziel`), die die Zeile ausführt. So lassen sich Wortlaut und Rang ohne
 * Browser prüfen.
 */

// ── Texte mit Hervorhebung ───────────────────────────────────────────────────

/** `hl` = Treffer (650), `dim` = Rest (--ink-2), `b` = fett (Fach), `nw` = nicht umbrechen */
export type Teil = { t: string; k?: "hl" | "dim" | "b" | "nw" };
export type Txt = string | Teil[];

export const txtText = (x: Txt | null | undefined): string =>
  x == null ? "" : typeof x === "string" ? x : x.map((p) => p.t).join("");

export const textWords = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

export function wordHit(q: string, s: string): boolean {
  const ws = textWords(s);
  return ws.some((w) => (q.length >= 3 ? w.startsWith(q) : w === q));
}

/** Treffer hervorheben (Prototyp `hl`, Z. 2351). */
export function hl(text: string, qs: readonly string[]): Teil[] {
  return String(text)
    .split(/(\s+)/)
    .filter((p) => p !== "")
    .map((p) => {
      const hit = !!p.trim() && qs.some((q) => textWords(p).some((w) => (q.length >= 3 ? w.startsWith(q) : w === q)));
      return { t: p, k: hit ? "hl" : "dim" };
    });
}

export const STOP = new Set([
  "haben", "wir", "auf", "ist", "sind", "der", "die", "das", "ein", "eine", "ich", "hab", "habe", "gibt", "es", "in", "im", "fuer", "bis",
  "am", "zum", "zur", "und", "mit", "mein", "meine", "was", "wann", "wo", "wie", "wer", "welche", "welcher", "welches", "zeig", "zeige",
]);

/** Wörter, die keinen Inhalt suchen, sondern ein Ziel nennen (Prototyp `contentQs`). */
export const ZIEL_INHALT = new Set([...ZIEL, "hausaufgaben", "ha", "aufgaben"]);

// ── Ziele ────────────────────────────────────────────────────────────────────

export type Ziel =
  | { typ: "seite"; art: string; params?: Record<string, string> }
  | { typ: "route"; url: string }
  | { typ: "ansicht"; ansicht: "ueberblick" | "morgens" | "frueh" }
  | { typ: "ablauf" }
  /** `thema`: genau dieses Thema als Arbeitsblatt („Blatt Grammatik …“, Antwort 5) */
  | { typ: "tisch"; mode: "wh" | "block"; fach?: string | null; blockId?: string; thema?: string }
  | { typ: "kamera"; ziel: "zeile" | "liste" }
  | { typ: "ha-kontext" };

// ── Antworten beim Tippen (Prototyp `answerFor`, Z. 2413) ────────────────────

export type TagInhalt = {
  art: "tag";
  frei: string | null;
  stunden: { von: string; fach: string; em: string }[];
  abgeben: VorratAufgabe[];
};
export type NotenInhalt = { art: "noten"; noten: VorratNote[]; leer: string | null };
export type KlausurInhalt = {
  art: "klausur";
  kopf: string;
  zeilen: { time: string; b: string; em: string }[];
};
export type AntwortInhalt = TagInhalt | NotenInhalt | KlausurInhalt;

export type Antwort =
  | {
      kind: "nav";
      l1: string;
      l2?: string | null;
      ziel: Ziel | null;
      /** eine kurze Auswahl unter dem obersten Treffer („Blatt Grammatik“) */
      wahl?: { label: string; items: Option[] };
    }
  | {
      kind: "tag" | "noten" | "klausur";
      l1: string;
      l2?: string | null;
      inhalt: AntwortInhalt;
      open: Ziel;
      openLabel: string;
    };

export type SuchUmgebung = {
  v: ZeilenVorrat;
  /** jetzt in ms (Serveruhr) */
  jetzt: number;
  /** im offenen Menü eingefroren: der Erledigt-Stand beim letzten Tippen */
  doneFuer: (a: VorratAufgabe) => number | null;
};

const F = (v: ZeilenVorrat, id: string): FachEintrag =>
  v.faecher.find((f) => f.id === id) ?? { id, name: "Fach", kurz: "Fach", alias: [], k2: null };

/** Zeitpunkt „HH:MM“ eines App-Tags in ms (Berlin). */
function zeitpunkt(tag: string, hhmm: string): number {
  // Berlin ist UTC+1 oder +2; die Zeile vergleicht nur mit der Serveruhr,
  // deshalb über Intl den Versatz des Tages bestimmen.
  const probe = new Date(`${tag}T12:00:00Z`);
  const berlin = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(probe);
  const versatz = Number(berlin) - 12;
  const [H, M] = hhmm.split(":").map(Number);
  return Date.UTC(Number(tag.slice(0, 4)), Number(tag.slice(5, 7)) - 1, Number(tag.slice(8, 10)), H - versatz, M);
}

export function schlussMs(v: ZeilenVorrat, tag: string): number | null {
  const s = schluss(v, tag);
  return s ? zeitpunkt(tag, s) : null;
}

/**
 * Was an einem Tag abzugeben ist: die an dem Tag fälligen und davor, was
 * überfällig und noch offen ist (wie `abgabenAm` der Startseite). Heute an
 * einem Schultag Fälliges zählt erst ab morgen als überfällig, so wie der
 * Überblick es für den nächsten Schultag nicht mitzählt.
 */
function abgabenAm(v: ZeilenVorrat, day: string): VorratAufgabe[] {
  const heute = v.heute;
  const ueber =
    day >= heute
      ? v.aufgaben
          .filter((a) => !a.done && a.due < day && a.due <= heute && !(a.due === heute && isSchool(v, heute)))
          .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
      : [];
  return [...ueber, ...v.aufgaben.filter((a) => a.due === day)];
}

function morgenAnswer(v: ZeilenVorrat, day: string): TagInhalt {
  const ls = lessonsOn(v, day);
  const fr = inFerien(v, day);
  return {
    art: "tag",
    frei: ls.length ? null : fr?.ferien ? "Ferien" : "Keine Schule",
    stunden: ls.map((l) => ({
      von: l.von,
      fach: F(v, l.fachId).name,
      em: l.hu ? `Hauptunterricht${l.raum ? ` · ${l.raum}` : ""}` : (l.raum ?? ""),
    })),
    abgeben: abgabenAm(v, day),
  };
}

const morgenSumm = (v: ZeilenVorrat, d: string) => {
  const n = lessonsOn(v, d).length;
  const a = abgabenAm(v, d).length;
  return `${n} ${n === 1 ? "Stunde" : "Stunden"}, ${a} ${a === 1 ? "Abgabe" : "Abgaben"}`;
};

function notenAnswer(v: ZeilenVorrat, fid: string): NotenInhalt {
  const list = v.noten[fid] ?? [];
  return { art: "noten", noten: list, leer: list.length ? null : `Keine Noten in ${F(v, fid).name}` };
}

function klausurAnswer(v: ZeilenVorrat, k: VorratKlausur): KlausurInhalt {
  return {
    art: "klausur",
    kopf: `${k.thema}, ${relTage(v.heute, k.datum)}`,
    zeilen: k.plan
      .filter((p) => p.tag >= v.heute)
      .map((p) => ({
        time: p.tag === v.heute ? "Heute" : TK[wd(p.tag)],
        b: p.art === "Lernblock" ? p.thema : p.art,
        em: p.art === "Lernblock" ? `Lernblock, ${p.min} Minuten` : p.thema,
      })),
  };
}

/** Lernblock von heute, wenn er noch offen ist (Prototyp `lernblockOpt`, Z. 2374). */
export function lernblockOpt(v: ZeilenVorrat): { l1: string; l2: string; ziel: Ziel } | null {
  const b = v.lernblock;
  if (!b) return null;
  return {
    l1: b.zustand === "ruhe" ? "Lernblock starten" : "Lernblock fortsetzen",
    l2: `${b.label}, ${b.zustand === "ruhe" ? `${b.minuten} Minuten` : `noch ${fmtRest(b.restMs)}`}`,
    ziel: { typ: "tisch", mode: "block", blockId: b.key },
  };
}

function whAnswer(v: ZeilenVorrat, fach: FachEintrag | null): Antwort {
  if (inFerien(v, v.heute)) return { kind: "nav", l1: "In den Ferien wird nicht wiederholt.", ziel: null };
  const th = fach ? v.themen.filter((t) => t.fachId === fach.id) : v.themen;
  if (fach) {
    if (!th.length) return { kind: "nav", l1: `In ${fach.name} ist heute nichts fällig.`, ziel: null };
    return { kind: "nav", l1: `Wiederholen · nur ${fach.name} · ${th[0].name}`, l2: th[0].umfang, ziel: { typ: "tisch", mode: "wh", fach: fach.id } };
  }
  if (!th.length) return { kind: "nav", l1: v.wh.kind === "text" ? v.wh.text : "Heute ist nichts fällig.", ziel: null };
  return {
    kind: "nav",
    l1: `Wiederholen · ${th.length} ${th.length === 1 ? "Thema" : "Themen"}, zuerst ${F(v, th[0].fachId).name}`,
    l2: th[0].name,
    ziel: { typ: "tisch", mode: "wh", fach: null },
  };
}

export function answerFor(p: Pick<Geparst, "words" | "fach">, u: SuchUmgebung): Antwort | null {
  const v = u.v;
  const W = p.words.map(bare);
  const has = (w: string) => W.includes(w);
  const fach = p.fach;
  const heute = v.heute;
  const tagAns = (d: string): Antwort => ({
    kind: "tag",
    l1: `${lang(d)}, ${morgenSumm(v, d)}`,
    l2: null,
    inhalt: morgenAnswer(v, d),
    open: { typ: "ansicht", ansicht: d === heute && v.ansicht === "morgens" ? "morgens" : "frueh" },
    openLabel: "Morgenansicht öffnen",
  });
  // „Blatt Grammatik Englisch“ (Antwort 5): vor allen anderen Wörtern, auch vor „morgen“
  if (istGrammatikBlatt(p.words)) return grammatikAntwort(v, p.words, fach);
  const inWoche = (a: Antwort, d: string): Antwort =>
    a.kind === "nav" ? a : { ...a, open: { typ: "seite", art: "woche", params: { tag: d } }, openLabel: "In der Woche öffnen" };
  if (has("uebermorgen")) {
    const d = nthSchool(v, heute, 2);
    return inWoche(tagAns(d), d);
  }
  // "packen" meint morgens vor Schulschluss den heutigen Tag, danach den nächsten Schultag
  if (has("packen")) {
    const sm = schlussMs(v, heute);
    return tagAns(isSchool(v, heute) && sm !== null && u.jetzt < sm ? heute : nextSchool(v, heute));
  }
  if (has("morgen")) return tagAns(nextSchool(v, heute));
  if (has("heute")) return isSchool(v, heute) ? inWoche(tagAns(heute), heute) : tagAns(nextSchool(v, heute));
  if (WH_WORDS.some(has)) return whAnswer(v, fach);
  if (has("noten")) {
    if (fach)
      return {
        kind: "noten",
        l1: `Noten in ${fach.name}`,
        inhalt: notenAnswer(v, fach.id),
        open: { typ: "seite", art: "notenfach", params: { id: fach.id } },
        openLabel: "Noten öffnen",
      };
    return { kind: "nav", l1: "Noten öffnen", ziel: { typ: "seite", art: "noten" } };
  }
  if (has("ueberblick")) return { kind: "nav", l1: "Überblick", ziel: { typ: "ansicht", ansicht: "ueberblick" } };
  if (has("epoche") && v.epoche)
    return {
      kind: "nav",
      l1: `Epoche ${F(v, v.epoche.fachId).name}`,
      l2: v.epoche.seit ? `Hauptunterricht seit ${lang(v.epoche.seit)}` : "Hauptunterricht",
      ziel: { typ: "seite", art: "fach", params: { id: v.epoche.fachId } },
    };
  if (has("klausur") || has("klausuren")) {
    const k =
      klausurenBald(v).find((x) => !fach || x.fachId === fach.id) ??
      // Rückfall: erst die nächste künftige, dann die zuletzt vergangene — der Vorrat
      // enthält auch vergangene Klausuren (includePast) und ist aufsteigend sortiert
      [...v.klausuren].sort((a, b) => (a.datum < b.datum ? -1 : 1)).find((x) => x.datum >= heute && (!fach || x.fachId === fach.id)) ??
      [...v.klausuren].sort((a, b) => (a.datum < b.datum ? 1 : -1)).find((x) => !fach || x.fachId === fach.id);
    if (k)
      return {
        kind: "klausur",
        l1: `Klausur ${F(v, k.fachId).name}`,
        l2: `${lang(k.datum)}, ${relTage(heute, k.datum)}`,
        inhalt: klausurAnswer(v, k),
        open: { typ: "seite", art: "klausur", params: { id: k.id } },
        openLabel: "Klausur öffnen",
      };
  }
  if (has("woche") || has("stundenplan"))
    return { kind: "nav", l1: "Woche öffnen", ziel: { typ: "seite", art: "woche", params: { tag: nextSchool(v, heute) } } };
  if (has("blatt") || has("blaetter") || has("ablage")) return { kind: "nav", l1: "Ablage öffnen", ziel: { typ: "seite", art: "ablage" } };
  if (has("eingangskorb") || has("eingang")) return { kind: "nav", l1: "Eingangskorb öffnen", ziel: { typ: "route", url: "/material/eingang" } };
  if (has("bausteine") || (W.length === 1 && W[0] === "fragen"))
    return { kind: "nav", l1: "Bausteine öffnen", ziel: { typ: "route", url: "/abruf/bausteine" } };
  if (has("faecher")) return { kind: "nav", l1: "Fächer öffnen", ziel: { typ: "seite", art: "faecher" } };
  if (has("einstellungen")) return { kind: "nav", l1: "Einstellungen öffnen", ziel: { typ: "seite", art: "einstellungen" } };
  if (has("foto") || has("kamera")) return { kind: "nav", l1: "Kamera öffnen", ziel: { typ: "kamera", ziel: "zeile" } };
  if (has("lernblock")) {
    const o = lernblockOpt(v);
    if (o) return { kind: "nav", l1: o.l1, l2: o.l2, ziel: o.ziel };
  }
  if (fach && p.words.length === 1)
    return { kind: "nav", l1: fach.name, l2: "Fach öffnen", ziel: { typ: "seite", art: "fach", params: { id: fach.id } } };
  return null;
}

// ── Bereiche und Aktionen (Prototyp AREAS, ACTIONS, Z. 2359–2373) ────────────

export type Bereich = { key: string; label: string; terms: string; ziel: (v: ZeilenVorrat | null) => Ziel };

export const AREAS: readonly Bereich[] = [
  { key: "ueberblick", label: "Überblick", terms: "ueberblick start", ziel: () => ({ typ: "ansicht", ansicht: "ueberblick" }) },
  {
    key: "woche",
    label: "Woche",
    terms: "woche stundenplan stunden",
    ziel: (v) => ({ typ: "seite", art: "woche", params: v ? { tag: nextSchool(v, v.heute) } : ({} as Record<string, string>) }),
  },
  { key: "hausaufgaben", label: "Hausaufgaben", terms: "hausaufgaben aufgaben faellig", ziel: () => ({ typ: "seite", art: "hausaufgaben" }) },
  { key: "klausuren", label: "Klausuren", terms: "klausuren klausur pruefung lernplan", ziel: () => ({ typ: "seite", art: "klausuren" }) },
  { key: "wiederholen", label: "Wiederholen", terms: "wiederholen abfragen karten", ziel: () => ({ typ: "tisch", mode: "wh", fach: null }) },
  { key: "noten", label: "Noten", terms: "noten zensuren", ziel: () => ({ typ: "seite", art: "noten" }) },
  { key: "ablage", label: "Ablage", terms: "ablage blaetter blatt material", ziel: () => ({ typ: "seite", art: "ablage" }) },
  { key: "faecher", label: "Fächer", terms: "faecher fach", ziel: () => ({ typ: "seite", art: "faecher" }) },
  { key: "einstellungen", label: "Einstellungen", terms: "einstellungen", ziel: () => ({ typ: "seite", art: "einstellungen" }) },
];

const ACTIONS: readonly { key: string; label: string; terms: string; ziel: Ziel }[] = [
  { key: "act:ha", label: "Hausaufgabe eintragen", terms: "hausaufgabe aufgabe eintragen hinzufuegen", ziel: { typ: "ha-kontext" } },
  { key: "act:cam", label: "Blatt aufnehmen", terms: "foto scan scannen kamera fotografieren blatt aufnehmen", ziel: { typ: "kamera", ziel: "zeile" } },
];

// ── Treffer ──────────────────────────────────────────────────────────────────

/** Ein Blatt aus der Volltextsuche des Servers (`GET /api/suche`). */
export type BlattTreffer = {
  id: string;
  titel: string;
  fachId: string;
  /** erste Seite für die Miniatur, sonst null */
  seiteId: string | null;
  /** Textausschnitt um den ersten Treffer in der Abschrift */
  ausschnitt: string;
};

export type Option = {
  key: string;
  l1: Txt;
  l2?: Txt | null;
  thumb?: string | null;
  task?: VorratAufgabe;
  done?: boolean;
  start?: boolean;
  cell?: boolean;
  ziel?: Ziel | null;
  /** innere Schritte der Zeile statt eines Ziels */
  intern?:
    | { typ: "antwort"; antwort: Antwort; q: string }
    | { typ: "override"; intent: "suchen" | "eintragen" }
    | { typ: "eintragen" }
    | { typ: "rueck"; due: string }
    | { typ: "undo" }
    | { typ: "details"; url: string }
    /** erledigte Aufgabe, die nicht mehr in der Hausaufgabenliste steht: wieder öffnen wie der Haken */
    | { typ: "wiederOeffnen"; aufgabe: VorratAufgabe };
};

export type Gruppe = {
  key: string;
  label: string | null;
  inhalt?: AntwortInhalt;
  items?: Option[];
};

/** Aus dem Text der Abschrift ein Ausschnitt um den ersten Treffer (Prototyp `snippet`). */
export function snippet(text: string, qs: readonly string[]): string {
  const ws = text.split(/\s+/).filter(Boolean);
  const i = ws.findIndex((w) => qs.some((q) => textWords(w).some((x) => x.startsWith(q))));
  if (i < 0) return "";
  const a = Math.max(0, i - 3);
  const z = Math.min(ws.length, i + 6);
  return (a > 0 ? "… " : "") + ws.slice(a, z).join(" ") + (z < ws.length ? " …" : "");
}

export const vorschauUrl = (seiteId: string | null): string | null =>
  seiteId ? `/api/material/${encodeURIComponent(seiteId)}/vorschau` : null;

/** Was die Suche fürs Menü liefert: oberster Treffer und Gruppen. */
export function suche(
  p: Geparst,
  u: SuchUmgebung & { server: { q: string; list: BlattTreffer[] } },
): { top: Option; groups: Gruppe[]; antwort: Antwort | null } {
  const v = u.v;
  const qs = textWords(p.text).filter((w) => !STOP.has(w));
  const fachWords = new Set(p.fach ? p.fach.alias.map(bare).concat(p.fach.k2 ? [p.fach.k2] : []) : []);
  const contentQs = qs.filter((q) => !fachWords.has(q) && !ZIEL_INHALT.has(q));
  const groups: Gruppe[] = [];
  const ans = answerFor(p, u);
  if (ans && ans.kind !== "nav") groups.push({ key: "g:ans", label: null, inhalt: ans.inhalt });
  if (ans && ans.kind === "nav" && ans.wahl) groups.push({ key: "g:gr", label: ans.wahl.label, items: ans.wahl.items });
  // „Blatt Grammatik …“ meint das Arbeitsblatt: „Blatt aufnehmen“ und die Ablage stehen dann nicht darunter
  const grammatik = istGrammatikBlatt(p.words);
  const acts = grammatik ? [] : ACTIONS.filter((a) => qs.some((q) => wordHit(q, a.terms) || wordHit(q, a.label)));
  if (acts.length) groups.push({ key: "g:act", label: "Aktionen", items: acts.map((a) => ({ key: a.key, l1: hl(a.label, qs), ziel: a.ziel })) });
  const aufg = v.aufgaben
    .filter((a) => {
      const f = F(v, a.fachId);
      const hay = `${f.name} ${f.kurz} ${a.text}`;
      const cq = contentQs.length ? contentQs : p.fach ? [] : qs;
      if (p.fach && a.fachId !== p.fach.id) return false;
      return cq.length ? cq.some((q) => wordHit(q, hay)) : !!p.fach;
    })
    // Erledigtes bis zwei Wochen zurück: die Hausaufgabenliste zeigt es nur
    // zwei Tage, hier lässt es sich danach noch wieder öffnen. Oberster Treffer
    // wird es nie (siehe `hat` unten).
    .filter((a) => {
      const d = u.doneFuer(a);
      return !d || tagVon(d) === v.heute || d >= u.jetzt - ERLEDIGT_SUCHE_TAGE * 864e5;
    });
  if (aufg.length)
    groups.push({
      key: "g:aufg",
      label: "Aufgaben",
      items: aufg.map((a) => {
        const d = u.doneFuer(a);
        // Die Liste zeigt Erledigtes nur ERLEDIGT_LISTE_TAGE lang: ältere erledigte
        // Aufgaben öffnet ein Tipp auf die Zeile wieder, statt in eine Liste ohne sie zu führen.
        const ausListe = !!d && d < u.jetzt - ERLEDIGT_LISTE_TAGE * 864e5;
        return {
          key: "a:" + a.id,
          l1: [{ t: F(v, a.fachId).kurz, k: "b" as const }, { t: " " }, ...hl(a.text, qs)],
          l2: `bis ${lang(a.due)}`,
          task: a,
          done: !!d,
          ...(ausListe
            ? { intern: { typ: "wiederOeffnen" as const, aufgabe: a } }
            : { ziel: { typ: "seite" as const, art: "hausaufgaben" as const, params: { flash: a.id } } }),
        };
      }),
    });
  const kl = v.klausuren.filter((k) => {
    const f = F(v, k.fachId);
    return (
      qs.some((q) => wordHit(q, `${f.name} ${f.kurz} ${k.thema} klausur`)) &&
      (!contentQs.length || contentQs.some((q) => wordHit(q, `${k.thema} klausur klausuren`)) || (p.fach && k.fachId === p.fach.id))
    );
  });
  if (kl.length && !(ans && ans.kind === "klausur"))
    groups.push({
      key: "g:kl",
      label: "Klausuren",
      items: kl.map((k) => ({
        key: "k:" + k.id,
        l1: `Klausur ${F(v, k.fachId).name}`,
        l2: [{ t: `${kurz(k.datum)}, ` }, ...hl(k.thema, qs)],
        ziel: { typ: "seite", art: "klausur", params: { id: k.id } },
      })),
    });
  const srvQs = contentQs.length ? contentQs : qs;
  const srv =
    u.server.q && norm(p.text).startsWith(norm(u.server.q))
      ? u.server.list.filter((b) => !p.fach || b.fachId === p.fach.id)
      : [];
  if (srv.length)
    groups.push({
      key: "g:bl",
      label: "Blätter",
      items: srv.map((b) => ({
        key: "b:" + b.id,
        thumb: vorschauUrl(b.seiteId),
        l1: b.titel || "Blatt von heute",
        l2: hl(snippet(b.ausschnitt, srvQs) || F(v, b.fachId).name, srvQs),
        ziel: { typ: "seite", art: "blatt", params: { id: b.id } },
      })),
    });
  const th = contentQs.length ? v.themenListe.filter((t) => contentQs.every((q) => wordHit(q, t.t))) : [];
  if (th.length)
    groups.push({
      key: "g:th",
      label: "Themen",
      items: th.map((t) => ({
        key: "th:" + t.t,
        l1: hl(t.t, qs),
        l2: `Thema in ${F(v, t.fachId).name}`,
        ziel: t.ziel.art === "klausur" ? { typ: "seite", art: "klausur", params: { id: t.ziel.id } } : { typ: "seite", art: "fach", params: { id: t.ziel.id } },
        start: t.lb && !!v.lernblock,
      })),
    });
  // ein Bereich, den die erste Zeile schon nennt, steht nicht noch einmal darunter
  const ar = AREAS.filter((a) => qs.some((q) => wordHit(q, a.terms) || wordHit(q, a.label)) && !(ans && norm(ans.l1).startsWith(norm(a.label))));
  const fachAr: Option[] =
    p.fach && !(ans && ans.kind === "nav" && ans.l2 === "Fach öffnen")
      ? [{ key: "f:" + p.fach.id, l1: p.fach.name, l2: "Fach öffnen", ziel: { typ: "seite", art: "fach", params: { id: p.fach.id } } }]
      : [];
  if (!grammatik && (ar.length || fachAr.length))
    groups.push({ key: "g:ar", label: "Bereiche", items: fachAr.concat(ar.map((a) => ({ key: "ar:" + a.key, l1: hl(a.label, qs), ziel: a.ziel(v) }))) });

  let top: Option;
  if (ans) {
    top =
      ans.kind === "nav"
        ? { key: "top", l1: ans.l1, l2: ans.l2 ?? null, ziel: ans.ziel }
        : { key: "top", l1: ans.l1, l2: ans.l2 ?? null, intern: { typ: "antwort", antwort: ans, q: p.text || p.raw } };
  } else {
    // erledigte Aufgaben werden nie oberster Treffer; ein Blatt vom Server nur, wenn lokal nichts Offenes passt
    const hat = (x: Gruppe) => !!x.items && x.items.some((it) => !it.done);
    // ein Blatt, das das Suchwort trifft, kommt vor die bloße Fachseite ("?geschichte dampfmaschine", 7.3)
    const g =
      groups.find((x) => hat(x) && !["g:act", "g:bl", "g:ar"].includes(x.key)) ??
      groups.find((x) => hat(x) && x.key === "g:bl") ??
      groups.find(hat);
    if (g && g.items) {
      const i = g.items.findIndex((it) => !it.done);
      const it = g.items[i];
      g.items = g.items.filter((_, k) => k !== i);
      // der oberste Treffer steht ohne Gruppe da: er sagt selbst, was er ist
      const art = ({ "g:bl": "Blatt", "g:aufg": "Aufgabe", "g:kl": "Klausur", "g:th": "Thema" } as Record<string, string>)[g.key];
      const l2 = it.l2;
      const l2t = txtText(l2);
      top = {
        ...it,
        key: "top",
        l2: art && l2 && !l2t.startsWith(art) ? (typeof l2 === "string" ? `${art} · ${l2}` : [{ t: `${art} · ` }, ...l2]) : l2,
      };
    } else {
      top = { key: "top", l1: `Kein Treffer für »${p.text}«`, ziel: null };
    }
  }
  return { top, groups: groups.filter((g) => g.inhalt || (g.items && g.items.length)), antwort: ans };
}

/** App-Tag eines Zeitpunkts (Wechsel 04:00, Berlin). */
export function tagVon(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms - 4 * 3600e3),
  );
}

// ── Vorschläge im leeren Menü (Prototyp `suggestions`, Z. 2592) ──────────────

export type VorschlagUmgebung = {
  v: ZeilenVorrat;
  jetzt: number;
  /** aktuelle Ansicht der Startseite */
  ansicht: string;
  /** Schritt im Ablauf, falls die Ansicht `ablauf` ist */
  schritt?: "blaetter" | "ha" | null;
  /** Rückgängig des Toasts, solange er lebt */
  undo: { desc: string } | null;
  used: ReadonlySet<string>;
};

export function suggestions(u: VorschlagUmgebung): Option[] {
  const v = u.v;
  const out: Option[] = [];
  if (u.undo) out.push({ key: "v:undo", l1: `Rückgängig: ${u.undo.desc}`, intern: { typ: "undo" } });
  // nach "Überspringen" bleibt der Ablauf des Tages erreichbar (V2 5.4), aber nur nach Schulschluss an Schultagen
  const t0 = v.heute;
  const sm = schlussMs(v, t0);
  if (isSchool(v, t0) && sm !== null && u.jetzt >= sm && v.ablauf === "übersprungen" && u.ansicht !== "ablauf")
    out.push({ key: "v:ablauf", l1: "Nach der Schule", l2: "Blätter und Hausaufgaben", ziel: { typ: "ablauf" } });
  const ns = nextSchool(v, t0);
  const morgen: Option = {
    key: "v:morgen",
    l1: "Morgen",
    l2: lang(ns),
    intern: { typ: "antwort", antwort: answerFor({ words: ["morgen"], fach: null }, { v, jetzt: u.jetzt, doneFuer: (a) => a.done })!, q: "Morgen" },
  };
  const woche: Option = {
    key: "v:woche",
    l1: "Woche",
    l2: `${dm(addTage(ns, 1 - wd(ns)))} bis ${dm(addTage(ns, 5 - wd(ns)))}`,
    ziel: { typ: "seite", art: "woche", params: { tag: ns } },
  };
  const an = u.ansicht;
  if (an === "morgens" || an === "frueh") {
    out.push(woche);
    const k = v.klausuren.find((x) => {
      const d = Math.round((Date.parse(x.datum) - Date.parse(t0)) / 864e5);
      return d >= 0 && d <= 6 && wd(x.datum) >= wd(t0);
    });
    if (k)
      out.push({
        key: "v:kl",
        l1: `Klausur ${F(v, k.fachId).name}`,
        l2: `${lang(k.datum)}, ${relTage(t0, k.datum)}`,
        ziel: { typ: "seite", art: "klausur", params: { id: k.id } },
      });
  } else if (an === "ablauf") {
    if (u.schritt === "blaetter") out.push({ key: "v:cam", l1: "Blatt aufnehmen", ziel: { typ: "kamera", ziel: "liste" } }, morgen);
    else out.push(morgen, woche);
  } else {
    if (v.wh.kind === "knopf") out.push({ key: "v:wh", l1: "Wiederholen", l2: v.wh.sub, ziel: { typ: "tisch", mode: "wh", fach: null } });
    const lb = lernblockOpt(v);
    if (lb) out.push({ key: "v:lb", l1: lb.l1, l2: lb.l2, ziel: lb.ziel });
  }
  return out.filter((o) => !u.used.has(o.key)).slice(0, out[0] && out[0].key === "v:undo" ? 3 : 2);
}

/** Die drei Antworttage der Rückfrage „Bis wann ist ⟨Fach⟩ fällig?“ (Prototyp Z. 2645). */
export function rueckfrageTage(v: ZeilenVorrat, fachId: string | null, naechste: string | null): [string, string][] {
  const t = v.heute;
  const nl = fachId ? naechste : null;
  const d1 = nextSchool(v, t);
  const d2 = nthSchool(v, t, 2);
  const d3 = nl || nthSchool(v, t, 3);
  return [
    [d1 === addTage(t, 1) ? "Morgen" : TAG[wd(d1)], d1],
    [TAG[wd(d2)], d2],
    [nl ? "Nächste Stunde" : TAG[wd(d3)], d3],
  ];
}

/** Dublette: dieselbe offene Aufgabe im selben Fach zum selben Tag (Prototyp Z. 2656). */
export function dublette(v: ZeilenVorrat, fachId: string, due: string, text: string): VorratAufgabe | null {
  return v.aufgaben.find((a) => !a.done && a.fachId === fachId && a.due === due && bare(a.text) === bare(text)) ?? null;
}
