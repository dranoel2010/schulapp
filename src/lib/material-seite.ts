import {
  MAX_PAGE_BYTES,
  MAX_READING_BYTES,
  MAX_THUMB_BYTES,
  isAllowedMime,
} from "@/lib/images";
import type { NewPage } from "@/lib/materials";

/**
 * Eine aufgenommene Seite aus einem Formular lesen und prüfen — die Tür, die
 * die Server Actions der Ablage (`captureMaterialAction`, `addPageAction`)
 * und der Route Handler `POST /api/blaetter` (Modell 23, Plan 3.8) teilen.
 * Bis zum 12.10.2026 stand das als `readPage()` in
 * src/app/(app)/material/actions.ts; dort hätte ein Route Handler es nicht
 * importieren dürfen, ohne es zu einer Server Action zu machen.
 */

/** Ein Formularfeld als Text; alles andere (etwa eine Datei) zählt als leer. */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Eine Kantenlänge aus dem Browser. Null heißt: das ist keine Zahl, mit der
 * sich ein Bild anzeigen lässt.
 */
function pixels(formData: FormData, key: string): number | null {
  const value = Number(text(formData, key));
  if (!Number.isInteger(value) || value < 1 || value > 20_000) return null;

  return value;
}

/** Ein leeres <input type="file"> schickt trotzdem etwas mit: 0 Bytes. */
function file(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size === 0) return null;

  return value;
}

/**
 * Die Bytes einer aufgenommenen Seite, samt allem, was daran geprüft wird.
 *
 * Gelesen wird erst ganz zum Schluss: `arrayBuffer()` holt die Datei in den
 * Arbeitsspeicher, und für eine Anfrage, die ohnehin abgelehnt wird, ist das
 * verschenkt.
 */
export async function readPage(
  formData: FormData,
): Promise<{ ok: true; page: NewPage } | { ok: false; message: string }> {
  const image = file(formData, "bild");
  const reading = file(formData, "lesefassung");
  const thumb = file(formData, "vorschau");

  if (!image || !reading || !thumb) {
    return {
      ok: false,
      message: "Von dieser Aufnahme ist nichts angekommen. Versuch es noch einmal.",
    };
  }

  if (
    !isAllowedMime(image.type) ||
    !isAllowedMime(reading.type) ||
    !isAllowedMime(thumb.type)
  ) {
    return { ok: false, message: "Dieses Format kann die App nicht lesen." };
  }

  // Eine Seite steht als eine Zeile in der Datenbank, und diese Zeile hat für
  // beide Blobs zusammen genau eine Spalte `mime_type`. Gespeichert wird das
  // Format des Vollbilds; die Vorschau wird unter demselben Format
  // ausgeliefert. Kämen die beiden in verschiedenen Formaten an, sagte
  // /api/material/<id>/vorschau also die Unwahrheit über seine eigenen Bytes —
  // und weil dort `nosniff` steht, weigert sich der Browser zu raten und zeigt
  // in Ablage, Dashboard und auf der Kameraseite ein kaputtes Bild. Über den
  // Auslöser kann das nicht passieren, der erzeugt beide aus demselben Canvas;
  // eine Server Action ist aber eine Adresse wie jede andere, und was die
  // Spalte voraussetzt, wird deshalb hier an der Tür geprüft statt gehofft.
  if (image.type !== thumb.type || image.type !== reading.type) {
    return {
      ok: false,
      message: "Bild, Lesefassung und Vorschau müssen dasselbe Format haben.",
    };
  }

  if (image.size > MAX_PAGE_BYTES) {
    return { ok: false, message: "Das Bild ist zu groß — höchstens 3 MB je Seite." };
  }

  // Lesefassung und Vorschau haben ihre eigene, viel engere Grenze: alle drei
  // zusammen müssen unter das bodySizeLimit von 5 MB passen, sonst bricht Next
  // die Anfrage ab, bevor dieser Prüfer sie je zu sehen bekommt. Jede bekommt
  // ihren eigenen Satz, weil „das Bild ist zu groß“ hier auf das falsche der
  // drei zeigte und der Nutzer dann am Vollbild suchte, was woanders liegt.
  if (reading.size > MAX_READING_BYTES) {
    return {
      ok: false,
      message: "Die Lesefassung ist zu groß — höchstens 400 KB.",
    };
  }

  if (thumb.size > MAX_THUMB_BYTES) {
    return {
      ok: false,
      message: "Die Vorschau ist zu groß — höchstens 400 KB.",
    };
  }

  const width = pixels(formData, "breite");
  const height = pixels(formData, "hoehe");

  if (width === null || height === null) {
    return { ok: false, message: "Zu diesem Bild fehlen die Maße." };
  }

  return {
    ok: true,
    page: {
      mimeType: image.type,
      width,
      height,
      image: new Uint8Array(await image.arrayBuffer()),
      reading: new Uint8Array(await reading.arrayBuffer()),
      thumb: new Uint8Array(await thumb.arrayBuffer()),
    },
  };
}

