/**
 * Spielt eine SQL-Datei in die lokale Datenbank ein.
 *
 *   npx tsx scripts/sql-einspielen.ts scripts/material-tabellen.sql
 *
 * Gedacht für den einen Fall, den das README beschreibt: `npm run db:push`
 * bricht an einer Rückfrage ab, die ein Fehlalarm ist (es will die Tabelle
 * `lessons` leeren, um einen Schlüssel neu anzulegen, den es längst gibt), und
 * die eigentliche Änderung ist rein additiv. Dann geht sie hier durch, ohne
 * dass jemand „truncate" antworten müsste.
 *
 * Zwei Sicherungen sind eingebaut. Erstens läuft alles in EINER Transaktion:
 * scheitert eine Anweisung, ist keine angekommen. Zweitens weist das Skript
 * eine Datei zurück, in der eine Anweisung mit `drop`, `truncate`, `delete`
 * oder `update` **beginnt** oder irgendwo ein `DROP TABLE`/`DROP COLUMN` und
 * seinesgleichen steht — dieses Werkzeug ist für additive Änderungen da, und
 * ein Skript, das die Datenbank leeren kann, gehört nicht in ein Repo, in dem
 * man es aus Versehen aufruft. Geprüft wird pro Anweisung und nicht über den
 * ganzen Text: `ON DELETE cascade` ist eine Fremdschlüssel-Regel und darf
 * durch, sonst läge genau die Datei draußen, für die es das Skript gibt.
 *
 * **Der Entwicklungsserver muss aus sein.** PGlite öffnet das Verzeichnis
 * exklusiv, und zwei Prozesse darauf machen die Datenbank kaputt — nicht
 * theoretisch, das ist schon passiert. Vorher lohnt sich `npm run db:backup`.
 *
 * Gegen ein echtes Postgres (DATABASE_URL gesetzt) läuft es bewusst nicht:
 * dort gibt es keine Datei, die man vorher kopieren könnte, und ein
 * Handbetrieb auf der Cloud-Datenbank soll eine bewusste Entscheidung bleiben.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

/**
 * Was eine additive Änderung nicht tun darf.
 *
 * Geprüft wird pro Anweisung und nicht über den ganzen Text: `ON DELETE
 * cascade` ist eine Fremdschlüssel-Regel und kein `DELETE FROM`. Ein Wächter,
 * der nur nach dem Wort sucht, lehnt genau die Datei ab, für die es ihn gibt.
 * Deshalb zählt hier, womit eine Anweisung **beginnt**, und zusätzlich das
 * `DROP` mitten in einem `ALTER TABLE`.
 */
const VERBOTEN: ReadonlyArray<{ muster: RegExp; satz: string }> = [
  {
    muster: /^(drop|truncate|delete|update)\b/i,
    satz: "eine Anweisung beginnt mit",
  },
  {
    muster: /\bdrop\s+(table|column|constraint|index|schema|type|view)\b/i,
    satz: "eine Anweisung enthält",
  },
];

/**
 * Wirft jeden Kommentar aus dem SQL — und nur den.
 *
 * Dass das hier ein Zeichen nach dem anderen liest statt Zeile für Zeile, hat
 * einen scharfen Grund. Ein Kommentar am ENDE einer Anweisung
 * (`CREATE TABLE probe (…); -- Aufräumen danach`) beginnt keine Zeile. Bliebe
 * er stehen, wanderte er beim Trennen an „;" in den nächsten Abschnitt und
 * stünde dort VOR dessen erstem Wort — `^(drop|truncate|delete|update)` griffe
 * nicht mehr, und ein `DELETE FROM users` dahinter liefe durch. Der Unterschied
 * zwischen „wird abgewiesen" und „löscht alles" wäre ein Zeilenumbruch.
 *
 * Zwei Formen von Kommentar kommen in einer SQL-Datei vor, und beide müssen
 * weg: der Zeilenkommentar mit `--` bis zum Zeilenende und der Blockkommentar
 * über beliebig viele Zeilen (in Postgres schachtelbar, deshalb der Zähler).
 * Dazu die Gegenprobe: ein `--` INNERHALB einer Zeichenkette ist gar kein
 * Kommentar. Deshalb werden Zeichenketten ('…', E'…' mit Backslash-Escapes,
 * $tag$…$tag$) und zitierte Bezeichner ("…") beim Lesen übersprungen und
 * unverändert übernommen.
 *
 * Umbrüche bleiben erhalten, ein Blockkommentar hinterlässt ein Leerzeichen —
 * sonst verschmölzen die Wörter davor und dahinter zu einem einzigen.
 */
export function ohneKommentare(sql: string): string {
  let ergebnis = "";
  let i = 0;

  while (i < sql.length) {
    const zeichen = sql[i];
    const paar = sql.slice(i, i + 2);

    // Zeilenkommentar: alles bis zum Umbruch fällt weg, der Umbruch bleibt —
    // sonst klebte die nächste Anweisung an der vorigen.
    if (paar === "--") {
      const ende = sql.indexOf("\n", i);
      if (ende === -1) break;
      i = ende;
      continue;
    }

    // Blockkommentar. Postgres schachtelt sie, also wird die Tiefe mitgezählt,
    // statt beim ersten Ende-Zeichenpaar aufzuhören.
    if (paar === "/*") {
      let tiefe = 1;
      i += 2;

      while (i < sql.length && tiefe > 0) {
        const innen = sql.slice(i, i + 2);
        if (innen === "/*") {
          tiefe += 1;
          i += 2;
        } else if (innen === "*/") {
          tiefe -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }

      ergebnis += " ";
      continue;
    }

    // Dollar-Quoting: $$ … $$ oder $tag$ … $tag$. Der Rumpf einer Funktion
    // steht so da, und darin ist ein „--" gewöhnlicher Text.
    const dollar = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
    if (dollar) {
      const marke = dollar[0];
      const ende = sql.indexOf(marke, i + marke.length);
      const bis = ende === -1 ? sql.length : ende + marke.length;
      ergebnis += sql.slice(i, bis);
      i = bis;
      continue;
    }

    // Zeichenkette oder zitierter Bezeichner. Zwei gleiche Anführungszeichen
    // hintereinander sind eines im Text und schließen nicht; nach E'…' schließt
    // auch ein Backslash das nächste Zeichen ein.
    if (zeichen === "'" || zeichen === '"') {
      const escaped =
        zeichen === "'" && /(^|[^A-Za-z0-9_])[Ee]$/.test(ergebnis);
      ergebnis += zeichen;
      i += 1;

      while (i < sql.length) {
        if (escaped && sql[i] === "\\" && i + 1 < sql.length) {
          ergebnis += sql.slice(i, i + 2);
          i += 2;
          continue;
        }

        if (sql[i] === zeichen) {
          if (sql[i + 1] === zeichen) {
            ergebnis += zeichen + zeichen;
            i += 2;
            continue;
          }

          ergebnis += zeichen;
          i += 1;
          break;
        }

        ergebnis += sql[i];
        i += 1;
      }

      continue;
    }

    ergebnis += zeichen;
    i += 1;
  }

  return ergebnis;
}

/**
 * Prüft, ob die Datei additiv ist. Gibt den beanstandeten Ausdruck zurück,
 * oder null, wenn nichts dagegen spricht.
 *
 * Getrennt wird stumpf an jedem „;", auch an einem, das in einer Zeichenkette
 * steht. Das ist Absicht: ein solcher Schnitt erzeugt nur MEHR Abschnitte, nie
 * weniger, und kann deshalb keine Anweisung an ihrem Anfang verstecken. Im
 * schlimmsten Fall lehnt der Wächter eine harmlose Datei ab — die Richtung, in
 * die er irren soll.
 */
export function beanstandung(sql: string): string | null {
  for (const anweisung of ohneKommentare(sql).split(";")) {
    const text = anweisung.trim().replace(/\s+/g, " ");
    if (!text) continue;

    for (const { muster, satz } of VERBOTEN) {
      const treffer = text.match(muster);
      if (treffer) return `${satz} „${treffer[0]}"`;
    }
  }

  return null;
}

async function main() {
  const datei = process.argv[2];
  if (!datei) {
    throw new Error(
      "Welche Datei? Beispiel: npx tsx scripts/sql-einspielen.ts scripts/material-tabellen.sql",
    );
  }

  if (process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL ist gesetzt. Dieses Skript arbeitet nur auf der lokalen Datei-Datenbank.",
    );
  }

  const sql = readFileSync(path.resolve(datei), "utf8");
  const anweisungen = ohneKommentare(sql);

  const beanstandet = beanstandung(sql);
  if (beanstandet) {
    throw new Error(
      `In ${datei} ${beanstandet}. Dieses Skript spielt nur additive Änderungen ein — ` +
        "was löscht, gehört von Hand in db:studio oder in eine bewusste Migration.",
    );
  }

  console.log(
    "Der Entwicklungsserver muss aus sein — zwei Prozesse auf derselben PGlite\n" +
      "machen die Datenbank kaputt. Und vorher: npm run db:backup.\n",
  );

  const verzeichnis = path.join(process.cwd(), ".data", "pglite");
  const db = new PGlite(verzeichnis);

  const vorher = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log(`Tabellen vorher (${vorher.rows.length}):`);
  console.log("  " + vorher.rows.map((zeile) => zeile.table_name).join(", "));

  await db.exec(`begin;\n${anweisungen}\ncommit;`);

  const nachher = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log(`Tabellen nachher (${nachher.rows.length}):`);
  console.log("  " + nachher.rows.map((zeile) => zeile.table_name).join(", "));

  const neu = nachher.rows
    .map((zeile) => zeile.table_name)
    .filter((name) => !vorher.rows.some((zeile) => zeile.table_name === name));

  console.log(
    neu.length > 0
      ? `Neu dazugekommen: ${neu.join(", ")}`
      : "Keine neue Tabelle — die Änderung war eine Spalte, ein Index oder schon da.",
  );

  await db.close();
}

// `main()` läuft nur, wenn diese Datei selbst aufgerufen wurde. Sonst öffnete
// schon der bloße Import die Datenbank — und `beanstandung()` soll sich prüfen
// lassen, ohne dass dabei etwas an einer echten PGlite passiert.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((fehler: unknown) => {
    console.error(fehler instanceof Error ? fehler.message : fehler);
    process.exit(1);
  });
}
