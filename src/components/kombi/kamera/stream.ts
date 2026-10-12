"use client";

/**
 * Der Kamerastrom (Prototyp `warmCamera`, Z. 3372): schon bei `pointerdown`
 * auf den Kameraknopf oder den Sucher angefragt, damit zwischen Tipp und
 * erstem Bild höchstens 1,5 s liegen (Kriterium 55). Ein Strom für alle
 * Einstiege; die Kamera schließt ihn beim Zumachen.
 *
 * `ideal` und nicht `exact`, wie in @/components/material/camera: ein Gerät
 * ohne Rückkamera bekommt die vordere, und die Auflösung ist die, die das
 * Abschreiben braucht.
 */
let stromP: Promise<MediaStream> | null = null;
let strom: MediaStream | null = null;
let inGebrauch = false;
let ungenutzt: ReturnType<typeof setTimeout> | undefined;

/** Die Kamera ist offen (oder wieder zu): ein vorgewärmter Strom ohne Kamera geht nach 5 s aus. */
export function kameraInGebrauch(ja: boolean): void {
  inGebrauch = ja;
  clearTimeout(ungenutzt);
}

export function warmCamera(): Promise<MediaStream> {
  if (stromP) return stromP;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    stromP = Promise.reject(new Error("keine Kamera"));
  } else {
    const p: Promise<MediaStream> = navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        audio: false,
      })
      .then((s) => {
        // inzwischen wieder zugemacht: dieser Strom gehört niemandem mehr
        if (stromP !== p) {
          s.getTracks().forEach((t) => t.stop());
          throw new Error("Kamera schon wieder zu");
        }
        strom = s;
        return s;
      });
    stromP = p;
  }
  stromP.catch(() => {});
  clearTimeout(ungenutzt);
  if (!inGebrauch) {
    // vorgewärmt, aber nicht geöffnet (Finger glitt ab): das Lämpchen geht wieder aus
    ungenutzt = setTimeout(() => {
      if (!inGebrauch) stopCamera();
    }, 5000);
  }
  return stromP;
}

export function stopCamera(): void {
  clearTimeout(ungenutzt);
  if (strom) strom.getTracks().forEach((t) => t.stop());
  strom = null;
  stromP = null;
}
