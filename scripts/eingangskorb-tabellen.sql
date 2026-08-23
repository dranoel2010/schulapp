-- Phase 5, Stufe 3: der Eingangskorb.
--
-- Rein additiv: eine neue Spalte an `materials`, zwei neue Tabellen mit ihren
-- Fremdschlüsseln und drei CREATE INDEX. Kein DROP, kein Umschreiben einer
-- bestehenden Spalte, keine Zeile wird angefasst.
--
-- Warum diese Datei überhaupt existiert, steht im README: `npm run db:push`
-- bricht an einer Rückfrage ab, die ein Fehlalarm ist — es will `lessons`
-- leeren, um den eindeutigen Schlüssel `lessons_user_slot_key` neu anzulegen,
-- den es längst gibt. Die Antwort darauf ist niemals „truncate"; die eigentliche
-- Änderung geht stattdessen hier durch:
--
--   npx tsx scripts/sql-einspielen.ts scripts/eingangskorb-tabellen.sql
--
-- Die Namen sind Zeichen für Zeichen die, die drizzle-kit selbst vergäbe: die
-- Anweisungen unten sind aus `drizzle-kit generate` über src/db/schema.ts
-- kopiert und nicht von Hand getippt. Dadurch sieht ein späteres `db:push`
-- keinen Unterschied und will nichts nachziehen. Wer einen Namen „schöner"
-- macht, handelt sich beim nächsten Push eine zweite, neu gebaute Constraint
-- ein.
--
-- Die neue Spalte `filed_at` ist absichtlich ohne Default und ohne NOT NULL.
-- Leer heißt: das Blatt liegt im Eingangskorb — und genau das ist für jedes
-- Blatt richtig, das es vor dieser Änderung schon gab. Ein Default „jetzt"
-- erklärte einen Altbestand für durchgesehen, den nie jemand angesehen hat;
-- leer sagt die Wahrheit und der Korb füllt sich beim ersten Öffnen mit dem,
-- was wirklich noch offen ist.

ALTER TABLE "materials" ADD COLUMN "filed_at" timestamp with time zone;

CREATE TABLE "material_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"origin" text DEFAULT 'manuell' NOT NULL,
	"subject_id" uuid,
	"title" text,
	"captured_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "material_proposal_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

ALTER TABLE "material_proposals" ADD CONSTRAINT "material_proposals_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "material_proposals" ADD CONSTRAINT "material_proposals_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "material_proposal_topics" ADD CONSTRAINT "material_proposal_topics_proposal_id_material_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."material_proposals"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "material_proposals_material_idx" ON "material_proposals" USING btree ("material_id","created_at");

CREATE INDEX "material_proposal_topics_proposal_idx" ON "material_proposal_topics" USING btree ("proposal_id","sort_order");

CREATE INDEX "materials_user_filed_idx" ON "materials" USING btree ("user_id","filed_at","created_at");
