-- Die tägliche Wiki-Übergabe: das Gedächtnis, was schon abgeliefert wurde.
--
-- Rein additiv: EINE neue Tabelle mit einem Fremdschlüssel. Kein DROP, keine
-- neue Spalte an einer bestehenden Tabelle, keine Zeile wird angefasst.
--
-- Sie liegt bewusst als eigene Datei NEBEN scripts/abschrift-tabellen.sql und
-- nicht darin: die Abschrift ist eine abgeschlossene Änderung, die am 5.9.2026
-- noch nicht eingespielt war. Zwei Änderungen in einer Datei hießen, dass man
-- die eine nicht ohne die andere einspielen kann — und die Reihenfolge ist
-- egal, denn diese hier hängt an nichts aus jener.
--
-- Die Namen sind Zeichen für Zeichen die, die drizzle-kit selbst vergäbe: die
-- beiden Anweisungen unten sind aus `drizzle-kit generate` über
-- src/db/schema.ts kopiert und nicht von Hand getippt. Dadurch sieht ein
-- späteres `db:push` keinen Unterschied und will nichts nachziehen. Wer einen
-- Namen „schöner" macht, handelt sich beim nächsten Push eine zweite, neu
-- gebaute Constraint ein.
--
-- ── Warum die Tabelle so aussieht ────────────────────────────────────────────
--
-- Ausführlich steht das am Tabellenkommentar in src/db/schema.ts. Die kurze
-- Fassung: `doc_id` ist die feste Kennung eines Dokuments („blatt-<uuid>") und
-- zugleich sein Dateiname im Übergabeordner; `hash` ist SHA-256 über den
-- fertig gerenderten Dateitext. Verglichen wird der Hash, und nur was sich
-- unterscheidet, wird neu geschrieben — sonst läge nach vierzehn Tagen alles
-- vierzehnfach im Vault.
--
-- Kein Index über den Primärschlüssel hinaus: gelesen wird ausschließlich
-- „alle Zeilen eines Nutzers", und dafür steht `user_id` im Schlüssel schon
-- vorn.
--
-- ── ⚠ WIE SIE WIRKLICH IN DIE LAUFENDE DATENBANK KOMMT ───────────────────────
--
-- Gegen die lokale Datei-Datenbank geht sie so hinein:
--
--   npx tsx scripts/sql-einspielen.ts scripts/wiki-uebergabe-tabelle.sql
--
-- **Dieses Kommando trifft NICHT die Produktivdatenbank, auch dann nicht, wenn
-- man es glaubt.** `DATABASE_URL` steht nur in `.env.local`, und diese Datei
-- liest allein Next — weder `node` noch `tsx` noch drizzle-kits eigenes dotenv
-- kennen sie. Der Wächter in scripts/sql-einspielen.ts, der bei gesetzter
-- `DATABASE_URL` den Dienst verweigert, feuert deshalb nie. Die lange Fassung
-- dieser Falle steht in scripts/abschrift-tabellen.sql und im README.
--
-- Seit dem 30.8.2026 läuft die Datenbank in einem Container auf dem NAS. Dort
-- geht die Wanderung von Hand hinein, in EINER Transaktion, mit
-- ON_ERROR_STOP — Nutzer und Datenbankname stehen in der `.env` auf dem NAS:
--
--   ssh leonard@192.168.178.90
--   cd /volume1/docker/schulapp
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction \
--          -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     < repo/scripts/wiki-uebergabe-tabelle.sql
--
-- Und danach nachsehen, statt es zu glauben:
--
--   sudo docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -c '\d wiki_deliveries'
--
-- Umgekehrt ist das Leeren dieser Tabelle der Hebel für „liefere noch einmal
-- alles" — nach einem verlorenen Vault oder nach einer geänderten Darstellung:
--
--   delete from wiki_deliveries;
--
-- Daten gehen dabei nicht verloren; darin stehen nur Abdrücke von Daten, die
-- anderswo liegen.
--
-- Der erste Lauf von /api/cron/wiki nach dem Einspielen findet die Tabelle
-- leer vor und übergibt deshalb ALLES — genau so ist es gedacht. Erst der
-- zweite Lauf ist ein Delta.

CREATE TABLE "wiki_deliveries" (
	"user_id" uuid NOT NULL,
	"doc_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"hash" text NOT NULL,
	"folder" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_deliveries_pk" PRIMARY KEY("user_id","doc_id")
);--> statement-breakpoint
ALTER TABLE "wiki_deliveries" ADD CONSTRAINT "wiki_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
