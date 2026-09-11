-- Der Abrufkern, Stufe 0: Baustein, Termin, Antwort.
--
-- Drei Tabellen für einen Terminplaner, der Fragen aus dem eigenen Heft in
-- festem Takt wieder vorlegt und nach jedem Versuch die Lösung zeigt. Die
-- Begründung jeder einzelnen Spalte steht am Schema (src/recall/schema.ts);
-- hier steht nur, was beim Einspielen zu wissen ist.
--
-- Rein additiv: drei neue Tabellen, neun Fremdschlüssel, acht Indizes und die
-- ersten zwei CHECK-Bedingungen dieses Projekts. Keine bestehende Tabelle wird
-- angefasst, keine Spalte umgeschrieben.
--
-- Die Namen sind Zeichen für Zeichen die, die drizzle-kit selbst vergäbe: die
-- Anweisungen unten sind aus `drizzle-kit generate` über beide Schema-Dateien
-- herausgeschnitten und nicht von Hand getippt. Dadurch sieht ein späteres
-- `db:push` keinen Unterschied und will nichts nachziehen.
--
-- ── Der Unterschied zu den fünf Wanderungen davor ────────────────────────────
--
-- Zu dieser gehört ein Rückbau: scripts/abruf-rueckbau.sql. Die fünf anderen
-- sagen im Kopf ausdrücklich "Kein DROP", und das ist richtig für Tabellen, die
-- bleiben. Diese hier müssen sich bewähren — der Bericht, aus dem sie stammen,
-- beziffert ihren Zusatznutzen gegenüber einem gut geführten Epochenheft selbst
-- mit g = 0,095 bei p = 0,062. Wer ohne Rückweg baut, kann nicht abbrechen.
--
-- ── Warum zwei CHECK-Bedingungen ─────────────────────────────────────────────
--
-- `misconception` ist der Satz zur Verwechslung — Teil drei der Rückmeldung,
-- und der Unterschied zwischen d = 0,46 und d = 0,99. `NOT NULL` allein nimmt
-- den leeren String an; dann zählte die Abnahmezahl "100 Prozent der Aufgaben
-- mit dreiteiliger Rückmeldung" leere Erklärungen mit. Dasselbe gilt für die
-- Musterlösung. Eine Kennzahl, die sich selbst grün rechnet, ist schlimmer als
-- gar keine.
--
-- ── ⚠ WIE SIE WIRKLICH IN DIE LAUFENDE DATENBANK KOMMT ───────────────────────
--
-- Gegen die lokale Datei-Datenbank:
--
--   npx tsx scripts/sql-einspielen.ts scripts/abruf-tabellen.sql
--
-- **Das trifft NICHT die Produktivdatenbank.** `DATABASE_URL` steht nur in
-- `.env.local`, und diese Datei liest allein Next — weder `node` noch `tsx`
-- noch drizzle-kits eigenes dotenv kennen sie. Der ausführliche Hergang steht
-- im Kopf von scripts/abschrift-tabellen.sql; er gilt hier unverändert.
--
-- Auf dem NAS geht sie so hinein, in einer einzigen Transaktion:
--
--   sudo docker compose exec -T db psql -v ON_ERROR_STOP=1 --single-transaction \
--        -U schulapp -d schulapp < scripts/abruf-tabellen.sql

CREATE TABLE "recall_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid,
	"subject_id" uuid NOT NULL,
	"subject_topic_id" uuid,
	"prompt_free" text NOT NULL,
	"prompt_cue" text,
	"prompt_cloze" text,
	"solution" text NOT NULL,
	"misconception" text NOT NULL,
	"source_quote" text NOT NULL,
	"source_length" integer NOT NULL,
	"material_kind" text DEFAULT 'begriff' NOT NULL,
	"role" text DEFAULT 'uebung' NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recall_items_misconception_not_blank" CHECK (length(btrim("recall_items"."misconception")) > 0),
	CONSTRAINT "recall_items_solution_not_blank" CHECK (length(btrim("recall_items"."solution")) > 0)
);
CREATE TABLE "recall_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"mode" text DEFAULT 'klausur' NOT NULL,
	"done_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "recall_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid,
	"schedule_id" uuid,
	"source_page_id" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_on" date NOT NULL,
	"gap_days" integer NOT NULL,
	"level" text DEFAULT 'frei' NOT NULL,
	"role" text DEFAULT 'uebung' NOT NULL,
	"answer_text" text NOT NULL,
	"correct" boolean NOT NULL,
	"self_confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "recall_attempts" ADD CONSTRAINT "recall_attempts_item_id_recall_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."recall_items"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_page_id_material_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."material_pages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_subject_topic_id_subject_topics_id_fk" FOREIGN KEY ("subject_topic_id") REFERENCES "public"."subject_topics"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "recall_schedule" ADD CONSTRAINT "recall_schedule_item_id_recall_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."recall_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_attempts" ADD CONSTRAINT "recall_attempts_schedule_id_recall_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."recall_schedule"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "recall_attempts" ADD CONSTRAINT "recall_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_attempts" ADD CONSTRAINT "recall_attempts_source_page_id_material_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."material_pages"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "recall_items_user_idx" ON "recall_items" USING btree ("user_id");
CREATE INDEX "recall_items_subject_idx" ON "recall_items" USING btree ("subject_id");
CREATE INDEX "recall_items_page_idx" ON "recall_items" USING btree ("page_id");
CREATE INDEX "recall_schedule_item_idx" ON "recall_schedule" USING btree ("item_id");
CREATE INDEX "recall_schedule_due_idx" ON "recall_schedule" USING btree ("due_on");
CREATE INDEX "recall_attempts_user_idx" ON "recall_attempts" USING btree ("user_id");
CREATE INDEX "recall_attempts_item_idx" ON "recall_attempts" USING btree ("item_id");
CREATE INDEX "recall_attempts_answered_idx" ON "recall_attempts" USING btree ("answered_on");
