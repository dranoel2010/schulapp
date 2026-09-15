-- Die bestehenden Bausteine bekommen ihre Klausur nachgetragen.
--
-- ── ⚠ Diese Datei geht NICHT durch sql-einspielen.ts ─────────────────────────
--
-- Der Wächter dort weist jede Anweisung ab, die mit `update` beginnt
-- (scripts/sql-einspielen.ts, Liste `VERBOTEN`), und das ist richtig so: Ein
-- Skript, das Wanderungen einspielt, soll keinen Bestand ändern können. Diese
-- Datei ändert Bestand — genau dafür ist sie da. Sie läuft deshalb von Hand:
--
--   sudo docker compose exec -T db \
--     psql -v ON_ERROR_STOP=1 --single-transaction -U schulapp -d schulapp \
--     < repo/scripts/abruf-klausurbindung-nachfuellen.sql
--
-- ── Warum es sie überhaupt braucht ───────────────────────────────────────────
--
-- `scripts/abruf-klausurbindung.sql` legt die Spalte an, aber leer. Für jeden
-- Baustein, der VOR dem 15.9.2026 übernommen wurde, stünde dort NULL — und die
-- neue Regel („Prüfung gelöscht → Abruf weg") gälte ausgerechnet für die Daten
-- nicht, die schon da sind.
--
-- Die Verbindung Baustein → Klausur existiert noch, aber nur an einer einzigen
-- Stelle: `recall_proposal_items.item_id` zeigt auf den übernommenen Baustein,
-- `recall_proposals.exam_id` auf die Klausur. Diese Zeilen hängen selbst per
-- CASCADE an der Klausur. Wer also erst eine Prüfung löscht und dann nachfüllt,
-- füllt nichts mehr nach: Die Spur ist mit der Prüfung verschwunden.
--
-- ── Was der Satz unten tut, und was er ausdrücklich NICHT tut ────────────────
--
-- `herkunft` sammelt je Baustein die Klausuren, aus deren Vorschlägen er stammt.
-- `eindeutig` behält nur die Bausteine, bei denen das GENAU EINE ist. Steht ein
-- Baustein an zwei Vorschlägen zu verschiedenen Klausuren, bleibt er NULL und
-- überlebt jedes Löschen — bei einer Handlung ohne Rückweg ist Stehenlassen die
-- richtige Antwort auf Mehrdeutigkeit. (Heute gibt es diesen Fall nicht; die
-- Abfrage darunter zeigt, ob er je entsteht.)
--
-- Kein `min()` über die id: Postgres kennt kein Aggregat für uuid, und der
-- naheliegende Einzeiler scheitert mit „function min(uuid) does not exist".
--
-- `WHERE i."exam_id" IS NULL` macht die Datei zweimal ausführbar und lässt eine
-- bereits gesetzte Bindung in Ruhe — auch eine, die jemand von Hand gesetzt hat.

WITH herkunft AS (
  SELECT DISTINCT vi."item_id" AS item_id, v."exam_id" AS exam_id
    FROM "recall_proposal_items" vi
    JOIN "recall_proposals" v ON v."id" = vi."proposal_id"
   WHERE vi."item_id" IS NOT NULL
), eindeutig AS (
  SELECT item_id FROM herkunft GROUP BY item_id HAVING count(*) = 1
)
UPDATE "recall_items" i
   SET "exam_id" = h.exam_id
  FROM herkunft h
  JOIN eindeutig e ON e.item_id = h.item_id
 WHERE i."id" = h.item_id
   AND i."exam_id" IS NULL;

-- Was danach dasteht. Die dritte Zahl ist die, auf die es ankommt: Bausteine
-- ohne Klausur, die aus einem Vorschlag stammen — sie wären mehrdeutig und
-- blieben absichtlich stehen.
SELECT count(*) FILTER (WHERE "exam_id" IS NOT NULL) AS mit_klausur,
       count(*) FILTER (WHERE "exam_id" IS NULL)     AS ohne_klausur,
       count(*) FILTER (
         WHERE "exam_id" IS NULL
           AND EXISTS (SELECT 1 FROM "recall_proposal_items" vi
                        WHERE vi."item_id" = "recall_items"."id")
       ) AS ohne_klausur_trotz_vorschlag
  FROM "recall_items";
