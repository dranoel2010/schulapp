import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CaptureButton } from "@/components/material/capture-button";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { MAX_PAGES, formatBytes } from "@/lib/images";
import { getMaterial } from "@/lib/materials";
import { listTopicsForSubjects } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";

import {
  deleteMaterialAction,
  deletePageAction,
  updateMaterialAction,
} from "../actions";
import {
  MaterialDangerZone,
  MaterialForm,
  MaterialPages,
} from "../material-form";

/**
 * Ein Blatt: erst die Seiten, dann die Angaben dazu.
 *
 * Die Reihenfolge ist die des Blicks. Man kommt hierher, weil man sehen will,
 * was auf dem Blatt steht — nicht, weil man einen Titel ändern will. Das
 * Formular steht deshalb unter den Bildern und nicht darüber, und es leitet
 * nach dem Speichern nirgendwohin: man bleibt beim Blatt.
 *
 * Das Vokabular jedes Fachs wird hier einmal geladen und dem Formular
 * mitgegeben. Das Fach lässt sich umstellen, und dann sollen die Chips des
 * neuen Fachs schon dastehen, ohne dass eine neue Anfrage nötig wird.
 *
 * Geladen wird es in einer einzigen Abfrage über alle Fächer
 * (`listTopicsForSubjects`) und nicht Fach für Fach. Sonst kostete jeder Blick
 * auf ein Blatt so viele Abfragen, wie es Fächer gibt — bei zwölf Fächern elf
 * davon nur für den seltenen Fall, dass jemand das Fach tatsächlich umstellt.
 */

export const metadata: Metadata = {
  title: "Blatt",
};

export default async function MaterialDetailPage({
  params,
}: PageProps<"/material/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const item = await getMaterial(user.id, id);
  if (!item) {
    notFound();
  }

  const active = await listSubjects(user.id);
  // Hängt das Blatt an einem archivierten Fach, fehlte es sonst in der
  // Auswahl — und beim Speichern stünde plötzlich ein anderes Fach dort.
  const subjects = active.some((subject) => subject.id === item.subject.id)
    ? active
    : [item.subject, ...active];

  // Eine Abfrage für alle Fächer, je Fach in derselben Reihenfolge wie bei
  // `listTopics()`. Ein Fach ohne Vokabel steht mit leerer Liste in der Map;
  // das `?? []` ist nur die Absicherung, falls diese Zusage einmal fällt — das
  // Formular braucht für jedes Fach eine Liste, sonst stünde beim Umstellen
  // „keine Themen“ da, wo in Wahrheit nichts geladen wurde.
  const topicsBySubject = await listTopicsForSubjects(
    user.id,
    subjects.map((subject) => subject.id),
  );
  const topicSuggestions = Object.fromEntries(
    subjects.map(
      (subject) => [subject.id, topicsBySubject.get(subject.id) ?? []] as const,
    ),
  );

  const color = subjectColor(item.subject.color).hex;
  const today = todayInBerlin();

  const totalBytes = item.pages.reduce((sum, page) => sum + page.byteSize, 0);
  const full = item.pages.length >= MAX_PAGES;

  return (
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/material"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 6-6 6 6 6" />
        </svg>
        Alle Blätter
      </Link>

      <header
        style={{
          backgroundColor: `color-mix(in oklab, ${color} 8%, var(--surface))`,
        }}
        className="rounded-card border border-border p-5 sm:p-6"
      >
        <p className="flex items-center gap-2 text-sm text-muted">
          <span
            aria-hidden="true"
            style={{ backgroundColor: color }}
            className="size-2.5 shrink-0 rounded-full"
          />
          {item.subject.name}
        </p>

        <h1 className="mt-1.5 text-xl font-semibold text-foreground">
          {item.title}
        </h1>

        <p className="mt-1 text-muted">{formatGerman(item.capturedOn)}</p>

        {/* Die Zahl ist die Summe der Vollbilder — das, was die Seiten dieses
            Blattes wiegen, und nicht der Platz, den es in der Datenbank
            belegt. Zu jeder Seite liegt dort zusätzlich eine Vorschau
            (`material_pages.thumb`, rund 15 KB), die hier bewusst nicht
            mitzählt: sie ist eine interne Zweitfassung, die niemand aufgenommen
            hat und die mit der Seite wieder verschwindet.

            Gemeint ist also die Frage, die man sich vor dem Blatt stellt —
            „wie schwer sind diese Bilder?“ —, und die soll man nachlesen können
            und nicht schätzen müssen. */}
        <p className="mt-3 text-sm text-muted">
          {`${item.pages.length} ${item.pages.length === 1 ? "Seite" : "Seiten"} · ${formatBytes(totalBytes)}`}
        </p>
      </header>

      <MaterialPages
        title={item.title}
        pages={item.pages.map((page) => ({
          ...page,
          deleteAction: deletePageAction.bind(null, item.id, page.id),
        }))}
      />

      {/* Der Satz sagt nicht, dass die Grenze überschritten sei — `addPage()`
          lässt keine Seite darüber hinaus zu, hier steht also immer genau
          MAX_PAGES. Er sagt stattdessen, was jetzt geht: das Nächste wird ein
          eigenes Blatt. */}
      {full ? (
        <p className="text-sm text-muted">
          {`Dieses Blatt ist mit ${MAX_PAGES} Seiten voll. Was noch dazugehört, fotografierst du als neues Blatt ab.`}
        </p>
      ) : null}

      {/* Der Auslöser steht auch am vollen Blatt hier — er zeigt dann von sich
          aus nichts mehr an. Ihn stattdessen gegen den Satz darüber
          auszutauschen, hätte ihn genau im falschen Moment aus dem Baum
          genommen: ein Blatt läuft mitten in einer laufenden Aufnahme voll (die
          Server Action revalidiert, die Seite rendert neu), und mit der
          Komponente verschwände die Meldung, welche Aufnahmen nicht mehr
          angekommen sind.

          `remaining` ist der freie Platz, den nur diese Seite kennt. Damit
          lehnt der Auslöser eine zu große Auswahl ab, bevor die erste Seite
          losgeht, statt sie stillschweigend an der Grenze verlieren zu lassen.
          `allArchived` bleibt hier folgenlos — mit `materialId` fragt der
          Auslöser nie nach einem Fach —, stimmt aber: ist kein Fach mehr aktiv,
          ist auch das dieses Blattes archiviert. */}
      <CaptureButton
        subjectId={item.subject.id}
        subjects={active}
        today={today}
        materialId={item.id}
        label="Seite hinzufügen"
        allArchived={active.length === 0}
        remaining={MAX_PAGES - item.pages.length}
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
        today={today}
      />

      <MaterialDangerZone
        materialLabel={`${item.subject.name} · ${item.title}`}
        pageCount={item.pages.length}
        deleteAction={deleteMaterialAction.bind(null, item.id)}
      />
    </div>
  );
}
