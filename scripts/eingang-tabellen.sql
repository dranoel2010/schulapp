-- Die vier Tabellen für Phase 5, Stufe 3 und 4: der Eingangskorb und die
-- Anmeldung des Agenten.
--
-- Rein additiv: nur CREATE TABLE, die Fremdschlüssel der neuen Tabellen und
-- CREATE INDEX. Kein DROP, kein ALTER an einer bestehenden Tabelle.
--
-- Wie bei scripts/material-tabellen.sql sind die Namen genau die, die
-- drizzle-kit selbst vergäbe: dieses SQL ist aus `generateMigration()` über
-- src/db/schema.ts erzeugt, gegen den Stand vor diesen vier Tabellen. Dadurch
-- sieht ein späteres `npm run db:push` keinen Unterschied und will nichts
-- nachziehen. Wer einen Namen von Hand ändert, handelt sich beim nächsten Push
-- eine neu gebaute Constraint ein.
--
-- Der letzte Index ist der einzige mit einer Bedingung, und die trägt eine
-- Zusage: derselbe Vorschlag steht kein zweites Mal offen im Korb. Verworfen
-- oder übernommen zählt er nicht mehr mit — dann darf derselbe Vorschlag
-- wiederkommen. Warum das so und nicht als Prüfung im Code steht, erklärt der
-- Kommentar an `proposals` in src/db/schema.ts.

CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "oauth_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "oauth_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "oauth_codes_expires_idx" ON "oauth_codes" USING btree ("expires_at");
CREATE INDEX "oauth_tokens_user_idx" ON "oauth_tokens" USING btree ("user_id");
CREATE INDEX "oauth_tokens_expires_idx" ON "oauth_tokens" USING btree ("expires_at");
CREATE INDEX "proposals_user_status_idx" ON "proposals" USING btree ("user_id","status","created_at");
CREATE INDEX "proposals_material_idx" ON "proposals" USING btree ("material_id");
CREATE UNIQUE INDEX "proposals_open_key" ON "proposals" USING btree ("user_id","fingerprint") WHERE "proposals"."status" = 'offen';
