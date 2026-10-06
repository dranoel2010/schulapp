import { createHash } from "node:crypto";

import type { Exam, FreePeriod, Homework } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { freeLabel } from "@/lib/free-days";
import { sprechTermine } from "@/lib/iserv/sprechtitel";
import type { IservItem } from "@/lib/iserv/types";

/**
 * Aus einer Zeile der App wird ein Termin für Google.
 *
 * Reine Rechnung: keine Datenbank, kein Netz. Was hier herauskommt, ist der
 * Termin, den die App in Google haben WILL — ob er schon dort steht, sich
 * geändert hat oder gelöscht werden muss, entscheidet @/lib/calendar/plan.
 *
 * ── Ganztägig, außer IServ nennt eine Uhrzeit ────────────────────────────────
 *
 * Eine Klausur hat in der App einen Tag und keine Uhrzeit, und die App erfindet
 * keine. Hausaufgaben stehen am Fälligkeitstag, freie Zeiträume von ihrem
 * ersten bis einschließlich ihrem letzten Tag. Google zählt das Ende eines
 * ganztägigen Termins EXKLUSIV — deshalb steht dort immer der Tag danach.
 * Gerechnet wird ausschließlich mit `addDays()` aus @/lib/dates, über
 * UTC-Mitternacht, damit keine Zeitumstellung einen Tag verschiebt.
 *
 * Die einzige Ausnahme sind Termine aus IServ (`iservEvents()`): Nennt IServ
 * Beginn und Ende, steht der Termin mit Uhrzeit in Google. Nennt es nur einen
 * Zeitpunkt („Abholung", 11:30–11:30), wird er ganztägig mit der Uhrzeit im
 * Titel („Abholung um 11:30 Uhr") — ein Termin ohne Dauer ginge in Google
 * unter. Und ein ganztägiger Termin über mehrere Tage, der keine Ferien sind,
 * steht seit dem 6.10.2026 als ein Termin je Tag da („…, Tag 1 von 2"), weil
 * ein Sprach-Bot die Titel vorliest (@/lib/iserv/sprechtitel).
 *
 * ── Im Termin steht nichts, was sich ohne Inhaltsänderung ändert ─────────────
 *
 * Kein Zeitstempel, kein „zuletzt abgeglichen", kein `status`. Dieselbe Regel
 * wie beim Wiki-Hash: Über den fertigen Termin wird ein Hash gebildet, und
 * stünde darin etwas, das sich von Lauf zu Lauf ändert, schriebe jeder Lauf
 * jeden Termin neu — und überschriebe dabei jedes Mal, was der Nutzer in
 * Google geändert hat.
 *
 * ── Die Event-ID ─────────────────────────────────────────────────────────────
 *
 * Google erlaubt eine eigene ID aus base32hex (nur a–v und 0–9, 5 bis 1024
 * Zeichen). Die App baut sie aus einem Präfix je Art, der UUID ohne
 * Bindestriche (Hex ist eine Teilmenge von base32hex) und der Generation:
 * „sak" + 32 Hex + „0". Damit ist sie deterministisch — ein zweites Anlegen
 * desselben Termins endet in Google mit 409 statt mit einem Doppel — und doch
 * erneuerbar: Eine gelöschte ID verwendet die App nie wieder, sondern zählt die
 * Generation hoch. Warum, steht an `eventIdFor()`.
 */

export type CalendarKind = "klausur" | "hausaufgabe" | "frei" | "iserv";

/**
 * Präfix der Event-ID und Farbe in Google, je Art.
 *
 * Die Präfixe dürfen nur aus a–v bestehen. Reserviert für die späteren Stufen:
 * „sab" für Termine von Blättern, „sas" für die Schulhomepage. Die Farben sind
 * Googles feste Event-Farben (1–11); frei ist noch 3 (Weintraube).
 */
export const CALENDAR_KINDS: Record<CalendarKind, { prefix: string; colorId: string }> = {
  klausur: { prefix: "sak", colorId: "11" }, // Tomate
  hausaufgabe: { prefix: "sah", colorId: "9" }, // Heidelbeere
  frei: { prefix: "saf", colorId: "10" }, // Basilikum
  iserv: { prefix: "sai", colorId: "7" }, // Pfau
};

/** Wenn der Nutzer keine Erinnerungsstunde hat — dieselbe wie `users.reminderHour` voreingestellt. */
export const DEFAULT_REMINDER_HOUR = 17;

/** Steht unter jedem Termin, damit niemand in Google Arbeit hineinsteckt, die verloren geht. */
export const EVENT_FOOTER =
  "Gepflegt von der Schulapp: Änderungen hier überschreibt sie beim nächsten Ändern in der App, und was du hier löschst, trägt sie nicht wieder ein.";

/**
 * Dasselbe für Termine aus IServ. Ein eigener Satz, weil hier IServ die Quelle
 * ist und nicht die App — und EVENT_FOOTER bleibt, wie er ist: Ein geänderter
 * Satz schriebe jeden Termin der drei anderen Arten neu.
 */
export const ISERV_FOOTER =
  "Aus IServ, gepflegt von der Schulapp: Ändert sich der Termin in IServ, ändert sie ihn hier; was du hier löschst, trägt sie nicht wieder ein.";

/** Die Grenzen der Erinnerungsstunde, wie in den Einstellungen (`hourSchema`). */
const FIRST_HOUR = 6;
const LAST_HOUR = 22;

/**
 * Ganztägig (`date`) oder mit Uhrzeit (`dateTime` in UTC, `timeZone` für die
 * Anzeige). Die `never`-Felder machen `start.date` an jeder Stelle lesbar —
 * bei einem Termin mit Uhrzeit ist es `undefined`.
 */
export type EventTime =
  | { date: string; dateTime?: never; timeZone?: never }
  | { dateTime: string; timeZone: string; date?: never };

/**
 * Ein Termin, wie er an Google geht.
 *
 * Plan und Ausführung hashen ihn nur und reichen ihn weiter; dass Termine aus
 * IServ eine Uhrzeit und einen Ort tragen können, ändert dort nichts. Ein
 * fehlender Ort ist `undefined` und fehlt damit auch im Hash
 * (`stableStringify()` lässt ihn weg) — die Termine der drei älteren Arten
 * behalten ihren Hash.
 */
export type CalendarEventBody = {
  summary: string;
  description: string;
  start: EventTime;
  /** Ganztägig exklusiv: der Tag NACH dem letzten Tag */
  end: EventTime;
  location?: string;
  colorId: string;
  transparency: "transparent";
  reminders: {
    useDefault: false;
    overrides: { method: "popup"; minutes: number }[];
  };
  /** `schulapp` = der Schlüssel der Zeile, damit ein Termin in Google seine Herkunft trägt */
  extendedProperties: { private: { schulapp: string } };
};

/** Was eine Quelle im Kalender haben will. */
export type WantedEvent = {
  kind: CalendarKind;
  /** „klausur-<uuid>" — der Schlüssel in `google_calendar_events` */
  key: string;
  /** Präfix + UUID ohne Bindestriche; die Generation hängt @/lib/calendar/plan an */
  idBase: string;
  /** Der erste Tag — nur zum Sortieren: Was bald ist, kommt zuerst dran */
  firstDay: string;
  body: CalendarEventBody;
};

const EXAM_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

/** „klausur-<uuid>" — im Stil der `doc_id` der Wiki-Übergabe. */
export function calendarKey(kind: CalendarKind, sourceId: string): string {
  return `${kind}-${sourceId}`;
}

/** Präfix + UUID ohne Bindestriche, klein. Wirft, wenn es keine UUID ist. */
export function idBaseFor(kind: CalendarKind, uuid: string): string {
  const hex = uuid.replace(/-/g, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Keine UUID, aus der sich eine Event-ID bauen ließe: ${uuid}`);
  }

  return `${CALENDAR_KINDS[kind].prefix}${hex}`;
}

/**
 * Die Event-ID einer Generation.
 *
 * Warum es Generationen gibt: Löscht die App einen Termin (eine Hausaufgabe
 * wird abgehakt) und will ihn später wieder anlegen (sie wird wieder
 * geöffnet), dann antwortet Google auf dieselbe ID mit 409 — eine gelöschte ID
 * bleibt in Google reserviert. Die Doku sagt dazu: „Generate a new ID if you
 * want to create a new instance." Die Alternative, den gelöschten Termin per
 * PUT wiederzubeleben, ist nicht dokumentiert und könnte genau das zurückholen,
 * was der Nutzer selbst gelöscht hat. Also zählt die App hoch, und die
 * Generation steht als base32hex am Ende (0, 1, …, v, 10, …).
 */
export function eventIdFor(idBase: string, generation: number): string {
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error(`Keine gültige Generation: ${generation}`);
  }

  const id = `${idBase}${generation.toString(32)}`;

  if (!/^[0-9a-v]{5,1024}$/.test(id)) {
    throw new Error(`Keine gültige Event-ID für Google: ${id}`);
  }

  return id;
}

/**
 * Wie viele Minuten vor Beginn des Fälligkeitstags erinnert wird.
 *
 * Bei einem ganztägigen Termin zählt Google die Minuten ab 00:00 des Tages.
 * Erinnert wird am Vortag zur Erinnerungsstunde des Nutzers — also
 * (24 − Stunde) · 60 Minuten vorher. Die Stunde liegt zwischen 6 und 22; damit
 * liegt die Erinnerung zwischen „Vortag 06:00" und „Vortag 22:00" und kreuzt
 * nie die Zeitumstellung um 2 oder 3 Uhr nachts. Was außerhalb liegt oder
 * keine ganze Zahl ist, fällt auf 17 Uhr zurück.
 */
export function homeworkReminderMinutes(reminderHour: number): number {
  const hour =
    Number.isInteger(reminderHour) &&
    reminderHour >= FIRST_HOUR &&
    reminderHour <= LAST_HOUR
      ? reminderHour
      : DEFAULT_REMINDER_HOUR;

  return (24 - hour) * 60;
}

/** Leere Teile fallen weg, der Rest steht in Absätzen untereinander. */
function describe(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function body(input: {
  kind: CalendarKind;
  key: string;
  summary: string;
  description: string;
  firstDay: string;
  lastDay: string;
  reminderMinutes: number | null;
}): CalendarEventBody {
  return {
    summary: input.summary,
    description: input.description,
    start: { date: input.firstDay },
    end: { date: addDays(input.lastDay, 1) },
    colorId: CALENDAR_KINDS[input.kind].colorId,
    transparency: "transparent",
    reminders: {
      useDefault: false,
      overrides:
        input.reminderMinutes === null
          ? []
          : [{ method: "popup", minutes: input.reminderMinutes }],
    },
    extendedProperties: { private: { schulapp: input.key } },
  };
}

/**
 * Eine Prüfung — jede, auch die vergangenen: Sie bleiben im Kalender stehen,
 * wie sie in der App stehen bleiben.
 *
 * Keine Erinnerung von Google: Die App schickt schon selbst eine Push-Nachricht
 * drei Tage und einen Tag vorher, und zwei Erinnerungen für dieselbe Klausur
 * wären eine zu viel.
 */
export function examEvent(input: {
  exam: Pick<Exam, "id" | "kind" | "title" | "date" | "notes">;
  subjectName: string;
  topics: string[];
  appOrigin: string;
}): WantedEvent {
  const { exam } = input;
  const key = calendarKey("klausur", exam.id);
  const label = EXAM_LABELS[exam.kind] ?? "Prüfung";
  const title = exam.title?.trim();

  return {
    kind: "klausur",
    key,
    idBase: idBaseFor("klausur", exam.id),
    firstDay: exam.date,
    body: body({
      kind: "klausur",
      key,
      summary: `${label} ${input.subjectName}${title ? `: ${title}` : ""}`,
      description: describe([
        input.topics.length > 0 ? `Themen: ${input.topics.join(", ")}` : null,
        exam.notes,
        `In der Schulapp: ${input.appOrigin}/klausuren/${exam.id}`,
        EVENT_FOOTER,
      ]),
      firstDay: exam.date,
      lastDay: exam.date,
      reminderMinutes: null,
    }),
  };
}

/** Eine offene Hausaufgabe, am Fälligkeitstag, mit Erinnerung am Vortag. */
export function homeworkEvent(input: {
  homework: Pick<Homework, "id" | "title" | "details" | "dueDate">;
  subjectName: string;
  reminderHour: number;
  appOrigin: string;
}): WantedEvent {
  const { homework } = input;
  const key = calendarKey("hausaufgabe", homework.id);

  return {
    kind: "hausaufgabe",
    key,
    idBase: idBaseFor("hausaufgabe", homework.id),
    firstDay: homework.dueDate,
    body: body({
      kind: "hausaufgabe",
      key,
      summary: `Hausaufgabe ${input.subjectName}: ${homework.title}`,
      description: describe([
        homework.details,
        `In der Schulapp: ${input.appOrigin}/hausaufgaben/${homework.id}`,
        EVENT_FOOTER,
      ]),
      firstDay: homework.dueDate,
      lastDay: homework.dueDate,
      reminderMinutes: homeworkReminderMinutes(input.reminderHour),
    }),
  };
}

/** Ferien, Klassenfahrt, ein freier Tag — als Balken über alle Tage, ohne Erinnerung. */
export function freePeriodEvent(input: {
  period: Pick<FreePeriod, "id" | "kind" | "title" | "startsOn" | "endsOn">;
  appOrigin: string;
}): WantedEvent {
  const { period } = input;
  const key = calendarKey("frei", period.id);

  return {
    kind: "frei",
    key,
    idBase: idBaseFor("frei", period.id),
    firstDay: period.startsOn,
    body: body({
      kind: "frei",
      key,
      summary: freeLabel(period),
      description: describe([
        `In der Schulapp: ${input.appOrigin}/einstellungen`,
        EVENT_FOOTER,
      ]),
      firstDay: period.startsOn,
      lastDay: period.endsOn,
      reminderMinutes: null,
    }),
  };
}

/** Längster Titel, den die App an Google gibt. */
const SUMMARY_MAX = 250;

/**
 * Schlüssel und Event-ID eines Termins aus IServ. IServ hat keine UUID; die
 * Grundlage ist die `fremdId` (uid und Vorkommen, siehe @/lib/iserv/parse),
 * gehasht: Hex ist eine Teilmenge von base32hex, und 32 Zeichen halten die
 * ID so lang wie die der anderen Arten.
 *
 * `nummer` zählt die Tage eines mehrtägigen Termins (1, 2, …). Tag 1 und
 * jeder Termin, der nicht geteilt wird, haben die Grundlage BYTEGLEICH
 * `iserv|<fremdId>` — sonst bekäme jeder Termin, der schon in Google steht,
 * einen neuen Schlüssel und würde gelöscht und neu angelegt. Ab Tag 2 kommt
 * die Nummer dazu (`|tag:2`).
 *
 * Die Nummer, nicht das Datum: So bleibt die Zusage „was der Nutzer in Google
 * löscht, kommt nie wieder“ auch dann, wenn IServ den Termin verschiebt — die
 * Schlüssel bleiben, der Abgleich will ändern, findet den Termin gelöscht und
 * verwirft ihn. Aus dem alten Balken wird bei der Umstellung Tag 1 (derselbe
 * Termin in Google), und wechselt ein Termin zwischen einem und mehreren
 * Tagen, bleibt Tag 1 erhalten. Neu angelegt werden nur Tage, die es vorher
 * nicht gab (IServ verlängert von 2 auf 3 Tage: Tag 3).
 */
export function iservIdentity(
  fremdId: string,
  nummer = 1,
): { key: string; idBase: string } {
  const grundlage = nummer === 1 ? `iserv|${fremdId}` : `iserv|${fremdId}|tag:${nummer}`;
  const hash = createHash("sha256").update(grundlage, "utf8").digest("hex").slice(0, 32);
  return { key: `iserv-${hash}`, idBase: `${CALENDAR_KINDS.iserv.prefix}${hash}` };
}

/**
 * Die Termine aus einem IServ-Eintrag — in Pfau, mit einem Titel, den ein
 * Sprach-Bot vorlesen kann (@/lib/iserv/sprechtitel), und meist genau einer:
 *
 *   mit Beginn und Ende:     „Vorstellung der Praktikumsberichte"   18:00–19:30
 *   Punkt (11:30–11:30):     „Unterrichtsende um 11:30 Uhr"         ganztägig
 *   Aufgabe:                 „Abgabe Deutsch: Erörterung bis 23:59 Uhr"
 *                                                                   ganztägig
 *   mehrtägig, ganztägig:    „Pädagogischer Tag, Tag 1 von 2, frei" je Tag
 *                            „Pädagogischer Tag, Tag 2 von 2, frei" einer
 *   Ferien:                  „Herbstferien"                         ein Balken
 *
 * Ein Tages-Termin hat seinen eigenen Schlüssel (`iservIdentity(fremdId,
 * nummer)`), steht ganztägig an genau diesem Tag und trägt dieselbe
 * Beschreibung wie seine Geschwister. Tag 1 und alles, was nicht geteilt
 * wird, behalten den Schlüssel `iservIdentity(fremdId)` — und damit ihren
 * Termin in Google.
 *
 * Der Titel aus IServ steht als erste Zeile in der Beschreibung („Titel in
 * IServ: …"), damit nichts verloren geht. Bewusst nicht „In IServ: …": So
 * beginnt bei Aufgaben schon die Zeile mit dem Link.
 *
 * Keine Erinnerung von Google, auch für Aufgaben nicht. Im Termin steht nichts,
 * was sich ohne Inhaltsänderung ändert — kein `id`, `hash` oder `when` aus
 * IServ, kein Zeitpunkt des Abrufs.
 */
export function iservEvents(input: {
  item: IservItem;
  /** ISERV_KLASSE — die eigene Klasse fällt aus dem Titel */
  klasse: number;
  iservOrigin: string;
  appOrigin: string;
}): WantedEvent[] {
  const { item } = input;
  const aufgabe = item.quelle === "aufgaben";
  const punkt = !item.ganztaegig && (item.ende === null || item.beginn === null || item.ende <= item.beginn);
  const mitUhrzeit = !item.ganztaegig && !punkt && item.beginn !== null && item.ende !== null;

  const description = describe([
    `Titel in IServ: „${item.titel}“`,
    item.beschreibung,
    aufgabe
      ? item.link
        ? `In IServ: ${input.iservOrigin}${item.link}`
        : null
      : `Aus IServ, Kalender „${item.kalender}“`,
    `In der Schulapp: ${input.appOrigin}/einstellungen#iserv`,
    ISERV_FOOTER,
  ]);

  // sprechTermine liefert die Tage in ihrer Reihenfolge: Stelle 0 ist Tag 1.
  return sprechTermine(item, input.klasse).map(({ tag, titel }, stelle) => {
    const { key, idBase } = iservIdentity(item.fremdId, stelle + 1);
    const summary = titel.length > SUMMARY_MAX ? `${titel.slice(0, SUMMARY_MAX - 1)}…` : titel;

    let start: EventTime;
    let end: EventTime;
    if (tag !== null) {
      start = { date: tag };
      end = { date: addDays(tag, 1) };
    } else if (mitUhrzeit) {
      start = { dateTime: item.beginn as string, timeZone: "Europe/Berlin" };
      end = { dateTime: item.ende as string, timeZone: "Europe/Berlin" };
    } else {
      start = { date: item.ersterTag };
      end = { date: addDays(item.letzterTag, 1) };
    }

    return {
      kind: "iserv",
      key,
      idBase,
      firstDay: tag ?? item.ersterTag,
      body: {
        summary,
        description,
        start,
        end,
        location: item.ort ?? undefined,
        colorId: CALENDAR_KINDS.iserv.colorId,
        transparency: "transparent",
        reminders: { useDefault: false, overrides: [] },
        extendedProperties: { private: { schulapp: key } },
      },
    };
  });
}

/**
 * JSON mit rekursiv sortierten Schlüsseln. Ohne die Sortierung hinge der Hash
 * an der Reihenfolge, in der ein Objekt gebaut wurde — eine Umstellung im Code
 * schriebe dann jeden Termin neu, ohne dass sich an ihm etwas geändert hätte.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry ?? null)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((name) => record[name] !== undefined)
    .map((name) => `${JSON.stringify(name)}:${stableStringify(record[name])}`);

  return `{${entries.join(",")}}`;
}

/** SHA-256 hex über den Termin — woran „geändert" erkannt wird. */
export function eventHash(event: CalendarEventBody): string {
  return createHash("sha256").update(stableStringify(event), "utf8").digest("hex");
}
