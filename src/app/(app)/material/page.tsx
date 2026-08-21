import type { Metadata } from "next";
import Link from "next/link";

import { CaptureButton } from "@/components/material/capture-button";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { todayInBerlin } from "@/lib/dates";
import { LIST_LIMIT, listMaterials } from "@/lib/materials";
import { listSubjects } from "@/lib/subjects";

import { MaterialList } from "./material-list";

/**
 * Die Ablage: alles, was abfotografiert wurde, das neueste zuerst.
 *
 * Oben steht der Auslöser und nicht unten. Bei den Aufgaben und Noten liegt
 * der Akzentknopf am Ende der Liste, weil man dort zuerst liest und dann
 * einträgt; hier ist es umgekehrt. Wer diese Seite öffnet, hat meistens ein
 * Blatt in der Hand.
 *
 * Der Filter kommt ohne eine Zeile Client-Code aus. Das Fach steht in der
 * Adresse (?fach=…), jede Wahl ist ein Link, und der Server fragt neu ab —
 * dieselbe Antwort ist damit auch verschickbar und lesbar, ohne dass irgendwo
 * ein Zustand mitgeführt werden muss. Ist ein Fach gewählt, schlägt der
 * Auslöser es gleich vor: wer in Mathematik gefiltert hat, fotografiert als
 * Nächstes ein Blatt aus Mathematik. Der Vorschlag steht dabei ausgeschrieben
 * über dem Knopf, und vorgeschlagen wird nur ein Fach, das noch aktiv ist.
 */

export const metadata: Metadata = {
  title: "Material",
};

// `export const dynamic = "force-dynamic"` steht schon im Layout der Gruppe
// (src/app/(app)/layout.tsx) und gilt damit auch hier — hier wäre es doppelt.

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste.
 * Alles Unbekannte fällt still auf „alle Fächer“ zurück — eine Adresszeile ist
 * kein Formular, sie bekommt keine Fehlermeldung.
 */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Das Blatt-Symbol des leeren Zustands. */
function SheetIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5h7.5L18 8v12.5H6z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9 12.5h6M9 16h4" />
    </svg>
  );
}

export default async function MaterialPage({
  searchParams,
}: PageProps<"/material">) {
  const user = await requireUser();
  const query = await searchParams;

  const all = await listSubjects(user.id, { includeArchived: true });
  const active = all.filter((subject) => !subject.archived);

  // Nur ein Fach, das dem Nutzer gehört, zählt — eine fremde oder erfundene id
  // filtert nichts, sie fällt auf „alle“ zurück.
  const wantedId = firstValue(query.fach);
  const chosen = all.find((subject) => subject.id === wantedId) ?? null;

  // Ein archiviertes Fach steht sonst in keinem Chip, und der Filter, in dem
  // man gerade steckt, hätte keinen sichtbaren Knopf.
  const filters =
    chosen && chosen.archived ? [...active, chosen] : active;

  // In welches Fach ein neues Blatt fällt, wenn man jetzt auslöst.
  //
  // Der Filter gibt es vor, solange er auf ein aktives Fach zeigt. Zeigt er auf
  // ein abgewähltes, gilt er nicht — ein zugemachtes Fach soll den heutigen
  // Alltag nicht mehr bewegen; gefiltert werden darf trotzdem danach, was
  // fotografiert wurde, ist fotografiert. Übrig bleibt dann das einzige aktive
  // Fach, falls es nur eins gibt: der Auslöser wählt es ohnehin von selbst, und
  // was er still tut, gehört auf den Bildschirm. Sonst fragt er nach.
  const onlyActive = active.length === 1 ? (active[0] ?? null) : null;
  const preset = chosen && !chosen.archived ? chosen : onlyActive;

  const items = await listMaterials(user.id, {
    subjectId: chosen?.id,
    limit: LIST_LIMIT,
  });
  const today = todayInBerlin();

  // Kommen genau so viele Zeilen zurück, wie gefragt waren, steht die Liste an
  // ihrer Grenze. Was dahinter liegt, sieht die Seite nicht: eine Ablage mit
  // genau 200 Blättern antwortet Zeile für Zeile gleich wie eine mit 250. Der
  // Satz unten behauptet deshalb nichts über Blätter, die er nicht gesehen hat.
  // Er sagt, wie viele hier stehen, und nennt den Fall, in dem etwas fehlt.
  const atLimit = items.length >= LIST_LIMIT;

  /** Dieselbe Seite mit anderer Wahl. „Alle“ lässt den Parameter ganz weg. */
  const linkTo = (id: string | null) => (id ? `/material?fach=${id}` : "/material");

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Material</h1>
        <p className="text-sm text-muted">
          Arbeitsblätter, Tafelbilder, Kopien. Fotografieren, Fach und Thema
          dazuschreiben — dann findest du sie vor der Klausur wieder.
        </p>
      </header>

      {/* Ohne ein einziges Fach gibt es nichts, wohin eine Aufnahme könnte.
          Sind nur alle Fächer archiviert, bleibt die Ablage trotzdem stehen —
          was fotografiert wurde, ist fotografiert; der Auslöser sagt dann
          selbst, dass zuerst eines der Fächer zurückgeholt werden muss, und
          führt dorthin. Anlegen wäre hier der falsche Rat: die Blätter, die
          unter diesem Satz stehen, liegen ja genau in diesen Fächern. */}
      {all.length === 0 ? (
        <EmptyState
          title="Zuerst die Fächer"
          description="Jedes Blatt gehört zu einem Fach. Sobald deine Fächer stehen, kannst du losfotografieren."
          action={<ButtonLink href="/faecher">Zu den Fächern</ButtonLink>}
          icon={<SheetIcon />}
        />
      ) : (
        <>
          {/* Ist ein Fach vorbelegt, versteckt der Auslöser seine Fach-Auswahl —
              auf dem Bildschirm stünde dann nur „Blatt aufnehmen“, und das Blatt
              fiele still in ein Fach, das niemand bestätigt hat. Also sagt es
              der Satz. Er kommt von der Seite und nicht aus dem Auslöser, weil
              die Kameraseite (src/components/home/capture-pane.tsx) denselben
              Satz schon selbst über den Knopf schreibt; im Auslöser stünde er
              dort zweimal. Der Wortlaut ist deshalb genau derselbe.

              Bei genau einem Fach steht der Satz auch dann da, wenn niemand
              gefiltert hat. Er ist dort keine Neuigkeit, aber die Regel bleibt
              dadurch ohne Ausnahme: wo ein Fach vorbelegt ist, steht es auf dem
              Bildschirm. Und in dem einen Fall, der sonst irreführt — der Filter
              zeigt auf ein abgewähltes Fach, das Blatt fällt trotzdem in das
              aktive —, sagt genau dieser Satz, wohin es wirklich geht. */}
          <div className="space-y-2">
            {preset ? (
              <p className="text-sm text-muted">
                Das Blatt landet in {preset.name} — ändern kannst du das danach.
              </p>
            ) : null}

            {/* `active` ist hier leer genau dann, wenn alle Fächer archiviert
                sind — der Fall ohne jedes Fach ist eine Ebene höher schon
                abgefangen. Ohne `allArchived` läse der Auslöser die leere Liste
                als „noch nichts angelegt“ und riete zum Anlegen. */}
            <CaptureButton
              subjectId={preset?.id ?? null}
              subjects={active}
              today={today}
              label="Blatt aufnehmen"
              allArchived={active.length === 0}
            />
          </div>

          {filters.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              {[null, ...filters.map((subject) => subject.id)].map((id) => {
                const subject = filters.find((item) => item.id === id) ?? null;
                const current = (chosen?.id ?? null) === id;

                return (
                  <Link
                    key={id ?? "alle"}
                    href={linkTo(id)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-11 max-w-full items-center gap-2 rounded-pill border px-3.5 text-sm transition-colors",
                      current
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-border text-muted hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {subject ? (
                      <span
                        aria-hidden="true"
                        style={{
                          backgroundColor: subjectColor(subject.color).hex,
                        }}
                        className="size-2.5 shrink-0 rounded-full"
                      />
                    ) : null}
                    <span className="truncate">
                      {subject?.name ?? "Alle Fächer"}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}

          {items.length === 0 ? (
            chosen ? (
              <EmptyState
                title={`Nichts in ${chosen.name}`}
                description="In diesem Fach liegt noch kein Blatt. Aufgenommen wird es mit dem Knopf oben."
                action={
                  <ButtonLink href="/material" variant="secondary">
                    Alle Fächer zeigen
                  </ButtonLink>
                }
                icon={<SheetIcon />}
              />
            ) : (
              <EmptyState
                title="Noch kein Blatt"
                description="Fotografier das erste Arbeitsblatt ab. Mit Fach und Thema daran steht es vor der Klausur da, wo du danach suchst."
                icon={<SheetIcon />}
              />
            )
          ) : (
            // Der Hinweis steht enger an der Liste als die Blöcke der Seite
            // untereinander — er gehört zu ihr und ist kein eigener Abschnitt.
            <div className="space-y-2">
              <MaterialList items={items} />

              {/* Was die Liste nicht zeigt, sagt sie. Ohne diesen Satz endet
                  die Ablage bei 200 Blättern einfach, und nichts unterscheidet
                  „das war alles“ von „das ist der Anfang“.

                  Der Satz nennt die Zahl und bleibt im Konjunktiv, weil die
                  Seite nicht weiß, ob es mehr sind (siehe `atLimit`) — „50
                  weitere“ stünde da erfunden. Der Weg nach hinten steht nur
                  dort, wo es ihn gibt: nach Fach gefiltert gilt die Grenze je
                  Fach und reicht damit weiter zurück, aber die Fach-Chips
                  erscheinen erst ab zwei Fächern, und in einem schon
                  gefilterten Fach hilft ein weiterer Filter nicht mehr. Dann
                  bleibt der Satz bei dem, was wahr ist, und verspricht nichts.
                  Eine Pagination ist das hier ausdrücklich nicht. */}
              {atLimit ? (
                <p className="text-sm text-muted">
                  {chosen
                    ? `Hier stehen die ${LIST_LIMIT} neuesten Blätter aus ${chosen.name}. Sind es mehr, zeigt diese Liste die älteren nicht.`
                    : filters.length > 1
                      ? `Hier stehen die ${LIST_LIMIT} neuesten Blätter. Sind es mehr, zeigt diese Liste die älteren nicht — nach Fach gefiltert reicht jedes Fach für sich weiter zurück.`
                      : `Hier stehen die ${LIST_LIMIT} neuesten Blätter. Sind es mehr, zeigt diese Liste die älteren nicht.`}
                </p>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
