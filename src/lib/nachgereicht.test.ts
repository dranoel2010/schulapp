import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TOOLS, toolList } from "@/lib/mcp/tools";
import { seitenIds } from "@/lib/materials";

/**
 * Die nachgereichten Seiten, soweit sie sich ohne Datenbank prüfen lassen
 * (4.10.2026).
 *
 * Die Regel selbst — welche Seite als nachgereicht und ungelesen zählt — ist
 * SQL (`nachgereichtUngelesen()` in @/lib/materials) und gehört in einen Lauf
 * gegen eine echte Datenbank, so wie scripts/probe-abschrift.mts es vormacht.
 * Hier stehen die beiden Ränder davor und dahinter: wie die ids aus der
 * Abfrage wieder zur Liste werden, und wie der Postbote danach fragen darf.
 */

describe("seitenIds", () => {
  it("macht aus nichts die leere Liste und keine Seite ohne id", () => {
    assert.deepEqual(seitenIds(""), []);
    assert.deepEqual(seitenIds(null), []);
    assert.deepEqual(seitenIds(undefined), []);
  });

  it("behält die Reihenfolge, in der die Abfrage sie liefert", () => {
    const a = "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34";
    const b = "0b1e2d3c-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

    assert.deepEqual(seitenIds(a), [a]);
    assert.deepEqual(seitenIds(`${b},${a}`), [b, a]);
  });
});

describe("read_material mit nachgereicht", () => {
  const args = TOOLS.read_material.args;

  it("nimmt `nachgereicht: true` an, allein und neben den anderen Filtern", () => {
    assert.equal(args.safeParse({ nachgereicht: true }).success, true);
    assert.equal(
      args.safeParse({ nachgereicht: true, subject: "Mathe", limit: 5 }).success,
      true,
    );
  });

  it("kennt nur `true` — `false` hieße dasselbe wie Weglassen", () => {
    assert.equal(args.safeParse({ nachgereicht: false }).success, false);
    assert.equal(args.safeParse({ nachgereicht: "ja" }).success, false);
  });

  it("bleibt streng: ein unbekanntes Argument wird weiter abgewiesen", () => {
    assert.equal(
      args.safeParse({ nachgereicht: true, nachgereichte: true }).success,
      false,
    );
  });

  it("zeigt das Argument im Verzeichnis, als freiwillig", () => {
    const eintrag = toolList().find((tool) => tool.name === "read_material");
    const schema = eintrag?.inputSchema as {
      properties: Record<string, { const?: unknown }>;
      required?: string[];
    };

    assert.equal(schema.properties.nachgereicht?.const, true);
    assert.equal(schema.required?.includes("nachgereicht") ?? false, false);
  });
});
