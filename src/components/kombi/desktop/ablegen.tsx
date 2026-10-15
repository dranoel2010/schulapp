"use client";

import { useEffect, useRef, useState } from "react";

import { seitenDazu, type Aufnahme } from "@/components/kombi/ablauf/blaetter-store";
import { TastaturDetail } from "@/components/kombi/seiten/einstellungen";
import { useKombi } from "@/components/kombi/kontext";
import { prepareFile } from "@/components/material/prepare-page";
import { cap, zahl } from "@/lib/kombi/text";

import { useAuswahl } from "./auswahl";
import { dateienAblegen, vorschau } from "./hochladen";
import { detailSlotSetzen } from "./liste-detail";
import { ueberlagert } from "./tasten";
import { istDesktop, useDesktop } from "./use-desktop";

/**
 * Hochladen und Ablegen am Rechner (desktop.html `ablegen`, `seiteDazu`,
 * `.d-drop`; EINBAU.md „Am Rechner“). Die Fotos macht das Handy; am Rechner
 * kommen Bilder aus dem Ordner, über den Knopf der Zeile (`onHochladen`) oder
 * per Ziehen ins Fenster. Sie gehen denselben Weg wie die Kamera
 * (`dateienAblegen`: IndexedDB, Server, Jev ordnet ein).
 *
 * - Ein Bild wird ein Blatt. Mehrere fragt ein Dialog: ein Blatt mit
 *   mehreren Seiten oder je Bild ein Blatt.
 * - „Seite dazu“ am Blatt hängt Bilder über `seitenDazu` an.
 * - PDF liest die App noch nicht; der Toast sagt es, statt still nichts zu tun,
 *   auch wenn ein PDF zwischen Bildern kommt („Blatt abgelegt. Das PDF geht noch nicht.“).
 *
 * `Ablegen` hängt in der Shell. Am Handy rendert es nichts und hört auf nichts.
 */

const istBild = (f: File) => f.type.startsWith("image/");
const istPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** Der Satz, wenn unter den Dateien kein Bild ist. */
function keinBild(dateien: File[]): string {
  if (dateien.some(istPdf)) return "PDF geht noch nicht. Bitte als Bild ablegen.";
  return dateien.length === 1 ? "Das ist kein Bild." : "Darunter ist kein Bild.";
}

/** Bilder als Aufnahmen wie die der Kamera: Vorschaubild und die drei Fassungen. */
async function aufnahmen(bilder: File[]): Promise<Aufnahme[]> {
  return Promise.all(
    bilder.map(async (f) => {
      const fassungen = prepareFile(f);
      fassungen.catch(() => {});
      return { bild: await vorschau(f), fassungen };
    }),
  );
}

/** Die kurze Frage „ein Blatt oder mehrere“ (Inhalt des Sheets, am Rechner ein Dialog). */
function EinOderMehrere({ n, onEins, onViele }: { n: number; onEins: () => void; onViele: () => void }) {
  return (
    <div className="d-frage">
      <h2>{`${cap(zahl(n, "n"))} Bilder`}</h2>
      <p>Gehören sie zu einem Blatt, oder ist jedes ein eigenes?</p>
      <div className="d-foot">
        <button className="btn quiet" type="button" onClick={onEins}>
          {`Ein Blatt, ${n} Seiten`}
        </button>
        <button className="btn primary" type="button" onClick={onViele}>
          {`${cap(zahl(n, "n"))} Blätter`}
        </button>
      </div>
    </div>
  );
}

export function Ablegen() {
  tastaturEintragen();
  const kombi = useKombi();
  const desktop = useDesktop();
  const api = useRef(kombi);
  useEffect(() => {
    api.current = kombi;
  });
  const [ziehen, setZiehen] = useState(false);

  // Die Ebene „hochladen“: alles, was hochgeladen wird, kommt hier an
  useEffect(() => {
    return kombi.registriere("hochladen", (o) => {
      const k = api.current;
      const dateien = ((o?.dateien as File[] | undefined) ?? []).slice();
      const bilder = dateien.filter(istBild);
      if (!bilder.length) {
        if (dateien.length) k.toast(keinBild(dateien));
        return;
      }
      // Bilder und PDF zusammen: die Bilder werden abgelegt, und der Toast sagt, dass das PDF nicht mitkam
      const pdfs = dateien.filter(istPdf).length;
      const zusatz = pdfs === 0 ? undefined : pdfs === 1 ? "Das PDF geht noch nicht." : "PDFs gehen noch nicht.";
      const deps = { tag: k.tagDaten?.tag ?? null, toast: k.toast, openPage: k.openPage, neuLaden: k.neuLaden, zusatz };
      if (bilder.length === 1) {
        void dateienAblegen([bilder], deps);
        return;
      }
      k.openSheet(
        <EinOderMehrere
          n={bilder.length}
          onEins={() => {
            k.closeSheet();
            void dateienAblegen([bilder], deps);
          }}
          onViele={() => {
            k.closeSheet();
            void dateienAblegen(
              bilder.map((f) => [f]),
              deps,
            );
          }}
        />,
      );
    });
    // registriere ist stabil; die übrige API steht in api.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kombi.registriere]);

  // Ziehen ins Fenster: „Loslassen zum Ablegen“
  useEffect(() => {
    if (!desktop) return;
    let n = 0;
    const mitDateien = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const rein = (e: DragEvent) => {
      if (!mitDateien(e) || ueberlagert()) return;
      n += 1;
      setZiehen(true);
    };
    const raus = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      n = Math.max(0, n - 1);
      if (!n) setZiehen(false);
    };
    const drueber = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = ueberlagert() ? "none" : "copy";
    };
    const los = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      n = 0;
      setZiehen(false);
      if (ueberlagert() || !istDesktop()) return;
      const dateien = [...(e.dataTransfer?.files ?? [])];
      if (dateien.length) api.current.onHochladen(dateien);
    };
    window.addEventListener("dragenter", rein);
    window.addEventListener("dragleave", raus);
    window.addEventListener("dragover", drueber);
    window.addEventListener("drop", los);
    return () => {
      window.removeEventListener("dragenter", rein);
      window.removeEventListener("dragleave", raus);
      window.removeEventListener("dragover", drueber);
      window.removeEventListener("drop", los);
      setZiehen(false);
    };
  }, [desktop]);

  if (!desktop) return null;
  return (
    <div className={ziehen ? "d-drop on" : "d-drop"} id="drop" aria-hidden={!ziehen}>
      <div className="d-drop-in">
        <b>Loslassen zum Ablegen</b>
        <p>Ein Bild je Blatt. Fach und Thema erkennt die App.</p>
      </div>
    </div>
  );
}

/**
 * „Seite dazu“ am Rechner: hängt gewählte Bilder an ein vorhandenes Blatt,
 * über denselben Weg wie die Kamera (`seitenDazu`). Am Blatt zeigt
 * `dazuStore` „Wird hochgeladen“, bis der Server die Seiten hat.
 */
export async function seitenAnhaengen(
  id: string,
  dateien: File[],
  k: Pick<ReturnType<typeof useKombi>, "toast" | "neuLaden" | "tagDaten">,
): Promise<void> {
  const bilder = dateien.filter(istBild);
  if (!bilder.length) {
    if (dateien.length) k.toast(keinBild(dateien));
    return;
  }
  try {
    const kurz = await seitenDazu(id, await aufnahmen(bilder), k.tagDaten?.tag ?? null);
    k.toast(bilder.length === 1 ? "Seite angehängt" : `${cap(zahl(bilder.length))} Seiten angehängt`);
    if (kurz) void k.neuLaden();
  } catch (e) {
    k.toast(e instanceof Error ? e.message : "Nicht gespeichert");
  }
}

/**
 * Am Rechner steht neben einer Liste ohne Auswahl keine leere Hälfte
 * (desktop.html `ui.sel`): ist auf der reinen Listenadresse (`pfad`, ohne
 * Abfrage) nichts gewählt, zeigt das Detail den ersten Eintrag. Der
 * History-Eintrag wird ersetzt, Zurück führt also nicht auf die leere Liste.
 */
export function useErsteAuswahl(pfad: string, ziel: { art: string; params: Record<string, string> } | null): void {
  const auswahl = useAuswahl();
  const kombi = useKombi();
  const art = ziel?.art ?? null;
  const params = ziel ? JSON.stringify(ziel.params) : null;
  const leer = !!auswahl && !auswahl.sel;
  // einmal je leerer Liste: bis die Adresse wechselt, rendert die Liste noch einmal
  const schon = useRef<string | null>(null);
  useEffect(() => {
    if (!leer) {
      schon.current = null;
      return;
    }
    if (!art || !params || !istDesktop()) return;
    if (window.location.pathname !== pfad || window.location.search) return;
    if (schon.current === `${art}?${params}`) return;
    schon.current = `${art}?${params}`;
    kombi.zeigeBereich(art, JSON.parse(params) as Record<string, string>, { ersetzen: true, vonSelbst: true });
  }, [leer, art, params, pfad, kombi]);
}

/**
 * Die Tastatur in den Einstellungen hat keine Seite der App: sie steht als
 * Auswahl `tastatur` im Detail der Einstellungen (nur am Rechner). Eingetragen
 * beim ersten Rendern von `Ablegen` und nicht beim Laden des Moduls: die
 * Module hängen über die Registry im Kreis, und beim Hydrieren (noch ohne
 * Bühne) ist es sicher geschehen, bevor ein Detail danach fragt.
 */
let slotDa = false;
function tastaturEintragen(): void {
  if (slotDa) return;
  slotDa = true;
  detailSlotSetzen("einstellungen", (sel) => (sel === "tastatur" ? <TastaturDetail /> : null));
}
