import { readFile } from "node:fs/promises";
import path from "node:path";

import { freePeriodOn, listAllFreePeriods } from "@/lib/free-days";
import { appTagVon } from "@/lib/kombi/app-tag";
import { berlinZeitpunkt } from "@/lib/kombi/blaetter";
import { ensurePeriods, listLessons, weekdayOf } from "@/lib/timetable";

/**
 * Der Ablauf vor der Schule: Briefing → Packliste → los.
 *
 * Briefing und Packliste schreibt nicht die App, sondern der nächtliche
 * Wiki-Lauf auf dem NAS (~/wiki-nacht.sh, 02:31) als `<tag>.json` in den
 * Wiki-Ordner topics/schule/output/morgen. Der Ordner ist im Container nur
 * lesbar unter MORGEN_DIR (Standard /morgen) eingebunden. Fehlt die Datei,
 * gibt es keinen Ablauf — die App bleibt wie sie ist.
 *
 * Was in der Datei steht, ist Text zum Anzeigen, nichts weiter.
 */

export type MorgenAbschnitt = { titel: string; punkte: string[] };
export type MorgenPacken = { text: string; grund?: string };

export type MorgenDaten = {
  tag: string;
  /** Schultag, vor Beginn der ersten Stunde und eine Datei für heute ist da */
  zeigen: boolean;
  /** 'HH:MM' der ersten Stunde oder null */
  schulbeginn: string | null;
  briefing: MorgenAbschnitt[];
  packliste: MorgenPacken[];
};

const TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, max = 400): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Liest `<tag>.json` und nimmt nur, was die erwartete Form hat. */
export async function morgenDatei(tag: string): Promise<{ briefing: MorgenAbschnitt[]; packliste: MorgenPacken[] } | null> {
  if (!TAG_RE.test(tag)) return null;
  const dir = process.env.MORGEN_DIR || "/morgen";
  let roh: unknown;
  try {
    roh = JSON.parse(await readFile(path.join(dir, `${tag}.json`), "utf8"));
  } catch {
    return null;
  }
  if (!roh || typeof roh !== "object") return null;
  const r = roh as { briefing?: unknown; packliste?: unknown };

  const briefing: MorgenAbschnitt[] = [];
  if (Array.isArray(r.briefing)) {
    for (const a of r.briefing.slice(0, 12)) {
      const titel = text((a as { titel?: unknown })?.titel, 120);
      const punkteRoh = (a as { punkte?: unknown })?.punkte;
      const punkte = Array.isArray(punkteRoh) ? punkteRoh.map((p) => text(p)).filter((p): p is string => !!p).slice(0, 20) : [];
      if (titel && punkte.length) briefing.push({ titel, punkte });
    }
  }

  const packliste: MorgenPacken[] = [];
  const gesehen = new Set<string>();
  if (Array.isArray(r.packliste)) {
    for (const p of r.packliste.slice(0, 60)) {
      const t = text((p as { text?: unknown })?.text, 120);
      if (!t || gesehen.has(t.toLowerCase())) continue;
      gesehen.add(t.toLowerCase());
      const grund = text((p as { grund?: unknown })?.grund, 120);
      packliste.push(grund ? { text: t, grund } : { text: t });
    }
  }

  if (!briefing.length && !packliste.length) return null;
  return { briefing, packliste };
}

export async function ladeMorgen(userId: string, now: Date): Promise<MorgenDaten> {
  const tag = appTagVon(now);
  const [lessons, perioden, frei, datei] = await Promise.all([
    listLessons(userId),
    ensurePeriods(userId),
    listAllFreePeriods(userId),
    morgenDatei(tag),
  ]);

  const wd = weekdayOf(tag);
  const heute = wd >= 1 && wd <= 5 && !freePeriodOn(frei, tag) ? lessons.filter((l) => l.weekday === wd) : [];
  const erste = heute.length ? Math.min(...heute.map((l) => l.period)) : null;
  const beginn = erste !== null ? (perioden.find((p) => p.number === erste)?.startsAt ?? null) : null;
  const schulbeginn = beginn ? beginn.slice(0, 5) : null;

  let vorBeginn = false;
  if (schulbeginn) {
    const [h, m] = schulbeginn.split(":").map(Number);
    vorBeginn = now.getTime() < berlinZeitpunkt(tag, h || 0, m || 0).getTime();
  }

  return {
    tag,
    zeigen: !!datei && vorBeginn,
    schulbeginn,
    briefing: datei?.briefing ?? [],
    packliste: datei?.packliste ?? [],
  };
}
