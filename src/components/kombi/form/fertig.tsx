"use client";

import { useCallback, useEffect, useRef } from "react";

import { useKombi } from "@/components/kombi/kontext";

/**
 * Nach erfolgreichem Speichern einer Formular-Unterseite (Plan 2.4, Punkt 5):
 * eine Ebene zurück — dorthin, woher man kam (Fach → Noten → Note eintragen →
 * speichern → wieder auf der Notenseite des Fachs) —, dann lädt die Shell
 * Startseite und oberste Stapelseite nach. Kam man direkt auf die Unterseite,
 * führt Zurück zur Startseite.
 *
 * Die Server Action gibt dafür `fertig: Date.now()` zurück statt
 * umzuleiten; jede neue Marke löst genau einmal aus.
 */

export function useNachAktion() {
  const kombi = useKombi();
  const zurueck = useCallback(
    (toast?: string) => {
      kombi.popPage();
      setTimeout(() => {
        void kombi.neuLaden();
        if (toast) kombi.toast(toast);
      }, 320);
    },
    [kombi],
  );
  /** Nach dem Löschen dessen, was die Seite darunter zeigt: zurück zur Startseite. */
  const heim = useCallback(
    (toast?: string) => {
      kombi.setView("ueberblick");
      setTimeout(() => {
        void kombi.neuLaden();
        if (toast) kombi.toast(toast);
      }, 320);
    },
    [kombi],
  );
  return { zurueck, heim };
}

export function useFertig(marke: number | undefined, toast?: string) {
  const { zurueck } = useNachAktion();
  const gesehen = useRef(marke);
  useEffect(() => {
    if (!marke || marke === gesehen.current) return;
    gesehen.current = marke;
    zurueck(toast);
  }, [marke, zurueck, toast]);
}

export function FertigBeiErfolg({ marke, toast }: { marke?: number; toast?: string }) {
  useFertig(marke, toast);
  return null;
}

/**
 * Für Formulare, die nach dem Speichern stehen bleiben (Blatt bearbeiten):
 * die Seite darunter wird trotzdem gleich nachgeladen, damit sie beim
 * Zurückgehen stimmt.
 */
export function NeuLadenBei({ marke }: { marke?: number }) {
  const kombi = useKombi();
  const gesehen = useRef(marke);
  useEffect(() => {
    if (!marke || marke === gesehen.current) return;
    gesehen.current = marke;
    void kombi.neuLaden();
  }, [marke, kombi]);
  return null;
}

/** „Abbrechen“ einer Formular-Unterseite: eine Ebene zurück, ohne zu speichern. */
export function AbbrechenKnopf({ children = "Abbrechen" }: { children?: string }) {
  const kombi = useKombi();
  return (
    <button className="btn quiet kf-btn" type="button" onClick={() => kombi.popPage()}>
      {children}
    </button>
  );
}
