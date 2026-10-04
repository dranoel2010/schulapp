-- Ferien und Klassenfahrt: eine Tabelle, ein Fremdschlüssel, ein Index.
--
-- Rein additiv. Keine bestehende Zeile wird angefasst, keine Spalte entfernt.
--
-- Die Anweisungen unten sind aus `drizzle-kit generate --name freie-tage`
-- herausgeschnitten und nicht von Hand getippt; die Namen sind damit Zeichen
-- für Zeichen die, die drizzle-kit selbst vergäbe, und ein späteres `db:push`
-- sieht keinen Unterschied.
--
-- ── Warum es das gibt ────────────────────────────────────────────────────────
--
-- Auftrag vom 4.10.2026: Die App soll wissen, wann Klassenfahrt oder Ferien
-- sind. Bis dahin war jeder Tag von Montag bis Freitag ein Schultag, und der
-- Lernplan legte Blöcke mitten in die Klassenfahrt. Frei heißt seitdem ganz
-- frei: kein Unterricht, keine Lernblöcke, kein Abruf, keine Erinnerung.
--
-- ── ⚠ WIE SIE IN DIE LAUFENDE DATENBANK KOMMT ────────────────────────────────
--
-- Ohne diese Tabelle steht die Startseite: sie lädt die freien Tage mit.
-- Also ZUERST einspielen, DANN das neue Bild bauen.
--
-- Gegen die lokale Datei-Datenbank (Entwicklungsserver muss AUS sein, zwei
-- PGlite-Instanzen auf denselben Dateien zerstören sie):
--
--   npx tsx scripts/sql-einspielen.ts scripts/freie-tage-tabelle.sql
--
-- Auf dem NAS, in einer Transaktion, mit Abbruch beim ersten Fehler:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/freie-tage-tabelle.sql
--
-- Und danach nachsehen, statt es zu glauben:
--
--   sudo docker compose exec -T db psql -U schulapp -d schulapp -c '\d free_periods'

CREATE TABLE "free_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'ferien' NOT NULL,
	"title" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "free_periods" ADD CONSTRAINT "free_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "free_periods_user_idx" ON "free_periods" USING btree ("user_id");
