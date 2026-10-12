import { dbBereit, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  ablaufSchritt,
  ablaufStand,
  eingetragenHeute,
  lernblockEreignisseLoeschen,
  protokollieren,
  protokollLoeschen,
  protokollVomTag,
  type ProtokollTyp,
} from "@/lib/protokoll";

const TAG = "2026-10-12";
let nutzer = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
});

describe("Tagesprotokoll", () => {
  it("weist einen unbekannten Typ ab, bevor etwas gespeichert wird", async () => {
    await assert.rejects(
      protokollieren(nutzer, TAG, "erfunden" as ProtokollTyp),
    );
    assert.equal((await protokollVomTag(nutzer, TAG)).length, 0);
  });

  it("Ablauf: ohne Eintrag offen, übersprungen, dann erledigt", async () => {
    const tag = "2026-10-13";
    assert.equal(await ablaufStand(nutzer, tag), null);
    assert.equal(await ablaufSchritt(nutzer, tag), "blaetter");

    await protokollieren(nutzer, tag, "ablauf_schritt", "ha");
    assert.equal(await ablaufSchritt(nutzer, tag), "ha");

    const ueber = await protokollieren(nutzer, tag, "ablauf_uebersprungen");
    assert.equal(await ablaufStand(nutzer, tag), "übersprungen");

    await protokollieren(nutzer, tag, "ablauf_beendet");
    assert.equal(await ablaufStand(nutzer, tag), "erledigt");

    // Ein anderer Tag sieht davon nichts.
    assert.equal(await ablaufStand(nutzer, "2026-10-14"), null);

    await protokollLoeschen(nutzer, ueber);
    assert.equal(await ablaufStand(nutzer, tag), "erledigt");
  });

  it("eingetragenHeute: eingetragen minus gelöscht, Rückgängig zählt wieder einmal", async () => {
    const tag = "2026-10-15";
    await protokollieren(nutzer, tag, "aufgabe_eingetragen", "a1");
    await protokollieren(nutzer, tag, "aufgabe_eingetragen", "a2");
    const weg = await protokollieren(nutzer, tag, "aufgabe_geloescht", "a1");
    assert.deepEqual(await eingetragenHeute(nutzer, tag), ["a2"]);

    // Rückgängig beim Löschen: die Aufgabe steht mit alter ID wieder da,
    // der Eintrag aufgabe_geloescht geht.
    await protokollLoeschen(nutzer, weg);
    assert.deepEqual(await eingetragenHeute(nutzer, tag), ["a1", "a2"]);
  });

  it("Block unter einer Minute beendet: keine Spur seiner Ereignisse", async () => {
    const tag = "2026-10-16";
    await protokollieren(nutzer, tag, "lernblock_gestartet", "b1");
    await protokollieren(nutzer, tag, "lernblock_pausiert", "b1");
    await protokollieren(nutzer, tag, "lernblock_gestartet", "b2");
    await protokollieren(nutzer, tag, "thema_beendet", "b1", { n: 3 });

    assert.equal(await lernblockEreignisseLoeschen(nutzer, tag, "b1"), 2);
    const rest = (await protokollVomTag(nutzer, tag)).map((e) => `${e.typ}:${e.ref}`);
    assert.deepEqual(rest, ["lernblock_gestartet:b2", "thema_beendet:b1"]);
  });

  it("Löschen trifft nur den eigenen Nutzer", async () => {
    const fremd = await testNutzer("Fremd");
    const id = await protokollieren(nutzer, "2026-10-17", "blatt_gedruckt", "t1");
    await protokollLoeschen(fremd, id);
    assert.equal((await protokollVomTag(nutzer, "2026-10-17")).length, 1);
  });
});
