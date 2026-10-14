"use client";

import { blaetterStore, blattHochladen, blattNachAblehnung, type Aufnahme } from "@/components/kombi/ablauf/blaetter-store";
import { prepareFile } from "@/components/material/prepare-page";
import { cap, zahl } from "@/lib/kombi/text";

/**
 * Hochladen statt Kamera (EINBAU.md „Am Rechner“): Dateien gehen denselben
 * Weg wie die Fotos der Kamera (`blattHochladen`: erst IndexedDB, dann der
 * Server, Jev ordnet ein). Jede Gruppe wird ein Blatt, jede Datei einer
 * Gruppe eine Seite davon. Ob mehrere Bilder ein Blatt oder mehrere sind,
 * fragt der Teil „Ablage“ (er hängt sich über `registriere("hochladen")` vor);
 * ohne ihn wird jede Datei ein eigenes Blatt.
 */

/** Vorschaubild wie die Kamera (`grab`): 360 px breit, A4-Format, JPEG. */
async function vorschau(datei: File): Promise<string> {
  const url = URL.createObjectURL(datei);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = Math.round(360 * 1.414);
    const x = c.getContext("2d");
    if (!x) return "";
    const w = img.naturalWidth || 300;
    const h = img.naturalHeight || 424;
    const r = Math.max(c.width / w, c.height / h);
    x.drawImage(img, (c.width - w * r) / 2, (c.height - h * r) / 2, w * r, h * r);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type AblegenDeps = {
  /** App-Tag des Servers (Testuhr eingeschlossen) */
  tag: string | null;
  toast: (text: string, fn?: (() => void) | null, desc?: string, label?: string) => void;
  openPage: (art: string, params?: Record<string, string>) => void;
  neuLaden: () => Promise<void>;
};

/** Legt je Gruppe ein Blatt an; der Toast „Blatt abgelegt · Ansehen“ wie nach der Kamera. */
export async function dateienAblegen(gruppen: File[][], deps: AblegenDeps): Promise<void> {
  const nurBilder = gruppen.map((g) => g.filter((f) => f.type.startsWith("image/"))).filter((g) => g.length);
  if (!nurBilder.length) {
    deps.toast(gruppen.flat().length === 1 ? "Das ist kein Bild." : "Darunter ist kein Bild.");
    return;
  }
  const base = Date.now();
  const keys: string[] = [];
  const uploads = await Promise.all(
    nurBilder.map(async (g, i) => {
      const seiten: Aufnahme[] = await Promise.all(
        g.map(async (f) => {
          const fassungen = prepareFile(f);
          fassungen.catch(() => {});
          return { bild: await vorschau(f), fassungen };
        }),
      );
      const eintrag = blaetterStore.neu({ id: null, lokal: "hochladen", bild: seiten[0].bild, seiten: seiten.length, order: base + i, kurz: null, tag: deps.tag });
      keys.push(eintrag.key);
      return blattHochladen(eintrag.key, seiten, "zeile").catch((e: unknown) => {
        blattNachAblehnung(eintrag.key);
        deps.toast(e instanceof Error ? e.message : "Nicht gespeichert");
        throw e;
      });
    }),
  ).then(
    () => true,
    () => false,
  );
  if (!uploads) return;
  void deps.neuLaden();
  const n = keys.length;
  const erster = keys[0];
  deps.toast(
    n === 1 ? "Blatt abgelegt" : `${cap(zahl(n, "n"))} Blätter abgelegt`,
    () => {
      const id = blaetterStore.get().find((x) => x.key === erster)?.id;
      if (n === 1 && id) deps.openPage("blatt", { id });
      else deps.openPage("ablage");
    },
    undefined,
    "Ansehen",
  );
}
