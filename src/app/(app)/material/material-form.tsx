"use client";

import {
  Fragment,
  useActionState,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Subject } from "@/db/schema";
import { formatGerman } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import type {
  MaterialFormState,
  MaterialPageInfo,
  MaterialTopicRef,
} from "@/lib/materials";
import type { TopicItem } from "@/lib/subject-topics";
import { TOPIC_MAX_LENGTH, topicKey } from "@/lib/topics";
import {
  splitTranscript,
  transcriptBaseline,
  transcriptBaselineFieldName,
  transcriptFieldId,
  transcriptFieldName,
  transcriptPreview,
  uncertainSpans,
} from "@/lib/transcripts";

/**
 * Alles, was auf der Seite eines Blattes angefasst wird: die Seiten mit ihrem
 * Löschknopf, das Formular darunter und ganz unten das Löschen des Blattes.
 *
 * Drei Bauteile in einer Datei, weil sie zusammen eine Seite ergeben und jedes
 * für sich zu klein ist — so wie homework-form.tsx das Formular und seine
 * Gefahrenzone zusammenhält.
 *
 * Das Formular schickt ab und bleibt, wo es ist. Anders als bei Aufgaben und
 * Prüfungen gibt es hier kein „Abbrechen“ und keine Rückkehr zur Liste: die
 * Seite des Blattes ist der Ort, an dem man das Blatt ansieht, und das
 * Richtigstellen ist ein Nebenher. Deshalb steht nach dem Speichern eine
 * ruhige Bestätigung da statt einer Weiterleitung.
 *
 * Die Themen funktionieren wie die einer Prüfung (siehe topic-input.tsx unter
 * /klausuren): ein Feld, ein Thema, Enter bestätigt, darunter das Vokabular
 * des Fachs als antippbare Chips. Getippt wird selten; angetippt oft.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const EMPTY_STATE: MaterialFormState = {};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** „Mittwoch, 14. September“ — oder nichts, solange das Feld leer ist. */
function dayLabel(date: string): string | null {
  if (!ISO_DATE.test(date)) return null;

  try {
    return formatGerman(date);
  } catch {
    // Ein Datum wie 2026-02-31 kommt hier an, bevor zod es abfängt.
    return null;
  }
}

/** Knopf, der von selbst merkt, dass sein Formular gerade läuft. */
function SubmitButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

/* -------------------------------------------------------------------------
   Die Seiten
   ------------------------------------------------------------------------- */

/**
 * Eine Seite samt dem, was wörtlich auf ihr steht.
 *
 * `MaterialPageInfo` trägt aus gutem Grund nur die LÄNGE der Abschrift
 * (`transcriptLength`) — der Volltext wären zwölfmal 8000 Zeichen an jeder
 * Abfrage, und `read_sheet` gäbe ihn an den Agenten weiter (die Begründung
 * steht ausführlich am Typ in @/lib/materials). Wo ein Mensch die Abschrift
 * lesen oder ändern soll, führt kein Weg daran vorbei: dann holt die Seite den
 * Wortlaut über `listMaterialTranscripts()` — die eine Tür dafür — und hängt
 * ihn hier an.
 *
 * `null` heißt „diese Seite hat noch niemand gelesen", der leere String heißt
 * „gelesen, und es stand nichts darauf". Kein `?? ""` unterwegs: der
 * Unterschied trägt bis in die Spalte `material_pages.transcript`.
 */
export type MaterialPageWithTranscript = MaterialPageInfo & {
  transcript: string | null;
};

/** Eine Seite mit der Action, die genau sie löscht. */
export type MaterialPageView = MaterialPageWithTranscript & {
  deleteAction: () => Promise<void>;
};

export type MaterialPagesProps = {
  /** Die Seiten in ihrer Reihenfolge, wie sie aus der Datenschicht kommen. */
  pages: MaterialPageView[];
  /** Der Titel des Blattes — er steht in der Bildbeschreibung. */
  title: string;
};

/**
 * Die Seiten des Blattes, groß und untereinander.
 *
 * Feste Maße an jedem Bild, damit die Seite beim Laden nicht springt; die
 * Zahlen stehen in der Datenbank, weil der Browser sie beim Aufnehmen gezählt
 * hat. Ein gewöhnliches <img> und nicht next/image: die Bilder kommen aus
 * einem eigenen Route Handler, der die Sitzung prüft, und die Bildoptimierung
 * schickt keine Cookies mit.
 *
 * Der Löschknopf steht unter dem Bild und ist leise. Er fragt trotzdem nach —
 * eine abfotografierte Tafel ist eine Woche später nicht noch einmal
 * aufzunehmen.
 */
export function MaterialPages({ pages, title }: MaterialPagesProps) {
  return (
    <div className="space-y-6">
      {pages.map((page, index) => (
        <div key={page.id} className="space-y-2">
          <figure className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache */}
            <img
              src={`/api/material/${page.id}`}
              alt={`Seite ${index + 1} von ${title}`}
              width={page.width}
              height={page.height}
              loading="lazy"
              decoding="async"
              className="h-auto w-full rounded-card border border-border bg-surface-muted"
            />

            <figcaption className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-sm text-muted">
                {`Seite ${index + 1} von ${pages.length} · ${formatBytes(page.byteSize)}`}
              </span>

              {/* Die letzte Seite bekommt keinen Knopf: ein Blatt ohne Seite
                  wäre ein Titel und sonst nichts. Wer es loswerden will, löscht
                  das Blatt — das steht weiter unten und fragt anders. */}
              {pages.length > 1 ? (
                <PageDelete
                  label={`Seite ${index + 1}`}
                  deleteAction={page.deleteAction}
                />
              ) : (
                <span className="text-sm text-subtle">
                  Die einzige Seite bleibt stehen.
                </span>
              )}
            </figcaption>
          </figure>

          {/* Die Abschrift steht UNTER ihrer Seite und nicht in einem eigenen
              Abschnitt weiter unten. Sie ist die Behauptung darüber, was auf
              genau diesem Bild zu lesen ist — geprüft wird sie nur, wenn beides
              zusammen dasteht. Eine Liste aller Abschriften am Seitenende wäre
              zwölf Texte ohne die Bilder dazu, und niemand liest zwölfmal hoch.

              Neben dem <figure> und nicht darin: eine <figcaption> muss das
              erste oder das letzte Kind ihrer Figur sein, und die Bildunterschrift
              mit dem Löschknopf gehört ans Bild. Ein <details> dazwischen hätte
              die Figur ungültig gemacht. */}
          <PageTranscript
            pageId={page.id}
            transcript={page.transcript}
            index={index + 1}
          />
        </div>
      ))}
    </div>
  );
}

/** Löschen mit einem Zwischenschritt, klein genug für eine Bildunterschrift. */
function PageDelete({
  label,
  deleteAction,
}: {
  label: string;
  deleteAction: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="text-danger hover:bg-danger-soft hover:text-danger"
        onClick={() => setConfirming(true)}
      >
        {`${label} löschen`}
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-foreground">Wirklich? Das bleibt weg.</span>

      <form action={deleteAction}>
        <SubmitButton variant="danger">Ja, löschen</SubmitButton>
      </form>

      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Doch nicht
      </Button>
    </span>
  );
}

/* -------------------------------------------------------------------------
   Die Abschrift
   ------------------------------------------------------------------------- */

/**
 * Das Dreieck vor einem <details>, das sich beim Aufklappen dreht.
 *
 * Es steht in dieser Datei noch einmal und nicht in @/components/ui. Dieselben
 * fünfzehn Zeilen stehen in topic-list.tsx und auf der Vorschlagsseite — das
 * ist im Projekt die eingeführte Handhabung für ein Symbol, das sonst eine
 * eigene Datei und einen eigenen Namen bräuchte.
 */
function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90"
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

/** „2 unsicher“ — kurz genug, dass es am Handy neben der Seitenzahl steht. */
function uncertainBadge(count: number): string {
  return count === 1 ? "1 unsicher" : `${count} unsicher`;
}

/**
 * Eine Abschrift zum Lesen, mit den ⟨spitzen Klammern⟩ hervorgehoben.
 *
 * **Hervorgehoben und nicht verändert.** Die Klammern bleiben stehen, der Text
 * dazwischen bleibt stehen, die Reihenfolge bleibt stehen — `splitTranscript()`
 * zerlegt nur, und aneinandergehängt ergibt das Ergebnis wieder genau die
 * Eingabe. Das ist der Punkt: die Stellen, an denen sich das Modell selbst
 * nicht sicher war, sind genau die, die ein Mensch ansehen soll, und eine
 * Anzeige, die dafür am Text zupft, hätte den Menschen um das gebracht, was er
 * ansehen wollte.
 *
 * `whitespace-pre-wrap`, weil eine Abschrift ihre Zeilen hat: ein
 * Tafelanschrieb ist untereinander geschrieben und nicht als Fließtext.
 * `break-words` dazu, weil in einer Formel eine „Wortgrenze“ vorkommen kann,
 * die hundert Zeichen weit weg ist — ohne das schöbe eine einzige lange Zeile
 * die ganze Seite seitwärts.
 */
function TranscriptText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
      {splitTranscript(text).map((part, index) =>
        part.uncertain ? (
          // Der Index als Schlüssel ist hier der richtige: die Liste ist aus
          // dem Text gerechnet, ihre Stücke haben keine eigene Identität, und
          // ihre Stelle IST ihre Identität.
          <mark
            key={index}
            className="rounded-control bg-warning/25 px-0.5 text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </p>
  );
}

/**
 * Die Abschrift unter dem Bild ihrer Seite — auf der Blattseite, zum Lesen.
 *
 * Zugeklappt, und das ist gegen den ersten Reflex. Wer eine Blattseite öffnet,
 * kommt wegen der Bilder; zwölf Textblöcke dazwischen machen aus einer Seite,
 * die man durchscrollt, eine, durch die man sich arbeitet. Wer den Text will,
 * ist einen Tipp entfernt — und die Zahl der unsicheren Stellen steht schon an
 * der zugeklappten Zeile, damit man nicht erst aufklappen muss, um zu sehen,
 * ob es etwas zu sehen gibt.
 *
 * **Ohne Abschrift steht hier gar nichts**, und zwar für BEIDE leeren
 * Zustände. Das ist eine Abwägung und keine Vergesslichkeit: „noch niemand
 * gelesen" und „gelesen, nichts darauf" sind zwei verschiedene Zustände, aber
 * unter einem Bild sind sie zwei Sätze über etwas, das man dort gerade nicht
 * vorhat. Ein Blatt, das der Postbote noch nie gesehen hat, trüge sonst unter
 * jeder seiner zwölf Seiten dieselbe Zeile — die App nähme einer Ansicht, die
 * Bilder zeigt, den Platz weg, um über eine Funktion zu reden, die niemand
 * aufgerufen hat. Verloren geht der Unterschied dadurch nicht: das Formular
 * weiter unten steht auf derselben Seite, nennt ihn je Seite und schreibt
 * dazu, was das Speichern daraus macht.
 */
function PageTranscript({
  pageId,
  transcript,
  index,
}: {
  pageId: string;
  transcript: string | null;
  /** Die Nummer der Seite, wie sie über dem Bild steht — von 1 an. */
  index: number;
}) {
  if (transcript === null || transcript === "") return null;

  const marks = uncertainSpans(transcript);

  return (
    <details className="group rounded-control border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <Chevron />

        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
          Abschrift
        </span>

        {marks.length > 0 ? (
          <span className="shrink-0 rounded-pill bg-warning/25 px-2 py-0.5 text-xs text-foreground">
            {uncertainBadge(marks.length)}
          </span>
        ) : null}
      </summary>

      <div className="space-y-3 border-t border-border p-3.5">
        <TranscriptText text={transcript} />

        {/* Der Weg zum Feld, in dem sie sich ändern lässt. Er zeigt auf die id
            des Textfeldes selbst und nicht auf den Abschnitt: liegt das Feld in
            einem zugeklappten <details>, klappen die heutigen Browser es beim
            Sprung von sich aus auf. Wo sie das nicht tun, landet man immer noch
            im richtigen Abschnitt — das ist der schlechtere, aber kein
            kaputter Ausgang.

            Die Seitenzahl hängt still daran: auf dem Bildschirm steht sie
            direkt darüber, wer aber die Links einer Seite durchgeht, hörte
            sonst zwölfmal denselben Satz. */}
        <a
          href={`#${transcriptFieldId(pageId)}`}
          className="inline-flex min-h-11 items-center text-sm text-accent transition-colors hover:text-accent-hover"
        >
          Diese Abschrift ändern
          <span className="sr-only">{`, Seite ${index}`}</span>
        </a>
      </div>
    </details>
  );
}

/**
 * Eine Seite mit ihrer Abschrift, so wie das Formular sie vorlegt.
 *
 * `transcript` ist, was am Blatt GESPEICHERT steht. `prefill` ist, was im Feld
 * STEHEN WIRD. Auf der Blattseite sind beide gleich; auf der Seite eines
 * Vorschlags ist `prefill` das, was der Vorschlag sagt — und der Unterschied
 * zwischen beiden ist genau die Gegenüberstellung, die je Seite unter dem Feld
 * als Satz steht. Ein einzelnes Feld hätte diesen Satz nicht tragen können.
 */
export type MaterialFormPage = MaterialPageWithTranscript & {
  /**
   * Womit das Feld vorbelegt wird.
   *
   * NULL heißt „diese Seite hat noch niemand gelesen“, der leere String heißt
   * „gelesen, und es stand nichts darauf“. Der Unterschied trägt bis in die
   * Datenbank (siehe `material_pages.transcript` in src/db/schema.ts) und darf
   * hier nicht eingeebnet werden — auch nicht mit einem beiläufigen `?? ""`.
   */
  prefill: string | null;
};

/**
 * Der Satz unter einem Abschriftfeld: was dort gerade steht und was das
 * Absenden daraus macht.
 *
 * Vier Fälle, und drei davon gäbe es ohne die Unterscheidung zwischen NULL und
 * leerem String gar nicht. Der fünfte — der Vorschlag sagt zu dieser Seite
 * dasselbe wie das Blatt — bekommt bewusst gar keinen Satz: an zwölf Seiten
 * zwölfmal „stimmt so“ zu lesen, macht die eine Seite unsichtbar, an der etwas
 * steht.
 */
function transcriptHint(page: MaterialFormPage): string | undefined {
  // Der Vorschlag sagt „ich habe hingesehen, da steht nichts“ — und das sieht
  // im leeren Feld genauso aus wie „ich habe nicht hingesehen“. Ohne diesen
  // Satz wäre die Aussage des Agenten auf dem Bildschirm nicht vorhanden.
  if (page.prefill === "" && page.transcript === null) {
    return "Der Agent hat diese Seite gelesen und nichts darauf gefunden. Bleibt das Feld leer, steht das danach so am Blatt.";
  }

  if (page.prefill !== page.transcript) {
    return page.transcript === null
      ? "Vorgeschlagen. Am Blatt steht zu dieser Seite bisher nichts."
      : "Vorgeschlagen. Am Blatt steht zu dieser Seite schon eine andere Abschrift — diese hier ersetzt sie.";
  }

  if (page.transcript === null) {
    return "Diese Seite hat noch niemand gelesen. Bleibt das Feld leer, bleibt es dabei.";
  }

  if (page.transcript === "") {
    return "Gelesen, und es stand nichts darauf. Bleibt das Feld leer, steht das danach immer noch so da.";
  }

  return undefined;
}

type TranscriptFieldProps = {
  page: MaterialFormPage;
  /** Die Nummer der Seite, wie sie über dem Bild steht — von 1 an. */
  index: number;
  total: number;
  /** Was im Feld steht: das Getippte, sonst die Vorbelegung. */
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (text: string) => void;
};

/**
 * Eine Seite: zugeklappt eine Zeile, aufgeklappt Bild und Feld nebeneinander.
 *
 * **Zwölf Textfelder untereinander wären die naheliegende und die falsche
 * Lösung.** Ein Blatt hat bis zu zwölf Seiten (`MAX_PAGES`), und ein Feld mit
 * zehn Zeilen ist am Handy fast ein Bildschirm hoch — zwölf davon sind zwölf
 * Bildschirme, durch die man scrollt, um an den Knopf darunter zu kommen. Was
 * man dabei sucht, ist fast immer EINE Seite: die, an der etwas nicht stimmt.
 *
 * Zugeklappt steht deshalb je Seite eine Zeile mit dem Vorschaubild und der
 * ersten Zeile der Abschrift — daran erkennt man eine Seite wieder, ohne sie zu
 * öffnen. Aufgeklappt steht das Seitenbild in voller Größe daneben, denn eine
 * Abschrift prüft man nicht für sich, sondern gegen das Bild. Am Handy
 * untereinander (Bild oben, Feld darunter, eine kurze Daumenbewegung
 * dazwischen), ab `lg` nebeneinander.
 *
 * Das Vollbild hängt in einem zugeklappten <details> und trägt `loading="lazy"`
 * — es wird also erst geholt, wenn jemand die Seite aufklappt. Ohne das lüde
 * diese Seite zwölf Vollbilder für eine Frage, die meistens eine einzige Seite
 * betrifft.
 *
 * Das <details> ist gesteuert (`open` + `onToggle`) und nicht sich selbst
 * überlassen: nur so lässt sich „alle aufklappen“ anbieten, und nur so steht
 * beim Aufschlagen der Seite offen, was offen stehen soll.
 */
function TranscriptField({
  page,
  index,
  total,
  value,
  open,
  onOpenChange,
  onChange,
}: TranscriptFieldProps) {
  /* Aus dem FELDINHALT gerechnet und nicht aus der Vorbelegung — deshalb
     verschwindet ein Ausschnitt aus dieser Liste in dem Moment, in dem jemand
     die Klammer im Feld darunter auflöst. Das ist die Rückmeldung, die das
     Korrigieren überhaupt erträglich macht: man sieht, dass man fertig ist.
     Der Preis ist ein regulärer Ausdruck über höchstens 8000 Zeichen je
     Tastendruck, und der ist nicht messbar. */
  const marks = uncertainSpans(value);
  const preview = transcriptPreview(value);
  const hint = transcriptHint(page);

  return (
    <li>
      <details
        open={open}
        onToggle={(event) => onOpenChange(event.currentTarget.open)}
        className="group rounded-control border border-border bg-surface-muted"
      >
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-2.5 transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
          <Chevron />

          {/* eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache */}
          <img
            src={`/api/material/${page.id}/vorschau`}
            /* Die Seitenzahl steht als Text direkt daneben — das Bild noch
               einmal zu beschreiben, hieße jede Zeile doppelt vorzulesen. */
            alt=""
            width={36}
            height={48}
            loading="lazy"
            decoding="async"
            className="h-12 w-9 shrink-0 rounded-control border border-border bg-surface object-cover"
          />

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              {`Seite ${index} von ${total}`}
            </span>

            {/* Die erste Zeile der Abschrift — oder, wenn keine dasteht, der
                Grund dafür. „Noch nicht gelesen“ und „Nichts darauf“ sind
                zwei verschiedene Zustände und dürfen an der zugeklappten
                Zeile nicht gleich aussehen. */}
            <span className="block truncate text-sm text-muted">
              {preview !== ""
                ? preview
                : page.prefill === null
                  ? "Noch nicht gelesen"
                  : "Nichts darauf"}
            </span>
          </span>

          {marks.length > 0 ? (
            <span className="shrink-0 rounded-pill bg-warning/25 px-2 py-0.5 text-xs text-foreground">
              {uncertainBadge(marks.length)}
            </span>
          ) : null}
        </summary>

        <div className="border-t border-border bg-surface p-3 sm:p-4">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache */}
            <img
              src={`/api/material/${page.id}`}
              alt={`Seite ${index} von ${total}`}
              width={page.width}
              height={page.height}
              loading="lazy"
              decoding="async"
              className="h-auto w-full rounded-control border border-border bg-surface-muted"
            />

            <div className="space-y-3">
              {/* Die unsicheren Stellen, ausgeschnitten und hervorgehoben.

                  Sie stehen ÜBER dem Feld und nicht im Feld, weil in einem
                  <textarea> nichts hervorgehoben werden kann — dort liegt
                  reiner Text, und genau das soll dort liegen. Diese Liste ist
                  deshalb keine zweite Fassung der Abschrift, sondern ein
                  Verzeichnis: sie sagt, wonach zu suchen ist. Gesucht wird dann
                  im Feld, und weil die Klammern dort mit drinstehen, findet
                  auch die Suchfunktion des Browsers sie. */}
              {marks.length > 0 ? (
                <div className="space-y-1.5 rounded-control border border-border bg-surface-muted p-3">
                  <p className="text-sm text-muted">Unsicher gelesen:</p>

                  <ul className="flex flex-wrap gap-1.5">
                    {marks.map((mark, position) => (
                      <li key={`${position}-${mark}`}>
                        <mark className="inline-block max-w-full truncate rounded-pill bg-warning/25 px-2 py-0.5 text-sm text-foreground">
                          {mark}
                        </mark>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Das Label nennt die Seite mit. Auf dem Bildschirm steht die
                  Zahl damit zweimal — einmal in der Zeile darüber, einmal hier
                  —, und wer vorgelesen bekommt, hört sie genau einmal an der
                  Stelle, an der sie zählt: „Abschrift, Seite 7, Textfeld“.
                  Zwölf Felder, die alle „Abschrift“ heißen, wären nicht
                  auseinanderzuhalten. */}
              <Field
                id={transcriptFieldId(page.id)}
                label={`Abschrift, Seite ${index}`}
                optional
                hint={hint}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    /* Die id der Seite steckt im Feldnamen und nicht in einem
                       zweiten, versteckten Feld daneben; warum, steht an
                       `transcriptFieldName()` in @/lib/transcripts. Wird eine
                       Seite zwischen Anzeigen und Absenden gelöscht, kommt hier
                       ein Name an, den es nicht mehr gibt — die Server Action
                       geht über die Seiten des Blattes und übersieht ihn dabei
                       einfach. */
                    name={transcriptFieldName(page.id)}
                    rows={10}
                    /* Die Grenze selbst steht als `MATERIAL_TRANSCRIPT_MAX` im
                       Prüfschema in @/lib/materials; hier ist sie nur die
                       Bremse im Feld. Der Wert steht als Zahl da, weil
                       @/lib/materials die Datenbank mitbringt und in einer
                       Client-Komponente nichts zu suchen hat — dieselbe
                       Handhabung wie die 80 am Titelfeld weiter unten. */
                    maxLength={8000}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    /* Eine Abschrift ist voller Fachwörter, Formelzeichen und
                       Abkürzungen. Eine rote Wellenlinie unter jedem zweiten
                       Wort macht aus der Prüfung, ob der Text stimmt, die
                       Frage, welche der vierzig Meldungen gemeint sein könnte. */
                    spellCheck={false}
                  />
                )}
              </Field>

              {/* Worauf sich das Feld darüber bezieht: der Stand, den diese
                  Seite beim Rendern in der Datenbank hatte.

                  Er wird aus `transcriptLength` gebaut und ausdrücklich nicht
                  aus `page.transcript.length` — die Zahl kommt aus Postgres'
                  `length()`, und die Server Action vergleicht sie gegen
                  dieselbe Quelle. Aus `page.prefill` darf er auch nicht kommen:
                  auf der Vorschlagsseite ist die Vorbelegung das, was der
                  Agent SAGT, und die Frage lautet, was am Blatt STEHT.

                  Ohne dieses Feld überschreibt ein Bildschirm, der vor einer
                  fremden Änderung gerendert wurde, eine frische Abschrift mit
                  dem leeren String — die ganze Begründung steht an
                  `transcriptBaselineFieldName()` in @/lib/transcripts. Es steht
                  hier als LETZTES Kind: `space-y-3` gibt jedem Kind ab dem
                  zweiten einen Abstand nach oben, und ein `type="hidden"` trägt
                  kein `hidden`-Attribut, zählt für diese Regel also mit. Stünde
                  es vorn, rutschte das Feld darunter an einer Seite ohne
                  unsichere Stellen um zwölf Pixel nach unten; hinten trifft der
                  Abstand ein Element, das der Browser gar nicht darstellt. */}
              <input
                type="hidden"
                name={transcriptBaselineFieldName(page.id)}
                value={transcriptBaseline(page.transcriptLength)}
              />
            </div>
          </div>
        </div>
      </details>
    </li>
  );
}

type TranscriptFieldsProps = {
  pages: MaterialFormPage[];
  /**
   * Nur, was der Nutzer geändert hat — Seite für Seite, nach id.
   *
   * Ausdrücklich nicht der volle Stand aller Seiten. Was hier NICHT drinsteht,
   * kommt beim Rendern aus `page.prefill`, also frisch vom Server. Der
   * Unterschied ist der ganze Grund, warum dieses Formular keinen `key` über
   * die Abschriften braucht: ein Feld, das niemand angefasst hat, folgt einer
   * geänderten Vorbelegung von selbst.
   */
  values: Record<string, string>;
  onChange: (pageId: string, text: string) => void;
};

/**
 * Die Abschrift des ganzen Blattes, Seite für Seite.
 *
 * Ein <fieldset> mit <legend> und keine Überschrift: das hier ist eine Gruppe
 * von Feldern in einem Formular, und genau dafür gibt es die beiden Elemente.
 * Ein <h2> hätte auf der Blattseite eine Ebene übersprungen (dort gibt es
 * sonst keine) und auf der Vorschlagsseite unter „Übernehmen“ gehangen — zwei
 * verschiedene Gliederungen für dasselbe Bauteil.
 *
 * Offen steht beim Aufschlagen, was ein Mensch wirklich ansehen soll — und das
 * ist ausdrücklich NICHT alles, was der Vorschlag mitbringt:
 *
 * - jede Seite mit ⟨spitzen Klammern⟩. Dort war sich das Modell selbst nicht
 *   sicher, und genau deshalb sieht ein Mensch hin.
 * - jede Seite, an der eine Abschrift eine ANDERE ersetzt. Etwas, das schon
 *   dastand, verschwindet — das darf nicht hinter einer zugeklappten Zeile
 *   passieren.
 * - bei einem einseitigen Blatt die eine Seite; dort ist Zuklappen nur ein
 *   Tipp mehr.
 *
 * Eine Seite, auf der zum ersten Mal etwas steht, bleibt dagegen zu, und das
 * ist der Fall, der sonst alles gekippt hätte: der Postbote schreibt ein
 * frisches Blatt in einem Zug ab, also wäre an ZWÖLF Seiten etwas anderes als
 * am Blatt — zwölf Vollbilder und zwölf zehnzeilige Felder auf einem
 * Handybildschirm, genau die Zumutung, gegen die diese Bauweise steht.
 * Zugeklappt steht dort die erste Zeile der Abschrift, und ein Tipp öffnet sie.
 */
function TranscriptFields({ pages, values, onChange }: TranscriptFieldsProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const start = new Set<string>();

    for (const page of pages) {
      const ersetzt =
        page.transcript !== null && page.prefill !== page.transcript;

      if (
        pages.length === 1 ||
        ersetzt ||
        uncertainSpans(page.prefill ?? "").length > 0
      ) {
        start.add(page.id);
      }
    }

    return start;
  });

  function setOpenFor(pageId: string, isOpen: boolean) {
    setOpen((current) => {
      // Das <details> meldet auch dann, wenn sich nichts geändert hat. Ohne
      // diese Zeile stieße jede Meldung ein neues Set an und damit ein Rendern
      // aller offenen Felder.
      if (current.has(pageId) === isOpen) return current;

      const next = new Set(current);
      if (isOpen) next.add(pageId);
      else next.delete(pageId);

      return next;
    });
  }

  const allOpen = pages.every((page) => open.has(page.id));

  // Über das ganze Blatt gezählt, aus den FELDINHALTEN — dieselbe Rechnung wie
  // je Seite, nur einmal weiter außen. Der Satz verschwindet damit, sobald die
  // letzte Klammer aufgelöst ist.
  const marks = pages.reduce(
    (sum, page) =>
      sum + uncertainSpans(values[page.id] ?? page.prefill ?? "").length,
    0,
  );

  return (
    <fieldset id="abschrift" className="min-w-0 space-y-3">
      <legend className="text-sm font-medium text-foreground">Abschrift</legend>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-sm text-muted">
          Was auf den Seiten steht, wörtlich. Gespeichert wird, was hier im Feld
          steht — lies es gegen das Bild daneben.
        </p>

        {pages.length > 1 ? (
          <button
            type="button"
            onClick={() =>
              setOpen(allOpen ? new Set() : new Set(pages.map((p) => p.id)))
            }
            className="inline-flex min-h-11 shrink-0 items-center text-sm text-accent transition-colors hover:text-accent-hover"
          >
            {allOpen ? "Alle zuklappen" : "Alle aufklappen"}
          </button>
        ) : null}
      </div>

      {/* Warum die Klammern dastehen, steht einmal für das ganze Blatt und
          nicht zwölfmal an jeder Seite. An der Seite steht dafür nur noch
          „Unsicher gelesen:“ und der Ausschnitt selbst. */}
      {marks > 0 ? (
        <p className="text-sm text-muted">
          {marks === 1
            ? "An einer Stelle war sich der Agent nicht sicher; sie steht in ⟨spitzen Klammern⟩ und ist unten hervorgehoben. Genau solche Stellen sind der Grund, warum ein Mensch das hier ansieht."
            : `An ${marks} Stellen war sich der Agent nicht sicher; sie stehen in ⟨spitzen Klammern⟩ und sind unten hervorgehoben. Genau solche Stellen sind der Grund, warum ein Mensch das hier ansieht.`}
        </p>
      ) : null}

      <ul className="space-y-2">
        {pages.map((page, position) => (
          <TranscriptField
            key={page.id}
            page={page}
            index={position + 1}
            total={pages.length}
            value={values[page.id] ?? page.prefill ?? ""}
            open={open.has(page.id)}
            onOpenChange={(isOpen) => setOpenFor(page.id, isOpen)}
            onChange={(text) => onChange(page.id, text)}
          />
        ))}
      </ul>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
   Die Themen
   ------------------------------------------------------------------------- */

/**
 * So viele Chips stehen unter dem Feld, bevor „Alle zeigen“ kommt. Zwölf sind
 * zwei bis drei Zeilen — so viel überfliegt man noch.
 */
const SUGGESTION_LIMIT = 12;

/** Groß- und Kleinschreibung macht kein zweites Thema. */
function isKnown(topics: string[], title: string): boolean {
  const key = topicKey(title);
  return topics.some((topic) => topicKey(topic) === key);
}

type TopicInputProps = {
  id: string;
  name: string;
  topics: string[];
  onTopicsChange: (topics: string[]) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

/**
 * Die Themenliste eines Blattes.
 *
 * Ein Feld, ein Thema: eintippen, Enter (oder „Hinzufügen“), fertig. Jedes
 * bestätigte Thema hängt als verstecktes Feld am Formular, und das Eingabefeld
 * trägt denselben Namen — was beim Abschicken noch darin steht, zählt dadurch
 * mit, auch wenn das Enter vergessen wurde.
 *
 * Anders als bei einer Prüfung sind die Themen hier nicht nummeriert: aus
 * ihnen wird kein Lernplan, sie sind Schlagworte. Deshalb steht die Liste als
 * Chips da und nicht als geordnete Aufzählung.
 */
function TopicInput({
  id,
  name,
  topics,
  onTopicsChange,
  ...control
}: TopicInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** Nimmt auch mehrere Zeilen auf einmal — das hilft beim Einfügen. */
  function add(text: string) {
    const next = [...topics];

    for (const line of text.split(/[\r\n]+/)) {
      const title = line.trim().slice(0, TOPIC_MAX_LENGTH);
      if (!title || isKnown(next, title)) continue;
      next.push(title);
    }

    setDraft("");
    if (next.length !== topics.length) onTopicsChange(next);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Ohne das schickt Enter das ganze Formular ab.
    event.preventDefault();
    add(draft);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    // Eine kopierte Liste wird zu mehreren Themen, nicht zu einer langen Zeile.
    event.preventDefault();
    add(`${draft}${text}`);
  }

  return (
    <div className="space-y-2">
      {topics.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <li key={topic}>
              <input type="hidden" name={name} value={topic} />

              <span className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-pill border border-accent bg-accent-soft py-1 pl-3.5 pr-1 text-sm font-medium text-accent">
                <span className="min-w-0 truncate">{topic}</span>

                <button
                  type="button"
                  onClick={() =>
                    onTopicsChange(topics.filter((item) => item !== topic))
                  }
                  aria-label={`${topic} entfernen`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-danger-soft hover:text-danger"
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
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Input
          {...control}
          ref={inputRef}
          id={id}
          name={name}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={topics.length === 0 ? "Kurvendiskussion" : "Nächstes Thema"}
          maxLength={TOPIC_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          className="flex-1"
        />

        <Button
          type="button"
          variant="secondary"
          onClick={() => add(draft)}
          disabled={draft.trim().length === 0}
        >
          Hinzufügen
        </Button>
      </div>
    </div>
  );
}

/**
 * Das Vokabular des Fachs als antippbare Chips: antippen fügt hinzu, nochmal
 * antippen nimmt wieder weg.
 *
 * Verglichen wird über `topicKey()` und nicht über `===` — sonst zeigte ein
 * Chip „nicht gewählt“ für ein Thema, das mit anderer Schreibweise längst in
 * der Liste steht. Es ist dieselbe Faltung, mit der `normalizeTopics()` beim
 * Speichern Dubletten wegwirft.
 *
 * Hat das Fach kein Vokabular, steht hier gar nichts. Woher Themen kommen,
 * erklärt die Themenpflege am Fach.
 */
function TopicSuggestions({
  suggestions,
  topics,
  onTopicsChange,
}: {
  suggestions: TopicItem[];
  topics: string[];
  onTopicsChange: (topics: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (suggestions.length === 0) return null;

  const chosen = new Set(topics.map(topicKey));
  const visible = showAll ? suggestions : suggestions.slice(0, SUGGESTION_LIMIT);

  function toggle(title: string) {
    const key = topicKey(title);

    onTopicsChange(
      chosen.has(key)
        ? topics.filter((topic) => topicKey(topic) !== key)
        : [...topics, title],
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap gap-2">
        {visible.map((topic) => {
          const isChosen = chosen.has(topicKey(topic.title));

          return (
            <button
              key={topic.id}
              type="button"
              aria-pressed={isChosen}
              onClick={() => toggle(topic.title)}
              className={cn(
                "inline-flex min-h-11 max-w-full items-center rounded-pill",
                "border px-3.5 py-1.5 text-left text-sm transition-colors",
                isChosen
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              {topic.title}
            </button>
          );
        })}
      </div>

      {!showAll && suggestions.length > SUGGESTION_LIMIT ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="inline-flex min-h-11 items-center text-sm text-accent transition-colors hover:text-accent-hover"
        >
          Alle zeigen
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Das Formular
   ------------------------------------------------------------------------- */

/** Für die Auswahl reicht, woran man ein Fach erkennt. */
export type MaterialFormSubject = Pick<Subject, "id" | "name">;

export type MaterialFormProps = {
  action: (
    state: MaterialFormState,
    formData: FormData,
  ) => Promise<MaterialFormState>;
  /** Nicht archivierte Fächer, dazu das eigene, falls es archiviert ist. */
  subjects: MaterialFormSubject[];
  /**
   * Je Fach sein Themen-Vokabular, auf dem Server vorgerechnet. Vorgerechnet,
   * weil sich das Fach im Formular ändern kann, während man tippt — eine
   * Abfrage pro Umschalten wäre der Preis dafür, dass die Chips immer exakt
   * zum Stand im Formular passen.
   */
  topicSuggestions: Record<string, TopicItem[]>;
  /** Das Blatt, wie es gespeichert ist. */
  item: {
    subjectId: string;
    title: string;
    capturedOn: string;
    note: string | null;
    topics: MaterialTopicRef[];
  };
  /**
   * Die Seiten des Blattes mit ihrer Abschrift.
   *
   * **Sie stehen in diesem Formular und nicht in einem eigenen daneben**, und
   * das ist keine Bequemlichkeit, sondern die Architekturregel: der Bestand hat
   * genau eine Tür. Ein zweites Formular für die Abschrift wäre ein zweiter
   * Weg, ein Blatt zu schreiben — und auf der Vorschlagsseite noch schlimmer:
   * das Übernehmen räumt alle Vorschläge des Blattes weg, ein getrennt
   * abgeschicktes zweites Formular käme also entweder zu spät (der Vorschlag
   * mit seiner Abschrift ist schon fort) oder zu früh (es schriebe in den
   * Bestand, bevor jemand übernommen hat).
   *
   * Pflichtangabe und nicht optional: es gibt heute zwei Stellen, an denen
   * dieses Formular steht, und beide kennen ihre Seiten. Eine dritte, die sie
   * vergisst, soll am Compiler scheitern und nicht daran, dass eine Abschrift
   * unbemerkt fehlt.
   */
  pages: MaterialFormPage[];
  /** Der heutige Kalendertag aus todayInBerlin(). */
  today: string;
  /**
   * Was auf dem Knopf steht. Ohne Angabe: „Änderungen speichern".
   *
   * Der Eingangskorb benutzt dasselbe Formular für die Bestätigung eines
   * Vorschlags — das ist die Zusage aus KONZEPT.md, dass alles, was ein Agent
   * vorschlägt, durch dieselbe Tür geht wie ein Formular. Dort heißt der
   * Knopf aber nicht „speichern", sondern „übernehmen": man bestätigt einen
   * Vorschlag, statt eine eigene Änderung abzulegen. Ein zweites Formular
   * dafür wäre eine zweite Tür in den Bestand gewesen, und genau die soll es
   * nicht geben — also ist es dieselbe, mit einer anderen Aufschrift.
   */
  submitLabel?: string;
};

export function MaterialForm({
  action,
  subjects,
  topicSuggestions,
  item,
  pages,
  today,
  submitLabel = "Änderungen speichern",
}: MaterialFormProps) {
  const savedTopics = item.topics.map((topic) => topic.title);

  const [subjectId, setSubjectId] = useState(item.subjectId);
  const [title, setTitle] = useState(item.title);
  const [capturedOn, setCapturedOn] = useState(item.capturedOn);
  const [note, setNote] = useState(item.note ?? "");
  const [topics, setTopics] = useState<string[]>(savedTopics);

  /**
   * Die Abschriften liegen anders im Zustand als alles andere in diesem
   * Formular, und der Unterschied ist Absicht.
   *
   * Titel, Fach, Tag und Notiz werden beim Aufbauen aus `item` in den Zustand
   * kopiert und folgen einer geänderten Prop danach nicht mehr — deshalb steht
   * über dem Formular auf der Vorschlagsseite ein `key`. Hier steht KEINE
   * Kopie: dieser Kasten hält ausschließlich das, was jemand getippt hat. Was
   * nicht darin steht, kommt beim Rendern aus `page.prefill`, also direkt vom
   * Server.
   *
   * Das löst gleich drei Dinge, für die es sonst je eine eigene Regel bräuchte:
   *
   * - Ändert sich die Vorbelegung (der Vorschlag wird unten geändert, ein
   *   anderes Gerät hat geschrieben), folgt jedes Feld, das niemand angefasst
   *   hat, von selbst. Alte Werte zurückzuschreiben ist damit nicht möglich.
   * - Kommt während des Tippens eine Seite dazu (der Auslöser auf der
   *   Blattseite), taucht sie mit ihrer eigenen Vorbelegung auf, ohne dass
   *   irgendein anderes Feld dabei zurückgesetzt wird.
   * - Fällt eine Seite weg, bleibt hier ein Eintrag stehen, den niemand mehr
   *   liest. Er wird nicht gerendert und nicht abgeschickt — die Felder
   *   entstehen aus `pages` und nicht aus diesem Kasten.
   */
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});

  function changeTranscript(pageId: string, text: string) {
    setTranscripts((current) => ({ ...current, [pageId]: text }));
  }

  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  /**
   * Nach dem Speichern steht in der Themenzeile, was am Blatt hängt — und
   * nicht mehr das, was getippt wurde.
   *
   * Solange getippt wird, ist `topics` der Stand des Nutzers und muss es
   * bleiben: folgte das Formular bei jedem Rendern dem Server, verschwände ein
   * gerade angefangener Chip unter der Hand. Nachgezogen wird deshalb genau
   * dann, wenn sich einer von zwei Werten ändert; beide stehen zusammen in
   * `savedMark`.
   *
   * - `state.saves` geht hoch, sobald geschrieben wurde. Das ist der Fall, in
   *   dem am Blatt alles beim Alten bleibt und der Bildschirm trotzdem falsch
   *   steht: „Übungen“ trägt kein Fachwort und wird nicht angelegt — der Chip
   *   behauptete danach ein Thema, das die Datenbank nicht kennt, und ein
   *   zweites Speichern schickte ihn beliebig oft wieder mit.
   * - Die Titel am Blatt ändern sich, sobald `revalidatePath` einen neuen
   *   Stand nachgeliefert hat. Zwei getippte Titel, die auf dieselbe Vokabel
   *   fallen („Kettenregel“ und „Kettenregel Übungen“), stehen danach als ein
   *   Chip da statt als zwei; und ein anderswo umbenanntes Thema steht unter
   *   seinem neuen Namen.
   *
   * Üblicherweise kommen Antwort und neuer Stand im selben Rendern an. Kämen
   * sie getrennt, zieht jedes Zeichen für sich nach — deshalb ein Wert und
   * nicht zwei Bedingungen.
   *
   * Gesetzt wird mitten im Rendern, mit dem alten Wert daneben zum Vergleichen.
   * Das ist der Weg, den React für „State beim Wechsel einer Prop anpassen“
   * vorsieht: der angefangene Durchlauf wird verworfen und sofort neu
   * gerendert, ohne dass dazwischen der falsche Stand auf dem Bildschirm steht.
   */
  const savedMark = [state.saves ?? 0, ...savedTopics].join("\n");
  const [lastMark, setLastMark] = useState(savedMark);

  if (lastMark !== savedMark) {
    setLastMark(savedMark);
    setTopics(savedTopics);

    /*
     * Und dasselbe für die Abschriften, nur andersherum: hier wird nichts
     * gesetzt, hier wird das Getippte WEGGEWORFEN. Danach zeigen die Felder
     * wieder `page.prefill`, also den Stand des Servers.
     *
     * Gebraucht wird das aus demselben Grund wie bei den Themen — was
     * gespeichert wurde, kann sich von dem unterscheiden, was getippt wurde.
     * Die Server Action schneidet die Ränder ab, und wer eine Abschrift aus
     * einer anderen Quelle hineinkopiert, kann über der Grenze liegen. Bliebe
     * das Feld danach auf dem getippten Text stehen, behauptete es eine
     * Abschrift, die am Blatt nicht steht — und der nächste Druck auf den Knopf
     * schickte sie beliebig oft wieder mit.
     *
     * `state.saves` allein wäre der genauere Auslöser gewesen; das Zeichen
     * enthält daneben die Themen. Das ist hier kein Schaden: es geht nur hoch,
     * wenn wirklich geschrieben wurde, und dann sollen ohnehin beide nachziehen.
     */
    setTranscripts({});
  }

  /**
   * Wechselt das Fach, fällt die Themenliste weg — und zwar sichtbar.
   *
   * Die Themen gehören dem Vokabular des alten Fachs: „Kettenregel“ ist ein
   * Thema von Mathematik, und an einem Blatt in Physik stünde es als Fremdwort
   * da. Die Datenschicht löst die Paarungen beim Fachwechsel deshalb auf; das
   * hier ist dieselbe Entscheidung, nur eine Sekunde früher und auf dem
   * Bildschirm zu sehen. Zurückgeschaltet stehen sie wieder da, solange nicht
   * gespeichert wurde.
   */
  function chooseSubject(nextId: string) {
    setSubjectId(nextId);
    setTopics(nextId === item.subjectId ? savedTopics : []);
  }

  const subjectChanged = subjectId !== item.subjectId;

  const topicHint = subjectChanged
    ? "Das Fach ist gewechselt — die Themen des alten Fachs bleiben dort stehen, an diesem Blatt fallen sie weg."
    : "Wonach du dieses Blatt später suchen würdest. Angetippt geht schneller als getippt.";

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.message ? (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      {/* Ein Erfolg wird nur mitgeteilt (role="status") und nicht gemeldet —
          sonst unterbricht jede Kleinigkeit den Vorleser mitten im Satz. */}
      {!state.message && state.notice ? (
        <p
          role="status"
          className="rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm text-foreground"
        >
          {state.notice}
        </p>
      ) : null}

      <Field id="title" label="Titel" error={state.errors?.title}>
        {(control) => (
          <Input
            {...control}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Arbeitsblatt Kurvendiskussion"
            // Die Grenze selbst steht im Prüfschema in @/lib/materials; hier
            // ist sie nur die Bremse im Feld. Der Wert steht als Zahl da, weil
            // @/lib/materials die Datenbank mitbringt und in einer Client-
            // Komponente nichts zu suchen hat.
            maxLength={80}
            autoComplete="off"
          />
        )}
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="subjectId" label="Fach" error={state.errors?.subjectId}>
          {(control) => (
            <Select
              {...control}
              name="subjectId"
              value={subjectId}
              onChange={(event) => chooseSubject(event.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="capturedOn"
          label="Vom"
          hint={dayLabel(capturedOn) ?? undefined}
          error={state.errors?.capturedOn}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              name="capturedOn"
              value={capturedOn}
              // Ein Blatt aus der Zukunft gibt es nicht — dasselbe sagt das
              // Prüfschema, hier steht es nur schon im Feld.
              max={today}
              onChange={(event) => setCapturedOn(event.target.value)}
            />
          )}
        </Field>
      </div>

      <Field
        id="themen"
        label="Themen"
        optional
        hint={topicHint}
        error={state.errors?.topics}
      >
        {(control) => (
          <>
            <TopicInput
              {...control}
              name="themen"
              topics={topics}
              onTopicsChange={setTopics}
            />

            {/* Das key am Fach setzt „Alle zeigen“ beim Fachwechsel zurück:
                aufgeklappt wurde die Liste des einen Fachs, nicht die des
                nächsten. */}
            <TopicSuggestions
              key={subjectId}
              suggestions={topicSuggestions[subjectId] ?? []}
              topics={topics}
              onTopicsChange={setTopics}
            />
          </>
        )}
      </Field>

      <Field
        id="note"
        label="Notiz"
        optional
        hint="Was auf dem Bild nicht steht: bis wann es gerechnet werden soll, wo die Lösung liegt."
        error={state.errors?.note}
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      {/* Die Abschrift steht zuletzt und direkt über dem Knopf.

          Titel, Fach, Tag, Themen und Notiz sind die kurzen Antworten; die
          Abschrift ist die lange. Stünde sie oben, müsste man an zwölf
          zugeklappten Seiten vorbeiscrollen, um den Titel zu ändern — und das
          ist der häufigere Griff. Unten steht sie da, wo man ohnehin
          hinkommt, bevor man abschickt.

          Ein Blatt ohne Seiten gibt es nicht (`deletePage()` lässt die letzte
          stehen), aber die Prüfung kostet nichts und hält ein leeres
          <fieldset> von der Seite fern, falls sich das eines Tages ändert. */}
      {pages.length > 0 ? (
        <TranscriptFields
          pages={pages}
          values={transcripts}
          onChange={changeTranscript}
        />
      ) : null}

      <div className="pt-2">
        <Button type="submit" loading={pending} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Das Löschen
   ------------------------------------------------------------------------- */

export type MaterialDangerZoneProps = {
  /** Wie das Blatt in der Ablage steht, z.B. „Mathematik · Arbeitsblatt 3“. */
  materialLabel: string;
  /** Wie viele Seiten mit weggehen — das gehört in die Frage. */
  pageCount: number;
  deleteAction: () => Promise<void>;
};

/** Löschen — bewusst unten, mit einem sichtbaren Zwischenschritt. */
export function MaterialDangerZone({
  materialLabel,
  pageCount,
  deleteAction,
}: MaterialDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      {confirming ? (
        <div className="space-y-3 rounded-control border border-danger/40 bg-danger-soft p-3.5">
          <p className="text-sm text-foreground">
            {materialLabel} wirklich löschen? Damit{" "}
            {pageCount === 1
              ? "ist auch die Aufnahme weg"
              : `sind auch die ${pageCount} Aufnahmen weg`}
            . Rückgängig geht das nicht, und ein zweites Mal abfotografieren
            lässt sich eine Tafel von letzter Woche nicht.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={deleteAction}>
              <SubmitButton variant="danger">
                Ja, endgültig löschen
              </SubmitButton>
            </form>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Doch nicht
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="text-danger hover:bg-danger-soft hover:text-danger"
          onClick={() => setConfirming(true)}
        >
          Blatt löschen
        </Button>
      )}
    </section>
  );
}
