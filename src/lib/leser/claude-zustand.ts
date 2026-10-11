import { createQueue, type Queue } from "@/lib/calendar/queue";

/**
 * Der Zustand des Claude-Lesers in diesem Prozess — und nur in diesem
 * (seit dem 11.10.2026).
 *
 * **Warum eine eigene Datei.** Der Leser selbst (@/lib/leser/claude-leser)
 * holt sich Blätter, Seiten und die Tür aus @/lib/materials und
 * @/lib/blatt-vorschlag. Umgekehrt will `blaetterStand()` in @/lib/materials
 * wissen, ob er gerade liest — damit die Seiten im schnellen Takt nachfragen,
 * solange ein Lauf läuft. Läge der Zustand im Leser, wäre das ein Ring aus
 * Importen. Hier liegt er ohne einen einzigen Import aus der App: die Queue
 * aus @/lib/calendar/queue ist reine Rechnung.
 *
 * **An `globalThis`, aus demselben Grund wie die Datenbank in @/db** und die
 * Queue der Zuteilung: Next wertet ein Modul womöglich in mehreren Bündeln aus
 * — die Seiten, die Route Handler und seit dem 11.10.2026 src/instrumentation.ts.
 * Zwei Queues hießen zwei Läufe nebeneinander, und zwei Läufe zahlten
 * dasselbe Blatt zweimal.
 *
 * **Nichts davon überlebt einen Neustart, und das ist gewollt.** Was ein Lauf
 * ergeben hat, steht in `leser_laeufe` (src/db/schema.ts); hier steht nur, was
 * ohnehin flüchtig ist: wer gerade liest, wie lange die Pause noch dauert,
 * welche Wecker gestellt sind. Nach einem Neustart beginnt der Leser ohne
 * Pause — der erste Aufruf zeigt, ob sie noch nötig ist, und er kostet nichts,
 * wenn sie es ist.
 */

export type ClaudeProzess = {
  /**
   * Eine Kette für alle Läufe, getrennt von der der Zuteilung: ein Aufruf an
   * Opus dauert Minuten, und hinter ihm warteten sonst Seiten, die Docling in
   * Sekunden läse („eine Kette für alle“, @/lib/calendar/queue).
   */
  queue: Queue<void>;
  /** Wecker je Blatt (Ruhe) und einer für das Ende der Pause (`"pause"`). */
  wecker: Map<string, ReturnType<typeof setTimeout>>;
  /** Bis wann kein Lauf von selbst ruft (ms seit 1970); 0 heißt: keine Pause. */
  pauseBis: number;
  /** Wie lang die nächste Pause wird, wenn wieder eine kommt. */
  naechstePauseMs: number;
  /** Nutzer, deren Lauf an der Pause stehen blieb — der Wecker stößt sie an. */
  wartenAufPause: Set<string>;
  /**
   * Blätter, die „später“ endeten (Frist, Abbruch, ausgelasteter Rückfall)
   * oder an denen die Pausen in Folge hingen, mit dem Zeitpunkt, bis zu dem
   * sie ruhen.
   */
  spaeterBis: Map<string, number>;
  /** Blätter, die gerade gelesen werden: id des Blattes → id des Nutzers. */
  liest: Map<string, string>;
  /**
   * Knopfdrücke, deren Lauf noch nicht fertig ist: id des Blattes → wer, und
   * wie viele Läufe dieser Prozess an dem Blatt begonnen hatte, als gedrückt
   * wurde (`gestartet`, ohne einen, der da noch las). Daran sieht der Lauf von
   * Hand, ob seit dem Druck schon ein anderer an dem Blatt war
   * (`claudeVonHand()` in @/lib/leser/claude-leser) — gezählt und nicht nach
   * der Uhr, siehe `gestartet`.
   */
  angefordert: Map<string, { userId: string; gestartetBeimDruck: number }>;
  /**
   * Wie viele Läufe dieser Prozess an einem Blatt begonnen hat: id des
   * Blattes → Zahl, nur hochgezählt. Der Knopf fragte bis zur Nachprüfung vom
   * 11.10.2026 nach der Uhr — ob die Zeile des letzten Laufs jünger ist als
   * der Druck —, und verglich dabei `now()` der Datenbank mit `Date.now()`
   * des Prozesses. Zwei Uhren: ging die der Datenbank ein paar Millisekunden
   * vor, galt ein Lauf, der vor dem Druck fertig war, als „nach dem Druck“,
   * und der Druck fiel weg (in der Probe einer von drei). Eine Zahl hat keine
   * zweite Uhr.
   */
  gestartet: Map<string, number>;
  /**
   * Was der laufende Lauf eines Nutzers als Nächstes liest — die Auswahl von
   * eben, ohne das Blatt, an dem er gerade sitzt: id des Blattes → id des
   * Nutzers. Solange ein Blatt hier steht, zeigt seine Seite keinen Knopf: der
   * Leser nimmt es ohnehin, und ein Druck zahlte es ein zweites Mal.
   */
  eingeplant: Map<string, string>;
  /** Welches Blatt die letzten Pausen in Folge auslöste (`PAUSEN_JE_BLATT`). */
  pausenFolge: { materialId: string; anzahl: number } | null;
  /** Ist der Zustand des Schlüssels schon einmal ins Protokoll geschrieben? */
  gemeldet: boolean;
};

const globalForClaude = globalThis as unknown as {
  __schulappClaude?: ClaudeProzess;
};

/** Der eine Zustand dieses Prozesses; beim ersten Gebrauch angelegt. */
export function claudeProzess(startPauseMs: number): ClaudeProzess {
  globalForClaude.__schulappClaude ??= {
    queue: createQueue<void>(),
    wecker: new Map(),
    pauseBis: 0,
    naechstePauseMs: startPauseMs,
    wartenAufPause: new Set(),
    spaeterBis: new Map(),
    liest: new Map(),
    angefordert: new Map(),
    gestartet: new Map(),
    eingeplant: new Map(),
    pausenFolge: null,
    gemeldet: false,
  };
  return globalForClaude.__schulappClaude;
}

/**
 * Liest Claude gerade ein Blatt dieses Nutzers — oder ist ein Knopfdruck
 * unterwegs? Fragt nur, legt nichts an: ohne Zustand liest niemand.
 */
export function claudeBeschaeftigt(userId: string): boolean {
  const p = globalForClaude.__schulappClaude;
  if (!p) return false;

  for (const wer of p.liest.values()) if (wer === userId) return true;
  for (const { userId: wer } of p.angefordert.values()) if (wer === userId) return true;
  return false;
}

/**
 * Hält der Leser gerade an (`pause`: Schlüssel, Konto, API)? Dann liest bis
 * zum Ende der Pause niemand von selbst — und die Seite soll nicht „wird
 * gerade gelesen“ sagen, während darunter „angehalten“ steht (im Browser
 * gesehen am 11.10.2026, mit einem abgewiesenen Schlüssel).
 */
export function claudePausiert(): boolean {
  const p = globalForClaude.__schulappClaude;
  return p ? p.pauseBis > Date.now() : false;
}

/** Liest Claude gerade DIESES Blatt, oder wartet ein Knopfdruck darauf? */
export function claudeLiestGerade(materialId: string): boolean {
  const p = globalForClaude.__schulappClaude;
  return p ? p.liest.has(materialId) || p.angefordert.has(materialId) : false;
}

/**
 * Nimmt der Leser DIESES Blatt ohnehin gleich: steht es in der Auswahl des
 * laufenden Laufs, oder wartet es nur noch auf seine Ruhe (ein Wecker)?
 */
export function claudeEingeplant(materialId: string): boolean {
  const p = globalForClaude.__schulappClaude;
  return p ? p.eingeplant.has(materialId) || p.wecker.has(materialId) : false;
}
