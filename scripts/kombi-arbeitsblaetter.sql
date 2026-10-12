-- Arbeitsblätter für Modell 23 (Plan 3.6, Zusatz Arbeitsblätter): zwei
-- Tabellen und eine Spalte `arbeitsblatt_id` an `leser_laeufe`.
--
-- Rein additiv. Die CHECKs von `leser_laeufe` für die neue Lauf-Art
-- 'arbeitsblatt' stehen NICHT hier, sondern in
-- scripts/kombi-arbeitsblaetter-checks.sql — es ist die einzige nicht
-- additive Anweisung dieses Baus und wird NACH dieser Datei eingespielt
-- (sie braucht die Spalte `arbeitsblatt_id`).
--
-- Die Anweisungen sind aus `drizzle-kit generate` kopiert, nicht getippt:
-- in einen Ordner außerhalb des Repos, mit dem Stand vor der Änderung
-- (src/test/schema-basis/) als Basis und danach Schritt für Schritt über
-- src/db/schema.ts. Die Namen der Fremdschlüssel, CHECKs und Indizes sind
-- damit die, die drizzle-kit selbst vergibt; ein späteres `db:push` oder
-- `generate` sieht keinen Unterschied (geprüft in
-- src/test/kombi-sql.db.test.ts).
--
-- ── Wie sie in die Datenbank kommt ──────────────────────────────────────────
--
-- Lokal (Entwicklungsserver AUS, vorher `npm run db:backup`):
--
--   npx tsx scripts/sql-einspielen.ts scripts/kombi-arbeitsblaetter.sql
--
-- Auf dem NAS — erst nach der Abnahme von Abschnitt H (Plan 5.7), in der
-- Reihenfolge tagesprotokoll, lernblock-uhr, suche, themen-art,
-- arbeitsblaetter, arbeitsblaetter-checks; ZUERST einspielen, DANN bauen:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/kombi-arbeitsblaetter.sql
--
-- ── Vorher zählen (ändert nichts) ───────────────────────────────────────────
--
--   SELECT count(*) AS laeufe FROM leser_laeufe;
--   SELECT to_regclass('arbeitsblaetter');     -- vorher leer (NULL)
--
-- Danach: dieselbe Zahl Läufe, alle mit `arbeitsblatt_id IS NULL`; die beiden
-- neuen Tabellen sind leer. Gleich danach kombi-arbeitsblaetter-checks.sql.
--
-- Danach nachsehen: \d arbeitsblaetter

CREATE TABLE "arbeitsblaetter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_topic_id" uuid,
	"study_block_id" uuid,
	"tag" date NOT NULL,
	"status" text DEFAULT 'wartet' NOT NULL,
	"frist_bis" timestamp with time zone,
	"versuche" integer DEFAULT 0 NOT NULL,
	"inhalt" jsonb,
	"erzeugt_am" timestamp with time zone,
	"gedruckt_am" timestamp with time zone,
	"ausgewertet_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arbeitsblaetter_status_check" CHECK ("arbeitsblaetter"."status" in ('wartet', 'laeuft', 'fertig', 'fehlgeschlagen')),
	CONSTRAINT "arbeitsblaetter_ziel_check" CHECK ("arbeitsblaetter"."subject_topic_id" is not null or "arbeitsblaetter"."study_block_id" is not null)
);
CREATE TABLE "arbeitsblatt_wertung" (
	"arbeitsblatt_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"richtig" boolean NOT NULL,
	CONSTRAINT "arbeitsblatt_wertung_arbeitsblatt_id_nr_pk" PRIMARY KEY("arbeitsblatt_id","nr")
);
ALTER TABLE "leser_laeufe" ADD COLUMN "arbeitsblatt_id" uuid;
ALTER TABLE "arbeitsblaetter" ADD CONSTRAINT "arbeitsblaetter_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "arbeitsblaetter" ADD CONSTRAINT "arbeitsblaetter_subject_topic_id_subject_topics_id_fk" FOREIGN KEY ("subject_topic_id") REFERENCES "public"."subject_topics"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "arbeitsblaetter" ADD CONSTRAINT "arbeitsblaetter_study_block_id_study_blocks_id_fk" FOREIGN KEY ("study_block_id") REFERENCES "public"."study_blocks"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "arbeitsblatt_wertung" ADD CONSTRAINT "arbeitsblatt_wertung_arbeitsblatt_id_arbeitsblaetter_id_fk" FOREIGN KEY ("arbeitsblatt_id") REFERENCES "public"."arbeitsblaetter"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "arbeitsblaetter_thema_tag_idx" ON "arbeitsblaetter" USING btree ("user_id","subject_topic_id","tag") WHERE "arbeitsblaetter"."subject_topic_id" is not null;
CREATE UNIQUE INDEX "arbeitsblaetter_block_idx" ON "arbeitsblaetter" USING btree ("user_id","study_block_id") WHERE "arbeitsblaetter"."study_block_id" is not null;
ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_arbeitsblatt_id_arbeitsblaetter_id_fk" FOREIGN KEY ("arbeitsblatt_id") REFERENCES "public"."arbeitsblaetter"("id") ON DELETE set null ON UPDATE no action;
