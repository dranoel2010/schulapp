import { errorText } from "@/lib/calendar/error-text";
import {
  GoogleApiError,
  type ApiErrorKind,
  type CalendarApi,
} from "@/lib/calendar/google-api";
import type { EventRow, RowState, Step } from "@/lib/calendar/plan";

/**
 * Die Schritte aus @/lib/calendar/plan gegen Google abarbeiten.
 *
 * Diese Datei importiert keine Datenbank. Google und der Speicher werden
 * hereingereicht (`api`, `store`) — im Betrieb die echte API und
 * `stepStore()` aus @/lib/calendar/store, in den Tests eine Attrappe von
 * Google im Speicher. So lässt sich der ganze Ablauf mit allen Fehlerfällen
 * durchspielen, ohne dass ein Test die Datenbank des Nutzers öffnet.
 *
 * ── Die drei Regeln ──────────────────────────────────────────────────────────
 *
 * **Jede Zeile wird direkt nach Googles Antwort geschrieben**, nicht am Ende
 * des Laufs. Bricht der Lauf ab — Neustart des NAS, Zeitbudget —, stimmt jede
 * Zeile, die bis dahin geschrieben wurde, und der nächste Lauf macht genau dort
 * weiter.
 *
 * **Erst nachsehen, dann die Absicht, dann löschen.** Vor dem ersten DELETE
 * holt die App den Termin (GET) — wie vor jedem Ändern. Ist er schon gelöscht,
 * war es der Nutzer, und zwar BEVOR die App ihn loswerden wollte: verworfen.
 * Steht er noch, kommt die Zeile auf `entfernen`, und erst dann geht der
 * DELETE hinaus. Antwortet Google bei einem späteren Versuch mit „schon
 * gelöscht", war es entweder der eigene frühere Versuch, dessen Antwort
 * verloren ging, oder der Nutzer — aber NACH dem Moment, in dem die App den
 * Termin noch stehen sah und ihn ohnehin entfernen wollte. Beides ist
 * `entfernt`. Ohne das GET davor ließe sich eine Löschung des Nutzers, die vor
 * einem gescheiterten DELETE (503, Timeout) lag, von der eigenen nicht
 * unterscheiden, und der Termin käme beim Wieder-Öffnen zurück.
 *
 * Weist Google den ersten DELETE sicher ab, ohne etwas zu tun (4xx:
 * Drosselung, kein Zugang, keine Berechtigung), geht die Zeile wieder auf
 * `geliefert`. `entfernen` heißt damit genau: Ein DELETE kann angekommen sein.
 *
 * **„verworfen" entsteht nur aus einem positiven Nachweis.** Das ist einer von
 * drei Fällen: Google meldet den Termin als `cancelled`, ein erster DELETE
 * bekommt „schon gelöscht", oder Google kennt die ID nicht mehr (404), NACHDEM
 * eine Probe bestätigt hat, dass der Kalender selbst noch da ist. Ohne diese
 * Probe sähe ein gelöschter Kalender aus wie hundert vom Nutzer gelöschte
 * Termine — und die kämen nie wieder, auch nicht in einen neuen Kalender.
 */

export type StepStore = {
  /** Upsert auf (Nutzer, Schlüssel) — mit dem Kalender des Speichers, `updated_at` = jetzt */
  saveRow(row: EventRow): Promise<void>;
  /** Das Google-Konto, nur zur Anzeige — Google nennt es beim Anlegen als `creator.email` */
  noteCreatorEmail(email: string): Promise<void>;
};

export type StopReason =
  | "budget"
  | "token"
  | "drosselung"
  | "voruebergehend"
  | "api-aus"
  | "berechtigung"
  | "kalender-weg";

export type ExecutionResult = {
  neu: number;
  geaendert: number;
  entfernt: number;
  verworfen: number;
  /** Nicht angefasst, weil der Lauf vorher endete — der nächste macht weiter */
  ausstehend: number;
  errors: { key: string; title: string; kind: ApiErrorKind | "id"; sentence: string }[];
  stoppedBy: StopReason | null;
};

/**
 * Wie viel Zeit vor dem Ende des Budgets noch für einen Schritt bleiben muss:
 * ein Schritt sind bis zu drei Anfragen, und jede darf 15 Sekunden dauern.
 */
const STEP_HEADROOM_MS = 20_000;

/** Bei diesen Fehlern lohnt der Rest des Laufs nicht — er scheiterte genauso. */
const STOP_KINDS: ReadonlySet<ApiErrorKind> = new Set([
  "token",
  "drosselung",
  "voruebergehend",
  "api-aus",
  "berechtigung",
]);

/**
 * Hat Google diese Anfrage sicher abgewiesen, ohne etwas zu tun? Ein 4xx heißt
 * genau das: gedrosselt (429, 403 rateLimitExceeded), kein Zugang (401 — auch
 * wenn danach das Erneuern scheiterte), keine Berechtigung, API aus. Bei 5xx,
 * Timeout und Netz weiß die App es nicht. 404 und 410 kommen hier nicht an;
 * die macht `deleteEvent()` zu „schon weg".
 */
function sicherAbgewiesen(fehler: unknown): boolean {
  return (
    fehler instanceof GoogleApiError &&
    fehler.status !== null &&
    fehler.status >= 400 &&
    fehler.status < 500
  );
}

/** Der Lauf endet hier, ohne dass der laufende Schritt selbst ein Fehler war. */
class Halt extends Error {
  constructor(readonly reason: StopReason) {
    super(reason);
  }
}

type Anlegen = Extract<Step, { op: "anlegen" }>;
type Aendern = Extract<Step, { op: "aendern" }>;
type Loeschen = Extract<Step, { op: "loeschen" }>;

function row(step: Step, state: RowState): EventRow {
  return {
    key: step.key,
    kind: step.kind,
    eventId: step.eventId,
    generation: step.generation,
    hash: step.hash,
    state,
    title: step.title,
  };
}

export async function executeSteps(
  steps: readonly Step[],
  deps: {
    api: CalendarApi;
    store: StepStore;
    calendarId: string;
    deadline: number;
    now?: () => number;
  },
): Promise<ExecutionResult> {
  const { api, store, calendarId: cal } = deps;
  const now = deps.now ?? Date.now;

  const result: ExecutionResult = {
    neu: 0,
    geaendert: 0,
    entfernt: 0,
    verworfen: 0,
    ausstehend: 0,
    errors: [],
    stoppedBy: null,
  };

  let probe: "da" | "fehlt" | "kein-zugriff" | null = null;

  /**
   * Gibt es den Kalender noch? Gefragt wird höchstens einmal je Lauf, und nur
   * vor dem ersten Verwerfen, das sich auf ein 404 stützt.
   */
  async function kalenderPruefen(): Promise<void> {
    probe ??= await api.calendarState(cal);

    if (probe === "fehlt") throw new Halt("kalender-weg");
    // Kommt die App an den Kalender nicht heran, beweist ein 404 nichts —
    // verworfen wird dann nichts, und der Lauf endet.
    if (probe === "kein-zugriff") throw new Halt("berechtigung");
  }

  async function verwerfen(step: Step): Promise<void> {
    await store.saveRow(row(step, "verworfen"));
    result.verworfen += 1;
  }

  /**
   * PUT mit `If-Match`. Hat jemand den Termin zwischen GET und PUT geändert
   * (412), wird einmal neu geholt und noch einmal geschrieben; ein zweites 412
   * lässt den Termin für den nächsten Lauf liegen.
   */
  async function schreiben(
    step: Anlegen | Aendern,
    etag: string | null,
  ): Promise<"geschrieben" | "weg" | "ausstehend"> {
    try {
      await api.updateEvent(cal, step.eventId, step.body, etag);
      return "geschrieben";
    } catch (fehler) {
      if (!(fehler instanceof GoogleApiError)) throw fehler;

      if (fehler.kind === "nicht-gefunden") {
        await kalenderPruefen();
        return "weg";
      }
      if (fehler.kind === "weg") return "weg";
      if (fehler.kind !== "veraendert") throw fehler;
    }

    const neu = await api.getEvent(cal, step.eventId);
    if (neu === null) {
      await kalenderPruefen();
      return "weg";
    }
    if (neu.status === "geloescht") return "weg";

    try {
      await api.updateEvent(cal, step.eventId, step.body, neu.etag);
      return "geschrieben";
    } catch (fehler) {
      if (!(fehler instanceof GoogleApiError)) throw fehler;

      if (fehler.kind === "veraendert") return "ausstehend";
      if (fehler.kind === "nicht-gefunden") {
        await kalenderPruefen();
        return "weg";
      }
      if (fehler.kind === "weg") return "weg";
      throw fehler;
    }
  }

  async function anlegen(step: Anlegen): Promise<void> {
    try {
      const created = await api.insertEvent(cal, step.eventId, step.body);
      await store.saveRow(row(step, "geliefert"));
      if (created.creatorEmail) await store.noteCreatorEmail(created.creatorEmail);
      result.neu += 1;
      return;
    } catch (fehler) {
      if (!(fehler instanceof GoogleApiError)) throw fehler;

      // Ein 404 beim Anlegen heißt: den Kalender gibt es nicht. Ist er doch
      // da, scheitert nur dieser Termin.
      if (fehler.kind === "nicht-gefunden") {
        await kalenderPruefen();
        throw fehler;
      }
      if (fehler.kind !== "konflikt") throw fehler;
    }

    // 409: Die ID gibt es schon. Entweder kam ein früheres Anlegen an, dessen
    // Antwort verloren ging — dann wird übernommen —, oder der Nutzer hat den
    // Termin seitdem gelöscht.
    const vorhanden = await api.getEvent(cal, step.eventId);

    if (vorhanden === null) {
      // Der 409 beweist, dass es den Termin gab; gefunden wird er nicht mehr.
      await kalenderPruefen();
      await verwerfen(step);
      return;
    }

    if (vorhanden.status === "geloescht") {
      await verwerfen(step);
      return;
    }

    const ergebnis = await schreiben(step, vorhanden.etag);

    if (ergebnis === "geschrieben") {
      await store.saveRow(row(step, "geliefert"));
      result.neu += 1;
    } else if (ergebnis === "weg") {
      await verwerfen(step);
    } else {
      result.ausstehend += 1;
    }
  }

  /** Der Termin, den die App ändern wollte, ist in Google weg. */
  async function aendernWeg(step: Aendern): Promise<void> {
    if (step.nachEntfernen) {
      // Die App hatte selbst gelöscht (oder es versucht), und als sie die
      // Absicht schrieb, stand der Termin noch (siehe `loeschen`). Weg ist er
      // also durch ihren DELETE — oder der Nutzer hat ihn danach gelöscht,
      // als die App ihn ohnehin entfernen wollte. Beides ist ihre Löschung,
      // und der Termin kommt unter einer neuen ID zurück.
      await store.saveRow(row(step, "entfernt"));
      await anlegen({
        op: "anlegen",
        key: step.key,
        kind: step.kind,
        eventId: step.nachEntfernen.eventId,
        generation: step.nachEntfernen.generation,
        body: step.body,
        hash: step.hash,
        title: step.title,
        firstDay: step.firstDay,
      });
      return;
    }

    await verwerfen(step);
  }

  async function aendern(step: Aendern): Promise<void> {
    const vorhanden = await api.getEvent(cal, step.eventId);

    if (vorhanden === null) {
      await kalenderPruefen();
      await aendernWeg(step);
      return;
    }

    if (vorhanden.status === "geloescht") {
      await aendernWeg(step);
      return;
    }

    const ergebnis = await schreiben(step, vorhanden.etag);

    if (ergebnis === "geschrieben") {
      await store.saveRow(row(step, "geliefert"));
      result.geaendert += 1;
    } else if (ergebnis === "weg") {
      await aendernWeg(step);
    } else {
      result.ausstehend += 1;
    }
  }

  async function loeschen(step: Loeschen): Promise<void> {
    if (!step.erneut) {
      // ERST NACHSEHEN. Ist der Termin schon weg, hat ihn der Nutzer gelöscht,
      // bevor die App es wollte — das ist der Nachweis für „verworfen", und
      // ein DELETE ist gar nicht mehr nötig.
      const vorhanden = await api.getEvent(cal, step.eventId);

      if (vorhanden === null) {
        await kalenderPruefen();
        await verwerfen(step);
        return;
      }
      if (vorhanden.status === "geloescht") {
        await verwerfen(step);
        return;
      }

      // DANN DIE ABSICHT. Kommt der DELETE an und geht nur die Antwort
      // verloren, findet der nächste Lauf hier „entfernen" und hält das
      // „schon gelöscht" von Google für seinen eigenen ersten Versuch.
      await store.saveRow(row(step, "entfernen"));
    }

    let antwort: "geloescht" | "schon-weg";
    try {
      antwort = await api.deleteEvent(cal, step.eventId);
    } catch (fehler) {
      // Hat Google den ersten DELETE sicher nicht ausgeführt, war die Absicht
      // nie unterwegs: zurück auf „geliefert", und der nächste Lauf fängt mit
      // dem Nachsehen von vorn an. Nach einem früheren, womöglich
      // angekommenen Versuch bleibt sie stehen, ebenso nach 5xx, Timeout und
      // Netz — der nächste Lauf versucht es mit `erneut`.
      if (!step.erneut && sicherAbgewiesen(fehler)) {
        await store.saveRow(row(step, "geliefert"));
      }
      throw fehler;
    }

    if (antwort === "geloescht" || step.erneut) {
      await store.saveRow(row(step, "entfernt"));
      result.entfernt += 1;
      return;
    }

    // Erster Versuch, das GET eben sah den Termin noch, und jetzt ist er weg:
    // Der Nutzer hat ihn in diesem Augenblick gelöscht. Ob Google 404 oder 410
    // gesagt hat, verrät die API nicht — die Probe läuft deshalb in beiden
    // Fällen; sie kostet höchstens eine Anfrage je Lauf.
    await kalenderPruefen();
    await verwerfen(step);
  }

  for (let index = 0; index < steps.length; index += 1) {
    if (now() + STEP_HEADROOM_MS > deps.deadline) {
      result.stoppedBy = "budget";
      result.ausstehend += steps.length - index;
      break;
    }

    const step = steps[index];

    try {
      if (step.op === "anlegen") await anlegen(step);
      else if (step.op === "aendern") await aendern(step);
      else await loeschen(step);
    } catch (fehler) {
      if (fehler instanceof Halt) {
        result.stoppedBy = fehler.reason;
        result.ausstehend += steps.length - index;
        if (fehler.reason === "berechtigung") {
          result.errors.push({
            key: step.key,
            title: step.title,
            kind: "berechtigung",
            sentence: "Google verweigert den Zugriff auf den Kalender „Schule“.",
          });
        }
        break;
      }

      if (fehler instanceof GoogleApiError) {
        result.errors.push({
          key: step.key,
          title: step.title,
          kind: fehler.kind,
          sentence: fehler.sentence,
        });

        if (STOP_KINDS.has(fehler.kind)) {
          result.stoppedBy = fehler.kind as StopReason;
          result.ausstehend += steps.length - index - 1;
          break;
        }

        continue;
      }

      // Ein unerwarteter Wurf — etwa eine Event-ID, die sich nicht bauen
      // ließ, oder eine Zeile, die sich nicht schreiben ließ. Nur dieser
      // Schritt scheitert, und der Satz kommt durch `errorText()`, damit eine
      // gescheiterte Abfrage nicht ihre Parameter in die Karte trägt.
      result.errors.push({
        key: step.key,
        title: step.title,
        kind: "id",
        sentence: errorText(fehler),
      });
    }
  }

  return result;
}
