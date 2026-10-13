import type { FachEintrag } from "@/lib/kombi/fach-alias";
import { diffDays, wd } from "@/lib/kombi/text";

/**
 * Der Vorrat der Zeile (Plan 3.2, `zeilenVorrat`): alles, was Parser, Suche
 * und die Antworten beim Tippen brauchen, als reines, serialisierbares Objekt.
 * Der Server lädt ihn (`src/lib/kombi/zeilen-vorrat.ts`), die Zeile holt ihn
 * beim ersten Öffnen des Menüs über `GET /api/zeile/vorrat` und hält ihn
 * danach im Speicher der Shell; nach jeder Action kommt er neu.
 *
 * Hier stehen nur der Typ und die reinen Kalenderhelfer des Prototyps
 * (`isSchool`, `lessonsOn`, `nextSchool`, `nthSchool`, `nextLesson`,
 * Z. 1104–1128) — ohne DOM, ohne Datenbank, damit Server, Client und Tests
 * dieselbe Rechnung benutzen.
 */

export type VorratStunde = {
  /** Nummer der (ersten) Stunde im Raster */
  nr: number;
  von: string;
  bis: string;
  fachId: string;
  raum: string | null;
  /** Hauptunterricht (erste Stunde, Epochenfach) */
  hu: boolean;
};

export type VorratFrei = { von: string; bis: string; ferien: boolean };

export type VorratAufgabe = {
  id: string;
  fachId: string;
  text: string;
  due: string;
  /** Zeitpunkt des Abhakens in ms, null = offen */
  done: number | null;
  details: boolean;
};

export type VorratPlanEintrag = {
  tag: string;
  art: "Lernblock" | "Wiederholung" | "Probeklausur";
  thema: string;
  min: number;
  erledigt: boolean;
};

export type VorratKlausur = {
  id: string;
  fachId: string;
  datum: string;
  thema: string;
  /** Planzeilen ab heute — nur für Klausuren in ≤ 14 Tagen */
  plan: VorratPlanEintrag[];
};

export type VorratNote = { label: string; titel: string; datum: string };

export type VorratThema = {
  key: string;
  fachId: string;
  name: string;
  /** „n Fragen“ oder „Arbeitsblatt“ */
  umfang: string;
};

export type VorratLernblock = {
  key: string;
  examId: string;
  label: string;
  minuten: number;
  zustand: "ruhe" | "laeuft" | "pausiert";
  restMs: number;
};

export type VorratThemaTreffer = {
  t: string;
  fachId: string;
  /** wohin ein Tipp führt */
  ziel: { art: "klausur"; id: string } | { art: "fach"; id: string };
  /** Lernblock von heute: „Starten“ */
  lb: boolean;
};

/**
 * Ein Grammatikthema für „Blatt Grammatik …“ in der Zeile (Antwort 5 vom
 * 13.10.2026): ein Übungsthema in Deutsch, Englisch oder Französisch mit
 * mindestens einem abgeschriebenen Blatt. Der Vorrat liefert sie schon in
 * der Reihenfolge „fälligstes zuerst“ (`grammatikFolge`).
 */
export type VorratGrammatik = {
  /** id des Fach-Themas */
  id: string;
  fachId: string;
  name: string;
  sprache: "en" | "fr" | "de";
  /** ältester offener Termin einer Frage des Themas, sonst null */
  faellig: string | null;
  /** Kalendertag, an dem das Thema zuletzt vorkam */
  zuletzt: string;
};

/** Fälligstes zuerst: ältester offener Termin, ohne Termin zuletzt; dann das jüngste Thema, dann alphabetisch. */
export function grammatikFolge(a: VorratGrammatik, b: VorratGrammatik): number {
  const fa = a.faellig ?? "9999-12-31";
  const fb = b.faellig ?? "9999-12-31";
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.zuletzt !== b.zuletzt) return a.zuletzt > b.zuletzt ? -1 : 1;
  return a.name.localeCompare(b.name, "de");
}

/** Wiederholen auf dem Überblick (Prototyp `whState`, Z. 2016). */
export type VorratWh =
  | { kind: "ferien" }
  | { kind: "leer" }
  | { kind: "knopf"; n: number; sub: string }
  | { kind: "text"; text: string };

export type ZeilenVorrat = {
  /** App-Tag 'YYYY-MM-DD' (Wechsel 04:00) */
  heute: string;
  /** Serverzeit beim Laden, ms — die Zeile rechnet mit dem Versatz weiter */
  jetzt: number;
  ansicht: "morgens" | "ablauf" | "ueberblick" | "frueh";
  ablauf: "erledigt" | "übersprungen" | null;
  /** Schritt im Ablauf nach der Schule */
  schritt: "blaetter" | "ha";
  faecher: FachEintrag[];
  /** Stunden je Wochentag 1 (Mo) … 5 (Fr) */
  stunden: Record<string, VorratStunde[]>;
  frei: VorratFrei[];
  aufgaben: VorratAufgabe[];
  klausuren: VorratKlausur[];
  noten: Record<string, VorratNote[]>;
  themen: VorratThema[];
  wh: VorratWh;
  lernblock: VorratLernblock | null;
  epoche: { fachId: string; seit: string | null } | null;
  themenListe: VorratThemaTreffer[];
  /** Grammatikthemen für „Blatt Grammatik …“, fälligstes zuerst */
  grammatik: VorratGrammatik[];
};

/**
 * So viele Tage findet die Zeile eine erledigte Hausaufgabe noch (und lässt sie
 * wieder öffnen). Die Hausaufgabenliste zeigt Erledigtes nur zwei Tage; vor
 * Modell 23 stand es 14 Tage in der Liste.
 */
export const ERLEDIGT_SUCHE_TAGE = 14;

/** So viele Tage steht eine erledigte Hausaufgabe noch auf der Seite „Hausaufgaben“ unter „Erledigt“. */
export const ERLEDIGT_LISTE_TAGE = 2;

// ── Kalender (Prototyp Z. 1104–1128) ─────────────────────────────────────────

export function addTage(tag: string, n: number): string {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const inFerien = (v: Pick<ZeilenVorrat, "frei">, tag: string): VorratFrei | null =>
  v.frei.find((f) => tag >= f.von && tag <= f.bis) ?? null;

export function isSchool(v: Pick<ZeilenVorrat, "frei" | "stunden">, tag: string): boolean {
  const w = wd(tag);
  return w >= 1 && w <= 5 && !inFerien(v, tag) && (v.stunden[String(w)] ?? []).length > 0;
}

export function lessonsOn(v: Pick<ZeilenVorrat, "frei" | "stunden">, tag: string): VorratStunde[] {
  return isSchool(v, tag) ? (v.stunden[String(wd(tag))] ?? []) : [];
}

export function nextSchool(v: Pick<ZeilenVorrat, "frei" | "stunden">, tag: string): string {
  let d = tag;
  for (let i = 0; i < 60; i++) {
    d = addTage(d, 1);
    if (isSchool(v, d)) return d;
  }
  return addTage(tag, 1);
}

export function nthSchool(v: Pick<ZeilenVorrat, "frei" | "stunden">, tag: string, n: number): string {
  let d = tag;
  for (let i = 0; i < n; i++) d = nextSchool(v, d);
  return d;
}

/** Der nächste Tag nach `tag` mit einer Stunde dieses Fachs, freie Tage übersprungen. */
export function nextLesson(v: Pick<ZeilenVorrat, "frei" | "stunden">, fachId: string, tag: string): string | null {
  let d = tag;
  for (let i = 0; i < 60; i++) {
    d = addTage(d, 1);
    if (lessonsOn(v, d).some((l) => l.fachId === fachId)) return d;
  }
  return null;
}

/** Schulschluss eines Tages als „HH:MM“, sonst null. */
export function schluss(v: Pick<ZeilenVorrat, "frei" | "stunden">, tag: string): string | null {
  const ls = lessonsOn(v, tag);
  return ls.length ? ls[ls.length - 1].bis : null;
}

/** „heute“, „morgen“, „in n Tagen“ (Prototyp `relTage`, Z. 1376); vergangene Tage „gestern“, „vor n Tagen“. */
export function relTage(heute: string, tag: string): string {
  const n = diffDays(heute, tag);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n > 1) return `in ${n} Tagen`;
  if (n === -1) return "gestern";
  return `vor ${-n} Tagen`;
}

/** Klausuren in ≤ 14 Tagen, die nächste zuerst (Prototyp `klausurenBald`). */
export function klausurenBald(v: Pick<ZeilenVorrat, "klausuren" | "heute">): VorratKlausur[] {
  return v.klausuren
    .filter((k) => k.datum > v.heute && diffDays(v.heute, k.datum) <= 14)
    .sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

/** Restzeit „mm:ss“ (Prototyp `fmtRest`). */
export function fmtRest(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
