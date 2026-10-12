"use client";

import type { PreparedPage } from "@/components/material/prepare-page";
import type { BlattKurz } from "@/lib/kombi/blaetter";

/**
 * Was der Browser über frisch abgelegte Blätter weiß, bevor die Liste vom
 * Server sie kennt (Modell 23, Plan 3.8): „Wird hochgeladen“, „Hängt, wird
 * erneut versucht“, das eigene Vorschaubild und die Antwort des Uploads.
 *
 * Ein kleiner Speicher außerhalb von React (`useSyncExternalStore`), weil die
 * Kamera ablegt und die Liste im Ablauf zeigt — zwei Ebenen der Shell.
 */

export type LokalesBlatt = {
  /** stabiler Schlüssel der Zeile (bleibt, wenn die Server-ID kommt) */
  key: string;
  /** Server-ID, sobald die erste Seite angekommen ist */
  id: string | null;
  /** nur der Browser: Upload läuft oder hängt (offline) */
  lokal: "hochladen" | "haengt" | null;
  /** Vorschaubild aus der Kamera (data:-URL), solange die Seite offen ist */
  bild: string;
  seiten: number;
  /** Reihenfolge in der Liste: größer = weiter oben */
  order: number;
  /** die Antwort des Uploads */
  kurz: BlattKurz | null;
  /** App-Tag der Aufnahme (nur Blätter dieses Tages stehen im Ablauf) */
  tag: string | null;
};

let liste: LokalesBlatt[] = [];
const hoerer = new Set<() => void>();
let zaehler = 0;

export const blaetterStore = {
  get: (): LokalesBlatt[] => liste,
  subscribe(f: () => void): () => void {
    hoerer.add(f);
    return () => hoerer.delete(f);
  },
  setzen(key: string, teil: Partial<LokalesBlatt>): void {
    liste = liste.map((b) => (b.key === key ? { ...b, ...teil } : b));
    hoerer.forEach((f) => f());
  },
  neu(b: Omit<LokalesBlatt, "key">): LokalesBlatt {
    const eintrag = { ...b, key: `c${++zaehler}` };
    liste = [eintrag, ...liste];
    hoerer.forEach((f) => f());
    return eintrag;
  },
  weg(key: string): void {
    liste = liste.filter((b) => b.key !== key);
    hoerer.forEach((f) => f());
  },
  /** Vorschaubild zu einer Server-ID (für Blätter, die in dieser Sitzung fotografiert wurden) */
  bildVon(id: string): string | null {
    return liste.find((b) => b.id === id)?.bild ?? null;
  },
};

/** Ein Foto für den Upload: das Vorschaubild sofort, die drei Fassungen, sobald sie gerechnet sind. */
export type Aufnahme = { bild: string; fassungen: Promise<PreparedPage> };

/** Testweiche `?fehler=abschrift`: gilt für den nächsten Upload (Plan 3.8). */
let fehlerWeiche: string | null = null;
export function testweicheLesen(): void {
  if (typeof window === "undefined" || document.documentElement.dataset.pruefung !== "1") return;
  const f = new URLSearchParams(window.location.search).get("fehler");
  if (f === "abschrift") fehlerWeiche = f;
}

class UploadFehler extends Error {
  constructor(
    message: string,
    readonly netz: boolean,
  ) {
    super(message);
  }
}

async function senden(seite: PreparedPage, felder: Record<string, string>): Promise<BlattKurz> {
  const fd = new FormData();
  fd.set("breite", String(seite.width));
  fd.set("hoehe", String(seite.height));
  fd.set("bild", seite.image, "blatt.jpg");
  fd.set("lesefassung", seite.reading, "lesefassung.jpg");
  fd.set("vorschau", seite.thumb, "vorschau.jpg");
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  let antwort: Response;
  try {
    antwort = await fetch("/api/blaetter", { method: "POST", body: fd, credentials: "same-origin" });
  } catch {
    throw new UploadFehler("Keine Verbindung", true);
  }
  const json = (await antwort.json().catch(() => null)) as (BlattKurz & { message?: string }) | null;
  if (!antwort.ok || !json) {
    throw new UploadFehler(json?.message ?? "Nicht gespeichert", antwort.status >= 500 || antwort.status === 0);
  }
  return json;
}

/** Warten, bis das Gerät wieder online ist. */
function online(): Promise<void> {
  if (navigator.onLine) return new Promise((r) => setTimeout(r, 1800));
  return new Promise((r) => {
    const f = () => {
      removeEventListener("online", f);
      r();
    };
    addEventListener("online", f);
  });
}

/**
 * Ein neues Blatt hochladen: erste Seite, dann die weiteren an dasselbe Blatt.
 * Ohne Netz „hängt“ die Zeile und es geht weiter, sobald das Gerät wieder
 * online ist. Gibt das Blatt zurück, oder wirft mit einem Satz für den Toast.
 */
export async function blattHochladen(
  key: string,
  seiten: Aufnahme[],
  ziel: "liste" | "zeile",
): Promise<BlattKurz> {
  const fehler = fehlerWeiche;
  fehlerWeiche = null;
  const versuch = async <T,>(f: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await f();
      } catch (e) {
        if (!(e instanceof UploadFehler) || !e.netz) throw e;
        blaetterStore.setzen(key, { lokal: "haengt" });
        await online();
        blaetterStore.setzen(key, { lokal: "hochladen" });
      }
    }
  };
  const erste = await seiten[0].fassungen;
  let kurz = await versuch(() =>
    senden(erste, { seiten: String(seiten.length), ziel, ...(fehler ? { fehler } : {}) }),
  );
  blaetterStore.setzen(key, { id: kurz.id, kurz, lokal: seiten.length > 1 ? "hochladen" : null });
  for (const s of seiten.slice(1)) {
    const f = await s.fassungen;
    kurz = await versuch(() => senden(f, { attach: kurz.id, folge: "1" }));
  }
  blaetterStore.setzen(key, { kurz, lokal: null });
  return kurz;
}

/** „Seite dazu“ an ein vorhandenes Blatt. */
export async function seitenDazu(materialId: string, seiten: Aufnahme[]): Promise<BlattKurz | null> {
  let kurz: BlattKurz | null = null;
  for (const [i, s] of seiten.entries()) {
    const f = await s.fassungen;
    kurz = await senden(f, { attach: materialId, ...(i > 0 ? { folge: "1" } : { seiten: String(seiten.length) }) });
  }
  return kurz;
}

/**
 * Wohin die Miniaturen nach dem Ablegen fliegen (Prototyp `landSheets`,
 * Z. 3710; V2 Abschnitt 8). Die Ebene, die sie aufnehmen kann, meldet sich
 * hier an — im Ablauf die Liste unter dem Sucher, auf dem Überblick (B)
 * „Zuletzt abgelegt“. Sie gibt `true` zurück, wenn sie gelandet hat; sonst
 * zeigt die Kamera den Toast „Blatt abgelegt · Ansehen“.
 */
export type Landung = {
  neu: { key: string; from: DOMRect | null }[];
  dazu: { id: string; from: DOMRect | null }[];
  ziel: "liste" | "zeile";
};
type Empfaenger = (l: Landung) => boolean;
const empfaenger = new Set<Empfaenger>();

export function ablageEmpfangen(f: Empfaenger): () => void {
  empfaenger.add(f);
  return () => empfaenger.delete(f);
}

export function landen(l: Landung): boolean {
  for (const f of empfaenger) if (f(l)) return true;
  return false;
}

/** Nach „Fertig“: kam die Kamera aus dem großen Sucher, wird er schon jetzt flach (Prototyp Z. 3595). */
const vorLandung = new Set<(ausSucher: boolean) => void>();
export function vorLandungMelden(f: (ausSucher: boolean) => void): () => void {
  vorLandung.add(f);
  return () => vorLandung.delete(f);
}
export function vorLandungAusloesen(ausSucher: boolean): void {
  vorLandung.forEach((f) => f(ausSucher));
}
