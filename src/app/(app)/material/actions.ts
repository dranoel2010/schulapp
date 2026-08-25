"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { formErrors } from "@/lib/form-errors";
import { markFiled } from "@/lib/inbox";
import {
  MAX_PAGES,
  MAX_PAGE_BYTES,
  MAX_READING_BYTES,
  MAX_THUMB_BYTES,
  isAllowedMime,
} from "@/lib/images";
import {
  addPage,
  createMaterialWithPage,
  defaultMaterialTitle,
  deleteMaterial,
  deletePage,
  getMaterial,
  materialInputSchema,
  ownsSubject,
  setMaterialTopics,
  updateMaterial,
  type MaterialFieldErrors,
  type MaterialFormState,
  type NewPage,
} from "@/lib/materials";

/**
 * Die Server Actions der Ablage.
 *
 * Das Prüfschema steht in @/lib/materials und wird hier nur benutzt — dieselbe
 * Tür gilt damit für jeden Aufrufer und nicht nur für dieses Formular.
 *
 * **Alles, was der Browser mitschickt, wird hier noch einmal geprüft.** Er hat
 * das Bild verkleinert, das Format gewählt und die Maße gezählt; keine dieser
 * Angaben ist deshalb wahr. Eine Server Action ist eine Adresse wie jede
 * andere, und wer sie ohne Browser anspricht, schickt, was er will. Geprüft
 * werden Format, Größe und Maße, bevor irgendetwas in die Datenbank geht.
 *
 * Die beiden Aufnahme-Actions geben ein Ergebnis zurück und leiten nicht
 * weiter. Der Auslöser ist eine Client-Komponente und soll dem Nutzer einen
 * Satz zeigen können; ein `redirect()` wirft intern, und dann käme bei ihm nie
 * eine Antwort an. Was mit der id geschieht, entscheidet der Browser — heute:
 * stehenbleiben und sie als Weg zum Blatt anbieten (siehe `run()` in
 * @/components/material/capture-button).
 *
 * Aufgefrischt wird nach jeder Änderung auch „/“: die Startseite zeigt die
 * letzten Blätter — am Handy auf der Kameraseite, am Rechner in der
 * Material-Karte des Dashboards. Ohne das bliebe dort das Bild stehen, das vor
 * der Aufnahme galt, und der Nutzer müsste glauben, sie sei nicht angekommen.
 */

/**
 * Die Feldnamen, unter denen an diesem Formular eine Meldung stehen kann.
 *
 * `formErrors()` braucht sie als Typargument, damit der Compiler einen Tippfehler
 * im Prüfschema bemerkt, statt eine Meldung unter ein Feld zu legen, das es auf
 * dem Bildschirm nicht gibt.
 */
type MaterialErrorField = keyof MaterialFieldErrors & string;

/** Was der Auslöser zurückbekommt: die id des Blattes oder einen Satz dazu. */
export type CaptureResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Wenn beim Speichern etwas schiefgeht, das die App nicht vorhergesehen hat.
 *
 * Der englische Text der Datenbank gehört ins Serverlog und nicht auf den
 * Bildschirm — dort steht ein Satz, mit dem sich etwas anfangen lässt.
 */
const SAVE_FAILED =
  "Das Blatt konnte nicht gespeichert werden. Versuch es noch einmal.";

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
async function readPage(
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

/**
 * Beim Aufnehmen gibt es kein Feld, unter das eine Meldung passt — der
 * Auslöser hat nur einen Platz für einen Satz. Also den ersten.
 */
function firstMessage(
  issues: { message: string }[],
  fallback: string,
): string {
  return issues[0]?.message ?? fallback;
}

/**
 * Nach jeder Änderung: die Ablage, das Blatt selbst, die Startseite und der
 * Eingangskorb.
 *
 * Die Startseite zeigt die letzten Blätter — ohne sie bliebe dort das alte
 * Vorschaubild stehen. Der Korb steht mit dabei, weil jede Aufnahme genau
 * dorthin ein Blatt legt (`filed_at` bleibt leer) und jedes Löschen eines
 * herausnimmt; ohne ihn zeigte er beim Blättern zurück eine Liste von vorhin.
 * Dieselben vier Adressen frischt `revalidateInbox()` drüben auf — was hier
 * fehlte, stünde dort noch im Stand von vor der Änderung.
 */
function revalidateMaterial(id?: string): void {
  revalidatePath("/");
  revalidatePath("/material");
  revalidatePath("/material/eingang");
  if (id) revalidatePath(`/material/${id}`);
}

/**
 * Ein frisch aufgenommenes Blatt: Fach, Tag und die erste Seite.
 *
 * Der Titel wird nicht mitgeschickt, sondern vorgeschlagen („Blatt vom 21.8.“).
 * Beim Aufnehmen im Unterricht bleiben zwei Sekunden; getippt wird auf der
 * Seite danach, und dort steht der Vorschlag im Feld.
 */
export async function captureMaterialAction(
  formData: FormData,
): Promise<CaptureResult> {
  const user = await requireUser();

  const capturedOn = text(formData, "capturedOn");

  const parsed = materialInputSchema.safeParse({
    subjectId: text(formData, "subjectId"),
    title: defaultMaterialTitle(capturedOn),
    capturedOn,
    note: null,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: firstMessage(
        parsed.error.issues,
        "Diese Aufnahme lässt sich nicht speichern.",
      ),
    };
  }

  if (!(await ownsSubject(user.id, parsed.data.subjectId))) {
    return { ok: false, message: "Dieses Fach gibt es nicht mehr." };
  }

  const page = await readPage(formData);
  if (!page.ok) {
    return { ok: false, message: page.message };
  }

  try {
    const id = await createMaterialWithPage(user.id, parsed.data, page.page);

    revalidateMaterial(id);
    return { ok: true, id };
  } catch (error) {
    console.error("Blatt aufnehmen fehlgeschlagen", error);
    return { ok: false, message: SAVE_FAILED };
  }
}

/**
 * Eine weitere Seite an ein vorhandenes Blatt.
 *
 * Ob es das Blatt noch gibt und wie viele Seiten daran hängen, wird vorher
 * nachgesehen: `addPage()` gibt für beide Fälle dasselbe Nichts zurück, und
 * „gibt es nicht mehr“ und „zwölf sind genug“ sind zwei verschiedene
 * Nachrichten.
 */
export async function addPageAction(
  formData: FormData,
): Promise<CaptureResult> {
  const user = await requireUser();

  const materialId = text(formData, "materialId");

  const material = await getMaterial(user.id, materialId);
  if (!material) {
    return { ok: false, message: "Dieses Blatt gibt es nicht mehr." };
  }

  if (material.pages.length >= MAX_PAGES) {
    return {
      ok: false,
      message: `An ein Blatt passen ${MAX_PAGES} Seiten. Was mehr ist, ist ein zweites Blatt.`,
    };
  }

  const page = await readPage(formData);
  if (!page.ok) {
    return { ok: false, message: page.message };
  }

  try {
    const created = await addPage(user.id, material.id, page.page);
    if (!created) {
      return { ok: false, message: SAVE_FAILED };
    }

    revalidateMaterial(material.id);
    return { ok: true, id: material.id };
  } catch (error) {
    console.error("Seite hinzufügen fehlgeschlagen", error);
    return { ok: false, message: SAVE_FAILED };
  }
}

/**
 * Titel, Fach, Tag, Notiz und Themen richtigstellen.
 *
 * Ohne Weiterleitung: das Formular steht auf der Seite des Blattes, und dort
 * bleibt man auch nach dem Speichern — die Seiten daneben will man ja sehen.
 *
 * Die Themen kommen nach dem Blatt an die Reihe. Wechselt das Fach, löscht
 * `updateMaterial()` die bisherigen Paarungen; erst danach steht fest, in
 * welchem Vokabular die neuen Themen angelegt werden.
 *
 * **Was aus den getippten Themen nicht wurde, steht danach auf dem Bildschirm
 * — beide Fälle.** Ein Titel ohne Fachwort wird gar nicht erst angelegt
 * („Übungen“ ist kein Thema, sondern das, was man damit macht), und zwei
 * Titel, die dieselbe Vokabel meinen, stehen einmal am Blatt („Kettenregel
 * Übungen“ neben „Kettenregel“). Beides kostet einen Chip, den der Nutzer
 * getippt hat; ohne diese Sätze verschwände er kommentarlos.
 *
 * Der Zähler `saves` geht nur hoch, wenn wirklich geschrieben wurde. An ihm
 * merkt das Formular, dass es seine Themenliste vom Server nachziehen muss —
 * der Grund steht in material-form.tsx. Nach einem Nein bleibt er stehen, und
 * zwar auf seinem bisherigen Wert und nicht auf nichts: er zählt, wie oft
 * dieses Formular geschrieben hat, und ein missglückter Versuch macht das
 * Geschriebene nicht ungeschehen. Fiele er zurück, hielte das Formular den
 * Rückfall für eine Änderung und ersetzte die Themen, an denen der Nutzer
 * gerade tippt, durch den Stand aus der Datenbank.
 */
export async function updateMaterialAction(
  id: string,
  state: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  const user = await requireUser();

  const parsed = materialInputSchema.safeParse({
    subjectId: text(formData, "subjectId"),
    title: text(formData, "title"),
    capturedOn: text(formData, "capturedOn"),
    note: text(formData, "note"),
  });

  if (!parsed.success) {
    return {
      saves: state.saves,
      ...formErrors<MaterialErrorField>(parsed.error.issues),
    };
  }

  if (!(await ownsSubject(user.id, parsed.data.subjectId))) {
    return {
      saves: state.saves,
      errors: { subjectId: "Dieses Fach gibt es nicht mehr." },
    };
  }

  try {
    // Das Fach gehört dem Nutzer, das ist eine Zeile weiter oben geprüft —
    // bleibt als Grund für ein Nein nur noch das Blatt selbst.
    if (!(await updateMaterial(user.id, id, parsed.data))) {
      return { saves: state.saves, message: "Dieses Blatt gibt es nicht mehr." };
    }

    const titles = formData
      .getAll("themen")
      .filter((value): value is string => typeof value === "string");

    const { verworfen, zusammengefallen, umbenannt } = await setMaterialTopics(
      user.id,
      id,
      titles,
    );

    // **Speichern heißt durchgesehen.** Das ist der dritte Ort, an dem
    // `filed_at` gesetzt wird, und ohne ihn hätte der Eingangskorb ein Loch in
    // seiner Hauptschleife: die Kamera schickt nach jeder Aufnahme genau
    // hierher (siehe capture-button.tsx), hier bekommt das Blatt seinen Titel
    // und seine Themen — und ohne diese Zeile stünde es danach trotzdem
    // unverändert im Korb. Der Korb füllte sich bei jeder Auslösung und leerte
    // sich auf dem Weg, den die App selbst anbietet, nie.
    //
    // Still ist das trotzdem nicht: umgeschaltet wird nur, wenn das Blatt
    // wirklich noch wartete (`markFiled()` fasst einen gesetzten Zeitpunkt
    // nicht noch einmal an), und genau dann steht es unten im Satz. Wer bloß
    // eine Notiz an einem längst eingeordneten Blatt richtigstellt, liest
    // deshalb nichts davon.
    const abgehakt = await markFiled(user.id, id, true);

    revalidateMaterial(id);

    const saves = (state.saves ?? 0) + 1;

    // Drei Sorten Nachricht, und keine davon ist ein Fehler — deshalb stehen
    // sie alle in der ruhigen Bestätigung und nicht in Rot unter einem Feld.
    // „Zusammengefallen" erklärt, warum ein Chip weniger dasteht;
    // „umbenannt", warum einer anders heißt, als er getippt wurde; und das
    // Abhaken, warum das Blatt gleich aus dem Korb verschwindet.
    const notice = [
      "Gespeichert.",
      ...zusammengefallen.map(
        ({ getippt, thema }) =>
          `„${getippt}“ meint dasselbe Thema wie „${thema}“ — es steht einmal am Blatt.`,
      ),
      ...umbenannt.map(
        ({ getippt, thema }) =>
          `„${getippt}“ führt dieses Fach als „${thema}“ — so steht es jetzt am Blatt.`,
      ),
      ...(abgehakt === "gesetzt"
        ? ["Damit ist es durchgesehen und liegt nicht mehr im Eingangskorb."]
        : []),
    ].join(" ");

    if (verworfen.length > 0) {
      return {
        saves,
        notice,
        errors: {
          topics: `Nicht übernommen: ${verworfen
            .map((title) => `„${title}“`)
            .join(", ")}. Ein Thema braucht ein Fachwort — „Übungen“ ist das, was man damit macht.`,
        },
      };
    }

    return { saves, notice };
  } catch (error) {
    console.error("Blatt speichern fehlgeschlagen", error);
    return { saves: state.saves, message: SAVE_FAILED };
  }
}

export async function deleteMaterialAction(id: string): Promise<void> {
  const user = await requireUser();

  await deleteMaterial(user.id, id);

  revalidateMaterial(id);
  redirect("/material");
}

/**
 * Eine einzelne Seite löschen. Ohne Weiterleitung — die anderen Seiten stehen
 * noch da, und man bleibt bei ihnen.
 *
 * Die letzte Seite eines Blattes bleibt stehen; `deletePage()` sagt das, und
 * die Oberfläche bietet den Knopf dort gar nicht erst an. Kommt die Antwort
 * trotzdem, ändert sich schlicht nichts.
 */
export async function deletePageAction(
  materialId: string,
  pageId: string,
): Promise<void> {
  const user = await requireUser();

  await deletePage(user.id, pageId);

  revalidateMaterial(materialId);
}
