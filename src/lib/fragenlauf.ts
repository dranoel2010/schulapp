import type { LeserLaufAbbruch, LeserLaufErgebnis } from "@/db/schema";
import { createQueue, type Queue } from "@/lib/calendar/queue";
import { claudeRufen } from "@/lib/claude/client";
import { messungZeile, type ClaudeErgebnis, type Messung } from "@/lib/claude/ergebnis";
import { formatGerman } from "@/lib/dates";
import {
  FRAGEN_ANTWORT,
  FRAGEN_FORM,
  FRAGEN_FRIST_MS,
  FRAGEN_MAX_TOKENS,
  FRAGEN_SYSTEM,
  bedarf,
  fragenEingabe,
  fragenErgebnis,
  fragenInhalt,
  type FragenAntwort,
} from "@/lib/fragenlauf-auftrag";
import { stoffAuskunft, type StoffAuskunft } from "@/lib/klausur-stoff";
import {
  claudeAusgangMelden,
  claudeDeps,
  type ClaudeLeserDeps,
} from "@/lib/leser/claude-leser";
import { laufVermerken } from "@/lib/leser/laeufe";
import { MAX_DATA_CHARS, tausender } from "@/lib/mcp/auskunft";
import { vorschlagAnlegen } from "@/recall/proposals";
import { stoffZuKlausur, type KlausurStoff } from "@/recall/source";

/**
 * Der Fragenlauf: aus dem Stoff einer Klausur werden Abruffragen — die App
 * ruft Opus dafür selbst (seit dem 11.10.2026).
 *
 * Bis zu diesem Tag war das harness/fragen.mts, ein `claude` im Käfig des
 * Postboten, von Hand im Container gestartet. Jetzt steht der Knopf dort, wo
 * der Stoff steht — auf der Klausurseite des Abrufs („Fragen bauen lassen“) —,
 * und von selbst läuft nichts: kein Takt, kein Anstoß beim Hochladen. Fragen
 * kosten Geld und einen Abend Durchsicht, und ob eine Klausur sie jetzt
 * braucht, entscheidet der Mensch.
 *
 * ── Was der Lauf schreiben darf: einen Vorschlag ────────────────────────────
 *
 * Der Stoff besteht aus Abschriften, und auf einem Blatt kann stehen, was wie
 * eine Anweisung aussieht. Die Regel „Agenten schreiben nie in den Bestand“
 * gilt deshalb auch hier (KONZEPT.md): die Fragen gehen nur durch
 * `vorschlagAnlegen()` in den Eingang, mit `origin: "agent"`, und erst ein
 * Mensch schickt sie beim Übernehmen durch `createItem()` und damit durch die
 * Quellbindung. Für Fragen gibt es — anders als bei Blättern — keine
 * Übernahme durch die App. Daneben schreibt dieser Lauf genau eine Zeile: den
 * Vermerk in `leser_laeufe`, damit ein „kein-vorschlag“ samt Grund nicht mehr
 * nur in einem Protokoll steht, das niemand liest. fragenlauf.test.ts prüft
 * beides an diesem Quelltext.
 *
 * ── Der Aufruf ──────────────────────────────────────────────────────────────
 *
 * Ohne Werkzeuge (@/lib/claude/client): der Stoff steht im Auftrag — dieselbe
 * Auskunft, die read_exam_material im Chat gibt (@/lib/klausur-stoff) —, und
 * die Antwort hat die Form der Argumente von propose_questions
 * (@/lib/fragenlauf-auftrag). Geprüft wird sie Frage für Frage, mit dem
 * Schema des Werkzeugs.
 *
 * ── Nie zwei Läufe für eine Klausur ─────────────────────────────────────────
 *
 * `vorschlagAnlegen()` prüft keine Dubletten, und zwei Läufe auf dieselbe
 * Klausur legten zwei Vorschläge aus demselben Stoff in den Eingang. Die
 * Sperre ist die Queue dieses Prozesses: läuft für eine Klausur ein Lauf oder
 * wartet einer, stößt ein zweiter Druck nichts an. Sich an den wartenden
 * anzuhängen, wie der Abschreiber es tut, genügte hier nicht — ein Lauf, der
 * mit „kein-vorschlag“ endet, lässt `bedarf()` unverändert, und der
 * angehängte zahlte dieselbe Antwort ein zweites Mal. Nacheinander laufen
 * auch Fragenläufe verschiedener Klausuren, in einer eigenen Kette: nicht in
 * der des Abschreibers (@/lib/leser/claude-zustand), denn hinter einem Stapel
 * Handschrift wartete sonst der Knopf, vor dem jemand sitzt.
 *
 * Nach einem Lauf greift `bedarf()`: liegen seine Fragen im Eingang, bietet
 * die Seite keinen neuen an, bis der Mensch entschieden hat.
 */

/** Was ein Lauf von außen braucht — dieselben Angaben wie beim Abschreiber. */
export type FragenDeps = ClaudeLeserDeps;

/**
 * Wie lange ein Knopfdruck als „läuft“ gilt, bevor sein Lauf in der Queue
 * steht. Dazwischen liegt nur die Antwort an den Browser (`after()`), also
 * Sekunden. Steht der Vermerk länger da, ging der Anstoß verloren — dann soll
 * die Seite nicht für immer „baut gerade“ sagen.
 */
const ANGEFORDERT_HOECHSTENS_MS = 60_000;

type FragenProzess = {
  /** Eine Kette für alle Fragenläufe dieses Prozesses. */
  queue: Queue<void>;
  /** Knopfdrücke, deren Lauf noch nicht fertig ist: Klausur → Nutzer und Zeitpunkt. */
  angefordert: Map<string, { userId: string; seit: number }>;
};

/**
 * Der Zustand an `globalThis`, aus demselben Grund wie die Queue des
 * Abschreibers: Next wertet ein Modul womöglich in mehreren Bündeln aus, und
 * zwei Queues wären zwei Sperren, also keine.
 */
const globalForFragen = globalThis as unknown as { __schulappFragen?: FragenProzess };

function zustand(): FragenProzess {
  globalForFragen.__schulappFragen ??= { queue: createQueue<void>(), angefordert: new Map() };
  return globalForFragen.__schulappFragen;
}

function schluessel(examId: string): string {
  return `fragen:${examId}`;
}

// ── Was jetzt dran wäre ──────────────────────────────────────────────────────

/** Die Auskunft über den Stoff und was daraus folgt: wie viele Fragen, oder warum keine. */
export type FragenStand = {
  auskunft: StoffAuskunft;
  was: { wieviele: number } | { nichts: string };
};

/**
 * Was ein Lauf jetzt täte — für den Lauf selbst und für die Klausurseite, die
 * daran entscheidet, ob sie den Knopf zeigt. Eine Rechnung für beide: ein
 * Knopf, der etwas verspricht, was der Lauf dann ablehnt, wäre ein Knopf ohne
 * Wirkung.
 *
 * Zu den fünf Fällen aus `bedarf()` kommt die Grenze der Auskunft: ein Stoff
 * über `MAX_DATA_CHARS` ginge im Chat nur Thema für Thema, und ohne
 * Werkzeuge kann der Lauf nicht enger fragen. Er ruft dann gar nicht erst.
 */
export async function fragenStand(userId: string, stoff: KlausurStoff): Promise<FragenStand> {
  const auskunft = await stoffAuskunft(userId, stoff, stoff.themen);
  const was = bedarf(auskunft.daten);

  if ("wieviele" in was && auskunft.zuGross) {
    return {
      auskunft,
      was: {
        nichts: `der Stoff ist mit ${tausender(auskunft.zeichen)} Zeichen länger als die ${tausender(MAX_DATA_CHARS)}, die ein Modell auf einmal bekommt — im Chat lässt er sich Thema für Thema holen`,
      },
    };
  }

  return { auskunft, was };
}

// ── Ein Lauf ─────────────────────────────────────────────────────────────────

/**
 * Was `fragenBauen()` ergab.
 *
 * - `gelaufen: false`: nichts zu tun, oder es durfte nicht — kein Aufruf,
 *   kein Vermerk. Die Klausurseite sagt denselben Grund selbst (`fragenStand()`).
 * - `gelaufen: true`: ein Aufruf mit Ergebnis; `vermerkt` sagt, ob seine
 *   Zeile in `leser_laeufe` steht.
 */
export type FragenLaufErgebnis =
  | { gelaufen: false; grund: string }
  | { gelaufen: true; ergebnis: LeserLaufErgebnis; grund: string; vermerkt: boolean };

type Ausgang = {
  ergebnis: LeserLaufErgebnis;
  grund: string;
  messung: Messung | null;
  /** Bezahlt und ohne Ergebnis — siehe `abbruch` an `leser_laeufe`. */
  abbruch: LeserLaufAbbruch | null;
  wandMs: number;
};

/**
 * Ein Fragenlauf für eine Klausur. Die Reihenfolge ist die Logik:
 *
 * 1. **Der Stoff und der Bedarf** (`fragenStand()`), gelesen von der App
 *    selbst und ohne Modell — das kostet nichts und beantwortet, ob sich ein
 *    Aufruf lohnt.
 * 2. **Der Aufruf**, ohne Werkzeuge, mit eigener Frist.
 * 3. **Die Prüfung**, Frage für Frage (`fragenEingabe()`).
 * 4. **Die Ablage**, nur durch `vorschlagAnlegen()`.
 * 5. **Der Vermerk** und eine Zeile mit der Messung ins Protokoll.
 *
 * Wirft nur, wenn die Datenbank schon beim Lesen des Stoffs nicht antwortet.
 */
export async function fragenBauen(
  userId: string,
  examId: string,
  deps?: Partial<FragenDeps>,
): Promise<FragenLaufErgebnis> {
  const d = claudeDeps(deps);
  if (!d.konfiguriert) {
    return { gelaufen: false, grund: "Kein API-Schlüssel eingerichtet (ANTHROPIC_API_KEY fehlt)." };
  }

  const stoff = await stoffZuKlausur(userId, examId);
  if (!stoff) return { gelaufen: false, grund: "Diese Prüfung gibt es nicht." };

  const { auskunft, was } = await fragenStand(userId, stoff);
  if ("nichts" in was) return { gelaufen: false, grund: was.nichts };

  const gerufen = await claudeRufen(
    {
      system: FRAGEN_SYSTEM,
      inhalt: fragenInhalt(
        { fach: stoff.subjectName, tag: formatGerman(stoff.klausurtag), wieviele: was.wieviele },
        auskunft,
      ),
      schema: FRAGEN_ANTWORT,
      form: FRAGEN_FORM,
      fristMs: FRAGEN_FRIST_MS,
      maxTokens: FRAGEN_MAX_TOKENS,
    },
    d.senden,
  );

  const ausgang = await ausgangAus(userId, examId, gerufen, was.wieviele);

  const vermerkt = await laufVermerken({
    userId,
    art: "fragen",
    examId,
    ergebnis: ausgang.ergebnis,
    grund: ausgang.grund,
    messung: ausgang.messung,
    abbruch: ausgang.abbruch,
  }).catch((error: unknown) => {
    console.error(`Fragen ${kurz(examId)}: Lauf nicht vermerkt — ${meldung(error)}`);
    return false;
  });

  const zeile = `Fragen ${kurz(examId)} (${stoff.subjectName}, ${was.wieviele} bestellt): ${ausgang.ergebnis}${ausgang.grund ? ` — ${ausgang.grund}` : ""}`;
  if (ausgang.ergebnis === "pause" || ausgang.ergebnis === "nichts") console.warn(zeile);
  else console.info(zeile);
  console.info(
    `   ${ausgang.messung ? messungZeile(ausgang.messung) : `Wand ${Math.round(ausgang.wandMs / 1000)} s, keine Antwort`}`,
  );

  return { gelaufen: true, ergebnis: ausgang.ergebnis, grund: ausgang.grund, vermerkt };
}

/**
 * Vom Aufruf zum Ergebnis des Laufs. Scheitert die Datenbank beim Ablegen,
 * ist das „spaeter“: bezahlt ist die Antwort schon, aber ein Lauf, der als
 * „vorschlag“ dastünde, ohne dass eine Frage im Eingang liegt, wäre schlimmer
 * als ein zweiter Druck.
 */
async function ausgangAus(
  userId: string,
  examId: string,
  gerufen: ClaudeErgebnis<FragenAntwort>,
  wieviele: number,
): Promise<Ausgang> {
  if (gerufen.art !== "antwort") {
    return {
      ergebnis: gerufen.art,
      grund: gerufen.grund,
      messung: gerufen.messung,
      abbruch: gerufen.abbruch,
      wandMs: gerufen.wandMs,
    };
  }

  const { antwort, messung, wandMs } = gerufen;
  const eingabe = fragenEingabe(antwort);

  if (eingabe.art === "kein-vorschlag") {
    return { ergebnis: "kein-vorschlag", grund: eingabe.grund, messung, abbruch: null, wandMs };
  }
  if (eingabe.art === "nichts") {
    const modell = antwort.grund.trim();
    return {
      ergebnis: "nichts",
      grund: modell ? `${eingabe.grund}; Claude: ${modell}` : eingabe.grund,
      messung,
      abbruch: null,
      wandMs,
    };
  }

  try {
    const ablage = await vorschlagAnlegen(userId, examId, eingabe.fragen, eingabe.note);
    return { ...fragenErgebnis(ablage, eingabe, wieviele, antwort.grund), messung, abbruch: null, wandMs };
  } catch (error) {
    // Nur die erste Zeile der Meldung: eine Meldung der Datenbank trägt sonst
    // die Parameter der Anweisung mit, also den Text des Modells.
    return {
      ergebnis: "spaeter",
      grund: `Der Vorschlag ließ sich nicht speichern: ${ersteZeile(meldung(error))}`,
      messung,
      abbruch: "ablage",
      wandMs,
    };
  }
}

// ── Der Knopf ────────────────────────────────────────────────────────────────

/**
 * Merkt einen Knopfdruck vor, bevor sein Lauf beginnt — damit die Seite, die
 * die Server Action gleich neu zeichnet, schon „baut gerade“ zeigt statt
 * wieder den Knopf. Der Lauf selbst beginnt erst nach der Antwort (`after()`).
 */
export function fragenVormerken(userId: string, examId: string): void {
  zustand().angefordert.set(examId, { userId, seit: Date.now() });
}

/** Stößt den Lauf an und kehrt sofort zurück. Wirft nie. */
export function fragenAnstossen(userId: string, examId: string): void {
  try {
    void fragenLaufen(userId, examId).catch((error: unknown) => {
      console.error(`Fragen ${kurz(examId)}: Lauf abgebrochen — ${meldung(error)}`);
    });
  } catch (error) {
    console.error(`Fragen ${kurz(examId)}: Lauf nicht angestoßen — ${meldung(error)}`);
  }
}

/**
 * Der Lauf in der Queue — oder nichts, wenn für diese Klausur schon einer
 * läuft oder wartet (die Sperre, siehe Kopf). `deps` ersetzt den Sender für
 * die Probe (scripts/probe-fragenlauf.mts).
 *
 * Eine Pause wartet er nicht ab, wie der Knopf am Blatt: wer drückt, will es
 * jetzt wissen, und ein abgewiesener Aufruf kostet nichts. Was er erlebt,
 * gilt danach aber auch für den Abschreiber (`claudeAusgangMelden()`) — ein
 * Schlüssel, den die API hier abweist, weist sie dort genauso ab.
 */
export function fragenLaufen(
  userId: string,
  examId: string,
  deps?: Partial<FragenDeps>,
): Promise<void> {
  const z = zustand();

  if (z.queue.busy(schluessel(examId))) {
    console.info(`Fragen ${kurz(examId)}: läuft schon — kein zweiter Lauf.`);
    return Promise.resolve();
  }

  z.angefordert.set(examId, { userId, seit: Date.now() });

  return z.queue.request(
    schluessel(examId),
    { frist: null, geduld: null },
    async () => {
      try {
        const ergebnis = await fragenBauen(userId, examId, deps);
        if (!ergebnis.gelaufen) {
          console.info(`Fragen ${kurz(examId)}: kein Lauf — ${ergebnis.grund}`);
        } else {
          claudeAusgangMelden(userId, ergebnis.ergebnis, ergebnis.grund);
        }
      } finally {
        z.angefordert.delete(examId);
      }
    },
    () => undefined,
  );
}

/**
 * Baut gerade ein Lauf Fragen zu dieser Klausur, wartet einer, oder hat
 * dieser Nutzer eben gedrückt? Fragt nur, legt nichts an außer dem leeren
 * Zustand.
 */
export function fragenLaufenGerade(
  userId: string,
  examId: string,
  jetzt: number = Date.now(),
): boolean {
  const z = zustand();
  if (z.queue.busy(schluessel(examId))) return true;

  const vorgemerkt = z.angefordert.get(examId);
  return (
    vorgemerkt !== undefined &&
    vorgemerkt.userId === userId &&
    jetzt - vorgemerkt.seit < ANGEFORDERT_HOECHSTENS_MS
  );
}

/** Die ersten acht Zeichen einer id — genug, um sie im Protokoll wiederzufinden. */
function kurz(id: string): string {
  return id.slice(0, 8);
}

function meldung(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ersteZeile(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 200);
}
