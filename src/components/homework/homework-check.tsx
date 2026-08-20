"use client";

import { useFormStatus } from "react-dom";

import { setHomeworkDoneAction } from "@/app/(app)/hausaufgaben/actions";

/**
 * Das Kästchen, mit dem eine Hausaufgabe abgehakt wird.
 *
 *   <HomeworkCheck
 *     id={item.id}
 *     done={item.done}
 *     label={`${item.subject.name}: ${item.title}`}
 *   />
 *
 * Es bringt sein eigenes Formular mit und steckt deshalb bewusst **nicht** in
 * einem Link: auf der Startseite und im Dashboard steht daneben ein Link auf
 * die Aufgabe, und ein Formular in einem Link ergäbe ungültiges HTML. Die
 * Action liegt im Hausaufgaben-Bereich und frischt „/“ mit auf — abgehakt wird
 * von überall her.
 *
 * Nur das Kästchen ist 22px klein; die Trefferfläche darum ist größer, damit
 * man es unterwegs mit dem Daumen trifft.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type HomeworkCheckProps = {
  id: string;
  done: boolean;
  /**
   * Woran man die Aufgabe erkennt, z.B. „Mathematik: S. 42 Nr. 3–7“. Daraus
   * wird das aria-label — zu sehen ist ja nur ein leeres Kästchen.
   */
  label: string;
  /** „md“ in der Hausaufgabenliste, „sm“ in engen Listen wie dem Dashboard. */
  size?: "sm" | "md";
};

export function HomeworkCheck({
  id,
  done,
  label,
  size = "md",
}: HomeworkCheckProps) {
  return (
    // display:contents — das Formular trägt nur die Action und soll das
    // Layout der Zeile, in der es steht, nicht anfassen.
    <form
      action={setHomeworkDoneAction.bind(null, id, !done)}
      className="contents"
    >
      <CheckButton done={done} label={label} size={size} />
    </form>
  );
}

/**
 * Der Knopf steht eine Ebene tiefer, weil useFormStatus nur innerhalb des
 * Formulars sieht, ob gerade gespeichert wird.
 */
function CheckButton({
  done,
  label,
  size,
}: {
  done: boolean;
  label: string;
  size: "sm" | "md";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      // Zwei Beschriftungen für zwei Richtungen — „Kontrollkästchen“ sagt der
      // Vorleser nicht, es ist ein Knopf.
      aria-label={done ? `${label} wieder öffnen` : `${label} abhaken`}
      aria-busy={pending || undefined}
      className={cn(
        // p-3 macht aus 22px eine Trefferfläche von 46px, -m-3 nimmt den
        // zusätzlichen Platz im Layout wieder zurück: gezeichnet wird nur das
        // Kästchen, getroffen wird die ganze Ecke.
        "-m-3 flex shrink-0 items-center justify-center p-3",
        pending && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-[7px] border-[1.5px]",
          "border-border-strong leading-none text-accent",
          size === "sm" ? "size-5 text-xs" : "size-[22px] text-[13px]",
        )}
      >
        {done ? "✓" : null}
      </span>
    </button>
  );
}
