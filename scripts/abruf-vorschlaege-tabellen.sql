-- Die Vorschläge des Agenten: Fragen, bevor ein Mensch sie übernimmt.
--
-- Zwei neue Tabellen, rein additiv. Keine bestehende wird angefasst.
--
-- Die Namen sind Zeichen für Zeichen die, die drizzle-kit selbst vergäbe: die
-- Anweisungen unten sind aus `drizzle-kit generate` herausgeschnitten und nicht
-- von Hand getippt. Dadurch sieht ein späteres `db:push` keinen Unterschied.
--
-- ── Warum es diese Zwischenstufe gibt ────────────────────────────────────────
--
-- Weil die KI nicht in den Bestand schreiben darf. Maschinell erzeugte Fragen
-- erreichen eine Trennschärfe von 0,28 bei drei dokumentierten
-- Halluzinationstypen; eine erfundene Musterlösung fällt nicht auf, sobald sie
-- als Prüfstoff dasteht. Der Vorschlag liegt deshalb hier, und erst das
-- Übernehmen schickt jede Frage durch dieselbe Quellbindungsprüfung wie eine
-- von Hand angelegte. Dasselbe Muster benutzt der Postbote für Abschriften.
--
-- ── ⚠ WIE SIE IN DIE LAUFENDE DATENBANK KOMMT ────────────────────────────────
--
-- Gegen die lokale Datei-Datenbank (Entwicklungsserver muss AUS sein, zwei
-- PGlite-Instanzen auf denselben Dateien zerstören sie):
--
--   npx tsx scripts/sql-einspielen.ts scripts/abruf-vorschlaege-tabellen.sql
--
-- Auf dem NAS, in einer Transaktion, mit Abbruch beim ersten Fehler:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/abruf-vorschlaege-tabellen.sql
--
-- Der Rückbau steht in scripts/abruf-rueckbau.sql und räumt beide mit ab.

CREATE TABLE "recall_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"origin" text DEFAULT 'agent' NOT NULL,
	"note" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "recall_proposal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"subject_topic_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"prompt_free" text NOT NULL,
	"solution" text NOT NULL,
	"misconception" text NOT NULL,
	"source_quote" text NOT NULL,
	"material_kind" text DEFAULT 'begriff' NOT NULL,
	"accepted_at" timestamp with time zone,
	"item_id" uuid,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recall_proposal_items_misconception_not_blank" CHECK (length(btrim("recall_proposal_items"."misconception")) > 0),
	CONSTRAINT "recall_proposal_items_solution_not_blank" CHECK (length(btrim("recall_proposal_items"."solution")) > 0)
);
ALTER TABLE "recall_proposal_items" ADD CONSTRAINT "recall_proposal_items_proposal_id_recall_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."recall_proposals"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_proposals" ADD CONSTRAINT "recall_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_proposals" ADD CONSTRAINT "recall_proposals_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_proposal_items" ADD CONSTRAINT "recall_proposal_items_page_id_material_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."material_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "recall_proposal_items" ADD CONSTRAINT "recall_proposal_items_subject_topic_id_subject_topics_id_fk" FOREIGN KEY ("subject_topic_id") REFERENCES "public"."subject_topics"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "recall_proposal_items" ADD CONSTRAINT "recall_proposal_items_item_id_recall_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."recall_items"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "recall_proposals_user_idx" ON "recall_proposals" USING btree ("user_id","created_at");
CREATE INDEX "recall_proposals_exam_idx" ON "recall_proposals" USING btree ("exam_id");
CREATE INDEX "recall_proposal_items_proposal_idx" ON "recall_proposal_items" USING btree ("proposal_id","sort_order");
CREATE INDEX "recall_proposal_items_page_idx" ON "recall_proposal_items" USING btree ("page_id");
