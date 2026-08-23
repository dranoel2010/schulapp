import type { Metadata } from "next";
import Link from "next/link";

import { CaptureButton } from "@/components/material/capture-button";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { todayInBerlin } from "@/lib/dates";
import {
  LIST_LIMIT,
  listMaterials,
  resolveMaterialTopic,
} from "@/lib/materials";
import { countInbox } from "@/lib/inbox";
import { listTopics, type TopicItem } from "@/lib/subject-topics";
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
 * Der Filter kommt ohne eine Zeile Client-Code aus. Fach und Thema stehen in
 * der Adresse (?fach=…, ?thema=…), jede Wahl ist ein Link, und der Server
 * fragt neu ab — dieselbe Antwort ist damit auch verschickbar und lesbar, ohne
 * dass irgendwo ein Zustand mitgeführt werden muss. Ist ein Fach gewählt,
 * schlägt der Auslöser es gleich vor: wer in Mathematik gefiltert hat,
 * fotografiert als Nächstes ein Blatt aus Mathematik. Der Vorschlag steht
 * dabei ausgeschrieben über dem Knopf, und vorgeschlagen wird nur ein Fach,
 * das noch aktiv ist.
 *
 * Das Thema bestimmt das Fach. Ein Thema gehört zu genau einem Fach, damit ist
 * „was habe ich zur Kettenregel?“ eine vollständig gestellte Frage — das Fach
 * steckt in ihr schon drin. Deshalb tragen die Themen-Chips nur ?thema= und
 * kein zweites ?fach= mit sich herum, und deshalb gewinnt das Thema, wenn in
 * der Adresse trotzdem beides steht und sich widerspricht. Ausführlich steht
 * das unten an `chosen`.
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

/**
 * So viele Themen stehen offen da, der Rest kommt hinter „Alle Themen zeigen“.
 *
 * Zehn und nicht zwölf wie im Formular (`SUGGESTION_LIMIT` in
 * material-form.tsx): dort steht die Chip-Zeile allein unter ihrem Feld, hier
 * hat sie die Fach-Zeile über sich und die Blätter unter sich. Themen-Titel
 * sind außerdem länger als Fachnamen — „Ableitungsregeln (Kettenregel)“ füllt
 * eine halbe Zeile —, zehn davon sind auf dem Telefon rund zwei bis drei
 * Zeilen. Weniger, und das gesuchte Thema wäre zu oft nicht dabei; mehr, und
 * die Liste, um die es hier geht, stünde unter dem Bildschirmrand.
 */
const TOPIC_CHIP_LIMIT = 10;

/**
 * Die zweite Chip-Zeile: die Themen des gewählten Fachs.
 *
 * Dieselben Pill-Chips wie eine Zeile darüber, dieselbe Geste — ein Link je
 * Wahl, kein Client-Code. Der Rest steckt in einem <details>, weil das die
 * einzige Art ist, auf dieser Seite etwas auf- und zuzuklappen, ohne einen
 * Zustand einzuführen. Wortlaut und Optik sind von `TopicSuggestions` im
 * Formular übernommen; die Komponente selbst nicht — dort wählt man Themen für
 * ein Blatt aus, hier führt jeder Chip weg.
 */
function TopicChips({
  topics,
  subjectId,
  currentId,
}: {
  /** Schon gefiltert: nur Themen, an denen wirklich ein Blatt hängt. */
  topics: TopicItem[];
  /** Das Fach, zu dem sie gehören — das Ziel beim Ausschalten. */
  subjectId: string;
  /** Die aufgelöste id des geltenden Themas, sonst null. */
  currentId: string | null;
}) {
  // Kein Thema mit Blättern heißt: hier steht nichts. Kein leerer Kasten, kein
  // „keine Themen“ — eine Zeile, die nichts anzubieten hat, ist keine Zeile.
  if (topics.length === 0) return null;

  const chip = (topic: TopicItem) => {
    const current = topic.id === currentId;

    return (
      <Link
        key={topic.id}
        // Der geltende Chip führt zurück auf „nur dieses Fach“: antippen
        // schaltet den Filter also auch wieder aus. Ein Filter, aus dem man
        // nur über einen anderen Chip herauskommt, ist eine Falle.
        href={
          current
            ? `/material?fach=${subjectId}`
            : `/material?thema=${topic.id}`
        }
        aria-current={current ? "true" : undefined}
        className={cn(
          "inline-flex min-h-11 max-w-full items-center rounded-pill border px-3.5 text-sm transition-colors",
          current
            ? "border-accent bg-accent-soft font-medium text-accent"
            : "border-border text-muted hover:bg-surface-muted hover:text-foreground",
        )}
      >
        <span className="truncate">{topic.title}</span>
      </Link>
    );
  };

  // Der geltende Chip steht vorn — immer, egal wo er in der Reihenfolge
  // stünde.
  //
  // Ohne das kann der Filter, in dem man gerade steckt, unsichtbar sein: die
  // Themen kommen sortiert nach „zuletzt gesehen", und wer von der Blattseite
  // aus ein älteres Thema antippt, landet auf einer Liste, in der kein Chip
  // hervorgehoben ist. Auf dem Bildschirm stünde dann eine gewöhnliche
  // Fach-Ansicht, die aus unerfindlichen Gründen weniger Blätter zeigt — und
  // der einzige Knopf, der den Filter wieder ausschaltet, steckte zugeklappt
  // hinter „Alle Themen zeigen".
  //
  // Die Reihenfolge der übrigen bleibt, wie sie kam. Nach vorn geholt wird
  // genau einer, und er ist in dem Moment das Wichtigste auf der Seite: er
  // sagt, wonach gefiltert wird, und er ist der Weg zurück.
  const sorted =
    currentId === null
      ? topics
      : [
          ...topics.filter((topic) => topic.id === currentId),
          ...topics.filter((topic) => topic.id !== currentId),
        ];

  const open = sorted.slice(0, TOPIC_CHIP_LIMIT);
  const rest = sorted.slice(TOPIC_CHIP_LIMIT);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">{open.map(chip)}</div>

      {/* Aufgeklappt heißt der Knopf anders — er tut ja auch etwas anderes.
          Beide Wortlaute stehen im Baum und werden per CSS getauscht; ein
          <details> kann seinen eigenen Text nicht umschreiben, und ein Knopf,
          der aufgeklappt weiter „Alle Themen zeigen“ sagt, sagt die Unwahrheit
          über das, was das nächste Antippen tut. */}
      {rest.length > 0 ? (
        <details className="group space-y-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm text-accent transition-colors hover:text-accent-hover [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Alle Themen zeigen</span>
            <span className="hidden group-open:inline">Weniger zeigen</span>
          </summary>

          <div className="flex flex-wrap items-center gap-2">
            {rest.map(chip)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default async function MaterialPage({
  searchParams,
}: PageProps<"/material">) {
  const user = await requireUser();
  const query = await searchParams;

  const all = await listSubjects(user.id, { includeArchived: true });
  const active = all.filter((subject) => !subject.archived);

  // Aufgelöst, weil in der Adresse die id einer zusammengelegten Schreibweise
  // stehen darf — ein Link von früher, ein Lesezeichen aus der Zeit vor dem
  // Aufräumen. `resolveMaterialTopic()` gibt das Ziel zurück, und mit ihm
  // Titel und Fach; die Chips unten vergleichen deshalb gegen `topic.id` und
  // nie gegen das, was in der Adresse stand.
  const wantedTopicId = firstValue(query.thema);
  const topic = wantedTopicId
    ? await resolveMaterialTopic(user.id, wantedTopicId)
    : null;

  // Das Thema bestimmt das Fach.
  //
  // Löst sich ein ?thema= auf, gilt dessen Fach — auch wenn daneben ein
  // anderes ?fach= steht. „Kettenregel in Physik“ ist keine Frage, auf die es
  // eine Antwort gibt: die Seite zeigte darauf eine leere Liste unter zwei
  // Filtern, die einander ausschließen, und von außen wäre nicht zu sehen,
  // welcher der beiden die Liste leer macht. Stattdessen gewinnt das Thema und
  // der Fach-Chip springt mit; die Adresse widerspricht sich danach nicht mehr,
  // sie war ohnehin genauer, als sie sein musste.
  //
  // Ein ?thema=, das sich nicht auflösen lässt — gelöscht, fremd, kaputt —,
  // fällt still weg, genau wie ein unbekanntes ?fach= (siehe `firstValue`).
  // Übrig bleibt dann der Fach-Filter allein.
  //
  // Nur ein Fach, das dem Nutzer gehört, zählt — eine fremde oder erfundene id
  // filtert nichts, sie fällt auf „alle“ zurück. Gesucht wird in `all` und
  // nicht in `active`: das Fach eines Themas darf archiviert sein, gefiltert
  // wird trotzdem danach.
  const wantedId = topic ? topic.subjectId : firstValue(query.fach);
  const chosen = all.find((subject) => subject.id === wantedId) ?? null;

  // Ein archiviertes Fach steht sonst in keinem Chip, und der Filter, in dem
  // man gerade steckt, hätte keinen sichtbaren Knopf.
  const filters =
    chosen && chosen.archived ? [...active, chosen] : active;

  // Die Themen für die zweite Chip-Zeile.
  //
  // Nur bei gewähltem Fach: ohne eines stünden hier die Themen aller Fächer
  // nebeneinander — bei zwölf Fächern eine Wand, und „Kettenregel“ aus
  // Mathematik wäre von „Kettenregel“ aus Physik nicht zu unterscheiden.
  //
  // Und nur Themen, an denen auch etwas hängt: `listTopics()` zählt die
  // Blätter je Thema schon mit, und ein Chip mit `materialCount === 0` führte
  // auf eine leere Liste und wäre eine Sackgasse. Zusammengelegte
  // Schreibweisen bleiben ohne `includeMerged` von selbst draußen — sonst
  // stünde derselbe Chip zweimal da, einmal unter dem alten und einmal unter
  // dem neuen Namen. Sortiert ist die Liste, wie sie kommt: zuletzt gesehen
  // zuerst, also vorn das, woran gerade gearbeitet wird.
  //
  // Zeigt der Filter auf ein Thema ohne ein einziges Blatt — von Hand
  // eingetippt, oder das letzte Blatt ist inzwischen weg —, fehlt sein eigener
  // Chip. Anders als beim archivierten Fach ist das keine Falle: die Liste ist
  // dann leer, und der leere Zustand darunter führt zurück auf das Fach.
  const topicFilters = chosen
    ? (await listTopics(user.id, chosen.id)).filter(
        (item) => item.materialCount > 0,
      )
    : [];

  // In welches Fach ein neues Blatt fällt, wenn man jetzt auslöst.
  //
  // Der Filter gibt es vor, solange er auf ein aktives Fach zeigt. Zeigt er auf
  // ein abgewähltes, gilt er nicht — ein zugemachtes Fach soll den heutigen
  // Alltag nicht mehr bewegen; gefiltert werden darf trotzdem danach, was
  // fotografiert wurde, ist fotografiert. Übrig bleibt dann das einzige aktive
  // Fach, falls es nur eins gibt: der Auslöser wählt es ohnehin von selbst, und
  // was er still tut, gehört auf den Bildschirm. Sonst fragt er nach.
  //
  // Nach einem Thema gefiltert steht in `chosen` das Fach des Themas, und der
  // Satz über dem Knopf sagt damit weiter die Wahrheit: wer die Kettenregel
  // vor sich hat, fotografiert als Nächstes ein Blatt aus Mathematik. Das
  // Thema selbst schlägt der Auslöser nicht vor — er fragt nie nach einem, und
  // ein still mitgesetztes Thema stünde nirgends auf dem Bildschirm.
  const onlyActive = active.length === 1 ? (active[0] ?? null) : null;
  const preset = chosen && !chosen.archived ? chosen : onlyActive;

  // Die Liste und die Zahl des Eingangskorbs nebeneinander und nicht
  // nacheinander: die beiden wissen nichts voneinander, und hintereinander
  // gehängt wartete die Seite zweimal auf denselben Weg zur Datenbank. Lokal
  // auf PGlite fiele das nicht auf — dort gibt es ohnehin nur eine Verbindung
  // —, in der Cloud auf einem echten Postgres schon.
  //
  // Gezählt wird ungefiltert und ausdrücklich ohne Rücksicht auf das gewählte
  // Fach. Der Korb ist keine Ansicht auf diese Liste, sondern eine eigene
  // Arbeitsliste über alle Fächer; eine Zahl, die beim Umschalten des
  // Fach-Chips mitspringt, verspräche einen Korb je Fach, den es nicht gibt.
  // Die Zeile unten sagt deshalb nur, wie viele es insgesamt sind, und
  // behauptet nichts über das Fach, in dem man gerade steht.
  const [items, inboxCount] = await Promise.all([
    listMaterials(user.id, {
      subjectId: chosen?.id,
      topicId: topic?.id,
      limit: LIST_LIMIT,
    }),
    countInbox(user.id),
  ]);

  const today = todayInBerlin();

  // Kommen genau so viele Zeilen zurück, wie gefragt waren, steht die Liste an
  // ihrer Grenze. Was dahinter liegt, sieht die Seite nicht: eine Ablage mit
  // genau 200 Blättern antwortet Zeile für Zeile gleich wie eine mit 250. Der
  // Satz unten behauptet deshalb nichts über Blätter, die er nicht gesehen hat.
  // Er sagt, wie viele hier stehen, und nennt den Fall, in dem etwas fehlt.
  const atLimit = items.length >= LIST_LIMIT;

  /**
   * Dieselbe Seite mit anderer Wahl. „Alle“ lässt den Parameter ganz weg.
   *
   * Ein `thema` trägt dieser Link nie mit sich. Wer in der Fach-Zeile greift,
   * wählt ein anderes Fach als das des Themas — das Thema gehörte zum
   * vorherigen und hätte hier nichts mehr zu suchen. Bliebe es stehen, gewänne
   * es nach der Regel oben sogar und der Griff ins andere Fach bliebe ohne
   * Wirkung. Der Themen-Filter endet also mit jedem Griff in diese Zeile.
   */
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
          {/* Der Weg in den Eingangskorb, und er steht IMMER da — auch wenn
              der Korb leer ist.

              Das ist der Unterschied zur Startseite, wo er nur bei etwas
              Wartendem erscheint: dort ist er ein Anstoß, hier ist er die Tür.
              Eine Tür, die nur sichtbar ist, wenn jemand dahinter steht, ist
              keine — wer den Korb einmal leergeräumt hat, fände ihn nie
              wieder, und ein Vorschlag, der später auftaucht, hätte keinen
              Ort, an dem man ihn erwartet.

              Die Zahl steht nur dann daneben, wenn es eine gibt. „0 Blätter im
              Eingangskorb" wäre eine Aufgabe, die keine ist; „Eingangskorb"
              allein ist ein Ort. Und die Akzentfarbe trägt die Zeile nur mit
              Inhalt — sonst zöge ein leerer Korb dauerhaft den Blick auf sich,
              den die Liste darunter braucht. */}
          <Link
            href="/material/eingang"
            className={cn(
              "flex min-h-11 items-center justify-between gap-3 rounded-card border px-4 py-2.5 text-sm transition-colors",
              inboxCount > 0
                ? "border-accent bg-accent-soft font-medium text-accent hover:border-accent-hover"
                : "border-border text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <span className="truncate">
              {inboxCount === 0
                ? "Eingangskorb"
                : inboxCount === 1
                  ? "1 Blatt wartet im Eingangskorb"
                  : `${inboxCount} Blätter warten im Eingangskorb`}
            </span>

            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>

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

          {/* Die beiden Filter-Zeilen stehen enger beieinander als die Blöcke
              der Seite untereinander: die Themen gehören zu dem Fach über
              ihnen und sind kein eigener Abschnitt. Der Kasten selbst steht
              nur da, wenn wenigstens eine der beiden Zeilen etwas zu zeigen
              hat — leer risse er eine Lücke zwischen Auslöser und Liste. */}
          {filters.length > 1 || topicFilters.length > 0 ? (
            <div className="space-y-2">
              {filters.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {[null, ...filters.map((subject) => subject.id)].map((id) => {
                    const subject =
                      filters.find((item) => item.id === id) ?? null;
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

              {/* Verglichen wird gegen die aufgelöste id und nicht gegen das,
                  was in der Adresse stand: kommt jemand über den alten Namen
                  einer zusammengelegten Schreibweise, leuchtet trotzdem der
                  Chip auf, unter dem die Blätter jetzt liegen. */}
              {chosen ? (
                <TopicChips
                  topics={topicFilters}
                  subjectId={chosen.id}
                  currentId={topic?.id ?? null}
                />
              ) : null}
            </div>
          ) : null}

          {/* Nach einem Thema gefiltert braucht der leere Zustand einen
              eigenen Satz. „Nichts in Mathematik“ wäre schlicht falsch — in
              Mathematik liegt vielleicht alles, nur nicht unter diesem Thema,
              und wer das liest, sucht den Fehler beim falschen Filter. Der Weg
              heraus führt deshalb auch zurück auf das Fach und nicht auf alle
              Fächer: einen Schritt zurück, nicht alle auf einmal. */}
          {items.length === 0 ? (
            topic && chosen ? (
              <EmptyState
                title={`Nichts zu „${topic.title}“`}
                description={`In ${chosen.name} hängt an diesem Thema noch kein Blatt. Schreib es an eines, dann steht es hier.`}
                action={
                  <ButtonLink href={linkTo(chosen.id)} variant="secondary">
                    {`Alle Blätter in ${chosen.name}`}
                  </ButtonLink>
                }
                icon={<SheetIcon />}
              />
            ) : chosen ? (
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
                  Eine Pagination ist das hier ausdrücklich nicht.

                  Nach Thema gefiltert nennt der Satz das Thema und keinen Weg:
                  ein Themen-Filter ist der engste, den diese Seite hat — enger
                  ginge es nur mit etwas, das es nicht gibt. Und er nennt das
                  Thema statt des Fachs, weil beides zugleich („aus Mathematik,
                  zur Kettenregel“) doppelt sagt, was der eine Filter schon
                  festlegt: das Thema bestimmt das Fach. */}
              {atLimit ? (
                <p className="text-sm text-muted">
                  {topic
                    ? `Hier stehen die ${LIST_LIMIT} neuesten Blätter zu „${topic.title}“. Sind es mehr, zeigt diese Liste die älteren nicht.`
                    : chosen
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
