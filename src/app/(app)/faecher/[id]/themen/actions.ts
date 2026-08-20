"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  ensureTopic,
  listTopics,
  mergeTopics,
  renameTopic,
  seedTopicsFromExams,
  unmergeTopic,
  type SeedResult,
  type TopicItem,
} from "@/lib/subject-topics";
import { getSubject } from "@/lib/subjects";

import type { TopicActionState } from "./topic-list";

/**
 * Die Server Actions der Themenpflege.
 *
 * Alle fünf folgen demselben Weg: `requireUser()`, dann die Datenschicht, dann
 * `revalidatePath`. Kein `redirect()` — man bleibt auf der Liste, die man
 * gerade pflegt, und sieht die Änderung an der Zeile, die man angetippt hat.
 *
 * Aufgefrischt werden zwei Adressen. Diese Seite, weil sich die Liste geändert
 * hat, und `/klausuren`, weil dort die Themenvorschläge aus demselben
 * Vokabular kommen: eine Zusammenlegung, die hier zwei Zeilen zu einer macht,
 * darf drüben nicht weiter zwei Vorschläge sein.
 *
 * Jede Action liest die Liste des Fachs, bevor sie etwas ändert. Das ist eine
 * Abfrage mehr, und sie ist den Preis wert: die Datenschicht tut bei einer id,
 * die es nicht mehr gibt, schlicht nichts — und ein stilles Nichts ist genau
 * die Antwort, die diese App nirgends geben will.
 */

/** Ein Textfeld aus dem Formular. Alles andere ist keine Eingabe. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): TopicActionState {
  return { message, answeredAt: Date.now() };
}

function done(notice: string): TopicActionState {
  return { notice, answeredAt: Date.now() };
}

/**
 * Die Datenschicht wirft genau in den Fällen, die ein Mensch entscheiden muss,
 * und zwar fertige deutsche Sätze — die gehören über die Liste und nicht auf
 * eine Fehlerseite.
 *
 * Von einer Ausnahme aus einer anderen Ecke (der Datenbank etwa) ließe sich
 * das von hier aus nicht unterscheiden; ihr Text stünde dann technisch und
 * englisch auf dem Bildschirm. Deshalb landet jede Ausnahme zusätzlich im
 * Serverlog: dort steht, was wirklich passiert ist.
 */
function sentence(error: unknown): string {
  console.error("Themenpflege fehlgeschlagen", error);

  return error instanceof Error && error.message
    ? error.message
    : "Das hat nicht geklappt. Versuch es noch einmal.";
}

/** Die Themen des Fachs so, wie die Liste sie zeigt — Schreibweisen inbegriffen. */
async function topicsOf(
  userId: string,
  subjectId: string,
): Promise<TopicItem[]> {
  return listTopics(userId, subjectId, { includeMerged: true });
}

/** Nach jeder Änderung: diese Liste und die Klausuren, die daran hängen. */
function refresh(subjectId: string): void {
  revalidatePath(`/faecher/${subjectId}/themen`);
  revalidatePath("/klausuren");
}

/**
 * Benennt genau die angetippte Zeile um — auch dann, wenn sie eine
 * zusammengelegte Schreibweise ist. Das ist keine Nachlässigkeit, sondern die
 * ausdrückliche Zusage von `renameTopic()`: wer eine Schreibweise umbenennt,
 * hat sich vertippt und meint diese Zeile.
 *
 * Fällt der neue Titel auf ein Thema, das es im Fach schon gibt, wirft die
 * Datenschicht einen deutschen Satz. Er wird hier aufgefangen und über der
 * Liste gezeigt: die Entscheidung, welche der beiden Zeilen bleibt, kann nur
 * der Mensch treffen.
 */
export async function renameTopicAction(
  subjectId: string,
  _state: TopicActionState,
  formData: FormData,
): Promise<TopicActionState> {
  const user = await requireUser();

  const id = text(formData, "id");
  const title = text(formData, "title");

  if (!title) {
    return fail("Ohne Titel geht es nicht — tipp erst einen ein.");
  }

  const topic = (await topicsOf(user.id, subjectId)).find(
    (candidate) => candidate.id === id,
  );
  if (!topic) {
    return fail("Dieses Thema gibt es nicht mehr.");
  }
  if (title === topic.title) {
    return done(`„${topic.title}“ heißt schon so.`);
  }

  try {
    await renameTopic(user.id, topic.id, title);
  } catch (error) {
    return fail(sentence(error));
  }

  refresh(subjectId);

  // Die Datenschicht schneidet den Titel nach denselben Regeln zu wie überall;
  // was dabei herauskommt, steht in der Liste. Der Satz nennt deshalb den
  // getippten Titel und behauptet nicht, das Ergebnis zu kennen.
  return done(`Umbenannt: aus „${topic.title}“ ist „${title}“ geworden.`);
}

/**
 * Legt ein Thema in ein anderes. Die einzige Geste dieser Seite, bei der etwas
 * verloren gehen kann — deshalb bleibt sie dem Menschen vorbehalten, auch wenn
 * später ein Agent Themen vorschlägt.
 *
 * Beide Seiten müssen in diesem Fach liegen und beide müssen es noch geben;
 * geprüft wird das hier, damit aus einem veralteten Formular kein stilles
 * Nichts wird. Die Fachgrenze prüft `mergeTopics()` zusätzlich selbst.
 */
export async function mergeTopicsAction(
  subjectId: string,
  _state: TopicActionState,
  formData: FormData,
): Promise<TopicActionState> {
  const user = await requireUser();

  const fromId = text(formData, "fromId");
  const intoId = text(formData, "intoId");

  if (!intoId) {
    return fail("Wähl erst aus, wohin das Thema soll.");
  }

  const topics = await topicsOf(user.id, subjectId);
  const from = topics.find((candidate) => candidate.id === fromId);
  const into = topics.find((candidate) => candidate.id === intoId);

  if (!from || !into) {
    return fail("Eines der beiden Themen gibt es nicht mehr.");
  }
  if (from.id === into.id) {
    return fail("Ein Thema lässt sich nicht in sich selbst legen.");
  }

  // `mergeTopics()` löst beide Seiten erst auf. Wäre eine davon selbst eine
  // Schreibweise, träfe die Zusammenlegung nicht die angetippte Zeile, sondern
  // deren Ziel — und zöge damit ein ganzes Thema mit. Die Liste bietet das
  // gar nicht erst an; hier steht die Regel noch einmal, weil eine Action auch
  // ohne die Liste erreichbar ist.
  if (from.mergedInto) {
    return fail(
      `„${from.title}“ ist selbst eine Schreibweise — trenn sie erst ab.`,
    );
  }
  if (into.mergedInto) {
    return fail(
      `Als Ziel geht nur ein eigenständiges Thema, und „${into.title}“ ist eine Schreibweise.`,
    );
  }

  try {
    await mergeTopics(user.id, from.id, into.id);
  } catch (error) {
    return fail(sentence(error));
  }

  refresh(subjectId);

  return done(
    `„${from.title}“ steht jetzt als Schreibweise unter „${into.title}“.`,
  );
}

/**
 * Nimmt eine Zusammenlegung zurück. `unmergeTopic()` meint dabei ausdrücklich
 * die genannte Zeile und löst sie nicht auf — sonst träfe die Trennung das
 * Ziel und liefe ins Leere.
 */
export async function unmergeTopicAction(
  subjectId: string,
  _state: TopicActionState,
  formData: FormData,
): Promise<TopicActionState> {
  const user = await requireUser();

  const id = text(formData, "id");

  const topic = (await topicsOf(user.id, subjectId)).find(
    (candidate) => candidate.id === id,
  );
  if (!topic) {
    return fail("Dieses Thema gibt es nicht mehr.");
  }
  if (!topic.mergedInto) {
    return fail(`„${topic.title}“ steht schon für sich.`);
  }

  await unmergeTopic(user.id, topic.id);

  refresh(subjectId);

  return done(`„${topic.title}“ ist wieder ein eigenes Thema.`);
}

/**
 * Legt ein Thema von Hand an — der Weg, ohne den die Regel des Projekts
 * gebrochen wäre: alles, was die App später von selbst vorschlägt, muss auch
 * von Hand gehen.
 *
 * `ensureTopic()` gibt `null` zurück, wenn im Titel kein Fachwort steckt.
 * Dieser Fall bekommt einen eigenen Satz. Eine stille Ablehnung wäre hier der
 * schlimmste Ausgang: der Nutzer tippt „Übungen“, drückt, und die Liste sieht
 * aus wie vorher.
 *
 * Ob etwas Neues entstanden ist, lässt sich der Rückgabe nicht ansehen —
 * `ensureTopic()` liefert bei einem Treffer das vorhandene Thema. Deshalb
 * merkt sich die Action vorher, welche ids es gab.
 */
export async function createTopicAction(
  subjectId: string,
  _state: TopicActionState,
  formData: FormData,
): Promise<TopicActionState> {
  const user = await requireUser();

  const title = text(formData, "title");
  if (!title) {
    return fail("Tipp erst einen Titel ein.");
  }

  const subject = await getSubject(user.id, subjectId);
  if (!subject) {
    return fail("Dieses Fach gibt es nicht mehr.");
  }

  const before = new Set(
    (await topicsOf(user.id, subjectId)).map((topic) => topic.id),
  );

  // „manuell“ als Herkunft, weil es die Wahrheit ist: dieses Thema stammt aus
  // keiner Klausur, sondern aus diesem Feld.
  const topic = await ensureTopic(user.id, subjectId, title, {
    origin: "manuell",
  });

  if (!topic) {
    return fail(
      `Aus „${title}“ wird kein Thema — darin steckt kein Fachwort. Titel wie „Übungen“ oder „Arbeitsblatt 3“ zeigen auf eine Fundstelle und nicht auf den Stoff; schreib dazu, worum es dabei ging.`,
    );
  }

  refresh(subjectId);

  if (!before.has(topic.id)) {
    return done(`„${topic.title}“ ist angelegt.`);
  }

  // Der Treffer kann eine Schreibweise gewesen sein; dann steht in der Liste
  // das Thema, auf das sie zeigt, und nicht das Getippte. Das gehört gesagt.
  return topic.title === title
    ? done(`„${topic.title}“ gibt es in diesem Fach schon.`)
    : done(`„${title}“ meint „${topic.title}“ — das gibt es schon.`);
}

/** „12 Themen“, „1 Thema“ — der Satz soll an beiden Rändern stimmen. */
function amount(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Was ein Durchlauf verändert hat, in einem Satz. */
function seedSentence({
  angelegt,
  verknuepft,
  umgehaengt,
}: SeedResult): string {
  if (angelegt === 0 && verknuepft === 0 && umgehaengt === 0) {
    return "Nichts Neues — jedes Thema deiner Klausuren steht schon im Vokabular.";
  }

  const parts = [
    amount(angelegt, "Thema angelegt", "Themen angelegt"),
    amount(verknuepft, "Verknüpfung", "Verknüpfungen"),
  ];

  // Umgehängt wird nur nach einem Fachwechsel einer Prüfung. Das ist der eine
  // Fall, in dem etwas überschrieben wurde — er gehört nicht unter
  // „verknüpft“ gemischt, sondern eigens genannt.
  if (umgehaengt > 0) {
    parts.push(
      `${amount(umgehaengt, "Verweis", "Verweise")} nach einem Fachwechsel umgehängt`,
    );
  }

  return `${parts.join(", ")}.`;
}

/**
 * Baut das Vokabular aus allem auf, was schon eingetragen ist.
 *
 * Der Knopf ist mehrfach drückbar: `seedTopicsFromExams()` füllt nur leere
 * Verweise, hängt nur fachfremde um und legt nur fehlende Vokabeln an. Ein
 * zweiter Durchlauf meldet deshalb lauter Nullen.
 *
 * Er geht über den ganzen Bestand und damit über alle Fächer — deshalb wird
 * hier nicht nur die eigene Adresse aufgefrischt, sondern das Adressmuster
 * aller Themenlisten. Die eigene steht zusätzlich als wörtliche Adresse da,
 * damit die Liste, auf die der Nutzer gerade schaut, sich sofort neu zeichnet.
 *
 * Als einzige der fünf nimmt diese Action weder Zustand noch Formular
 * entgegen: sie hat nichts zu lesen. `useActionState` reicht beides trotzdem
 * herein, und eine Funktion, die weniger Parameter erklärt, als sie bekommt,
 * ist in JavaScript in Ordnung.
 */
export async function seedTopicsAction(
  subjectId: string,
): Promise<TopicActionState> {
  const user = await requireUser();

  const result = await seedTopicsFromExams(user.id);

  refresh(subjectId);
  revalidatePath("/faecher/[id]/themen", "page");

  return done(seedSentence(result));
}
