import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createQueue, laterFrist } from "@/lib/calendar/queue";

/**
 * Die Queue der Abgleiche, mit Läufen, die erst fertig werden, wenn der Test
 * es sagt. Geprüft werden die beiden Zusagen aus dem Kopf von queue.ts: Wer
 * sich anhängt, macht den Lauf großzügiger und nie knapper — und wartet selbst
 * nicht länger als seine eigene Geduld.
 */

type Ergebnis = { von: string; frist: number | null } | { von: "zu-lange" };

/** Ein Lauf, den der Test von außen beendet. */
function offenerLauf(von: string) {
  let fertig!: () => void;
  const gestartet: (number | null)[] = [];

  const starte = (frist: number | null) => {
    gestartet.push(frist);
    return new Promise<Ergebnis>((resolve) => {
      fertig = () => resolve({ von, frist });
    });
  };

  return { starte, gestartet, fertig: () => fertig() };
}

const zuLange = (): Ergebnis => ({ von: "zu-lange" });

/** Den Promises einen Takt geben, damit ein Lauf, der dran ist, auch startet. */
const takt = () => new Promise((resolve) => setImmediate(resolve));

describe("laterFrist", () => {
  it("keine Frist schlägt jede, sonst die spätere", () => {
    assert.equal(laterFrist(null, 5), null);
    assert.equal(laterFrist(5, null), null);
    assert.equal(laterFrist(5, 9), 9);
    assert.equal(laterFrist(9, 5), 9);
  });
});

describe("createQueue", () => {
  it("lässt zwei Läufe nacheinander laufen, nie nebeneinander", async () => {
    const queue = createQueue<Ergebnis>();
    const a = offenerLauf("a");
    const b = offenerLauf("b");

    const ersterLauf = queue.request("u1", { frist: null, geduld: null }, a.starte, zuLange);
    await takt();
    const zweiterLauf = queue.request("u2", { frist: null, geduld: null }, b.starte, zuLange);
    await takt();

    assert.equal(a.gestartet.length, 1);
    assert.equal(b.gestartet.length, 0, "b wartet, solange a läuft");
    assert.ok(queue.busy("u2"));

    a.fertig();
    assert.equal((await ersterLauf).von, "a");
    await takt();
    assert.equal(b.gestartet.length, 1);

    b.fertig();
    assert.equal((await zweiterLauf).von, "b");
    assert.ok(!queue.busy("u1"));
    assert.ok(!queue.busy("u2"));
  });

  it("hängt eine Änderung an einen wartenden Knopfdruck — und der Lauf bekommt keine knappe Frist", async () => {
    const queue = createQueue<Ergebnis>();
    const vorher = offenerLauf("vorher");
    const knopf = offenerLauf("knopf");
    const aenderung = offenerLauf("aenderung");
    const jetzt = Date.now();

    queue.request("u", { frist: null, geduld: null }, vorher.starte, zuLange);
    await takt();

    // Der Knopf wartet hinter dem laufenden Lauf, mit 25 Sekunden Frist …
    void queue.request("u", { frist: jetzt + 25_000, geduld: null }, knopf.starte, zuLange);
    // … und eine Änderung hängt sich an ihn.
    const nachAenderung = queue.request("u", { frist: null, geduld: null }, aenderung.starte, zuLange);

    vorher.fertig();
    await takt();

    assert.deepEqual(knopf.gestartet, [null], "die großzügigste Frist gilt: keine");
    assert.equal(aenderung.gestartet.length, 0, "kein zweiter Lauf — angehängt");

    knopf.fertig();
    assert.deepEqual(await nachAenderung, { von: "knopf", frist: null });
  });

  it("nimmt von zwei Fristen die spätere", async () => {
    const queue = createQueue<Ergebnis>();
    const vorher = offenerLauf("vorher");
    const wartend = offenerLauf("wartend");

    queue.request("u", { frist: null, geduld: null }, vorher.starte, zuLange);
    await takt();
    void queue.request("u", { frist: 1_000, geduld: null }, wartend.starte, zuLange);
    void queue.request("u", { frist: 5_000, geduld: null }, wartend.starte, zuLange);
    void queue.request("u", { frist: 3_000, geduld: null }, wartend.starte, zuLange);

    vorher.fertig();
    await takt();

    assert.deepEqual(wartend.gestartet, [5_000]);
    wartend.fertig();
  });

  it("wartet nur so lange, wie die eigene Geduld reicht — der Lauf arbeitet weiter", async () => {
    const queue = createQueue<Ergebnis>();
    const lang = offenerLauf("lang");

    const geduldig = queue.request("u", { frist: null, geduld: null }, lang.starte, zuLange);
    await takt();

    const knopf = await queue.request(
      "u",
      { frist: Date.now() + 10, geduld: Date.now() + 20 },
      lang.starte,
      zuLange,
    );

    assert.deepEqual(knopf, { von: "zu-lange" });
    assert.ok(queue.busy("u"), "der lange Lauf läuft noch");

    lang.fertig();
    assert.equal((await geduldig).von, "lang");
  });

  it("gibt das Ergebnis zurück, wenn der Lauf vor dem Ende der Geduld fertig ist", async () => {
    const queue = createQueue<Ergebnis>();
    const kurz = offenerLauf("kurz");

    const knopf = queue.request(
      "u",
      { frist: Date.now() + 25_000, geduld: Date.now() + 60_000 },
      kurz.starte,
      zuLange,
    );
    await takt();
    kurz.fertig();

    assert.equal((await knopf).von, "kurz");
  });

  it("hält die Queue am Leben, wenn ein Lauf wirft", async () => {
    const queue = createQueue<Ergebnis>();
    const danach = offenerLauf("danach");

    const kaputt = queue.request(
      "u",
      { frist: null, geduld: null },
      async () => {
        throw new Error("kaputt");
      },
      zuLange,
    );
    await assert.rejects(kaputt, /kaputt/);

    const weiter = queue.request("u", { frist: null, geduld: null }, danach.starte, zuLange);
    await takt();
    danach.fertig();

    assert.equal((await weiter).von, "danach");
    assert.ok(!queue.busy("u"));
  });
});
