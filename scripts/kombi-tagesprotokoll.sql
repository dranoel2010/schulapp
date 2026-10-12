-- Das Tagesprotokoll für Modell 23 (Plan 3.3): eine Tabelle, ein
-- Fremdschlüssel, ein Index.
--
-- Rein additiv. Keine bestehende Zeile wird angefasst, keine Spalte entfernt.
--
-- Aus dem Protokoll rechnet der Server die Ansicht der Startseite (Ablauf
-- erledigt oder übersprungen?), den Schritt des Ablaufs und was heute
-- eingetragen wurde. `typ` hat bewusst KEINEN CHECK: die erlaubten Werte
-- prüft `protokollieren()` in src/lib/protokoll.ts; ein neuer Typ bleibt so
-- additiv.
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
--   npx tsx scripts/sql-einspielen.ts scripts/kombi-tagesprotokoll.sql
--
-- Auf dem NAS — erst nach der Abnahme von Abschnitt H (Plan 5.7), in der
-- Reihenfolge tagesprotokoll, lernblock-uhr, suche, themen-art,
-- arbeitsblaetter, arbeitsblaetter-checks; ZUERST einspielen, DANN bauen:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/kombi-tagesprotokoll.sql
--
-- Danach nachsehen: \d tagesprotokoll

CREATE TABLE "tagesprotokoll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tag" date NOT NULL,
	"typ" text NOT NULL,
	"ref" text,
	"daten" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "tagesprotokoll" ADD CONSTRAINT "tagesprotokoll_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "tagesprotokoll_user_tag_idx" ON "tagesprotokoll" USING btree ("user_id","tag");
