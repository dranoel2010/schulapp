-- Google Kalender: zwei Tabellen, zwei Fremdschlüssel, kein Index.
--
-- Rein additiv. Keine bestehende Zeile wird angefasst, keine Spalte entfernt.
--
-- Die Anweisungen unten sind aus `drizzle-kit generate --name google-kalender`
-- herausgeschnitten und nicht von Hand getippt; die Namen sind damit Zeichen
-- für Zeichen die, die drizzle-kit selbst vergäbe, und ein späteres `db:push`
-- sieht keinen Unterschied.
--
-- ── Warum es das gibt ────────────────────────────────────────────────────────
--
-- Auftrag vom 5.10.2026, Stufe 1 und 2 von 5: Die App trägt Klausuren, offene
-- Hausaufgaben und freie Tage als ganztägige Termine in einen eigenen Kalender
-- „Schule" im Google Kalender des Schülers ein. `google_calendar_connections`
-- hält die Verbindung (das Refresh Token verschlüsselt, den Kalender, den
-- Zustand für die Einstellungen), `google_calendar_events` das Gedächtnis je
-- Termin — und darin, was der Nutzer in Google gelöscht hat und was deshalb
-- nie wieder eingetragen wird. Warum jede Spalte da ist, steht an den Tabellen
-- in src/db/schema.ts.
--
-- ── ⚠ ZUERST einspielen, DANN bauen, DANN die GOOGLE_*-Variablen setzen ──────
--
-- Ohne gesetzte Variablen fasst die Seite /einstellungen die Tabellen gar nicht
-- an (die Funktion ist dann aus, wie Jev ohne TYPESAFE_API_KEY). Mit gesetzten
-- Variablen und ohne Tabellen antwortet /einstellungen mit 500. Die Reihenfolge
-- oben ist also die, in der zu keinem Zeitpunkt etwas kaputt ist.
--
-- Gegen die lokale Datei-Datenbank — nur bei ausgeschaltetem
-- Entwicklungsserver (zwei PGlite-Instanzen auf denselben Dateien zerstören
-- sie), nach `npm run db:backup` und nur mit Zustimmung des Nutzers, denn in
-- .data liegt sein Bestand:
--
--   npx tsx scripts/sql-einspielen.ts scripts/google-kalender-tabellen.sql
--
-- Auf dem NAS, in einer Transaktion, mit Abbruch beim ersten Fehler:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/google-kalender-tabellen.sql
--
-- Und danach nachsehen, statt es zu glauben:
--
--   sudo docker compose exec -T db psql -U schulapp -d schulapp -c '\d google_calendar_connections'
--   sudo docker compose exec -T db psql -U schulapp -d schulapp -c '\d google_calendar_events'
--
-- ── ⚠ `delete from google_calendar_events` ist KEIN Reset-Hebel ──────────────
--
-- Anders als bei `wiki_deliveries`. Dort heißt leeren: alles wird noch einmal
-- geliefert. Hier hieße es: Was der Nutzer in Google gelöscht hat, käme beim
-- nächsten Lauf zurück, und Termine, die es in der App nicht mehr gibt, blieben
-- in Google für immer stehen. Zurückgesetzt wird nur in den Einstellungen über
-- „Kalender neu anlegen".

CREATE TABLE "google_calendar_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token_enc" text,
	"scope" text DEFAULT '' NOT NULL,
	"calendar_id" text,
	"google_email" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_summary" text,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_cron_at" timestamp with time zone
);
CREATE TABLE "google_calendar_events" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"calendar_id" text NOT NULL,
	"event_id" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"hash" text NOT NULL,
	"state" text NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_events_pk" PRIMARY KEY("user_id","key")
);
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "google_calendar_events" ADD CONSTRAINT "google_calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
