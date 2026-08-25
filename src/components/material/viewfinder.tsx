"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useCamera, useCaptureQueue, type CaptureTarget } from "./camera";

/**
 * Der Sucher: die Kamera über dem Bildschirm, bis der Stapel durch ist.
 *
 * Er gehört zum Auslöser in der Ablage und auf der Blattseite — überall dort,
 * wo aus einem Knopf heraus fotografiert wird. Auf der Startseite ist die
 * Kamera keine Auflage, sondern die Seite selbst; das steht in
 * @/components/home/camera-pane.
 *
 * **Auf dem Bildschirm steht nichts als das Bild, ein Kreis und eine Zahl.**
 * Kein Fach zum Wählen, kein Weg in die Ablage, keine Vorschau des letzten
 * Blattes: was hier steht, hält auf. Das Fach ist entschieden, bevor der Sucher
 * aufgeht, und alles Richtigstellen ist die Aufgabe des Eingangskorbs.
 *
 * **Jeder Antipper ist ein eigenes Blatt** — außer beim Anhängen, wo jeder eine
 * weitere Seite desselben Blattes ist. Wer eine Rückseite hat, geht auf das
 * Blatt und hängt sie dort an.
 *
 * Geschlossen wird erst, wenn die Schlange leer ist. Sonst stürbe mit der
 * Komponente das, was noch unterwegs war, und der Nutzer hätte fotografiert,
 * ohne dass es ankam.
 */

export type ViewfinderProps = {
  /**
   * Wohin die Aufnahmen gehen: ein Fach (dann wird jede Aufnahme ein eigenes
   * Blatt) oder ein Blatt (dann wird jede eine weitere Seite).
   */
  target: CaptureTarget;
  /** Was oben leise dasteht — das Fach, in das die Blätter fallen. */
  label: string;
  /**
   * Wie viele Aufnahmen noch hineinpassen. Beim Anhängen der freie Platz im
   * Blatt; für neue Blätter gibt es keine Grenze (`Infinity`).
   */
  capacity: number;
  /**
   * Zugeklappt. `arrived` ist, was wirklich angekommen ist; `startError` steht
   * darin, wenn die Kamera gar nicht erst aufging.
   *
   * Der Fehler reist mit hinaus und bleibt nicht hier: der Sucher ist dann zu,
   * und der Satz gehört unter den Knopf, der ihn geöffnet hat. Vor allem muss
   * der Knopf erfahren, dass dieser Weg nicht geht — sonst führte der nächste
   * Antipper wieder in denselben schwarzen Bildschirm.
   */
  onClose: (result: { arrived: number; startError: string | null }) => void;
};

/** „1 Blatt“, „3 Blätter“ — und beim Anhängen „1 Seite“, „3 Seiten“. */
export function counted(n: number, attaching: boolean): string {
  if (attaching) return n === 1 ? "1 Seite" : `${n} Seiten`;
  return n === 1 ? "1 Blatt" : `${n} Blätter`;
}

export function Viewfinder({
  target,
  label,
  capacity,
  onClose,
}: ViewfinderProps) {
  const { videoRef, ready, startError } = useCamera(true);
  const { shoot, arrived, inFlight, error } = useCaptureQueue(target);

  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState(false);

  const attaching = "materialId" in target;
  const full = arrived + inFlight >= capacity;
  const busy = inFlight > 0;

  /** Hinter dem Sucher soll sich nichts schieben lassen. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const trigger = useCallback(() => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 90);
    void shoot(videoRef.current);
  }, [shoot, videoRef]);

  /**
   * Zuklappen — aber nicht, solange noch etwas unterwegs ist. Mit der
   * Komponente stürbe die Schlange, und wer eben fotografiert hat, hätte für
   * nichts fotografiert.
   */
  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (closing && inFlight === 0) onClose({ arrived, startError });
  }, [closing, inFlight, arrived, startError, onClose]);

  /** Am Tablet mit Tastatur ist Escape der Weg zurück, den jeder erwartet. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Die Zeile über dem Kreis. Sie sagt genau eines, und in dieser Reihenfolge:
  // was schiefging, was noch aussteht, was angekommen ist. Ist nichts davon
  // wahr, steht dort nichts — ein „Tipp auf den Kreis“ wäre ein Satz, der beim
  // zweiten Blatt schon im Weg steht.
  const status = startError
    ? startError
    : closing && busy
      ? "Noch unterwegs — gleich fertig …"
      : error
        ? error
        : full
          ? `An dieses Blatt passt nichts mehr. ${counted(arrived, attaching)} angekommen.`
          : arrived > 0 || busy
            ? `${counted(arrived, attaching)} angekommen${busy ? ` · ${inFlight} unterwegs` : ""}`
            : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* `object-contain` und nicht `object-cover`: gespeichert wird das ganze
          Kamerabild, und beim Zuschneiden auf den Bildschirm verschwände ein
          Rand, den der Nutzer nie gesehen hat. Bei einem Blatt geht es aber
          genau um den Rand — ob die letzte Zeile noch drauf ist. Schwarze
          Streifen sind der günstigere Preis dafür, dass auf dem Bildschirm
          dasselbe Bild steht, das gleich in der Ablage liegt. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-hidden="true"
        className="absolute inset-0 size-full object-contain"
      />

      {/* Der kurze Blitz beim Auslösen. Er ist die einzige Rückmeldung, die
          sofort kommt — das Blatt ist da noch nicht einmal verkleinert, und
          ohne ihn wüsste niemand, ob der Antipper angekommen ist. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-100 ${flash ? "opacity-70" : "opacity-0"}`}
      />

      <div className="relative flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="rounded-full bg-black/50 px-3 py-1.5 text-[15px] font-medium">
          {label}
        </span>

        <button
          type="button"
          onClick={close}
          aria-label="Kamera schließen"
          className="-mr-1 flex size-11 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="relative mt-auto flex flex-col items-center gap-4 px-6 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        {status ? (
          <p
            role={error || startError ? "alert" : "status"}
            className="max-w-sm text-balance text-center text-[15px] leading-snug text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
          >
            {status}
          </p>
        ) : null}

        <button
          type="button"
          onClick={trigger}
          disabled={!ready || full || closing}
          aria-label="Auslösen"
          className="size-[76px] rounded-full border-[5px] border-white bg-white/25 transition-transform duration-100 active:scale-90 disabled:opacity-40"
        />
      </div>
    </div>,
    document.body,
  );
}
