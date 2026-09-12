import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  exams,
  materialPages,
  subjectTopics,
  subjects,
  users,
} from "@/db/schema";

/**
 * Der Abrufkern: Fragen aus dem eigenen Heft, in festem Takt wieder vorgelegt.
 *
 * ── Warum diese Tabellen hier stehen und nicht in src/db/schema.ts ───────────
 *
 * Das README nennt src/db/schema.ts einen Vertrag: „Änderungen hier betreffen
 * alles". Genau deshalb steht der Abrufkern daneben und nicht darin. Er ist
 * eine Wette — der Bericht, aus dem er stammt, beziffert seinen Zusatznutzen
 * gegenüber einem gut geführten Epochenheft selbst mit g = 0,095 bei p = 0,062,
 * also nicht signifikant, und der Schüler, für den er gebaut wird, führt genau
 * dieses Heft. Eine Wette gehört nicht in den Vertrag.
 *
 * Praktisch heißt das: `recall_`-Präfix, eigene Datei, eigene Wanderung
 * (scripts/abruf-tabellen.sql) und — das ist der Teil, den dieses Repo bisher
 * nie hatte — ein geschriebener Rückbau (scripts/abruf-rueckbau.sql). Es gibt
 * hier fünf Wanderungsdateien und null DROP; jede sagt im Kopf ausdrücklich
 * „Kein DROP". Das ist richtig für Tabellen, die bleiben, und falsch für
 * Tabellen, die sich bewähren müssen. Wer ohne Rückweg baut, kann nicht
 * abbrechen, und wer nicht abbrechen kann, hat keine Wette abgeschlossen,
 * sondern eine Anschaffung gemacht.
 *
 * ── Drei Tabellen, nicht sechs ───────────────────────────────────────────────
 *
 * Das ist Stufe 0 und ausdrücklich weniger, als der Bericht für Stufe 1
 * verlangt. Der Grund steht in seinem eigenen Abschnitt 3: die gesamte belegte
 * Wirkung stammt aus zwei Zeilen — verteiltes Abrufen (g = 0,74) und
 * Rückmeldung nach jedem Versuch (0,73 gegen 0,39 ohne). Baustein, Termin und
 * Antwort tragen beide. Alles Weitere (Sinneinheiten einzeln, Kalibrierung,
 * Mischen, getrennter Messvorrat) steigert eine Wirkung, die erst einmal
 * eintreten muss.
 *
 * Was trotzdem schon hier steht, obwohl es erst später gebraucht wird, steht
 * aus einem einzigen Grund da: A11 verlangt, dass das Antwortprotokoll die
 * Epochenlücke überdauert, und eine Spalte, die später dazukommt, hat für die
 * erste Lücke keine Daten. Eine leere Spalte kostet nichts; ein fehlender
 * Monat Messung ist nicht nachholbar.
 */

/**
 * Ein Baustein: eine Frage, ihre Musterlösung, der Satz zum Fehler — und die
 * Stelle im Heft, aus der alle drei stammen.
 *
 * ── Die Quellbindung ist der ganze Sinn ──────────────────────────────────────
 *
 * A5 des Berichts verlangt, dass jede Aufgabe aus Epochenheft, Tafelbild oder
 * Arbeitsblatt stammt und ihre Quellstelle mitführt; der Grund ist gemessen:
 * maschinell erzeugte Fragen erreichen eine Trennschärfe von 0,28 — unter dem
 * Zielwert 0,3 — bei drei dokumentierten Halluzinationstypen. Deshalb ist
 * `sourceQuote` nicht Zierrat, sondern Bedingung: `createItem()` weist einen
 * Baustein ab, dessen Zitat nicht wörtlich in der Abschrift der Seite steht,
 * und ebenso einen, dessen Zitat ⟨spitze Klammern⟩ enthält. Die Klammern
 * markieren, was schon beim Abschreiben unsicher war (siehe
 * @/lib/transcripts) — eine Frage darauf zu bauen hieße, eine Vermutung als
 * Prüfstoff auszuliefern.
 *
 * `pageId` ist `set null` und nicht `cascade`: Wird ein Blatt gelöscht, ist die
 * Frage verwaist, aber die Antworten darauf bleiben eine gemessene Tatsache.
 * Dieselbe Asymmetrie wie bei `exam_topics.subject_topic_id`, und aus demselben
 * Grund — die Begründung steht ausgeschrieben an src/db/schema.ts.
 */
export const recallItems = pgTable(
  "recall_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Die Heftseite, aus der die Frage stammt. Leer erst, wenn das Blatt
     * gelöscht wurde — beim Anlegen ist sie Pflicht (A5 wird in `items.ts`
     * geprüft, nicht hier: eine Datenbank kann „steht wörtlich in der
     * Abschrift" nicht ausdrücken).
     */
    pageId: uuid("page_id").references(() => materialPages.id, {
      onDelete: "set null",
    }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    /** Das Thema aus dem Vokabular des Fachs, wenn das Blatt eines nennt */
    subjectTopicId: uuid("subject_topic_id").references(
      () => subjectTopics.id,
      { onDelete: "set null" },
    ),

    /**
     * Die Frage im freien Format — das Standardformat (A1).
     *
     * Nicht Multiple Choice, und das ist keine Vorliebe: gewählte Distraktoren
     * tauchen später als eigene Antworten auf offene Fragen wieder auf (5 → 12
     * Prozent, bei anspruchsvollerem Material 7 → 16), und für leistungs-
     * schwächere Oberstufenschüler sind Netto-Kosten gemessen. Dazu kommt die
     * Formatgleichheit mit der Klausur (0,531 gegen 0,399), und eine Klausur
     * hat keine Auswahlliste.
     */
    promptFree: text("prompt_free").notNull(),
    /**
     * Dieselbe Frage mit Hinweisreiz, und dieselbe als Lückentext — die zwei
     * Stufen nach unten aus A9.
     *
     * Beide dürfen fehlen. Fehlen sie, kann die Frage nicht heruntergestuft
     * werden, und das ist eine bewusste Schwäche von Stufe 0: A9 verlangt, dass
     * unter 50 Prozent Trefferquote eine leichtere Stufe kommt, weil der
     * Testeffekt dort auf g = 0,03 zusammenfällt. Solange die Felder leer sind,
     * bleibt nur die Lösung — die aber in jedem Fall (A2).
     */
    promptCue: text("prompt_cue"),
    promptCloze: text("prompt_cloze"),

    /**
     * Die Musterlösung, eine Sinneinheit je Zeile.
     *
     * In Stufe 1 wird daraus eine eigene Tabelle, weil A4 den Abgleich je
     * Sinneinheit verlangt und nicht als Ganzes: in als richtig eingestuften
     * Antworten fanden die Dozentinnen nur 77 bis 80 Prozent der Sinneinheiten
     * wieder. Bis dahin steht sie hier als Text — aber schon zerlegt, Zeile für
     * Zeile. Der Unterschied ist der Preis des Umzugs: aus vorstrukturiertem
     * Text wird eine Wanderung, aus einem Fließtext-Absatz wäre es ein Abend am
     * Formular.
     */
    solution: text("solution").notNull(),
    /**
     * Ein bis zwei Sätze dazu, womit man das hier verwechselt — Teil drei der
     * Rückmeldung (A3).
     *
     * Dieser Satz ist der Unterschied zwischen d = 0,46 und d = 0,99. Er ist
     * deshalb `NOT NULL` **und** durch eine Bedingung gegen den leeren String
     * geschützt: Ohne sie zählte die Abnahmezahl „100 Prozent der Aufgaben mit
     * dreiteiliger Rückmeldung" leere Erklärungen mit, und eine Kennzahl, die
     * sich selbst grün rechnet, ist schlimmer als keine. Es ist die erste
     * CHECK-Bedingung dieses Projekts; der Grund, sie hier einzuführen, ist das
     * ausdrückliche „100 Prozent" aus Abschnitt 8 des Berichts.
     */
    misconception: text("misconception").notNull(),

    /** Der Wortlaut aus der Abschrift, auf den sich die Frage stützt (A5) */
    sourceQuote: text("source_quote").notNull(),
    /**
     * Die Länge der Abschrift zum Zeitpunkt des Anlegens — der Driftmelder.
     *
     * Eine Abschrift ist nicht endgültig: `setMaterialTranscripts()`
     * überschreibt sie bei jeder Vorschlagsübernahme, und das ist der
     * Normalfall und nicht der Ausnahmefall. Ändert sie sich, kann das Zitat
     * ins Leere zeigen. Die Länge erkennt das billig; sie erkennt allerdings
     * NICHT den Austausch gegen eine gleich lange Fassung — dasselbe hält der
     * Kommentar an `transcriptBaseline()` fest. Für Stufe 0 ist das genug, in
     * Stufe 1 kommt eine Prüfsumme daneben.
     */
    sourceLength: integer("source_length").notNull(),

    /**
     * Wovon die Frage handelt — begriff | anschauung | verfahren | ereignis.
     *
     * Steht ab Tag eins hier, obwohl Mischen und Blocken (A10) erst Stufe 2
     * sind. Der Grund ist der Preis des Nachrüstens: A10 ordnet ausdrücklich
     * über den Materialtyp zu, und die Spalte später zu ergänzen hieße, jeden
     * bestehenden Baustein von Hand einzustufen — also genau die Erfassungs-
     * arbeit, die der Bericht als Engpass des ganzen Vorhabens markiert.
     *
     * Die Werte sind nicht beliebig: Gemischt wird nur Verwechselbares.
     * Anschauungsklassen gewinnen dabei bis 0,67, Begriff-Definition-Paare
     * verlieren mit -0,39 — Mischen ist dort also schädlich, nicht bloß
     * wirkungslos.
     */
    materialKind: text("material_kind").notNull().default("begriff"),
    /**
     * uebung | messung — beim Anlegen reserviert, nie nachträglich (A12).
     *
     * Der Fortschritt wird zweifach gemessen: app-interne Trefferquote und eine
     * Schätzung aus Fragen, die nie gezeigt wurden. Die zweite Menge muss beim
     * Erzeugen abgezweigt werden, nicht hinterher ausgewählt — sonst ist sie
     * keine unabhängige Messung, sondern eine Auswahl aus Geübtem. Ein Baustein
     * mit `role = "messung"` bekommt niemals einen Termin; das ist eine
     * Eigenschaft der Planungsrechnung und wird dort geprüft.
     */
    role: text("role").notNull().default("uebung"),

    /**
     * Zurückgezogen — der Meldeknopf „stand so nicht im Heft" (A5).
     *
     * Kein Löschen: Die Antworten auf eine falsche Frage sind selbst ein
     * Messwert, und Abschnitt 8 macht die Zahl dieser Meldungen zu einem
     * Abnahmekriterium. Ein zurückgezogener Baustein bekommt keine neuen
     * Termine mehr, seine alten Antworten bleiben stehen.
     */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredReason: text("retired_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recall_items_user_idx").on(t.userId),
    index("recall_items_subject_idx").on(t.subjectId),
    index("recall_items_page_idx").on(t.pageId),
    check(
      "recall_items_misconception_not_blank",
      sql`length(btrim(${t.misconception})) > 0`,
    ),
    check(
      "recall_items_solution_not_blank",
      sql`length(btrim(${t.solution})) > 0`,
    ),
  ],
);

/**
 * Wann ein Baustein wieder drankommt.
 *
 * ── Warum hier kein `status` mit „übersprungen" steht ────────────────────────
 *
 * `study_blocks` hat `open | done | skipped`, und es wäre naheliegend gewesen,
 * dieses Vokabular zu übernehmen — es ist schließlich das Hausvokabular. Es ist
 * hier trotzdem falsch. A16 erlaubt ausdrücklich, Zeit und neue Bausteine zu
 * deckeln, und verbietet ebenso ausdrücklich, fällige Wiederholungen zu
 * deckeln: die Zahl der Abrufgelegenheiten IST die belegte Stellgröße (1× 0,444
 * · 2× 0,601 · 3+ 0,642 · unbegrenzt 0,762, kein Plateau). Ein Termin, den man
 * wegdrücken kann, ist eine Abrufgelegenheit, die man wegdrücken kann.
 *
 * Deshalb gibt es nur `doneAt`. Ein überfälliger Termin bleibt einfach offen
 * (`due_on <= heute and done_at is null`) und steht am nächsten Abend vorne.
 * Er verschwindet nicht, er wartet.
 *
 * ── Warum kein Wiederholungsalgorithmus dahinter steht ───────────────────────
 *
 * Weil es der robusteste Nullbefund der ganzen Sammlung ist: expandierende
 * gegen feste Abstände g = 0,034 [-0,10; 0,17], I² = 0 Prozent, kein
 * Publikationsbias — bei vier oder weniger Begegnungen je Baustein sogar -0,04.
 * Dazu der Kaltstart: fünfzehn Epochenabende liefern nicht die paar hundert
 * Wiederholungen, aus denen ein adaptives Verfahren etwas lernen könnte. Die
 * Anforderung an diese Tabelle lautet: termintreu, umschaltbar, langweilig.
 */
export const recallSchedule = pgTable(
  "recall_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => recallItems.id, { onDelete: "cascade" }),
    /**
     * Ein Kalendertag, keine Uhrzeit — und zwar als Zeichenkette.
     *
     * Beides ist Hausregel. Der Server läuft in UTC; ein Datum als Zeitstempel
     * wäre um 23 Uhr Berliner Zeit schon der Folgetag. Und eine Uhrzeit gibt es
     * nicht, weil dieses Projekt sich dagegen entschieden hat: Sobald ein
     * Lernblock einen Beginn trägt, muss die App ihn gegen Schulstunden und
     * Hausaufgaben auflösen, und sie wird zum Tagesplaner. Der Bericht sieht
     * dafür ein Abendfenster von 17:00 bis 19:30 vor (P9) — das ist die eine
     * Stelle, an der ihm hier bewusst nicht gefolgt wird. „Heute fällig"
     * genügt.
     */
    dueOn: date("due_on", { mode: "string" }).notNull(),
    /** Die wievielte Begegnung mit diesem Baustein, von 1 an */
    round: integer("round").notNull().default(1),
    /**
     * klausur | erhaltung — die zwei Betriebsarten aus A8.
     *
     * Der Umschaltpunkt ist der Tag nach der Klausur und wird vom hinterlegten
     * Termin ausgelöst, nicht vom Nutzer gewählt: Das Optimum hängt am
     * Behaltensziel und nicht am Gefühl (1 / 11 / 21 / 21 Tage bei Prüfabstand
     * 7 / 35 / 70 / 350). Vor der Klausur wird verdichtet, danach gestreckt.
     * Ein Kalenderkriterium, kein Lerndatenkriterium — was ein Lerndaten-
     * kriterium wäre, verbietet der Nullbefund oben.
     */
    mode: text("mode").notNull().default("klausur"),
    /** Gesetzt, sobald der Baustein an diesem Termin einmal richtig abgerufen wurde */
    doneAt: timestamp("done_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recall_schedule_item_idx").on(t.itemId),
    index("recall_schedule_due_idx").on(t.dueOn),
  ],
);

/**
 * Was tatsächlich geantwortet wurde — das Protokoll, das die Epochenlücke
 * überdauern muss (A11).
 *
 * ── Warum hier `set null` steht, wo überall sonst `cascade` steht ────────────
 *
 * Das ist die wichtigste Entscheidung dieser Datei und die einzige, die sich
 * später nicht mehr heilen lässt. Dieses Protokoll ist die einzige Datenlage,
 * die je beantworten kann, ob das Ganze gewirkt hat: Die Erfolgsmessung beruht
 * auf dem zeitlichen Abstand (unter einem Tag 0,41 gegen 0,69 darüber), und die
 * Abnahmekriterien verlangen Prüfpunkte nach drei und sechs Monaten gegen die
 * Zerfallskurve ohne Wiederbegegnung.
 *
 * Stünde hier `cascade`, löschte das Zurückziehen einer falschen Frage — oder
 * ein Aufräumen, oder der Abbruch des ganzen Vorhabens — genau die Zahlen, an
 * denen zu erkennen wäre, ob der Abbruch richtig war. Deshalb `set null`, und
 * deshalb steht alles Tragende zusätzlich in der Zeile selbst: `gapDays`,
 * `level`, `role` und die Herkunft der Frage. Eine Antwort muss ohne ihren
 * Baustein lesbar bleiben.
 */
export const recallAttempts = pgTable(
  "recall_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Leer, sobald der Baustein entfernt wurde — die Antwort bleibt */
    itemId: uuid("item_id").references(() => recallItems.id, {
      onDelete: "set null",
    }),
    scheduleId: uuid("schedule_id").references(() => recallSchedule.id, {
      onDelete: "set null",
    }),
    /** Die Itemherkunft, mitgeschrieben statt nachgeschlagen (A11) */
    sourcePageId: uuid("source_page_id").references(() => materialPages.id, {
      onDelete: "set null",
    }),

    answeredAt: timestamp("answered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Derselbe Zeitpunkt als Berliner Kalendertag — sonst zählt 23 Uhr zum Folgetag */
    answeredOn: date("answered_on", { mode: "string" }).notNull(),
    /**
     * Tage seit der letzten Begegnung mit diesem Baustein.
     *
     * Wird beim Schreiben ausgerechnet und nicht bei der Auswertung:
     * nachträglich ist der Abstand nicht mehr rekonstruierbar, sobald ein
     * Baustein entfernt wurde — und genau dann wird er gebraucht.
     */
    gapDays: integer("gap_days").notNull(),
    /** frei | hinweis | luecke — auf welcher Formatstufe gefragt wurde (A9) */
    level: text("level").notNull().default("frei"),
    /** uebung | messung, mitgeschrieben, damit die Trennung auch ohne Baustein gilt */
    role: text("role").notNull().default("uebung"),

    /** Was der Schüler geschrieben hat, wörtlich */
    answerText: text("answer_text").notNull(),
    /**
     * Ob es als richtig gewertet wurde.
     *
     * In Stufe 0 urteilt der Schüler selbst — aber erst, NACHDEM er
     * geschrieben und abgeschickt hat (N11: keine Selbstbewertung ohne
     * vorherige Eingabe, kein kostenloser Lösungsknopf; Scheinlernen betraf 33
     * Prozent der Schüler). In Stufe 1 tritt der Abgleich je Sinneinheit
     * daneben, weil Selbsturteile 20 bis 23 Prozent der Sinneinheiten
     * übersehen.
     */
    correct: boolean("correct").notNull(),
    /**
     * Das Sicherheitsurteil, 0 bis 100 — noch nicht erhoben.
     *
     * A13 ist Stufe 2, die Spalte steht trotzdem schon hier: Sie wird verzögert
     * und nur mit dem Stichwort abgefragt, nie bei sichtbarer Lösung, weil
     * sofortige Urteile um 32,3 und verzögerte nur um 12,0 Prozentpunkte
     * überschätzen. Eine Spalte, die erst später dazukommt, hat für die erste
     * Epochenlücke keine Daten — und die erste Lücke ist die, über die nichts
     * bekannt ist.
     */
    selfConfidence: integer("self_confidence"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recall_attempts_user_idx").on(t.userId),
    index("recall_attempts_item_idx").on(t.itemId),
    index("recall_attempts_answered_idx").on(t.answeredOn),
  ],
);

/**
 * Ein Vorschlag: was ein Agent an Fragen gebaut hat, bevor ein Mensch es
 * übernimmt.
 *
 * ── Warum es diese Zwischenstufe gibt ────────────────────────────────────────
 *
 * Weil die KI nicht in den Bestand schreiben darf, und das ist keine
 * Vorsichtsmaßnahme, sondern die Grundlage des ganzen Baus: Maschinell erzeugte
 * Fragen erreichen eine Trennschärfe von 0,28 [0,21; 0,35] — unter dem
 * Zielwert 0,3 — bei drei dokumentierten Halluzinationstypen. Eine erfundene
 * Musterlösung fällt nicht auf, sobald sie als Prüfstoff dasteht.
 *
 * Dasselbe Muster benutzt der Postbote seit dem 5.9.2026 für Abschriften:
 * `material_proposals` liegt im Eingangskorb, und erst das Übernehmen im
 * Formular schreibt in den Bestand. Der Unterschied ist die Prüfbarkeit — eine
 * Abschrift kann man gegen das Foto halten, eine Musterlösung nicht. Deshalb
 * ist hier die Quellbindung die Sperre: Jede vorgeschlagene Frage trägt ihr
 * Zitat mit, und beim Übernehmen läuft sie durch `createItem()` wie eine von
 * Hand angelegte. Was die Prüfung nicht besteht, kommt nicht in den Bestand,
 * ganz gleich wer es vorgeschlagen hat.
 *
 * ── Warum der Vorschlag an der Klausur hängt und nicht am Blatt ──────────────
 *
 * Weil man für eine Klausur lernt und nicht für einen Stapel. Der Lauf nimmt
 * die Themen der Klausur, holt darüber die Seiten und baut daraus Fragen; der
 * Vorschlag ist deshalb „die Fragen zu dieser Klausur" und nicht „die Fragen zu
 * diesem Blatt". `exam_id` steht auf `cascade`: Wird die Klausur gelöscht, ist
 * ein Vorschlag für sie gegenstandslos.
 */
export const recallProposals = pgTable(
  "recall_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    /** agent | manuell — woher der Vorschlag kommt */
    origin: text("origin").notNull().default("agent"),
    /**
     * Was der Lauf zu berichten hatte: unsichere Stellen, übersprungene
     * Seiten, Zweifel. Freier Text, vom Menschen zu lesen — nicht auszuwerten.
     */
    note: text("note"),
    /** Gesetzt, sobald ein Mensch den Vorschlag abgearbeitet hat */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recall_proposals_user_idx").on(t.userId, t.createdAt),
    index("recall_proposals_exam_idx").on(t.examId),
  ],
);

/**
 * Eine einzelne vorgeschlagene Frage.
 *
 * Dieselben Felder wie ein Baustein, denn genau das soll sie werden — und
 * dieselbe Pflicht: Frage, Musterlösung, Verwechslungssatz und Zitat. Fehlt
 * eines, ist es keine auslieferbare Aufgabe (A2, A3, A5), und dann hat sie
 * hier auch nichts zu suchen.
 *
 * `pageId` auf `cascade`: Verschwindet die Seite, ist der Vorschlag zu ihr
 * gegenstandslos — anders als beim fertigen Baustein, wo `set null` gilt, weil
 * dort schon Antworten daran hängen können. Ein Vorschlag hat keine
 * Vergangenheit, die zu schützen wäre.
 *
 * `accepted` merkt sich, was schon übernommen wurde. Ohne das würde ein
 * zweites Drücken auf „übernehmen" dieselben Fragen ein zweites Mal in den
 * Bestand legen — und doppelte Bausteine sind schlimmer als keine: Sie
 * verdoppeln die Termine und täuschen die Dosis aus A6 vor.
 */
export const recallProposalItems = pgTable(
  "recall_proposal_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => recallProposals.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => materialPages.id, { onDelete: "cascade" }),
    subjectTopicId: uuid("subject_topic_id").references(
      () => subjectTopics.id,
      { onDelete: "set null" },
    ),
    sortOrder: integer("sort_order").notNull().default(0),

    promptFree: text("prompt_free").notNull(),
    solution: text("solution").notNull(),
    misconception: text("misconception").notNull(),
    sourceQuote: text("source_quote").notNull(),
    materialKind: text("material_kind").notNull().default("begriff"),

    /** Gesetzt beim Übernehmen — verhindert, dass dieselbe Frage zweimal landet */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Der Baustein, der daraus geworden ist */
    itemId: uuid("item_id").references(() => recallItems.id, {
      onDelete: "set null",
    }),
    /**
     * Warum diese Frage NICHT übernommen wurde — vom Menschen abgewählt oder
     * von der Quellbindung abgewiesen. Der zweite Fall ist der wichtigere: Er
     * ist das Maß dafür, wie zuverlässig der Agent arbeitet, und ohne
     * Aufschreiben wäre er nach dem Übernehmen verschwunden.
     */
    rejectedReason: text("rejected_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recall_proposal_items_proposal_idx").on(t.proposalId, t.sortOrder),
    index("recall_proposal_items_page_idx").on(t.pageId),
    check(
      "recall_proposal_items_misconception_not_blank",
      sql`length(btrim(${t.misconception})) > 0`,
    ),
    check(
      "recall_proposal_items_solution_not_blank",
      sql`length(btrim(${t.solution})) > 0`,
    ),
  ],
);
