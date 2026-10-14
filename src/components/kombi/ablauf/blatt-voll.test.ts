import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  blaetterStore,
  blattHochladen,
  blattNachAblehnung,
  seitenDazu,
  ueberlaufFelder,
  ueberlaufHoeren,
  type Aufnahme,
} from "@/components/kombi/ablauf/blaetter-store";
import { BLATT_VOLL } from "@/lib/images";

/**
 * Abnahmerunde 19: Nimmt der Server keine Seite mehr an ein Blatt (409
 * `voll`), wird die Aufnahme ein neues Blatt, statt verloren zu gehen. Was
 * schon ankam, bleibt in der Liste.
 */

type Anfrage = Record<string, string>;
let anfragen: Anfrage[] = [];
let antworten: ((f: Anfrage) => { status: number; json: unknown })[] = [];
const echteFetch = globalThis.fetch;

const kurz = (id: string, seiten: number) => ({ id, seiten, titel: "Blatt", fach: null, themen: [], status: "wartet" });

function aufnahme(): Aufnahme {
  const b = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
  return { bild: "data:image/jpeg;base64,AA==", fassungen: Promise.resolve({ image: b, reading: b, thumb: b, width: 10, height: 14 }) };
}

beforeEach(() => {
  anfragen = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
    const felder: Anfrage = {};
    for (const [k, v] of init.body.entries()) if (typeof v === "string") felder[k] = v;
    anfragen.push(felder);
    const a = antworten.shift();
    assert.ok(a, "unerwartete Anfrage");
    const { status, json } = a(felder);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = echteFetch;
  for (const b of blaetterStore.get()) blaetterStore.weg(b.key);
});

test("ueberlaufFelder: ohne attach, mit der Zahl der übrigen Seiten und derselben Kennung", () => {
  assert.deepEqual(ueberlaufFelder({ uid: "u1", i: 2, n: 1, ziel: "zeile" }), { seiten: "1", ziel: "zeile", aufnahme: "u1", seite: "2" });
});

test("„Seite dazu“ an ein volles Blatt: das Foto wird ein neues Blatt, mit Toast", async () => {
  const gemeldet: string[] = [];
  const ab = ueberlaufHoeren((t) => gemeldet.push(t));
  antworten = [
    () => ({ status: 409, json: { message: BLATT_VOLL, voll: true } }),
    () => ({ status: 200, json: kurz("neu", 1) }),
  ];
  await seitenDazu("voll", [aufnahme()], "2026-10-15");
  ab();
  assert.equal(anfragen[0].attach, "voll");
  assert.equal(anfragen[1].attach, undefined);
  assert.equal(anfragen[1].seiten, "1");
  assert.equal(anfragen[1].aufnahme, anfragen[0].aufnahme);
  const neu = blaetterStore.get().find((b) => b.id === "neu");
  assert.ok(neu, "das neue Blatt steht in der Liste");
  assert.equal(neu.lokal, null);
  assert.equal(neu.tag, "2026-10-15");
  assert.deepEqual(gemeldet, [BLATT_VOLL]);
});

test("neues Blatt, das unterwegs voll wird: der angekommene Teil bleibt, der Rest wird ein zweites Blatt", async () => {
  antworten = [
    () => ({ status: 200, json: kurz("a", 1) }),
    () => ({ status: 409, json: { message: BLATT_VOLL, voll: true } }),
    () => ({ status: 200, json: kurz("b", 1) }),
    (f) => {
      assert.equal(f.attach, "b");
      return { status: 200, json: kurz("b", 2) };
    },
  ];
  const e = blaetterStore.neu({ id: null, lokal: "hochladen", bild: "x", seiten: 3, order: 1, kurz: null, tag: "2026-10-15" });
  const k = await blattHochladen(e.key, [aufnahme(), aufnahme(), aufnahme()], "liste");
  assert.equal(k.id, "a");
  const a = blaetterStore.get().find((b) => b.key === e.key);
  assert.equal(a?.id, "a");
  assert.equal(a?.kurz?.id, "a");
  assert.equal(a?.lokal, null);
  const b = blaetterStore.get().find((x) => x.id === "b");
  assert.equal(b?.seiten, 2);
  assert.equal(b?.tag, "2026-10-15");
});

test("andere Ablehnung nach der ersten Seite: die Zeile des Blatts bleibt stehen", () => {
  const mit = blaetterStore.neu({ id: "a", lokal: "hochladen", bild: "x", seiten: 2, order: 1, kurz: null, tag: null });
  const ohne = blaetterStore.neu({ id: null, lokal: "hochladen", bild: "x", seiten: 1, order: 2, kurz: null, tag: null });
  blattNachAblehnung(mit.key);
  blattNachAblehnung(ohne.key);
  assert.equal(blaetterStore.get().find((b) => b.key === mit.key)?.lokal, null);
  assert.equal(blaetterStore.get().find((b) => b.key === ohne.key), undefined);
});
