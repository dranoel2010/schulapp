import { bare, type FachEintrag } from "@/lib/kombi/fach-alias";
import { SPRACH_NAME, fachSprache, spracheAusWort, type BlattSprache } from "@/lib/arbeitsblatt/sprache";
import type { VorratGrammatik, ZeilenVorrat } from "@/lib/kombi/vorrat";

import type { Antwort, Option, Ziel } from "./suche";

/**
 * „Blatt Grammatik Englisch“ in der Zeile (Antwort 5 vom 13.10.2026): das
 * Arbeitsblatt zum fälligsten Grammatikthema der Sprache. Ohne Sprache das
 * fälligste überhaupt; ist das nicht eindeutig (mehrere Sprachen, keins
 * heute fällig), fragt die Zeile kurz nach der Sprache und bietet je Sprache
 * das fälligste Thema an. Rein, ohne DOM.
 */

/** Wörter für Grammatik in der Zeile, nach `bare()`. */
export const GRAMMATIK_WORTE = ["grammatik", "grammar", "grammaire"];

/** So viele weitere Themen stehen höchstens unter dem obersten Treffer. */
export const GRAMMATIK_WAHL = 3;

/** Will der Satz ein Grammatikblatt? „Blatt“ und ein Wort für Grammatik, in beliebiger Folge. */
export function istGrammatikBlatt(woerter: readonly string[]): boolean {
  const W = woerter.map(bare);
  return W.includes("blatt") && GRAMMATIK_WORTE.some((g) => W.includes(g));
}

/** Die Sprache des Satzes: über das erkannte Fach, sonst über ein Sprachwort. */
export function spracheDesSatzes(woerter: readonly string[], fach: FachEintrag | null): BlattSprache | null {
  if (fach) return fachSprache(fach.name);
  for (const w of woerter) {
    const s = spracheAusWort(w);
    if (s) return s;
  }
  return null;
}

const zielVon = (t: VorratGrammatik): Ziel => ({ typ: "tisch", mode: "wh", fach: null, thema: t.id });

function fachName(v: ZeilenVorrat, t: VorratGrammatik): string {
  return v.faecher.find((f) => f.id === t.fachId)?.name ?? SPRACH_NAME[t.sprache];
}

const heuteFaellig = (v: ZeilenVorrat, t: VorratGrammatik) => t.faellig !== null && t.faellig <= v.heute;

function unterzeile(v: ZeilenVorrat, t: VorratGrammatik): string {
  return `Arbeitsblatt in ${fachName(v, t)}${heuteFaellig(v, t) ? ", heute fällig" : ""}`;
}

function wahlVon(v: ZeilenVorrat, liste: readonly VorratGrammatik[]): { label: string; items: Option[] } | undefined {
  if (!liste.length) return undefined;
  return {
    label: "Grammatik",
    items: liste.slice(0, GRAMMATIK_WAHL).map((t) => ({ key: "gr:" + t.id, l1: t.name, l2: unterzeile(v, t), ziel: zielVon(t) })),
  };
}

/** Die Antwort auf „Blatt Grammatik …“ samt kurzer Auswahl darunter. */
export function grammatikAntwort(v: ZeilenVorrat, woerter: readonly string[], fach: FachEintrag | null): Antwort {
  const sprache = spracheDesSatzes(woerter, fach);
  const alle = v.grammatik ?? [];

  if (fach || sprache) {
    const liste = fach ? alle.filter((t) => t.fachId === fach.id) : alle.filter((t) => t.sprache === sprache);
    const wo = fach ? fach.name : SPRACH_NAME[sprache!];
    if (!liste.length) return { kind: "nav", l1: `Noch kein Grammatikthema in ${wo}.`, ziel: null };
    const [erstes, ...rest] = liste;
    return { kind: "nav", l1: `Blatt Grammatik · ${erstes.name}`, l2: unterzeile(v, erstes), ziel: zielVon(erstes), wahl: wahlVon(v, rest) };
  }

  if (!alle.length) return { kind: "nav", l1: "Noch kein Grammatikthema mit Blatt.", ziel: null };
  const [erstes, ...rest] = alle;
  const sprachen = [...new Set(alle.map((t) => t.sprache))];
  if (sprachen.length > 1 && !heuteFaellig(v, erstes)) {
    // Mehrdeutig: je Sprache das fälligste Thema, in der Folge der Liste
    const jeSprache = sprachen.map((s) => alle.find((t) => t.sprache === s)!);
    return { kind: "nav", l1: "Blatt Grammatik", l2: "In welcher Sprache?", ziel: null, wahl: wahlVon(v, jeSprache) };
  }
  return { kind: "nav", l1: `Blatt Grammatik · ${erstes.name}`, l2: unterzeile(v, erstes), ziel: zielVon(erstes), wahl: wahlVon(v, rest) };
}
