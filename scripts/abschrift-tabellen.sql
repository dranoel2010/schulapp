-- Die Abschrift: was auf einem Blatt steht, wörtlich, an der Seite gespeichert.
--
-- Rein additiv: eine neue Spalte an `material_pages`, eine neue Tabelle mit
-- ihren zwei Fremdschlüsseln und ein CREATE INDEX. Kein DROP, kein Umschreiben
-- einer bestehenden Spalte.
--
-- Die Namen sind Zeichen für Zeichen die, die drizzle-kit selbst vergäbe: die
-- Anweisungen unten sind aus `drizzle-kit generate` über src/db/schema.ts
-- kopiert und nicht von Hand getippt. Dadurch sieht ein späteres `db:push`
-- keinen Unterschied und will nichts nachziehen.
--
-- ── Warum `transcript` NULL zulässt ──────────────────────────────────────────
--
-- Anders als `reading` am 24.8.2026. Damals war `material_pages` leer, und
-- deshalb ging dort NOT NULL ohne Vorgabewert durch; heute liegen Blätter
-- darin, und dieselbe Anweisung bräche ab.
--
-- Aber selbst auf einer leeren Tabelle wäre NOT NULL hier falsch. NULL und
-- leerer String bedeuten verschiedene Dinge: NULL heißt „diese Seite hat noch
-- niemand gelesen", der leere String heißt „gelesen, und es stand nichts
-- darauf". Fielen beide zusammen, käme jede leere Seite bei jedem Lauf des
-- Postboten wieder an die Reihe. Die Begründung steht ausführlich am
-- Spaltenkommentar in src/db/schema.ts.
--
-- ── ⚠ WIE SIE WIRKLICH IN DIE LAUFENDE DATENBANK KOMMT ───────────────────────
--
-- Gegen die lokale Datei-Datenbank geht sie so hinein:
--
--   npx tsx scripts/sql-einspielen.ts scripts/abschrift-tabellen.sql
--
-- **Dieses Kommando trifft NICHT die Produktivdatenbank, auch dann nicht, wenn
-- man es glaubt.** `DATABASE_URL` steht nur in `.env.local`, und diese Datei
-- liest allein Next. Weder `node` noch `tsx` noch drizzle-kits eigenes dotenv
-- kennen sie — drizzle-kit sucht nach `.env` und `.env.vault`, und ein `.env`
-- gibt es in diesem Repo nicht. Also ist `DATABASE_URL` beim Aufruf über
-- `npx tsx` schlicht nicht gesetzt.
--
-- Zwei Folgen, und beide sind still:
--
--   1. `npm run db:push` und dieses Skript schreiben beide nach `.data/pglite`
--      und melden Erfolg. Die laufende App hat die Spalte danach nicht, und das
--      zeigt sich erst irgendwann als Laufzeitfehler in einer Abfrage.
--   2. Der Wächter in scripts/sql-einspielen.ts, der bei gesetzter
--      `DATABASE_URL` bewusst den Dienst verweigert, feuert deshalb nie.
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
--     < repo/scripts/abschrift-tabellen.sql
--
-- Und danach nachsehen, statt es zu glauben:
--
--   sudo docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -c '\d material_pages' -c '\d material_proposal_transcripts'

ALTER TABLE "material_pages" ADD COLUMN "transcript" text;--> statement-breakpoint
CREATE TABLE "material_proposal_transcripts" (
	"proposal_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"transcript" text NOT NULL,
	CONSTRAINT "material_proposal_transcripts_pk" PRIMARY KEY("proposal_id","page_id")
);--> statement-breakpoint
ALTER TABLE "material_proposal_transcripts" ADD CONSTRAINT "material_proposal_transcripts_proposal_id_material_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."material_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_proposal_transcripts" ADD CONSTRAINT "material_proposal_transcripts_page_id_material_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."material_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_proposal_transcripts_page_idx" ON "material_proposal_transcripts" USING btree ("page_id");
