"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { FehlerToast } from "@/lib/kombi/aktion";
import type { TagDaten } from "@/lib/kombi/tag-daten";

/**
 * Der Kontext der Shell (Plan A): was jede Ebene der neuen Oberfläche
 * aufrufen kann. Eigene Datei, damit Seiten und Ebenen ihn benutzen können,
 * ohne die Shell selbst zu importieren (sonst Kreis über die Seitenliste).
 */

export type Ansicht = "morgens" | "ablauf" | "ueberblick" | "frueh";

export type OeffnenOptionen = {
  /** Aus der Zeile oder dem Überblick: Daten schon bei `pointerdown` geholt */
  vorgeladen?: boolean;
  /** Für „Zuletzt geöffnet“ im Menü der Zeile: Titel und Unterzeile (Klausur, Noten eines Fachs) */
  zuletzt?: { label: string; sub?: string | null };
};

/** Ebenen, die spätere Abschnitte in die Shell hängen (C: Kamera und Ablauf, E: Tisch, F: Lernblock). */
export type EbenenName = "kamera" | "tisch" | "lernblock" | "ansicht" | "ablauf";
export type EbenenHandler = (optionen?: Record<string, unknown>) => void;

export type KombiApi = {
  /** Nachschlage-Seite öffnen (Prototyp `openPage`); unbekannte Arten navigieren zur Route */
  openPage: (art: string, params?: Record<string, string>, optionen?: OeffnenOptionen) => void;
  /** Daten einer Seite schon holen (bei `pointerdown`), Plan 2.4, Punkt 6 */
  vorladen: (art: string, params?: Record<string, string>) => void;
  /** Oberste Ebene schließen (Zurück-Pfeil, Randwisch, Android-Zurück) */
  popPage: () => void;
  /** Toast 10 px über der Zeile, 4,5 s; mit `fn` ein Knopf (`label`, sonst „Rückgängig“) */
  toast: (text: string, fn?: (() => void) | null, desc?: string, label?: string) => void;
  hideToast: (keepUndo?: boolean) => void;
  fehlerToast: FehlerToast;
  /** Sheet von unten (Blatt, Material) */
  openSheet: (inhalt: ReactNode, aufDemTisch?: boolean) => void;
  closeSheet: () => void;
  /** Kamera (Abschnitt C); bis dahin Ablage */
  openCam: (optionen?: Record<string, unknown>) => void;
  /** Tisch (Abschnitt E/F); bis dahin die alte Sitzung */
  openTisch: (optionen?: Record<string, unknown>) => void;
  /** Tageszeit-Ansicht (Abschnitt B) */
  setView: (ansicht: Ansicht, optionen?: { dir?: number; anim?: boolean }) => void;
  /** Zeile öffnen, optional mit Kontext (Abschnitt D) */
  openZeile: (kontext?: Record<string, unknown> | null) => void;
  closeMenu: () => void;
  /** Das Rückgängig des Toasts, solange es gilt (Vorschlag „Rückgängig: …“ im Menü) */
  undoJetzt: () => { desc: string; run: () => void } | null;
  /** Daten der Startseite; null bis zum ersten Laden */
  tagDaten: TagDaten | null;
  /** Startseite hat Daten vom Server mitgebracht (Kaltstart auf `/`) */
  merkeTagDaten: (daten: TagDaten) => void;
  /** Nach einer Action: TagDaten und die oberste Stapelseite gezielt neu holen (2.4, Punkt 2) */
  neuLaden: () => Promise<void>;
  /** Spätere Abschnitte hängen hier ihre Ebene ein; gibt das Abmelden zurück */
  registriere: (name: EbenenName, handler: EbenenHandler) => () => void;
};

export const KombiKontext = createContext<KombiApi | null>(null);

export function useKombi(): KombiApi {
  const api = useContext(KombiKontext);
  if (!api) throw new Error("useKombi außerhalb der KombiShell");
  return api;
}
