"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";

/**
 * Die Hülle, die am Handy zwischen Startseite und Kalender blättert.
 *
 * Beide Seiten kommen fertig gerendert von außen herein und liegen
 * nebeneinander auf einer Spur; geblättert wird allein über deren
 * `transform`. Dadurch bleibt der Inhalt serverseitig gerendert, obwohl die
 * Hülle interaktiv ist, und beim Wischen wird nichts nachgeladen.
 *
 * Flüssig bleibt das aus drei Gründen:
 * - Während des Ziehens gibt es keinen Übergang, danach genau einen. So folgt
 *   die Spur erst dem Finger und fährt anschließend in einem Zug weiter.
 * - Zeiger-Ereignisse kommen dichter als der Bildschirm zeichnet. Pro Bild
 *   wird deshalb höchstens einmal neu gerendert (siehe `frame`), sonst stauen
 *   sich die Ereignisse und es ruckelt.
 * - `will-change` und `backface-visibility` halten die Spur auf einer eigenen
 *   Ebene, damit jedes Bild nur verschoben und nicht neu gemalt wird.
 *
 * `touch-action: pan-y` auf dem Rahmen lässt senkrechtes Scrollen unangetastet
 * — nur die waagerechte Geste gehört dieser Komponente.
 */

export type SwipePagerProps = {
  /** Seite 0: das Kachelmenü */
  start: ReactNode;
  /** Seite 1: der Kalender */
  calendar: ReactNode;
};

/** Ab so vielen Pixeln Zug blättert die Seite um. */
const THRESHOLD = 50;

/** Unterhalb dieses Werts ist ein Trackpad-Wisch nur Wackeln. */
const WHEEL_MIN = 8;

/** So lange bleibt nach einem Trackpad-Wisch gesperrt (Nachlauf des Geräts). */
const WHEEL_LOCK_MS = 500;

const TRANSITION = "transform 460ms cubic-bezier(0.32, 0.72, 0, 1)";

export function SwipePager({ start, calendar }: SwipePagerProps) {
  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  // X-Position beim Aufsetzen des Fingers.
  const startX = useRef(0);
  // Der zuletzt gemessene Zug. Er wird bei jeder Bewegung mitgeschrieben,
  // auch wenn das Bild dafür ausfällt — sonst entschiede das Loslassen nach
  // einem verworfenen Ereignis und ein schneller Wisch bliebe liegen.
  const dragValue = useRef(0);
  // Kennung des angeforderten Bildes, solange eines aussteht.
  const frame = useRef<number | null>(null);
  // Zeitgeber der Trackpad-Sperre, solange sie hält.
  const wheelLock = useRef<number | null>(null);

  // Beim Abbau darf weder ein Bild noch ein Zeitgeber offen bleiben.
  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (wheelLock.current !== null) clearTimeout(wheelLock.current);
    };
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    startX.current = event.clientX;

    // Mit Capture bekommt der Rahmen auch die Ereignisse, die neben ihm
    // enden. Manche Browser werfen dabei — dann wischt es eben ohne.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // absichtlich still
    }

    dragValue.current = 0;
    setDragging(true);
    setDrag(0);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;

    const dx = event.clientX - startX.current;
    // Über den Rand hinaus zieht es nicht: auf der ersten Seite geht es nur
    // nach links, auf der zweiten nur nach rechts.
    dragValue.current = page === 0 ? Math.min(0, dx) : Math.max(0, dx);

    // Höchstens ein Zustandswechsel je Bild — liegt schon ein Bild an, wird
    // dieses Ereignis nicht noch einmal gezeichnet. Gemessen ist es trotzdem.
    if (frame.current !== null) return;

    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setDrag(dragValue.current);
    });
  }

  function handlePointerEnd() {
    if (!dragging) return;

    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }

    // Entschieden wird nach der letzten Messung, nicht nach dem letzten Bild.
    const travelled = dragValue.current;
    dragValue.current = 0;

    if (travelled < -THRESHOLD) setPage(1);
    else if (travelled > THRESHOLD) setPage(0);

    setDragging(false);
    setDrag(0);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const { deltaX, deltaY } = event;

    // Senkrechtes Scrollen bleibt senkrechtes Scrollen.
    if (Math.abs(deltaX) < Math.abs(deltaY) || Math.abs(deltaX) < WHEEL_MIN) {
      return;
    }

    if (wheelLock.current !== null) return;

    // Erst prüfen, dann sperren — genau in dieser Reihenfolge steht es im
    // Entwurf. Andersherum würde ein Wisch gegen den Rand, der gar nichts
    // bewegt, den Rückweg eine halbe Sekunde lang blockieren.
    const target = deltaX > 0 ? 1 : 0;
    if (target === page) return;

    // Ein Trackpad schickt für einen Wisch viele Ereignisse hinterher. Die
    // Sperre sorgt dafür, dass daraus eine einzige Seite wird.
    wheelLock.current = window.setTimeout(() => {
      wheelLock.current = null;
    }, WHEEL_LOCK_MS);

    setPage(target);
    setDrag(0);
    setDragging(false);
  }

  // Ohne Tastatur wäre die zweite Seite nur mit dem Finger erreichbar. Der
  // Rahmen bekommt bewusst kein tabIndex — die Tasten wirken, sobald der
  // Fokus irgendwo in der Hülle steht.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    // In Eingabefeldern gehören die Pfeiltasten dem Schreibcursor.
    const target = event.target as HTMLElement;
    if (
      target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"
    ) {
      return;
    }

    setPage(event.key === "ArrowRight" ? 1 : 0);
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden touch-pan-y"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex min-h-0 flex-1 [backface-visibility:hidden] [will-change:transform]"
        style={{
          transform: `translateX(calc(${-page * 100}% + ${drag}px))`,
          transition: dragging ? "none" : TRANSITION,
        }}
      >
        {/* Beide Seiten bleiben für Vorleseprogramme erreichbar: ein
            aria-hidden auf der abgewandten Seite würde ihren Inhalt
            verschlucken. */}
        <div className="flex min-w-full flex-col">{start}</div>
        <div className="flex min-w-full flex-col">{calendar}</div>
      </div>
    </div>
  );
}
