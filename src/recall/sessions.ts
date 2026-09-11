import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { subjects } from "@/db/schema";
import { daysBetween, todayInBerlin } from "@/lib/dates";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";

/**
 * Der Abend: was fällig ist, was geantwortet wurde, was dabei herauskam.
 *
 * ── Die Hälfte von A6, die man leicht übersieht ──────────────────────────────
 *
 * A6 lautet vollständig: „Jeder Baustein wird bis zur Klausur mindestens
 * viermal fällig, **Kriterium je Sitzung ist ein korrekter Abruf**, und es gilt
 * Deckung vor Tiefe." Der erste Teil ist der Terminplan und steht in
 * @/recall/schedule. Der zweite Teil steht hier, und er ist der Teil, den ein
 * Terminplaner gern verliert: Ein Termin gilt NICHT als erledigt, weil
 * irgendetwas abgeschickt wurde, sondern weil der Baustein einmal richtig
 * abgerufen wurde.
 *
 * Die Zahl dahinter ist Successive Relearning: 87 gegen 76 Prozent, d = 0,69.
 * Gemessen wurde dabei nicht „einmal gefragt", sondern „gefragt, bis es saß" —
 * innerhalb derselben Sitzung. Wer nur den Terminplan baut, baut die Hälfte der
 * Dosis und misst sich dann an der ganzen Zahl.
 *
 * Umgesetzt ist das so schlicht, wie es klingt: `doneAt` wird nur bei einer
 * richtigen Antwort gesetzt. Eine falsche Antwort wird protokolliert — sie ist
 * ein Messwert und kein Nichts — und lässt den Termin offen. `faelligHeute()`
 * gibt ihn deshalb noch im selben Abend wieder aus, hinten angestellt.
 *
 * ── Warum es kein „Überspringen" gibt ────────────────────────────────────────
 *
 * A16 erlaubt, Zeit und neue Bausteine zu deckeln, und verbietet, fällige
 * Wiederholungen zu deckeln. Ein Knopf, der einen Termin wegräumt, ohne dass
 * eine Antwort dasteht, wäre der kostenlose Lösungsknopf aus N11 mit anderem
 * Etikett: Fortschritt ohne Abruf. Scheinlernen betraf 33 Prozent der Schüler.
 *
 * Ein leeres Feld abzuschicken ist dagegen erlaubt und zählt als Versuch. Das
 * ist der Unterschied zwischen „ich weiß es nicht" (eine Auskunft, die ins
 * Protokoll gehört) und „zeig mir die Lösung" (keine).
 */

export type FaelligerBaustein = {
  scheduleId: string;
  itemId: string;
  round: number;
  mode: string;
  dueOn: string;
  promptFree: string;
  promptCue: string | null;
  promptCloze: string | null;
  solution: string;
  misconception: string;
  sourceQuote: string;
  pageId: string | null;
  subjectName: string;
  subjectColor: string;
  /** Wie oft dieser Baustein HEUTE schon danebenging — 0 beim ersten Mal */
  heuteDaneben: number;
};

/**
 * Was heute ansteht, überfällig zuerst.
 *
 * Überfälliges kommt nach vorn, weil es sonst nie wieder drankäme: Der
 * Terminplan legt keine neuen Termine für Verpasstes an, und er soll es auch
 * nicht — dann rutschte der ganze Plan mit. Ein liegengebliebener Termin
 * wartet, und Warten ist sichtbar, wenn er oben steht.
 */
export async function faelligHeute(
  userId: string,
  heute: string = todayInBerlin(),
): Promise<FaelligerBaustein[]> {
  const zeilen = await db
    .select({
      scheduleId: recallSchedule.id,
      itemId: recallItems.id,
      round: recallSchedule.round,
      mode: recallSchedule.mode,
      dueOn: recallSchedule.dueOn,
      promptFree: recallItems.promptFree,
      promptCue: recallItems.promptCue,
      promptCloze: recallItems.promptCloze,
      solution: recallItems.solution,
      misconception: recallItems.misconception,
      sourceQuote: recallItems.sourceQuote,
      pageId: recallItems.pageId,
      subjectName: subjects.name,
      subjectColor: subjects.color,
    })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .innerJoin(subjects, eq(subjects.id, recallItems.subjectId))
    .where(
      and(
        eq(recallItems.userId, userId),
        isNull(recallItems.retiredAt),
        isNull(recallSchedule.doneAt),
        lte(recallSchedule.dueOn, heute),
      ),
    )
    .orderBy(asc(recallSchedule.dueOn), asc(recallSchedule.sortOrder));

  if (zeilen.length === 0) return [];

  // Wie oft heute schon danebengegangen: entscheidet die Reihenfolge und
  // später die Formatstufe (A9). Eine Abfrage über den ganzen Tag, nicht je
  // Baustein eine — bei zwanzig fälligen Bausteinen wären das zwanzig Abfragen
  // für eine Zahl, die in einer steht.
  const versuche = await db
    .select({ itemId: recallAttempts.itemId, correct: recallAttempts.correct })
    .from(recallAttempts)
    .where(
      and(eq(recallAttempts.userId, userId), eq(recallAttempts.answeredOn, heute)),
    );

  const daneben = new Map<string, number>();
  for (const v of versuche) {
    if (v.correct || v.itemId === null) continue;
    daneben.set(v.itemId, (daneben.get(v.itemId) ?? 0) + 1);
  }

  const mitZahl = zeilen.map((z) => ({
    ...z,
    heuteDaneben: daneben.get(z.itemId) ?? 0,
  }));

  // Was heute schon einmal danebenging, kommt wieder — aber hinten. Sofort
  // noch einmal zu fragen wäre massiertes Lernen im Kleinen, und der Abstand
  // ist die Stellgröße: unter einem Tag 0,41 gegen 0,69 darüber. Innerhalb
  // eines Abends ist der größtmögliche Abstand „ans Ende".
  return [
    ...mitZahl.filter((z) => z.heuteDaneben === 0),
    ...mitZahl.filter((z) => z.heuteDaneben > 0),
  ];
}

export type Versuch = {
  scheduleId: string;
  itemId: string;
  answerText: string;
  /** frei | hinweis | luecke — auf welcher Stufe gefragt wurde (A9) */
  level?: string;
};

export type VersuchErgebnis =
  | { ok: false }
  | {
      ok: true;
      attemptId: string;
      /** Die Musterlösung — erst JETZT, nie vorher (A2) */
      solution: string;
      misconception: string;
    };

/**
 * Tage seit der letzten Begegnung mit diesem Baustein.
 *
 * Wird BEIM SCHREIBEN ausgerechnet und nicht bei der Auswertung. Der Grund ist
 * A11: Das Protokoll muss die Epochenlücke überdauern, und `item_id` steht auf
 * `set null` — nach dem Entfernen eines Bausteins wäre der Abstand nicht mehr
 * rekonstruierbar. Genau dann wird er gebraucht.
 *
 * Beim ersten Versuch gibt es keine Vorbegegnung; dann zählt der Abstand zum
 * Anlegen des Bausteins, denn das war der Abend, an dem der Stoff geschrieben
 * wurde.
 */
async function abstandSeitZuletzt(
  userId: string,
  itemId: string,
  heute: string,
): Promise<number> {
  const [letzter] = await db
    .select({ answeredOn: recallAttempts.answeredOn })
    .from(recallAttempts)
    .where(
      and(eq(recallAttempts.userId, userId), eq(recallAttempts.itemId, itemId)),
    )
    .orderBy(desc(recallAttempts.answeredOn), desc(recallAttempts.createdAt))
    .limit(1);

  if (letzter) return Math.max(0, daysBetween(letzter.answeredOn, heute));

  const [baustein] = await db
    .select({ createdAt: recallItems.createdAt })
    .from(recallItems)
    .where(eq(recallItems.id, itemId))
    .limit(1);

  if (!baustein) return 0;

  const angelegt = baustein.createdAt.toISOString().slice(0, 10);
  return Math.max(0, daysBetween(angelegt, heute));
}

/**
 * Schritt eins: den Versuch festhalten und ERST DANN die Lösung herausgeben.
 *
 * ── Warum das zwei Schritte sind und nicht einer ─────────────────────────────
 *
 * A2 verlangt, dass die Lösung ausnahmslos nach dem abgeschickten Versuch
 * erscheint, nie vorher. Das ist keine Anzeigeregel: Läge die Musterlösung
 * schon in der Seite, stünde sie in den Entwicklerwerkzeugen, und aus einer
 * Abrufübung würde eine Leseübung mit Zwischenschritt. Deshalb kommt sie als
 * Rückgabewert dieser Funktion und reist nie mit der Frage mit.
 *
 * ── Warum der Versuch schon hier gespeichert wird ────────────────────────────
 *
 * Weil sonst das Abschicken kostenlos wäre. N11 verbietet den kostenlosen
 * Lösungsknopf, und „leeres Feld abschicken" wäre genau einer, wenn daraus kein
 * Eintrag entstünde. Er entsteht — mit `correct: false`, denn zu diesem
 * Zeitpunkt ist nichts richtig. Wer die Seite jetzt schließt, hat einen
 * Fehlversuch im Protokoll und einen offenen Termin: beides zutreffend.
 *
 * Ein leeres Feld ist dabei erlaubt. „Ich weiß es nicht" ist eine Auskunft und
 * gehört ins Protokoll; „zeig mir die Lösung" wäre keine — der Unterschied ist,
 * dass das eine festgehalten wird.
 */
export async function versuchFesthalten(
  userId: string,
  versuch: Versuch,
  heute: string = todayInBerlin(),
): Promise<VersuchErgebnis> {
  // Der Nachweis, dass dieser Termin zu diesem Nutzer gehört. Server Actions
  // sind auch als nackter POST erreichbar; die Anmeldung allein sagt, WER
  // schreibt, nicht WORAUF er schreiben darf.
  const [termin] = await db
    .select({
      id: recallSchedule.id,
      itemId: recallItems.id,
      pageId: recallItems.pageId,
      role: recallItems.role,
      solution: recallItems.solution,
      misconception: recallItems.misconception,
    })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(
      and(
        eq(recallSchedule.id, versuch.scheduleId),
        eq(recallItems.id, versuch.itemId),
        eq(recallItems.userId, userId),
        isNull(recallSchedule.doneAt),
      ),
    )
    .limit(1);

  if (!termin) return { ok: false };

  const gapDays = await abstandSeitZuletzt(userId, termin.itemId, heute);

  const [angelegt] = await db
    .insert(recallAttempts)
    .values({
      userId,
      itemId: termin.itemId,
      scheduleId: termin.id,
      sourcePageId: termin.pageId,
      answeredOn: heute,
      gapDays,
      level: versuch.level ?? "frei",
      role: termin.role,
      answerText: versuch.answerText,
      correct: false,
    })
    .returning({ id: recallAttempts.id });

  return {
    ok: true,
    attemptId: angelegt.id,
    solution: termin.solution,
    misconception: termin.misconception,
  };
}

/**
 * Schritt zwei: das Urteil — und hier steht A6s zweite Hälfte.
 *
 * A6 lautet vollständig „…, Kriterium je Sitzung ist ein korrekter Abruf".
 * Deshalb schließt der Termin NUR bei einer richtigen Antwort. Eine falsche
 * lässt ihn offen, und `faelligHeute()` stellt den Baustein noch im selben
 * Abend wieder hinten an — Successive Relearning, 87 gegen 76 Prozent,
 * d = 0,69. Wer den Termin schon beim Abschicken schlösse, baute die halbe
 * Dosis und misse sich an der ganzen Zahl.
 *
 * Das Urteil fällt der Schüler selbst, aber erst NACH der eigenen Eingabe
 * (N11). In Stufe 1 tritt der Abgleich je Sinneinheit daneben — Selbsturteile
 * übersehen 20 bis 23 Prozent der Sinneinheiten.
 */
export async function urteilFesthalten(
  userId: string,
  attemptId: string,
  correct: boolean,
): Promise<{ ok: boolean; wiederholt: boolean }> {
  const [versuch] = await db
    .update(recallAttempts)
    .set({ correct })
    .where(
      and(eq(recallAttempts.id, attemptId), eq(recallAttempts.userId, userId)),
    )
    .returning({ scheduleId: recallAttempts.scheduleId });

  if (!versuch) return { ok: false, wiederholt: false };

  if (correct && versuch.scheduleId !== null) {
    await db
      .update(recallSchedule)
      .set({ doneAt: new Date() })
      .where(eq(recallSchedule.id, versuch.scheduleId));
  }

  return { ok: true, wiederholt: !correct };
}

export type Tagesbericht = {
  versuche: number;
  richtig: number;
  bausteine: number;
  offen: number;
};

/**
 * Was der Abend gebracht hat (A15).
 *
 * Ein Leistungsbericht über die Sitzung und ausdrücklich KEINE
 * Stoffzusammenfassung — die verbietet N11, weil sie die Zäsur des Formats
 * zerstört, in dem die Begriffsbildung für den Folgemorgen vorgesehen ist.
 *
 * Und eine Warnung, die zum Bericht gehört: Die Trefferquote des laufenden
 * Abends ist die Kennzahl, die lügt. Sie steigt, weil der Stoff frisch ist und
 * dieselben Fragen wiederkehren, während die Klausur etwas anderes misst —
 * unter einem Tag Abstand 0,41 gegen 0,69 darüber. Deshalb steht hier eine
 * Zählung und keine Quote.
 */
export async function tagesbericht(
  userId: string,
  heute: string = todayInBerlin(),
): Promise<Tagesbericht> {
  const versuche = await db
    .select({ itemId: recallAttempts.itemId, correct: recallAttempts.correct })
    .from(recallAttempts)
    .where(
      and(eq(recallAttempts.userId, userId), eq(recallAttempts.answeredOn, heute)),
    );

  const offen = await faelligHeute(userId, heute);

  return {
    versuche: versuche.length,
    richtig: versuche.filter((v) => v.correct).length,
    bausteine: new Set(versuche.map((v) => v.itemId)).size,
    offen: offen.length,
  };
}
