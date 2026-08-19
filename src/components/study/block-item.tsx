"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Ein Lernblock als abhakbare Zeile.
 *
 *   <ul className="divide-y divide-border">
 *     <BlockItem
 *       topic="Ableitungen"
 *       minutes={25}
 *       kind="learn"
 *       done={false}
 *       color={subjectColor(subject.color).hex}
 *       subjectName="Mathe"
 *       toggle={setBlockStatusAction.bind(null, examId, block.id, "done")}
 *     />
 *   </ul>
 *
 * Die Zeile bringt ihr eigenes <li> und ihr eigenes Formular mit und gehört
 * deshalb in eine Liste. Der ganze Streifen ist der Knopf — auf dem Handy
 * trifft man so nicht daneben.
 *
 * subjectName bleibt weg, wo das Fach schon in der Überschrift steht; auf der
 * Startseite stehen mehrere Fächer untereinander und brauchen es.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type SubmitButtonProps = {
  children: ReactNode;
  variant?: ButtonProps["variant"];
  className?: string;
};

/**
 * Knopf, der von selbst merkt, dass sein Formular gerade läuft. Steht hier,
 * weil ihn alle Lernplan-Ansichten brauchen und useFormStatus nur in einer
 * Browser-Komponente funktioniert.
 */
export function SubmitButton({
  children,
  variant,
  className,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      loading={pending}
      className={className}
    >
      {children}
    </Button>
  );
}

export type BlockItemProps = {
  /** Titel des Themas; null bei einer Wiederholung ohne einzelnes Thema */
  topic: string | null;
  minutes: number;
  kind: "learn" | "review";
  done: boolean;
  /** Farbe des Fachs als Hex-Wert — färbt den Haken */
  color: string;
  /** Nur setzen, wo Blöcke mehrerer Fächer untereinanderstehen */
  subjectName?: string;
  /** Hakt ab oder nimmt zurück, je nachdem wie der Block gerade steht */
  toggle: () => Promise<void>;
};

export function BlockItem({ toggle, ...block }: BlockItemProps) {
  return (
    <li>
      <form action={toggle}>
        <BlockRow {...block} />
      </form>
    </li>
  );
}

function BlockRow({
  topic,
  minutes,
  kind,
  done,
  color,
  subjectName,
}: Omit<BlockItemProps, "toggle">) {
  const { pending } = useFormStatus();

  const title = topic ?? "Gesamtwiederholung";
  // Ohne eigenes Thema wäre "wiederholen" nur eine Doppelung des Titels.
  const meta = [subjectName, topic ? KIND_LABELS[kind] : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="submit"
      aria-busy={pending || undefined}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left",
        "transition-colors hover:bg-surface-muted",
        pending && "opacity-60",
      )}
    >
      <span className="sr-only">
        {done ? "Wieder offen setzen:" : "Als erledigt abhaken:"}
      </span>

      <span
        aria-hidden="true"
        style={
          done
            ? ({ backgroundColor: color, borderColor: color } as CSSProperties)
            : undefined
        }
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          done ? "text-accent-foreground" : "border-border-strong text-transparent",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 13 4 4 10-10" />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[0.9375rem]",
            done ? "text-muted line-through" : "text-foreground",
          )}
        >
          {title}
        </span>
        {meta ? (
          <span className="mt-0.5 block truncate text-sm text-subtle">
            {meta}
          </span>
        ) : null}
      </span>

      <span className="shrink-0 text-sm tabular-nums text-muted">
        {minutes} min
      </span>
    </button>
  );
}

const KIND_LABELS: Record<"learn" | "review", string> = {
  learn: "lernen",
  review: "wiederholen",
};
