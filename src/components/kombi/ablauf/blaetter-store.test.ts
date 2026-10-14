import assert from "node:assert/strict";
import { test } from "node:test";

import { dazuAn, dazuStore, seitenFelder } from "@/components/kombi/ablauf/blaetter-store";

test("seitenFelder: neues Blatt legt mit der ersten Seite an, die weiteren hängen daran", () => {
  assert.deepEqual(seitenFelder({ uid: "u1", i: 0, n: 2, blattId: null, dazu: false, ziel: "liste", fehler: null }), { seiten: "2", ziel: "liste", aufnahme: "u1", seite: "0" });
  assert.deepEqual(seitenFelder({ uid: "u1", i: 1, n: 2, blattId: "b1", dazu: false, ziel: "liste", fehler: null }), { attach: "b1", folge: "1", aufnahme: "u1", seite: "1" });
  assert.deepEqual(seitenFelder({ uid: "u1", i: 0, n: 1, blattId: null, dazu: false, ziel: "zeile", fehler: "x" }), { seiten: "1", ziel: "zeile", fehler: "x", aufnahme: "u1", seite: "0" });
});

test("seitenFelder: „Seite dazu“ hängt jede Seite an das vorhandene Blatt, auch nach Neuladen ab Seite 2", () => {
  assert.deepEqual(seitenFelder({ uid: "u1", i: 0, n: 2, blattId: "b1", dazu: true, ziel: "zeile", fehler: null }), { attach: "b1", seiten: "2", aufnahme: "u1", seite: "0" });
  assert.deepEqual(seitenFelder({ uid: "u1", i: 1, n: 2, blattId: "b1", dazu: true, ziel: "zeile", fehler: null }), { attach: "b1", folge: "1", aufnahme: "u1", seite: "1" });
});

test("dazuStore und dazuAn: hängt, solange ein Eintrag hängt, und zählt Angekommenes", () => {
  let gemeldet = 0;
  const ab = dazuStore.subscribe(() => gemeldet++);
  dazuStore.neu({ uid: "u1", id: "b1", lokal: "hochladen", seiten: 1 });
  dazuStore.neu({ uid: "u2", id: "b1", lokal: "hochladen", seiten: 2 });
  assert.deepEqual(dazuAn(dazuStore.get(), "b1"), { lokal: "hochladen", seiten: 3 });
  assert.equal(dazuAn(dazuStore.get(), "b2"), null);
  assert.equal(dazuAn(dazuStore.get(), null), null);

  dazuStore.setzen("u2", "haengt");
  assert.deepEqual(dazuAn(dazuStore.get(), "b1"), { lokal: "haengt", seiten: 3 });
  const vorher = gemeldet;
  dazuStore.setzen("u2", "haengt");
  assert.equal(gemeldet, vorher, "gleicher Stand meldet nichts");

  // derselbe Upload nicht zweimal in der Liste
  dazuStore.neu({ uid: "u2", id: "b1", lokal: "hochladen", seiten: 2 });
  assert.equal(dazuStore.get().liste.length, 2);

  dazuStore.weg("u1", true);
  dazuStore.weg("u2", false);
  assert.equal(dazuAn(dazuStore.get(), "b1"), null);
  assert.equal(dazuStore.get().erledigt, 1);
  ab();
});
