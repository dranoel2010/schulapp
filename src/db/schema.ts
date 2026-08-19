import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Ein Nutzer. Die App ist für eine Person gedacht, die Tabelle hält uns aber
 * den Weg offen und verankert alle Daten an einem Besitzer.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Angemeldete Sitzung. Das Token steht im httpOnly-Cookie. */
export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Ein Schulfach — der Kern der App. Stundenplan, Hausaufgaben, Klausuren und
 * Noten hängen später alle hier dran.
 */
export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Voller Name, z.B. "Mathematik" */
    name: text("name").notNull(),
    /** Kürzel für Stundenplan-Kacheln, z.B. "M" oder "Ma" */
    short: text("short").notNull(),
    /** Schlüssel aus der Farbpalette in src/lib/colors.ts, z.B. "blue" */
    color: text("color").notNull().default("slate"),
    teacher: text("teacher"),
    room: text("room"),
    /**
     * Gewicht der schriftlichen Noten in Prozent (0–100).
     * Mündlich ergibt sich als 100 − weightWritten, dadurch kann die
     * Gewichtung nie widersprüchlich werden.
     */
    weightWritten: integer("weight_written").notNull().default(50),
    /** Reihenfolge in der Fächerliste */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Abgewählte Fächer bleiben für alte Noten erhalten, sind aber weg aus dem Alltag */
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("subjects_user_idx").on(t.userId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  subjects: many(subjects),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const subjectsRelations = relations(subjects, ({ one }) => ({
  user: one(users, { fields: [subjects.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;
