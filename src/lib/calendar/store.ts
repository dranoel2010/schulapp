import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  googleCalendarConnections,
  googleCalendarEvents,
  users,
  type GoogleCalendarConnection,
} from "@/db/schema";
import { DEFAULT_REMINDER_HOUR } from "@/lib/calendar/events";
import type { StepStore } from "@/lib/calendar/execute";
import type { EventRow, RowState } from "@/lib/calendar/plan";

/**
 * Der Google Kalender in der Datenbank — die zwei Tabellen und die
 * Erinnerungsstunde.
 *
 * Reine Datenschicht: kein Netz, keine Server Actions, kein Import aus Next.
 * Was die Tabellen bedeuten, steht an ihnen in src/db/schema.ts.
 *
 * Zwei Regeln für jede Funktion hier:
 *
 * - Jede Abfrage filtert nach `userId`, auch wo der Schlüssel schon eindeutig
 *   wäre — dieselbe Regel wie überall in @/lib.
 * - Jede Schreibung ist ein einzelnes Statement oder eine kurze Transaktion,
 *   und in keiner Transaktion wartet die App auf Google. PGlite hat genau eine
 *   Verbindung; eine Transaktion, die fünfzehn Sekunden auf eine Antwort aus
 *   dem Netz wartet, hielte so lange jede Seite der App an.
 */

export async function getConnection(
  userId: string,
): Promise<GoogleCalendarConnection | null> {
  const [row] = await db
    .select()
    .from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.userId, userId))
    .limit(1);

  return row ?? null;
}

/** Wer einen Zugang hat — auch blockierte; die zählt der Cron als Fehlschlag. */
export async function listConnectedUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: googleCalendarConnections.userId })
    .from(googleCalendarConnections)
    .where(isNotNull(googleCalendarConnections.refreshTokenEnc));

  return rows.map((row) => row.userId);
}

/**
 * Nach einer gelungenen Zustimmung: Zugang, Scope und Kalender festhalten.
 *
 * `newCalendar` heißt, der alte Kalender war weg oder gehörte einem anderen
 * Google-Konto. Dann gehen die Zeilen des Gedächtnisses mit — sie beschreiben
 * Termine in einem Kalender, an den die App nicht mehr herankommt.
 *
 * `last_cron_at` wird zurückgesetzt: Hing die Verbindung lange getrennt, stand
 * dort ein alter Zeitpunkt, und die Karte warnte gleich nach dem Verbinden vor
 * einem toten Cron, der nur deshalb schwieg, weil es nichts zu tun gab.
 */
export async function saveConnection(
  userId: string,
  input: {
    refreshTokenEnc: string;
    scope: string;
    calendarId: string;
    newCalendar: boolean;
  },
): Promise<void> {
  const values = {
    refreshTokenEnc: input.refreshTokenEnc,
    scope: input.scope,
    calendarId: input.calendarId,
    connectedAt: new Date(),
    blockedAt: null,
    blockedReason: null,
    lastError: null,
    lastErrorAt: null,
    lastCronAt: null,
    ...(input.newCalendar ? { googleEmail: null } : {}),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(googleCalendarConnections)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: googleCalendarConnections.userId, set: values });

    if (input.newCalendar) {
      await tx
        .delete(googleCalendarEvents)
        .where(eq(googleCalendarEvents.userId, userId));
    }
  });
}

/**
 * Ein neues Refresh Token, das Google beim Erneuern mitgeschickt hat. Nur,
 * wenn noch das alte dasteht — wer inzwischen neu verbunden oder getrennt hat,
 * dem schreibt ein alter Lauf nichts dazwischen.
 */
export async function storeRefreshToken(
  userId: string,
  oldEnc: string,
  newEnc: string,
): Promise<void> {
  await db
    .update(googleCalendarConnections)
    .set({ refreshTokenEnc: newEnc })
    .where(
      and(
        eq(googleCalendarConnections.userId, userId),
        eq(googleCalendarConnections.refreshTokenEnc, oldEnc),
      ),
    );
}

/**
 * Trennen. Kalender und Gedächtnis BLEIBEN: Wer neu verbindet, bekommt
 * denselben Kalender weitergeführt, und was er dort gelöscht hat, bleibt
 * draußen.
 */
export async function clearConnection(userId: string): Promise<void> {
  await db
    .update(googleCalendarConnections)
    .set({
      refreshTokenEnc: null,
      scope: "",
      blockedAt: null,
      blockedReason: null,
      lastError: null,
      lastErrorAt: null,
    })
    .where(eq(googleCalendarConnections.userId, userId));
}

/**
 * „Kalender neu anlegen": der neue Kalender, und das Gedächtnis geht mit —
 * der einzige Weg, auf dem es geleert wird. Auch was der Nutzer im alten
 * gelöscht hatte, kommt damit in den neuen; das sagt die Karte vorher.
 */
export async function replaceCalendar(
  userId: string,
  calendarId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(googleCalendarConnections)
      .set({
        calendarId,
        googleEmail: null,
        blockedAt: null,
        blockedReason: null,
        lastError: null,
        lastErrorAt: null,
      })
      .where(eq(googleCalendarConnections.userId, userId));

    await tx
      .delete(googleCalendarEvents)
      .where(eq(googleCalendarEvents.userId, userId));
  });
}

/**
 * „Verbindung unterbrochen". Wahr heißt: DIESER Aufruf hat blockiert — und
 * schickt deshalb die eine Push-Nachricht.
 *
 * Die Bedingungen sind die ganze Sicherung:
 *
 * - `blocked_at is null`: Von zwei Läufen gewinnt einer, und der zweite schickt
 *   nichts. Ein Zugang, der jede Stunde scheitert, klingelt einmal.
 * - Dasselbe Token und derselbe Kalender wie zu Beginn des Laufs: Ein alter
 *   Lauf, der zu Ende scheitert, blockiert keine Verbindung, die inzwischen
 *   neu steht — und ein „Trennen" mitten im Lauf erzeugt keine Push.
 */
export async function blockConnection(
  userId: string,
  input: {
    reason: "zugang" | "schluessel" | "kalender";
    sentence: string;
    tokenEnc: string;
    calendarId: string | null;
  },
): Promise<boolean> {
  const now = new Date();

  const rows = await db
    .update(googleCalendarConnections)
    .set({
      blockedAt: now,
      blockedReason: input.reason,
      lastError: input.sentence,
      lastErrorAt: now,
      lastRunAt: now,
    })
    .where(
      and(
        eq(googleCalendarConnections.userId, userId),
        isNull(googleCalendarConnections.blockedAt),
        eq(googleCalendarConnections.refreshTokenEnc, input.tokenEnc),
        input.calendarId === null
          ? isNull(googleCalendarConnections.calendarId)
          : eq(googleCalendarConnections.calendarId, input.calendarId),
      ),
    )
    .returning({ userId: googleCalendarConnections.userId });

  return rows.length > 0;
}

/** Was ein Lauf getan hat — für „Letzter Abgleich" und „Letzter Fehler". */
export async function recordRun(
  userId: string,
  outcome: { summary: string; error: { sentence: string } | null },
): Promise<void> {
  const now = new Date();

  await db
    .update(googleCalendarConnections)
    .set(
      outcome.error
        ? {
            lastRunAt: now,
            lastSummary: outcome.summary,
            lastError: outcome.error.sentence,
            lastErrorAt: now,
          }
        : {
            lastRunAt: now,
            lastSummary: outcome.summary,
            lastSuccessAt: now,
            lastError: null,
            lastErrorAt: null,
          },
    )
    .where(eq(googleCalendarConnections.userId, userId));
}

/** Ein Fehler, der zu keinem Abgleich gehört — etwa beim Neuanlegen des Kalenders. */
export async function recordError(userId: string, sentence: string): Promise<void> {
  await db
    .update(googleCalendarConnections)
    .set({ lastError: sentence, lastErrorAt: new Date() })
    .where(eq(googleCalendarConnections.userId, userId));
}

/** Der stündliche Lauf war da — auch wenn er danach nichts zu tun hatte. */
export async function touchCron(userId: string): Promise<void> {
  await db
    .update(googleCalendarConnections)
    .set({ lastCronAt: new Date() })
    .where(eq(googleCalendarConnections.userId, userId));
}

/** Das Google-Konto zur Anzeige, einmal — danach ändert es sich nicht mehr. */
export async function noteGoogleEmail(userId: string, email: string): Promise<void> {
  await db
    .update(googleCalendarConnections)
    .set({ googleEmail: email })
    .where(
      and(
        eq(googleCalendarConnections.userId, userId),
        isNull(googleCalendarConnections.googleEmail),
      ),
    );
}

/** Die Erinnerungsstunde des Nutzers; ohne Zeile die Voreinstellung. */
export async function readReminderHour(userId: string): Promise<number> {
  const [row] = await db
    .select({ hour: users.reminderHour })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.hour ?? DEFAULT_REMINDER_HOUR;
}

/** Das Gedächtnis für diesen Kalender. Den Zustand prüft @/lib/calendar/plan. */
export async function listEventRows(
  userId: string,
  calendarId: string,
): Promise<EventRow[]> {
  const rows = await db
    .select()
    .from(googleCalendarEvents)
    .where(
      and(
        eq(googleCalendarEvents.userId, userId),
        eq(googleCalendarEvents.calendarId, calendarId),
      ),
    );

  return rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    eventId: row.eventId,
    generation: row.generation,
    hash: row.hash,
    state: row.state as RowState,
    title: row.title,
  }));
}

/**
 * Zeilen eines ersetzten Kalenders. Ein Lauf, der beim Neuanlegen noch
 * unterwegs war, kann sie nach `replaceCalendar()` geschrieben haben; sie
 * beschreiben Termine im alten Kalender, um den sich die App nicht mehr
 * kümmert.
 */
export async function deleteRowsOfOtherCalendars(
  userId: string,
  calendarId: string,
): Promise<number> {
  const removed = await db
    .delete(googleCalendarEvents)
    .where(
      and(
        eq(googleCalendarEvents.userId, userId),
        ne(googleCalendarEvents.calendarId, calendarId),
      ),
    )
    .returning({ key: googleCalendarEvents.key });

  return removed.length;
}

/** Der Speicher für @/lib/calendar/execute — eine Zeile je Antwort von Google. */
export function stepStore(userId: string, calendarId: string): StepStore {
  return {
    async saveRow(row) {
      const values = {
        kind: row.kind,
        calendarId,
        eventId: row.eventId,
        generation: row.generation,
        hash: row.hash,
        state: row.state,
        title: row.title,
        updatedAt: new Date(),
      };

      await db
        .insert(googleCalendarEvents)
        .values({ userId, key: row.key, ...values })
        .onConflictDoUpdate({
          target: [googleCalendarEvents.userId, googleCalendarEvents.key],
          set: values,
        });
    },

    noteCreatorEmail: (email) => noteGoogleEmail(userId, email),
  };
}

/** Zahlen für die Karte: wie viel im Kalender steht, und was der Nutzer dort gelöscht hat. */
export async function calendarCounts(
  userId: string,
  calendarId: string,
): Promise<{ geliefert: number; verworfen: number; verworfenTitel: string[] }> {
  const where = and(
    eq(googleCalendarEvents.userId, userId),
    eq(googleCalendarEvents.calendarId, calendarId),
  );

  const [[counts], titles] = await Promise.all([
    db
      .select({
        geliefert: sql<number>`cast(count(*) filter (where ${googleCalendarEvents.state} = 'geliefert') as int)`,
        verworfen: sql<number>`cast(count(*) filter (where ${googleCalendarEvents.state} = 'verworfen') as int)`,
      })
      .from(googleCalendarEvents)
      .where(where),
    db
      .select({ title: googleCalendarEvents.title })
      .from(googleCalendarEvents)
      .where(and(where, eq(googleCalendarEvents.state, "verworfen")))
      .orderBy(desc(googleCalendarEvents.updatedAt))
      .limit(5),
  ]);

  return {
    geliefert: Number(counts?.geliefert ?? 0),
    verworfen: Number(counts?.verworfen ?? 0),
    verworfenTitel: titles.map((row) => row.title),
  };
}
