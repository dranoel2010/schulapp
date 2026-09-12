import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { exams, materialPages, materials, subjects } from "@/db/schema";
import { berlinDay, todayInBerlin } from "@/lib/dates";
import { UNCERTAIN_CLOSE, UNCERTAIN_OPEN } from "@/lib/transcripts";
import { planeFaelligkeiten, type PlanWarnung } from "@/recall/schedule";
import { istId } from "@/recall/ids";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Bausteine anlegen, auflisten, zurückziehen.
 *
 * ── Die Tür, an der A5 durchgesetzt wird ─────────────────────────────────────
 *
 * Der Bericht nennt die Quellbindung ausdrücklich das Einzige am Fragenbestand,
 * das KEINE Bauentscheidung ist: Jede Aufgabe stammt aus dem, was dieser
 * Schüler an diesem Vormittag aufgeschrieben oder abfotografiert hat. Die Zahl
 * dahinter ist unangenehm — maschinell erzeugte Fragen erreichen eine
 * Trennschärfe von 0,28 [0,21; 0,35], also unter dem Zielwert 0,3, bei drei
 * dokumentierten Halluzinationstypen.
 *
 * Deshalb steht die Prüfung hier und nicht im Formular. Ein Formular prüft
 * einen Weg; diese Funktion ist der einzige Weg. Wenn später ein Agent Fragen
 * vorschlägt (Stufe 1b), geht er durch dieselbe Tür — und nicht durch eine
 * zweite, die jemand vergessen hat gleich streng zu machen.
 *
 * Zwei Bedingungen, und die zweite ist die wichtigere:
 *
 *   1. Die Abschrift der Seite muss das Zitat WÖRTLICH enthalten.
 *   2. Das Zitat darf keine ⟨spitzen Klammern⟩ enthalten.
 *
 * Die Klammern markieren, was schon beim Abschreiben unsicher war. Eine Frage
 * darauf zu bauen hieße, eine Vermutung als Prüfstoff auszuliefern — und zwar
 * eine, die niemand mehr als Vermutung erkennt, sobald sie als Musterlösung
 * dasteht. Die Markierung steht schon im Text; sie muss nur gelesen werden.
 *
 * Abgewiesen wird, nicht abgeschnitten. Das ist dieselbe Haltung, mit der die
 * MCP-Werkzeuge eine zu lange Eingabe zurückweisen, statt sie stillschweigend
 * zu kürzen: Wer kürzt, liefert etwas aus, das niemand so gemeint hat.
 */

/**
 * Warum ein Baustein nicht angelegt werden konnte.
 *
 * Eine Aufzählung und keine freie Zeichenkette, damit die Oberfläche für jeden
 * Fall einen eigenen Satz hat — „ungültig" ist keine Auskunft.
 */
/**
 * Wovon eine Frage handelt — die vier Arten, und nur diese vier.
 *
 * Die Liste stand bis heute dreimal da: als Aufzählung im Formularschema, als
 * vier `<option>` in der Oberfläche und als Satz im Kommentar der Spalte. Drei
 * Fassungen derselben Abmachung, und die Tür für den Agenten wäre die vierte
 * geworden. Sie steht deshalb hier, neben der Funktion, die den Wert in die
 * Datenbank schreibt.
 *
 * Beliebig sind die Werte nicht: A10 mischt über den Materialtyp, und gemischt
 * wird nur Verwechselbares. Anschauungsklassen gewinnen dabei bis 0,67,
 * Begriff-Definition-Paare verlieren mit -0,39 — eine fünfte Art, hastig
 * hinzugefügt, wäre eine Klasse ohne Befund, die später mitgemischt wird.
 */
export const MATERIALARTEN = [
  "begriff",
  "anschauung",
  "verfahren",
  "ereignis",
] as const;

export type Materialart = (typeof MATERIALARTEN)[number];

export type AnlageFehler =
  | "keine-seite"
  | "kein-fach"
  | "keine-abschrift"
  | "zitat-leer"
  | "zitat-nicht-gefunden"
  | "zitat-unsicher";

export type NeuerBaustein = {
  /** Die Heftseite, aus der die Frage stammt */
  pageId: string;
  subjectId: string;
  subjectTopicId?: string | null;
  /** Die Frage im freien Format (A1) */
  promptFree: string;
  /** Dieselbe Frage mit Hinweisreiz und als Lückentext (A9), beide freiwillig */
  promptCue?: string | null;
  promptCloze?: string | null;
  /** Die Musterlösung, eine Sinneinheit je Zeile */
  solution: string;
  /** Ein bis zwei Sätze zur Verwechslung (A3, Teil drei) */
  misconception: string;
  /** Der Wortlaut aus der Abschrift, auf den sich die Frage stützt */
  sourceQuote: string;
  materialKind?: string;
  /** uebung | messung — beim Anlegen reserviert, nie nachträglich (A12) */
  role?: string;
};

export type AnlageErgebnis =
  | {
      ok: true;
      id: string;
      /** Abrufgelegenheiten VOR dem Klausurtermin — die Zahl, an der A6 hängt */
      vorKlausur: number;
      /** Termine der Erhaltung nach der Klausur; zählen für A6 ausdrücklich nicht */
      nachKlausur: number;
      /** Was die Planung zu melden hatte — leer heißt: sie ist aufgegangen */
      warnungen: PlanWarnung[];
    }
  | { ok: false; fehler: AnlageFehler };

/**
 * Die Seite samt Abschrift — und samt Nachweis, dass sie diesem Nutzer gehört.
 *
 * Der Verbund über `materials` steht hier aus demselben Grund wie in
 * `listMaterialTranscripts()`: An der Seite selbst hängt keine `userId`.
 */
async function seiteMitAbschrift(
  userId: string,
  pageId: string,
): Promise<{ transcript: string | null } | null> {
  const [zeile] = await db
    .select({ transcript: materialPages.transcript })
    .from(materialPages)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialPages.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(eq(materialPages.id, pageId))
    .limit(1);

  return zeile ?? null;
}

/**
 * Die nächste Klausur in diesem Fach, oder null.
 *
 * Sie ist der harte Termin, gegen den geplant wird (A7). Kein fertiger
 * Wiederholungsalgorithmus kennt so etwas — sie kennen eine Zielbehaltensrate,
 * keinen Prüfungstag. Genau deshalb liegt die Planung hier und nicht in einer
 * Bibliothek.
 */
/**
 * Welche Prüfungsarten als „der harte Termin" gelten.
 *
 * Nicht alle. `exams` führt vier Arten — klausur, test, referat, muendlich —,
 * und nur die ersten beiden sind das, worauf A7 und A8 zielen: ein schriftlicher
 * Abruf des Stoffs zu einem festen Tag. Ein Referat ist ein Vortrag, eine
 * mündliche Prüfung ein Gespräch; beide prüfen etwas anderes und liegen oft
 * Wochen vor der eigentlichen Klausur.
 *
 * Ohne diese Einschränkung passierte Folgendes: Steht in Deutsch am 18.9. ein
 * Referat und am 9.10. die Klausur, zöge die Planung alle Übungstermine auf die
 * Tage vor dem Referat zusammen und schaltete danach in den 21-Tage-Takt der
 * Erhaltung. Für die Klausur drei Wochen später bliebe genau ein Abruf übrig —
 * und der läge auf dem Klausurtag selbst.
 */
const HARTE_TERMINE = ["klausur", "test"] as const;

async function naechsteKlausur(
  userId: string,
  subjectId: string,
  heute: string,
): Promise<string | null> {
  const [zeile] = await db
    .select({ date: exams.date })
    .from(exams)
    .where(
      and(
        eq(exams.userId, userId),
        eq(exams.subjectId, subjectId),
        gte(exams.date, heute),
        inArray(exams.kind, [...HARTE_TERMINE]),
      ),
    )
    .orderBy(asc(exams.date))
    .limit(1);

  return zeile?.date ?? null;
}

/**
 * Einen Baustein anlegen und seine Termine gleich mitplanen.
 *
 * Beides in einem Schritt, weil ein Baustein ohne Termine nichts ist: Die
 * belegte Wirkung stammt aus der Zahl der Abrufgelegenheiten und ihrer
 * Verteilung, nicht aus dem Vorhandensein einer Frage. Ein Bestand, der sich
 * füllt, während der Terminplan leer bleibt, sähe nach Fortschritt aus und
 * wäre keiner.
 */
export async function createItem(
  userId: string,
  eingabe: NeuerBaustein,
  heute: string = todayInBerlin(),
): Promise<AnlageErgebnis> {
  // Eine fehlgeformte id ist dasselbe wie eine, die es nicht gibt. Ohne diese
  // zwei Zeilen wirft Postgres mitten in einem Werkzeugaufruf — die Begründung
  // steht in @/recall/ids. Eine wohlgeformte, aber fremde id fängt weiterhin
  // erst der Fremdschlüssel: Das ist eine Ausnahme, die niemand außer einem
  // gefälschten Formular auslöst, und sie schreibt nichts.
  if (!istId(eingabe.pageId)) return { ok: false, fehler: "keine-seite" };
  if (!istId(eingabe.subjectId)) return { ok: false, fehler: "kein-fach" };

  const seite = await seiteMitAbschrift(userId, eingabe.pageId);
  if (!seite) return { ok: false, fehler: "keine-seite" };

  // NULL heißt „diese Seite hat noch niemand gelesen", der leere String heißt
  // „gelesen, und es stand nichts darauf". Beide taugen nicht als Quelle, aber
  // aus verschiedenen Gründen — und nur der erste lässt sich beheben.
  if (seite.transcript === null || seite.transcript.trim() === "") {
    return { ok: false, fehler: "keine-abschrift" };
  }

  const zitat = eingabe.sourceQuote.trim();

  // Der leere String steht wörtlich in JEDER Abschrift: `"abc".includes("")`
  // ist wahr. Ohne diese Zeile ließe sich A5 mit einem leeren Zitat umgehen —
  // die Prüfung darunter sagte ja, und in der Datenbank stünde eine Frage,
  // deren Quelle nichts belegt. Das Handformular verlangt den Wortlaut zwar
  // ohnehin, aber die Regel gehört an die Tür und nicht in das Formular: durch
  // diese Tür kommt seit dem Eingangskorb auch die KI.
  if (zitat === "") return { ok: false, fehler: "zitat-leer" };

  if (!seite.transcript.includes(zitat)) {
    return { ok: false, fehler: "zitat-nicht-gefunden" };
  }

  // Jede einzelne Klammer zählt, nicht nur das vollständige Paar.
  //
  // `uncertainSpans()` sucht nach ⟨…⟩ als Ganzem und übersieht damit den Fall,
  // der beim Herauskopieren mit der Maus am leichtesten passiert: Der Schüler
  // zieht über einen Satzteil, der MITTEN in einer Markierung beginnt, und
  // erwischt nur deren schließende Klammer. Das Zitat steht dann wörtlich in
  // der Abschrift, enthält aber Text, der beim Abschreiben ausdrücklich als
  // unsicher markiert war — und trüge ihn als Prüfstoff in die Datenbank.
  if (zitat.includes(UNCERTAIN_OPEN) || zitat.includes(UNCERTAIN_CLOSE)) {
    return { ok: false, fehler: "zitat-unsicher" };
  }

  const klausurtag = await naechsteKlausur(userId, eingabe.subjectId, heute);
  const role = eingabe.role === "messung" ? "messung" : "uebung";

  const [angelegt] = await db
    .insert(recallItems)
    .values({
      userId,
      pageId: eingabe.pageId,
      subjectId: eingabe.subjectId,
      subjectTopicId: eingabe.subjectTopicId ?? null,
      promptFree: eingabe.promptFree.trim(),
      promptCue: eingabe.promptCue?.trim() || null,
      promptCloze: eingabe.promptCloze?.trim() || null,
      solution: eingabe.solution.trim(),
      misconception: eingabe.misconception.trim(),
      sourceQuote: zitat,
      sourceLength: seite.transcript.length,
      materialKind: eingabe.materialKind ?? "begriff",
      role,
    })
    .returning({ id: recallItems.id });

  // A12: Ein Baustein des Messvorrats bekommt NIEMALS einen Termin. Das ist
  // eine Eigenschaft der Planung und keine Filterregel beim Ausliefern — sonst
  // wäre die Trennung eine Absprache und keine Struktur.
  if (role === "messung") {
    return {
      ok: true,
      id: angelegt.id,
      vorKlausur: 0,
      nachKlausur: 0,
      warnungen: [],
    };
  }

  const plan = planeFaelligkeiten({
    heute,
    aufgenommenAm: heute,
    klausurtag,
  });

  if (plan.faelligkeiten.length > 0) {
    await db.insert(recallSchedule).values(
      plan.faelligkeiten.map((f) => ({
        itemId: angelegt.id,
        dueOn: f.dueOn,
        round: f.round,
        mode: f.mode,
        sortOrder: f.sortOrder,
      })),
    );
  }

  // Getrennt gezählt, und die Warnungen kommen mit.
  //
  // Vorher stand hier eine einzige Zahl über alle Termine — und die zählte die
  // Erhaltungstermine NACH der Klausur mit. Wer am Abend vor der Klausur einen
  // Baustein anlegte, las „3 Termine geplant" und hatte in Wahrheit keinen
  // einzigen Abruf vor der Prüfung: Die drei lagen 21, 42 und 63 Tage danach.
  // Die Planung erkennt genau diesen Fall und setzt die Warnung `keine-tage` —
  // sie wurde nur nie gelesen. Eine Zahl, die im Zusammenhang „vor der Klausur
  // angelegt" als Vorbereitung verstanden wird, darf nicht etwas anderes
  // zählen als das, wonach sie aussieht.
  return {
    ok: true,
    id: angelegt.id,
    vorKlausur: plan.faelligkeiten.filter((f) => f.mode === "klausur").length,
    nachKlausur: plan.faelligkeiten.filter((f) => f.mode === "erhaltung").length,
    warnungen: plan.warnungen,
  };
}

/**
 * Die offenen Termine aller Bausteine neu rechnen.
 *
 * ── Warum es das geben muss ──────────────────────────────────────────────────
 *
 * Weil beim Anlegen genau einmal geplant wird und der Klausurtermin sich
 * danach bewegt. Drei Fälle, und alle drei sind Alltag:
 *
 *   1. Die Bausteine entstehen, bevor die Klausur im Kalender steht. Dann
 *      plant `createItem` ohne Ziel — vier Termine im Grundtakt, keine
 *      Erhaltung. Wird die Klausur später eingetragen, liegen Termine dahinter,
 *      und A7 ist verletzt, ohne dass jemand etwas falsch gemacht hätte.
 *   2. Die Klausur wird verschoben. Der Plan bleibt auf dem alten Datum.
 *   3. Eine zweite, frühere Klausur kommt dazu.
 *
 * ── Was dabei NICHT angerührt wird ───────────────────────────────────────────
 *
 * Erledigte Termine. Sie sind Vergangenheit und tragen als einzige einen
 * gemessenen Abruf; sie neu zu rechnen hieße, Geschehenes umzuschreiben. Es
 * verschwinden also nur offene Termine, und an ihre Stelle tritt der Plan, der
 * zum heutigen Kalender passt. Dasselbe Verfahren wie beim Lernplan der
 * Klausuren, wo auch nur `status = 'open'` neu verteilt wird.
 *
 * Bausteine des Messvorrats bleiben außen vor — sie bekommen nie einen Termin
 * (A12), auch nicht beim Neurechnen.
 */
export async function neuPlanen(
  userId: string,
  heute: string = todayInBerlin(),
): Promise<{ bausteine: number; termine: number }> {
  const offene = await db
    .select({
      id: recallItems.id,
      subjectId: recallItems.subjectId,
      createdAt: recallItems.createdAt,
    })
    .from(recallItems)
    .where(
      and(
        eq(recallItems.userId, userId),
        isNull(recallItems.retiredAt),
        eq(recallItems.role, "uebung"),
      ),
    );

  if (offene.length === 0) return { bausteine: 0, termine: 0 };

  // Der Klausurtag je Fach einmal holen, nicht je Baustein — bei sechzig
  // Bausteinen in einem Fach wären das sechzig gleiche Abfragen.
  const klausurtage = new Map<string, string | null>();
  for (const faecherId of new Set(offene.map((b) => b.subjectId))) {
    klausurtage.set(faecherId, await naechsteKlausur(userId, faecherId, heute));
  }

  let termine = 0;
  let bausteine = 0;

  for (const baustein of offene) {
    await db
      .delete(recallSchedule)
      .where(
        and(
          eq(recallSchedule.itemId, baustein.id),
          isNull(recallSchedule.doneAt),
        ),
      );

    const plan = planeFaelligkeiten({
      heute,
      aufgenommenAm: berlinDay(baustein.createdAt),
      klausurtag: klausurtage.get(baustein.subjectId) ?? null,
    });

    if (plan.faelligkeiten.length > 0) {
      await db.insert(recallSchedule).values(
        plan.faelligkeiten.map((f) => ({
          itemId: baustein.id,
          dueOn: f.dueOn,
          round: f.round,
          mode: f.mode,
          sortOrder: f.sortOrder,
        })),
      );
      termine += plan.faelligkeiten.length;
    }
    bausteine += 1;
  }

  return { bausteine, termine };
}

export type BausteinZeile = {
  id: string;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  materialKind: string;
  role: string;
  retiredAt: Date | null;
  subjectName: string;
  subjectColor: string;
  offeneTermine: number;
};

/** Alle Bausteine des Nutzers, die neuesten zuerst. */
export async function listItems(userId: string): Promise<BausteinZeile[]> {
  const zeilen = await db
    .select({
      id: recallItems.id,
      promptFree: recallItems.promptFree,
      solution: recallItems.solution,
      misconception: recallItems.misconception,
      sourceQuote: recallItems.sourceQuote,
      materialKind: recallItems.materialKind,
      role: recallItems.role,
      retiredAt: recallItems.retiredAt,
      subjectName: subjects.name,
      subjectColor: subjects.color,
    })
    .from(recallItems)
    .innerJoin(subjects, eq(subjects.id, recallItems.subjectId))
    .where(eq(recallItems.userId, userId))
    .orderBy(desc(recallItems.createdAt));

  if (zeilen.length === 0) return [];

  // Die offenen Termine je Baustein in einer zweiten Abfrage statt als Verbund:
  // ein Verbund mit Gruppierung über zwei Tabellen liefert für einen Baustein
  // ohne Termine keine Zeile, und dann fehlte er in der Liste ganz.
  const termine = await db
    .select({ itemId: recallSchedule.itemId })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(and(eq(recallItems.userId, userId), isNull(recallSchedule.doneAt)));

  const offen = new Map<string, number>();
  for (const t of termine) offen.set(t.itemId, (offen.get(t.itemId) ?? 0) + 1);

  return zeilen.map((z) => ({ ...z, offeneTermine: offen.get(z.id) ?? 0 }));
}

/**
 * „Stand so nicht im Heft" — den Baustein zurückziehen (A5).
 *
 * Kein Löschen. Die Antworten darauf sind selbst ein Messwert, und Abschnitt 8
 * macht die Zahl dieser Meldungen zu einem Abnahmekriterium: Sie ist das
 * einzige Warnsignal dafür, dass der Fragenbestand auseinanderläuft. Ein
 * zurückgezogener Baustein verliert nur seine offenen Termine.
 */
export async function retireItem(
  userId: string,
  itemId: string,
  grund: string,
): Promise<boolean> {
  if (!istId(itemId)) return false;

  const [zeile] = await db
    .update(recallItems)
    .set({ retiredAt: new Date(), retiredReason: grund.trim() || "ohne Angabe" })
    .where(and(eq(recallItems.id, itemId), eq(recallItems.userId, userId)))
    .returning({ id: recallItems.id });

  if (!zeile) return false;

  await db
    .delete(recallSchedule)
    .where(and(eq(recallSchedule.itemId, itemId), isNull(recallSchedule.doneAt)));

  return true;
}
