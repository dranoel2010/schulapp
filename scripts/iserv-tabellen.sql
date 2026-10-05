-- IServ: zwei Tabellen, zwei Fremdschlüssel, kein Index.
--
-- Rein additiv. Keine bestehende Zeile wird angefasst, keine Spalte entfernt.
--
-- Die Anweisungen unten sind aus `drizzle-kit generate --name iserv`
-- herausgeschnitten und nicht von Hand getippt; die Namen sind damit Zeichen
-- für Zeichen die, die drizzle-kit selbst vergäbe, und ein späteres `db:push`
-- sieht keinen Unterschied.
--
-- ── Warum es das gibt ────────────────────────────────────────────────────────
--
-- Auftrag vom 5.10.2026, Stufe 5: Die App meldet sich mit dem Konto des
-- Schülers bei IServ an und liest — nur lesen — den Gruppenkalender seiner
-- Klasse, den öffentlichen Schulkalender und seine Aufgaben. Was davon seine
-- Klasse betrifft, landet im Kalender „Schule" in Google. `iserv_state` hält
-- den Zustand der Anbindung (blockiert? zuletzt gelesen? letzter Fehler?),
-- `iserv_snapshots` den letzten guten Stand je Quelle — den liest der
-- Abgleich mit Google, nie IServ selbst. Warum jede Spalte da ist, steht an
-- den Tabellen in src/db/schema.ts.
--
-- Benutzer und Passwort stehen in KEINER Spalte: nur in der Umgebung
-- (ISERV_USER, ISERV_PASSWORD), die Session-Cookies nur im Speicher.
--
-- ── ⚠ ZUERST einspielen, DANN bauen, DANN die ISERV_*-Variablen setzen ───────
--
-- Ohne gesetzte Variablen fasst die Seite /einstellungen die Tabellen gar nicht
-- an (die Funktion ist dann aus, wie der Google Kalender ohne GOOGLE_*). Mit
-- gesetzten Variablen und ohne Tabellen antwortet /einstellungen mit 500, und
-- der stündliche Kalender-Cron meldet den Abruf als gescheitert. Die
-- Reihenfolge oben ist also die, in der zu keinem Zeitpunkt etwas kaputt ist.
-- scripts/iserv-einrichten.sh hält sie ein.
--
-- Gegen die lokale Datei-Datenbank — nur bei ausgeschaltetem
-- Entwicklungsserver (zwei PGlite-Instanzen auf denselben Dateien zerstören
-- sie), nach `npm run db:backup` und nur mit Zustimmung des Nutzers, denn in
-- .data liegt sein Bestand:
--
--   npx tsx scripts/sql-einspielen.ts scripts/iserv-tabellen.sql
--
-- Auf dem NAS, in einer Transaktion, mit Abbruch beim ersten Fehler:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/iserv-tabellen.sql
--
-- Und danach nachsehen, statt es zu glauben:
--
--   sudo docker compose exec -T db psql -U schulapp -d schulapp -c '\d iserv_state'
--   sudo docker compose exec -T db psql -U schulapp -d schulapp -c '\d iserv_snapshots'
--
-- ── ⚠ `delete from iserv_snapshots` ist KEIN Reset-Hebel ─────────────────────
--
-- Ohne Snapshot des öffentlichen Kalenders wirft die Quelle im Abgleich,
-- und die Termine aus IServ bleiben eingefroren — bis zum nächsten Abruf. Der
-- reicht nur 14 Tage zurück: Alles Ältere, das eingefroren stand, verschwindet
-- dann aus Google. Löscht man nur `klasse` oder `aufgaben`, verschwinden deren
-- Termine sofort. Eine Sperre hebt man in den Einstellungen („Erneut
-- versuchen") oder mit `iserv-einrichten.sh --neues-passwort` auf, nicht hier.

CREATE TABLE "iserv_snapshots" (
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"remote_id" text NOT NULL,
	"label" text NOT NULL,
	"items_json" text NOT NULL,
	"item_count" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"pending_fingerprint" text,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"pending_since" timestamp with time zone,
	CONSTRAINT "iserv_snapshots_pk" PRIMARY KEY("user_id","source")
);
CREATE TABLE "iserv_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"failures_in_row" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_warning" text,
	"stale_notified_at" timestamp with time zone,
	"sources_json" text DEFAULT '[]' NOT NULL,
	"exercise_fields" text
);
ALTER TABLE "iserv_snapshots" ADD CONSTRAINT "iserv_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "iserv_state" ADD CONSTRAINT "iserv_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
