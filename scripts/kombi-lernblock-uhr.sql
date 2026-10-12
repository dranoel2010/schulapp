-- Der Uhrstand eines Lernblocks für Modell 23 (Plan 3.5): vier Spalten an
-- `study_blocks`.
--
-- Rein additiv. Bestehende Blöcke bekommen `pause_ms = 0` und sonst leere
-- Spalten, also „nicht angefangen“ — genau das, was sie heute sind.
--
-- `laeuft_seit` ist nur Uhrstand und wird nie als Tageszeit angezeigt:
-- Lernblöcke haben keine Uhrzeit.
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
--   npx tsx scripts/sql-einspielen.ts scripts/kombi-lernblock-uhr.sql
--
-- Auf dem NAS — erst nach der Abnahme von Abschnitt H (Plan 5.7), in der
-- Reihenfolge tagesprotokoll, lernblock-uhr, suche, themen-art,
-- arbeitsblaetter, arbeitsblaetter-checks; ZUERST einspielen, DANN bauen:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/kombi-lernblock-uhr.sql
--
-- Danach nachsehen: \d study_blocks

ALTER TABLE "study_blocks" ADD COLUMN "laeuft_seit" timestamp with time zone;
ALTER TABLE "study_blocks" ADD COLUMN "pausiert_seit" timestamp with time zone;
ALTER TABLE "study_blocks" ADD COLUMN "pause_ms" integer DEFAULT 0 NOT NULL;
ALTER TABLE "study_blocks" ADD COLUMN "minuten_gelernt" integer;
