import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { listTopics, type TopicItem } from "@/lib/subject-topics";
import { getSubject } from "@/lib/subjects";

import {
  createTopicAction,
  mergeTopicsAction,
  renameTopicAction,
  seedTopicsAction,
  unmergeTopicAction,
} from "./actions";
import { TopicList, type TopicRow } from "./topic-list";

/**
 * Die Themen eines Fachs — die Stelle, an der sie ein Mensch pflegt.
 *
 * Es gibt diese Seite aus zwei Gründen. Der erste ist eine Regel des ganzen
 * Projekts: alles, was die App später von selbst kann, muss hier von Hand
 * gehen. Später schlägt ein Agent Themen vor; jeder seiner Handgriffe hat
 * vorher einen Knopf auf dieser Seite, sonst wäre die Regel gebrochen, bevor
 * der Agent überhaupt existiert. Das Zusammenlegen bleibt sogar auf Dauer beim
 * Menschen — es ist die einzige Geste hier, bei der etwas verloren gehen kann.
 *
 * Der zweite Grund ist die Pflege selbst. Über ein Schuljahr sammeln sich
 * Dubletten an — erst „Kettenregel“, Monate später „Ableitungsregeln
 * (Kettenregel)“. Ohne eine Stelle zum Zusammenlegen wird aus dem Vokabular
 * eine Halde.
 *
 * Gespeist wird das Vokabular aus zwei Quellen: den Themen einer eingetragenen
 * Prüfung und dem, was an einem abfotografierten Blatt steht. Deshalb nennt
 * jede Zeile beide Zahlen. Stünden dort nur die Klausuren, sähe ein Thema an
 * zwölf Blättern aus wie ein unbenutzter Rest — und wer es dann zusammenlegt,
 * verschiebt die Zuordnung dieser zwölf Blätter, ohne es zu merken.
 *
 * Die Seite lädt eine einzige Liste (`listTopics` mit `includeMerged`) und
 * baut daraus die zwei Ebenen, die auf dem Bildschirm stehen. Sortiert wird
 * dabei nicht: die Reihenfolge kommt aus der Datenschicht — zuletzt gesehen
 * zuerst, bei Gleichstand nach Titel.
 */

export const metadata: Metadata = {
  title: "Themen",
};

/**
 * Aus der flachen Liste werden zwei Ebenen: eigenständige Themen, und darunter
 * die Schreibweisen, die in sie gelegt wurden.
 *
 * Zeigt eine Schreibweise auf ein Thema, das in dieser Liste fehlt, steht sie
 * als eigene Zeile da. Über die App kann das nicht entstehen — zusammengelegt
 * wird nur innerhalb eines Fachs, und ein gelöschtes Ziel leert die Spalte von
 * selbst („set null“). Von Hand verbogen kann es aber, und dann zeigt die
 * Seite genau das, was auch `resolveTopic()` sieht: eine Zeile, die für sich
 * steht. Weglassen wäre die schlechtere Antwort — eine Zeile, die es gibt,
 * darf nicht unsichtbar sein.
 */
function toRows(topics: TopicItem[]): TopicRow[] {
  const rows: TopicRow[] = [];
  const byId = new Map<string, TopicRow>();

  for (const topic of topics) {
    if (topic.mergedInto) continue;

    const row: TopicRow = {
      id: topic.id,
      title: topic.title,
      examCount: topic.examCount,
      materialCount: topic.materialCount,
      merged: [],
    };

    rows.push(row);
    byId.set(row.id, row);
  }

  for (const topic of topics) {
    if (!topic.mergedInto) continue;

    const target = byId.get(topic.mergedInto);
    if (!target) {
      rows.push({
        id: topic.id,
        title: topic.title,
        examCount: topic.examCount,
        materialCount: topic.materialCount,
        merged: [],
      });
      continue;
    }

    target.merged.push({ id: topic.id, title: topic.title });
  }

  return rows;
}

export default async function SubjectTopicsPage({
  params,
}: PageProps<"/faecher/[id]/themen">) {
  const user = await requireUser();
  const { id } = await params;

  const subject = await getSubject(user.id, id);
  if (!subject) {
    notFound();
  }

  const topics = await listTopics(user.id, subject.id, { includeMerged: true });

  return (
    <>
      <SeitenKopf
        titel={`Themen in ${subject.name}`}
        sub="Alle Themen, die dieses Fach kennt. Sie kommen aus den Themen deiner Klausuren und von deinen abfotografierten Blättern und lassen sich hier umbenennen, zusammenlegen und von Hand ergänzen."
      />

      <TopicList
        rows={toRows(topics)}
        renameAction={renameTopicAction.bind(null, subject.id)}
        mergeAction={mergeTopicsAction.bind(null, subject.id)}
        unmergeAction={unmergeTopicAction.bind(null, subject.id)}
        createAction={createTopicAction.bind(null, subject.id)}
        seedAction={seedTopicsAction.bind(null, subject.id)}
      />
    </>
  );
}
