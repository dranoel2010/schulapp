import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { freePeriods, iservSnapshots, iservState, type IservStateRow } from "@/db/schema";
import { ferienPlan, planTutEtwas, type FerienWunsch } from "@/lib/iserv/ferien";
import type { Snapshot } from "@/lib/iserv/schutz";
import { ISERV_QUELLEN, iservItemsSchema, type IservQuelle } from "@/lib/iserv/types";

/**
 * IServ in der Datenbank — der Zustand und die Snapshots.
 *
 * Reine Datenschicht: kein Netz, kein Import aus Next. Was die Tabellen
 * bedeuten, steht an ihnen in src/db/schema.ts. Dieselben Regeln wie in
 * @/lib/calendar/store:
 *
 * - Jede Abfrage filtert nach `userId`.
 * - Jede Schreibung ist ein einzelnes Statement oder eine kurze Transaktion,
 *   und in keiner wartet die App auf IServ. Der Abruf holt erst alles aus dem
 *   Netz und schreibt dann in EINER Transaktion.
 * - Wer hier einen Fehler fängt, gibt ihn nur durch `errorText()` aus
 *   @/lib/calendar/error-text weiter: Drizzle hängt die Parameter einer
 *   gescheiterten Abfrage an die Meldung, und darin stünden Titel aus IServ.
 *
 * In dieser Datei steht nie ein Passwort und nie ein Cookie — sie bekommt
 * keins zu sehen.
 */

export async function ensureState(userId: string): Promise<void> {
  await db.insert(iservState).values({ userId }).onConflictDoNothing();
}

export async function readState(userId: string): Promise<IservStateRow | null> {
  const [row] = await db
    .select()
    .from(iservState)
    .where(eq(iservState.userId, userId))
    .limit(1);

  return row ?? null;
}

function istQuelle(wert: string): wert is IservQuelle {
  return (ISERV_QUELLEN as readonly string[]).includes(wert);
}

/**
 * Die Snapshots des Nutzers, je Quelle. Die Termine werden mit
 * `iservItemSchema` geprüft; was nicht passt, wirft — raten wäre hier
 * gefährlich, denn was nicht stimmt, landet in Google.
 */
export async function readSnapshots(userId: string): Promise<Map<IservQuelle, Snapshot>> {
  const rows = await db
    .select()
    .from(iservSnapshots)
    .where(eq(iservSnapshots.userId, userId));

  const map = new Map<IservQuelle, Snapshot>();

  for (const row of rows) {
    if (!istQuelle(row.source)) continue;

    const items = iservItemsSchema.parse(JSON.parse(row.itemsJson));

    map.set(row.source, {
      quelle: row.source,
      remoteId: row.remoteId,
      label: row.label,
      items,
      fetchedAt: row.fetchedAt,
      gesehenAm: row.lastSeenAt,
      ausstehend:
        row.pendingFingerprint && row.pendingSince
          ? { fingerprint: row.pendingFingerprint, anzahl: row.pendingCount, seit: row.pendingSince }
          : null,
    });
  }

  return map;
}

export type RunInput = {
  attemptAt: Date;
  /** eventsources und öffentlicher Kalender gelesen */
  success: boolean;
  /** Nur die zu schreibenden */
  snapshots: readonly Snapshot[];
  error: string | null;
  warning: string | null;
  /** undefined: unverändert lassen */
  sourcesJson?: string;
  /** Nur gesetzt, wenn noch keine Felder vermerkt sind */
  exerciseFields?: string;
  /**
   * Die freien Zeiträume, die IServ meldet (@/lib/iserv/ferien) — undefined:
   * die freien Tage nicht anfassen (kein Stand des öffentlichen Kalenders)
   */
  ferien?: { wuensche: readonly FerienWunsch[]; heute: string };
};

export type RunErgebnis = {
  /** Hat der Abgleich eine Zeile in `free_periods` angelegt, geändert oder entfernt? */
  ferienGeaendert: boolean;
};

/**
 * Was ein Abruf ergab — Snapshots, Zustand und die freien Tage aus IServ in
 * EINER kurzen Transaktion. Scheitert der Ferienabgleich, kommt auch der Rest
 * nicht an, und der Lauf meldet sich als Fehler.
 *
 * Die freien Tage: Gelesen und geschrieben werden NUR Zeilen mit
 * `quelle = 'iserv'` — von Hand eingetragene fasst diese Funktion nie an.
 * Erst wird gelöscht, dann geändert, dann angelegt, damit kein Schlüssel kurz
 * zweimal dasteht (Index `free_periods_iserv_key_idx`).
 */
export async function saveRun(userId: string, input: RunInput): Promise<RunErgebnis> {
  return db.transaction(async (tx) => {
    for (const snap of input.snapshots) {
      const values = {
        remoteId: snap.remoteId,
        label: snap.label,
        itemsJson: JSON.stringify(snap.items),
        itemCount: snap.items.length,
        fetchedAt: snap.fetchedAt,
        lastSeenAt: snap.gesehenAm,
        pendingFingerprint: snap.ausstehend?.fingerprint ?? null,
        pendingCount: snap.ausstehend?.anzahl ?? 0,
        pendingSince: snap.ausstehend?.seit ?? null,
      };

      await tx
        .insert(iservSnapshots)
        .values({ userId, source: snap.quelle, ...values })
        .onConflictDoUpdate({
          target: [iservSnapshots.userId, iservSnapshots.source],
          set: values,
        });
    }

    await tx
      .update(iservState)
      .set({
        lastAttemptAt: input.attemptAt,
        lastWarning: input.warning,
        ...(input.sourcesJson !== undefined ? { sourcesJson: input.sourcesJson } : {}),
        ...(input.exerciseFields !== undefined
          ? { exerciseFields: sql`coalesce(${iservState.exerciseFields}, ${input.exerciseFields})` }
          : {}),
        ...(input.success
          ? {
              lastSuccessAt: input.attemptAt,
              failuresInRow: 0,
              lastError: null,
              lastErrorAt: null,
            }
          : {
              failuresInRow: sql`${iservState.failuresInRow} + 1`,
              lastError: input.error,
              lastErrorAt: input.attemptAt,
            }),
      })
      .where(eq(iservState.userId, userId));

    if (!input.ferien) return { ferienGeaendert: false };

    const bestehend = await tx
      .select({
        id: freePeriods.id,
        iservKey: freePeriods.iservKey,
        kind: freePeriods.kind,
        title: freePeriods.title,
        startsOn: freePeriods.startsOn,
        endsOn: freePeriods.endsOn,
      })
      .from(freePeriods)
      .where(and(eq(freePeriods.userId, userId), eq(freePeriods.quelle, "iserv")));

    const plan = ferienPlan(
      bestehend.flatMap((z) => (z.iservKey ? [{ ...z, iservKey: z.iservKey }] : [])),
      input.ferien.wuensche,
      input.ferien.heute,
    );
    if (!planTutEtwas(plan)) return { ferienGeaendert: false };

    const nurIserv = (id: string) =>
      and(eq(freePeriods.id, id), eq(freePeriods.userId, userId), eq(freePeriods.quelle, "iserv"));

    for (const id of plan.loeschen) {
      await tx.delete(freePeriods).where(nurIserv(id));
    }
    for (const z of plan.aendern) {
      await tx
        .update(freePeriods)
        .set({ iservKey: z.iservKey, kind: z.kind, title: z.title, startsOn: z.startsOn, endsOn: z.endsOn })
        .where(nurIserv(z.id));
    }
    if (plan.neu.length > 0) {
      await tx.insert(freePeriods).values(
        plan.neu.map((w) => ({
          userId,
          quelle: "iserv",
          iservKey: w.schluessel,
          kind: w.kind,
          title: w.title,
          startsOn: w.startsOn,
          endsOn: w.endsOn,
        })),
      );
    }

    return { ferienGeaendert: true };
  });
}

/**
 * „IServ lässt die App nicht hinein." Wahr heißt: DIESER Aufruf hat
 * blockiert — und schickt deshalb die eine Push-Nachricht. Von zwei Läufen
 * gewinnt einer (`blocked_at is null`).
 */
export async function blockIserv(
  userId: string,
  reason: string,
  sentence: string,
): Promise<boolean> {
  const now = new Date();

  const rows = await db
    .update(iservState)
    .set({
      blockedAt: now,
      blockedReason: reason,
      lastError: sentence,
      lastErrorAt: now,
      lastAttemptAt: now,
      failuresInRow: sql`${iservState.failuresInRow} + 1`,
    })
    .where(and(eq(iservState.userId, userId), isNull(iservState.blockedAt)))
    .returning({ userId: iservState.userId });

  return rows.length > 0;
}

/** „Erneut versuchen" — oder ein neues Passwort auf dem NAS. */
export async function unblockIserv(userId: string): Promise<void> {
  await db
    .update(iservState)
    .set({ blockedAt: null, blockedReason: null, failuresInRow: 0 })
    .where(eq(iservState.userId, userId));
}

/**
 * Die Push „seit einem Tag nicht gelesen" — einmal je Durststrecke. Wahr
 * heißt: DIESER Aufruf darf sie schicken. Nach dem nächsten Erfolg darf es
 * wieder eine geben.
 */
export async function markStaleNotified(userId: string): Promise<boolean> {
  const rows = await db
    .update(iservState)
    .set({ staleNotifiedAt: new Date() })
    .where(
      and(
        eq(iservState.userId, userId),
        or(
          isNull(iservState.staleNotifiedAt),
          lt(
            iservState.staleNotifiedAt,
            sql`coalesce(${iservState.lastSuccessAt}, ${iservState.createdAt})`,
          ),
        ),
      ),
    )
    .returning({ userId: iservState.userId });

  return rows.length > 0;
}

/** Die Funktionen, die ein Abruf braucht — für die Tests als Attrappe im Speicher. */
export type IservStore = {
  ensureState: typeof ensureState;
  readState: typeof readState;
  readSnapshots: typeof readSnapshots;
  saveRun: typeof saveRun;
  blockIserv: typeof blockIserv;
  markStaleNotified: typeof markStaleNotified;
};

export const iservStore: IservStore = {
  ensureState,
  readState,
  readSnapshots,
  saveRun,
  blockIserv,
  markStaleNotified,
};
