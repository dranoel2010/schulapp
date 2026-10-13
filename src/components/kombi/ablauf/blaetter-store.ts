"use client";

import {
  aufnahmeFortschritt,
  aufnahmeMerken,
  aufnahmeVergessen,
  haengendeLesen,
  mitSperre,
  neueUid,
} from "@/components/kombi/ablauf/aufnahmen-speicher";
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
  /**
   * Neuer App-Tag (die PWA blieb über Nacht offen): Blätter eines anderen
   * Tages fallen heraus, Blätter ohne Tag (vor dem ersten Laden abgelegt)
   * bekommen diesen.
   */
  tagSetzen(tag: string): void {
    if (!liste.some((b) => b.tag !== tag)) return;
    liste = liste.filter((b) => !b.tag || b.tag === tag).map((b) => (b.tag ? b : { ...b, tag }));
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
 * Uploads, die nur im Speicher der Seite liegen (IndexedDB nicht verfügbar):
 * solange es sie gibt, fragt der Browser vor dem Neuladen oder Schließen nach.
 */
let ungesichert = 0;
const vorDemVerlassen = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};
function ungesichertZaehlen(d: 1 | -1): void {
  const vorher = ungesichert;
  ungesichert = Math.max(0, ungesichert + d);
  if (!vorher && ungesichert) addEventListener("beforeunload", vorDemVerlassen);
  else if (vorher && !ungesichert) removeEventListener("beforeunload", vorDemVerlassen);
}

/**
 * „Seite dazu“ an ein vorhandenes Blatt, solange der Server die Seiten noch
 * nicht hat: die Blattzeile im Ablauf und die Blattseite zeigen daran „Wird
 * hochgeladen“ oder „Hängt, wird erneut versucht“ (statt nur eines Toasts,
 * der von selbst verschwindet). `erledigt` zählt angekommene Uploads, damit
 * Liste und Seite danach neu laden.
 */
export type DazuEintrag = { uid: string; id: string; lokal: "hochladen" | "haengt"; seiten: number };
type DazuStand = { liste: DazuEintrag[]; erledigt: number };
let dazuStand: DazuStand = { liste: [], erledigt: 0 };
const dazuHoerer = new Set<() => void>();
function dazuAendern(n: DazuStand): void {
  dazuStand = n;
  dazuHoerer.forEach((f) => f());
}
const LEER_DAZU: DazuStand = { liste: [], erledigt: 0 };

export const dazuStore = {
  get: (): DazuStand => dazuStand,
  leer: (): DazuStand => LEER_DAZU,
  subscribe(f: () => void): () => void {
    dazuHoerer.add(f);
    return () => dazuHoerer.delete(f);
  },
  neu(e: DazuEintrag): void {
    dazuAendern({ ...dazuStand, liste: [...dazuStand.liste.filter((x) => x.uid !== e.uid), e] });
  },
  setzen(uid: string, lokal: DazuEintrag["lokal"]): void {
    if (!dazuStand.liste.some((x) => x.uid === uid && x.lokal !== lokal)) return;
    dazuAendern({ ...dazuStand, liste: dazuStand.liste.map((x) => (x.uid === uid ? { ...x, lokal } : x)) });
  },
  weg(uid: string, angekommen: boolean): void {
    dazuAendern({
      liste: dazuStand.liste.filter((x) => x.uid !== uid),
      erledigt: dazuStand.erledigt + (angekommen ? 1 : 0),
    });
  },
};

/** Was an einem Blatt noch hängt: der Stand und wie viele Seiten noch kommen. */
export function dazuAn(stand: DazuStand, id: string | null): { lokal: DazuEintrag["lokal"]; seiten: number } | null {
  if (!id) return null;
  const e = stand.liste.filter((x) => x.id === id);
  if (!e.length) return null;
  return { lokal: e.some((x) => x.lokal === "haengt") ? "haengt" : "hochladen", seiten: e.reduce((n, x) => n + x.seiten, 0) };
}

type Hochladen = {
  uid: string;
  fassungen: PreparedPage[];
  ziel: "liste" | "zeile";
  /** ab dieser Seite senden (die davor hat der Server schon) */
  ab: number;
  /** Server-ID des Blatts, wenn es schon eines gibt */
  id: string | null;
  /** „Seite dazu“: alle Seiten hängen an `id` */
  dazu: boolean;
  fehler: string | null;
  /** Anzeige: hochladen, hängt, oder die erste Antwort des Servers */
  stand: (teil: Partial<LokalesBlatt>) => void;
};

/**
 * Die Formularfelder zur Seite `i` von `n`: ohne Blatt legt die Seite eines
 * an, sonst hängt sie daran. Bei „Seite dazu“ steht das Blatt von Anfang an
 * fest; die erste Seite sagt, wie viele kommen.
 */
export function seitenFelder(a: {
  i: number;
  n: number;
  blattId: string | null;
  dazu: boolean;
  ziel: "liste" | "zeile";
  fehler: string | null;
}): Record<string, string> {
  if (a.dazu) return { attach: a.blattId ?? "", ...(a.i > 0 ? { folge: "1" } : { seiten: String(a.n) }) };
  if (a.i === 0 || !a.blattId) return { seiten: String(a.n), ziel: a.ziel, ...(a.fehler ? { fehler: a.fehler } : {}) };
  return { attach: a.blattId, folge: "1" };
}

/**
 * Die Seiten ab `ab` senden: die erste legt das Blatt an (bei „Seite dazu“
 * hängt sie an das vorhandene), die weiteren hängen an dasselbe. Ohne Netz
 * „hängt“ die Zeile und es geht weiter, sobald das Gerät wieder online ist.
 * Jeder Schritt steht in IndexedDB, bis alles da ist.
 */
async function hochladenAb(h: Hochladen): Promise<BlattKurz | null> {
  const { uid, fassungen, ziel, ab, dazu, fehler, stand } = h;
  const versuch = async <T,>(f: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await f();
      } catch (e) {
        if (!(e instanceof UploadFehler) || !e.netz) throw e;
        stand({ lokal: "haengt" });
        await online();
        stand({ lokal: "hochladen" });
      }
    }
  };
  let kurz: BlattKurz | null = null;
  let blattId = h.id;
  try {
    for (let i = ab; i < fassungen.length; i++) {
      const felder = seitenFelder({ i, n: fassungen.length, blattId, dazu, ziel, fehler });
      const k = await versuch(() => senden(fassungen[i], felder));
      kurz = k;
      if (!blattId) {
        blattId = k.id;
        stand({ id: k.id, kurz: k, lokal: i + 1 < fassungen.length ? "hochladen" : null });
      }
      await aufnahmeFortschritt(uid, i + 1, blattId);
    }
  } catch (e) {
    // Der Server hat abgelehnt (kein Netzfehler): nicht bei jedem Start erneut
    await aufnahmeVergessen(uid);
    throw e;
  }
  await aufnahmeVergessen(uid);
  if (kurz) stand({ kurz, lokal: null });
  return kurz;
}

/** Ein Upload dieses Fensters (gegen doppeltes Fortsetzen beim Ereignis „online“). */
const laufendeUids = new Set<string>();

/** `reserviert`: die uid steht schon in `laufendeUids` (vor dem Ablegen in IndexedDB eingetragen). */
async function gesperrt<T>(uid: string, nurWennFrei: boolean, f: () => Promise<T>, reserviert = false): Promise<T | null> {
  if (!reserviert && laufendeUids.has(uid)) return null;
  laufendeUids.add(uid);
  try {
    return await mitSperre(uid, nurWennFrei, f);
  } finally {
    laufendeUids.delete(uid);
  }
}

/**
 * Ein neues Blatt hochladen: erste Seite, dann die weiteren an dasselbe Blatt.
 * Die Fassungen liegen vorher in IndexedDB; ein Neuladen oder das Beenden der
 * App verliert das Foto deshalb nicht. Gibt das Blatt zurück, oder wirft mit
 * einem Satz für den Toast.
 */
export async function blattHochladen(
  key: string,
  seiten: Aufnahme[],
  ziel: "liste" | "zeile",
): Promise<BlattKurz> {
  const fehler = fehlerWeiche;
  fehlerWeiche = null;
  const fassungen = await Promise.all(seiten.map((s) => s.fassungen));
  const eintrag = blaetterStore.get().find((b) => b.key === key);
  const uid = neueUid();
  // vor dem Ablegen reserviert: ein „online“ dazwischen setzt diese Aufnahme nicht ein zweites Mal fort
  laufendeUids.add(uid);
  const gesichert = await aufnahmeMerken({
    uid,
    ziel,
    tag: eintrag?.tag ?? null,
    bild: eintrag?.bild ?? seiten[0].bild,
    order: eintrag?.order ?? Date.now(),
    seiten: fassungen,
    gesendet: 0,
    id: null,
  });
  if (!gesichert) ungesichertZaehlen(1);
  try {
    const kurz = await gesperrt(uid, false, () =>
      hochladenAb({ uid, fassungen, ziel, ab: 0, id: null, dazu: false, fehler, stand: (t) => blaetterStore.setzen(key, t) }),
      true,
    );
    if (!kurz) throw new UploadFehler("Nicht gespeichert", false);
    return kurz;
  } finally {
    if (!gesichert) ungesichertZaehlen(-1);
  }
}

/** Eine Aufnahme mit „Seite dazu“ senden: Stand an der Blattzeile, danach weg. */
async function dazuSenden(a: { uid: string; id: string; fassungen: PreparedPage[]; ab: number }): Promise<BlattKurz | null> {
  dazuStore.neu({ uid: a.uid, id: a.id, lokal: "hochladen", seiten: a.fassungen.length - a.ab });
  let angekommen = false;
  try {
    const kurz = await hochladenAb({
      uid: a.uid,
      fassungen: a.fassungen,
      ziel: "zeile",
      ab: a.ab,
      id: a.id,
      dazu: true,
      fehler: null,
      stand: (t) => {
        if (t.lokal) dazuStore.setzen(a.uid, t.lokal);
      },
    });
    angekommen = true;
    if (kurz) {
      const lokal = blaetterStore.get().find((x) => x.id === a.id);
      if (lokal) blaetterStore.setzen(lokal.key, { kurz, seiten: kurz.seiten });
    }
    return kurz;
  } finally {
    dazuStore.weg(a.uid, angekommen);
  }
}

let fortgesetzt = false;

/**
 * Beim Start der Shell und bei jedem Ereignis „online“: was hängen blieb
 * (ohne Netz fotografiert, dann neu geladen oder von Android beendet), steht
 * wieder in der Liste oder an seiner Blattzeile und geht weiter an den
 * Server. Was dieses Fenster schon sendet oder ein anderes Fenster hält
 * (Web Locks), bleibt unberührt. `melden` bekommt den Satz für den Toast,
 * wenn der Server ein Blatt ablehnt.
 */
export async function haengendeFortsetzen(melden: (text: string) => void): Promise<void> {
  if (!fortgesetzt) {
    fortgesetzt = true;
    addEventListener("online", () => void fortsetzen(melden));
  }
  await fortsetzen(melden);
}

async function fortsetzen(melden: (text: string) => void): Promise<void> {
  for (const a of await haengendeLesen()) {
    if (laufendeUids.has(a.uid)) continue;
    if (a.dazu && a.id) {
      const id = a.id;
      void gesperrt(a.uid, true, () => dazuSenden({ uid: a.uid, id, fassungen: a.seiten, ab: a.gesendet })).catch((e: unknown) =>
        melden(e instanceof Error ? e.message : "Nicht gespeichert"),
      );
      continue;
    }
    void gesperrt(a.uid, true, async () => {
      const eintrag = blaetterStore.neu({
        id: a.id,
        lokal: "hochladen",
        bild: a.bild,
        seiten: a.seiten.length,
        order: a.order,
        kurz: null,
        tag: a.tag,
      });
      try {
        const kurz = await hochladenAb({
          uid: a.uid,
          fassungen: a.seiten,
          ziel: a.ziel,
          ab: a.gesendet,
          id: a.id,
          dazu: false,
          fehler: null,
          stand: (t) => blaetterStore.setzen(eintrag.key, t),
        });
        // alles war schon da: die Liste vom Server kennt das Blatt
        if (!kurz) blaetterStore.weg(eintrag.key);
      } catch (e) {
        blaetterStore.weg(eintrag.key);
        melden(e instanceof Error ? e.message : "Nicht gespeichert");
      }
      return null;
    });
  }
}

/**
 * „Seite dazu“ an ein vorhandenes Blatt, wie ein neues Blatt: die Fassungen
 * liegen erst in IndexedDB, ohne Netz hängt der Upload (an der Blattzeile
 * „Hängt, wird erneut versucht“) und geht weiter, sobald das Gerät online
 * ist, auch nach einem Neuladen. Wirft nur, wenn der Server ablehnt.
 */
export async function seitenDazu(materialId: string, seiten: Aufnahme[]): Promise<BlattKurz | null> {
  const fassungen = await Promise.all(seiten.map((s) => s.fassungen));
  const uid = neueUid();
  laufendeUids.add(uid);
  const gesichert = await aufnahmeMerken({
    uid,
    ziel: "zeile",
    tag: null,
    bild: seiten[0]?.bild ?? "",
    order: Date.now(),
    seiten: fassungen,
    gesendet: 0,
    id: materialId,
    dazu: true,
  });
  if (!gesichert) ungesichertZaehlen(1);
  try {
    return await gesperrt(uid, false, () => dazuSenden({ uid, id: materialId, fassungen, ab: 0 }), true);
  } finally {
    if (!gesichert) ungesichertZaehlen(-1);
  }
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
  /** Ob alle „Seite dazu“-Uploads angekommen sind (erst dann der Toast) */
  dazuOk: Promise<boolean>;
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
