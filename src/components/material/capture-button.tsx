"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ChangeEvent,
} from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { MAX_PAGES } from "@/lib/images";

import {
  CaptureError,
  NETWORK_MESSAGE,
  prepareFile,
  sendPage,
} from "./prepare-page";
import { hasViewfinder } from "./camera";
import { Viewfinder } from "./viewfinder";

/**
 * Der Auslöser: vom Foto zum gespeicherten Blatt.
 *
 * Er muss sich in zwei Sekunden bedienen lassen, während vorne noch etwas an
 * der Tafel steht. Deshalb ist der sichtbare Weg genau ein Knopf. Wohin der
 * führt, hängt vom Gerät ab:
 *
 * - **Am Handy in den Sucher** (@/components/material/viewfinder): die Kamera
 *   geht in der App auf und bleibt offen, bis der Stapel durch ist. Ein Antipper
 *   ist ein Blatt.
 * - **Am Rechner in die Dateiauswahl**: dort gibt es keine Kamera, auf die sich
 *   ein Blatt richten ließe, und keine Eile.
 *
 * Geht der Sucher nicht auf — kein Zugriff auf die Kamera, keine vorhanden, von
 * einer anderen App belegt —, bleibt der alte Weg über ein verstecktes
 * `<input capture="environment">`. Er öffnet die Kamera des Geräts und gibt ein
 * Foto zurück; das ist umständlicher, aber es geht überall. Daneben steht leise
 * der Weg aus der Galerie: ein Foto, das jemand weitergeschickt hat, ist
 * genauso ein Blatt.
 *
 * Verkleinert wird im Browser, bevor etwas hochgeht — die Rechnung dafür steht
 * in @/components/material/prepare-page, die Maße und Grenzen in @/lib/images,
 * und der Server prüft sie ein zweites Mal.
 *
 * Mehrere Bilder gehen einzeln über die Leitung, eine Anfrage je Seite: das
 * erste legt das Blatt an, jedes weitere hängt sich mit der zurückgegebenen id
 * daran. Alles in eine FormData zu packen wäre kürzer geschrieben und
 * spätestens beim dritten Blatt an der Größengrenze einer Server Action
 * gescheitert. Next verschickt Server Actions ohnehin eine nach der anderen;
 * die Schleife hier ist deshalb ehrlich sequenziell und die Fortschrittsanzeige
 * damit wahr.
 *
 * Nichts geschieht hier stillschweigend. Jeder Weg, der schiefgehen kann — kein
 * Fach, keine Bilddatei, ein Format, das das Canvas nicht öffnet, eine Antwort
 * des Servers, ein abgebrochenes Netz — endet in einem deutschen Satz unter dem
 * Knopf und nicht in der Konsole. Bricht es mittendrin ab, nachdem schon Seiten
 * angekommen sind, steht daneben der Weg zu dem Blatt, das es bereits gibt.
 *
 * Was von vornherein nicht hineinpasst, sagt der Knopf, bevor die erste Anfrage
 * losgeht. Beim Anhängen zählt nicht die Obergrenze eines leeren Blattes,
 * sondern der freie Platz in diesem (`remaining`): eine zu große Auswahl wird
 * als Ganzes abgelehnt. Ohne diese Prüfung liefe die Schleife in die Grenze
 * hinein, das Blatt wäre nach einer Seite voll, und die Seite darüber nähme dem
 * Auslöser genau in diesem Moment seine Knöpfe weg — der Satz über die
 * Aufnahmen, die nicht mehr ankamen, verschwände mit ihnen.
 */

export type CaptureButtonProps = {
  /** Vorbelegtes Fach. Leer heißt: der Nutzer muss erst eins wählen. */
  subjectId: string | null;
  /** Alle Fächer, für die Auswahl direkt am Auslöser. */
  subjects: Array<{ id: string; name: string; short: string; color: string }>;
  /** Der heutige Kalendertag aus todayInBerlin(). */
  today: string;
  /** Gesetzt heißt: die Seiten hängen sich an dieses Blatt statt ein neues anzulegen. */
  materialId?: string;
  /** Beschriftung, z.B. "Blatt aufnehmen" oder "Seite hinzufügen". */
  label?: string;
  /**
   * Es gibt Fächer, aber alle sind archiviert. `subjects` ist dann genauso leer
   * wie bei einem Konto ohne jedes Fach — und der Rat „anlegen“ wäre falsch:
   * zu tun ist, eines der vorhandenen zurückzuholen.
   */
  allArchived?: boolean;
  /**
   * Nur beim Anhängen: wie viele Seiten noch an das Blatt passen. Ohne die Zahl
   * kennt der Auslöser nur die Grenze eines leeren Blattes und merkt erst
   * mitten in der Schleife, dass kein Platz mehr ist.
   */
  remaining?: number;
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Ein Abonnement auf nichts — es gibt keine Änderung, auf die zu horchen wäre. */
const NEVER_CHANGES = () => () => {};

export function CaptureButton({
  subjectId,
  subjects,
  today,
  materialId,
  label,
  allArchived = false,
  remaining,
  className,
}: CaptureButtonProps) {
  const router = useRouter();
  const fieldId = `capture-subject-${useId()}`;

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Das vorbelegte Fach. Ein einziges Fach braucht keine Auswahl — es ist die
  // Antwort auf eine Frage, die sich nicht stellt. Alles, was mit „ist hier ein
  // Fach vorbelegt?“ zu tun hat, liest ab jetzt genau diesen einen Wert: die
  // Auswahl darf nicht verschwinden, während der Knopf noch auf ein Fach wartet.
  const preset =
    subjectId ?? (subjects.length === 1 ? (subjects[0]?.id ?? "") : "");

  const [chosen, setChosen] = useState(preset);

  // Das vorbelegte Fach wechselt unter der Komponente hindurch: die Fach-Chips
  // auf /material sind next/link-Navigationen auf dieselbe Route mit anderem
  // Query-Parameter. React lässt diese Client-Komponente dabei an ihrer Stelle
  // im Baum stehen und der Server reicht nur ein neues `subjectId` nach. Ohne
  // das Nachziehen bliebe `chosen` auf dem Wert vom ersten Rendern stehen,
  // während der Zweig, der die Auswahl versteckt, schon dem neuen Prop glaubt —
  // das Blatt landete still im vorigen Fach oder in gar keinem.
  //
  // Nachgezogen wird beim Rendern über den mitgeführten vorigen Prop, nicht per
  // useEffect: so stimmt der Wert schon im ersten Bild und niemand sieht
  // dazwischen den alten. Ein `key` auf der Seite wäre kürzer geschrieben, würde
  // die Komponente aber neu aufbauen und dabei Fortschritt, Fehlermeldung und
  // vor allem den Weg zu einem eben angelegten Blatt wegwerfen — genau das, was
  // nach einem Abbruch mitten in der Aufnahme gebraucht wird.
  const [lastSubjectId, setLastSubjectId] = useState(subjectId);
  if (subjectId !== lastSubjectId) {
    setLastSubjectId(subjectId);
    setChosen(preset);
  }

  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Steht ein Blatt schon halb in der Ablage, führt hier der Weg dorthin. */
  const [saved, setSaved] = useState<string | null>(null);
  /** Offen heißt: die Kamera läuft in der App und der Rest ist verdeckt. */
  const [viewfinderOpen, setViewfinderOpen] = useState(false);
  /** Was der zuletzt geschlossene Sucher mitgebracht hat. */
  const [fromViewfinder, setFromViewfinder] = useState(0);
  /**
   * Der Sucher ging nicht auf — kein Zugriff auf die Kamera, keine vorhanden,
   * von einer anderen App belegt. Ab dann führt der Knopf den alten Weg über
   * die Kamera des Geräts. Ohne dieses Merken liefe jeder weitere Antipper
   * wieder in denselben schwarzen Bildschirm.
   */
  const [viewfinderBlocked, setViewfinderBlocked] = useState(false);

  /**
   * Ob es einen Sucher gibt, weiß erst der Browser — `navigator` und
   * `matchMedia` gibt es auf dem Server nicht. Auf dem Server steht deshalb
   * `false`, und das ist richtig so: der Knopf sieht in beiden Fällen gleich
   * aus, es ändert sich nur, was er beim Antippen tut.
   *
   * `useSyncExternalStore` und kein Effekt mit setState: gefragt wird nach einer
   * Eigenschaft des Geräts, nicht nach etwas, das die App selbst weiß. React
   * liest sie beim Hydrieren einmal ab, statt erst zu rendern und sich dann zu
   * berichtigen — und `NEVER_CHANGES` sagt, was wahr ist: eine Kamera wächst
   * einem Gerät nicht im Betrieb.
   */
  const viewfinderAvailable = useSyncExternalStore(
    NEVER_CHANGES,
    hasViewfinder,
    () => false,
  );

  // Beim Anhängen weiterer Seiten spielt das Fach keine Rolle: das Blatt hat
  // schon eins, und die Seite erbt es.
  const needsSubject = !materialId;
  // Dieselbe Quelle wie `chosen`: die Auswahl steht genau dann da, wenn kein
  // Fach vorbelegt ist. Sonst könnte sie verschwinden, obwohl der Knopf gleich
  // „Wähl zuerst ein Fach“ sagt — eine Sackgasse bis zum Neuladen.
  const showPicker = needsSubject && preset === "";

  // Wie viele Seiten diese Auswahl noch aufnehmen kann. Beim Anhängen ist das
  // der freie Platz im Blatt, den nur die Seite darüber kennt; bei einer
  // frischen Aufnahme entsteht das Blatt erst hier und hat die volle Grenze.
  // Fehlt `remaining` beim Anhängen, bleibt es bei der alten, zu großzügigen
  // Annahme — falsch wäre erst, sie für die Wahrheit auszugeben.
  const capacity =
    materialId && remaining !== undefined ? Math.max(0, remaining) : MAX_PAGES;
  const full = capacity === 0;

  /**
   * Die Bestätigung nach einer Aufnahme — und der Weg zum Blatt, für den, der
   * ihn gleich will.
   *
   * Sie steht nur, wenn wirklich etwas angekommen ist und nichts schiefging;
   * beim nächsten Auslösen räumt `openPicker()` sie weg. Beim Anhängen einer
   * Seite steht sie nicht: dort sieht man das Ergebnis auf der Seite, auf der
   * man ohnehin ist.
   *
   * Nach dem Sucher steht statt des Weges die Zahl da. Ein Stapel hat kein
   * „das Blatt“, auf das ein Link zeigen könnte — die Blätter stehen alle
   * darunter im Raster, und dorthin führt kein Satz, sondern der Blick.
   */
  const savedNote =
    fromViewfinder > 0 && !error && !pending ? (
      <p className="text-sm text-muted">
        {fromViewfinder === 1
          ? "1 Blatt angekommen."
          : `${fromViewfinder} Blätter angekommen.`}{" "}
        Das nächste kann gleich kommen.
      </p>
    ) : saved && !error && !pending ? (
      <p className="text-sm text-muted">
        Angekommen — das nächste kann gleich kommen.{" "}
        <Link
          href={`/material/${saved}`}
          className="text-foreground underline underline-offset-2"
        >
          Zum Blatt
        </Link>
      </p>
    ) : null;

  /** Der Satz unter dem Knopf. Er steht an beiden Stellen, an denen es ihn gibt. */
  const errorNote = error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
      {saved ? (
        <>
          {" "}
          <Link
            href={`/material/${saved}`}
            className="underline underline-offset-2"
          >
            Zum Blatt
          </Link>
        </>
      ) : null}
    </p>
  ) : null;

  /**
   * Der Sucher hat zugemacht. Aufgefrischt wird auch bei null Aufnahmen nicht
   * ins Blaue: wer die Kamera öffnet und wieder schließt, hat nichts geändert,
   * und ein `refresh()` für nichts kostet eine Anfrage.
   */
  const closeViewfinder = useCallback(
    ({
      arrived,
      startError,
    }: {
      arrived: number;
      startError: string | null;
    }) => {
      setViewfinderOpen(false);
      setFromViewfinder(arrived);

      // Der Satz gehört unter den Knopf, und der Knopf muss von nun an den
      // anderen Weg gehen.
      if (startError) {
        setViewfinderBlocked(true);
        setError(startError);
      }

      if (arrived > 0) {
        // Damit das Raster „Zuletzt aufgenommen“ darunter zeigt, was eben
        // hereinkam. Gesprungen wird nicht — siehe `run()`.
        router.refresh();
      }
    },
    [router],
  );

  if (needsSubject && subjects.length === 0) {
    // Zwei Lagen, zwei Wege. `subjects` sind die aktiven Fächer, und leer heißt
    // für sich genommen noch nicht „es gibt kein Fach“: sind alle archiviert,
    // sieht der Auslöser dasselbe Nichts, aber angelegt ist längst etwas. Ein
    // viertes Fach anzulegen wäre dann der falsche Rat. Zurückgeholt wird ein
    // Fach unter /faecher: dort stehen die archivierten hinter dem Abschnitt
    // „Archiviert“, und antippen führt zu dem Knopf, der sie wieder aktiviert.
    // Der Wortlaut ist deshalb derselbe wie dort („Zum Zurückholen antippen“).
    return (
      <div className={cn("space-y-3", className)}>
        <p className="text-sm text-muted">
          {allArchived
            ? "Ein Blatt gehört immer in ein Fach. Deine Fächer sind alle archiviert — solange keins wieder aktiv ist, gibt es nichts, wohin die Aufnahme könnte."
            : "Ein Blatt gehört immer in ein Fach. Solange keins angelegt ist, gibt es nichts, wohin die Aufnahme könnte."}
        </p>
        <ButtonLink
          href={allArchived ? "/faecher" : "/faecher/neu"}
          className="w-full sm:w-auto"
        >
          {allArchived ? "Fach zurückholen" : "Fach anlegen"}
        </ButtonLink>
      </div>
    );
  }

  // Das Blatt ist voll: anzubieten hat der Auslöser nichts mehr. Aus dem Baum
  // nimmt ihn die Seite darüber trotzdem nicht (siehe material/[id]/page.tsx) —
  // volllaufen kann ein Blatt mitten in einer Aufnahme, und mit der Komponente
  // verschwände die Meldung darüber, was nicht mehr angekommen ist. `null` ist
  // hier deshalb kein Abbau: die Komponente bleibt samt State an ihrer Stelle
  // im Baum und zeigt nur nichts, solange sie nichts zu sagen hat.
  if (full) {
    return errorNote || savedNote ? (
      <div className={cn("space-y-3", className)}>
        {errorNote}
        {savedNote}
      </div>
    ) : null;
  }

  /**
   * Eine Seite über die Leitung. Das Ergebnis ist die id des Blattes — beim
   * ersten Bild die eines frisch angelegten, danach die schon bekannte.
   */
  async function send(file: File, target: string | null): Promise<string> {
    const page = await prepareFile(file);

    return sendPage(
      page,
      target
        ? { materialId: target }
        : { subjectId: chosen, capturedOn: today },
    );
  }

  async function run(files: File[]) {
    // Das Blatt, an das gehängt wird: entweder das mitgegebene, oder das, das
    // die erste Seite gleich anlegt.
    let target = materialId ?? null;
    let done = 0;

    setProgress({ done: 0, total: files.length });

    try {
      for (const file of files) {
        target = await send(file, target);
        done += 1;
        // Nur ein frisch angelegtes Blatt braucht später den Weg dorthin; wer
        // Seiten anhängt, steht ohnehin schon darauf.
        if (!materialId) setSaved(target);
        setProgress({ done, total: files.length });
      }
    } catch (cause) {
      const message =
        cause instanceof CaptureError ? cause.message : NETWORK_MESSAGE;

      // Was schon angekommen ist, ist angekommen. Der Satz sagt beides.
      setError(
        done > 0
          ? `${message} Die ${done === 1 ? "erste Seite steht" : `ersten ${done} Seiten stehen`} schon im Blatt.`
          : message,
      );
      setProgress(null);
      return;
    }

    setProgress(null);

    // **Nach der Aufnahme bleibt der Auslöser stehen.** Bis Stufe 3 sprang er
    // auf das frische Blatt — „ein neues Blatt will angesehen und
    // richtiggestellt werden". Das stimmte, solange es den Eingangskorb nicht
    // gab; seitdem ist Richtigstellen dessen Aufgabe, und der Sprung nimmt nur
    // den Weg zum nächsten Foto.
    //
    // Und er widersprach der Seite, auf der er steht: die Kameraseite zeigt
    // unter dem Knopf die zuletzt aufgenommenen Blätter, ausdrücklich als
    // Bestätigung, „ohne die Ablage zu öffnen" (siehe @/components/home/
    // capture-pane). Wer sofort weggeschickt wird, bekommt sie nie zu sehen.
    //
    // Ein Stapel Blätter ist der Normalfall, nicht die Ausnahme: fünf Zettel
    // aus der Epoche sind fünfmal auslösen. Mit dem Sprung war das jedes Mal
    // Foto, Blattseite, zurück, wischen, auslösen — vier Handgriffe für einen.
    // Der Weg zum Blatt geht dabei nicht verloren, er steht als Satz darunter.
    router.refresh();
  }

  /**
   * Was der große Knopf tut. Der Sucher, wo es einen gibt; sonst die Kamera des
   * Geräts über das versteckte `<input capture>`.
   *
   * Ohne gewähltes Fach geht beides gar nicht erst auf. Andersherum stünde der
   * Nutzer nach dem Auslösen mit einem Foto da, das nirgendwohin kann — und im
   * Sucher gäbe es keine Stelle, an der er es noch nachreichen könnte.
   */
  function capture() {
    setSaved(null);
    setFromViewfinder(0);

    if (needsSubject && !chosen) {
      setError("Wähl zuerst ein Fach, dann geht es los.");
      return;
    }

    setError(null);

    if (viewfinderAvailable && !viewfinderBlocked) {
      setViewfinderOpen(true);
      return;
    }

    cameraRef.current?.click();
  }

  /** Die Galerie geht immer über die Dateiauswahl — dort ist keine Kamera im Spiel. */
  function openGallery() {
    setSaved(null);
    setFromViewfinder(0);

    if (needsSubject && !chosen) {
      setError("Wähl zuerst ein Fach, dann geht es los.");
      return;
    }

    setError(null);
    galleryRef.current?.click();
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    // Ohne das Zurücksetzen löst dieselbe Datei beim zweiten Mal kein `change`
    // aus — der Auslöser täte dann scheinbar nichts.
    event.target.value = "";

    if (files.length === 0) return;

    setError(null);
    setSaved(null);
    setFromViewfinder(0);

    // Abgelehnt wird die ganze Auswahl und nicht nur der Überhang: die
    // passenden Seiten trotzdem hochzuladen wäre auch ehrlich, ließe den Nutzer
    // aber mit einem vollen Blatt und Bildern zurück, von denen er nicht mehr
    // weiß, welche schon drin sind. Bei einem Arbeitsblatt zählt die
    // Reihenfolge, und die soll er selbst bestimmen. Vor allem geschieht so
    // überhaupt nichts, bevor er den Satz gelesen hat.
    if (files.length > capacity) {
      setError(
        // „nur noch“ darf nur dastehen, wo der freie Platz wirklich bekannt
        // ist. Ohne `remaining` ist `capacity` die volle Grenze, und dann sagt
        // der allgemeine Satz die Wahrheit.
        materialId && remaining !== undefined
          ? `An dieses Blatt ${capacity === 1 ? "passt nur noch eine Seite" : `passen nur noch ${capacity} Seiten`}, ausgewählt sind ${files.length}. Nimm erst so viele, wie hineinpassen — der Rest wird ein neues Blatt.`
          : `An ein Blatt passen ${MAX_PAGES} Seiten. Nimm den Rest als zweites Blatt auf.`,
      );
      return;
    }

    startTransition(async () => {
      await run(files);
    });
  }

  const buttonLabel =
    label ?? (materialId ? "Seite hinzufügen" : "Blatt aufnehmen");

  const busyLabel =
    progress && progress.total > 1
      ? `Seite ${Math.min(progress.done + 1, progress.total)} von ${progress.total} …`
      : "Wird gespeichert …";

  // Im Sucher steht oben, wohin die Blätter fallen. Beim Anhängen ist das keine
  // Frage mehr — dort steht, was der Knopf sagt.
  const viewfinderLabel = materialId
    ? buttonLabel
    : (subjects.find((subject) => subject.id === chosen)?.name ?? "Aufnehmen");

  return (
    <div className={cn("space-y-3", className)}>
      {showPicker ? (
        <Field id={fieldId} label="Fach">
          {(control) => (
            <Select
              {...control}
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            >
              <option value="">Fach wählen</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      {viewfinderOpen ? (
        <Viewfinder
          target={
            materialId
              ? { materialId }
              : { subjectId: chosen, capturedOn: today }
          }
          label={viewfinderLabel}
          capacity={materialId ? capacity : Number.POSITIVE_INFINITY}
          onClose={closeViewfinder}
        />
      ) : null}

      {/* Beide Wege liegen versteckt hinter den Knöpfen: der erste öffnet
          unmittelbar die Kamera (capture), der zweite die Dateiauswahl. Ein
          sichtbares <input type="file"> sähe an dieser Stelle wie ein Formular
          aus, und ein Formular ist genau das, was hier keiner ausfüllen will.

          Das erste ist seit dem Sucher nur noch der Rückfallweg — für Geräte
          ohne Kamerazugriff und für den Fall, dass der Sucher nicht aufgeht.

          `multiple` steht an beiden. An der Kamera bleibt es folgenlos — die
          gibt ein Foto zurück und fertig —, in der Galerie ist es der ganze
          Sinn: ein Arbeitsblatt mit Rückseite sind zwei Bilder, und die
          gehören an dasselbe Blatt. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handlePick}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handlePick}
      />

      {/* Am Handy füllt der Auslöser die Zeile und ist mit 68px so hoch, dass
          der Daumen ihn im Vorbeigehen trifft. Am großen Bildschirm gibt es
          weder Kamera noch Eile — dort stehen beide Knöpfe in gewohnter Größe
          nebeneinander und nicht als Balken quer über die Seite. */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="lg"
          loading={pending}
          onClick={capture}
          className={cn("flex-1 sm:flex-none", !materialId && "h-[68px] sm:h-12")}
        >
          {pending ? busyLabel : buttonLabel}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={pending}
          onClick={openGallery}
          className={cn("shrink-0", !materialId && "h-[68px] sm:h-12")}
        >
          Galerie
        </Button>
      </div>

      {errorNote}
      {savedNote}
    </div>
  );
}
