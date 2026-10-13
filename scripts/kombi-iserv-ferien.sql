-- Ferien aus IServ (12.10.2026): zwei Spalten, ein Index und ein CHECK an
-- `free_periods`.
--
-- Rein additiv. Bestehende Zeilen bekommen `quelle = NULL` und
-- `iserv_key = NULL` — „von Hand eingetragen“, genau das, was sie heute sind.
-- Der Ferienabgleich (src/lib/iserv/ferien.ts) fasst NUR Zeilen mit
-- `quelle = 'iserv'` an; eine von Hand eingetragene Zeile ändert oder löscht
-- er nie. `iserv_key` ist der stabile Schlüssel aus IServ (uid des Termins
-- bzw. id im Plugin „holiday“), über den er dieselben Ferien wiederfindet.
--
-- Die Anweisungen sind aus `drizzle-kit generate` kopiert, nicht getippt
-- (generateMigration zwischen dem Schema von modell-23 und src/db/schema.ts).
-- Die Namen von Index und CHECK sind damit die, die drizzle-kit selbst
-- vergibt; ein späteres `db:push` oder `generate` sieht keinen Unterschied
-- (geprüft in src/test/kombi-sql.db.test.ts).
--
-- ── Wie sie in die Datenbank kommt ──────────────────────────────────────────
--
-- Lokal (Entwicklungsserver AUS, vorher `npm run db:backup`):
--
--   npx tsx scripts/sql-einspielen.ts scripts/kombi-iserv-ferien.sql
--
-- Auf dem NAS — als siebte nach tagesprotokoll, lernblock-uhr, suche,
-- themen-art, arbeitsblaetter, arbeitsblaetter-checks; ZUERST einspielen,
-- DANN bauen (ohne die Spalten scheitert jeder Abruf bei IServ und jede
-- Seite, die freie Tage liest):
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/kombi-iserv-ferien.sql
--
-- ── Vorher zählen (ändert nichts) ───────────────────────────────────────────
--
--   SELECT count(*) AS freie_zeitraeume FROM free_periods;
--
-- Danach: dieselbe Zahl; `SELECT count(*) FROM free_periods WHERE quelle IS
-- NOT NULL OR iserv_key IS NOT NULL` gibt 0. Erst der nächste Abruf bei IServ
-- (stündlicher Kalender-Cron, höchstens alle drei Stunden) legt Zeilen mit
-- `quelle = 'iserv'` an.
--
-- Danach nachsehen: \d free_periods

ALTER TABLE "free_periods" ADD COLUMN "quelle" text;
ALTER TABLE "free_periods" ADD COLUMN "iserv_key" text;
CREATE UNIQUE INDEX "free_periods_iserv_key_idx" ON "free_periods" USING btree ("user_id","iserv_key");
ALTER TABLE "free_periods" ADD CONSTRAINT "free_periods_quelle_check" CHECK (("free_periods"."quelle" is null and "free_periods"."iserv_key" is null) or ("free_periods"."quelle" = 'iserv' and "free_periods"."iserv_key" is not null));
