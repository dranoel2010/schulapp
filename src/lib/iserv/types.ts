import { z } from "zod";

/**
 * Was die App aus IServ liest — die Formen, die zwischen Netz, Rechnung und
 * Datenbank wandern.
 *
 * Reine Typen und ein Schema, sonst nichts. Ein `IservItem` ist schon
 * gesäubert: kein HTML, gekürzte Titel, ein Berliner Kalendertag statt eines
 * Zeitstempels mit Offset. Was IServ sonst noch schickt (`id` mit der
 * Mikrozeit der Anfrage, `hash`, `when`, `creator`, Teilnehmer), kommt hier
 * gar nicht erst an — darin stünden Namen Dritter, und alles, was sich ohne
 * Inhaltsänderung ändert, schriebe jeden Termin in Google bei jedem Lauf neu.
 */

/** Woher ein Termin kommt: Gruppenkalender der Klasse, öffentlicher Schulkalender, Aufgaben. */
export type IservQuelle = "klasse" | "oeffentlich" | "aufgaben";

export const ISERV_QUELLEN: readonly IservQuelle[] = ["klasse", "oeffentlich", "aufgaben"];

/** So heißen die drei in Sätzen — fest, damit kein Text aus IServ in einen Satz gerät. */
export const QUELL_NAMEN: Record<IservQuelle, string> = {
  klasse: "Klassenkalender",
  oeffentlich: "Öffentlicher Kalender",
  aufgaben: "Aufgaben",
};

export type IservItem = {
  quelle: IservQuelle;
  /**
   * Grundlage für Schlüssel und Event-ID:
   * "cal|<uid>|<recurrenceId>" | "cal|<uid>|@<beginnUTC>" | "cal|<uid>|" |
   * "aufgabe|<n>" | "aufgabe|id:<id>"
   */
  fremdId: string;
  /** Label der IServ-Quelle, gesäubert */
  kalender: string;
  /** Gesäubert, gekürzt, nie leer */
  titel: string;
  ort: string | null;
  /** Nur aus `description` (nie `descriptionHtml`), mehrzeilig gesäubert */
  beschreibung: string | null;
  /** Nur Aufgaben: der Pfad "/iserv/exercise/show/<n>" */
  link: string | null;
  /** Wie IServ es sagt (`allDay`) */
  ganztaegig: boolean;
  /** Berliner Kalendertag YYYY-MM-DD */
  ersterTag: string;
  /** Inklusiv, ≥ ersterTag */
  letzterTag: string;
  /** Nur mit Uhrzeit: ISO in UTC */
  beginn: string | null;
  /** Nur mit Uhrzeit; null oder ≤ beginn heißt Punkt-Termin */
  ende: string | null;
  /**
   * Eingefrorenes Urteil: Ein vergangener Termin, den IServ nicht mehr
   * liefert, bleibt so stehen, wie er zuletzt entschieden war (siehe
   * @/lib/iserv/schutz).
   */
  fest?: { genommen: boolean; regel: string };
};

const TAG = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Prüft, was aus `iserv_snapshots.items_json` kommt. Streng: Ein Feld, das
 * diese Datei nicht kennt, ist ein Fehler — raten wäre hier gefährlich, denn
 * was nicht stimmt, landet in Google.
 */
export const iservItemSchema = z
  .object({
    quelle: z.enum(["klasse", "oeffentlich", "aufgaben"]),
    fremdId: z.string().min(1),
    kalender: z.string(),
    titel: z.string().min(1),
    ort: z.string().nullable(),
    beschreibung: z.string().nullable(),
    link: z.string().nullable(),
    ganztaegig: z.boolean(),
    ersterTag: z.string().regex(TAG),
    letzterTag: z.string().regex(TAG),
    beginn: z.string().nullable(),
    ende: z.string().nullable(),
    fest: z
      .object({ genommen: z.boolean(), regel: z.string() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((item) => item.letzterTag >= item.ersterTag, {
    message: "letzterTag liegt vor ersterTag",
  });

export const iservItemsSchema = z.array(iservItemSchema);

/** Was eine Quelle aus `eventsources` für die App ist. */
export type IservRolle =
  | "oeffentlich"
  | "klasse"
  | "aufgaben"
  | "klausurplan"
  | "feiertage"
  | "abo"
  | "andere"
  | "mehrdeutig"
  /** Passt zur Klasse NACH ISERV_KLASSE, und zu ISERV_KLASSE passt keiner: neues Schuljahr? */
  | "naechste-klasse";

export type ErkannteQuelle = {
  id: string;
  /** Gesäubert */
  label: string;
  typ: "cal" | "plugin";
  rolle: IservRolle;
  /** Nur bei einer verwendeten Rolle: die geprüfte Feed-Adresse */
  url: string | null;
  /** Ein kurzer deutscher Satz für die Karte */
  grund: string;
};

/** Wie ein Abruf ausging — auch das Feld `iserv.status` in der Antwort des Crons. */
export type IservLaufStatus =
  | "aus"
  | "ruht"
  | "nicht-faellig"
  | "gelesen"
  | "teilweise"
  | "fehler"
  | "blockiert"
  | "laeuft-schon";
