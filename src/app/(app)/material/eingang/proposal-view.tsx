import type { ProposalOrigin } from "@/db/schema";
import { subjectColor } from "@/lib/colors";
import { daysBetween, formatGerman, todayInBerlin } from "@/lib/dates";
import type { ProposalItem } from "@/lib/inbox";
import type { MaterialListItem } from "@/lib/materials";

/**
 * Die Bausteine, die der Korb und die Seite eines Vorschlags gemeinsam haben.
 *
 * Sie stehen hier und nicht zweimal, weil sie beide Male dasselbe behaupten
 * müssen. „Vom Agenten" darf nicht auf der einen Seite so und auf der anderen
 * anders heißen, und ein Vorschlag, der im Korb einen Titel nennt, muss ihn
 * eine Seite später auch nennen — zwei Fassungen wären zwei Gelegenheiten, den
 * Nutzer über dieselbe Zeile verschieden zu unterrichten.
 *
 * Reine Anzeige, also Server Components: hier wird nichts angefasst, nur
 * hingeschrieben.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Das Vorschaubild im Listenformat: hochkant, so wie ein Blatt liegt. */
const COVER_WIDTH = 48;
const COVER_HEIGHT = 64;

/**
 * Woher ein Vorschlag kommt, in zwei Wörtern.
 *
 * Kein „unbekannt" als dritter Fall: `toOrigin()` in @/lib/inbox faltet alles,
 * was nicht „agent" ist, auf „manuell" — die Spalte ist `text` und kann
 * enthalten, was jemand hineinschreibt. Hier steht deshalb nie etwas anderes
 * als eines von beiden.
 */
export function originLabel(origin: ProposalOrigin): string {
  return origin === "agent" ? "vom Agenten" : "von Hand";
}

/**
 * Wann der Vorschlag kam.
 *
 * Ein Korb wird täglich abgearbeitet, deshalb steht bei den frischen Zeilen
 * „heute" und „gestern" und nicht ein Datum, das man erst mit dem Kalender
 * vergleichen müsste. Alles Ältere bekommt den Tag — „vor 87 Tagen" ist eine
 * Zahl, mit der niemand etwas anfängt.
 *
 * Gerechnet wird über den Berliner Kalendertag des Zeitstempels und nicht über
 * die Stunden dazwischen: „heute" heißt im Alltag „an diesem Kalendertag" und
 * nicht „innerhalb der letzten 24 Stunden". Ein Vorschlag von gestern Abend
 * ist heute Morgen von gestern, auch wenn erst zehn Stunden vergangen sind.
 */
export function arrivedLabel(createdAt: Date, today: string): string {
  const day = todayInBerlin(createdAt);
  const days = daysBetween(today, day);

  if (days === 0) return "heute";
  if (days === -1) return "gestern";

  return formatGerman(day, "kurz");
}

/** Das Schild, das sagt, wer geschrieben hat. */
export function OriginBadge({ origin }: { origin: ProposalOrigin }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-pill px-2 py-0.5 text-xs",
        // Der Agentenvorschlag steht in der Akzentfarbe, der von Hand nicht.
        // Nicht als Auszeichnung, sondern weil er der ist, den man lesen muss,
        // bevor man ihn übernimmt — er stammt aus dem Inhalt eines Blattes,
        // also aus etwas, das diese App nicht geschrieben hat.
        origin === "agent"
          ? "bg-accent-soft font-medium text-accent"
          : "bg-surface-muted text-muted",
      )}
    >
      {originLabel(origin)}
    </span>
  );
}

/**
 * Das Blatt in einer Zeile: Vorschaubild, Titel, Fach, Tag, Themen.
 *
 * Dieselbe Form wie eine Zeile der Ablage (material-list.tsx), aber ohne den
 * Link darum: hier hängen Knöpfe daneben, und ein Link, der Knöpfe umschließt,
 * ist kein gültiges HTML — angetippt führte er mal zum Blatt und mal nicht.
 *
 * Feste Maße am Bild, weil die Liste sonst beim Laden aufspringt und die
 * Zeile, die man antippen wollte, inzwischen woanders steht. Ein gewöhnliches
 * <img> und nicht next/image: die Bildoptimierung schickt keine Cookies mit
 * und bekäme vom Route Handler zu Recht ein Nein.
 */
export function MaterialGlance({ item }: { item: MaterialListItem }) {
  const color = subjectColor(item.subject.color);

  return (
    <div className="flex items-start gap-3">
      {item.coverPageId ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache
        <img
          src={`/api/material/${item.coverPageId}/vorschau`}
          /* Der Titel steht direkt daneben — das Bild noch einmal zu
             beschreiben, hieße jede Zeile doppelt vorzulesen. */
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading="lazy"
          decoding="async"
          className="h-16 w-12 shrink-0 rounded-control border border-border bg-surface-muted object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-16 w-12 shrink-0 rounded-control border border-dashed border-border bg-surface-muted"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{item.title}</p>

        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
          <span
            aria-hidden="true"
            style={{ backgroundColor: color.hex }}
            className="size-2.5 shrink-0 rounded-full"
          />
          <span className="truncate">
            {[
              item.subject.name,
              formatGerman(item.capturedOn, "kurz"),
              item.pageCount > 1 ? `${item.pageCount} Seiten` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>

        {/* Kein „keine Themen“, wenn keines dranhängt. Der Korb ist die Liste
            der Blätter, an denen noch etwas zu tun ist — dort ist ein leeres
            Themenfeld der Normalfall und kein Vorwurf. */}
        {item.topics.length > 0 ? (
          <p className="mt-0.5 truncate text-sm text-subtle">
            {item.topics.map((topic) => topic.title).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Was ein Vorschlag vorschlägt — und nur das.
 *
 * Genannt wird ausschließlich, wozu er sich äußert. Ein Feld, über das er
 * schweigt, steht hier gar nicht; ein „Titel: —" läse sich wie ein Vorschlag,
 * den Titel zu leeren, und genau das kann ein Vorschlag nicht (siehe
 * `prefillFromProposal()` in @/lib/inbox).
 *
 * Der Fachname kommt von außen, weil in der Zeile nur eine id steht und diese
 * Liste keine Abfrage aufmachen soll — die Seite hat die Fächer ohnehin schon
 * geladen.
 */
export function ProposalSummary({
  proposal,
  subjectName,
}: {
  proposal: ProposalItem;
  /** Der Name des vorgeschlagenen Fachs, falls es eines gibt. */
  subjectName: string | null;
}) {
  const parts: { feld: string; wert: string }[] = [];

  if (proposal.subjectId !== null) {
    // Das Fach gibt es, seine id steht in der Zeile — nur den Namen kennt die
    // Seite nicht mehr, wenn das Fach inzwischen jemand anderem gehört oder
    // aus der geladenen Liste gefallen ist. Dann steht da, was wahr ist.
    parts.push({ feld: "Fach", wert: subjectName ?? "ein anderes Fach" });
  }

  if (proposal.title !== null) {
    parts.push({ feld: "Titel", wert: proposal.title });
  }

  if (proposal.capturedOn !== null) {
    parts.push({
      feld: "Tag",
      wert: formatGerman(proposal.capturedOn, "kurz"),
    });
  }

  if (proposal.topics.length > 0) {
    parts.push({ feld: "Themen", wert: proposal.topics.join(" · ") });
  }

  if (proposal.note !== null) {
    parts.push({ feld: "Notiz", wert: proposal.note });
  }

  /* Ein Vorschlag ohne eine einzige Angabe kommt durch das Formular nicht
     herein — `proposalInputSchema` weist ihn ab. Entstehen kann er trotzdem,
     und zwar nachträglich: schlug er nur ein Fach vor und wird genau dieses
     Fach gelöscht, setzt die Datenbank die Spalte auf NULL (siehe
     `materialProposals` in src/db/schema.ts) und übrig bleibt eine Zeile, die
     nichts mehr sagt. Sie stumm anzuzeigen wäre die schlechteste Fassung: eine
     Zeile, die eine Entscheidung verlangt und nicht verrät, worüber. */
  if (parts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Dieser Vorschlag sagt nichts mehr. Das passiert, wenn er nur ein Fach
        vorgeschlagen hat und genau dieses Fach gelöscht wurde — dann bleibt
        die Zeile stehen und die Angabe fällt weg. Zu übernehmen gibt es hier
        nichts mehr; verwerfen kannst du ihn.
      </p>
    );
  }

  return (
    <dl className="space-y-1 text-sm">
      {parts.map(({ feld, wert }) => (
        <div key={feld} className="flex gap-2">
          <dt className="w-16 shrink-0 text-subtle">{feld}</dt>
          <dd className="min-w-0 flex-1 text-foreground">{wert}</dd>
        </div>
      ))}
    </dl>
  );
}
