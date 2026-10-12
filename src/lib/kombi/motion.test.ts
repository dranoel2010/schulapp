import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { E, rubber, spring, SPRING } from "@/lib/kombi/motion";

describe("Bewegung (Plan A)", () => {
  it("die Feder ergibt 392 ms und 47 Punkte", () => {
    assert.equal(SPRING.duration, 392);
    assert.equal(SPRING.punkte, 47);
    assert.ok(SPRING.easing.startsWith("linear(0, 0.0361, "));
    assert.ok(SPRING.easing.endsWith(", 1.0000)"));
    assert.deepEqual(spring(520, 42), SPRING);
  });

  it("dieselbe Feder steht als --ease-spring in globals.css", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    assert.ok(css.includes(`--ease-spring:${SPRING.easing};`));
    assert.ok(css.includes("--dur-spring:392ms;"));
  });

  it("die Kurven sind die Tokens aus globals.css", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    for (const [name, wert] of Object.entries(E)) {
      assert.ok(css.includes(`--ease-${name}:${wert};`), name);
    }
  });

  it("Gummiband wird zäher", () => {
    assert.equal(rubber(0, 300, 0.35), 0);
    assert.ok(rubber(100, 300, 0.35) < 100 * 0.35);
    assert.ok(rubber(-100, 300, 0.35) < 0);
  });
});
