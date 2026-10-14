"use client";

import {
  fitWithin,
  JPEG_QUALITY,
  MAX_EDGE,
  MAX_PAGE_BYTES,
  READING_EDGE,
  READING_QUALITIES,
  READING_TARGET_BYTES,
  THUMB_EDGE,
} from "@/lib/images";

/**
 * Vom Bild zu den drei Fassungen einer Seite, für die Kamera von Modell 23
 * (@/components/kombi/kamera): ein eingefrorenes Standbild aus dem Sucher
 * (`prepareCanvas`) oder ein Bild aus der Galerie (`prepareFile`). Beide Male
 * dasselbe: verkleinern auf drei Größen und prüfen. Hochgeladen wird über
 * /api/blaetter.
 *
 * Nicht hier steht die reine Rechnung — Maße, Grenzen, Größen liegen in
 * @/lib/images, ohne Canvas und ohne DOM, weil der Server dieselben Zahlen
 * meinen muss. Hier steht, was ohne Browser nicht geht.
 */

/**
 * Woraus gezeichnet wird: ein Bitmap aus einer Datei oder ein Standbild aus dem
 * laufenden Kamerabild. Die Maße stehen daneben, weil ein Video sie anders
 * nennt als ein Bild (`videoWidth` statt `width`) und ein halb geladenes Video
 * beides auf 0 stehen hat.
 */
type Frame = { draw: CanvasImageSource; width: number; height: number };

/** Die drei Fassungen einer Seite, fertig zum Verschicken. */
export type PreparedPage = {
  image: Blob;
  reading: Blob;
  thumb: Blob;
  width: number;
  height: number;
};

/**
 * Ein Fehler mit einem Satz, der so unter dem Knopf stehen darf. Alles andere,
 * was unterwegs geworfen wird, bekommt den allgemeinen Satz — ein Nutzer kann
 * mit „NotReadableError“ nichts anfangen.
 */
export class CaptureError extends Error {}

export const CANVAS_MESSAGE =
  "Das Bild ließ sich auf diesem Gerät nicht verkleinern. Versuch es noch einmal oder nimm ein anderes Foto.";

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
  frame: Frame,
  max: number,
  quality: number = JPEG_QUALITY,
): Promise<{ blob: Blob; width: number; height: number }> {
  const size = fitWithin(frame.width, frame.height, max);

  // OffscreenCanvas zeichnet ohne Umweg über den Dokumentbaum und hält das
  // Gerät während der Aufnahme flüssig. Wo es das nicht gibt, tut es ein
  // gewöhnliches Canvas genauso — nur eben im Dokument.
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new CaptureError(CANVAS_MESSAGE);

    context.drawImage(frame.draw, 0, 0, size.width, size.height);

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

  context.drawImage(frame.draw, 0, 0, size.width, size.height);

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
async function toReadingJpeg(frame: Frame): Promise<Blob> {
  let last: Blob | null = null;

  for (const quality of READING_QUALITIES) {
    const attempt = await toJpeg(frame, READING_EDGE, quality);
    last = attempt.blob;

    if (attempt.blob.size <= READING_TARGET_BYTES) return attempt.blob;
  }

  if (!last) throw new CaptureError(CANVAS_MESSAGE);

  return last;
}

/**
 * Eine Zeichenquelle in die drei Größen, die gespeichert werden: das Vollbild,
 * die Lesefassung für den Agenten und die Vorschau.
 *
 * **Alle drei aus derselben Quelle, und die muss stillstehen.** Bei einer Datei
 * versteht sich das; beim Sucher nicht — würde direkt aus dem laufenden
 * `<video>` gezeichnet, lägen zwischen dem Vollbild und der Vorschau ein paar
 * Hundertstelsekunden Handbewegung, und die Vorschau in der Ablage zeigte ein
 * anderes Bild als die Seite dahinter. Deshalb friert die Kamera das Bild
 * vorher ein.
 */
async function prepareFrame_(frame: Frame): Promise<PreparedPage> {
    const full = await toJpeg(frame, MAX_EDGE);
    const reading = await toReadingJpeg(frame);
    const thumb = await toJpeg(frame, THUMB_EDGE);

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
}

/**
 * Eine Datei aus Kamera oder Galerie. Das Bitmap wird danach geschlossen, auch
 * wenn es schiefging — ein Handy hält den Speicher sonst bis zum nächsten
 * Neuladen fest.
 */
export async function prepareFile(file: File): Promise<PreparedPage> {
  if (!file.type.startsWith("image/")) {
    throw new CaptureError(`„${file.name}“ ist kein Bild.`);
  }

  const bitmap = await readBitmap(file);

  try {
    return await prepareFrame_({
      draw: bitmap,
      width: bitmap.width,
      height: bitmap.height,
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Ein schon eingefrorenes Standbild (Canvas in voller Auflösung) in die drei
 * Fassungen — für die Kamera von Modell 23, die beim Auslösen einfriert und
 * erst nebenher rechnet, damit der nächste Tipp sofort geht. Das Canvas wird
 * danach geleert (rund 20 MB je Bild).
 */
export async function prepareCanvas(
  shot: HTMLCanvasElement,
): Promise<PreparedPage> {
  try {
    return await prepareFrame_({ draw: shot, width: shot.width, height: shot.height });
  } finally {
    shot.width = 0;
    shot.height = 0;
  }
}
