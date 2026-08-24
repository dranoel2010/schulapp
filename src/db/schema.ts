import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Rohe Bytes als `bytea` — die Spalte, die drizzle-orm nicht mitbringt.
 *
 * `drizzle-orm/pg-core` hat für jeden Postgres-Typ eine eigene Spalte, nur für
 * rohe Bytes nicht. Der vorgesehene Weg dorthin ist `customType`, und was er
 * ausgleichen muss, sind die beiden Treiber: PGlite reicht beim Lesen ein
 * Uint8Array herauf, postgres-js einen Node-Buffer aus einem gemeinsam
 * genutzten Pool. Dessen `byteOffset` ist bei kleinen Werten nicht null —
 * gemessen: 21272 bei 64 Bytes. Deshalb wird der Blick auf die Bytes immer mit
 * Offset und Länge gebaut. Wer stattdessen `value.buffer` allein nähme,
 * lieferte bei einem Vorschaubild den halben Pool aus, also fremden Speicher.
 * Kopiert wird dabei nichts, es entsteht nur ein zweiter Blick.
 *
 * Der Zeichenketten-Zweig ist der Fallback, falls ein Treiber die Textform
 * "\x2a3f…" durchreicht, statt sie selbst zu lesen. Heute tut das keiner von
 * beiden; der Zweig kostet nichts und macht die Spalte gegen einen
 * Treiberwechsel unempfindlich.
 *
 * `Uint8Array<ArrayBuffer>` statt einfach `Uint8Array` ist keine Ziererei,
 * sondern die Bedingung dafür, dass `new Response(page.image)` im Route
 * Handler ohne Umtypen durchgeht: `BodyInit` verlangt seit TypeScript 5.7 ein
 * `ArrayBufferView<ArrayBuffer>`, und das voreingestellte `Uint8Array` ist
 * `Uint8Array<ArrayBufferLike>` — der wird abgelehnt, ein Node-Buffer
 * ebenfalls.
 *
 * `toDriver` gibt den Wert unverändert weiter: beide Treiber erkennen ein
 * Uint8Array von selbst als `bytea`. Ein blanker ArrayBuffer wird dagegen von
 * keinem der beiden erkannt und liefe als Text in die Spalte — deshalb geht
 * hier ein View hinein und nie ein Puffer.
 */
const bytea = customType<{
  data: Uint8Array<ArrayBuffer>;
  driverData: Uint8Array | string;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    if (typeof value === "string") {
      const hex = value.startsWith("\\x") ? value.slice(2) : value;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }

    return new Uint8Array(
      value.buffer as ArrayBuffer,
      value.byteOffset,
      value.byteLength,
    );
  },
});

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

/**
 * Ein Thema eines Fachs — das Vokabular, aus dem Klausuren und später die
 * Arbeitsblätter schöpfen.
 *
 * Das ist bewusst etwas anderes als `exam_topics`. Dort steht ein **Posten**:
 * dieses Thema, in dieser Klausur, an dieser Stelle — mit Reihenfolge, und mit
 * den Lernblöcken daran. Hier steht ein **Verzeichnis**: dieses Thema gibt es
 * in diesem Fach. Ein Verzeichnis darf umbenannt und zusammengelegt werden,
 * ohne dass irgendwo Geschichte verloren geht; ein Posten nicht.
 *
 * `matchKey` ist die einzige Spalte, über die verglichen wird — die
 * Inhaltswörter des Titels, gefaltet und sortiert (siehe src/lib/topics.ts).
 * Der eindeutige Schlüssel darüber macht „pro Fach nur einmal dasselbe Thema"
 * zu einer Zusage der Datenbank statt zu einer Hoffnung.
 *
 * `mergedInto` zeigt auf das Thema, in das dieses zusammengelegt wurde. Die
 * Zeile bleibt dabei stehen und behält ihren Schlüssel — dadurch löst dieselbe
 * Schreibweise beim nächsten Mal von selbst auf das Ziel auf. Trennen heißt:
 * die Spalte wieder leeren. Deshalb ein Zeiger und kein Umschreiben.
 */
export const subjectTopics = pgTable(
  "subject_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    /** Die Anzeigeform, z.B. "Kettenregel" — das Einzige, was auf dem Bildschirm steht */
    title: text("title").notNull(),
    /** Nur zum Vergleichen, nie zur Anzeige. Nie leer. */
    matchKey: text("match_key").notNull(),
    /** klausur | manuell | blatt — woher das Thema zuerst kam */
    origin: text("origin").notNull().default("klausur"),
    /** Zusammengelegt in dieses Thema; leer heißt eigenständig */
    mergedInto: uuid("merged_into").references(
      (): AnyPgColumn => subjectTopics.id,
      { onDelete: "set null" },
    ),
    /** Kalendertag, an dem das Thema zuletzt vorkam — sortiert die Vorschläge */
    lastSeenAt: date("last_seen_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("subject_topics_key").on(t.subjectId, t.matchKey),
    index("subject_topics_subject_idx").on(t.subjectId, t.lastSeenAt),
  ],
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
    /**
     * Das Fach-Thema, aus dem dieses Klausurthema stammt. Leer ist erlaubt und
     * völlig normal: alte Einträge haben keins, und eine von Hand getippte
     * Sonderformulierung bekommt keins aufgezwungen.
     *
     * "set null" ist hier kein Detail, sondern der Grund für den ganzen
     * Zuschnitt: an diesem Klausurthema hängen über study_blocks.topic_id die
     * erledigten Lernblöcke. Ein Thema aus dem Verzeichnis zu löschen darf sie
     * unter keinen Umständen mitnehmen.
     */
    subjectTopicId: uuid("subject_topic_id").references(
      () => subjectTopics.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    index("exam_topics_exam_idx").on(t.examId),
    index("exam_topics_subject_topic_idx").on(t.subjectTopicId),
  ],
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

/**
 * Ein abfotografiertes Blatt: das Arbeitsblatt aus dem Unterricht, die
 * Mitschrift, die Kopie mit den Aufgaben.
 *
 * Ein Blatt gehört zu genau einem Fach — ohne Fach wäre es ein Foto in der
 * Galerie und nichts, was die App wiederfindet. Themen kommen beliebig viele
 * dazu, aber keins muss.
 *
 * `capturedOn` ist ein reines Kalenderdatum als Zeichenkette ("2026-09-14"),
 * dieselbe Entscheidung wie bei Prüfungen, Hausaufgaben und Noten: ein Blatt
 * wird an einem Schultag ausgeteilt, nicht zu einer Uhrzeit in einer Zeitzone.
 * Es ist ausdrücklich nicht der Zeitpunkt der Aufnahme — wer am Abend
 * nachfotografiert, was er morgens bekommen hat, kann den Tag richtigstellen.
 * `createdAt` hält daneben fest, wann die App das Blatt bekommen hat; das ist
 * eine andere Frage und deshalb eine andere Spalte.
 *
 * Es gibt bewusst keine Spalte für die Art des Blattes. Das Konzept nennt
 * keine, und jede Spalte muss sich begründen lassen — "Arbeitsblatt oder
 * Mitschrift?" ist eine Frage, die im Unterricht Zeit kostet und keine
 * Antwort trägt, nach der später jemand sucht.
 */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    /** Wie das Blatt in der Ablage heißt, z.B. "Kettenregel Übungen" */
    title: text("title").notNull(),
    /** Der Schultag, an dem es ausgeteilt wurde */
    capturedOn: date("captured_on", { mode: "string" }).notNull(),
    note: text("note"),
    /**
     * Wann das Blatt durchgesehen wurde. Leer heißt: es liegt noch im
     * Eingangskorb.
     *
     * Ein Zeitpunkt und kein Ja/Nein, aus demselben Grund wie bei den
     * Hausaufgaben: ein Häkchen kann mit dem Rest der Zeile in Widerspruch
     * geraten, ein Zeitpunkt nicht. Und die Frage "seit wann liegt das da?",
     * die ein Eingangskorb beantworten muss, steht damit ohne eine zweite
     * Spalte in der Zeile.
     *
     * Gesetzt wird die Spalte an drei Stellen, und alle drei heißen dasselbe —
     * ein Mensch hat hingesehen: beim Abhaken im Eingangskorb, beim Speichern
     * des Blattformulars und beim Übernehmen eines Vorschlags. Zurückgenommen
     * wird sie über "wieder in den Eingangskorb"; gelöscht wird dabei nichts,
     * die Spalte geht nur wieder auf leer.
     *
     * Ausdrücklich NICHT gesetzt wird sie beim Aufnehmen. Ein frisch
     * ausgelöstes Foto heißt "Blatt vom 21.8." und trägt kein Thema — genau
     * das ist der Zustand, für den der Korb da ist.
     */
    filedAt: timestamp("filed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("materials_user_captured_idx").on(t.userId, t.capturedOn),
    index("materials_subject_idx").on(t.subjectId),
    // Die Startseite fragt bei jedem Aufruf von "/" nach den sechs zuletzt
    // aufgenommenen Blättern — `where user_id = ? order by created_at desc
    // limit 6`. Ohne diesen Index liest Postgres dafür alle Blätter des
    // Nutzers und sortiert sie, für sechs Zeilen. Der Index über
    // (user_id, captured_on) trägt das nicht: er sortiert nach dem Schultag,
    // und das ist ausdrücklich eine andere Spalte als der Zeitpunkt der
    // Aufnahme.
    index("materials_user_created_idx").on(t.userId, t.createdAt),
    // Der Eingangskorb fragt `where user_id = ? and filed_at is null` und
    // sortiert nach dem Zeitpunkt der Aufnahme. Ohne diesen Index liest
    // Postgres dafür alle Blätter des Nutzers — und der Korb ist die Liste,
    // die nach jeder Aufnahme neu geladen wird. Die Spalte steht hinten und
    // nicht vorne: gefiltert wird auf einen einzigen Wert (leer), sortiert
    // wird nach der Aufnahme.
    index("materials_user_filed_idx").on(t.userId, t.filedAt, t.createdAt),
  ],
);

/**
 * Eine Seite eines Blattes — das Foto selbst.
 *
 * **Die Bytes liegen in der Datenbank und nicht in einem Speicherdienst.** Ein
 * Ort, ein Backup: `npm run db:backup` nimmt die Fotos mit, ohne davon zu
 * wissen. Kein zusätzlicher Dienst, kein Token, keine Adresse, die abläuft —
 * und lokal auf PGlite läuft derselbe Code wie in der Cloud auf Postgres. Das
 * ist auch die Zusage, die in der Seitenspalte steht: alle Daten liegen auf
 * deinem eigenen Server. Ein Blatt wiegt nach dem Verkleinern im Browser rund
 * 200 bis 300 KB; ein Schuljahr voller Blätter bleibt damit im
 * zweistelligen Megabyte-Bereich und ist für eine Datenbank nichts.
 *
 * **`image` und `thumb` stehen getrennt da, und das ist der Grund für die
 * zweite Spalte:** die Ablage zeigt bis zu zweihundert Vorschauen auf einmal —
 * `LIST_LIMIT` in @/lib/materials, und jede geholte Zeile bekommt ihre Kachel.
 * Als Vorschauen zu je rund 15 KB sind das rund 3 MB. Mit nur einer Spalte
 * müsste dieselbe Seite zweihundert Vollbilder zu je rund 250 KB laden und im
 * Browser herunterrechnen: rund 50 MB für Bilder, die 320 Pixel breit
 * angezeigt werden. Gemessen: fünfzehn Vorschaubilder zu lesen dauert 9 ms,
 * ein einziges Vollbild 14 ms. Daraus folgt die Regel für jede Abfrage in
 * @/lib/materials: für Listen niemals `image` mitselektieren.
 *
 * **Seit dem Web MCP steht eine dritte Spalte daneben, `reading`.** Dieselbe
 * Begründung, nur für einen anderen Leser: der Agent bekommt ein Bild als
 * Base64 in ein Tool-Ergebnis, und das ist in der Claude-App bei rund 150 000
 * Zeichen zu Ende. Warum daraus eine gespeicherte Spalte wird und keine
 * Rechnung beim Ausliefern, steht an der Spalte selbst.
 *
 * `width` und `height` sind die des Vollbildes und stehen dabei, damit die
 * Seite den Platz reservieren kann, bevor das Bild da ist — sonst springt die
 * ganze Ablage beim Laden.
 *
 * "cascade" ist hier die richtige Wahl, anders als bei den Klausurthemen. An
 * einem Foto hängt keine Geschichte: kein Lernblock, keine Note, kein
 * abgehakter Termin. Wer das Blatt löscht, meint das Foto mit — es allein
 * stehen zu lassen ergäbe eine Seite ohne Blatt, die niemand mehr zuordnen
 * kann.
 */
export const materialPages = pgTable(
  "material_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /** Reihenfolge innerhalb des Blattes, beginnend bei 0 */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Das Format — für Vollbild UND Vorschau. Eine Spalte für beide Blobs, weil
     * beide aus demselben Canvas fallen und deshalb nie auseinandergehen
     * können. Wer diese Zeile über einen anderen Weg als das Formular befüllt,
     * muss das einhalten: unter zwei Formaten läge `/api/material/<id>/vorschau`
     * über seine eigenen Bytes, und weil dort `nosniff` steht, weigert sich der
     * Browser zu raten und zeigt ein kaputtes Bild. Geprüft wird es an der Tür,
     * in `readPage()` in src/app/(app)/material/actions.ts.
     */
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    /** Maße des Vollbildes, nicht der Vorschau */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Größe des Vollbildes in Bytes, für die ehrliche Anzeige "248 KB" */
    byteSize: integer("byte_size").notNull(),
    /** Das Blatt, lange Kante 1600px */
    image: bytea("image").notNull(),
    /**
     * Dasselbe Blatt, lange Kante 1000px — die Fassung für den Agenten.
     *
     * Sie steht hier, weil ein Tool-Ergebnis in der Claude-App bei rund
     * 150 000 Zeichen endet und ein Bild dort als Base64 reist: das Vollbild
     * wiegt umgerechnet rund 340 000 Zeichen und käme nie an, die Vorschau
     * käme an und wäre unlesbar. Die dritte Spalte ist der einzige Weg, auf dem
     * „lies dieses Blatt" beides sein kann — lesbar und klein genug.
     *
     * Gerechnet wird sie im Browser aus demselben Bitmap wie die anderen
     * beiden, mit einer Qualitätsleiter, die auf rund 100 KB zielt
     * (`READING_QUALITIES` in @/lib/images). Genau deshalb braucht der Server
     * auch für sie keine Bildbibliothek.
     */
    reading: bytea("reading").notNull(),
    /** Dasselbe Blatt, lange Kante 320px — für Listen */
    thumb: bytea("thumb").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("material_pages_material_idx").on(t.materialId, t.sortOrder)],
);

/**
 * Welche Themen auf einem Blatt stehen.
 *
 * Der Verweis geht auf `subject_topics`, also auf das Vokabular des Fachs, und
 * ausdrücklich nicht auf freien Text. Freier Text hieße: "Kettenregel" auf dem
 * einen Blatt und "kettenregel " auf dem nächsten sind zwei Themen, und die
 * Frage "was habe ich zur Kettenregel?" findet die Hälfte. Über das Vokabular
 * ist es ein Eintrag, der sich umbenennen und zusammenlegen lässt — und
 * dieselben Themen, aus denen auch die Klausuren schöpfen. Genau dafür wurde
 * `subject_topics` in Stufe 1 gebaut.
 *
 * Der zusammengesetzte Primärschlüssel ist die ganze Zeile: dieses Thema, auf
 * diesem Blatt, einmal. Es gibt hier nichts weiter festzuhalten — keine
 * Reihenfolge, kein Datum, keinen Zustand. Deshalb trägt die Zeile auch keine
 * Geschichte, und deshalb dürfen beide Fremdschlüssel "cascade" tragen: fällt
 * das Blatt oder das Thema weg, ist die Paarung sinnlos und nicht etwa
 * verloren.
 */
export const materialTopics = pgTable(
  "material_topics",
  {
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    subjectTopicId: uuid("subject_topic_id")
      .notNull()
      .references(() => subjectTopics.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({
      name: "material_topics_pk",
      columns: [t.materialId, t.subjectTopicId],
    }),
    index("material_topics_topic_idx").on(t.subjectTopicId),
  ],
);

/**
 * Ein Vorschlag zu einem Blatt — der Eingangskorb.
 *
 * **Der Bestand wird nur durch die Bestätigung geschrieben, nie direkt.** Ein
 * Vorschlag steht neben dem Blatt und nicht darin; er ändert nichts, bis ein
 * Mensch ihn übernimmt, und dann geht er durch dieselbe Tür wie ein Formular
 * (`materialInputSchema`, `updateMaterial()`, `setMaterialTopics()`). Das ist
 * keine Vorsichtsmaßnahme, sondern die Bedingung des ganzen KI-Anschlusses:
 * wer nicht vertrauenswürdige Blätter liest und gleichzeitig schreiben darf,
 * ist über das Blatt selbst angreifbar.
 *
 * **Jede Spalte ist optional, und das ist die Aussage der Tabelle:** ein
 * Vorschlag schlägt vor, was er weiß, und schweigt über den Rest. Wer nur
 * Themen erkennt, muss keinen Titel erfinden. Leer heißt an jeder Spalte
 * dasselbe — "dazu sage ich nichts, es bleibt, wie es am Blatt steht"; was
 * daraus im Formular wird, entscheidet `prefillFromProposal()` in
 * @/lib/inbox, an einer Stelle und nicht an vier.
 *
 * `origin` hält fest, woher der Vorschlag kam: "manuell" von Hand über die
 * Oberfläche, "agent" von einem Agenten. Die Spalte ist keine Statistik. Ein
 * Vorschlag vom Agenten ist aus dem Inhalt eines Blattes abgeleitet, also aus
 * etwas, das die App nicht geschrieben hat; einer von Hand nicht. Auf dem
 * Bildschirm steht deshalb, welcher von beiden gerade vor einem liegt — das
 * ist der ganze Zweck. Nebenbei hält sie den Weg offen, auf dem die App später
 * selbst ein Modell fragt: dieser Weg wäre bloß ein weiterer Schreiber auf
 * diese Tabelle, und der Korb müsste sich dafür nicht ändern.
 *
 * **Es gibt keinen Zustand "übernommen" oder "verworfen".** Eine Zeile in
 * dieser Tabelle ist ein offener Vorschlag, sonst nichts — entschieden heißt
 * hier: die Zeile ist weg. Ein Vorschlag ist ein Entwurf eines Formulars und
 * kein Vorgang; was aus ihm wurde, steht danach am Blatt, und das Blatt ist
 * die Sache, die Geschichte trägt. Mit einem Zustand müsste jede Abfrage des
 * Korbs danach filtern, und die Tabelle liefe mit toten Entwürfen voll, die
 * niemand mehr liest. Wer wissen will, was der Agent gesagt hat, sieht es beim
 * Übernehmen: das Formular steht ausgefüllt da, Feld für Feld.
 *
 * Keine `userId` an der Zeile — sie hängt am Blatt, so wie bei
 * `material_pages` und `material_topics`. Jede Abfrage hier verbindet deshalb
 * über `materials` und filtert dort nach dem Nutzer; der Grund steht im Kopf
 * von @/lib/materials.
 */
export const materialProposals = pgTable(
  "material_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /** manuell | agent — wer den Vorschlag geschrieben hat */
    origin: text("origin").notNull().default("manuell"),
    /**
     * Das vorgeschlagene Fach. Leer heißt: das Fach des Blattes bleibt.
     *
     * "set null" und nicht "cascade", anders als am Blatt. Ein gelöschtes Fach
     * nimmt sein Blatt mit, und mit dem Blatt geht auch der Vorschlag — das ist
     * der häufige Fall und über `materialId` schon geregelt. Diese Spalte
     * betrifft den seltenen anderen: der Vorschlag will das Blatt in ein
     * ANDERES Fach schieben, und genau dieses andere wird gelöscht. Dann
     * fällt der Fachvorschlag weg und der Rest der Zeile — Titel, Tag, Notiz,
     * Themen — bleibt stehen. "cascade" nähme hier einen brauchbaren Vorschlag
     * mit, weil ein Fach verschwand, das mit dem Blatt nie etwas zu tun hatte.
     */
    subjectId: uuid("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    /** Der vorgeschlagene Titel. Leer heißt: der Titel des Blattes bleibt. */
    title: text("title"),
    /** Der vorgeschlagene Schultag. Leer heißt: der Tag des Blattes bleibt. */
    capturedOn: date("captured_on", { mode: "string" }),
    /** Die vorgeschlagene Notiz. Leer heißt: die Notiz des Blattes bleibt. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("material_proposals_material_idx").on(t.materialId, t.createdAt)],
);

/**
 * Ein vorgeschlagenes Thema — freier Text, kein Verweis ins Vokabular.
 *
 * Das ist der eine Punkt, an dem diese Tabelle von `material_topics` abweicht,
 * und er ist beabsichtigt. Am Blatt steht ein Verweis auf `subject_topics`,
 * damit "Kettenregel" und "kettenregel " dasselbe Thema sind. Ein Vorschlag
 * kann aber ein Thema nennen, das es im Vokabular noch gar nicht gibt — das
 * ist der Normalfall, wenn ein Agent ein Blatt liest. Müsste er dafür eine
 * Vokabel anlegen, schriebe er in den Bestand, und zwar bevor irgendjemand
 * zugestimmt hat.
 *
 * Aus dem Text wird eine Vokabel erst beim Übernehmen, über
 * `setMaterialTopics()` und `ensureTopics()` — dieselbe Tür wie beim Tippen im
 * Formular, mit derselben Prüfung auf ein Fachwort und derselben Faltung
 * gleichbedeutender Schreibweisen. Was dabei durchfällt, sagt das Formular.
 *
 * `sortOrder`, damit die Chips in der Reihenfolge stehen, in der sie
 * vorgeschlagen wurden. Bei Themen ist das keine Kosmetik: die ersten sind die
 * naheliegenden.
 */
export const materialProposalTopics = pgTable(
  "material_proposal_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => materialProposals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("material_proposal_topics_proposal_idx").on(t.proposalId, t.sortOrder),
  ],
);

/**
 * Ein Programm, das sich für den Zugriff auf die App angemeldet hat — heute
 * genau eins: Claude.
 *
 * **Diese Zeile entsteht, bevor irgendjemand zugestimmt hat.** So ist OAuth
 * gebaut: ein Client meldet sich zuerst an (Dynamic Client Registration, RFC
 * 7591) und schickt den Nutzer erst danach zur Zustimmung. Die Anmeldung
 * verlangt deshalb kein Passwort und kann von jedem im Netz aufgerufen werden;
 * sie darf entsprechend auch nichts können. Eine Zeile hier ist ein Name, eine
 * Rückadresse und sonst nichts — kein Zugriff, kein Nutzer, kein Recht. Erst
 * eine Zeile in `oauth_grants` bedeutet, dass ein Mensch ja gesagt hat.
 *
 * Deshalb hängt hier auch **keine `userId`**: zum Zeitpunkt der Anmeldung gibt
 * es keinen Nutzer, der gefragt worden wäre. Wem ein Client etwas darf, steht
 * eine Tabelle weiter.
 *
 * **`redirectUris` ist eine Zeichenkette mit Leerzeichen dazwischen**, keine
 * eigene Tabelle und kein Array. Eine Adresse enthält nie ein Leerzeichen, die
 * Liste ist immer kurz (Claude nennt eine, Claude Code zwei), und sie wird nur
 * als Ganzes gelesen und als Ganzes verglichen. Eine Kindtabelle wäre ein
 * Verzeichnis für zwei Zeilen, die nie einzeln jemanden interessieren.
 *
 * Gegen ein `client_secret` hat sich das hier entschieden: Claude läuft als
 * öffentlicher Client, das Geheimnis läge also in fremder Hand und schützte
 * nichts. Was den Tausch von Code gegen Token absichert, ist PKCE — der
 * Prüfwert, den nur derjenige kennt, der die Anmeldung angestoßen hat.
 */
export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Wie der Client sich nennt, z.B. "Claude". Steht auf der Zustimmungsseite. */
  name: text("name").notNull(),
  /** Erlaubte Rückadressen, durch Leerzeichen getrennt. Verglichen wird Zeichen für Zeichen. */
  redirectUris: text("redirect_uris").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Ein Zustimmungs-Code: die Quittung dafür, dass ein Mensch gerade „erlauben"
 * gedrückt hat, gültig für eine Minute und für genau einen Tausch.
 *
 * **Gespeichert wird nur der Abdruck (`codeHash`), nie der Code selbst.** Der
 * Code reist durch den Browser des Nutzers und steht dabei in einer Adresszeile
 * — in der Chronik, womöglich in einem Serverlog. Wer später die Datenbank
 * liest, soll damit nichts anfangen können; verglichen wird deshalb der
 * SHA-256-Abdruck. Dasselbe gilt eine Tabelle weiter für die Token. Anders als
 * das Sitzungs-Token in `sessions`, das im eigenen httpOnly-Cookie liegt und
 * dieses Gerät nie verlässt, gehen diese Zeichenketten durch fremde Hände.
 *
 * **`redeemedAt` ist ein Zeitpunkt und kein Häkchen**, aus demselben Grund wie
 * `materials.filedAt`. Er trägt hier zusätzlich die Einmaligkeit: eingelöst
 * wird mit `update … where redeemed_at is null`, und die Datenbank entscheidet,
 * wer von zwei gleichzeitigen Versuchen gewinnt. Gelöscht wird die Zeile beim
 * Einlösen ausdrücklich nicht — ein zweiter Versuch mit demselben Code ist der
 * Verdachtsfall, den OAuth 2.1 kennt (ein abgefangener Code), und den kann nur
 * beantworten, wer die Zeile noch hat.
 *
 * `codeChallenge` ist der PKCE-Prüfwert. Er steht an der Zeile und nicht am
 * Client, weil er zu diesem einen Tausch gehört: wer den Code hat, kommt damit
 * nur weiter, wenn er auch das Geheimnis kennt, aus dem dieser Wert gerechnet
 * wurde. Nur S256 wird angenommen; `plain` wäre ein Prüfwert, der sich aus dem
 * Prüfwert ergibt.
 *
 * `resource` ist die Adresse, für die das spätere Token gelten soll (RFC 8707).
 * Sie steht schon hier, damit das Token nicht später eine andere bekommen kann
 * als die, die dem Nutzer auf der Zustimmungsseite genannt wurde.
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 des Codes, hex. Nie der Code selbst. */
    codeHash: text("code_hash").notNull(),
    /** Die Rückadresse dieses Tausches — beim Einlösen muss dieselbe dastehen. */
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE, base64url des SHA-256 über den code_verifier des Clients. */
    codeChallenge: text("code_challenge").notNull(),
    /** Rechte, durch Leerzeichen getrennt. Heute immer "mcp". */
    scope: text("scope").notNull().default(""),
    /** Für welche Adresse das Token gelten wird, z.B. "https://…/api/mcp". */
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Wann eingelöst; leer heißt: noch offen. Ein zweites Einlösen gibt es nicht. */
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("oauth_codes_hash_key").on(t.codeHash),
    // Abgelaufene Codes werden beim nächsten Einlösen mit weggeräumt; dafür
    // wird nach dem Zeitpunkt gesucht und nicht nach dem Abdruck.
    index("oauth_codes_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Was ein Client für einen Nutzer wirklich in der Hand hat: die Verbindung.
 *
 * Eine Zeile ist eine erteilte Erlaubnis, und sie trägt beide Schlüssel dazu —
 * das kurzlebige Zugriffs-Token und das langlebige Erneuerungs-Token. Zwei
 * Tabellen wären genauer im Sinne des Lehrbuchs und hier eine Trennung ohne
 * Unterschied: die beiden entstehen zusammen, laufen zusammen ab und werden
 * zusammen zurückgezogen.
 *
 * **Erneuern schreibt dieselbe Zeile um.** OAuth 2.1 verlangt für öffentliche
 * Clients, dass ein Erneuerungs-Token nach Gebrauch nicht mehr gilt; genau das
 * tut ein `update` auf beide Abdrücke. Ein abgefangenes altes Token passt danach
 * auf keine Zeile mehr und bekommt „invalid_grant" — der Client fragt dann neu
 * nach Zustimmung, und der Mensch sieht es.
 *
 * Kein `lastUsedAt`: es stünde für eine Schreiboperation bei jedem einzelnen
 * Tool-Aufruf, also für viele Schreibvorgänge auf eine Zeile, die niemand
 * liest. Die Einstellungsseite zeigt stattdessen, seit wann die Verbindung
 * steht — das ist die Frage, die man an eine Verbindung wirklich hat.
 *
 * `revokedAt` ist wieder ein Zeitpunkt statt eines Ja/Nein; leer heißt gültig.
 * Getrennt wird eine Verbindung über die Einstellungen, und dieselbe Spalte
 * beantwortet danach die Frage, seit wann sie getrennt ist.
 */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 des Zugriffs-Tokens, hex. */
    accessTokenHash: text("access_token_hash").notNull(),
    /** SHA-256 des Erneuerungs-Tokens, hex. */
    refreshTokenHash: text("refresh_token_hash").notNull(),
    /**
     * Der Abdruck des VORIGEN Erneuerungs-Tokens — die Falle für ein
     * gestohlenes.
     *
     * Beim Erneuern wird das alte Token ungültig; wer es danach noch einmal
     * vorzeigt, hat entweder eine Antwort verloren oder das Token gestohlen.
     * Ohne diese Spalte wären beide Fälle von „kenne ich nicht" nicht zu
     * unterscheiden, und ein Dieb, der als Erster erneuert, behielte seine
     * Kette für immer. Mit ihr fällt die ganze Verbindung, sobald ein
     * verbrauchtes Token wiederkommt — beide Seiten müssen dann neu fragen,
     * und der Mensch sieht es.
     *
     * Leer bei einer frisch erteilten Verbindung: davor gab es kein voriges.
     */
    previousRefreshTokenHash: text("previous_refresh_token_hash"),
    /** Rechte, durch Leerzeichen getrennt. Heute immer "mcp". */
    scope: text("scope").notNull().default(""),
    /** Für welche Adresse das Token gilt — geprüft bei jeder Anfrage. */
    resource: text("resource").notNull(),
    /** Wann das Zugriffs-Token abläuft. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Wann das Erneuerungs-Token abläuft; danach ist die Verbindung zu Ende. */
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    /** Wann getrennt; leer heißt: die Verbindung steht. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("oauth_grants_access_key").on(t.accessTokenHash),
    unique("oauth_grants_refresh_key").on(t.refreshTokenHash),
    // Die Einstellungsseite listet die Verbindungen eines Nutzers, die neueste
    // zuerst.
    index("oauth_grants_user_idx").on(t.userId, t.createdAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  oauthGrants: many(oauthGrants),
  subjects: many(subjects),
  exams: many(exams),
  periods: many(periods),
  lessons: many(lessons),
  homework: many(homework),
  grades: many(grades),
  subjectTopics: many(subjectTopics),
  materials: many(materials),
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
  topics: many(subjectTopics),
  materials: many(materials),
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
  subjectTopic: one(subjectTopics, {
    fields: [examTopics.subjectTopicId],
    references: [subjectTopics.id],
  }),
  blocks: many(studyBlocks),
}));

export const subjectTopicsRelations = relations(
  subjectTopics,
  ({ one, many }) => ({
    user: one(users, { fields: [subjectTopics.userId], references: [users.id] }),
    subject: one(subjects, {
      fields: [subjectTopics.subjectId],
      references: [subjects.id],
    }),
    examTopics: many(examTopics),
    materialTopics: many(materialTopics),
  }),
);

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

export const materialsRelations = relations(materials, ({ one, many }) => ({
  user: one(users, { fields: [materials.userId], references: [users.id] }),
  subject: one(subjects, {
    fields: [materials.subjectId],
    references: [subjects.id],
  }),
  pages: many(materialPages),
  topics: many(materialTopics),
  proposals: many(materialProposals),
}));

export const materialPagesRelations = relations(materialPages, ({ one }) => ({
  material: one(materials, {
    fields: [materialPages.materialId],
    references: [materials.id],
  }),
}));

export const materialTopicsRelations = relations(materialTopics, ({ one }) => ({
  material: one(materials, {
    fields: [materialTopics.materialId],
    references: [materials.id],
  }),
  subjectTopic: one(subjectTopics, {
    fields: [materialTopics.subjectTopicId],
    references: [subjectTopics.id],
  }),
}));

export const materialProposalsRelations = relations(
  materialProposals,
  ({ one, many }) => ({
    material: one(materials, {
      fields: [materialProposals.materialId],
      references: [materials.id],
    }),
    subject: one(subjects, {
      fields: [materialProposals.subjectId],
      references: [subjects.id],
    }),
    topics: many(materialProposalTopics),
  }),
);

export const materialProposalTopicsRelations = relations(
  materialProposalTopics,
  ({ one }) => ({
    proposal: one(materialProposals, {
      fields: [materialProposalTopics.proposalId],
      references: [materialProposals.id],
    }),
  }),
);

export const oauthClientsRelations = relations(oauthClients, ({ many }) => ({
  codes: many(oauthCodes),
  grants: many(oauthGrants),
}));

export const oauthCodesRelations = relations(oauthCodes, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthCodes.clientId],
    references: [oauthClients.id],
  }),
  user: one(users, { fields: [oauthCodes.userId], references: [users.id] }),
}));

export const oauthGrantsRelations = relations(oauthGrants, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthGrants.clientId],
    references: [oauthClients.id],
  }),
  user: one(users, { fields: [oauthGrants.userId], references: [users.id] }),
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
export type SubjectTopic = typeof subjectTopics.$inferSelect;
export type NewSubjectTopic = typeof subjectTopics.$inferInsert;
export type Grade = typeof grades.$inferSelect;
export type NewGrade = typeof grades.$inferInsert;
export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;
export type MaterialPage = typeof materialPages.$inferSelect;
export type NewMaterialPage = typeof materialPages.$inferInsert;
export type MaterialTopic = typeof materialTopics.$inferSelect;
export type MaterialProposal = typeof materialProposals.$inferSelect;
export type NewMaterialProposal = typeof materialProposals.$inferInsert;
export type MaterialProposalTopic = typeof materialProposalTopics.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type OauthClient = typeof oauthClients.$inferSelect;
export type NewOauthClient = typeof oauthClients.$inferInsert;
export type OauthCode = typeof oauthCodes.$inferSelect;
export type NewOauthCode = typeof oauthCodes.$inferInsert;
export type OauthGrant = typeof oauthGrants.$inferSelect;
export type NewOauthGrant = typeof oauthGrants.$inferInsert;

/** Art einer Prüfung */
export type ExamKind = "klausur" | "test" | "referat" | "muendlich";
/** Art eines Lernblocks */
export type StudyBlockKind = "learn" | "review";
/** Zustand eines Lernblocks */
export type StudyBlockStatus = "open" | "done" | "skipped";

/**
 * Wer einen Vorschlag geschrieben hat.
 *
 * "manuell" heißt: über die Oberfläche, von Hand. "agent" heißt: aus dem
 * Inhalt eines Blattes abgeleitet — also aus etwas, das die App nicht
 * geschrieben hat. Warum dieser Unterschied auf dem Bildschirm steht, sagt der
 * Kommentar an `materialProposals`.
 */
export type ProposalOrigin = "manuell" | "agent";

/**
 * Art einer Note. Schriftlich und mündlich sind die beiden Töpfe, aus denen
 * sich der Fachschnitt zusammensetzt — wie stark jeder wiegt, steht am Fach.
 */
export type GradeKind = "schriftlich" | "muendlich";

/**
 * Woher ein Fach-Thema zuerst kam. Alle drei Werte kommen vor: "klausur" aus
 * den Themen einer eingetragenen Prüfung, "manuell" aus der Themenpflege und
 * "blatt" von einem abfotografierten Blatt — geschrieben beim Aufnehmen in
 * `setMaterialTopics()` in @/lib/materials.
 */
export type TopicOrigin = "klausur" | "manuell" | "blatt";

/** Wochentag im Stundenplan: 1 = Montag … 5 = Freitag */
export type Weekday = 1 | 2 | 3 | 4 | 5;
