"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import {
  hasViewfinder,
  useCamera,
  useCaptureQueue,
} from "@/components/material/camera";
import { CaptureButton } from "@/components/material/capture-button";
import { counted } from "@/components/material/viewfinder";

import { useIsFrontPage } from "./pager-context";

/**
 * Die linke Seite der Startseite: die Kamera. Nicht eine Seite mit einem Knopf,
 * der eine Kamera öffnet — die Kamera.
 *
 * **Es steht nichts darauf als das Bild, das Fach, ein Kreis und eine Zahl.**
 * Kein „Zuletzt aufgenommen", kein Weg in die Ablage, kein Eingangskorb: was
 * hier steht, hält auf. Wer hierher wischt, will fotografieren, und der Stapel
 * neben ihm wird nicht kürzer, während er liest. Die Wege, die vorher hier
 * standen, sind ins Kachelmenü gezogen — dorthin, wo Navigation ohnehin
 * hingehört (siehe die Kachel „Blätter" in tile-grid).
 *
 * **Das Fach ist der einzige Bedienteil, und es musste ohnehin dastehen.** Ein
 * Blatt gehört immer in ein Fach, und die Regel der App lautet: wo ein Fach
 * vorbelegt ist, steht es auf dem Bildschirm. Diese Beschriftung ist deshalb
 * kein zusätzliches Element — sie ist die vorgeschriebene Anzeige, die
 * zusätzlich antippbar ist. Dahinter liegt ein gewöhnliches `<select>`, also
 * die Auswahl des Geräts und kein eigenes Menü: es kostet keinen Pixel mehr als
 * die Anzeige, die dort so oder so stünde.
 *
 * Vorbelegt wird, was der Stundenplan sagt; sagt er nichts — abends, am
 * Wochenende —, das Fach des zuletzt aufgenommenen Blattes. Das ist eine
 * Vermutung und wird als solche behandelt: sie steht sichtbar da, sie ist mit
 * einem Antipper zu ändern, und stimmt sie nicht, schlägt der Postbote das
 * richtige Fach vor, sobald er das Blatt liest. Was sie NICHT mehr tut, ist den
 * Weg zur Kamera zu versperren.
 *
 * **Die Kamera läuft nur, wenn die Seite vorn ist.** Alle drei Seiten der
 * Wischhülle liegen dauernd im Dokument; ohne diese Bedingung brennte das
 * Lämpchen durchgehend und die App bäte beim ersten Öffnen ungefragt um
 * Kamerazugriff. Woher sie das weiß, steht in pager-context.
 *
 * Geht die Kamera nicht auf — kein Zugriff, keine vorhanden, am Rechner —,
 * steht hier der alte Auslöser mit Knopf und Galerie, und darüber der Grund.
 */

export type CameraPaneProps = {
  subjects: Array<{ id: string; name: string; short: string; color: string }>;
  /** Was der Stundenplan vorschlägt, sonst das Fach des letzten Blattes. */
  presetSubjectId: string | null;
  today: string;
  /** Es gibt Fächer, aber alle sind archiviert. */
  allArchived: boolean;
  /** Der Satz über dem Auslöser — nur im Rückfallweg zu sehen. */
  lead: string;
};

/** Ein Abonnement auf nichts — eine Kamera wächst einem Gerät nicht im Betrieb. */
const NEVER_CHANGES = () => () => {};

export function CameraPane({
  subjects,
  presetSubjectId,
  today,
  allArchived,
  lead,
}: CameraPaneProps) {
  const isFront = useIsFrontPage(0);

  /**
   * Drei Zustände und nicht zwei: `null` heißt „weiß der Server nicht“.
   *
   * Mit `false` als Serverantwort stünde im ersten Bild der Rückfallweg und
   * würde am Handy sofort danach durch die Kamera ersetzt — ein sichtbares
   * Aufblitzen der alten Seite bei jedem Öffnen. `null` malt stattdessen die
   * schwarze Fläche, auf der gleich das Kamerabild steht.
   */
  const available = useSyncExternalStore(
    NEVER_CHANGES,
    hasViewfinder,
    () => null as boolean | null,
  );

  const [chosen, setChosen] = useState(presetSubjectId ?? "");

  // Die Kamera läuft, sobald die Seite vorn ist — auch ohne gewähltes Fach.
  // Erst auslösen geht dann nicht; das Bild aber schon zu sehen, ist genau der
  // Unterschied zwischen „die Kamera ist da“ und „hier ist ein Formular“.
  const active = isFront && available === true;

  const { videoRef, ready, startError } = useCamera(active);
  const { shoot, arrived, inFlight, error } = useCaptureQueue({
    subjectId: chosen,
    capturedOn: today,
  });

  const [flash, setFlash] = useState(false);

  const trigger = useCallback(() => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 90);
    void shoot(videoRef.current);
  }, [shoot, videoRef]);

  // Kein Fach angelegt: dann gibt es nichts, wohin die Aufnahme könnte, und der
  // Auslöser sagt das samt Weg dorthin. Eine schwarze Fläche mit abgeschaltetem
  // Kreis wäre eine Sackgasse.
  const noSubjects = subjects.length === 0;

  if (available === false || startError || noSubjects) {
    return (
      <Fallback
        subjects={subjects}
        presetSubjectId={presetSubjectId}
        today={today}
        allArchived={allArchived}
        lead={startError ?? lead}
        isError={startError !== null}
      />
    );
  }

  const busy = inFlight > 0;

  // Die Zeile über dem Kreis. Sie sagt genau eines: was schiefging, oder was
  // angekommen ist. Ist keins von beidem wahr, steht dort nichts — außer beim
  // allerersten Mal, wenn noch kein Fach feststeht.
  const status = error
    ? error
    : chosen === ""
      ? "Wähl oben ein Fach, dann kann es losgehen."
      : arrived > 0 || busy
        ? `${counted(arrived, false)} angekommen${busy ? ` · ${inFlight} unterwegs` : ""}`
        : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-black text-white">
      {/* `object-contain` und nicht `object-cover`: gespeichert wird das ganze
          Kamerabild, und beim Zuschneiden verschwände ein Rand, den niemand
          gesehen hat. Bei einem Blatt geht es genau um den Rand — ob die letzte
          Zeile noch drauf ist. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-hidden="true"
        className="absolute inset-0 size-full object-contain"
      />

      {/* Der kurze Blitz beim Auslösen — die einzige Rückmeldung, die sofort
          kommt. Das Blatt ist da noch nicht einmal verkleinert. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-100 ${flash ? "opacity-70" : "opacity-0"}`}
      />

      <div className="relative flex px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {/* Anzeige und Bedienteil in einem. Das Fach MUSS hier stehen — ein
            Blatt darf nie still in einem Fach landen, das nirgends stand —, und
            weil es ohnehin dasteht, kostet es nichts, es antippbar zu machen. */}
        <div className="relative">
          <select
            aria-label="Fach"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="appearance-none rounded-full bg-black/55 py-2 pl-3.5 pr-9 text-[15px] font-medium text-white"
          >
            {chosen === "" ? <option value="">Fach wählen</option> : null}
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>

          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>

      <div className="relative mt-auto flex flex-col items-center gap-4 px-6 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        {status ? (
          <p
            role={error ? "alert" : "status"}
            className="max-w-sm text-balance text-center text-[15px] leading-snug text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
          >
            {status}
          </p>
        ) : null}

        <button
          type="button"
          onClick={trigger}
          disabled={!ready || chosen === ""}
          aria-label="Auslösen"
          className="size-[76px] rounded-full border-[5px] border-white bg-white/25 transition-transform duration-100 active:scale-90 disabled:opacity-40"
        />
      </div>
    </div>
  );
}

/**
 * Der Weg für alles, was kein laufendes Kamerabild hergibt: der Rechner, ein
 * verweigerter Zugriff, ein Konto ohne Fächer. Hier steht wieder der gewohnte
 * Auslöser mit Knopf und Galerie — und darüber der Grund, warum es nicht die
 * Kamera ist.
 */
function Fallback({
  subjects,
  presetSubjectId,
  today,
  allArchived,
  lead,
  isError,
}: CameraPaneProps & { isError: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      <header className="px-[22px] pt-[20px] pb-[16px]">
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          Aufnehmen
        </h2>
        <p
          role={isError ? "alert" : undefined}
          className={`mt-[2px] text-[14px] leading-snug ${isError ? "text-danger" : "text-muted"}`}
        >
          {lead}
        </p>
      </header>

      <div className="px-[14px] pb-[18px]">
        <CaptureButton
          subjectId={presetSubjectId}
          subjects={subjects}
          today={today}
          allArchived={allArchived}
        />
      </div>
    </div>
  );
}
