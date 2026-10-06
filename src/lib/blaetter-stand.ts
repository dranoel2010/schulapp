/**
 * Der Stand der Blätter — woran Ablage, Blattseite, Eingangskorb und
 * Vorschlagsseite merken, dass sie nachladen müssen (seit dem 6.10.2026).
 *
 * Seit die App selbst entscheidet, wer eine Seite liest, passiert nach dem
 * Auslösen vieles ohne Zutun: Docling liest in ein paar Sekunden, die App
 * legt einen Vorschlag an, Jev ordnet ein, oder der Postbote holt sich das
 * Blatt und Claude schreibt ab. Bis hierher sah das nur, wer neu lud. Jetzt
 * fragt `AutoRefresh` (@/components/material/auto-refresh) in festem Takt
 * nach `/api/material/stand` und lädt die Seite nach, sobald sich der Stand
 * geändert hat — und nur dann.
 *
 * **Ein Fingerabdruck und kein Push.** Es gibt keinen Dienst, der der Seite
 * etwas zuruft, und für eine Handvoll Schritte je Blatt braucht es keinen:
 * kein SSE, kein WebSocket, keine neue Tabelle. Die Datenbank zählt in einer
 * einzigen Anweisung, was sich bei jedem sichtbaren Schritt ändert
 * (`blaetterStand()` in @/lib/materials, dort die Tabelle dazu), und hier wird
 * daraus ein Text. Gleicher Text heißt: nichts zu tun.
 *
 * **Warum hier und nicht in @/lib/materials.** Die Rechnung hier brauchen
 * beide Seiten — der Server baut den Fingerabdruck, der Browser vergleicht ihn
 * und entscheidet, ob er nachladen darf. @/lib/materials bringt die Datenbank
 * mit und hat in einer Client-Komponente nichts zu suchen. Diese Datei
 * importiert deshalb nichts: kein Treiber, kein React, kein Next. Was am DOM
 * hängt (Fokus, Formulare), liest der Baustein selbst und reicht hier nur
 * Wahrheitswerte herein — so ist alles, was entschieden wird, auch getestet.
 */

/** So oft wird gefragt, solange eine Seite gelesen wird. */
export const TAKT_IN_ARBEIT_MS = 5_000;

/** Und so oft, wenn nichts läuft — oder die letzte Frage schiefging. */
export const TAKT_RUHIG_MS = 30_000;

/**
 * Wer in den Tab zurückkommt, bekommt sofort eine Frage — aber nicht zwei:
 * `visibilitychange` und `focus` feuern beim Wechsel beide.
 */
export const ZURUECK_ABSTAND_MS = 2_000;

/**
 * So lange gilt ein angestoßenes Nachladen als unterwegs. Kommt in dieser Zeit
 * noch einmal derselbe neue Stand, wird nicht ein zweites Mal geladen; danach
 * schon — dann ist das erste wohl verloren gegangen.
 */
export const NEU_LADEN_GEDULD_MS = 15_000;

/** Länger wartet keine Frage auf ihre Antwort. */
export const ABFRAGE_FRIST_MS = 10_000;

/**
 * Was jünger ist, zählt als „gerade in Arbeit“: eine Seite, über die die App
 * noch entscheidet, und eine Claude-Seite, auf deren Abschrift gewartet wird.
 * Der Postbote braucht etwa eine Minute je Blatt; auch ein Stapel von zehn
 * Blättern ist in einer halben Stunde durch. Was danach noch so dasteht, ist
 * liegengeblieben — und keines, auf das man im 5-s-Takt warten müsste.
 */
export const IN_ARBEIT_MINUTEN = 30;

/**
 * Ein Korbblatt ohne Vorschlag zählt kürzer. Gewartet wird dort nur noch auf
 * den Vorschlag der App, rund zwanzig Sekunden nach der letzten Seite;
 * Claude-Seiten zählen schon über `IN_ARBEIT_MINUTEN`. Länger hieße: nach
 * „Verwerfen“ oder „Wieder in den Korb“ stünde „wird gerade gelesen“ da,
 * obwohl niemand mehr liest.
 */
export const KORB_FRISCH_MINUTEN = 10;

/**
 * Wer eben gescrollt oder mit Maus oder Finger gezeigt hat, zielt vielleicht
 * gerade auf einen Knopf. So lange danach wird nicht nachgeladen — sonst
 * rutscht im Korb eine andere Zeile unter den Finger, und „Übernehmen“ trifft
 * das falsche Blatt. Danach wird gleich noch einmal gefragt.
 */
export const BERUEHRT_RUHE_MS = 1_500;

/**
 * Was die Datenbank zählt, eine Zeile über alle Blätter eines Nutzers. Welcher
 * Schritt welche Zahl bewegt, steht an `blaetterStand()` in @/lib/materials.
 *
 * Zeitpunkte als ISO-Text in UTC, `angaben` als md5-Text: so geben PGlite und
 * postgres-js dasselbe heraus, und derselbe Stand ergibt auf beiden denselben
 * Fingerabdruck.
 */
export type StandZahlen = {
  blaetter: number;
  eingeordnet: number;
  neuestesBlatt: string | null;
  zuletztEingeordnet: string | null;
  /** md5 über Fach, Titel, Tag und Notiz aller Blätter. */
  angaben: string;
  /** Korbblätter ohne Vorschlag, jünger als `KORB_FRISCH_MINUTEN`. */
  frischImKorb: number;
  seiten: number;
  offen: number;
  docling: number;
  claude: number;
  /** Seiten mit Abschrift, auch der leeren. */
  gelesen: number;
  maschinell: number;
  abschriftBytes: number;
  neuesteSeite: string | null;
  /** Seiten, auf deren Lesen gerade gewartet wird (dort in der Abfrage). */
  seitenInArbeit: number;
  vorschlaege: number;
  neuesterVorschlag: string | null;
};

/** Ein Konto ohne ein einziges Blatt. */
export const LEERER_STAND: StandZahlen = {
  blaetter: 0,
  eingeordnet: 0,
  neuestesBlatt: null,
  zuletztEingeordnet: null,
  angaben: "",
  frischImKorb: 0,
  seiten: 0,
  offen: 0,
  docling: 0,
  claude: 0,
  gelesen: 0,
  maschinell: 0,
  abschriftBytes: 0,
  neuesteSeite: null,
  seitenInArbeit: 0,
  vorschlaege: 0,
  neuesterVorschlag: null,
};

/** Was `/api/material/stand` antwortet und die Seiten beim Rendern mitgeben. */
export type BlaetterStand = {
  stand: string;
  inArbeit: boolean;
};

/**
 * Die Zahlen als ein Text.
 *
 * Die Reihenfolge steht hier ausgeschrieben und kommt nicht aus
 * `Object.values()`: in welcher Folge die Schlüssel am Objekt hängen, ist eine
 * Eigenschaft des Treibers und nicht des Standes. JSON hält `null` und `""`
 * auseinander. Eine Versionsnummer braucht es nicht — ändert sich das Format
 * mit einem Deploy, lädt jeder offene Tab genau einmal nach und ist danach
 * wieder im Gleichen.
 */
export function fingerabdruck(z: StandZahlen): string {
  return JSON.stringify([
    z.blaetter,
    z.eingeordnet,
    z.neuestesBlatt,
    z.zuletztEingeordnet,
    z.angaben,
    z.frischImKorb,
    z.seiten,
    z.offen,
    z.docling,
    z.claude,
    z.gelesen,
    z.maschinell,
    z.abschriftBytes,
    z.neuesteSeite,
    z.seitenInArbeit,
    z.vorschlaege,
    z.neuesterVorschlag,
  ]);
}

/**
 * Wird gerade gelesen? Was dazu zählt, entscheidet die Abfrage; hier werden
 * nur ihre beiden Antworten zusammengelegt. `offen` und `claude` allein sagen
 * es nicht — eine Seite des Altbestands ohne Leser oder eine Claude-Seite,
 * deren Vorschlag schon liegt, wartet auf niemanden.
 */
export function inArbeitAus(z: StandZahlen): boolean {
  return z.seitenInArbeit > 0 || z.frischImKorb > 0;
}

/**
 * Die Antwort des Servers, wenn sie aussieht wie ein Stand — sonst `null`.
 * Überzählige Felder fallen weg: weitergereicht wird nur, was verglichen wird.
 */
export function antwortLesen(wert: unknown): BlaetterStand | null {
  if (typeof wert !== "object" || wert === null || Array.isArray(wert)) {
    return null;
  }

  const { stand, inArbeit } = wert as Record<string, unknown>;
  if (typeof stand !== "string" || typeof inArbeit !== "boolean") return null;

  return { stand, inArbeit };
}

/**
 * Wann die nächste Frage fällig ist, oder `null` für keine.
 *
 * Im versteckten Tab läuft kein Takt: dort sieht niemand hin, und am Handy
 * kostete jede Frage Akku. Nach einem Fehler wird ruhig weitergefragt, auch
 * wenn gerade gelesen wird — ein Server, der eben nicht antworten konnte,
 * bekommt keine fünf Sekunden später die nächste Frage. Wer abgemeldet ist,
 * bekommt gar keine mehr. `bald`: ein neuer Stand wartet nur darauf, dass
 * niemand mehr scrollt oder zeigt (`BERUEHRT_RUHE_MS`).
 */
export function naechsteAbfrageIn({
  sichtbar,
  inArbeit,
  fehler,
  abgemeldet,
  bald = false,
}: {
  sichtbar: boolean;
  inArbeit: boolean;
  fehler: boolean;
  abgemeldet: boolean;
  bald?: boolean;
}): number | null {
  if (abgemeldet || !sichtbar) return null;
  if (fehler) return TAKT_RUHIG_MS;
  if (bald) return BERUEHRT_RUHE_MS;

  return inArbeit ? TAKT_IN_ARBEIT_MS : TAKT_RUHIG_MS;
}

/** Zurück im Tab: sofort fragen — außer, es wurde eben erst gefragt. */
export function sofortFragen(jetzt: number, letzteAbfrage: number | null): boolean {
  return letzteAbfrage === null || jetzt - letzteAbfrage >= ZURUECK_ABSTAND_MS;
}

/** Diese `<input>` nehmen keinen Text auf — ein Fokus darauf sperrt nichts. */
const KEINE_EINGABE = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "hidden",
  "image",
  "range",
  "color",
]);

/**
 * Steht der Fokus in einem Feld, in das gerade getippt werden könnte?
 *
 * Ein Knopf, ein Link, ein Häkchen mit Fokus heißt nur, dass zuletzt dort
 * geklickt wurde. Ein Textfeld, eine Auswahl oder ein `contenteditable` heißt:
 * hier ist jemand mitten in etwas, und unter dem Finger darf sich nichts
 * verschieben.
 */
export function istEingabefeld({
  tag,
  typ,
  editierbar,
}: {
  tag: string;
  typ: string | null;
  editierbar: boolean;
}): boolean {
  if (editierbar) return true;

  const name = tag.toUpperCase();
  if (name === "TEXTAREA" || name === "SELECT") return true;
  if (name !== "INPUT") return false;

  return !KEINE_EINGABE.has((typ ?? "text").toLowerCase());
}

/**
 * Was gerade gegen ein Nachladen spricht, das Schwerste zuerst.
 *
 * - `aufnahme`: der Auslöser lädt hoch oder der Sucher ist offen. Er lädt am
 *   Ende selbst nach, und über dem Sucher darf nichts aufgehen.
 * - `ungespeichert`: in einem Formular steht etwas, das der Server nicht kennt.
 * - `fokus`: jemand steht in einem Eingabefeld, ohne schon etwas geändert zu
 *   haben.
 * - `beruehrt`: eben wurde gescrollt oder gezeigt (`BERUEHRT_RUHE_MS`).
 */
export type Sperre = "keine" | "aufnahme" | "ungespeichert" | "fokus" | "beruehrt";

export function sperreAus({
  aufnahme,
  ungespeichert,
  fokus,
  beruehrt = false,
}: {
  aufnahme: boolean;
  ungespeichert: boolean;
  fokus: boolean;
  beruehrt?: boolean;
}): Sperre {
  if (aufnahme) return "aufnahme";
  if (ungespeichert) return "ungespeichert";
  if (fokus) return "fokus";
  if (beruehrt) return "beruehrt";

  return "keine";
}

/** Ein Nachladen, das schon unterwegs ist: für welchen Stand, seit wann. */
export type Anstoss = { stand: string; seit: number };

/** `spaeter`: nachladen, sobald niemand mehr scrollt — gleich noch einmal fragen. */
export type Entscheidung = "nichts" | "neu-laden" | "hinweis" | "spaeter";

/**
 * Was mit einer Antwort zu tun ist.
 *
 * Verglichen wird mit `bekannt`, dem Stand, mit dem die Seite wirklich
 * gerendert wurde — nicht mit der letzten Antwort. Nach jedem Nachladen und
 * jedem Speichern kommt ein neuer, und damit stimmt die Grundlage von selbst;
 * eine Schleife aus Nachladen und Nachladen kann so nicht entstehen.
 *
 * Geändert und gesperrt heißt bei ungespeicherten Eingaben oder einem Fokus im
 * Feld: ein Hinweis statt des Nachladens. Eingaben gehen vor.
 */
export function entscheiden({
  bekannt,
  neu,
  sperre,
  angestossen,
  jetzt,
}: {
  bekannt: string;
  neu: string;
  sperre: Sperre;
  angestossen: Anstoss | null;
  jetzt: number;
}): Entscheidung {
  if (neu === bekannt) return "nichts";
  if (sperre === "aufnahme") return "nichts";

  if (
    angestossen !== null &&
    angestossen.stand === neu &&
    jetzt - angestossen.seit < NEU_LADEN_GEDULD_MS
  ) {
    return "nichts";
  }

  if (sperre === "ungespeichert" || sperre === "fokus") return "hinweis";
  if (sperre === "beruehrt") return "spaeter";

  return "neu-laden";
}

/**
 * Was ein Druck auf „Neu laden“ tun darf.
 *
 * Der Knopf erscheint, wenn eine Frage nur einen Fokus im Feld fand, und steht
 * bis zur nächsten — im ruhigen Takt bis zu dreißig Sekunden. In der Zeit kann
 * jemand getippt haben, und ein Nachladen kostete das Getippte
 * (`savedMark` in material-form.tsx, der Schlüssel auf der Vorschlagsseite).
 * Deshalb wird beim Druck noch einmal nachgesehen: Ungespeichertes macht aus
 * dem Knopf den Hinweis ohne Knopf, eine laufende Aufnahme lässt ihn still
 * verschwinden (der Auslöser lädt selbst nach). Fokus und Berührung zählen
 * hier nicht — wer den Knopf drückt, will nachladen.
 */
export function beimKnopf(sperre: Sperre): Entscheidung {
  if (sperre === "aufnahme") return "nichts";
  if (sperre === "ungespeichert") return "hinweis";

  return "neu-laden";
}
