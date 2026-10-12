/**
 * Was zwischen Server und Tisch hin- und hergeht (Plan E). Reine Typen, damit
 * der Client nichts aus der Datenschicht ins Bündel zieht.
 *
 * Die Musterlösung steht hier absichtlich NICHT: sie kommt erst nach dem
 * Versuch aus `versuchThemaAction()` (A2).
 */

export type ThemaKurz = {
  key: string;
  /** voller Fachname */
  fach: string;
  titel: string;
  art: "abfragen" | "ueben";
  /** „n Fragen“ oder „Arbeitsblatt“ */
  umfang: string;
  istEpoche: boolean;
  fragen: number;
  angefangen: boolean;
  blattAngefangen: boolean;
};

export type FrageKarte = {
  scheduleId: string;
  itemId: string;
  /** Text der Frage; `{…}` markiert eine Formel */
  frage: string;
  /** wie oft heute schon „Daneben“ */
  heuteDaneben: number;
};

export type ThemaLauf = {
  key: string;
  fragen: FrageKarte[];
  /** heute schon beantwortete Fragen des Themas: saß der erste Versuch? */
  erste: Record<string, boolean>;
  /** „Wieder dran“: nächster offener Termin nach heute, sonst null */
  wiederDran: string | null;
};

export type WiederholenAntwort = {
  ok: true;
  /** App-Tag */
  heute: string;
  ferien: boolean;
  themen: ThemaKurz[];
  /** „Nächstes Thema Dienstag“: Wochentag oder Datum, sonst null */
  naechstesThema: string | null;
  /** Fragen des ersten Themas, gleich mitgeschickt */
  lauf: ThemaLauf | null;
};

export type BlattImSheet = {
  titel: string;
  fach: string;
  seiten: number;
  /** Abschrift je Seite; null = noch nicht gelesen */
  abschrift: (string | null)[];
};
