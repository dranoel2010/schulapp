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
 * Die Hülle, die am Handy zwischen Kamera, Kachelmenü und Kalender blättert.
 *
 * Das Kachelmenü steht in der Mitte, weil von dort beide Nachbarn einen Wisch
 * entfernt sind. Rechts liegt der Kalender — dort lag er schon, als es nur zwei
 * Seiten gab, und der Tag läuft nach vorn. Also bleibt für die Kamera die
 * andere Richtung: man erreicht sie, indem man dorthin wischt, wo nicht der
 * Kalender ist.
 *
 * Alle drei Seiten kommen fertig gerendert von außen herein und liegen
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

import { PagerPageProvider } from "./pager-context";

export type SwipePagerProps = {
  /** Seite 0: die Kamera. Links, weil rechts der Kalender liegt. */
  camera: ReactNode;
  /** Seite 1: das Kachelmenü. Hier beginnt die Startseite. */
  start: ReactNode;
  /** Seite 2: der Kalender. */
  calendar: ReactNode;
};

/** So viele Seiten liegen auf der Spur. */
const PAGES = 3;

/** Angezeigt wird zuerst das Kachelmenü — die Mitte. */
const START_PAGE = 1;

/** Weiter als bis zur ersten und zur letzten Seite geht es nicht. */
function clamp(page: number): number {
  return Math.min(PAGES - 1, Math.max(0, page));
}

/** Ab so vielen Pixeln Zug blättert die Seite um. */
const THRESHOLD = 50;

/** Unterhalb dieses Werts ist ein Trackpad-Wisch nur Wackeln. */
const WHEEL_MIN = 8;

/** So lange bleibt nach einem Trackpad-Wisch gesperrt (Nachlauf des Geräts). */
const WHEEL_LOCK_MS = 500;

const TRANSITION = "transform 460ms cubic-bezier(0.32, 0.72, 0, 1)";

export function SwipePager({ camera, start, calendar }: SwipePagerProps) {
  const [page, setPage] = useState(START_PAGE);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Der Rahmen selbst — für die Berührungs-Listener, die React nicht
  // unpassiv anmelden kann.
  const frame_ = useRef<HTMLDivElement>(null);
  // Der Zeiger, der die laufende Geste führt — läuft keine, steht hier null.
  //
  // Ohne diese Kennung rechnete jede Berührung in dieselben Werte: ein zweiter
  // Finger überschrieb `startX` mit seiner eigenen Position, und die Bewegung
  // des ERSTEN wurde danach gegen den Startpunkt des ZWEITEN gerechnet. Der
  // Sprung daraus ist fast immer größer als THRESHOLD und zeigt in eine
  // beliebige Richtung — ausgerechnet beim Halten mit einer Hand, wo die
  // haltenden Finger den Rand mitberühren und für die diese Seite gebaut ist.
  const activePointer = useRef<number | null>(null);
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

  /**
   * Der Browser darf senkrecht scrollen (touch-action: pan-y). Sobald er
   * eine Geste für sich beansprucht, schickt er `pointercancel` — und das
   * kam hier schon nach der ERSTEN Bewegung, womit der Wisch tot war.
   *
   * Also nehmen wir ihm die Geste ab, sobald sie erkennbar waagerecht ist:
   * ein preventDefault auf touchmove hält ihn davon ab, selbst zu scrollen.
   * Das geht nur mit einem unpassiven Listener, und den kann React über
   * onTouchMove nicht anmelden — deshalb von Hand.
   *
   * Senkrechte Gesten bleiben unangetastet: dort greifen wir nicht ein, der
   * Browser scrollt wie gewohnt und darf die Geste auch abbrechen.
   */
  useEffect(() => {
    const element = frame_.current;
    if (!element) return;

    let origin: { x: number; y: number } | null = null;
    let horizontal = false;

    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      origin = touch ? { x: touch.clientX, y: touch.clientY } : null;
      horizontal = false;
    }

    function onTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (!origin || !touch) return;

      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;

      // Die Richtung wird einmal je Geste entschieden und bleibt dann dabei,
      // damit ein leichtes Zittern sie nicht mittendrin umwirft.
      if (!horizontal && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
        horizontal = true;
      }

      if (horizontal && event.cancelable) event.preventDefault();
    }

    function onTouchEnd() {
      origin = null;
      horizontal = false;
    }

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    element.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  // Beim Abbau darf weder ein Bild noch ein Zeitgeber offen bleiben.
  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (wheelLock.current !== null) clearTimeout(wheelLock.current);
    };
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Führt bereits ein anderer Zeiger, bleibt er der führende: jede weitere
    // Berührung wird übergangen, bis seine Geste zu Ende ist.
    //
    // Gefragt wird dabei nicht allein nach der Kennung, sondern auch danach, ob
    // der Rahmen den führenden Zeiger überhaupt noch festhält. Für die Maus
    // wird absichtlich nie Capture gesetzt (der Grund steht gleich darunter),
    // und ein Mausklick, dessen pointerup neben dem Rahmen fällt, meldet sich
    // hier nie wieder ab. Ohne Capture gilt deshalb weiter, was bisher galt:
    // das neue Aufsetzen übernimmt. Nur wo der Rahmen den Zeiger wirklich hält,
    // ist sein Ende zugesichert — und nur dort darf gesperrt werden.
    const leading = activePointer.current;
    if (
      leading !== null &&
      leading !== event.pointerId &&
      event.currentTarget.hasPointerCapture(leading)
    ) {
      return;
    }

    activePointer.current = event.pointerId;
    startX.current = event.clientX;

    // Mit Capture bekommt der Rahmen auch die Ereignisse, die neben ihm
    // enden. Manche Browser werfen dabei — dann wischt es eben ohne.
    //
    // Nur für Finger und Stift: hält der Rahmen einen Mauszeiger fest, bekommt
    // er auch den anschließenden Klick — die Kachel darunter nie. In einem
    // schmalen Fenster am Rechner ließe sich dann keine Kachel mehr öffnen.
    // Mit der Maus wird ohnehin nicht gewischt, sondern gescrollt.
    if (event.pointerType !== "mouse") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // absichtlich still
      }
    }

    dragValue.current = 0;
    setDragging(true);
    setDrag(0);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    // Gemessen wird nur die Bewegung des führenden Zeigers; die der übrigen
    // gehört zu keinem Startpunkt, den wir kennen. Steht hier null, läuft gar
    // keine Geste — dann trifft auch keine Kennung zu.
    if (activePointer.current !== event.pointerId) return;

    const dx = event.clientX - startX.current;
    // Über den Rand hinaus zieht es nicht: auf der ersten Seite geht es nur
    // nach links, auf der letzten nur nach rechts. Dazwischen — auf dem
    // Kachelmenü — in beide Richtungen.
    dragValue.current =
      page === 0
        ? Math.min(0, dx)
        : page === PAGES - 1
          ? Math.max(0, dx)
          : dx;

    // Höchstens ein Zustandswechsel je Bild — liegt schon ein Bild an, wird
    // dieses Ereignis nicht noch einmal gezeichnet. Gemessen ist es trotzdem.
    if (frame.current !== null) return;

    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setDrag(dragValue.current);
    });
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    // Hebt ein mitliegender Finger ab, ist die Geste nicht vorbei — nur das
    // Abheben des führenden Zeigers beendet sie. Und beendet ist sie dann
    // endgültig: die Kennung fällt weg, bevor irgendetwas anderes geschieht,
    // damit ein zweites Ende (pointerup und gleich darauf pointercancel) nicht
    // ein zweites Mal blättert.
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;

    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }

    // Entschieden wird nach der letzten Messung, nicht nach dem letzten Bild.
    const travelled = dragValue.current;
    dragValue.current = 0;

    // Ein Wisch blättert um genau eine Seite weiter. Solange es zwei Seiten
    // waren, ließ sich stattdessen die Zielseite hinschreiben; ab drei sagt
    // eine Wischrichtung nichts mehr darüber, wo man landet — nur noch, in
    // welche Richtung. `setPage` bekommt deshalb eine Funktion und keinen Wert:
    // sie rechnet auf dem Stand, der wirklich gilt, und nicht auf dem aus dem
    // Rendern von vorhin.
    if (travelled < -THRESHOLD) setPage((current) => clamp(current + 1));
    else if (travelled > THRESHOLD) setPage((current) => clamp(current - 1));

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
    const step = deltaX > 0 ? 1 : -1;
    if (clamp(page + step) === page) return;

    // Ein Trackpad schickt für einen Wisch viele Ereignisse hinterher. Die
    // Sperre sorgt dafür, dass daraus eine einzige Seite wird.
    wheelLock.current = window.setTimeout(() => {
      wheelLock.current = null;
    }, WHEEL_LOCK_MS);

    setPage((current) => clamp(current + step));
    setDrag(0);
    // Das Trackpad hat gerade geblättert; eine gleichzeitig laufende
    // Finger-Geste ist damit erledigt. Die Kennung fällt mit weg, sonst zöge
    // der noch aufliegende Finger die Spur weiter, während sie sich für
    // stillstehend hält — und blätterte beim Abheben ein zweites Mal.
    activePointer.current = null;
    setDragging(false);
  }

  // Ohne Tastatur wären die Seiten neben dem Kachelmenü nur mit dem Finger
  // erreichbar. Der Rahmen bekommt bewusst kein tabIndex — die Tasten wirken,
  // sobald der Fokus irgendwo in der Hülle steht.
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

    setPage((current) =>
      clamp(current + (event.key === "ArrowRight" ? 1 : -1)),
    );
  }

  return (
    <div
      ref={frame_}
      className="flex flex-1 flex-col overflow-hidden touch-pan-y"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      {/* Der Höhendeckel ist nicht kosmetisch, sondern trägt die ganze
          Startseite.

          Die Spur ist ein Zeilen-Flex, alle drei Seiten strecken sich auf die
          Höhe der größten. Über der Spur steht nirgends eine feste Höhe — `body`
          hat nur ein `min-h-dvh`, also eine Untergrenze. Ohne Deckel wächst
          die Kette deshalb mit dem Inhalt: ein voller Schultag in der Tagesspur
          schiebt die Seite auf weit über eine Bildschirmhöhe, das Kachelraster
          daneben verteilt diese Höhe auf seine drei Reihen und wird dreifach zu
          hoch — und der eigene Scrollbereich der Tagesspur greift gar nicht
          mehr, weil über ihm nichts begrenzt ist.

          Der Fehler zeigt sich erst ab genug Inhalt: an einem leeren Tag bleibt
          alles unter der Bildschirmhöhe und sieht richtig aus. Genau deshalb
          ist er lange nicht aufgefallen.

          Abgezogen werden die sicheren Ränder, weil das Layout sie oberhalb und
          unterhalb schon als Polster gesetzt hat (`pt-safe` in PageBody,
          `pb-safe` im Layout). Ohne den Abzug stünde die Spur im Vollbild um
          genau diese Ränder über dem Bildschirm und die Seite ließe sich ein
          Stück schieben. */}
      <div
        className="flex min-h-0 max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-1 [backface-visibility:hidden] [will-change:transform]"
        style={{
          transform: `translateX(calc(${-page * 100}% + ${drag}px))`,
          transition: dragging ? "none" : TRANSITION,
        }}
      >
        {/* Alle drei Seiten bleiben für Vorleseprogramme erreichbar: ein
            aria-hidden auf den abgewandten Seiten würde ihren Inhalt
            verschlucken.

            `min-w-full` gibt jeder Seite die volle Breite. Die Spur selbst
            bleibt dabei so breit wie der Rahmen und läuft nur über — deshalb
            schiebt `translateX(-page * 100%)` weiterhin um genau eine
            Seitenbreite, egal wie viele Seiten dranhängen.

            `min-h-0` lässt sie in der Zeile schrumpfen; die Höhe deckelt
            die Spur darüber. */}
        {/* Nur die Kameraseite erfährt, ob sie vorn ist — und sie ist auch die
            einzige, die es wissen muss (siehe pager-context). Während des
            Ziehens gilt die Seite, von der aus gezogen wird, noch als vorn:
            die Kamera soll nicht bei jedem Wackeln aus- und wieder angehen. */}
        <PagerPageProvider value={page}>
          <div className="flex min-h-0 min-w-full flex-col">{camera}</div>
        </PagerPageProvider>
        <div className="flex min-h-0 min-w-full flex-col">{start}</div>
        <div className="flex min-h-0 min-w-full flex-col">{calendar}</div>
      </div>
    </div>
  );
}
