"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CaptureError,
  NETWORK_MESSAGE,
  prepareFrame,
  sendPage,
} from "./prepare-page";

/**
 * Die Kamera und die Schlange dahinter — als Haken, damit beide Stellen, die
 * ein laufendes Kamerabild zeigen, dieselbe Mechanik benutzen.
 *
 * Es gibt zwei davon: die Kameraseite links auf der Startseite, die aufgeht,
 * sobald man dorthin wischt, und der Sucher, den der Auslöser in der Ablage
 * über den Bildschirm legt. Was sie zeigen, ist verschieden; wie die Kamera an-
 * und ausgeht, wie ein Standbild in die Schlange kommt und was passiert, wenn
 * die Leitung abreißt, ist es nicht.
 */

/** Wohin die Aufnahmen gehen: in ein Fach (neues Blatt) oder an ein Blatt. */
export type CaptureTarget =
  | { materialId: string }
  | { subjectId: string; capturedOn: string };

/** Kann dieses Gerät ein laufendes Kamerabild liefern? */
export function hasViewfinder(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return false;

  // Nur auf dem Gerät, das man in der Hand hält. Am Rechner zeigt dieselbe
  // Abfrage die Webcam über dem Bildschirm — die ist auf kein Blatt zu richten,
  // und Eile hat dort ohnehin niemand.
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * Warum die Kamera nicht aufging, in einem Satz, mit dem sich etwas anfangen
 * lässt. `NotAllowedError` ist der einzige Fall, den der Nutzer selbst lösen
 * kann — deshalb steht dort, wo es zu lösen ist.
 */
function startMessage(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Der Browser lässt die App nicht an die Kamera. Erlaub ihr den Zugriff in den Einstellungen der Seite. Bis dahin geht es über den Knopf wie bisher.";
  }

  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Dieses Gerät hat keine Kamera, an die die App herankommt. Über den Knopf geht es trotzdem.";
  }

  if (name === "NotReadableError") {
    return "Die Kamera ist gerade von einer anderen App belegt. Schließ sie und versuch es noch einmal.";
  }

  return "Die Kamera ließ sich nicht öffnen. Über den Knopf geht es trotzdem.";
}

/**
 * Das laufende Kamerabild, solange `active` gilt.
 *
 * **`active` ist der ganze Grund, warum das ein Haken ist.** Die Kameraseite
 * liegt in der Wischhülle und ist damit die ganze Zeit im Dokument, auch wenn
 * gerade das Kachelmenü zu sehen ist. Liefe die Kamera dort mit, brennte das
 * Lämpchen des Geräts durchgehend, die App bäte beim ersten Öffnen ungefragt um
 * Kamerazugriff, und der Akku ginge für ein Bild drauf, das niemand sieht.
 * Angeschaltet wird deshalb erst, wenn die Seite vorn ist, und beim Wegwischen
 * sofort wieder aus.
 */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start() {
      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          // `ideal` und nicht `exact`: ein Tablet ohne Rückkamera bekäme mit
          // `exact` gar kein Bild, mit `ideal` eben das vordere. Ein Bild aus
          // der falschen Richtung ist besser als eine schwarze Fläche.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
          audio: false,
        });

        // Zwischen dem Fragen und dem Antworten liegt der Erlaubnisdialog, und
        // der kann Sekunden dauern. Wer in dieser Zeit weiterwischt, bekommt
        // sonst eine Kamera, die niemand mehr abschaltet — das Lämpchen bliebe
        // an.
        if (cancelled) {
          for (const track of opened.getTracks()) track.stop();
          return;
        }

        stream = opened;

        const video = videoRef.current;
        if (video) {
          video.srcObject = opened;
          // Safari startet ein frisch gesetztes Video nicht von allein, obwohl
          // `autoPlay` dasteht. Schlägt es fehl, steht trotzdem ein Bild da,
          // sobald der Nutzer irgendetwas antippt — deshalb nur weggefangen.
          await video.play().catch(() => {});
        }

        if (!cancelled) {
          setReady(true);
          setStartError(null);
        }
      } catch (cause) {
        if (!cancelled) setStartError(startMessage(cause));
      }
    }

    void start();

    return () => {
      cancelled = true;
      setReady(false);
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, [active]);

  /**
   * Der Bildschirm bleibt an, solange die Kamera läuft.
   *
   * Ein Stapel Zettel dauert länger als die Zeit, nach der ein Handy den
   * Bildschirm abschaltet — und mit dem Bildschirm ginge die Kamera aus. Das
   * Wake Lock gibt es nicht überall; wo nicht, ist es kein Grund, irgendetwas
   * zu melden.
   */
  useEffect(() => {
    if (!active) return;

    let lock: WakeLockSentinel | null = null;
    let released = false;

    void navigator.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        if (released) {
          void sentinel.release();
          return;
        }
        lock = sentinel;
      })
      .catch(() => {});

    return () => {
      released = true;
      void lock?.release();
    };
  }, [active]);

  return { videoRef, ready, startError };
}

/**
 * Die Schlange hinter dem Auslöser.
 *
 * **Der Auslöser wartet nicht auf die Leitung.** Aufgenommen wird sofort,
 * verkleinert wird nebenher, hochgeladen wird eines nach dem anderen. Wer
 * dreimal schnell tippt, hat drei Blätter, auch wenn das erste noch unterwegs
 * ist. Ohne diese Trennung wäre die Kamera nach jedem Foto für zwei Sekunden
 * taub — genau das Problem, das ein offenes Kamerabild lösen soll.
 *
 * Eines nach dem anderen und nicht alles gleichzeitig: Next verschickt Server
 * Actions ohnehin sequenziell, und drei gleichzeitige Anfragen mit je 300 KB
 * über Mobilfunk machen alle drei langsamer.
 */
export function useCaptureQueue(target: CaptureTarget) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // Das Ziel kann sich unter der Schlange ändern — auf der Kameraseite wählt
  // man das Fach am laufenden Bild. Gelesen wird es deshalb beim Auslösen und
  // festgehalten: ein Blatt geht dorthin, wo es beim Antippen hinsollte, auch
  // wenn zwei Sekunden später schon ein anderes Fach dasteht.
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  const [arrived, setArrived] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ein Auftrag hinten an die Schlange. `then(job, job)` und nicht `then(job)`:
   * eine gescheiterte Aufnahme darf die nächste nicht mitreißen — sonst wäre
   * nach dem ersten abgerissenen Upload jedes weitere Foto still verloren.
   */
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job, job);
    queue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const shoot = useCallback(
    async (video: HTMLVideoElement | null) => {
      if (!video) return;

      const goesTo = targetRef.current;

      setInFlight((n) => n + 1);
      setError(null);

      try {
        const page = await prepareFrame(video);
        await enqueue(() => sendPage(page, goesTo));
        setArrived((n) => n + 1);
      } catch (cause) {
        setError(cause instanceof CaptureError ? cause.message : NETWORK_MESSAGE);
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [enqueue],
  );

  /** Von vorn zählen — beim Verlassen der Seite oder beim Zuklappen. */
  const reset = useCallback(() => {
    setArrived(0);
    setError(null);
  }, []);

  return { shoot, arrived, inFlight, error, reset };
}
