import Link from "next/link";

import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import type { MaterialListItem } from "@/lib/materials";

/**
 * Die Ablage als Liste — reine Anzeige, deshalb eine Server Component.
 *
 * Jede Zeile führt an genau eine Stelle: auf das Blatt. Anders als in der
 * Aufgabenliste gibt es hier nichts, was man von der Liste aus tut, also steckt
 * auch nichts im Link drin, was ein zweites Ziel hätte.
 *
 * Vorne steht das Vorschaubild. Es ist der Grund, warum diese Liste anders
 * aussieht als die übrigen des Projekts: ein abfotografiertes Blatt erkennt man
 * am Bild wieder und nicht am Titel — „Blatt vom 21.8.“ heißen sie am Anfang
 * alle. Das Bild kommt aus dem Route Handler und bekommt feste Maße mit; ohne
 * sie stünde die Liste beim Laden zwölfmal auf und die Zeile, die man antippen
 * wollte, wäre inzwischen woanders. Ein gewöhnliches <img> und nicht
 * next/image: die Bildoptimierung schickt keine Cookies mit und bekäme vom
 * Handler zu Recht ein Nein.
 *
 * Die Zahl der Seiten steht erst ab zwei da. „1 Seite“ stünde an fast jeder
 * Zeile und sagte damit nichts mehr.
 */

/** Das Vorschaubild im Listenformat: hochkant, so wie ein Blatt liegt. */
const COVER_WIDTH = 48;
const COVER_HEIGHT = 64;

export type MaterialListProps = {
  /** Die Blätter in der Reihenfolge der Datenschicht: das neueste zuerst. */
  items: MaterialListItem[];
};

export function MaterialList({ items }: MaterialListProps) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
      {items.map((item) => (
        <MaterialRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function MaterialRow({ item }: { item: MaterialListItem }) {
  const color = subjectColor(item.subject.color);

  return (
    <li>
      <Link
        href={`/material/${item.id}`}
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
      >
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

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {item.title}
          </span>

          <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <span
              aria-hidden="true"
              style={{ backgroundColor: color.hex }}
              className="size-2.5 shrink-0 rounded-full"
            />
            <span className="truncate">
              {[
                item.subject.short,
                formatGerman(item.capturedOn, "kurz"),
                item.pageCount > 1 ? `${item.pageCount} Seiten` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>

          {item.topics.length > 0 ? (
            <span className="mt-0.5 block truncate text-sm text-subtle">
              {item.topics.map((topic) => topic.title).join(" · ")}
            </span>
          ) : null}
        </span>

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
      </Link>
    </li>
  );
}
