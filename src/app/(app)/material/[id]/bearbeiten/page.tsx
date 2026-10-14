import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SeitenKopf } from "@/components/kombi/form";
import { AutoRefresh } from "@/components/material/auto-refresh";
import { SeiteDazu } from "@/components/kombi/seiten/blatt";
import { requireUser } from "@/lib/auth";
import { claudeLiestGerade } from "@/lib/leser/claude-zustand";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import { blaetterStand, getMaterial, listMaterialTranscripts } from "@/lib/materials";
import { listTopicsForSubjects } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";

import { deleteMaterialAction, deletePageAction, updateMaterialAction } from "../../actions";
import { MaterialDangerZone, MaterialForm, MaterialPages } from "../../material-form";

/**
 * Blatt bearbeiten (Plan 2.2, Zeile `blatt`): alle bisherigen Felder von
 * `material-form.tsx` und `updateMaterialAction` — Fach, Titel, Datum
 * (`capturedOn`), Notiz, Themen und je Seite das Abschrift-Feld. Abtippen ist
 * ohne `ANTHROPIC_API_KEY` oder nach einem gescheiterten Lauf der einzige Weg
 * zur Abschrift. Dazu die Seiten mit „Seite löschen“, „Seite dazu“ über die
 * Kamera der Shell wie auf der Blattseite und ganz unten das Löschen des Blatts.
 *
 * Das Formular bleibt nach dem Speichern stehen und sagt, was geschah (die
 * Hinweise zu Themen und überholten Abschriften); die Blattseite darunter
 * lädt die Shell dabei nach.
 */

export const metadata: Metadata = {
  title: "Blatt bearbeiten",
};

export default async function MaterialEditPage({ params }: PageProps<"/material/[id]/bearbeiten">) {
  const user = await requireUser();
  const { id } = await params;

  const anfang = await blaetterStand(user.id);
  const item = await getMaterial(user.id, id);
  if (!item) {
    notFound();
  }

  // Den Wortlaut holt nur diese Seite (`listMaterialTranscripts`), nicht jede
  // Abfrage eines Blatts — Begründung an `MaterialPageInfo`.
  const wortlaut = new Map(
    (await listMaterialTranscripts(user.id, item.id)).map((page) => [page.pageId, page.transcript] as const),
  );
  const pages = item.pages.map((page) => ({ ...page, transcript: wortlaut.get(page.id) ?? null }));

  const active = await listSubjects(user.id);
  // Hängt das Blatt an einem archivierten Fach, fehlte es sonst in der Auswahl.
  const subjects = active.some((subject) => subject.id === item.subject.id) ? active : [item.subject, ...active];
  const topicsBySubject = await listTopicsForSubjects(
    user.id,
    subjects.map((subject) => subject.id),
  );
  const topicSuggestions = Object.fromEntries(
    subjects.map((subject) => [subject.id, topicsBySubject.get(subject.id) ?? []] as const),
  );

  const today = todayInBerlin();
  const totalBytes = item.pages.reduce((sum, page) => sum + page.byteSize, 0);
  const liestGerade = claudeLiestGerade(item.id);

  return (
    <div className="kf-seite">
      <header>
        <h2 className="p-title">Blatt bearbeiten</h2>
        <p className="p-sub">
          {`${item.title} · ${item.subject.name} · ${formatGerman(item.capturedOn)} · ${item.pages.length} ${item.pages.length === 1 ? "Seite" : "Seiten"}, ${formatBytes(totalBytes)}`}
        </p>
      </header>

      <AutoRefresh
        stand={anfang.stand}
        inArbeit={anfang.inArbeit}
        leseZeile={!item.pages.some((page) => page.leser === "offen") && !liestGerade}
      />

      <MaterialForm
        action={updateMaterialAction.bind(null, item.id)}
        subjects={subjects}
        topicSuggestions={topicSuggestions}
        item={{
          subjectId: item.subject.id,
          title: item.title,
          capturedOn: item.capturedOn,
          note: item.note,
          topics: item.topics,
        }}
        // NULL bleibt NULL: eine ungelesene Seite ist nicht „gelesen, stand nichts drauf“.
        pages={pages.map((page) => ({ ...page, prefill: page.transcript }))}
        today={today}
      />

      <SeitenKopf titel="Seiten" />
      <MaterialPages
        title={item.title}
        pages={pages.map((page) => ({
          ...page,
          deleteAction: deletePageAction.bind(null, item.id, page.id),
        }))}
      />

      {/* Bei vollem Blatt steht dort der Satz „Dieses Blatt ist mit 12 Seiten voll …“ */}
      <SeiteDazu id={item.id} seiten={item.pages.map((page) => page.id)} />

      <MaterialDangerZone
        materialLabel={`${item.subject.name} · ${item.title}`}
        pageCount={item.pages.length}
        deleteAction={deleteMaterialAction.bind(null, item.id)}
      />
    </div>
  );
}
