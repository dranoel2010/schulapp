import assert from "node:assert/strict";
import { test } from "node:test";

import { auswahlZiel, BEREICHE, detailFuerAuswahl, zielFuerArt, zielFuerPfad } from "./bereiche";

const ID = "3824cac8-1831-4e08-9072-ca6181d8853f";

test("Seitenleiste: sieben Bereiche mit Ziffer, Einstellungen ohne", () => {
  assert.deepEqual(
    BEREICHE.map((b) => [b.key, b.taste]),
    [
      ["heute", 1],
      ["hausaufgaben", 2],
      ["klausuren", 3],
      ["woche", 4],
      ["ablage", 5],
      ["faecher", 6],
      ["noten", 7],
      ["einstellungen", null],
    ],
  );
});

test("Art → Bereich: Listen sind ihre eigene Liste, Details liegen rechts neben ihrer Liste", () => {
  assert.deepEqual(zielFuerArt("klausuren"), { bereich: "klausuren", lage: "split", liste: "eigen", sel: null, detail: null });
  assert.deepEqual(zielFuerArt("klausur", { id: ID }), {
    bereich: "klausuren",
    lage: "split",
    liste: { art: "klausuren", params: {} },
    sel: ID,
    detail: "eigen",
  });
  assert.deepEqual(zielFuerArt("blatt", { id: ID }).liste, { art: "ablage", params: {} });
  assert.equal(zielFuerArt("blatt", { id: ID }).bereich, "ablage");
  assert.equal(zielFuerArt("fach", { id: ID }).bereich, "faecher");
  assert.equal(zielFuerArt("notenfach", { id: ID }).bereich, "noten");
  assert.equal(zielFuerArt("notenfach", { id: ID }).sel, ID);
});

test("Art → Bereich: Woche ist eine Fläche, Heute die Startseite, Unbekanntes eine Spalte", () => {
  assert.deepEqual(zielFuerArt("woche", { tag: "2026-10-19" }), { bereich: "woche", lage: "scroll", liste: null, sel: null, detail: "eigen" });
  assert.equal(zielFuerArt("heute").lage, "heute");
  assert.deepEqual(zielFuerArt("probe"), { bereich: null, lage: "spalte", liste: null, sel: null, detail: "eigen" });
});

test("Auswahl über sel: die Liste bleibt, das Detail kommt aus der Registry oder vom Teil", () => {
  assert.deepEqual(zielFuerArt("klausuren", { sel: ID }).detail, { art: "klausur", params: { id: ID } });
  assert.deepEqual(zielFuerArt("hausaufgaben", { sel: ID }), { bereich: "hausaufgaben", lage: "split", liste: "eigen", sel: ID, detail: "slot" });
  assert.equal(zielFuerArt("einstellungen", { sel: "tastatur" }).sel, "tastatur");
  // die Ablage behält ihren Filter: sie ist ihre eigene Liste
  assert.deepEqual(zielFuerArt("ablage", { fach: ID }).liste, "eigen");
  assert.equal(detailFuerAuswahl("hausaufgaben", ID), "slot");
  assert.deepEqual(detailFuerAuswahl("noten", ID), { art: "notenfach", params: { id: ID } });
});

test("Archiv: Liste der Hausaufgaben, das Archiv im Detail", () => {
  assert.deepEqual(zielFuerArt("archiv"), {
    bereich: "hausaufgaben",
    lage: "split",
    liste: { art: "hausaufgaben", params: {} },
    sel: null,
    detail: "eigen",
  });
  assert.deepEqual(zielFuerPfad("/archiv"), zielFuerArt("archiv"));
});

test("Formulare: Liste ihres Bereichs, das Formular im Detail", () => {
  const liste = (art: string) => ({ art, params: {} });
  assert.deepEqual(zielFuerPfad("/hausaufgaben/neu"), { bereich: "hausaufgaben", lage: "split", liste: liste("hausaufgaben"), sel: null, detail: "eigen" });
  // eine Aufgabe antippen heißt bearbeiten: /hausaufgaben/<id> ist das Formular
  assert.deepEqual(zielFuerPfad(`/hausaufgaben/${ID}`), { bereich: "hausaufgaben", lage: "split", liste: liste("hausaufgaben"), sel: ID, detail: "eigen" });
  assert.deepEqual(zielFuerPfad("/klausuren/neu"), { bereich: "klausuren", lage: "split", liste: liste("klausuren"), sel: null, detail: "eigen" });
  assert.deepEqual(zielFuerPfad(`/klausuren/${ID}/bearbeiten`), { bereich: "klausuren", lage: "split", liste: liste("klausuren"), sel: ID, detail: "eigen" });
  assert.deepEqual(zielFuerPfad("/noten/neu"), { bereich: "noten", lage: "split", liste: liste("noten"), sel: null, detail: "eigen" });
  assert.deepEqual(zielFuerPfad(`/noten/fach/${ID}/ziel`).sel, ID);
  assert.deepEqual(zielFuerPfad("/faecher/neu").liste, liste("faecher"));
  assert.deepEqual(zielFuerPfad(`/faecher/${ID}/themen`).sel, ID);
  assert.deepEqual(zielFuerPfad(`/material/${ID}/bearbeiten`).sel, ID);
});

test("Direktaufruf einer Detailseite: dieselbe Lage wie über openPage", () => {
  const ueberPfad = zielFuerPfad(`/klausuren/${ID}`);
  const ueberArt = zielFuerArt("klausur", { id: ID });
  assert.deepEqual(ueberPfad, ueberArt);
  assert.deepEqual(zielFuerPfad(`/material/${ID}`), zielFuerArt("blatt", { id: ID }));
  assert.deepEqual(zielFuerPfad(`/faecher/${ID}`), zielFuerArt("fach", { id: ID }));
  assert.deepEqual(zielFuerPfad(`/noten/fach/${ID}`), zielFuerArt("notenfach", { id: ID }));
  assert.deepEqual(zielFuerPfad("/klausuren", `sel=${ID}`), zielFuerArt("klausuren", { sel: ID }));
  assert.deepEqual(zielFuerPfad("/hausaufgaben", `sel=${ID}`), zielFuerArt("hausaufgaben", { sel: ID }));
});

test("Eingangskorb: Ablage mit dem Eingang im Detail", () => {
  for (const pfad of ["/material/eingang", `/material/eingang/${ID}`, "/material/eingang/neu"]) {
    assert.deepEqual(zielFuerPfad(pfad), { bereich: "ablage", lage: "split", liste: { art: "ablage", params: {} }, sel: null, detail: "eigen" });
  }
});

test("Einstellungen: die Unterseite ist die Auswahl, im Detail steht ihre Route", () => {
  for (const sub of ["konto", "kalender", "iserv", "erinnerungen", "abschrift", "daten", "installieren", "verbindungen"]) {
    assert.deepEqual(zielFuerPfad(`/einstellungen/${sub}`), {
      bereich: "einstellungen",
      lage: "split",
      liste: { art: "einstellungen", params: {} },
      sel: sub,
      detail: "eigen",
    });
  }
  assert.deepEqual(zielFuerPfad("/einstellungen"), zielFuerArt("einstellungen"));
  assert.deepEqual(auswahlZiel("einstellungen", "konto"), { url: "/einstellungen/konto" });
});

test("Ohne Bereich: Startseite, Spalte für Ablauf-nahe Seiten, Woche bleibt markiert", () => {
  assert.equal(zielFuerPfad("/").lage, "heute");
  assert.equal(zielFuerPfad("/stundenplan").lage, "scroll");
  assert.deepEqual(zielFuerPfad("/stundenplan/bearbeiten"), { bereich: "woche", lage: "spalte", liste: null, sel: null, detail: "eigen" });
  for (const pfad of ["/abruf/klausur", "/abruf/bausteine", "/lernen", "/kombi-probe"]) {
    assert.equal(zielFuerPfad(pfad).lage, "spalte", pfad);
    assert.equal(zielFuerPfad(pfad).bereich, null, pfad);
  }
});

test("Auswahlziel je Bereich", () => {
  assert.deepEqual(auswahlZiel("klausuren", ID), { art: "klausur", params: { id: ID } });
  assert.deepEqual(auswahlZiel("ablage", ID), { art: "blatt", params: { id: ID } });
  assert.deepEqual(auswahlZiel("hausaufgaben", ID), { art: "hausaufgaben", params: { sel: ID } });
  assert.equal(auswahlZiel("woche", ID), null);
});
