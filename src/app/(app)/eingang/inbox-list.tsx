import Link from "next/link";

import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import {
  proposalHeadline,
  type ProposalItem,
  type ProposalPayload,
} from "@/lib/proposals";
import type { ProposalKind } from "@/db/schema";

import { DiscardButton } from "./discard-button";

/**
 * Der Eingangskorb als Liste — reine Anzeige, deshalb eine Server Component.
 * Nur der Verwerfen-Knopf bringt seinen eigenen Zustand mit und steht deshalb
 * daneben in einer Client-Komponente.
 *
 * Jede Zeile beginnt mit dem Blatt. Das ist nicht Schmuck: ein Vorschlag ist
 * eine Behauptung über ein Stück Papier, und ob sie stimmt, sieht man dem
 * Papier an und nicht dem Satz darüber. Wer die Vorschau erkennt, weiß in
 * einer Sekunde, worum es geht.
 *
 * Antippen führt zum Formular, mit dem der Vorschlag übernommen wird.
 * „Verwerfen“ steht schon hier: eine Karte, aus der offensichtlich nichts
 * werden soll, muss man nicht erst aufmachen.
 *
 * Entschiedene Karten stehen blass unter den offenen und tragen keinen Link
 * mehr — es gibt nichts mehr zu entscheiden. Sie bleiben trotzdem stehen, und
 * zwar vierzehn Tage: „habe ich das übernommen oder weggeworfen?“ ist eine
 * Frage, die man sich am nächsten Tag stellt.
 */

/** Das Vorschaubild im Listenformat: hochkant, so wie ein Blatt liegt. */
const COVER_WIDTH = 48;
const COVER_HEIGHT = 64;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type InboxListProps = {
  items: ProposalItem[];
  /** Was die Server Action zum Verwerfen braucht — gebunden vom Server. */
  discardAction: (id: string) => Promise<void>;
};

export function InboxList({ items, discardAction }: InboxListProps) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
      {items.map((item) => (
        <InboxRow key={item.id} item={item} discardAction={discardAction} />
      ))}
    </ul>
  );
}

function InboxRow({
  item,
  discardAction,
}: {
  item: ProposalItem;
  discardAction: (id: string) => Promise<void>;
}) {
  const open = item.status === "offen";

  return (
    <li className={cn("flex items-center gap-2 pr-3", open ? null : "opacity-60")}>
      {open ? (
        <Link
          href={`/eingang/${item.id}`}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4 transition-colors hover:bg-surface-muted"
        >
          <RowContent item={item} />
          <Chevron />
        </Link>
      ) : (
        <div className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4">
          <RowContent item={item} />
        </div>
      )}

      {open ? <DiscardButton action={discardAction.bind(null, item.id)} /> : null}
    </li>
  );
}

function RowContent({ item }: { item: ProposalItem }) {
  const color = subjectColor(item.material.subject.color);

  return (
    <>
      {item.material.coverPageId ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache
        <img
          src={`/api/material/${item.material.coverPageId}/vorschau`}
          /* Der Titel des Blattes steht direkt daneben. */
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

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {proposalHeadline(item.kind, item.payload)}
        </span>

        <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
          <span
            aria-hidden="true"
            style={{ backgroundColor: color.hex }}
            className="size-2.5 shrink-0 rounded-full"
          />
          <span className="truncate">
            {[
              item.material.subject.short,
              item.material.title,
              formatGerman(item.material.capturedOn, "kurz"),
            ].join(" · ")}
          </span>
        </span>

        <span className="mt-0.5 block truncate text-sm text-subtle">
          {detailLine(item)}
        </span>
      </span>
    </>
  );
}

/**
 * Die dritte Zeile: was in dem Vorschlag drinsteht.
 *
 * Sie nennt den Inhalt und nicht die Begründung. Wer den Korb durchsieht,
 * entscheidet über das, was entstehen soll — die Begründung des Agenten steht
 * eine Seite weiter, wo sie beim Zweifeln hilft. In der Liste ist Platz für
 * eine Zeile, und die gehört der Sache.
 *
 * Bei einem entschiedenen Vorschlag steht stattdessen, was aus ihm geworden
 * ist. Das ist die einzige Frage, die man an eine blasse Karte noch hat.
 */
function detailLine(item: ProposalItem): string {
  if (item.status === "uebernommen") return "Übernommen";
  if (item.status === "verworfen") return "Verworfen";

  return payloadLine(item.kind, item.payload);
}

function payloadLine(kind: ProposalKind, payload: ProposalPayload): string {
  if (kind === "themen") {
    return (payload as { titel: string[] }).titel.join(" · ");
  }

  if (kind === "hausaufgabe") {
    const { titel, faellig } = payload as { titel: string; faellig: string | null };
    return faellig
      ? `${titel} · fällig ${formatGerman(faellig, "kurz")}`
      : titel;
  }

  const { titel, themen } = payload as { titel: string | null; themen: string[] };
  return [titel, themen.join(" · ")].filter(Boolean).join(" · ") || "ohne Themen";
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 text-subtle"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
