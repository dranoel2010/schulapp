-- Phase 5, Stufe 4: der Web MCP.
--
-- Rein additiv: eine neue Spalte an `material_pages`, drei neue Tabellen mit
-- ihren Fremdschlüsseln und zwei CREATE INDEX. Kein DROP, kein Umschreiben
-- einer bestehenden Spalte.
--
-- Warum diese Datei überhaupt existiert, steht im README: `npm run db:push`
-- bricht an einer Rückfrage ab, die ein Fehlalarm ist — es will `lessons`
-- leeren, um den eindeutigen Schlüssel `lessons_user_slot_key` neu anzulegen,
-- den es längst gibt. Die Antwort darauf ist niemals „truncate"; die eigentliche
-- Änderung steht stattdessen hier.
--
-- Gegen die lokale Datei-Datenbank (ohne DATABASE_URL) geht sie so hinein:
--
--   npx tsx scripts/sql-einspielen.ts scripts/mcp-tabellen.sql
--
-- Gegen die Cloud-Datenbank verweigert dieses Skript bewusst den Dienst — dort
-- gibt es keine Datei, die man vorher kopieren könnte. Am 24.8.2026 sind diese
-- Anweisungen deshalb von Hand in EINER Transaktion gegen Neon gelaufen, nach
-- einer Zählung auf `material_pages` (0 Zeilen, siehe die Bedingung unten).
--
-- Die Namen sind Zeichen für Zeichen die, die drizzle-kit selbst vergäbe: die
-- Anweisungen unten sind aus `drizzle-kit generate` über src/db/schema.ts
-- kopiert und nicht von Hand getippt. Dadurch sieht ein späteres `db:push`
-- keinen Unterschied und will nichts nachziehen.
--
-- ⚠ EINE BEDINGUNG hat diese Datei, und sie gilt nur einmal: `reading` kommt
-- als NOT NULL ohne Vorgabewert dazu. Das geht genau so lange gut, wie
-- `material_pages` leer ist — und das war am 24.8.2026 der Fall, dem Tag, an
-- dem diese Stufe gebaut wurde: es gab noch kein einziges abfotografiertes
-- Blatt. Auf einer Datenbank mit Seiten darin bricht die Anweisung ab, und das
-- ist die richtige Reaktion: eine Vorgabe („leere Bytes") wäre eine Lüge über
-- ein Bild, das es nicht gibt, und NULL zuzulassen hieße, dass `read_page`
-- irgendwann auf nichts trifft. Wer sie später braucht, füllt die Spalte
-- vorher aus dem Vollbild und macht sie erst danach NOT NULL.

ALTER TABLE "material_pages" ADD COLUMN "reading" "bytea" NOT NULL;

CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_codes_hash_key" UNIQUE("code_hash")
);

CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"scope" text DEFAULT '' NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grants_access_key" UNIQUE("access_token_hash"),
	CONSTRAINT "oauth_grants_refresh_key" UNIQUE("refresh_token_hash")
);

ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "oauth_codes_expires_idx" ON "oauth_codes" USING btree ("expires_at");

CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" USING btree ("user_id","created_at");
