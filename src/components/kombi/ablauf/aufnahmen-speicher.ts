"use client";

import type { PreparedPage } from "@/components/material/prepare-page";

/**
 * Aufnahmen, deren Upload noch nicht durch ist, liegen in IndexedDB — nicht
 * nur im Speicher der Seite. Ein ohne Netz fotografiertes Blatt („Hängt,
 * wird erneut versucht“) überlebt so ein Neuladen und das Beenden der PWA im
 * Hintergrund durch Android; beim nächsten Start sendet die Shell es weiter
 * (`haengendeFortsetzen` in blaetter-store.ts).
 *
 * Gespeichert sind die drei fertigen Fassungen je Seite (Blobs), wie sie an
 * POST /api/blaetter gehen, dazu wie weit der Upload kam: `gesendet` Seiten,
 * und nach der ersten die Server-ID, an die die übrigen gehängt werden.
 *
 * Alles hier scheitert still (privates Fenster, gesperrter Speicher): dann
 * bleibt es beim Speicher der Seite, und `beforeunload` warnt (blaetter-store).
 */

export type HaengendeAufnahme = {
  uid: string;
  ziel: "liste" | "zeile";
  /** App-Tag der Aufnahme */
  tag: string | null;
  /** Vorschaubild (data:-URL) */
  bild: string;
  order: number;
  seiten: PreparedPage[];
  /** so viele Seiten hat der Server schon */
  gesendet: number;
  /** Server-ID nach der ersten Seite */
  id: string | null;
};

const DB_NAME = "schulapp-aufnahmen";
const STORE = "haengend";

let dbVersprechen: Promise<IDBDatabase> | null = null;

function oeffnen(): Promise<IDBDatabase> {
  if (dbVersprechen) return dbVersprechen;
  dbVersprechen = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("kein IndexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "uid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB blockiert"));
  });
  dbVersprechen.catch(() => {
    dbVersprechen = null;
  });
  return dbVersprechen;
}

async function schritt<T>(modus: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await oeffnen();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, modus);
    const req = f(tx.objectStore(STORE));
    let wert: T;
    req.onsuccess = () => {
      wert = req.result;
    };
    tx.oncomplete = () => resolve(wert);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB abgebrochen"));
  });
}

/** Eine Aufnahme ablegen. `true`, wenn sie sicher liegt. */
export async function aufnahmeMerken(a: HaengendeAufnahme): Promise<boolean> {
  try {
    await schritt("readwrite", (s) => s.put(a));
    return true;
  } catch {
    return false;
  }
}

/** Fortschritt festhalten: so viele Seiten sind angekommen, an diesem Blatt. */
export async function aufnahmeFortschritt(uid: string, gesendet: number, id: string | null): Promise<void> {
  try {
    const alt = await schritt<HaengendeAufnahme | undefined>("readonly", (s) => s.get(uid));
    if (!alt) return;
    await schritt("readwrite", (s) => s.put({ ...alt, gesendet, id }));
  } catch {
    // dann sendet ein Neustart die Seiten ab der letzten bekannten noch einmal
  }
}

export async function aufnahmeVergessen(uid: string): Promise<void> {
  try {
    await schritt("readwrite", (s) => s.delete(uid));
  } catch {
    // nichts zu tun
  }
}

export async function haengendeLesen(): Promise<HaengendeAufnahme[]> {
  try {
    const alle = await schritt<HaengendeAufnahme[]>("readonly", (s) => s.getAll());
    return alle.sort((a, b) => a.order - b.order);
  } catch {
    return [];
  }
}

/**
 * Eine Aufnahme nur von einem Fenster aus senden (zwei offene Tabs sollen
 * dasselbe Blatt nicht zweimal ablegen). Ohne Web Locks läuft `f` einfach.
 * `nurWennFrei`: hält ein anderes Fenster die Sperre, geschieht nichts (null).
 */
export async function mitSperre<T>(uid: string, nurWennFrei: boolean, f: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return f();
  return locks.request(`schulapp-aufnahme-${uid}`, { ifAvailable: nurWennFrei }, async (lock) => (lock ? f() : null));
}

export function neueUid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
