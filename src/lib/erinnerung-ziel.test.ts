import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { bloeckeZumErinnern, zielCountdown, zielHeuteLernen } from "@/lib/erinnerung-ziel";

describe("Ziele der Push-Erinnerungen (Abschnitt F)", () => {
  it("„Heute lernen“: eine Klausur → ihre Seite, mehrere → Überblick", () => {
    assert.equal(zielHeuteLernen([{ examId: "a" }]), "/klausuren/a");
    assert.equal(zielHeuteLernen([{ examId: "a" }, { examId: "a" }]), "/klausuren/a");
    assert.equal(zielHeuteLernen([{ examId: "a" }, { examId: "b" }]), "/");
  });

  it("Countdown: eine Klausur → ihre Seite, mehrere → /klausuren", () => {
    assert.equal(zielCountdown([{ id: "k" }]), "/klausuren/k");
    assert.equal(zielCountdown([{ id: "k" }, { id: "l" }]), "/klausuren");
  });

  it("keine Erinnerung zeigt mehr auf /lernen, die Testbenachrichtigung auf /", () => {
    const wurzel = process.cwd();
    const cron = readFileSync(path.join(wurzel, "src/app/api/cron/reminders/route.ts"), "utf8");
    assert.ok(!cron.includes('"/lernen"'));
    const test = readFileSync(path.join(wurzel, "src/app/api/push/test/route.ts"), "utf8");
    assert.match(test, /url: "\/",/);
  });

  it("am freien Tag nur die Probeklausur (letzter Ferientag), sonst alle offenen", () => {
    const bloecke = [
      { id: "l", status: "open", kind: "learn" },
      { id: "p", status: "open", kind: "probe" },
      { id: "e", status: "done", kind: "review" },
    ];
    assert.deepEqual(bloeckeZumErinnern(bloecke, false).map((b) => b.id), ["l", "p"]);
    assert.deepEqual(bloeckeZumErinnern(bloecke, true).map((b) => b.id), ["p"]);
    assert.deepEqual(bloeckeZumErinnern([{ status: "done", kind: "probe" }], true), []);
  });
});
