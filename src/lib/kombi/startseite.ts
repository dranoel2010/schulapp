import { cap, diffDays, kurz, lang, TAG, wd, weekdayOrDate, zahl } from "@/lib/kombi/text";

/**
 * Die Startseite als reine Rechnung (Modell 23, Abschnitt B): was `ladeTag()`
 * liefert (`TagDaten`) und was die Oberfläche daraus macht — Überschrift,
 * Abgaben, Aufgaben für den nächsten Schultag. Ohne Datenbank und ohne DOM,
 * damit Server, Browser und Tests dasselbe rechnen.
 *
 * Vorlage: Prototyp Z. 1633–1646 (`headlineFor`), 1782 (`offeneFuer`),
 * 1903–1906 (`moAbgaben`), 1948–1969 (`renderOvHA`), 1970–2014
 * (`ovKlausur`, `updateBlockUI`).
 */

export type Ansicht = "morgens" | "ablauf" | "ueberblick" | "frueh";
export type AblaufSchritt = "blaetter" | "ha";

export type AufgabeT = {
  id: string;
  fachId: string;
  /** Anzeigename in Zeilen und Toasts („Mathe“) */
  fach: string;
  fachName: string;
  text: string;
  due: string;
  done: boolean;
  /** ISO-Zeitpunkt des Abhakens */
  doneAt: string | null;
  /** hat die Aufgabe eine längere Beschreibung? Dann bearbeitet das Formular */
  details: boolean;
};

export type StundeT = {
  nr: number;
  /** Beginn „08:00“ */
  von: string;
  fach: string;
  raum: string | null;
  /** Unterzeile beim Hauptunterricht: „Hauptunterricht · Industrialisierung“ */
  hu: string | null;
};

export type MorgenT = {
  tag: string;
  stunden: StundeT[];
  /** „Mathematik · 2. Stunde · Quadratische Funktionen“, nur wenn an dem Tag geschrieben wird */
  klausur: string | null;
};

export type KlausurT = { id: string; fach: string; fachName: string; datum: string };

export type LernblockZustand = "ruhe" | "laeuft" | "pausiert" | "erledigt";

export type LernblockT = {
  id: string;
  examId: string;
  /** „Scheitelpunktform“, „Wiederholung“, „Gesamtwiederholung“ */
  label: string;
  minuten: number;
  zustand: LernblockZustand;
  laeuftSeit: string | null;
  pausiertSeit: string | null;
  pauseMs: number;
  minutenGelernt: number | null;
};

export type BlattT = {
  id: string;
  titel: string;
  fachName: string;
  /** id der ersten Seite für `/api/material/<id>/vorschau` */
  cover: string | null;
  /** noch nicht eingeordnet: „Wird eingeordnet“ statt des Fachs */
  einordnen: boolean;
};

export type TagDaten = {
  /** App-Tag 'YYYY-MM-DD', Wechsel um 04:00 Europe/Berlin */
  tag: string;
  /** Zeitpunkt der Berechnung (Uhr des Servers, mit Testuhr), ISO */
  stand: string;
  ansicht: Ansicht;
  schritt: AblaufSchritt;
  ablaufStand: "erledigt" | "übersprungen" | null;
  schultag: boolean;
  /** Ist Schulschluss des App-Tags vorbei? */
  nachSchluss: boolean;
  naechsterSchultag: string;
  /** Freier Zeitraum, in den der App-Tag fällt — dann ganz frei */
  ferien: { bis: string; titel: string } | null;
  /** Offene Aufgaben und die erledigten bis zum nächsten Schultag */
  aufgaben: AufgabeT[];
  /** Morgenansicht des App-Tags */
  morgens: MorgenT;
  /** Morgenansicht des nächsten Schultags („Morgen früh“) */
  frueh: MorgenT;
  /** Klausuren in den nächsten 14 Tagen, die nächste zuerst */
  klausurenBald: KlausurT[];
  /** Heutiger Lernblock der nächsten Klausur */
  lernblock: LernblockT | null;
  /** Ohne Lernblock heute: der nächste dieser Klausur */
  naechsterLernblock: { tag: string; label: string } | null;
  /** Offene Blöcke aus der Vergangenheit (Plan 3.5) */
  verpasst: { anzahl: number; tag: string; examId: string } | null;
  /** Die drei zuletzt aufgenommenen Blätter */
  blaetter: BlattT[];
  /** Blätter im Eingangskorb */
  eingangskorb: number;
};

/** Ist der Tag ein Schultag? Aus den Daten: der App-Tag selbst oder der nächste. */
const istSchultag = (d: TagDaten, tag: string) =>
  tag === d.tag ? d.schultag : tag === d.naechsterSchultag;

/** „Dienstag“, wenn der Tag morgen ist, sonst „Montag, 19.10.“ (Prototyp `tagName`). */
export function tagName(tag: string, heute: string): string {
  return diffDays(heute, tag) === 1 ? TAG[wd(tag)] : lang(tag);
}

/**
 * Für den nächsten Schultag: was bis dahin fällig und offen ist, ohne die
 * Abgaben von heute an Schultagen (die stehen morgens). Prototyp Z. 1782.
 * `halten`: abgehakte Zeilen, die noch 350 ms stehen bleiben (7.2 Nr. 27).
 */
export function offeneFuer(
  d: TagDaten,
  aufgaben: readonly AufgabeT[],
  halten: ReadonlySet<string> = new Set(),
): AufgabeT[] {
  const ns = d.naechsterSchultag;
  const heute = d.tag;
  return aufgaben
    .filter(
      (a) =>
        (!a.done || halten.has(a.id)) &&
        a.due <= ns &&
        !(a.due === heute && istSchultag(d, heute)),
    )
    // stabil: bei gleichem Tag bleibt die Reihenfolge des Servers (Eintragszeit)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/** Abgaben eines Tages: offene zuerst, erledigte darunter in der Reihenfolge des Abhakens. */
export function moAbgaben(aufgaben: readonly AufgabeT[], tag: string): AufgabeT[] {
  const alle = aufgaben.filter((a) => a.due === tag);
  return alle
    .filter((a) => !a.done)
    .concat(
      alle
        .filter((a) => a.done)
        .sort((a, b) => (a.doneAt ?? "").localeCompare(b.doneAt ?? "")),
    );
}

/** Überschrift einer Ansicht (Prototyp `headlineFor`, Z. 1633). */
export function headlineFor(v: Ansicht, d: TagDaten, aufgaben: readonly AufgabeT[]): string {
  const t = d.tag;
  if (v === "morgens" || v === "frueh") {
    const tag = v === "frueh" ? d.naechsterSchultag : t;
    const n = aufgaben.filter((a) => a.due === tag).length;
    // Als Vorschau am Abend gehört die Überschrift zum Tag der Datumszeile
    const w = v === "frueh" ? (diffDays(t, tag) === 1 ? "Morgen" : TAG[wd(tag)]) : "Heute";
    return n === 0 ? `${w} nichts abzugeben` : n === 1 ? `${w} eine Abgabe` : `${w} ${zahl(n)} Abgaben`;
  }
  // Fest „Ferien bis …“ wie Prototyp Z. 1643 und V2 3.1/Kriterium 8 — auch bei
  // freien Tagen mit eigenem Titel („Herbstferien“) oder Art „frei“.
  if (d.ferien) return `Ferien bis ${lang(d.ferien.bis)}`;
  const ns = d.naechsterSchultag;
  const n = offeneFuer(d, aufgaben).length;
  const tn = tagName(ns, t);
  return n === 0
    ? `Für ${tn} ist alles erledigt`
    : n === 1
      ? `Noch eine Aufgabe für ${tn}`
      : `${cap(zahl(n))} Aufgaben für ${tn}`;
}

/** Datum der Datumszeile: in `frueh` der nächste Schultag (Prototyp `renderWhen`). */
export const datumFuer = (v: Ansicht, d: TagDaten): string =>
  v === "frueh" ? d.naechsterSchultag : d.tag;

/**
 * Die Aufgaben des Überblicks (Prototyp `renderOvHA`, Z. 1948): höchstens drei
 * für den nächsten Schultag, „Und zwei weitere“, und die späteren als
 * „Drei weitere bis Freitag“.
 */
export function ueberblickAufgaben(
  d: TagDaten,
  aufgaben: readonly AufgabeT[],
  halten: ReadonlySet<string> = new Set(),
): { gezeigt: AufgabeT[]; zeilen: { key: string; text: string }[] } {
  const offen = offeneFuer(d, aufgaben, halten);
  const gezeigt = offen.slice(0, 3);
  const rest = offen.length - gezeigt.length;
  const spaeter = aufgaben.filter((a) => !a.done && a.due > d.naechsterSchultag);
  const zeilen: { key: string; text: string }[] = [];
  if (rest > 0) zeilen.push({ key: "r", text: `Und ${zahl(rest)} weitere` });
  if (spaeter.length) {
    const letzte = spaeter.map((a) => a.due).sort().pop()!;
    zeilen.push({ key: "l", text: `${cap(zahl(spaeter.length))} weitere bis ${weekdayOrDate(letzte, d.tag)}` });
  }
  return { gezeigt, zeilen };
}

/** „Und eine weitere am Do 22.10.“ unter der Klausurzeile. */
export function weitereKlausuren(d: TagDaten): string | null {
  const mehr = d.klausurenBald.slice(1);
  if (!mehr.length) return null;
  return `Und ${mehr.length === 1 ? "eine weitere" : `${zahl(mehr.length)} weitere`} am ${kurz(mehr[0].datum)}`;
}

/** „heute“, „morgen“, „in 4 Tagen“ (Prototyp `relTage`). */
export function relTage(tag: string, heute: string): string {
  const n = diffDays(heute, tag);
  return n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`;
}

/** „25 Minuten“ — Dauer des Lernblocks (Prototyp `lbDauer`; das Arbeitsblatt kommt in H). */
export const lbDauer = (minuten: number): string => `${minuten} Minuten`;

/** Restzeit eines Lernblocks in ms (wie `blockRest` in src/lib/lernblock.ts, Zeitstempel als ISO). */
export function lernblockRest(b: LernblockT, now: number): number {
  const gesamt = b.minuten * 60_000;
  if (b.zustand === "erledigt") {
    return b.minutenGelernt === null ? 0 : Math.max(0, gesamt - b.minutenGelernt * 60_000);
  }
  if (!b.laeuftSeit) return gesamt;
  const start = Date.parse(b.laeuftSeit);
  const pause = b.pausiertSeit ? Math.max(0, now - Date.parse(b.pausiertSeit)) : 0;
  return Math.max(0, gesamt - Math.max(0, now - start - b.pauseMs - pause));
}

/** „24:12“ (Prototyp `fmtRest`). */
export function fmtRest(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** „Ein Lernblock von Freitag ist offen“ (Plan 3.5). */
export function verpasstText(v: { anzahl: number; tag: string }, heute: string): string {
  return v.anzahl === 1
    ? `Ein Lernblock von ${weekdayOrDate(v.tag, heute)} ist offen`
    : `${cap(zahl(v.anzahl))} Lernblöcke sind offen`;
}

/** „3 Blätter im Eingangskorb“ / „Ein Blatt im Eingangskorb“ (Plan 3.2). */
export function eingangskorbText(n: number): string {
  return n === 1 ? "Ein Blatt im Eingangskorb" : `${n} Blätter im Eingangskorb`;
}
