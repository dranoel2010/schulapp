import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraSwipe } from "./camera-swipe";

test("Rechts öffnet die Kamera, links führt zur Übersicht zurück", () => {
  assert.equal(cameraSwipe(1, 100, 100).finish(180, 110), 0);
  assert.equal(cameraSwipe(0, 180, 100).finish(100, 110), 1);
});

test("Tippen, kurze Gesten, falsche Richtung und Tagesablauf wechseln nicht", () => {
  assert.equal(cameraSwipe(1, 100, 100).finish(100, 100), null);
  assert.equal(cameraSwipe(1, 100, 100).finish(140, 100), null);
  assert.equal(cameraSwipe(1, 100, 100).finish(0, 100), null);
  assert.equal(cameraSwipe(0, 100, 100).finish(200, 100), null);
  assert.equal(cameraSwipe(2, 100, 100).finish(200, 100), null);
});

test("Senkrechtes und diagonales Scrollen öffnet keine Kamera", () => {
  assert.equal(cameraSwipe(1, 100, 100).finish(180, 220), null);
  assert.equal(cameraSwipe(1, 100, 100).finish(180, 180), null);
  const gesture = cameraSwipe(1, 100, 100);
  assert.equal(gesture.move(102, 120), false);
  assert.equal(gesture.finish(220, 130), null);
});

test("Leichtes Zittern legt die Richtung noch nicht fest; Loslassen zählt", () => {
  const gesture = cameraSwipe(1, 100, 100);
  assert.equal(gesture.move(101, 104), false);
  assert.equal(gesture.move(130, 105), true);
  assert.equal(gesture.finish(170, 108), 0);
});
