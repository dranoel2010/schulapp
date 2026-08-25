"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CaptureError,
  NETWORK_MESSAGE,
  prepareFrame,
  sendPage,
  type PreparedPage,
} from "./prepare-page";

/**
 * Der Sucher: die Kamera bleibt offen, bis der Stapel durch ist.
 *
 * **Das ist die Antwort auf einen gemessenen Weg.** Mit `<input capture>` —
 * dem Weg, den der Knopf daneben geht — gibt das Gerät nach jedem einzelnen
 * Foto die Kamera wieder zu: Auslösen, Bestätigen, zurück in die App, warten,
 * wieder auf den Knopf. Fünf Zettel aus einer Epoche sind damit fünfmal
 * derselbe Weg mit vier Handgriffen. Ein Stapel ist aber der Normalfall und
 * nicht die Ausnahme — deshalb hält der Sucher die Kamera offen und macht aus
 * fünf Zetteln fünf Antipper.
 *
 * Auf dem Bildschirm steht dafür nichts als das Bild, ein Kreis und die Zahl
 * dessen, was angekommen ist. Kein Fach zum Wählen, kein Weg in die Ablage,
 * keine Vorschau des letzten Blattes: was hier steht, hält auf. Das Fach ist
 * entschieden, bevor der Sucher aufgeht (siehe `openViewfinder()` im Auslöser),
 * und alles Richtigstellen ist die Aufgabe des Eingangskorbs.
 *
 * **Jeder Antipper ist ein eigenes Blatt** — außer beim Anhängen, wo jeder eine
 * weitere Seite desselben Blattes ist. Das ist dieselbe Regel wie beim Knopf
 * und dieselbe wie im Korb: ein Zettel ist ein Blatt. Wer eine Rückseite hat,
 * geht auf das Blatt und hängt sie dort an.
 *
 * **Der Kreis wartet nicht auf die Leitung.** Aufgenommen wird sofort — ein
 * Standbild aus dem laufenden Bild —, verkleinert wird nebenher, und
 * hochgeladen wird eines nach dem anderen in einer Schlange dahinter. Wer
 * dreimal schnell tippt, hat drei Blätter, auch wenn das erste noch unterwegs
 * ist. Ohne diese Trennung wäre der Sucher nach jedem Foto für zwei Sekunden
 * taub, und genau das war ja das Problem.
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
  target: { materialId: string } | { subjectId: string; capturedOn: string };
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
   * Der Fehler reist mit hinaus und bleibt nicht hier: der Sucher ist dann
   * zu, und der Satz gehört unter den Knopf, der ihn geöffnet hat. Vor allem
   * muss der Knopf erfahren, dass dieser Weg nicht geht — sonst führte der
   * nächste Antipper wieder in denselben schwarzen Bildschirm.
   */
  onClose: (result: { arrived: number; startError: string | null }) => void;
};

/** Kann dieses Gerät ein laufendes Kamerabild liefern? */
export function hasViewfinder(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return false;

  // Nur auf dem Gerät, das man in der Hand hält. Am Rechner zeigt dieselbe
  // Abfrage die Webcam über dem Bildschirm — die ist auf kein Blatt zu richten,
  // und Eile hat dort ohnehin niemand. Dort bleiben Knopf und Galerie.
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
    // Derselbe Satz steht gleich darauf unter dem Knopf, der den Sucher
    // geöffnet hat (siehe `closeViewfinder()` im Auslöser). Er muss an beiden
    // Stellen stimmen — deshalb kein „schließ hier“, das unten falsch wäre.
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

/** „1 Blatt“, „3 Blätter“ — und beim Anhängen „1 Seite“, „3 Seiten“. */
function counted(n: number, attaching: boolean): string {
  if (attaching) return n === 1 ? "1 Seite" : `${n} Seiten`;
  return n === 1 ? "1 Blatt" : `${n} Blätter`;
}

export function Viewfinder({
  target,
  label,
  capacity,
  onClose,
}: ViewfinderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Die Schlange. Verkleinert wird nebeneinander — das rechnet das Gerät in
   * Millisekunden —, hochgeladen wird eines nach dem anderen: Next verschickt
   * Server Actions ohnehin sequenziell, und drei gleichzeitige Anfragen mit je
   * 300 KB über Mobilfunk machen alle drei langsamer.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const [ready, setReady] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [arrived, setArrived] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState(false);

  const attaching = "materialId" in target;

  /**
   * Das Ziel, einmal beim Öffnen festgehalten und danach nicht mehr angefasst.
   *
   * Es steht für die Lebensdauer des Suchers fest: das Fach ist entschieden,
   * bevor er aufgeht, und ein Blatt wechselt nicht unter ihm. Festgehalten wird
   * es trotzdem, statt das Prop zu lesen — die Schlange arbeitet noch, wenn
   * oben schon wieder gerendert wurde, und ein Blatt soll dorthin gehen, wo es
   * beim Auslösen hinsollte.
   */
  const targetRef = useRef(target);

  /** Die Kamera an, und beim Zuklappen wieder aus. */
  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
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
        // der kann Sekunden dauern. Wer in dieser Zeit zuklappt, bekommt sonst
        // eine Kamera, die niemand mehr abschaltet — das Lämpchen bliebe an.
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // Safari startet ein frisch gesetztes Video nicht von allein, obwohl
          // `autoPlay` dasteht. Schlägt es fehl, steht trotzdem ein Bild da,
          // sobald der Nutzer irgendetwas antippt — deshalb nur weggefangen.
          await video.play().catch(() => {});
        }

        setReady(true);
      } catch (cause) {
        if (!cancelled) setStartError(startMessage(cause));
      }
    }

    void start();

    return () => {
      cancelled = true;
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, []);

  /**
   * Der Bildschirm bleibt an, solange der Sucher offen ist.
   *
   * Ein Stapel Zettel dauert länger als die Zeit, nach der ein Handy den
   * Bildschirm abschaltet — und mit dem Bildschirm ginge die Kamera aus und der
   * Sucher zu. Das Wake Lock gibt es nicht überall; wo nicht, ist es kein
   * Grund, irgendetwas zu melden.
   */
  useEffect(() => {
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
  }, []);

  /** Hinter dem Sucher soll sich nichts schieben lassen. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

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

  const used = arrived + inFlight;
  const full = used >= capacity;
  const busy = inFlight > 0;

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready) return;

    setFlash(true);
    window.setTimeout(() => setFlash(false), 90);

    setInFlight((n) => n + 1);
    setError(null);

    try {
      // Ein Standbild aus dem laufenden Bild. Alles Weitere geschieht an
      // dieser Kopie, während vorne schon das nächste Blatt gehalten wird.
      const page: PreparedPage = await prepareFrame(video);

      await enqueue(() => sendPage(page, targetRef.current));

      setArrived((n) => n + 1);
    } catch (cause) {
      setError(
        cause instanceof CaptureError ? cause.message : NETWORK_MESSAGE,
      );
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [enqueue, ready]);

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
          onClick={() => void shoot()}
          disabled={!ready || full || closing}
          aria-label="Auslösen"
          className="size-[76px] rounded-full border-[5px] border-white bg-white/25 transition-transform duration-100 active:scale-90 disabled:opacity-40"
        />
      </div>
    </div>,
    document.body,
  );
}
