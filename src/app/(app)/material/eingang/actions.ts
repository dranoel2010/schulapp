"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { formErrors } from "@/lib/form-errors";
import {
  clearProposals,
  createProposal,
  deleteProposal,
  getProposal,
  markFiled,
  proposalInputSchema,
  updateProposal,
  type ProposalFieldErrors,
  type ProposalFormState,
} from "@/lib/inbox";
import {
  materialInputSchema,
  ownsSubject,
  setMaterialTopics,
  updateMaterial,
  type MaterialFieldErrors,
  type MaterialFormState,
} from "@/lib/materials";

/**
 * Die Server Actions des Eingangskorbs.
 *
 * Geprüft wird ausschließlich mit den Schemata aus @/lib:
 * `proposalInputSchema` für einen Vorschlag, `materialInputSchema` für das
 * Blatt. Hier steht keine eigene Regel, und das ist der Kern der ganzen Stufe:
 * der Bestand hat genau eine Tür, und die Bestätigung eines Vorschlags geht
 * durch dieselbe wie jedes Formular. Stünde hier ein zweites, nachsichtigeres
 * Schema, wäre der Eingangskorb genau der Weg, über den ein Agent am Formular
 * vorbei schriebe.
 *
 * **Zustandstypen stehen nicht in dieser Datei.** Eine „use server“-Datei darf
 * nur asynchrone Funktionen ausgeben; `ProposalFormState` und
 * `MaterialFormState` kommen deshalb aus @/lib/inbox bzw. @/lib/materials und
 * werden hier nur benutzt. Derselbe Grund steht in topic-list.tsx.
 *
 * Aufgefrischt wird nach jeder Änderung auch „/“: die Startseite zeigt die
 * letzten Blätter — am Handy auf der Kameraseite, am Rechner in der
 * Material-Karte. Ohne das bliebe dort der Stand von vor der Entscheidung
 * stehen.
 */

/**
 * Wenn beim Schreiben etwas schiefgeht, das die App nicht vorhergesehen hat.
 *
 * Der englische Text der Datenbank gehört ins Serverlog und nicht auf den
 * Bildschirm — dort steht ein Satz, mit dem sich etwas anfangen lässt.
 */
const SAVE_FAILED = "Das hat nicht geklappt. Versuch es noch einmal.";

/**
 * Was ein Vorschlag hinterlässt, der schon entschieden ist.
 *
 * Zwei Actions sagen diesen Satz, und beide meinen dasselbe: zwei offene
 * Seiten, zwei Geräte, und anderswo ist die Entscheidung längst gefallen. Ein
 * Satz für beide, damit nicht zwei verschiedene Erklärungen für denselben
 * Vorgang auf dem Bildschirm stehen.
 */
const GONE =
  "Diesen Vorschlag gibt es nicht mehr — er ist wohl schon übernommen oder " +
  "verworfen worden.";

/**
 * Die Feldnamen, unter denen an diesen beiden Formularen eine Meldung stehen
 * kann — als Typargument für `formErrors()`.
 *
 * Zwei Namen, weil hier zwei verschiedene Formulare bedient werden: das des
 * Vorschlags (`proposalInputSchema`) und das des Blattes
 * (`materialInputSchema`, beim Übernehmen). Sie sehen sich ähnlich und sind
 * es nicht — am Blatt gibt es „topics" als eigenen Platz für eine Meldung, am
 * Vorschlag heißt dasselbe Feld „topics" und ist Teil der Eingabe. Ein
 * gemeinsamer Typ hätte den Unterschied eingeebnet und eine Meldung unter ein
 * Feld gelegt, das auf dem jeweils anderen Bildschirm nicht steht.
 */
type ProposalErrorField = keyof ProposalFieldErrors & string;
type MaterialErrorField = keyof MaterialFieldErrors & string;

/** Ein Formularfeld als Text; alles andere (etwa eine Datei) zählt als leer. */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Die Themen eines Vorschlags: eine Zeile, ein Thema.
 *
 * Der Vorschlag bekommt kein Chip-Feld wie das Blatt (die Begründung steht in
 * proposal-form.tsx), sondern ein Textfeld. Zerlegt wird deshalb hier, an
 * Zeilenumbrüchen — und danach passiert nichts weiter: getrimmt, entdoppelt
 * und gedeckelt wird in `proposalInputSchema`, über `normalizeTopics()`. Ein
 * zweites Zurechtschneiden an dieser Stelle wäre eine zweite Regel, und die
 * beiden liefen irgendwann auseinander.
 */
function topicLines(formData: FormData): string[] {
  return text(formData, "themen").split(/[\r\n]+/);
}

/**
 * Nach jeder Änderung: die Startseite, die Ablage, das Blatt selbst, der Korb
 * und die Seite des einzelnen Vorschlags.
 *
 * Alle fünf, und nicht nur der Korb. Ein abgehaktes Blatt verschwindet aus dem
 * Korb, ein übernommener Vorschlag ändert Titel und Themen in der Ablage und am
 * Blatt, und die Startseite zeigt die letzten Blätter mit Vorschaubild und
 * Titel. Was hier fehlte, stünde anderswo noch im Stand von vor der
 * Entscheidung — und das ist die eine Sorte Fehler, die aussieht, als sei gar
 * nichts passiert.
 *
 * Die fünfte ist die wichtigste und war die, die fehlte: `/material/eingang/…`
 * ist die Seite, auf der man beim Ändern eines Vorschlags **steht**, und dort
 * muss die Gegenüberstellung danach den neuen Stand zeigen. Dass sie das heute
 * auch ohne diese Zeile täte, ist Zufall und kein Verlass: Next setzt nach
 * einer Server Action mit `revalidatePath()` seine Merkung „es wurde
 * aufgefrischt" **pfadunabhängig** und rendert die aktuelle Seite deshalb
 * ohnehin neu — im Quelltext daneben steht ein „TODO: only revalidate if the
 * path matches". Wird das eines Tages eingelöst, bliebe die Seite auf dem
 * alten Stand stehen, während in der Datenbank etwas anderes steht.
 *
 * Als Muster mit `"page"` und nicht als fertige Adresse: `/material/eingang/…`
 * ist eine dynamische Route, und ohne das zweite Argument tut Next dafür
 * nichts und warnt bloß.
 */
function revalidateInbox(materialId: string): void {
  revalidatePath("/");
  revalidatePath("/material");
  revalidatePath(`/material/${materialId}`);
  revalidatePath("/material/eingang");
  revalidatePath("/material/eingang/[id]", "page");
}

/**
 * Das Blatt abhaken oder wieder in den Korb legen.
 *
 * Der Weg für ein Blatt, an dem nichts zu ändern ist: angesehen, stimmt so,
 * weg damit. Ohne Weiterleitung — man arbeitet den Korb von oben nach unten ab
 * und soll dabei stehen bleiben, wo man ist.
 *
 * `filed` steht als Parameter und nicht im Formular: welcher der beiden Knöpfe
 * gedrückt wurde, weiß die Seite schon, und ein verstecktes Feld wäre eine
 * Angabe, die der Absender frei wählen kann.
 */
export async function markFiledAction(
  materialId: string,
  filed: boolean,
): Promise<void> {
  const user = await requireUser();

  await markFiled(user.id, materialId, filed);

  revalidateInbox(materialId);
}

/**
 * Einen Vorschlag von Hand anlegen.
 *
 * Das ist die Regel des Projekts in einer Funktion: alles, was ein Agent
 * später vorschlägt, muss vorher von Hand anzulegen sein. Heute gibt es keinen
 * Agenten — also entstehen alle Vorschläge hier, und dass sie es können, ist
 * der Beweis, dass die Tür funktioniert, bevor jemand hindurchgeht.
 *
 * `origin` wird nicht mitgeschickt und nicht gelesen. `createProposal()` setzt
 * von sich aus „manuell“, und genau so soll es sein: woher ein Vorschlag
 * kommt, entscheidet die Tür, durch die er hereinkommt, und nicht das Formular
 * — sonst könnte sich ein Absender als Agent ausgeben oder, schlimmer, ein
 * Agent als Mensch.
 *
 * Weitergeleitet wird zum Korb. Bliebe man hier stehen, stünde derselbe
 * Vorschlag noch einmal im Formular, und ein zweiter Druck auf denselben Knopf
 * legte ihn ein zweites Mal an — der Korb hätte dann zwei Zeilen, zwischen
 * denen niemand unterscheiden kann. Im Korb steht er dagegen unter seinem
 * Blatt, und das ist der Ort, an dem über ihn entschieden wird.
 */
export async function createProposalAction(
  materialId: string,
  state: ProposalFormState,
  formData: FormData,
): Promise<ProposalFormState> {
  const user = await requireUser();

  const parsed = proposalInputSchema.safeParse({
    subjectId: text(formData, "subjectId"),
    title: text(formData, "title"),
    capturedOn: text(formData, "capturedOn"),
    note: text(formData, "note"),
    topics: topicLines(formData),
  });

  if (!parsed.success) {
    return {
      saves: state.saves,
      ...formErrors<ProposalErrorField>(parsed.error.issues),
    };
  }

  try {
    const id = await createProposal(user.id, materialId, parsed.data);

    if (!id) {
      // `createProposal()` gibt für zwei Fälle dasselbe Nichts zurück: das
      // Blatt gehört dem Nutzer nicht (mehr), oder das vorgeschlagene Fach ist
      // ein fremdes. Beide sind von hier aus nicht zu unterscheiden, und beide
      // heißen für den Nutzer dasselbe — an einer der beiden Angaben stimmt
      // etwas nicht mehr.
      return {
        saves: state.saves,
        message:
          "Dazu lässt sich kein Vorschlag anlegen — das Blatt oder das " +
          "vorgeschlagene Fach gibt es nicht mehr.",
      };
    }

    revalidateInbox(materialId);
  } catch (error) {
    console.error("Vorschlag anlegen fehlgeschlagen", error);
    return { saves: state.saves, message: SAVE_FAILED };
  }

  // `redirect()` wirft intern (NEXT_REDIRECT) und steht deshalb außerhalb des
  // try — der ausführliche Grund steht an `confirmProposalAction()`.
  redirect("/material/eingang");
}

/**
 * Einen Vorschlag ändern, bevor man über ihn entscheidet.
 *
 * Ohne Weiterleitung, anders als beim Anlegen: das Formular steht auf der
 * Seite des Vorschlags, und dort will man danach die Gegenüberstellung noch
 * einmal lesen — sie hat sich ja gerade geändert. Wer den Korb wieder sehen
 * will, ist einen Tipp entfernt.
 */
export async function updateProposalAction(
  id: string,
  state: ProposalFormState,
  formData: FormData,
): Promise<ProposalFormState> {
  const user = await requireUser();

  // Zuerst nachsehen, ob es ihn noch gibt — und nebenbei, an welchem Blatt er
  // hängt. Ohne das ließe sich hinterher nicht auffrischen, und
  // `updateProposal()` sagte für „gibt es nicht“ und „fremdes Fach“ dasselbe
  // Nein.
  const found = await getProposal(user.id, id);
  if (!found) {
    return { saves: state.saves, message: GONE };
  }

  const parsed = proposalInputSchema.safeParse({
    subjectId: text(formData, "subjectId"),
    title: text(formData, "title"),
    capturedOn: text(formData, "capturedOn"),
    note: text(formData, "note"),
    topics: topicLines(formData),
  });

  if (!parsed.success) {
    return {
      saves: state.saves,
      ...formErrors<ProposalErrorField>(parsed.error.issues),
    };
  }

  try {
    if (!(await updateProposal(user.id, id, parsed.data))) {
      return {
        saves: state.saves,
        message:
          "Das ließ sich nicht ändern — den Vorschlag oder das " +
          "vorgeschlagene Fach gibt es nicht mehr.",
      };
    }

    revalidateInbox(found.material.id);

    return {
      saves: (state.saves ?? 0) + 1,
      notice: "Geändert. Am Blatt selbst hat sich dadurch nichts getan.",
    };
  } catch (error) {
    console.error("Vorschlag ändern fehlgeschlagen", error);
    return { saves: state.saves, message: SAVE_FAILED };
  }
}

/**
 * Einen Vorschlag verwerfen.
 *
 * Die Zeile ist danach weg, samt ihren Themen — einen Zustand „verworfen“ gibt
 * es nicht, und warum, steht an `materialProposals` in src/db/schema.ts.
 * Verloren geht dabei nichts, was jemand aufgeschrieben hätte: das Blatt und
 * alles daran bleiben, wie sie sind.
 *
 * Danach zurück in den Korb, und zwar ohne eine Meldung im Gepäck. Was
 * passiert ist, sieht man dort: die Zeile, die man gerade verworfen hat, steht
 * nicht mehr da. Ein Satz, der dasselbe noch einmal behauptet, wäre eine
 * Bestätigung für etwas, das man ohnehin sieht.
 */
export async function deleteProposalAction(id: string): Promise<void> {
  const user = await requireUser();

  // Vor dem Löschen, weil danach niemand mehr sagen kann, an welchem Blatt er
  // hing — und ohne das Blatt fehlte der Ablage und der Startseite die
  // Auffrischung.
  const found = await getProposal(user.id, id);

  await deleteProposal(user.id, id);

  if (found) revalidateInbox(found.material.id);

  redirect("/material/eingang");
}

/**
 * Die Bestätigung: aus einem Vorschlag wird der Bestand.
 *
 * **Das ist die einzige Stelle des Eingangskorbs, die ein Blatt schreibt**, und
 * sie schreibt nicht den Vorschlag, sondern das, was im Formular steht. Der
 * Vorschlag hat es nur vorbelegt; geändert werden darf jedes Feld, bevor der
 * Knopf gedrückt wird. Geprüft wird deshalb mit `materialInputSchema` und
 * ausdrücklich nicht mit `proposalInputSchema`: geschrieben wird ein Blatt, und
 * für ein Blatt gilt die Tür des Blattes — dort ist ein Titel Pflicht, ein Fach
 * Pflicht und ein Tag Pflicht, während ein Vorschlag über alles schweigen darf.
 *
 * Danach fallen **alle** Vorschläge zu diesem Blatt weg, auch die anderen und
 * auch der gerade übernommene. Sie beziehen sich auf einen Titel, einen Tag und
 * Themen, die es so nicht mehr gibt; stehenzulassen hieße, dass der Korb nach
 * einer Entscheidung nicht leerer wird, sondern voller Zeilen steht, die gegen
 * einen Stand geprüft werden müssten, den niemand mehr sieht. Waren es mehr als
 * einer, steht das nachher auf dem Bildschirm — still verschwinden darf keiner.
 */
export async function confirmProposalAction(
  proposalId: string,
  state: MaterialFormState,
  formData: FormData,
): Promise<MaterialFormState> {
  const user = await requireUser();

  // Zuerst: gibt es ihn überhaupt noch? Zwei Geräte, zwei offene Seiten, und
  // der Vorschlag ist auf dem einen längst entschieden — dann steht hier ein
  // Satz und kein Absturz.
  const found = await getProposal(user.id, proposalId);
  if (!found) {
    return { saves: state.saves, message: GONE };
  }

  const materialId = found.material.id;

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

  let ziel: string;

  try {
    // Das Fach gehört dem Nutzer, das ist eine Zeile weiter oben geprüft —
    // bleibt als Grund für ein Nein nur noch das Blatt selbst.
    if (!(await updateMaterial(user.id, materialId, parsed.data))) {
      return {
        saves: state.saves,
        message: "Dieses Blatt gibt es nicht mehr.",
      };
    }

    // Die Themen kommen als Titel und nur als Titel — genau wie bei
    // `updateMaterialAction()`. `MaterialForm` hängt für jeden Chip ein
    // verstecktes Feld „themen“ mit dem Titel darin ans Formular; eine id
    // schickt es nirgends mit.
    const titles = formData
      .getAll("themen")
      .filter((value): value is string => typeof value === "string");

    const { verworfen, zusammengefallen, umbenannt } = await setMaterialTopics(
      user.id,
      materialId,
      titles,
    );

    const entfernt = await clearProposals(user.id, materialId);

    // Erst ganz zum Schluss abhaken. Ein schon gesetzter Zeitpunkt bleibt
    // dabei stehen — `markFiled()` fasst ihn nicht noch einmal an, damit „wann
    // hat ein Mensch hingesehen?“ eine Antwort behält.
    await markFiled(user.id, materialId, true);

    revalidateInbox(materialId);

    ziel = confirmedHref({
      materialId,
      // `entfernt` zählt den übernommenen mit — er ist ja auch weggeräumt
      // worden. Interessant sind die anderen.
      weitere: Math.max(0, entfernt - 1),
      ohneFachwort: verworfen.length,
      zusammengefallen: zusammengefallen.length,
      // Ein getippter Titel, den das Fach schon anders schreibt. Am Blatt
      // steht danach die Schreibweise des Fachs, und die Gegenüberstellung
      // konnte das nicht ankündigen — sie ist eine reine Rechnung und liest
      // das Vokabular nicht. Also wird es hinterher gesagt.
      andereSchreibweise: umbenannt.length,
    });
  } catch (error) {
    console.error("Vorschlag übernehmen fehlgeschlagen", error);
    return { saves: state.saves, message: SAVE_FAILED };
  }

  /*
   * `redirect()` wirft intern — es wirft einen besonderen Fehler
   * (NEXT_REDIRECT), den Next weiter oben abfängt und in eine Weiterleitung
   * übersetzt. Deshalb steht der Aufruf HIER und nicht drei Zeilen weiter oben
   * im try: das `catch` darüber schluckt jeden Fehler und antwortet mit
   * „das hat nicht geklappt“. Stünde die Weiterleitung darin, meldete die
   * Seite genau dann einen Fehler, wenn alles geklappt hat — das Blatt wäre
   * geschrieben, die Vorschläge weggeräumt, und auf dem Bildschirm stünde in
   * Rot, es sei nichts passiert. Wer diese Funktion umbaut, hält das ein.
   *
   * Weitergeleitet wird in den Korb und nicht auf das Blatt: man arbeitet
   * einen Korb von oben nach unten ab, und das Blatt ist von dort einen Tipp
   * entfernt.
   */
  redirect(ziel);
}

/**
 * Was nach dem Übernehmen im Korb stehen soll, als Adresse.
 *
 * Die Bestätigung kann nicht als Rückgabewert nach oben kommen: diese Seite
 * gibt es nach `clearProposals()` nicht mehr, sie liefe beim nächsten Rendern
 * in ein `notFound()`. Bliebe die Meldung also im Zustand des Formulars, wäre
 * sie mit dem Formular verschwunden.
 *
 * Deshalb reisen **Zahlen** in der Adresse und keine fertigen Sätze. Ein Satz
 * aus der Adresszeile ließe die App sagen, was ein zugeschickter Link ihr
 * vorgibt; Zahlen liest die Seite als Zahlen, und den Satz baut sie selbst.
 * Was nicht vorkommt, steht auch nicht in der Adresse — ohne die drei Zusätze
 * bleibt eine kurze, lesbare Zeile.
 */
function confirmedHref(outcome: {
  materialId: string;
  weitere: number;
  ohneFachwort: number;
  zusammengefallen: number;
  andereSchreibweise: number;
}): string {
  const query = new URLSearchParams({ uebernommen: outcome.materialId });

  if (outcome.weitere > 0) query.set("weitere", String(outcome.weitere));

  if (outcome.ohneFachwort > 0) {
    query.set("ohnefachwort", String(outcome.ohneFachwort));
  }

  if (outcome.zusammengefallen > 0) {
    query.set("zusammengefallen", String(outcome.zusammengefallen));
  }

  if (outcome.andereSchreibweise > 0) {
    query.set("schreibweise", String(outcome.andereSchreibweise));
  }

  return `/material/eingang?${query.toString()}`;
}
