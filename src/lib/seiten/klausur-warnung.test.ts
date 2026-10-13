import assert from "node:assert/strict";
import { test } from "node:test";

import { planWarnungen, warnungText } from "./klausur";

test("nur ein Lerntag, und er gehört schon der Probeklausur: keine Warnung", () => {
  assert.deepEqual(planWarnungen(["tight"], ["2026-10-15"], ["2026-10-15"]), []);
  assert.equal(warnungText(planWarnungen(["tight"], ["2026-10-15"], ["2026-10-15"]), 1), null);
});

test("nur ein Lerntag ohne Probe: die Warnung bleibt", () => {
  assert.deepEqual(planWarnungen(["tight"], ["2026-10-18"], []), ["tight"]);
  assert.deepEqual(planWarnungen(["tight"], ["2026-10-18"], ["2026-10-16"]), ["tight"]);
});

test("andere Warnungen bleiben unberührt", () => {
  assert.deepEqual(planWarnungen(["no-days"], [], ["2026-10-15"]), ["no-days"]);
});
