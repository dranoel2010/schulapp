import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { packhilfe, type MorgenT, type TagDaten } from "@/lib/kombi/startseite";

/**
 * Die Packhilfe am Rechner (rechte Spalte von „Heute“): morgens vor der
 * Schule die Stunden von heute, sonst der nächste Schultag, in den Ferien
 * nichts.
 */

const morgen = (tag: string): MorgenT => ({
  tag,
  stunden: [{ nr: 1, von: "08:00", fach: "Mathematik", raum: "204", hu: null }],
  klausur: null,
});

type Teil = Pick<TagDaten, "ferien" | "schultag" | "nachSchluss" | "morgens" | "frueh">;
const tag = (t: Partial<Teil> = {}): Teil => ({
  ferien: null,
  schultag: true,
  nachSchluss: false,
  morgens: morgen("2026-10-14"),
  frueh: morgen("2026-10-15"),
  ...t,
});

describe("packhilfe", () => {
  it("zeigt morgens vor der Schule die Stunden von heute", () => {
    assert.equal(packhilfe("morgens", tag())?.tag, "2026-10-14");
  });

  it("zeigt nach der Schule den nächsten Schultag", () => {
    assert.equal(packhilfe("ueberblick", tag({ nachSchluss: true }))?.tag, "2026-10-15");
    assert.equal(packhilfe("ablauf", tag({ nachSchluss: true }))?.tag, "2026-10-15");
    assert.equal(packhilfe("frueh", tag({ nachSchluss: true }))?.tag, "2026-10-15");
  });

  it("nimmt am Morgen den nächsten Schultag, wenn heute keine Schule ist oder sie schon vorbei ist", () => {
    assert.equal(packhilfe("morgens", tag({ schultag: false }))?.tag, "2026-10-15");
    assert.equal(packhilfe("morgens", tag({ nachSchluss: true }))?.tag, "2026-10-15");
  });

  it("nimmt den nächsten Schultag, solange noch keine Ansicht feststeht", () => {
    assert.equal(packhilfe(null, tag())?.tag, "2026-10-15");
  });

  it("zeigt in den Ferien nichts", () => {
    const ferien = { bis: "2026-10-25", titel: "Herbstferien" };
    assert.equal(packhilfe("ueberblick", tag({ ferien })), null);
    assert.equal(packhilfe("morgens", tag({ ferien })), null);
  });
});
