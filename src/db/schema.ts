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

/**
 * Das Stundenraster: wann die 1., 2., 3. Stunde beginnt und endet.
 *
 * Es steht pro Nutzer in der Datenbank und nicht als Konstante im Code, weil
 * jede Schule andere Zeiten hat — und weil ein falsches Raster den ganzen
 * Stundenplan wertlos macht. Beim ersten Öffnen wird es aus
 * `DEFAULT_PERIODS` (src/lib/timetable.ts) angelegt und ist danach änderbar.
 *
 * Die Uhrzeiten sind Zeichenketten im Format "HH:MM" — dieselbe Entscheidung
 * wie bei den Kalenderdaten: eine Schulstunde beginnt um 8 Uhr, nicht zu einem
 * Zeitpunkt in einer Zeitzone.
 */
export const periods = pgTable(
  "periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Die wievielte Stunde, beginnend bei 1 */
    number: integer("number").notNull(),
    /** "08:00" */
    startsAt: text("starts_at").notNull(),
    /** "08:45" */
    endsAt: text("ends_at").notNull(),
  },
  (t) => [
    unique("periods_user_number_key").on(t.userId, t.number),
    index("periods_user_idx").on(t.userId),
  ],
);

/**
 * Eine Stunde im festen Wochenplan: dieses Fach, an diesem Wochentag, in
 * dieser Stunde.
 *
 * Der Plan ist eine Woche lang und wiederholt sich — es gibt bewusst keine
 * Datumsangabe. Eine Doppelstunde sind zwei Einträge in aufeinanderfolgenden
 * Stunden; das hält das Modell einfach und die Anzeige kann sie zusammenfassen.
 *
 * Pro Wochentag und Stunde gibt es höchstens einen Eintrag. Die App gehört
 * einer Person, die nicht in zwei Räumen gleichzeitig sitzt — der eindeutige
 * Schlüssel macht daraus eine Zusage der Datenbank statt einer Hoffnung.
 */
export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    /** 1 = Montag … 5 = Freitag (ISO-Zählung, passend zu getUTCDay()) */
    weekday: integer("weekday").notNull(),
    /** Verweist auf periods.number, nicht auf eine Zeile — das Raster darf sich ändern */
    period: integer("period").notNull(),
    /** Leer heißt: der Raum des Fachs gilt */
    room: text("room"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("lessons_user_slot_key").on(t.userId, t.weekday, t.period),
    index("lessons_user_idx").on(t.userId),
  ],
);

/**
 * Eine Hausaufgabe: was bis wann für welches Fach zu tun ist.
 *
 * Fällig ist sie an einem Kalendertag, nicht zu einer Uhrzeit — dieselbe
 * Zeichenkette "YYYY-MM-DD" wie bei Prüfungen und Lernblöcken.
 *
 * Erledigt wird über `doneAt` festgehalten und nicht über ein zusätzliches
 * Ja/Nein: ein Zeitpunkt kann nicht in Widerspruch zu einem Häkchen geraten,
 * und "heute abgehakt" lässt sich daraus ablesen. Leer heißt offen.
 */
export const homework = pgTable(
  "homework",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Längere Beschreibung, z.B. "S. 42 Nr. 3–7" passt schon in den Titel */
    details: text("details"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    /** Wann abgehakt wurde; leer = offen */
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("homework_user_due_idx").on(t.userId, t.dueDate),
    index("homework_subject_idx").on(t.subjectId),
  ],
);

/**
 * Eine Note.
 *
 * Der Wert steht als ganze Zahl in Zehnteln: 7 ist eine 1+, 10 eine 1, 13
 * eine 1−, 60 eine 6. Der Grund ist der Schnitt: 1,3 + 2,3 ergibt in
 * Fließkomma 3,5999999999999996 und nicht 3,6 — in Zehnteln dagegen genau 36.
 * Welche Werte es gibt und wie sie heißen, steht in src/lib/grade-scale.ts —
 * die Datenbank kennt nur die Zahl.
 *
 * Die Skala endet bei 5− und springt dann auf 6: eine 6 trägt keine Tendenz,
 * das ist in Deutschland so und keine Lücke.
 *
 * `weight` ist das Gewicht innerhalb seiner Art: eine Klausur zählt doppelt
 * gegenüber einem Test, beide sind schriftlich. Wie schriftlich und mündlich
 * zueinander stehen, hängt dagegen am Fach (`subjects.weightWritten`) — das
 * ist eine Eigenschaft des Fachs und nicht der einzelnen Note.
 *
 * Das Datum ist ein reines Kalenderdatum wie überall sonst: eine Note wird an
 * einem Tag zurückgegeben, nicht zu einer Uhrzeit in einer Zeitzone.
 */
export const grades = pgTable(
  "grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    /** Note in Zehnteln: 7 = 1+, 10 = 1, 13 = 1−, … 53 = 5−, 60 = 6 */
    value: integer("value").notNull(),
    /** schriftlich | muendlich */
    kind: text("kind").notNull().default("schriftlich"),
    /** Gewicht innerhalb der Art, 1 = einfach, 2 = doppelt, … */
    weight: integer("weight").notNull().default(1),
    date: date("date", { mode: "string" }).notNull(),
    /** Wofür es sie gab, z.B. "2. Klausur" — das Fach steht schon daneben */
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("grades_user_date_idx").on(t.userId, t.date),
    index("grades_subject_idx").on(t.subjectId),
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
  periods: many(periods),
  lessons: many(lessons),
  homework: many(homework),
  grades: many(grades),
  pushSubscriptions: many(pushSubscriptions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  user: one(users, { fields: [subjects.userId], references: [users.id] }),
  exams: many(exams),
  lessons: many(lessons),
  homework: many(homework),
  grades: many(grades),
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

export const periodsRelations = relations(periods, ({ one }) => ({
  user: one(users, { fields: [periods.userId], references: [users.id] }),
}));

export const lessonsRelations = relations(lessons, ({ one }) => ({
  user: one(users, { fields: [lessons.userId], references: [users.id] }),
  subject: one(subjects, {
    fields: [lessons.subjectId],
    references: [subjects.id],
  }),
}));

export const homeworkRelations = relations(homework, ({ one }) => ({
  user: one(users, { fields: [homework.userId], references: [users.id] }),
  subject: one(subjects, {
    fields: [homework.subjectId],
    references: [subjects.id],
  }),
}));

export const gradesRelations = relations(grades, ({ one }) => ({
  user: one(users, { fields: [grades.userId], references: [users.id] }),
  subject: one(subjects, {
    fields: [grades.subjectId],
    references: [subjects.id],
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
export type Period = typeof periods.$inferSelect;
export type NewPeriod = typeof periods.$inferInsert;
export type Lesson = typeof lessons.$inferSelect;
export type NewLesson = typeof lessons.$inferInsert;
export type Homework = typeof homework.$inferSelect;
export type NewHomework = typeof homework.$inferInsert;
export type Grade = typeof grades.$inferSelect;
export type NewGrade = typeof grades.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

/** Art einer Prüfung */
export type ExamKind = "klausur" | "test" | "referat" | "muendlich";
/** Art eines Lernblocks */
export type StudyBlockKind = "learn" | "review";
/** Zustand eines Lernblocks */
export type StudyBlockStatus = "open" | "done" | "skipped";

/**
 * Art einer Note. Schriftlich und mündlich sind die beiden Töpfe, aus denen
 * sich der Fachschnitt zusammensetzt — wie stark jeder wiegt, steht am Fach.
 */
export type GradeKind = "schriftlich" | "muendlich";

/** Wochentag im Stundenplan: 1 = Montag … 5 = Freitag */
export type Weekday = 1 | 2 | 3 | 4 | 5;
