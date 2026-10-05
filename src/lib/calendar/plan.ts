import {
  eventHash,
  eventIdFor,
  type CalendarEventBody,
  type WantedEvent,
} from "@/lib/calendar/events";

/**
 * Was zu tun ist — die Entscheidungstabelle des Abgleichs.
 *
 * Reine Rechnung: Hier wird nichts gelesen und nichts geschrieben, es wird nur
 * verglichen, was die App will (`wanted`), mit dem, was sie sich gemerkt hat
 * (`rows`, die Zeilen aus `google_calendar_events`). Heraus kommt eine Liste
 * von Schritten, die @/lib/calendar/execute gegen Google abarbeitet.
 *
 * Google wird dafür NICHT gefragt. Es gibt keine Liste aller Termine
 * (`events.list`): Die App ist die Quelle, und was in Google steht, interessiert
 * sie nur bei einem Termin, den sie gerade anfassen will. Damit entfällt die
 * ganze Fehlerklasse „eine unvollständige Google-Liste sieht aus wie viele
 * Löschungen".
 *
 * ── Die Tabelle ──────────────────────────────────────────────────────────────
 *
 *   Zeile        Wunsch da                         Wunsch fehlt (Art vollständig)
 *   ─────────    ───────────────────────────────   ──────────────────────────────
 *   keine        anlegen, Generation 0             —
 *   geliefert    gleicher Hash: nichts             löschen
 *                anderer Hash: ändern
 *   entfernen    ändern; ist er weg: neu mit       löschen (erneut)
 *                Generation + 1
 *   entfernt     anlegen mit Generation + 1        —
 *   verworfen    nichts — NIE wieder               —
 *
 * ── Eine Abwesenheit zählt nur aus einer vollständigen Quelle ────────────────
 *
 * „Wunsch fehlt" ist der einzige gefährliche Schluss, denn er stützt sich auf
 * etwas, das NICHT da ist — dieselbe Warnung wie in @/lib/wiki/run. Deshalb
 * gilt er nur für Arten, deren Quelle in diesem Lauf vollständig geliefert hat
 * (`complete`). Ist die Quelle der Hausaufgaben gescheitert, bleiben alle
 * Zeilen der Hausaufgaben unberührt — auch die einer Art, die es im Code gar
 * nicht mehr gibt.
 */

export type RowState = "geliefert" | "entfernen" | "entfernt" | "verworfen";

const ROW_STATES: readonly string[] = ["geliefert", "entfernen", "entfernt", "verworfen"];

/** Eine Zeile aus `google_calendar_events`, ohne Nutzer und Kalender. */
export type EventRow = {
  key: string;
  kind: string;
  eventId: string;
  generation: number;
  hash: string;
  state: RowState;
  title: string;
};

export type Step =
  | {
      op: "anlegen";
      key: string;
      kind: string;
      eventId: string;
      generation: number;
      body: CalendarEventBody;
      hash: string;
      title: string;
      firstDay: string;
    }
  | {
      op: "aendern";
      key: string;
      kind: string;
      eventId: string;
      generation: number;
      body: CalendarEventBody;
      hash: string;
      title: string;
      firstDay: string;
      /**
       * Gesetzt bei einer Zeile „entfernen": Die App wollte löschen, weiß aber
       * nicht, ob es angekommen ist — und jetzt will sie den Termin wieder.
       * Steht er noch, wird er geändert; ist er weg, wird er unter dieser
       * neuen ID angelegt.
       */
      nachEntfernen: null | { eventId: string; generation: number };
    }
  | {
      op: "loeschen";
      key: string;
      kind: string;
      eventId: string;
      generation: number;
      hash: string;
      title: string;
      /** Die Absicht stand schon in der Zeile — ein früherer Versuch ist womöglich angekommen. */
      erneut: boolean;
    };

export type SyncPlan = {
  steps: Step[];
  /** Geliefert und gleich geblieben — kein Aufruf bei Google. */
  unveraendert: number;
  /** Vom Nutzer in Google gelöscht und in der App noch da — bleibt draußen. */
  verworfenBekannt: number;
};

/** Ein Zustand, den diese Datei nicht kennt, ist ein Fehler — raten wäre hier gefährlich. */
function checkState(row: EventRow): RowState {
  if (!ROW_STATES.includes(row.state)) {
    throw new Error(`Unbekannter Zustand „${row.state}" bei ${row.key}.`);
  }

  return row.state;
}

/**
 * Was bald ist, kommt zuerst: erst alles ab heute aufsteigend, dann das
 * Vergangene absteigend. Kappt das Zeitbudget einen Lauf, stehen die nächsten
 * Termine damit schon in Google.
 */
function byUrgency(today: string) {
  return (
    a: { firstDay: string; key: string },
    b: { firstDay: string; key: string },
  ): number => {
    const aKommt = a.firstDay >= today;
    const bKommt = b.firstDay >= today;

    if (aKommt !== bKommt) return aKommt ? -1 : 1;

    if (a.firstDay !== b.firstDay) {
      const aufsteigend = a.firstDay < b.firstDay ? -1 : 1;
      return aKommt ? aufsteigend : -aufsteigend;
    }

    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

export function planSync(input: {
  wanted: readonly WantedEvent[];
  /** Die Arten, deren Quelle in diesem Lauf vollständig geliefert hat */
  complete: ReadonlySet<string>;
  rows: readonly EventRow[];
  /** Nur zum Sortieren */
  today: string;
}): SyncPlan {
  const rows = new Map(input.rows.map((row) => [row.key, row]));
  const seen = new Set<string>();

  const anlegen: Extract<Step, { op: "anlegen" }>[] = [];
  const aendern: Extract<Step, { op: "aendern" }>[] = [];
  const loeschen: Extract<Step, { op: "loeschen" }>[] = [];
  let unveraendert = 0;
  let verworfenBekannt = 0;

  for (const wish of input.wanted) {
    if (seen.has(wish.key)) {
      throw new Error(`Der Schlüssel ${wish.key} kommt zweimal vor.`);
    }
    seen.add(wish.key);

    if (!input.complete.has(wish.kind)) {
      // Ein Wunsch aus einer Quelle, die nicht vollständig war, kann es über
      // collectWishes() nicht geben. Kommt er doch, stimmt etwas an der
      // Verdrahtung nicht — und dann wird nichts geschrieben.
      throw new Error(`Wunsch ${wish.key} aus einer unvollständigen Quelle.`);
    }

    const hash = eventHash(wish.body);
    const common = {
      key: wish.key,
      kind: wish.kind,
      body: wish.body,
      hash,
      title: wish.body.summary,
      firstDay: wish.firstDay,
    };
    const row = rows.get(wish.key);

    if (!row) {
      anlegen.push({
        op: "anlegen",
        ...common,
        eventId: eventIdFor(wish.idBase, 0),
        generation: 0,
      });
      continue;
    }

    switch (checkState(row)) {
      case "geliefert":
        if (row.hash === hash) {
          unveraendert += 1;
        } else {
          aendern.push({
            op: "aendern",
            ...common,
            eventId: row.eventId,
            generation: row.generation,
            nachEntfernen: null,
          });
        }
        break;

      case "entfernen":
        aendern.push({
          op: "aendern",
          ...common,
          eventId: row.eventId,
          generation: row.generation,
          nachEntfernen: {
            eventId: eventIdFor(wish.idBase, row.generation + 1),
            generation: row.generation + 1,
          },
        });
        break;

      case "entfernt":
        anlegen.push({
          op: "anlegen",
          ...common,
          eventId: eventIdFor(wish.idBase, row.generation + 1),
          generation: row.generation + 1,
        });
        break;

      case "verworfen":
        // Auch bei geändertem Inhalt: Was der Nutzer in Google gelöscht hat,
        // kommt nie wieder — das ist die Zusage dieser Funktion.
        verworfenBekannt += 1;
        break;
    }
  }

  for (const row of input.rows) {
    if (seen.has(row.key)) continue;
    if (!input.complete.has(row.kind)) continue;

    const state = checkState(row);
    if (state !== "geliefert" && state !== "entfernen") continue;

    loeschen.push({
      op: "loeschen",
      key: row.key,
      kind: row.kind,
      eventId: row.eventId,
      generation: row.generation,
      hash: row.hash,
      title: row.title,
      erneut: state === "entfernen",
    });
  }

  const order = byUrgency(input.today);
  loeschen.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  aendern.sort(order);
  anlegen.sort(order);

  return {
    steps: [...loeschen, ...aendern, ...anlegen],
    unveraendert,
    verworfenBekannt,
  };
}
