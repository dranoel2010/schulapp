import { fachEintraege } from "@/lib/kombi/fach-alias";
import type { VorratStunde, ZeilenVorrat } from "@/lib/kombi/vorrat";

/**
 * Nur für Tests: der Vorrat, wie ihn der Prototyp am Montag, 12.10.2026,
 * 16:40 kennt (Z. 1092–1300) — Fächer, Stundenplan, Herbstferien,
 * Aufgaben, die Mathe-Klausur mit Lernplan, Noten und drei fällige Themen.
 * So lassen sich Parser und Antworten Wort für Wort mit dem Prototyp
 * vergleichen.
 */

const ID = { ge: "ge", ma: "ma", bi: "bi", de: "de", fr: "fr", en: "en" } as const;

const PERIODS: Record<number, [string, string]> = { 1: ["08:00", "09:30"], 2: ["09:50", "11:20"], 3: ["11:40", "13:10"], 4: ["13:30", "14:15"] };
const PLAN: Record<number, [number, string, string][]> = {
  1: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "bi", "Bio 1"]],
  2: [[1, "ge", "R. 104"], [2, "de", "R. 104"], [3, "ma", "R. 208"], [4, "en", "R. 112"]],
  3: [[1, "ge", "R. 104"], [2, "fr", "R. 110"], [3, "en", "R. 112"]],
  4: [[1, "ge", "R. 104"], [2, "bi", "Bio 1"], [3, "ma", "R. 208"]],
  5: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "fr", "R. 110"]],
};

export function prototypVorrat(jetzt = Date.UTC(2026, 9, 12, 14, 40)): ZeilenVorrat {
  const stunden: Record<string, VorratStunde[]> = {};
  for (const [w, ls] of Object.entries(PLAN))
    stunden[w] = ls.map(([nr, fachId, raum]) => ({ nr, von: PERIODS[nr][0], bis: PERIODS[nr][1], fachId, raum, hu: nr === 1 }));
  return {
    heute: "2026-10-12",
    jetzt,
    ansicht: "ueberblick",
    ablauf: "erledigt",
    schritt: "blaetter",
    faecher: fachEintraege([
      { id: ID.ge, name: "Geschichte", short: "Ge" },
      { id: ID.ma, name: "Mathematik", short: "M" },
      { id: ID.bi, name: "Biologie", short: "Bi" },
      { id: ID.de, name: "Deutsch", short: "D" },
      { id: ID.fr, name: "Französisch", short: "F" },
      { id: ID.en, name: "Englisch", short: "E" },
    ]),
    stunden,
    frei: [{ von: "2026-10-26", bis: "2026-10-30", ferien: true }],
    aufgaben: [
      { id: "a1", fachId: "ma", text: "S. 84, Nr. 3–5", due: "2026-10-13", done: null, details: false },
      { id: "a2", fachId: "de", text: "Gedichtanalyse beenden", due: "2026-10-13", done: null, details: false },
      { id: "a3", fachId: "en", text: "Vokabeln Unit 3", due: "2026-10-12", done: Date.UTC(2026, 9, 11, 17, 12), details: false },
      { id: "a4", fachId: "ge", text: "Fragen zur Dampfmaschine", due: "2026-10-12", done: Date.UTC(2026, 9, 12, 5, 12), details: false },
    ],
    klausuren: [
      {
        id: "k1",
        fachId: "ma",
        datum: "2026-10-16",
        thema: "Quadratische Funktionen",
        plan: [
          { tag: "2026-10-12", art: "Lernblock", thema: "Scheitelpunktform", min: 25, erledigt: false, alsBlatt: true },
          { tag: "2026-10-14", art: "Wiederholung", thema: "Alles bis Scheitelpunktform", min: 25, erledigt: false, alsBlatt: false },
        ],
      },
    ],
    noten: {
      ma: [
        { label: "2", titel: "Klausur", datum: "2026-09-17" },
        { label: "3+", titel: "Test", datum: "2026-09-29" },
        { label: "2−", titel: "Mitarbeit", datum: "2026-10-07" },
      ],
      ge: [{ label: "2+", titel: "Referat", datum: "2026-10-02" }],
    },
    themen: [
      { key: "ge-en", fachId: "ge", name: "Industrialisierung in England", umfang: "10 Fragen" },
      { key: "ma-qf", fachId: "ma", name: "Quadratische Funktionen", umfang: "12 Fragen" },
      { key: "fr-pc", fachId: "fr", name: "Passé composé mit être", umfang: "8 Fragen" },
    ],
    themenAlle: [
      { key: "ge-en", fachId: "ge", name: "Industrialisierung in England", umfang: "10 Fragen" },
      { key: "ma-qf", fachId: "ma", name: "Quadratische Funktionen", umfang: "12 Fragen" },
      { key: "fr-pc", fachId: "fr", name: "Passé composé mit être", umfang: "8 Fragen" },
    ],
    wh: { kind: "knopf", n: 3, sub: "Zuerst Geschichte · Industrialisierung in England" },
    lernblock: { key: "b1", examId: "k1", label: "Scheitelpunktform", minuten: 25, zustand: "ruhe", restMs: 25 * 60000 },
    epoche: { fachId: "ge", seit: "2026-09-28" },
    themenListe: [
      { t: "Quadratische Funktionen", fachId: "ma", ziel: { art: "klausur", id: "k1" }, lb: false },
      { t: "Scheitelpunktform", fachId: "ma", ziel: { art: "klausur", id: "k1" }, lb: true },
      { t: "Industrialisierung in England", fachId: "ge", ziel: { art: "fach", id: "ge" }, lb: false },
      { t: "Industrialisierung in Deutschland", fachId: "ge", ziel: { art: "fach", id: "ge" }, lb: false },
      { t: "Passé composé mit être", fachId: "fr", ziel: { art: "fach", id: "fr" }, lb: false },
    ],
    // Grammatikthemen (Antwort 5): Französisch aus dem Prototyp (heute fällig), Englisch und Deutsch nur für die Tests
    grammatik: [
      { id: "fr-pc", fachId: "fr", name: "Passé composé mit être", sprache: "fr", faellig: "2026-10-12", zuletzt: "2026-10-12" },
      { id: "en-sp", fachId: "en", name: "Simple past", sprache: "en", faellig: "2026-10-14", zuletzt: "2026-10-08" },
      { id: "en-pp", fachId: "en", name: "Present perfect", sprache: "en", faellig: null, zuletzt: "2026-10-01" },
      { id: "de-ks", fachId: "de", name: "Kommasetzung", sprache: "de", faellig: null, zuletzt: "2026-10-05" },
    ],
  };
}
