import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { INBOX_LIMIT, listInbox, type InboxEntry } from "@/lib/inbox";
import { getMaterial } from "@/lib/materials";
import { listSubjects } from "@/lib/subjects";

import { markFiledAction } from "./actions";
import { SubmitButton } from "./proposal-form";
import {
  MaterialGlance,
  OriginBadge,
  ProposalSummary,
  arrivedLabel,
} from "./proposal-view";

/**
 * Der Eingangskorb: was noch eine Entscheidung braucht.
 *
 * Er liegt UNTER /material und nicht daneben, weil er eine Arbeitsansicht auf
 * die Ablage ist — genau wie /stundenplan/zeiten eine auf den Stundenplan ist.
 * Ein Konflikt mit /material/<uuid> entsteht dadurch nicht: Next löst
 * statische Segmente vor `[id]` auf, „eingang" gewinnt also immer gegen die
 * Blattseite, und ein Blatt kann ohnehin keine id namens „eingang" haben.
 *
 * Eine Zeile ist ein **Blatt** und nicht ein Vorschlag. Entschieden wird über
 * Blätter: „stimmt so" oder „so soll es heißen". Die Vorschläge stehen deshalb
 * unter ihrem Blatt und nicht in einer eigenen Liste, in der man zu jedem erst
 * nachschlagen müsste, worauf er sich bezieht.
 *
 * Zwei Fälle liegen hier, und der zweite überrascht: ein Blatt, das schon
 * durchgesehen ist, kann trotzdem im Korb stehen — nämlich dann, wenn danach
 * noch ein Vorschlag dazugekommen ist. Ohne einen Satz an der Zeile sähe das
 * wie ein Fehler aus, deshalb steht er da.
 *
 * Alles hier wird auf dem Server gerendert. Angefasst wird nur über Formulare
 * und Links; einen Zustand im Browser braucht diese Seite nirgends.
 */

export const metadata: Metadata = {
  title: "Eingangskorb",
};

// `export const dynamic = "force-dynamic"` steht schon im Layout der Gruppe
// (src/app/(app)/layout.tsx) und gilt damit auch hier — hier wäre es doppelt.

/**
 * Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste.
 * Wortgleich zu `firstValue()` in ../page.tsx, wo es privat ist.
 */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine Zahl aus der Adresszeile — oder 0.
 *
 * Was hier ankommt, hat `confirmProposalAction()` geschrieben; verlassen kann
 * sich die Seite darauf trotzdem nicht, eine Adresse tippt jeder selbst. Alles,
 * was nicht durchkommt, zählt als 0 und lässt den Satz einfach weg. Eine
 * Fehlermeldung wäre hier falsch: eine Adresszeile ist kein Formular.
 *
 * **Geprüft wird die Zeichenkette und nicht die Zahl dahinter**, und das ist
 * der Grund für das Muster statt eines `Number.isInteger()`. Der ist nämlich
 * großzügiger, als er aussieht: `Number("1e21")` ist eine ganze Zahl und nicht
 * negativ, kommt also durch — und steht danach als „1e+21 weitere Vorschläge"
 * auf dem Bildschirm, was keine Zahl mehr ist, die jemand liest. Ebenso käme
 * „0x10" als 16 durch und „+5" als 5. Was diese Seite meint, sind höchstens
 * drei Ziffern in Dezimalschreibweise; alles andere hat `confirmedHref()`
 * nicht geschrieben.
 *
 * Die Obergrenze von drei Stellen ist die eine Zusage, die diese Seite über
 * diese Zahlen NICHT prüfen kann: die Vorschläge, von denen sie erzählen, sind
 * beim Rendern längst gelöscht, nachzählen lässt sich nichts mehr. Ein Deckel
 * ist deshalb kein Beweis, sondern nur die Grenze des Schadens.
 */
const COUNT_PATTERN = /^\d{1,3}$/;

function count(value: string | undefined): number {
  if (value === undefined || !COUNT_PATTERN.test(value)) return 0;

  return Number(value);
}

/** Das Korb-Symbol des leeren Zustands. */
function BasketIcon() {
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
      <path d="M3.5 13.5 6.5 5h11l3 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18z" />
      <path d="M3.5 13.5h4l1 2.5h7l1-2.5h4" />
    </svg>
  );
}

export default async function InboxPage({
  searchParams,
}: PageProps<"/material/eingang">) {
  const user = await requireUser();
  const query = await searchParams;

  const items = await listInbox(user.id, { limit: INBOX_LIMIT });

  // Eine Abfrage für alle Fächer, damit die Vorschläge ihren Fachnamen
  // hinschreiben können. In der Zeile eines Vorschlags steht nur eine id; je
  // Vorschlag nachzuschlagen wären bei einem vollen Korb hundert Abfragen für
  // eine Liste. Archivierte sind dabei: ein Vorschlag darf auf ein abgewähltes
  // Fach zeigen, und dann soll dort sein Name stehen und nicht „ein anderes".
  const subjects = await listSubjects(user.id, { includeArchived: true });
  const subjectNames = new Map(
    subjects.map((subject) => [subject.id, subject.name] as const),
  );

  const today = todayInBerlin();

  // Kommen genau so viele Zeilen zurück, wie gefragt waren, steht die Liste an
  // ihrer Grenze. Was dahinter liegt, sieht die Seite nicht — sie behauptet
  // deshalb nichts darüber. Im Korb wiegt das schwerer als in der Ablage: ein
  // abgeschnittener Korb sieht aus wie ein leergeräumter.
  const atLimit = items.length >= INBOX_LIMIT;

  // Was `confirmProposalAction()` mitgeschickt hat.
  //
  // Die id wird nicht nur auf ihre Form geprüft, sondern **nachgeschlagen**.
  // Der Unterschied ist die Regel dieses Projekts: der Bildschirm behauptet
  // nichts, was der Code nicht weiß. Reichte die Form, zeigte
  // `/material/eingang?uebernommen=00000000-…` den Satz „Übernommen" über
  // einem Blatt, das es nicht gibt — eine selbst getippte oder zugeschickte
  // Adresse ließe die App etwas bezeugen, das nie passiert ist. Und der Satz
  // wird durch das Nachschlagen zugleich brauchbarer: er kann sagen, WELCHES
  // Blatt es war, und wer einen Korb von oben nach unten abarbeitet, hat
  // danach mehrere hinter sich.
  //
  // Die Abfrage kostet nur dort etwas, wo der Parameter überhaupt steht: beim
  // gewöhnlichen Öffnen des Korbs läuft sie nicht.
  const confirmedRaw = firstValue(query.uebernommen);
  const confirmed =
    confirmedRaw && UUID_PATTERN.test(confirmedRaw)
      ? await getMaterial(user.id, confirmedRaw)
      : null;
  const weitere = count(firstValue(query.weitere));
  const ohneFachwort = count(firstValue(query.ohnefachwort));
  const zusammengefallen = count(firstValue(query.zusammengefallen));
  const andereSchreibweise = count(firstValue(query.schreibweise));

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

      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Eingangskorb</h1>
        <p className="text-sm text-muted">
          Hier liegt, was noch eine Entscheidung braucht: frisch aufgenommene
          Blätter, die niemand durchgesehen hat, und Vorschläge, über die noch
          niemand entschieden hat. Ein Vorschlag ändert von sich aus nichts —
          am Blatt steht erst dann etwas anderes, wenn du ihn übernimmst.
        </p>
      </header>

      {/* Die Bestätigung nach dem Übernehmen. Sie kommt aus der Adresse und
          nicht aus dem Formular, weil es die Seite, auf der übernommen wurde,
          danach nicht mehr gibt — der ausführliche Grund steht an
          `confirmedHref()` in actions.ts. Nur mitgeteilt (role="status") und
          nicht gemeldet: hier ist nichts schiefgegangen. */}
      {confirmed ? (
        <div
          role="status"
          className="space-y-2 rounded-card border border-border bg-surface-muted p-4"
        >
          <p className="text-sm text-foreground">
            {`Übernommen: „${confirmed.title}“ steht jetzt so da, wie du es bestätigt hast — durchgesehen und aus dem Korb heraus.`}
          </p>

          {/* Die anderen Vorschläge zu diesem Blatt sind mit weggefallen — sie
              bezögen sich auf einen Stand, den es nicht mehr gibt. Still
              verschwinden dürfen sie deshalb trotzdem nicht. */}
          {weitere > 0 ? (
            <p className="text-sm text-muted">
              {weitere === 1
                ? "Ein weiterer Vorschlag zu diesem Blatt ist damit weggefallen — er galt einem Stand, den es nicht mehr gibt."
                : `${weitere} weitere Vorschläge zu diesem Blatt sind damit weggefallen — sie galten einem Stand, den es nicht mehr gibt.`}
            </p>
          ) : null}

          {ohneFachwort > 0 ? (
            <p className="text-sm text-muted">
              {ohneFachwort === 1
                ? "Ein Thema wurde nicht übernommen: ihm fehlt ein Fachwort. „Übungen“ ist kein Thema, sondern das, was man damit macht."
                : `${ohneFachwort} Themen wurden nicht übernommen: ihnen fehlt ein Fachwort. „Übungen“ ist kein Thema, sondern das, was man damit macht.`}
            </p>
          ) : null}

          {/* Ein getippter Titel, den das Fach schon anders schreibt. Die
              Gegenüberstellung konnte das nicht ankündigen — sie ist eine
              reine Rechnung und liest das Vokabular nicht —, also steht es
              hier. Ohne diesen Satz hieße ein Thema am Blatt plötzlich anders
              als das, was man bestätigt hat, und niemand sagte warum. */}
          {andereSchreibweise > 0 ? (
            <p className="text-sm text-muted">
              {andereSchreibweise === 1
                ? "Ein Thema führt das Fach schon unter einer anderen Schreibweise — die gilt, und so steht es jetzt am Blatt."
                : `${andereSchreibweise} Themen führt das Fach schon unter anderen Schreibweisen — die gelten, und so stehen sie jetzt am Blatt.`}
            </p>
          ) : null}

          {zusammengefallen > 0 ? (
            <p className="text-sm text-muted">
              {zusammengefallen === 1
                ? "Ein Thema meint dasselbe wie ein anderes und steht einmal am Blatt."
                : `${zusammengefallen} Themen meinen dasselbe wie jeweils ein anderes und stehen einmal am Blatt.`}
            </p>
          ) : null}

          <ButtonLink href={`/material/${confirmed.id}`} variant="secondary">
            Blatt ansehen
          </ButtonLink>
        </div>
      ) : null}

      {items.length === 0 ? (
        // Ein leerer Korb ist kein Mangel, sondern der Zustand, auf den diese
        // Seite hinarbeitet. Deshalb steht hier kein Knopf, der ihn wieder
        // füllte — angeboten wird der Weg zurück in die Ablage.
        <EmptyState
          title="Alles durchgesehen"
          description="Im Korb liegt nichts: jedes Blatt ist angesehen, und kein Vorschlag wartet auf eine Entscheidung. Genau so soll es hier meistens aussehen."
          action={
            <ButtonLink href="/material" variant="secondary">
              Zur Ablage
            </ButtonLink>
          }
          icon={<BasketIcon />}
        />
      ) : (
        // Der Hinweis steht enger an der Liste als die Blöcke der Seite
        // untereinander — er gehört zu ihr und ist kein eigener Abschnitt.
        <div className="space-y-2">
          <ul className="space-y-3">
            {items.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                subjectNames={subjectNames}
                today={today}
              />
            ))}
          </ul>

          {/* Was die Liste nicht zeigt, sagt sie. Der Satz nennt die Zahl und
              bleibt im Konjunktiv, weil die Seite nicht weiß, ob es mehr sind
              (siehe `atLimit`) — „50 weitere“ stünde da erfunden. Einen Weg
              nach hinten gibt es nicht und soll es nicht geben: der Korb ist
              zum Leeren da, nicht zum Blättern. */}
          {atLimit ? (
            <p className="text-sm text-muted">
              {`Hier stehen ${INBOX_LIMIT} Blätter aus dem Korb. Liegen mehr darin, zeigt diese Liste die älteren nicht — arbeite von oben ab, dann rücken sie nach.`}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Ein Blatt im Korb, mit seinen Vorschlägen darunter. */
function InboxRow({
  item,
  subjectNames,
  today,
}: {
  item: InboxEntry;
  /** Fachname je id, einmal für die ganze Seite geladen. */
  subjectNames: Map<string, string>;
  /** Der heutige Kalendertag — für „heute“ und „gestern“ an den Vorschlägen. */
  today: string;
}) {
  const filed = item.filedAt !== null;

  return (
    <li className="space-y-3 rounded-card border border-border bg-surface p-4 sm:p-5">
      <MaterialGlance item={item} />

      {/* Ohne diesen Satz sieht die Zeile aus wie ein Fehler: das Blatt ist
          abgehakt und steht trotzdem im Korb. Der Grund ist, dass danach noch
          ein Vorschlag dazugekommen ist — anders käme es hier gar nicht her
          (siehe `listInbox()` in @/lib/inbox), der Satz kann also nichts
          Falsches behaupten. */}
      {filed ? (
        <p className="text-sm text-muted">
          Durchgesehen — im Korb liegt es nur noch, weil ein Vorschlag dazu auf
          eine Entscheidung wartet.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {/* Der Weg für ein Blatt, an dem nichts zu ändern ist: angesehen,
            stimmt so, weg damit. `filed` steckt in der gebundenen Action und
            nicht in einem versteckten Feld — welcher Knopf gedrückt wurde,
            weiß der Server dann von selbst. */}
        <form action={markFiledAction.bind(null, item.id, !filed)}>
          <SubmitButton>
            {filed ? "Wieder in den Korb" : "Abhaken"}
          </SubmitButton>
        </form>

        <ButtonLink
          href={`/material/eingang/neu?blatt=${item.id}`}
          variant="secondary"
        >
          Vorschlag anlegen
        </ButtonLink>

        {/* Der Weg zum Blatt selbst. Dort wird direkt geändert — im Korb geht
            das absichtlich nicht: hier entscheidet man über Vorschläge, dort
            schreibt man selbst. */}
        <ButtonLink href={`/material/${item.id}`} variant="ghost">
          Blatt öffnen
        </ButtonLink>
      </div>

      {item.proposals.length > 0 ? (
        <ul className="space-y-2 border-t border-border pt-3">
          {item.proposals.map((proposal) => (
            <li
              key={proposal.id}
              className="space-y-2 rounded-control border border-border bg-surface-muted p-3"
            >
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <OriginBadge origin={proposal.origin} />
                <span>{arrivedLabel(proposal.createdAt, today)}</span>
              </p>

              <ProposalSummary
                proposal={proposal}
                subjectName={
                  proposal.subjectId === null
                    ? null
                    : (subjectNames.get(proposal.subjectId) ?? null)
                }
              />

              <ButtonLink
                href={`/material/eingang/${proposal.id}`}
                variant="secondary"
              >
                Ansehen und übernehmen
              </ButtonLink>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
