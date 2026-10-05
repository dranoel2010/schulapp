import { addDays, berlinDay } from "@/lib/dates";
import { FEHLER_SAETZE, IservFehler } from "@/lib/iserv/client";
import {
  BESCHREIBUNG_MAX,
  LABEL_MAX,
  MAX_EINTRAEGE,
  ORT_MAX,
  PUBLIC_CAL_ID,
  TITEL_MAX,
} from "@/lib/iserv/config";
import { saeubere, saeubereMehrzeilig } from "@/lib/iserv/html";
import { normalisiere } from "@/lib/iserv/klasse";
import type { ErkannteQuelle, IservItem, IservQuelle, IservRolle } from "@/lib/iserv/types";

/**
 * Was IServ schickt, als `IservItem` — oder ein Wurf.
 *
 * Reine Rechnung. Drei Antworten werden gelesen: die Liste der Kalender
 * (`eventsources`), ein Kalender-Feed und das Aufgaben-Plugin. Jede wird
 * VOLLSTÄNDIG gelesen oder gar nicht: Eine Antwort, die nicht so aussieht wie
 * erwartet, ist ein Formatwechsel und wirft „format" — der alte Stand bleibt
 * dann stehen (@/lib/iserv/schutz). Ein einzelner kaputter Eintrag wird
 * übersprungen und gezählt; sind ALLE kaputt, ist auch das ein Formatwechsel.
 *
 * ── Was aus einem Termin NIE gelesen wird ───────────────────────────────────
 *
 * `id` (enthält die Mikrozeit der Anfrage — „…@iserv 0.26295800 1791230953" —
 * und ist bei jedem Abruf anders), `hash`, `when`, `createdAt`, `creator`,
 * `organizer`, `participantsWithStatus`, `descriptionHtml`, `locationHtml`.
 * Die ersten vier änderten sonst ohne Inhaltsänderung den Termin in Google,
 * die übrigen tragen Namen Dritter oder HTML.
 *
 * ── Der Schlüssel eines Termins ─────────────────────────────────────────────
 *
 * Eine Serie hat EINE `uid` und je Vorkommen eine `recurrenceId`
 * („20261013T150000Z"). Daraus wird `fremdId` = „cal|<uid>|<recurrenceId>". Die
 * `calendarId` gehört bewusst nicht dazu: Steht derselbe Termin im
 * Klassenkalender und im öffentlichen, ist es derselbe Termin, und zieht er von
 * einem in den anderen um, wird er in Google geändert statt gelöscht und neu
 * angelegt.
 */

function formatFehler(was: string): IservFehler {
  return new IservFehler("format", FEHLER_SAETZE.format(` (${was})`));
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/** Ein Zeitpunkt, den `Date` lesen kann — oder null. */
function zeitpunkt(wert: unknown): Date | null {
  if (typeof wert !== "string" || wert.trim() === "") return null;
  const zeit = new Date(wert);
  return Number.isNaN(zeit.getTime()) ? null : zeit;
}

function maxTag(a: string, b: string): string {
  return a >= b ? a : b;
}

// ── eventsources ─────────────────────────────────────────────────────────────

const MAX_QUELLEN = 50;
const CAL_FEED_PATH = "/iserv/calendar/feed/calendar";
/** Der Plugin-Pfad wechselt je IServ-Version: calendar4/plugin, calendar/feed/plugin. */
const PLUGIN_FEED_PATH = /^\/iserv\/calendar\d*\/(?:feed\/)?plugin$/;

const VERWENDET: ReadonlySet<IservRolle> = new Set(["oeffentlich", "klasse", "aufgaben"]);

/** Endet der Gruppenname oder das Label auf die Klasse („arbeitsmaterial.10", „Klasse 10a")? */
export function passtZurKlasse(id: string, label: string, klasse: number): boolean {
  const muster = new RegExp(`(?:^|[._\\s-])${klasse}[a-z]?$`, "i");
  const gruppe = id.match(/^\/([^/]+)\/calendar$/)?.[1] ?? "";

  return muster.test(gruppe.toLowerCase()) || muster.test(normalisiere(label));
}

type QuellKopf = Pick<ErkannteQuelle, "id" | "label" | "typ" | "rolle">;

/** Ein Gruppenkalender, der der Klassenkalender sein könnte — kein Abo, kein öffentlicher, kein Plugin. */
const GRUPPEN_ROLLEN: ReadonlySet<IservRolle> = new Set(["andere", "klasse", "mehrdeutig", "naechste-klasse"]);

function istGruppenKalender(q: QuellKopf): boolean {
  return q.typ === "cal" && GRUPPEN_ROLLEN.has(q.rolle);
}

/**
 * Ist ISERV_KLASSE wahrscheinlich vom letzten Schuljahr? Ja, wenn kein
 * Gruppenkalender zur Klasse passt, aber einer zur nächsten — und
 * ISERV_KLASSENKALENDER nicht gesetzt ist (dann hat ein Mensch entschieden).
 *
 * Liest die frische Liste aus `parseEventSources()` ebenso wie die
 * gespeicherte aus `sources_json` — mit der Klasse von JETZT: Hebt der Mensch
 * ISERV_KLASSE an, gilt die Klasse sofort wieder als sicher, ohne auf den
 * nächsten Abruf zu warten. Solange sie unsicher ist, nimmt der Filter keinen
 * Termin, der die eingestellte Klasse nennt (@/lib/iserv/klasse, Regel 3).
 */
export function klasseVeraltet(
  quellen: readonly QuellKopf[],
  klasse: number,
  klassenkalender: string | null,
): boolean {
  if (klassenkalender || klasse >= 13) return false;

  const gruppen = quellen.filter(istGruppenKalender);
  return (
    !gruppen.some((q) => passtZurKlasse(q.id, q.label, klasse)) &&
    gruppen.some((q) => passtZurKlasse(q.id, q.label, klasse + 1))
  );
}

/**
 * Stimmt etwas an der Einstellung der Klasse nicht? Ein fester Satz — oder
 * null. Ohne Text aus IServ: Der Satz steht auch in der Antwort des Crons.
 *
 * Kein Fehler ist es, wenn es schlicht keinen Klassenkalender gibt; dann
 * kommt nur ein Hinweis in die Karte.
 */
export function klassenProblem(
  quellen: readonly QuellKopf[],
  cfg: { klasse: number; klassenkalender: string | null },
): string | null {
  const K = cfg.klasse;

  if (cfg.klassenkalender && !quellen.some((q) => q.rolle === "klasse")) {
    return "Den Kalender aus ISERV_KLASSENKALENDER gibt es in IServ nicht — der Kalender deiner Klasse wird nicht gelesen.";
  }
  if (quellen.some((q) => q.rolle === "mehrdeutig")) {
    return `Mehrere Kalender passen zu Klasse ${K} — der Kalender deiner Klasse wird nicht gelesen, bis ISERV_KLASSENKALENDER gesetzt ist (welche, steht in der Karte IServ).`;
  }
  if (klasseVeraltet(quellen, K, cfg.klassenkalender)) {
    return `ISERV_KLASSE=${K} ist womöglich vom letzten Schuljahr: In IServ gibt es einen Kalender für Klasse ${K + 1}, aber keinen für ${K}. Bis ISERV_KLASSE angehoben ist (iserv-einrichten.sh --neue-klasse), kommt kein Termin mit Klasse ${K} in den Kalender.`;
  }
  return null;
}

/**
 * Die Kalender aus `/iserv/calendar/api/eventsources`, je mit ihrer Rolle für
 * die App. Genommen werden nur drei: der öffentliche Kalender, der
 * Gruppenkalender der Klasse und das Aufgaben-Plugin. Der Klausurplan wird
 * erkannt, aber nicht geholt — das Modul fehlt an dieser Schule; die Rolle ist
 * die Stelle, an der er später andockt. Gesetzliche Feiertage betreffen keine
 * Klasse, und weitere Gruppenkalender (AGs, Kurse) auch nicht ausdrücklich.
 *
 * Die Feed-Adresse kommt IMMER aus der Antwort und wird nie fest eingebaut:
 * Der Pfad des Plugins wechselt je IServ-Version.
 *
 * `problem` ist der feste Satz aus `klassenProblem()`: Der Klassenkalender ist
 * mehrdeutig, der aus ISERV_KLASSENKALENDER fehlt, oder ISERV_KLASSE ist vom
 * letzten Schuljahr. Das ist ein Fehler der Einstellung, kein leerer Kalender
 * — der Abruf meldet sich dann laut (@/lib/iserv/abruf).
 */
export function parseEventSources(
  json: unknown,
  origin: string,
  cfg: { klasse: number; klassenkalender: string | null },
): { quellen: ErkannteQuelle[]; hinweise: string[]; problem: string | null } {
  if (!Array.isArray(json)) throw formatFehler("eventsources ist keine Liste");
  if (json.length > MAX_QUELLEN) throw formatFehler(`mehr als ${MAX_QUELLEN} Kalender in eventsources`);

  const hinweise: string[] = [];
  const roh: { id: string; url: string; typ: "cal" | "plugin" | "anderer"; abo: boolean }[] = [];
  const quellen: ErkannteQuelle[] = [];

  for (const eintrag of json) {
    if (
      !istObjekt(eintrag) ||
      typeof eintrag.id !== "string" ||
      typeof eintrag.url !== "string" ||
      typeof eintrag.type !== "string"
    ) {
      throw formatFehler("ein Kalender in eventsources ohne id, url oder type");
    }

    const id = eintrag.id;
    const label = saeubere(typeof eintrag.label === "string" ? eintrag.label : "", LABEL_MAX) ||
      saeubere(id, LABEL_MAX) ||
      "(ohne Namen)";
    const typ = eintrag.type === "cal" || eintrag.type === "plugin" ? eintrag.type : "anderer";
    const abo = eintrag.subscription === true;

    let rolle: IservRolle = "andere";
    let grund = "anderer Kalender — nicht übernommen";

    if (abo) {
      rolle = "abo";
      grund = "abonnierter Kalender — nicht übernommen";
    } else if (typ === "cal" && id === PUBLIC_CAL_ID && !quellen.some((q) => q.rolle === "oeffentlich")) {
      rolle = "oeffentlich";
      grund = "öffentlicher Schulkalender — gefiltert nach Klasse";
    } else if (typ === "cal") {
      grund = "weiterer Gruppenkalender — nicht übernommen";
    } else if (typ === "plugin" && id === "exercise" && !quellen.some((q) => q.rolle === "aufgaben")) {
      rolle = "aufgaben";
      grund = "deine Aufgaben — ganz übernommen";
    } else if (typ === "plugin" && id === "exam-plan") {
      rolle = "klausurplan";
      grund = "Klausurplan vorhanden — noch nicht übernommen";
    } else if (typ === "plugin" && id === "holiday") {
      rolle = "feiertage";
      grund = "gesetzliche Feiertage — betreffen keine Klasse";
    }

    roh.push({ id, url: eintrag.url, typ, abo });
    quellen.push({ id, label, typ: typ === "anderer" ? "plugin" : typ, rolle, url: null, grund });
  }

  // ── Der Klassenkalender ────────────────────────────────────────────────────
  const K = cfg.klasse;
  const istGruppe = (index: number) =>
    roh[index].typ === "cal" && !roh[index].abo && quellen[index].rolle === "andere";

  if (cfg.klassenkalender) {
    const index = quellen.findIndex((q, i) => istGruppe(i) && q.id === cfg.klassenkalender);
    if (index >= 0) {
      quellen[index].rolle = "klasse";
      quellen[index].grund = "Kalender deiner Klasse (ISERV_KLASSENKALENDER) — ganz übernommen";
    } else {
      hinweise.push(`ISERV_KLASSENKALENDER=${cfg.klassenkalender} steht nicht in der Liste der Kalender.`);
    }
  } else {
    const kandidaten = quellen
      .map((q, i) => ({ q, i }))
      .filter(({ q, i }) => istGruppe(i) && passtZurKlasse(q.id, q.label, K));

    if (kandidaten.length === 1) {
      kandidaten[0].q.rolle = "klasse";
      kandidaten[0].q.grund = `Kalender deiner Klasse ${K} — ganz übernommen`;
    } else if (kandidaten.length > 1) {
      for (const { q } of kandidaten) {
        q.rolle = "mehrdeutig";
        q.grund = `passt zu Klasse ${K}, aber nicht als einziger — nicht übernommen`;
      }
      hinweise.push(
        `Passend zu Klasse ${K}: ${kandidaten.map(({ q }) => q.id).join(", ")} — einen davon in ISERV_KLASSENKALENDER setzen.`,
      );
    } else if (klasseVeraltet(quellen, K, null)) {
      for (const [i, q] of quellen.entries()) {
        if (istGruppe(i) && passtZurKlasse(q.id, q.label, K + 1)) {
          q.rolle = "naechste-klasse";
          q.grund = `passt zu Klasse ${K + 1} — neues Schuljahr? ISERV_KLASSE anheben`;
        }
      }
    } else {
      hinweise.push(`Kein Klassenkalender für Klasse ${K} gefunden.`);
    }
  }

  // ── Die Feed-Adressen der verwendeten Kalender ─────────────────────────────
  for (const [index, quelle] of quellen.entries()) {
    if (!VERWENDET.has(quelle.rolle)) continue;

    let url: URL;
    try {
      url = new URL(roh[index].url, origin);
    } catch {
      throw formatFehler("eine Feed-Adresse ist unlesbar");
    }
    if (url.origin !== origin) {
      throw new IservFehler("fremde-adresse", FEHLER_SAETZE["fremde-adresse"](""));
    }

    const pfadOk = roh[index].typ === "cal"
      ? url.pathname === CAL_FEED_PATH
      : PLUGIN_FEED_PATH.test(url.pathname);
    if (!pfadOk) throw formatFehler(`unerwarteter Feed-Pfad ${url.pathname.slice(0, 80)}`);

    quelle.url = url.toString();
  }

  if (!quellen.some((q) => q.rolle === "oeffentlich")) {
    throw formatFehler("eventsources ohne öffentlichen Kalender");
  }

  return { quellen, hinweise, problem: klassenProblem(quellen, cfg) };
}

// ── Kalender-Feed ────────────────────────────────────────────────────────────

/**
 * Ein Kalender-Feed (/iserv/calendar/feed/calendar?cal=…&start=…&end=…).
 *
 * Ganztägig: IServ zählt das Ende EXKLUSIV (Folgetag 00:00), wie Google. Der
 * letzte Tag ist deshalb der Berliner Tag des Endes minus eins — über
 * `addDays()`, damit die Zeitumstellung nichts verschiebt: Herbstferien
 * 2026-10-17T00:00+02:00 bis 2026-11-01T00:00+01:00 sind der 17. bis 31.10.
 * Der Feiertags-Stil (02:00 Ortszeit) landet so ebenfalls auf dem richtigen
 * Tag.
 */
export function parseKalenderFeed(
  json: unknown,
  quelle: Exclude<IservQuelle, "aufgaben">,
  label: string,
): { items: IservItem[]; unlesbar: number } {
  if (!Array.isArray(json)) throw formatFehler("Kalender-Feed ist keine Liste");
  if (json.length > MAX_EINTRAEGE) throw formatFehler(`mehr als ${MAX_EINTRAEGE} Termine`);

  const items: IservItem[] = [];
  const gesehen = new Set<string>();
  let unlesbar = 0;
  let abgesagt = 0;

  for (const eintrag of json) {
    if (!istObjekt(eintrag)) {
      unlesbar += 1;
      continue;
    }

    if (typeof eintrag.status === "string" && eintrag.status.toUpperCase() === "CANCELLED") {
      abgesagt += 1;
      continue;
    }

    const uid = typeof eintrag.uid === "string" ? eintrag.uid.trim() : "";
    const start = zeitpunkt(eintrag.start);
    const titel = typeof eintrag.title === "string" ? saeubere(eintrag.title, TITEL_MAX) : "";

    if (!uid || !start || !titel) {
      unlesbar += 1;
      continue;
    }

    const end = zeitpunkt(eintrag.end);
    const ganztaegig = eintrag.allDay === true;

    let ersterTag: string;
    let letzterTag: string;
    let beginn: string | null = null;
    let ende: string | null = null;

    if (ganztaegig) {
      ersterTag = berlinDay(start);
      const endeExklusiv = end ? berlinDay(end) : addDays(ersterTag, 1);
      letzterTag = maxTag(ersterTag, addDays(endeExklusiv, -1));
    } else {
      beginn = start.toISOString();
      ende = end ? end.toISOString() : null;
      ersterTag = berlinDay(start);
      letzterTag = berlinDay(end && end > start ? end : start);
    }

    const recurrenceId = typeof eintrag.recurrenceId === "string" ? eintrag.recurrenceId.trim() : "";
    const fremdId = recurrenceId
      ? `cal|${uid}|${recurrenceId}`
      : eintrag.recurring === true
        ? `cal|${uid}|@${beginn ?? ersterTag}`
        : `cal|${uid}|`;

    if (gesehen.has(fremdId)) continue;
    gesehen.add(fremdId);

    const ort = typeof eintrag.location === "string" ? saeubere(eintrag.location, ORT_MAX) : "";
    const beschreibung = typeof eintrag.description === "string"
      ? saeubereMehrzeilig(eintrag.description, BESCHREIBUNG_MAX)
      : "";

    items.push({
      quelle,
      fremdId,
      kalender: label,
      titel,
      ort: ort || null,
      beschreibung: beschreibung || null,
      link: null,
      ganztaegig,
      ersterTag,
      letzterTag,
      beginn,
      ende,
    });
  }

  const lesbarGemeint = json.length - abgesagt;
  if (lesbarGemeint > 0 && unlesbar === lesbarGemeint) {
    throw formatFehler("kein einziger Termin lesbar");
  }

  return { items, unlesbar };
}

// ── Aufgaben-Plugin ──────────────────────────────────────────────────────────

const SHOW = /\/iserv\/exercise\/show\/(\d+)(?:[/?#]|$)/;

/**
 * Das Aufgaben-Plugin (/iserv/calendar4/plugin?plugin=exercise&start=…&end=…).
 *
 * ⚠ ANNAHME, ungeprüft: Am 5.10.2026 lieferte IServ hier 0 Einträge — der
 * Schüler hatte keine offene Aufgabe. Das Format ist abgeleitet vom
 * Feiertags-Plugin am selben Endpunkt (`{id, title, start, end, allDay,
 * displayFields}`) und von den Bibliotheken IServAPI und obsidian-iserv:
 *
 *   { id: string|number, title, start: ISO, end?: ISO|null, allDay?: boolean,
 *     url?: "/iserv/exercise/show/<n>", displayFields?: [{label, text}] }
 *
 * Gelesen wird deshalb großzügig: Pflicht sind nur id, title und start;
 * unbekannte Felder stören nicht. Welche Felder die erste nicht leere Antwort
 * tatsächlich hatte, hält `felder` fest (nur die Namen, keine Werte) — die
 * Karte zeigt sie, damit sich die Annahme bestätigen lässt.
 *
 * Der Abgabetermin ist das Ende, wenn es eines gibt, sonst der Anfang. Ob eine
 * Aufgabe schon abgegeben ist, lässt sich heute nicht sehen; genommen wird
 * alles, was das Plugin liefert („seine Aufgaben ganz").
 */
export function parseAufgabenFeed(
  json: unknown,
  label: string,
  origin: string,
): { items: IservItem[]; unlesbar: number; felder: string[] } {
  if (!Array.isArray(json)) throw formatFehler("Aufgaben-Feed ist keine Liste");
  if (json.length > MAX_EINTRAEGE) throw formatFehler(`mehr als ${MAX_EINTRAEGE} Aufgaben`);

  const items: IservItem[] = [];
  const felder = new Set<string>();
  const gesehen = new Set<string>();
  let unlesbar = 0;

  for (const eintrag of json) {
    if (!istObjekt(eintrag)) {
      unlesbar += 1;
      continue;
    }
    for (const feld of Object.keys(eintrag)) felder.add(feld);

    const id = typeof eintrag.id === "string"
      ? eintrag.id.trim()
      : typeof eintrag.id === "number" && Number.isFinite(eintrag.id)
        ? String(eintrag.id)
        : "";
    const titel = typeof eintrag.title === "string" ? saeubere(eintrag.title, TITEL_MAX) : "";
    const start = zeitpunkt(eintrag.start);

    if (!id || !titel || !start) {
      unlesbar += 1;
      continue;
    }

    const end = zeitpunkt(eintrag.end);
    const mitEnde = end !== null && end > start;

    let tag: string;
    let beginn: string | null = null;
    const ganztaegig = eintrag.allDay === true;

    if (ganztaegig) {
      tag = mitEnde ? maxTag(berlinDay(start), addDays(berlinDay(end), -1)) : berlinDay(start);
    } else {
      const punkt = mitEnde ? end : start;
      beginn = punkt.toISOString();
      tag = berlinDay(punkt);
    }

    // Die Nummer der Aufgabe aus der Adresse — relativ, oder absolut auf demselben Server.
    let nummer: string | null = null;
    if (typeof eintrag.url === "string") {
      try {
        const url = new URL(eintrag.url, origin);
        if (url.origin === origin) nummer = url.pathname.match(SHOW)?.[1] ?? null;
      } catch {
        nummer = null;
      }
    }

    const fremdId = nummer ? `aufgabe|${nummer}` : `aufgabe|id:${id}`;
    if (gesehen.has(fremdId)) continue;
    gesehen.add(fremdId);

    const beschreibung = typeof eintrag.description === "string"
      ? saeubereMehrzeilig(eintrag.description, BESCHREIBUNG_MAX)
      : "";

    items.push({
      quelle: "aufgaben",
      fremdId,
      kalender: label,
      titel,
      ort: null,
      beschreibung: beschreibung || null,
      link: nummer ? `/iserv/exercise/show/${nummer}` : null,
      ganztaegig,
      ersterTag: tag,
      letzterTag: tag,
      beginn,
      ende: null,
    });
  }

  if (json.length > 0 && unlesbar === json.length) {
    throw formatFehler("keine einzige Aufgabe lesbar");
  }

  return { items, unlesbar, felder: [...felder].sort() };
}
