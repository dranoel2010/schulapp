"use client";

import { useCallback, useEffect, useRef } from "react";

import { istDesktop } from "@/components/kombi/desktop/use-desktop";
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

/**
 * Am Rechner, nach einer abgewiesenen Eingabe (Server Action mit Fehlern):
 * der Fokus geht auf das erste Feld mit Fehler (`aria-invalid`), sonst auf
 * die Meldung über dem Formular. Das scrollt mit, und wer liest, hört die
 * Meldung, die per `aria-describedby` am Feld hängt. Ohne Fehler tut es
 * nichts. Beim Öffnen steht der Fokus im ersten Feld (nicht auf der Seite).
 *
 * Am Handy tut es nichts: dort bliebe sonst die Seite nicht beim Knopf
 * stehen, und ein Textfeld öffnete die Tastatur (EINBAU.md, „Am Rechner“).
 */
export function FehlerFokus({ zustand }: { zustand: { message?: string; errors?: object } }) {
  const ref = useRef<HTMLSpanElement>(null);
  const vorher = useRef(zustand);
  // Beim Öffnen am Rechner: das erste Feld, solange niemand anderswo den Fokus hingesetzt hat
  useEffect(() => {
    if (!istDesktop()) return;
    const form = ref.current?.closest("form");
    if (!form || !form.closest(".d-detail")) return;
    const a = document.activeElement;
    if (a && a !== document.body && !a.matches(".d-bereich, .d-detail") && !form.contains(a)) return;
    form
      .querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")
      ?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (zustand === vorher.current) return;
    vorher.current = zustand;
    if (!istDesktop()) return;
    const fehler = zustand.message || (zustand.errors && Object.keys(zustand.errors).length);
    const form = ref.current?.closest("form");
    if (!fehler || !form) return;
    const ziel =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form.querySelector<HTMLElement>('[role="alert"]');
    if (!ziel) return;
    if (!ziel.matches("input, select, textarea, button, [tabindex]")) ziel.setAttribute("tabindex", "-1");
    ziel.focus();
    ziel.scrollIntoView({ block: "center" });
  }, [zustand]);
  return <span ref={ref} hidden />;
}
