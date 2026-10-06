import {
  getProposal,
  prefillFromProposal,
  type PrefillMaterial,
  type ProposalDetail,
} from "@/lib/inbox";
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
import { titelAusErsterSeite } from "@/lib/leser/abschrift";
import {
  MATERIAL_TITLE_MAX,
  defaultMaterialTitle,
  ersteSeiteDocling,
  listMaterialTranscripts,
  type MaterialDetail,
  type MaterialPageTranscript,
  listPageActivity,
} from "@/lib/materials";
import { listTopicsForSubjects } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";

/**
 * Ein Foto, sonst nichts: Jev ordnet ein, was gelesen ist — von Claude oder
 * von der App (Docling).
 *
 * Auftrag vom 4.10.2026: „so bauen, dass ich nur noch ein Foto machen muss“,
 * und auf die Frage, ob Claude und Jev sich dafür einig sein müssen: „wir
 * vertrauen Jev“. Also entscheidet Jev allein über Fach und Themen, und die
 * App übernimmt das ohne Rückfrage. Abschreiben, einen Titel finden, eine
 * Notiz schreiben kann Jev nicht — das bleibt beim Leser der Seite.
 *
 * Seit dem 6.10.2026 hat jede Seite genau einen Leser, und die App
 * entscheidet, welchen (@/lib/leser/zuteilung). Daraus folgen zwei Wege in
 * diese Funktion, und beide gehen durch dieselbe Tür:
 *
 * - **Ein Vorschlag des Postboten** (origin „agent“). Er bringt die
 *   Abschrift der Claude-Seiten; die Docling-Seiten desselben Blattes stehen
 *   schon im Bestand. Jev liest beides zusammen, und übernommen wird nur auf
 *   Seiten ohne Abschrift (`nurUngelesene`) — eine Docling-Abschrift ersetzt
 *   hier nichts still.
 * - **Ein Vorschlag der App** (origin „app“) für ein Blatt, das Docling ganz
 *   gelesen hat. Er trägt nur einen Titel; den Text liest Jev aus dem
 *   Bestand.
 *
 * Der Agent darf dabei weiterhin nichts ändern. Er legt einen Vorschlag an,
 * wie bisher; übernommen wird von der App, nach dieser Regel, durch dieselbe
 * Tür wie der Knopf im Eingangskorb (`applyProposal()`).
 *
 * Eingeordnet wird, was noch im Korb liegt. An einem schon eingeordneten Blatt
 * hat jemand über Fach und Themen entschieden, und ein Vorschlag dort bleibt
 * für einen Menschen liegen — mit einer Ausnahme seit dem 4.10.2026: ein
 * Vorschlag, der NUR die Abschrift von Seiten bringt, die noch niemand gelesen
 * hat. Das ist die Rückseite, die nach dem Einordnen nachgereicht wurde; ohne
 * die Ausnahme hinge sie bis zum nächsten Blick in den Korb ohne Abschrift am
 * Blatt. Jev wird dafür nicht gefragt — es gibt nichts zu entscheiden —, und
 * Fach, Titel, Tag, Notiz und Themen bleiben, wie sie sind. Die Ausnahme gilt
 * nur für Seiten, die die App selbst als nachgereicht kennt
 * (`onlyTranscribesAttachedPages()`); ein Nachlese-Vorschlag zu den alten
 * Seiten eines Altblatts bleibt für einen Menschen im Korb. Eine nachgereichte
 * Druckseite braucht diesen Weg nicht: ihre Abschrift schreibt die Zuteilung
 * selbst.
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
      /** Jev hat Fach und Themen entschieden. */
      art: "jev";
      subjectName: string;
      confidence: number;
      topics: string[];
    }
  | {
      ok: true;
      /**
       * Das Blatt war schon eingeordnet; übernommen ist nur die Abschrift
       * ungelesener Seiten. Fach und Themen sind die, die schon dastanden.
       */
      art: "abschrift";
      subjectName: string;
      topics: string[];
      /** Seiten, die dadurch eine Abschrift bekommen haben. */
      seiten: number;
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

/**
 * Sagt dieser Vorschlag nichts als die Abschrift von Seiten, die noch niemand
 * gelesen hat?
 *
 * Die Bedingung, unter der ein Vorschlag zu einem schon eingeordneten Blatt
 * ohne Rückfrage übernommen wird (Kopf dieser Datei). Jedes Wort darin hat
 * seinen Grund:
 *
 * - **Nichts als die Abschrift**: Fach, Titel, Tag und Notiz leer, keine
 *   Themen. Ein Vorschlag ersetzt beim Übernehmen, was er nennt, und über
 *   alles andere hat an diesem Blatt schon jemand entschieden.
 * - **Überhaupt eine Abschrift**: ein Vorschlag, der gar nichts sagt, ist
 *   keiner, den man übernehmen müsste.
 * - **Nur ungelesene Seiten** (`transcript` ist `null`, nicht `""`): eine Seite
 *   mit Abschrift hat jemand bestätigt. Sie still durch eine ungeprüfte zu
 *   ersetzen ist genau der Tausch, vor dem die Gegenüberstellung im Korb
 *   schützt. Eine Seite, die es am Blatt nicht gibt, zählt ebenfalls als
 *   nicht ungelesen.
 *
 * Reine Rechnung auf dem, was die Datenbank schon geliefert hat — prüfbar ohne
 * sie.
 */
export function onlyTranscribesUnreadPages(
  proposal: {
    subjectId: string | null;
    title: string | null;
    capturedOn: string | null;
    note: string | null;
    topics: string[];
    transcripts: { pageId: string }[];
  },
  pages: { pageId: string; transcript: string | null }[],
): boolean {
  if (
    proposal.subjectId !== null ||
    proposal.title !== null ||
    proposal.capturedOn !== null ||
    proposal.note !== null ||
    proposal.topics.length > 0 ||
    proposal.transcripts.length === 0
  ) {
    return false;
  }

  const ungelesen = new Set(
    pages.filter((page) => page.transcript === null).map((page) => page.pageId),
  );

  return proposal.transcripts.every((entry) => ungelesen.has(entry.pageId));
}

/**
 * Die harte Grenze für das Übernehmen ohne Menschen (4.10.2026): jede Seite,
 * zu der der Vorschlag eine Abschrift bringt, muss eine NACHGEREICHTE sein —
 * so, wie die App sie selbst bestimmt (`nachgereichtUngelesen()` in
 * @/lib/materials, ausgeliefert als `unreadAttachedPageIds`).
 *
 * Dass der Postbote nur diese Seiten nennt, ist eine Bitte an ein Modell.
 * Ein Lauf, der zur Orientierung `read_sheet` ruft, sieht auch die alten,
 * nie gelesenen Seiten eines Altblatts — und schriebe er sie mit ab, legte
 * `onlyTranscribesUnreadPages()` allein sie ohne Menschen ab. Das widerspräche
 * der Entscheidung, die fünfzehn Altblätter nicht von selbst abzuschreiben.
 * Hier steht deshalb die Regel der App und nicht die des Auftrags: was nicht
 * nachgereicht ist, bleibt im Korb, und ein Mensch entscheidet — wie bei
 * jeder von Hand gestarteten Nachlese.
 */
export function onlyTranscribesAttachedPages(
  proposal: { transcripts: { pageId: string }[] },
  nachgereicht: ReadonlySet<string>,
): boolean {
  return (
    proposal.transcripts.length > 0 &&
    proposal.transcripts.every((entry) => nachgereicht.has(entry.pageId))
  );
}

export async function autoFile(
  userId: string,
  proposalId: string,
): Promise<AutoFileResult> {
  const found = await getProposal(userId, proposalId);
  if (!found) return { ok: false, grund: "Den Vorschlag gibt es nicht mehr." };

  const { proposal, material } = found;
  const pages = await listMaterialTranscripts(userId, material.id);

  // Ein schon eingeordnetes Blatt fragt Jev nicht: dort hat schon jemand
  // entschieden, und Jev überschriebe Fach und Themen, nur weil eine Abschrift
  // nachkommt. Übernommen wird höchstens die Abschrift — die Regel steht an
  // `abschriftNachreichen()`. Das kommt deshalb auch VOR der Frage, ob Jev
  // eingerichtet ist: für diesen Weg braucht es Jev nicht.
  if (material.filedAt !== null) {
    return abschriftNachreichen(userId, proposal, material, pages);
  }

  if (!jevConfigured()) {
    return { ok: false, grund: "Jev ist nicht eingerichtet." };
  }

  // Der Text, den Jev liest: was am Blatt schon steht, sonst was der
  // Vorschlag mitbringt. Je Seite das eine oder das andere, in der
  // Seitenfolge. Der Bestand zuerst (seit dem 6.10.2026), weil übernommen
  // ohnehin nur auf ungelesene Seiten wird (`nurUngelesene` unten): Jev soll
  // das Blatt so einordnen, wie es danach dasteht — mit den
  // Docling-Abschriften, die schon im Bestand sind.
  const vorgeschlagen = new Map(
    proposal.transcripts.map((entry) => [entry.pageId, entry.text] as const),
  );
  const text = pages
    .map((page) => page.transcript ?? vorgeschlagen.get(page.pageId) ?? "")
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

  // Der Titel: Claudes, wenn Claude einen gefunden hat. Sonst, solange am
  // Blatt noch der Platzhalter steht und die erste Seite eine Docling-Seite
  // ist, deren erste Überschrift — so bekommt auch ein gemischtes Blatt einen
  // Titel, dessen erste Seite Claude nie gesehen hat. Sonst bleibt der Titel
  // des Blattes (`prefillFromProposal()` bei `null`).
  const titel =
    proposal.title ??
    titelAusErsterSeite(
      material.title,
      defaultMaterialTitle(material.capturedOn),
      await ersteSeiteDocling(userId, material.id),
      MATERIAL_TITLE_MAX,
    );

  const { werte } = prefillFromProposal(
    ausgangslage(material, pages),
    {
      subjectId: chosen.subject.id,
      subjectName: null,
      title: titel,
      capturedOn: proposal.capturedOn,
      note: proposal.note,
      topics,
      transcripts: proposal.transcripts,
    },
  );

  // `nurUngelesene`: auch hier, ohne Menschen, ersetzt keine Abschrift eine
  // vorhandene — vor allem keine, die Docling geschrieben hat.
  const applied = await applyProposal(userId, material.id, werte, {
    nurUngelesene: true,
  });
  if (!applied) return { ok: false, grund: "Das Blatt gibt es nicht mehr." };

  return {
    ok: true,
    art: "jev",
    subjectName: chosen.subject.name,
    confidence: chosen.confidence,
    topics: werte.topics,
  };
}

/**
 * Die Abschrift zu einem schon eingeordneten Blatt — übernommen ohne Jev, oder
 * mit einem Grund liegen gelassen.
 *
 * Übernommen wird nur, was `onlyTranscribesUnreadPages()` UND
 * `onlyTranscribesAttachedPages()` durchlassen — die zweite Bedingung ist die
 * harte Grenze für die Altblätter. Durch
 * dieselbe Tür wie der Knopf im Korb (`applyProposal()`), mit derselben
 * Vorbelegung: `prefillFromProposal()` lässt jedes Feld stehen, über das der
 * Vorschlag schweigt — und er schweigt über alle außer der Abschrift.
 * `filed_at` bleibt dabei, wie es war (`markFiled()` fasst einen gesetzten
 * Zeitpunkt nicht an).
 *
 * Die Prüfung oben ist eine Frage VOR dem Schreiben, und zwischen beiden kann
 * sich das Blatt ändern. Deshalb gehen zwei Optionen mit durch die Tür
 * (4.10.2026), die dasselbe noch einmal im Schreiben selbst sichern:
 *
 * - `nurUngelesene`: hat inzwischen jemand eine der Seiten abgeschrieben,
 *   bleibt dessen Abschrift stehen, und `seiten` zählt nur, was wirklich
 *   geschrieben wurde.
 * - `nurVorschlag`: weggeräumt wird nur dieser Vorschlag. Bis hierher stand an
 *   dieser Stelle die Bedingung „nur, wenn er der einzige am Blatt ist", weil
 *   das Übernehmen ALLE Vorschläge des Blattes wegräumte und ein anderer, der
 *   auf einen Menschen wartet, sonst wortlos mit verschwunden wäre. Das war
 *   selbst eine Frage vor dem Schreiben — ein Vorschlag, der genau dazwischen
 *   kam, verschwand trotzdem —, und sie hielt die nachgereichte Seite fest,
 *   solange irgendein anderer Vorschlag am Blatt lag. Mit `nurVorschlag`
 *   bleibt der andere ohnehin stehen, und die Bedingung ist weggefallen.
 * - `nurAbschrift`: Fach, Titel, Tag, Notiz und Themen werden gar nicht erst
 *   geschrieben. Die Vorbelegung brächte sie zwar unverändert zurück — aber
 *   aus dem Stand, der beim Lesen des Vorschlags galt. Speichert jemand
 *   genau dazwischen das Formular, stellte das Zurückschreiben seine
 *   Änderung still wieder her.
 */
async function abschriftNachreichen(
  userId: string,
  proposal: ProposalDetail,
  material: MaterialDetail,
  pages: MaterialPageTranscript[],
): Promise<AutoFileResult> {
  if (!onlyTranscribesUnreadPages(proposal, pages)) {
    return { ok: false, grund: "Das Blatt ist schon eingeordnet." };
  }

  const aktivitaet = (await listPageActivity(userId, [material.id])).get(
    material.id,
  );
  if (
    !onlyTranscribesAttachedPages(
      proposal,
      new Set(aktivitaet?.unreadAttachedPageIds ?? []),
    )
  ) {
    return {
      ok: false,
      grund:
        "Das Blatt ist schon eingeordnet, und die Abschrift betrifft Seiten, die nicht nachgereicht sind — darüber entscheidet ein Mensch.",
    };
  }

  const { werte } = prefillFromProposal(ausgangslage(material, pages), {
    ...proposal,
    subjectName: null,
  });

  const applied = await applyProposal(userId, material.id, werte, {
    nurUngelesene: true,
    nurVorschlag: proposal.id,
    nurAbschrift: true,
  });
  if (!applied) return { ok: false, grund: "Das Blatt gibt es nicht mehr." };

  return {
    ok: true,
    art: "abschrift",
    subjectName: material.subject.name,
    topics: werte.topics,
    seiten: applied.abschrift,
  };
}

/** Das Blatt, wie es dasteht — die Ausgangslage für `prefillFromProposal()`. */
function ausgangslage(
  material: MaterialDetail,
  pages: MaterialPageTranscript[],
): PrefillMaterial {
  return {
    subjectId: material.subject.id,
    subjectName: material.subject.name,
    title: material.title,
    capturedOn: material.capturedOn,
    note: material.note,
    topics: material.topics.map((topic) => topic.title),
    pages,
  };
}
