import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { isDocumentId, type WikiDocument } from "@/lib/wiki/documents";

/**
 * Das Schreiben der Übergabe — der einzige Ort im Projekt, an dem die App
 * Dateien anlegt.
 *
 * Bisher schrieb sie nirgends: Bilder liegen als `bytea` in der Datenbank,
 * Sicherungen macht ein Skript. Deshalb steht hier mehr Vorsicht, als eine
 * Handvoll `writeFile()` sonst verdient.
 *
 * ── Erstens: kein Pfad aus Daten ─────────────────────────────────────────────
 *
 * Ein Dateiname entsteht ausschließlich aus einer Kennung „<art>-<uuid>", und
 * `fileNameFor()` weist alles zurück, was nicht genau so aussieht. Ein Fach
 * „Deutsch/Französisch" oder ein Titel „../../autostart" kann damit gar nicht
 * erst zu einem Pfad werden. Danach wird der fertige Pfad ein zweites Mal
 * geprüft (`resolveInside()`), und zwar gegen das, was `path.resolve()` daraus
 * wirklich macht — Gürtel und Hosenträger, weil das hier die Stelle ist, an der
 * ein Fehler nicht eine falsche Anzeige, sondern eine überschriebene Datei
 * außerhalb des Vaults wäre.
 *
 * ── Zweitens: entweder ganz oder gar nicht ───────────────────────────────────
 *
 * Geschrieben wird zuerst in einen versteckten, unfertigen Ordner
 * (`.uebergabe-unfertig-…`) und der erst am Ende an seinen Platz umbenannt.
 * Ein Umbenennen innerhalb desselben Dateisystems ist ein einzelner Schritt:
 * der Übergabeordner ist entweder vollständig da oder gar nicht.
 *
 * Das ist die Antwort auf die Frage, was bei einem Abbruch mitten im Lauf
 * passiert. Ohne sie läse der Agent eine MANIFEST.md, die mehr verspricht, als
 * danebenliegt — und weil er ihr glaubt, hielte er die fehlenden Dateien für
 * unverändert. Mit ihr sieht er einen Ordner weniger und liest ihn beim
 * nächsten Lauf vollständig; die Delta-Erkennung holt alles nach, denn in
 * `wiki_deliveries` steht erst etwas, wenn der Ordner steht.
 *
 * Der Punkt am Anfang des unfertigen Namens ist kein Schmuck: Obsidian
 * überliest Ordner, die mit einem Punkt beginnen. Ein abgestürzter Lauf
 * hinterlässt damit nichts, was im Vault auftaucht.
 *
 * ── Drittens: der Wurzelordner wird nicht angelegt ───────────────────────────
 *
 * Steht in `WIKI_EXPORT_DIR` ein Pfad, den es nicht gibt, ist die
 * wahrscheinlichste Erklärung nicht „der Ordner fehlt noch", sondern „der Vault
 * ist gerade nicht eingehängt". Ihn dann anzulegen hieße, eine Übergabe in
 * einen Ordner zu schreiben, den nie jemand ansieht — und die Zeilen in
 * `wiki_deliveries` behaupteten danach, sie sei angekommen. Also: Fehler statt
 * `mkdir -p`.
 */

/** Die Datei, die der Agent zuerst liest. */
export const MANIFEST_NAME = "MANIFEST.md";

/** Vorsilbe des unfertigen Ordners. Der Punkt hält ihn aus Obsidian heraus. */
export const TEMP_PREFIX = ".uebergabe-unfertig-";

/**
 * Wann ein liegengebliebener unfertiger Ordner weggeräumt wird: nach 24
 * Stunden.
 *
 * Nicht sofort, und das ist der Sinn der Frist. Zwei Läufe gleichzeitig sind
 * nicht vorgesehen — der Cron-Eintrag auf dem NAS ruft um 02:30 einmal am
 * Tag —, aber wer die Route von Hand anstösst, während der geplante Lauf
 * noch schreibt, dürfte ihm nicht den Ordner unter den Händen wegräumen.
 * Alles, was älter als ein Tag ist, kann dagegen nur von einem abgestürzten
 * Lauf stammen.
 */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * So oft wird ein freier Ordnername gesucht.
 *
 * Der zweite Lauf eines Tages bekommt „2026-09-05-2", der dritte „-3". Mehr
 * als eine Handvoll Läufe am Tag heißt, dass jemand die Route in einer
 * Schleife ruft; dann ist ein Fehler die richtige Antwort und kein
 * sechzigster Ordner.
 */
const MAX_FOLDER_ATTEMPTS = 8;

/** Was ein Lauf hinterlassen hat. */
export type HandoverResult = {
  /** Der Name des Ordners, z.B. "2026-09-05" oder "2026-09-05-2". */
  folder: string;
  /** Sein vollständiger Pfad. */
  path: string;
  /** Wie viele Dateien darin liegen, die MANIFEST.md mitgezählt. */
  files: number;
};

/**
 * Der Dateiname zu einer Kennung — die einzige Stelle, an der einer entsteht.
 *
 * Wirft bei allem, was nicht wie „<art>-<uuid>" aussieht. Der Wurf ist
 * Absicht: Auf diesem Weg kann keine solche Kennung entstehen
 * (`documentId()` baut sie aus einer geprüften UUID), und wenn doch eine
 * ankommt, ist etwas so grundsätzlich falsch, dass Weiterschreiben die
 * schlechtere Antwort wäre.
 */
export function fileNameFor(id: string): string {
  if (!isDocumentId(id)) {
    throw new Error(`Keine gültige Kennung für einen Dateinamen: ${id}`);
  }

  return `${id}.md`;
}

/**
 * Der Pfad einer Datei IM Ordner — und die Zusage, dass er darin bleibt.
 *
 * Geprüft wird nicht der Name, sondern das Ergebnis von `path.resolve()`:
 * Was „..", ein absoluter Pfad oder ein Trennzeichen daraus machen, weiß nur
 * die Auflösung selbst. Der Vergleich hängt `path.sep` an das Ziel an — ohne
 * ihn ließe ein Ordner „/vault/uebergabe-boese" die Prüfung gegen
 * „/vault/uebergabe" bestehen.
 */
export function resolveInside(dir: string, fileName: string): string {
  const wurzel = path.resolve(dir);
  const ziel = path.resolve(wurzel, fileName);

  if (!ziel.startsWith(wurzel + path.sep)) {
    throw new Error(
      `Der Pfad führt aus dem Übergabeordner heraus: ${fileName}`,
    );
  }

  return ziel;
}

/** „2026-09-05" für den ersten Lauf des Tages, „2026-09-05-2" für den zweiten. */
export function folderNameFor(date: string, attempt: number): string {
  return attempt <= 1 ? date : `${date}-${attempt}`;
}

/**
 * Schreibt eine vollständige Übergabe und stellt sie in einem Schritt an ihren
 * Platz.
 *
 * `manifest` ist eine Funktion und kein Text, weil in der MANIFEST.md der Name
 * des Ordners steht, in dem sie liegt — und der steht erst fest, wenn ein
 * freier gefunden ist. Ist der erste vergeben, wird mit dem nächsten Namen neu
 * gefragt, statt eine Datei zu hinterlassen, die auf einen anderen Ordner
 * zeigt als den eigenen.
 */
export async function writeHandover(input: {
  root: string;
  date: string;
  documents: readonly WikiDocument[];
  manifest: (folder: string) => string;
}): Promise<HandoverResult> {
  await assertHandoverRoot(input.root);
  await sweepStale(input.root);

  // Der Zufallsanteil trennt zwei Läufe, die sich überschneiden. Ohne ihn
  // schriebe der zweite in den Ordner des ersten, und beide lieferten die
  // Hälfte.
  const temp = path.join(
    input.root,
    `${TEMP_PREFIX}${input.date}-${randomUUID().slice(0, 8)}`,
  );

  await mkdir(temp);

  try {
    for (const document of input.documents) {
      // "wx" statt "w": Zwei Dokumente mit derselben Kennung wären ein Fehler
      // im Zusammentragen, und stillschweigend zu überschreiben hieße, dass
      // eines davon spurlos verschwindet.
      await writeFile(resolveInside(temp, fileNameFor(document.id)), document.text, {
        encoding: "utf8",
        flag: "wx",
      });
    }

    for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt += 1) {
      const folder = folderNameFor(input.date, attempt);
      const ziel = resolveInside(input.root, folder);

      await writeFile(
        resolveInside(temp, MANIFEST_NAME),
        input.manifest(folder),
        { encoding: "utf8", flag: "w" },
      );

      // `rename` auf ein vorhandenes, nicht leeres Verzeichnis scheitert —
      // genau das soll es. Der vorige Lauf des Tages bleibt unangetastet, der
      // neue nimmt den nächsten Namen.
      try {
        await rename(temp, ziel);
        return {
          folder,
          path: ziel,
          files: input.documents.length + 1,
        };
      } catch (fehler) {
        if (!(await exists(ziel))) throw fehler;
      }
    }

    throw new Error(
      `Kein freier Übergabeordner für ${input.date} — ${MAX_FOLDER_ATTEMPTS} Namen sind vergeben.`,
    );
  } catch (fehler) {
    // Der unfertige Ordner ist ohne den Umzug wertlos. Er wird weggeräumt,
    // damit kein halbes Dutzend Leichen im Vault liegt — und wenn das
    // Wegräumen selbst scheitert, gilt trotzdem der ursprüngliche Fehler.
    await rm(temp, { recursive: true, force: true }).catch(() => {});
    throw fehler;
  }
}

/**
 * Gibt es den Wurzelordner, und ist er einer?
 *
 * Exportiert, weil der Lauf ihn auch dann prüft, wenn nichts zu übergeben ist.
 * Ein „nichts geändert" aus einem Lauf, dessen Vault gar nicht eingehängt war,
 * wäre die falscheste aller Antworten: sie sieht aus wie ein ruhiger Tag.
 */
export async function assertHandoverRoot(root: string): Promise<void> {
  let eintrag;

  try {
    eintrag = await stat(root);
  } catch {
    throw new Error(
      `Den Übergabeordner gibt es nicht: ${root}. Er wird absichtlich nicht angelegt — ` +
        "ein fehlender Ordner heißt meistens, dass der Vault gerade nicht eingehängt ist.",
    );
  }

  if (!eintrag.isDirectory()) {
    throw new Error(`Der Übergabeordner ist kein Ordner: ${root}`);
  }
}

/**
 * Räumt liegengebliebene unfertige Ordner weg — und lässt den Lauf niemals
 * daran scheitern.
 *
 * Aufräumen ist Nebenarbeit. Ein Ordner, der sich nicht löschen lässt, ist
 * kein Grund, die Übergabe des Tages ausfallen zu lassen.
 */
async function sweepStale(root: string): Promise<void> {
  try {
    const eintraege = await readdir(root, { withFileTypes: true });
    const jetzt = Date.now();

    for (const eintrag of eintraege) {
      if (!eintrag.isDirectory()) continue;
      if (!eintrag.name.startsWith(TEMP_PREFIX)) continue;

      const pfad = path.join(root, eintrag.name);
      const alter = jetzt - (await stat(pfad)).mtimeMs;
      if (alter < STALE_MS) continue;

      await rm(pfad, { recursive: true, force: true });
    }
  } catch {
    // Absichtlich still.
  }
}

async function exists(pfad: string): Promise<boolean> {
  try {
    await stat(pfad);
    return true;
  } catch {
    return false;
  }
}
