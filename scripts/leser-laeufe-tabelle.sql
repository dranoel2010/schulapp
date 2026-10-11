-- Das Gedächtnis des Claude-Lesers: was die App schon gelesen hat (11.10.2026).
--
-- Rein additiv: EINE neue Tabelle mit drei Fremdschlüsseln, vier
-- CHECK-Bedingungen und vier Indizes. Kein DROP, keine neue Spalte an einer
-- bestehenden Tabelle, keine Zeile wird angefasst.
--
-- Nach der Abnahme vom 11.10.2026 umgebaut, bevor sie irgendwo eingespielt
-- war: dazu kamen `abbruch`, `abgeschrieben`, `frist_bis` und der Wert
-- `laeuft` (warum, steht am Tabellenkommentar); nach einer Regression vom
-- selben Tag noch der Wert `ausfall` in der CHECK-Bedingung von `abbruch`.
-- Wer eine ÄLTERE Fassung dieser Datei schon eingespielt hat, dem fehlt
-- `frist_bis` — `nas.sh hoch` prüft genau diese Spalte und hält dann an —
-- oder `ausfall`, und das sieht kein `hoch`: dann scheitert der Vermerk jedes
-- Laufs, den eine Überlastung mitten im Strom abbricht. Die Tabelle ist in
-- beiden Fällen noch leer oder fast, und `DROP TABLE leser_laeufe;` vor dem
-- Einspielen ist der Weg.
--
-- Warum es sie gibt: Seit die App das Modell selbst ruft, kostet jeder Lauf
-- Geld vom API-Schlüssel. Ohne ein Gedächtnis in der Datenbank würde jedes
-- Blatt, an dem schon einmal „nichts“ herauskam (etwa ein Inhaltsfilter), bei
-- jedem Anstoß neu gelesen — und nach jedem Neustart sowieso. Bisher hielt das
-- der Postbote in seiner Datei `gesehen.json`; die wandert NICHT mit. Wer
-- wissen will, was beim Umstieg ein erstes Mal bezahlt gelesen wird, zählt
-- vorher (unten). Ausführlich steht alles am Tabellenkommentar in
-- src/db/schema.ts.
--
-- Die Anweisungen sind aus `drizzle-kit generate` über src/db/schema.ts
-- kopiert und nicht von Hand getippt — zweimal in einen Ordner außerhalb des
-- Repos, einmal mit dem Stand vor der Änderung als Basis und einmal danach:
--
--   mkdir P && ln -s <worktree>/node_modules P/node_modules
--   git show main:src/db/schema.ts > P/schema.ts
--   cd P && ./node_modules/.bin/drizzle-kit generate --dialect postgresql \
--     --schema ./schema.ts --out ./out --name basis
--   cp <worktree>/src/db/schema.ts P/schema.ts
--   ./node_modules/.bin/drizzle-kit generate --dialect postgresql \
--     --schema ./schema.ts --out ./out --name leser_laeufe
--
-- Am 11.10.2026 genau so gelaufen; `out/0001_leser_laeufe.sql` ist die Datei
-- unten, ohne Abweichung. Dadurch sieht ein späteres `db:push` keinen
-- Unterschied und will nichts nachziehen.
--
-- ── Reihenfolge ──────────────────────────────────────────────────────────────
--
-- VOR dem Bau einspielen. Der alte Code verträgt die Tabelle, er kennt sie
-- nicht. Der neue Code ohne sie scheitert bei jedem Lauf des Lesers mit
-- „relation does not exist“. Deshalb steht sie in PFLICHTSPALTEN von
-- scripts/nas.sh: `hoch` sieht vor dem Bau nach, hält sonst an und druckt die
-- Zeile zum Einspielen aus. Ein Rückbau braucht kein SQL: `nas.sh zurueck`
-- läuft mit der Tabelle weiter, der alte Code sieht sie nicht.
--
-- ── Vorher zählen (ändert nichts) ───────────────────────────────────────────
--
-- Korbblätter ohne Vorschlag mit einer ungelesenen Claude-Seite — die liest
-- der neue Leser beim ersten Anstoß, bezahlt, auch wenn der Postbote sie
-- schon einmal mit „nichts“ abgeschlossen hatte. Seiten ohne Leser (NULL,
-- die Altblätter vor dem 6.10.2026) zählen nicht: die liest er im Korb nie
-- von selbst, nur auf Knopfdruck. scripts/claude-einrichten.sh zählt genau so
-- und fragt, ob diese Blätter als „vor dem Wechsel gesehen“ vermerkt werden:
--
--   SELECT count(DISTINCT m.id) AS korbblaetter
--     FROM materials m JOIN material_pages p ON p.material_id = m.id
--    WHERE m.filed_at IS NULL
--      AND p.transcript IS NULL AND p.leser = 'claude'
--      AND NOT EXISTS (SELECT 1 FROM material_proposals v WHERE v.material_id = m.id);
--
-- ── Einspielen (NAS) ────────────────────────────────────────────────────────
--
-- So, wie es dasteht, abzutippen (warum so, steht in scripts/leser-tabellen.sql):
--
--   sudo sh -c 'cd /volume1/docker/schulapp && /usr/local/bin/docker compose exec -T db sh -c "exec psql -X -v ON_ERROR_STOP=1 --single-transaction -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f -" < repo/scripts/leser-laeufe-tabelle.sql'
--
-- Lokal gegen die Datei-Datenbank (Entwicklungsserver AUS):
--
--   npx tsx scripts/sql-einspielen.ts scripts/leser-laeufe-tabelle.sql
--
-- ── Nachher nachsehen, statt es zu glauben ──────────────────────────────────
--
--   \d leser_laeufe
--   SELECT count(*) FROM leser_laeufe;   -- erwartet: 0
--
-- Nach ein paar Tagen Betrieb — was gelesen wurde und was es gekostet hat:
--
--   SELECT art, ergebnis, count(*), round(sum(kosten_usd), 2) AS usd
--     FROM leser_laeufe GROUP BY 1, 2 ORDER BY 1, 2;
--
-- ⚠ Leeren ist ein Hebel mit Preis: danach liest die App jedes Blatt, das
-- noch ungelesene Claude-Seiten hat, ein weiteres Mal — bezahlt.

CREATE TABLE "leser_laeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid,
	"exam_id" uuid,
	"art" text NOT NULL,
	"schluessel" text DEFAULT '' NOT NULL,
	"ergebnis" text NOT NULL,
	"grund" text DEFAULT '' NOT NULL,
	"abbruch" text,
	"abgeschrieben" jsonb,
	"frist_bis" timestamp with time zone,
	"modell" text,
	"kosten_usd" numeric(10, 6),
	"messung" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leser_laeufe_art_check" CHECK ("leser_laeufe"."art" in ('einordnen', 'nachlese', 'von-hand', 'fragen')),
	CONSTRAINT "leser_laeufe_ergebnis_check" CHECK ("leser_laeufe"."ergebnis" in ('vorschlag', 'kein-vorschlag', 'nichts', 'spaeter', 'pause', 'laeuft')),
	CONSTRAINT "leser_laeufe_abbruch_check" CHECK ("leser_laeufe"."abbruch" is null or "leser_laeufe"."abbruch" in ('frist', 'strom', 'ausfall', 'rueckfall', 'ablage')),
	CONSTRAINT "leser_laeufe_ziel_check" CHECK (("leser_laeufe"."art" = 'fragen' and "leser_laeufe"."exam_id" is not null and "leser_laeufe"."material_id" is null) or ("leser_laeufe"."art" <> 'fragen' and "leser_laeufe"."material_id" is not null and "leser_laeufe"."exam_id" is null))
);
--> statement-breakpoint
ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leser_laeufe_gemerkt_key" ON "leser_laeufe" USING btree ("material_id","art","schluessel") WHERE "leser_laeufe"."ergebnis" in ('vorschlag', 'kein-vorschlag', 'nichts') and "leser_laeufe"."art" in ('einordnen', 'nachlese');--> statement-breakpoint
CREATE INDEX "leser_laeufe_material_idx" ON "leser_laeufe" USING btree ("material_id","created_at");--> statement-breakpoint
CREATE INDEX "leser_laeufe_exam_idx" ON "leser_laeufe" USING btree ("exam_id","created_at");--> statement-breakpoint
CREATE INDEX "leser_laeufe_user_idx" ON "leser_laeufe" USING btree ("user_id","created_at");