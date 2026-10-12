import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dm, fx, fxTeile, kurz, lang, tn, uhrzeit, voll, wd, weekdayOrDate } from "@/lib/kombi/text";

function inZone<T>(tz: string, f: () => T): T {
  const vorher = process.env.TZ;
  process.env.TZ = tz;
  try {
    return f();
  } finally {
    if (vorher === undefined) delete process.env.TZ;
    else process.env.TZ = vorher;
  }
}

const alle = () => [
  voll("2026-10-12"),
  lang("2026-10-19"),
  kurz("2026-10-13"),
  dm("2026-12-31"),
  String(wd("2026-10-17")),
  weekdayOrDate("2026-10-16", "2026-10-12"),
  weekdayOrDate("2026-10-19", "2026-10-12"),
  uhrzeit(new Date("2026-10-12T14:40:00Z")),
  uhrzeit(new Date("2026-03-29T01:30:00Z")),
];

describe("Datumsformate (Plan A)", () => {
  it("Wortlaut wie im Prototyp", () => {
    assert.equal(voll("2026-10-12"), "Montag, 12. Oktober");
    assert.equal(lang("2026-10-19"), "Montag, 19.10.");
    assert.equal(kurz("2026-10-13"), "Di 13.10.");
    assert.equal(weekdayOrDate("2026-10-16", "2026-10-12"), "Freitag");
    assert.equal(weekdayOrDate("2026-10-19", "2026-10-12"), "Montag, 19.10.");
    assert.equal(uhrzeit(new Date("2026-10-12T14:40:00Z")), "16:40");
  });

  it("in UTC und in Berlin gleich", () => {
    const utc = inZone("UTC", alle);
    const berlin = inZone("Europe/Berlin", alle);
    const tokio = inZone("Asia/Tokyo", alle);
    assert.deepEqual(utc, berlin);
    assert.deepEqual(utc, tokio);
  });
});

describe("Texthelfer", () => {
  it("tn und fx maskieren und markieren", () => {
    assert.equal(tn("16:40"), '16<span class="c">:</span>40');
    assert.equal(fx("<b>"), "&lt;b&gt;");
    assert.equal(fx("{f(x)} ist"), '<span class="f-in lead">f(x)</span> ist');
  });

  it("fxTeile zerlegt ohne HTML", () => {
    assert.deepEqual(fxTeile("a {x} b"), [
      { text: "a ", formel: false, lead: false },
      { text: "x", formel: true, lead: false },
      { text: " b", formel: false, lead: false },
    ]);
  });
});
