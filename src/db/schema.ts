import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
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
  /** Uhrzeit der täglichen Lern-Erinnerung, volle Stunde 0–23 */
  reminderHour: integer("reminder_hour").notNull().default(17),
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

/**
 * Eine Prüfung: Klausur, Test, Referat oder mündliche Prüfung.
 *
 * Das Datum ist bewusst ein reines Kalenderdatum als Zeichenkette
 * ("2026-09-14"), kein Zeitstempel. Eine Klausur findet an einem Tag statt,
 * nicht zu einer Uhrzeit in einer Zeitzone — damit fällt eine ganze Klasse von
 * Verschiebungsfehlern weg.
 */
export const exams = pgTable(
  "exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    /** Optionaler Titel, z.B. "Analysis" — sonst reicht das Fach */
    title: text("title"),
    /** klausur | test | referat | muendlich */
    kind: text("kind").notNull().default("klausur"),
    date: date("date", { mode: "string" }).notNull(),
    /** Wie viele Tage vor der Prüfung gelernt wird */
    leadDays: integer("lead_days").notNull().default(10),
    /** Lernzeit pro Lerntag in Minuten */
    minutesPerDay: integer("minutes_per_day").notNull().default(45),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("exams_user_date_idx").on(t.userId, t.date)],
);

/** Ein Thema, das für eine Prüfung gelernt werden muss. */
export const examTopics = pgTable(
  "exam_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("exam_topics_exam_idx").on(t.examId)],
);

/**
 * Ein geplanter Lernblock an einem Tag. Der Lernplan besteht aus diesen
 * Blöcken; er wird berechnet, aber gespeichert — sonst würde jede Verschiebung
 * eines Tages den ganzen Plan unter dem Nutzer wegziehen.
 */
export const studyBlocks = pgTable(
  "study_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    /** Leer bei einer Gesamtwiederholung, die kein einzelnes Thema meint */
    topicId: uuid("topic_id").references(() => examTopics.id, {
      onDelete: "cascade",
    }),
    date: date("date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull().default(45),
    /** learn = erstes Durcharbeiten, review = Wiederholung */
    kind: text("kind").notNull().default("learn"),
    /** open | done | skipped */
    status: text("status").notNull().default("open"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("study_blocks_exam_idx").on(t.examId),
    index("study_blocks_date_idx").on(t.date),
  ],
);

/** Ein Gerät, das Push-Nachrichten empfangen darf. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Zur Anzeige in den Einstellungen, z.B. "Chrome auf Android" */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("push_subscriptions_endpoint_key").on(t.endpoint)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  subjects: many(subjects),
  exams: many(exams),
  pushSubscriptions: many(pushSubscriptions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  user: one(users, { fields: [subjects.userId], references: [users.id] }),
  exams: many(exams),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  user: one(users, { fields: [exams.userId], references: [users.id] }),
  subject: one(subjects, {
    fields: [exams.subjectId],
    references: [subjects.id],
  }),
  topics: many(examTopics),
  blocks: many(studyBlocks),
}));

export const examTopicsRelations = relations(examTopics, ({ one, many }) => ({
  exam: one(exams, { fields: [examTopics.examId], references: [exams.id] }),
  blocks: many(studyBlocks),
}));

export const studyBlocksRelations = relations(studyBlocks, ({ one }) => ({
  exam: one(exams, { fields: [studyBlocks.examId], references: [exams.id] }),
  topic: one(examTopics, {
    fields: [studyBlocks.topicId],
    references: [examTopics.id],
  }),
}));

export const pushSubscriptionsRelations = relations(
  pushSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [pushSubscriptions.userId],
      references: [users.id],
    }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;
export type Exam = typeof exams.$inferSelect;
export type NewExam = typeof exams.$inferInsert;
export type ExamTopic = typeof examTopics.$inferSelect;
export type NewExamTopic = typeof examTopics.$inferInsert;
export type StudyBlock = typeof studyBlocks.$inferSelect;
export type NewStudyBlock = typeof studyBlocks.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

/** Art einer Prüfung */
export type ExamKind = "klausur" | "test" | "referat" | "muendlich";
/** Art eines Lernblocks */
export type StudyBlockKind = "learn" | "review";
/** Zustand eines Lernblocks */
export type StudyBlockStatus = "open" | "done" | "skipped";
