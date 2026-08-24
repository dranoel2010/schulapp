"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";

import {
  addPageAction,
  captureMaterialAction,
} from "@/app/(app)/material/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import {
  fitWithin,
  JPEG_QUALITY,
  MAX_EDGE,
  MAX_PAGE_BYTES,
  MAX_PAGES,
  READING_EDGE,
  READING_QUALITIES,
  READING_TARGET_BYTES,
  THUMB_EDGE,
} from "@/lib/images";

/**
 * Der Auslöser: vom Foto zum gespeicherten Blatt.
 *
 * Er muss sich in zwei Sekunden bedienen lassen, während vorne noch etwas an
 * der Tafel steht. Deshalb ist der sichtbare Weg genau ein Knopf; er öffnet
 * über ein verstecktes `<input capture="environment">` unmittelbar die Kamera
 * des Geräts, ohne Zwischenseite und ohne Formular. Daneben steht leiser der
 * Weg aus der Galerie: am Rechner gibt es keine Kamera, und ein Foto, das
 * jemand weitergeschickt hat, ist genauso ein Blatt.
 *
 * Verkleinert wird hier im Browser, bevor etwas hochgeht. Ein Handyfoto wiegt
 * roh mehrere Megabyte; nach dem Zeichnen auf ein Canvas mit 1600 Pixel langer
 * Kante bleiben rund 250 KB übrig, und dieselbe Rechnung liefert gleich die
 * Vorschau und die Lesefassung mit. Die Maße und Grenzen dafür stehen in
 * @/lib/images — der Server prüft sie ein zweites Mal und soll dabei dieselbe
 * Zahl meinen. Dass es drei Größen sind und nicht zwei, liegt am Agenten: er
 * bekommt sein Bild durch ein Tool-Ergebnis, und dort ist bei rund 150 000
 * Zeichen Schluss (siehe `toReadingJpeg()` unten).
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

/**
 * Ein Fehler mit einem Satz, der so unter dem Knopf stehen darf. Alles andere,
 * was unterwegs geworfen wird, bekommt den allgemeinen Satz — ein Nutzer kann
 * mit „NotReadableError“ nichts anfangen.
 */
class CaptureError extends Error {}

const CANVAS_MESSAGE =
  "Das Bild ließ sich auf diesem Gerät nicht verkleinern. Versuch es noch einmal oder nimm ein anderes Foto.";

/**
 * Wenn die Leitung abreißt oder der Server gar nicht erst antwortet. Der Satz
 * verspricht nichts, was die App nicht weiß — nur, dass nichts angekommen ist.
 */
const NETWORK_MESSAGE =
  "Das Blatt ist nicht angekommen. Prüf deine Verbindung und versuch es noch einmal.";

/** Wie das Format in der Fehlermeldung heißt: "HEIC", "AVIF", "TIFF". */
function formatName(file: File): string {
  const fromType = file.type.split("/")[1];
  if (fromType) return fromType.toUpperCase();

  const parts = file.name.split(".");
  const extension = parts.length > 1 ? parts[parts.length - 1] : "";

  return extension ? extension.toUpperCase() : "unbekanntes Format";
}

/**
 * Das Bild als ImageBitmap, aufrecht.
 *
 * `imageOrientation: "from-image"` dreht das Bild so, wie die Kamera es meint —
 * ohne die Option läge ein hochkant aufgenommenes Blatt auf der Seite, weil der
 * EXIF-Vermerk beim Zeichnen auf das Canvas verlorengeht. Ältere Browser kennen
 * die Option nicht und werfen darüber; dann eben ohne, das ist immer noch
 * besser als kein Bild.
 */
async function readBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new CaptureError(
        `Dieses Bild kann der Browser nicht öffnen (${formatName(file)}). Speicher es als JPEG und versuch es noch einmal.`,
      );
    }
  }
}

/** Zeichnet das Bild in den Kasten und gibt ein JPEG zurück. */
async function toJpeg(
  bitmap: ImageBitmap,
  max: number,
  quality: number = JPEG_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }> {
  const size = fitWithin(bitmap.width, bitmap.height, max);

  // OffscreenCanvas zeichnet ohne Umweg über den Dokumentbaum und hält das
  // Gerät während der Aufnahme flüssig. Wo es das nicht gibt, tut es ein
  // gewöhnliches Canvas genauso — nur eben im Dokument.
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new CaptureError(CANVAS_MESSAGE);

    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality,
    });

    return { blob, width: size.width, height: size.height };
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext("2d");
  if (!context) throw new CaptureError(CANVAS_MESSAGE);

  context.drawImage(bitmap, 0, 0, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) throw new CaptureError(CANVAS_MESSAGE);

  return { blob, width: size.width, height: size.height };
}

/**
 * Die Lesefassung — dieselbe Kantenlänge, aber eine Größe, die durch ein
 * Tool-Ergebnis passt.
 *
 * Sie ist die einzige der drei Fassungen, die eine feste Obergrenze in Bytes
 * einhalten muss und nicht nur in Pixeln: ein Bild reist zum Agenten als
 * Base64, und dort ist bei rund 150 000 Zeichen Schluss. Wie schwer 1000 Pixel
 * ausfallen, hängt aber vom Blatt ab — ein Arbeitsblatt mit viel Weiß wiegt die
 * Hälfte eines abfotografierten Tafelbilds. Eine feste Qualität träfe deshalb
 * immer nur eines von beiden.
 *
 * Also wird gemessen statt geschätzt: die Stufen aus `READING_QUALITIES` der
 * Reihe nach, die erste, die unter `READING_TARGET_BYTES` bleibt, gewinnt. Das
 * sind im Normalfall null zusätzliche Durchgänge, weil schon die erste Stufe
 * passt, und im schlimmsten Fall drei — auf einem Bitmap, das ohnehin schon im
 * Speicher liegt.
 *
 * Bleibt auch die letzte Stufe zu schwer, wird sie trotzdem genommen. Ein zu
 * schweres Bild ist immer noch ein Bild; was daraus folgt, entscheidet das
 * Tool, das es ausliefern soll, und nicht der Auslöser im Unterricht. Hier
 * abzubrechen hieße, eine Aufnahme wegen des Agenten zu verlieren — und die
 * App ist ohne ihn vollständig.
 */
async function toReadingJpeg(bitmap: ImageBitmap): Promise<Blob> {
  let last: Blob | null = null;

  for (const quality of READING_QUALITIES) {
    const attempt = await toJpeg(bitmap, READING_EDGE, quality);
    last = attempt.blob;

    if (attempt.blob.size <= READING_TARGET_BYTES) return attempt.blob;
  }

  if (!last) throw new CaptureError(CANVAS_MESSAGE);

  return last;
}

/**
 * Ein Bild in die drei Größen, die gespeichert werden: das Vollbild, die
 * Lesefassung für den Agenten und die Vorschau. Alle drei entstehen aus
 * demselben ImageBitmap, das danach geschlossen wird — ein Handy hält den
 * Speicher sonst bis zum nächsten Neuladen fest.
 */
async function prepare(file: File): Promise<{
  image: Blob;
  reading: Blob;
  thumb: Blob;
  width: number;
  height: number;
}> {
  if (!file.type.startsWith("image/")) {
    throw new CaptureError(`„${file.name}“ ist kein Bild.`);
  }

  const bitmap = await readBitmap(file);

  try {
    const full = await toJpeg(bitmap, MAX_EDGE);
    const reading = await toReadingJpeg(bitmap);
    const thumb = await toJpeg(bitmap, THUMB_EDGE);

    if (full.blob.size > MAX_PAGE_BYTES) {
      throw new CaptureError(
        "Das Bild bleibt auch verkleinert zu groß. Nimm das Blatt noch einmal auf, am besten ohne Zoom.",
      );
    }

    return {
      image: full.blob,
      reading,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Der Aufruf der Server Action, mit einem Satz für den Fall, dass sie gar
 * nicht antwortet. Next bricht eine zu große Anfrage mit einem Fehler ab, den
 * der Aufrufer als Ausnahme sieht und nicht als Ergebnis — ohne dieses catch
 * stünde davon ein Overlay auf dem Bildschirm statt eines Satzes unter dem
 * Knopf.
 */
async function callAction(target: string | null, formData: FormData) {
  try {
    return target
      ? await addPageAction(formData)
      : await captureMaterialAction(formData);
  } catch {
    throw new CaptureError(NETWORK_MESSAGE);
  }
}

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
    return errorNote ? (
      <div className={cn("space-y-3", className)}>{errorNote}</div>
    ) : null;
  }

  /**
   * Eine Seite über die Leitung. Das Ergebnis ist die id des Blattes — beim
   * ersten Bild die eines frisch angelegten, danach die schon bekannte.
   */
  async function send(file: File, target: string | null): Promise<string> {
    const page = await prepare(file);

    const formData = new FormData();
    formData.set("breite", String(page.width));
    formData.set("hoehe", String(page.height));
    formData.set("bild", page.image, "blatt.jpg");
    formData.set("lesefassung", page.reading, "lesefassung.jpg");
    formData.set("vorschau", page.thumb, "vorschau.jpg");

    if (target) {
      formData.set("materialId", target);
    } else {
      formData.set("subjectId", chosen);
      formData.set("capturedOn", today);
    }

    const result = await callAction(target, formData);
    if (!result.ok) throw new CaptureError(result.message);

    return result.id;
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

    // Ein neues Blatt will angesehen und richtiggestellt werden; eine
    // nachgeschobene Seite gehört auf die Seite, auf der man ohnehin steht.
    if (materialId) {
      router.refresh();
    } else if (target) {
      router.push(`/material/${target}`);
    }
  }

  /**
   * Ohne gewähltes Fach geht die Kamera gar nicht erst auf. Andersherum stünde
   * der Nutzer nach dem Auslösen mit einem Foto da, das nirgendwohin kann.
   */
  function openPicker(input: HTMLInputElement | null) {
    setSaved(null);

    if (needsSubject && !chosen) {
      setError("Wähl zuerst ein Fach, dann geht es los.");
      return;
    }

    setError(null);
    input?.click();
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    // Ohne das Zurücksetzen löst dieselbe Datei beim zweiten Mal kein `change`
    // aus — der Auslöser täte dann scheinbar nichts.
    event.target.value = "";

    if (files.length === 0) return;

    setError(null);
    setSaved(null);

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

      {/* Beide Wege liegen versteckt hinter den Knöpfen: der erste öffnet
          unmittelbar die Kamera (capture), der zweite die Dateiauswahl. Ein
          sichtbares <input type="file"> sähe an dieser Stelle wie ein Formular
          aus, und ein Formular ist genau das, was hier keiner ausfüllen will.

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
          onClick={() => openPicker(cameraRef.current)}
          className={cn("flex-1 sm:flex-none", !materialId && "h-[68px] sm:h-12")}
        >
          {pending ? busyLabel : buttonLabel}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={pending}
          onClick={() => openPicker(galleryRef.current)}
          className={cn("shrink-0", !materialId && "h-[68px] sm:h-12")}
        >
          Galerie
        </Button>
      </div>

      {errorNote}
    </div>
  );
}
