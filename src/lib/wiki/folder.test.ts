import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { WikiDocument } from "@/lib/wiki/documents";
import { beispielDokumente } from "@/lib/wiki/example";
import {
  MANIFEST_NAME,
  TEMP_PREFIX,
  assertHandoverRoot,
  fileNameFor,
  folderNameFor,
  resolveInside,
  writeHandover,
} from "@/lib/wiki/folder";

const KENNUNG = "blatt-11111111-1111-4111-8111-111111111111";

async function frischerOrdner(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "schulapp-wiki-"));
}

function dokument(id: string, text = "Inhalt\n"): WikiDocument {
  return { id, kind: "blatt", title: "Probe", text };
}

describe("fileNameFor", () => {
  it("hängt .md an die Kennung", () => {
    assert.equal(fileNameFor(KENNUNG), `${KENNUNG}.md`);
  });

  it("weist alles zurück, was kein Dateiname werden darf", () => {
    // Der eigentliche Punkt: Ein Dateiname entsteht nur aus Art und UUID. Ein
    // Fachname oder ein Titel kommt hier gar nicht erst vorbei — und wenn doch
    // etwas ankommt, das so aussieht, ist ein Wurf die richtige Antwort.
    for (const boese of [
      "../../autostart",
      "/etc/passwd",
      "blatt-../../weg",
      `blatt-${KENNUNG}`,
      "blatt",
      "",
      "Deutsch/Französisch",
      `${KENNUNG}/../weg`,
    ]) {
      assert.throws(() => fileNameFor(boese), `durchgelassen: ${boese}`);
    }
  });
});

describe("resolveInside", () => {
  it("gibt den Pfad im Ordner zurück", () => {
    assert.equal(
      resolveInside("/vault/uebergabe", "blatt.md"),
      path.resolve("/vault/uebergabe/blatt.md"),
    );
  });

  it("lässt nichts aus dem Ordner heraus", () => {
    for (const boese of [
      "../weg.md",
      "../../weg.md",
      "/etc/passwd",
      "unterordner/../../weg.md",
      ".",
      "",
    ]) {
      assert.throws(
        () => resolveInside("/vault/uebergabe", boese),
        `durchgelassen: ${boese}`,
      );
    }
  });

  it("verwechselt keinen Nachbarordner mit dem eigenen", () => {
    // Ohne das angehängte Trennzeichen bestünde „/vault/uebergabe-boese" die
    // Prüfung gegen „/vault/uebergabe", weil die eine Zeichenkette mit der
    // anderen beginnt.
    assert.throws(() => resolveInside("/vault/uebergabe", "../uebergabe-boese/x.md"));
  });
});

describe("folderNameFor", () => {
  it("nimmt beim ersten Lauf den blanken Tag", () => {
    assert.equal(folderNameFor("2026-09-05", 1), "2026-09-05");
    assert.equal(folderNameFor("2026-09-05", 2), "2026-09-05-2");
  });
});

describe("assertHandoverRoot", () => {
  it("nimmt einen vorhandenen Ordner an", async () => {
    await assertHandoverRoot(await frischerOrdner());
  });

  it("legt einen fehlenden Ordner nicht an, sondern wirft", async () => {
    // Ein fehlender Ordner heißt meistens: der Vault ist nicht eingehängt. Ihn
    // anzulegen hieße, in ein Loch zu schreiben und es hinterher für geliefert
    // zu halten.
    const fehlt = path.join(await frischerOrdner(), "gibt-es-nicht");

    await assert.rejects(assertHandoverRoot(fehlt), /gibt es nicht/);
  });

  it("weist eine Datei zurück", async () => {
    const datei = path.join(await frischerOrdner(), "keine-mappe");
    await writeFile(datei, "x");

    await assert.rejects(assertHandoverRoot(datei), /kein Ordner/);
  });
});

describe("writeHandover", () => {
  it("legt alle Dateien und die MANIFEST.md ab", async () => {
    const root = await frischerOrdner();
    const documents = beispielDokumente();

    const ergebnis = await writeHandover({
      root,
      date: "2026-09-05",
      documents,
      manifest: () => "# Übergabe\n",
    });

    assert.equal(ergebnis.folder, "2026-09-05");
    assert.equal(ergebnis.files, documents.length + 1);

    const dateien = (await readdir(ergebnis.path)).sort();
    assert.deepEqual(
      dateien,
      [MANIFEST_NAME, ...documents.map((d) => `${d.id}.md`)].sort(),
    );

    const erste = await readFile(
      path.join(ergebnis.path, `${documents[0].id}.md`),
      "utf8",
    );
    assert.equal(erste, documents[0].text);
  });

  it("sagt der MANIFEST.md, in welchem Ordner sie liegt", async () => {
    const root = await frischerOrdner();

    const erster = await writeHandover({
      root,
      date: "2026-09-05",
      documents: [dokument(KENNUNG)],
      manifest: (folder) => `Ordner ${folder}\n`,
    });

    // Zweiter Lauf am selben Tag: Der erste Ordner bleibt unangetastet, der
    // zweite bekommt den nächsten Namen — und seine MANIFEST.md nennt ihn.
    const zweiter = await writeHandover({
      root,
      date: "2026-09-05",
      documents: [dokument(KENNUNG)],
      manifest: (folder) => `Ordner ${folder}\n`,
    });

    assert.equal(zweiter.folder, "2026-09-05-2");
    assert.equal(
      await readFile(path.join(erster.path, MANIFEST_NAME), "utf8"),
      "Ordner 2026-09-05\n",
    );
    assert.equal(
      await readFile(path.join(zweiter.path, MANIFEST_NAME), "utf8"),
      "Ordner 2026-09-05-2\n",
    );
  });

  it("hinterlässt bei einem Abbruch keinen halben Ordner", async () => {
    // Zwei Dokumente mit derselben Kennung — das schlägt beim Schreiben fehl.
    // Danach darf weder ein Übergabeordner dastehen (der Agent läse ein
    // MANIFEST, das mehr verspricht als danebenliegt) noch ein unfertiger.
    const root = await frischerOrdner();

    await assert.rejects(
      writeHandover({
        root,
        date: "2026-09-05",
        documents: [dokument(KENNUNG), dokument(KENNUNG)],
        manifest: () => "# Übergabe\n",
      }),
    );

    assert.deepEqual(await readdir(root), []);
  });

  it("schreibt nichts, wenn eine Kennung kein Dateiname werden darf", async () => {
    const root = await frischerOrdner();

    await assert.rejects(
      writeHandover({
        root,
        date: "2026-09-05",
        documents: [{ ...dokument(KENNUNG), id: "../../autostart" }],
        manifest: () => "# Übergabe\n",
      }),
      /Kennung/,
    );

    assert.deepEqual(await readdir(root), []);
  });

  it("räumt einen alten unfertigen Ordner weg", async () => {
    const root = await frischerOrdner();

    const alt = path.join(root, `${TEMP_PREFIX}2026-08-01-abcdef12`);
    await mkdir(alt);
    await writeFile(path.join(alt, "rest.md"), "halb geschrieben");
    // Zwei Tage zurückdatiert: älter als die Frist, also die Leiche eines
    // abgestürzten Laufs.
    const vorgestern = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(alt, vorgestern, vorgestern);

    const jung = path.join(root, `${TEMP_PREFIX}2026-09-05-12345678`);
    await mkdir(jung);

    await writeHandover({
      root,
      date: "2026-09-05",
      documents: [dokument(KENNUNG)],
      manifest: () => "# Übergabe\n",
    });

    const uebrig = (await readdir(root)).sort();

    // Der alte ist weg, der junge bleibt: Er könnte ein Lauf sein, der gerade
    // parallel schreibt.
    assert.deepEqual(uebrig, [path.basename(jung), "2026-09-05"].sort());
  });
});
