import { getProposal, prefillFromProposal } from "@/lib/inbox";
import { applyProposal } from "@/lib/inbox-apply";
import {
  askJev,
  jevConfigured,
  jevState,
  readSubject,
  readTopics,
  subjectQuestion,
  topicQuestions,
  type JevSubject,
} from "@/lib/jev";
import { listMaterialTranscripts } from "@/lib/materials";
import { listTopicsForSubjects } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";

/**
 * Ein Foto, sonst nichts: Jev ordnet ein, was der Postbote abgeschrieben hat.
 *
 * Auftrag vom 4.10.2026: „so bauen, dass ich nur noch ein Foto machen muss“,
 * und auf die Frage, ob Claude und Jev sich dafür einig sein müssen: „wir
 * vertrauen Jev“. Also entscheidet Jev allein über Fach und Themen, und die
 * App übernimmt das ohne Rückfrage. Claude bleibt für das, was Jev nicht
 * kann — abschreiben, einen Titel finden, eine Notiz schreiben.
 *
 * Der Agent darf dabei weiterhin nichts ändern. Er legt einen Vorschlag an,
 * wie bisher; übernommen wird von der App, nach dieser Regel, durch dieselbe
 * Tür wie der Knopf im Eingangskorb (`applyProposal()`).
 *
 * Eingeordnet wird nur, was noch im Korb liegt; ein Vorschlag der Nachlese zu
 * einem längst abgelegten Blatt bleibt für einen Menschen liegen, wie bisher.
 *
 * Im Korb bleibt ein Blatt nur noch, wenn das Einordnen nicht gehen kann:
 * kein Schlüssel eingerichtet, Jev nicht erreichbar, oder auf dem Blatt ist so
 * gut wie nichts lesbar (eine reine Skizze) — dann gibt es für Jev nichts zu
 * entscheiden.
 *
 * `filed_at` wird dabei gesetzt wie beim Übernehmen von Hand. Es heißt
 * seitdem „eingeordnet", nicht mehr „ein Mensch hat hingesehen".
 */

/** Unter so vielen lesbaren Zeichen bleibt das Blatt im Korb. */
export const MIN_READABLE_CHARS = 40;

/** So viele Themen eines Fachs kommen als Kandidaten in die Frage. */
const MAX_CANDIDATES = 30;

export type AutoFileResult =
  | {
      ok: true;
      subjectName: string;
      confidence: number;
      topics: string[];
    }
  | { ok: false; grund: string };

/**
 * Was auf dem Blatt lesbar ist: die Abschrift ohne die ⟨unsicheren Stellen⟩.
 * Eine Skizze, deren Abschrift nur aus „⟨Zeichnung: …⟩" besteht, hat danach
 * fast nichts mehr — und genau die soll ein Mensch ansehen.
 */
export function readableChars(text: string): number {
  return text.replace(/⟨[^⟩]*⟩/g, "").replace(/\s+/g, "").length;
}

/**
 * Die Themen, die Jev zur Wahl bekommt: das Vokabular des Fachs, dazu die,
 * die Claude vorgeschlagen hat — die dürfen neu sein. Doppelte fallen weg,
 * ohne Rücksicht auf Groß- und Kleinschreibung.
 */
export function topicCandidates(
  vocabulary: string[],
  proposed: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const topic of [...proposed, ...vocabulary.slice(0, MAX_CANDIDATES)]) {
    const key = topic.trim().toLocaleLowerCase("de");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(topic.trim());
  }

  return result;
}

export async function autoFile(
  userId: string,
  proposalId: string,
): Promise<AutoFileResult> {
  if (!jevConfigured()) {
    return { ok: false, grund: "Jev ist nicht eingerichtet." };
  }

  const found = await getProposal(userId, proposalId);
  if (!found) return { ok: false, grund: "Den Vorschlag gibt es nicht mehr." };

  const { proposal, material } = found;

  // Nur was noch im Korb liegt. Die Nachlese schickt Abschriften zu Blättern,
  // die längst eingeordnet sind — dort hat schon jemand entschieden, und Jev
  // überschriebe Fach und Themen, nur weil eine Abschrift nachkommt.
  if (material.filedAt !== null) {
    return { ok: false, grund: "Das Blatt ist schon eingeordnet." };
  }
  const pages = await listMaterialTranscripts(userId, material.id);

  // Der Text, den Jev liest: was der Vorschlag mitbringt, sonst was am Blatt
  // schon steht. Je Seite das eine oder das andere, in der Seitenfolge.
  const vorgeschlagen = new Map(
    proposal.transcripts.map((entry) => [entry.pageId, entry.text] as const),
  );
  const text = pages
    .map((page) => vorgeschlagen.get(page.pageId) ?? page.transcript ?? "")
    .filter((entry) => entry.trim() !== "")
    .join("\n\n");

  if (readableChars(text) < MIN_READABLE_CHARS) {
    return { ok: false, grund: "Auf dem Blatt ist zu wenig lesbar." };
  }

  const subjectRows = await listSubjects(userId);
  if (subjectRows.length === 0) {
    return { ok: false, grund: "Es gibt noch kein Fach." };
  }

  const vocabulary = await listTopicsForSubjects(
    userId,
    subjectRows.map((subject) => subject.id),
  );
  const subjects: JevSubject[] = subjectRows.map((subject) => ({
    id: subject.id,
    name: subject.name,
    topics: (vocabulary.get(subject.id) ?? []).map((topic) => topic.title),
  }));

  const state = jevState(text);

  const fach = await askJev(state, { fach: subjectQuestion(subjects) });
  const chosen = readSubject(subjects, fach.answers.fach);
  if (!chosen) return { ok: false, grund: "Jev hat kein Fach genannt." };

  // Claudes Themen kommen nur mit, wenn Claude dasselbe Fach meinte — sonst
  // gehören sie zu einem anderen Vokabular.
  const proposedTopics =
    proposal.subjectId === null || proposal.subjectId === chosen.subject.id
      ? proposal.topics
      : [];
  const candidates = topicCandidates(chosen.subject.topics, proposedTopics);

  let topics: string[] = [];
  if (candidates.length > 0) {
    const themen = await askJev(
      state,
      topicQuestions(chosen.subject.name, candidates),
    );
    topics = readTopics(candidates, themen.answers);
  }

  const { werte } = prefillFromProposal(
    {
      subjectId: material.subject.id,
      subjectName: material.subject.name,
      title: material.title,
      capturedOn: material.capturedOn,
      note: material.note,
      topics: material.topics.map((topic) => topic.title),
      pages,
    },
    {
      subjectId: chosen.subject.id,
      subjectName: null,
      title: proposal.title,
      capturedOn: proposal.capturedOn,
      note: proposal.note,
      topics,
      transcripts: proposal.transcripts,
    },
  );

  const applied = await applyProposal(userId, material.id, werte);
  if (!applied) return { ok: false, grund: "Das Blatt gibt es nicht mehr." };

  return {
    ok: true,
    subjectName: chosen.subject.name,
    confidence: chosen.confidence,
    topics: werte.topics,
  };
}
