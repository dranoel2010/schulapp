-- Die drei Tabellen für Phase 5, Stufe 2: Blätter, ihre Seiten und ihre Themen.
--
-- Rein additiv: nur CREATE TABLE, die Fremdschlüssel der neuen Tabellen und
-- CREATE INDEX. Kein DROP, kein ALTER an einer bestehenden Tabelle.
--
-- Die Namen sind genau die, die drizzle-kit selbst vergäbe: dieses SQL ist aus
-- `generateMigration()` über src/db/schema.ts erzeugt. Dadurch sieht ein
-- späteres `npm run db:push` keinen Unterschied und will nichts nachziehen. Wer
-- einen Namen ändert (etwa material_topics_pkey statt material_topics_pk),
-- handelt sich beim nächsten Push eine neu gebaute Constraint ein.
--
-- Dass die Datei mit dem Schema Zeichen für Zeichen übereinstimmt, ist keine
-- Behauptung: die Probe unter zusammenbau/probe.mts erzeugt das SQL neu und
-- vergleicht, und prüft danach die eingespielten Tabellen zusätzlich gegen den
-- Katalog von Postgres — Spalte für Spalte, Index für Index, Fremdschlüssel für
-- Fremdschlüssel.
--
-- Dass "bytea" in Anführungszeichen steht, sieht falsch aus und ist keiner:
-- drizzle-kit setzt jeden Typ in Anführungszeichen, der nicht auf seiner Liste
-- der Postgres-Grundtypen steht. Postgres nimmt es an, und beim Vergleich
-- schneidet die Introspektion die Anführungszeichen selbst wieder ab. Nicht
-- "reparieren".

CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text NOT NULL,
	"captured_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "material_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"image" "bytea" NOT NULL,
	"thumb" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "material_topics" (
	"material_id" uuid NOT NULL,
	"subject_topic_id" uuid NOT NULL,
	CONSTRAINT "material_topics_pk" PRIMARY KEY("material_id","subject_topic_id")
);

ALTER TABLE "materials" ADD CONSTRAINT "materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "materials" ADD CONSTRAINT "materials_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "material_pages" ADD CONSTRAINT "material_pages_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "material_topics" ADD CONSTRAINT "material_topics_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "material_topics" ADD CONSTRAINT "material_topics_subject_topic_id_subject_topics_id_fk" FOREIGN KEY ("subject_topic_id") REFERENCES "public"."subject_topics"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "materials_user_captured_idx" ON "materials" USING btree ("user_id","captured_on");
CREATE INDEX "materials_subject_idx" ON "materials" USING btree ("subject_id");
CREATE INDEX "materials_user_created_idx" ON "materials" USING btree ("user_id","created_at");
CREATE INDEX "material_pages_material_idx" ON "material_pages" USING btree ("material_id","sort_order");
CREATE INDEX "material_topics_topic_idx" ON "material_topics" USING btree ("subject_topic_id");
