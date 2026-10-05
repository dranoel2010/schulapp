import { createHash } from "node:crypto";

import type { IservFehler } from "@/lib/iserv/client";
import { QUELL_NAMEN, type IservItem, type IservQuelle } from "@/lib/iserv/types";

/**
 * Eine leere oder kaputte Antwort darf NIE wie „alles gelöscht" aussehen.
 *
 * Reine Rechnung. Was eine Quelle nicht mehr liefert, nimmt der Abgleich aus
 * Google (@/lib/calendar/plan) — dieselbe Warnung wie dort: Ein Schluss, der
 * sich auf etwas stützt, das NICHT da ist, ist der gefährliche. Eine Wartung
 * bei IServ, ein Formatwechsel, ein Gruppenkalender, den die Schule zum
 * Schuljahr leert — jedes davon sähe ohne diese Datei aus wie hundert
 * gelöschte Termine. Deshalb wird je Quelle verglichen, was neu kommt, mit
 * dem, was zuletzt galt:
 *
 *   uebernehmen  der neue Stand gilt
 *   behalten     der alte Stand bleibt; der neue wird gemerkt (`ausstehend`)
 *   fehler       nichts kam an; der alte Stand bleibt
 *
 * ── Verdächtig ───────────────────────────────────────────────────────────────
 *
 * Waren im Fenster Termine und kommt keiner, oder waren es mindestens zehn und
 * kommt weniger als die Hälfte, ist die Antwort verdächtig. Sie wird erst
 * übernommen, wenn sie DREIMAL genau so kommt (gleicher Fingerprint der
 * Schlüssel) — im 3-Stunden-Takt also nach frühestens sechs Stunden. Schon
 * EIN Termin zählt: Im Klassenkalender sind ein oder zwei Termine der
 * Normalfall, und gerade die sollen nicht nach einer einzigen leeren Antwort
 * verschwinden. Der öffentliche Kalender leer ist NIE echt: Ein Schuljahr ohne
 * einen einzigen Schultermin gibt es nicht; das bleibt ein Fehler, so oft es
 * auch kommt.
 *
 * ── Eine Quelle, die fehlt, ist keine leere Quelle ──────────────────────────
 *
 * Findet die App den Klassenkalender oder das Aufgaben-Plugin nicht mehr
 * (`fehlt`), weiß sie nicht, was darin steht. Stehen aus dieser Quelle noch
 * Termine im Fenster, ist das ein Fehler: Der alte Stand bleibt, und der Lauf
 * meldet sich als „teilweise“ (Cron 500, Karte). Erst wenn ihre Termine alle
 * vergangen sind, gilt sie als leer — dann verschwindet aus Google nichts,
 * was noch kommt.
 *
 * ── Vergangenes wird eingefroren ─────────────────────────────────────────────
 *
 * Das Fenster reicht 14 Tage zurück. Was davor liegt, liefert IServ nicht
 * mehr — und fehlte es im neuen Stand, nähme der Abgleich es aus Google. Also
 * bleiben alte Termine, die vor dem Fenster enden und im neuen Stand fehlen,
 * im Snapshot stehen, mit dem Urteil von JETZT eingefroren (`fest`). Eine
 * spätere Änderung an ISERV_AUCH oder ISERV_NIE schreibt die Vergangenheit
 * damit nicht um.
 */

export type Snapshot = {
  quelle: IservQuelle;
  remoteId: string;
  label: string;
  items: IservItem[];
  /** Wann dieser Stand übernommen wurde */
  fetchedAt: Date;
  /** Letzte Antwort dieser Quelle, auch eine zurückgehaltene */
  gesehenAm: Date;
  ausstehend: { fingerprint: string; anzahl: number; seit: Date } | null;
};

export type QuellAntwort =
  | { art: "ok"; items: IservItem[]; remoteId: string; label: string }
  | { art: "fehler"; fehler: Pick<IservFehler, "satz" | "art" | "sperrt"> }
  | { art: "fehlt"; grund: string };

export type Pruefung = {
  entscheidung: "uebernehmen" | "behalten" | "fehler";
  /** Was zu speichern ist — null: nichts schreiben */
  neu: Snapshot | null;
  warnung: string | null;
  satz: string | null;
};

/** Wie oft dieselbe verdächtige Antwort kommen muss, bis sie gilt. */
export const BESTAETIGUNGEN = 3;

/** SHA-256 über die sortierten Schlüssel — gleiche Termine, gleicher Abdruck, egal in welcher Reihenfolge. */
export function fingerprint(items: readonly Pick<IservItem, "fremdId">[]): string {
  const ids = items.map((item) => item.fremdId).sort();
  return createHash("sha256").update(ids.join("\n"), "utf8").digest("hex");
}

export function pruefe(input: {
  quelle: IservQuelle;
  alt: Snapshot | null;
  antwort: QuellAntwort;
  /** Erster Tag des Abruf-Fensters (heute − 14) */
  fensterStart: string;
  jetzt: Date;
  /** Das Urteil von jetzt — zum Einfrieren */
  beurteile: (item: IservItem) => { genommen: boolean; regel: string };
}): Pruefung {
  const { quelle, alt, antwort, jetzt } = input;
  const name = QUELL_NAMEN[quelle];

  // 1. Nichts kam an.
  if (antwort.art === "fehler") {
    return { entscheidung: "fehler", neu: null, warnung: null, satz: antwort.fehler.satz };
  }

  // Was im alten Stand noch kommt: im Fenster und nicht eingefroren.
  const nAlt = (alt?.items ?? []).filter((item) => !item.fest && item.letzterTag >= input.fensterStart).length;

  // 2. Die Quelle gibt es nicht (mehr). Der öffentliche Kalender ist Pflicht.
  //    Klassenkalender und Aufgaben: Stehen noch Termine im Fenster, ist das
  //    ein Fehler — sonst gelten sie als leer.
  let items: IservItem[];
  let remoteId: string;
  let label: string;
  let warnung: string | null = null;

  if (antwort.art === "fehlt") {
    if (quelle === "oeffentlich") {
      return { entscheidung: "fehler", neu: null, warnung: null, satz: antwort.grund };
    }
    if (nAlt > 0) {
      return {
        entscheidung: "fehler",
        neu: null,
        warnung: null,
        satz: `${antwort.grund} Der alte Stand (${nAlt} Termine) bleibt.`,
      };
    }
    items = [];
    remoteId = alt?.remoteId ?? "";
    label = alt?.label ?? name;
    warnung = antwort.grund;
  } else {
    items = antwort.items;
    remoteId = antwort.remoteId;
    label = antwort.label;
  }

  const uebernehmen = (zusatz: string | null): Pruefung => {
    const neuIds = new Set(items.map((item) => item.fremdId));
    const eingefroren = (alt?.items ?? [])
      .filter((item) => !neuIds.has(item.fremdId) && item.letzterTag < input.fensterStart)
      .map((item) => (item.fest ? item : { ...item, fest: input.beurteile(item) }));

    return {
      entscheidung: "uebernehmen",
      neu: {
        quelle,
        remoteId,
        label,
        items: [...items, ...eingefroren],
        fetchedAt: jetzt,
        gesehenAm: jetzt,
        ausstehend: null,
      },
      warnung: [warnung, zusatz].filter(Boolean).join(" ") || null,
      satz: null,
    };
  };

  // 5. Erster Abruf: nichts zu schützen.
  if (alt === null) return uebernehmen(null);

  // 3. Verdächtig?
  const nNeu = items.length;

  if (quelle === "oeffentlich" && nNeu === 0 && nAlt >= 3) {
    return {
      entscheidung: "fehler",
      neu: null,
      warnung: null,
      satz: "IServ liefert den öffentlichen Kalender leer — alter Stand bleibt.",
    };
  }

  const verdaechtig = (nAlt >= 1 && nNeu === 0) || (nAlt >= 10 && nNeu < nAlt / 2);
  if (!verdaechtig) return uebernehmen(null);

  const abdruck = fingerprint(items);
  const ausstehend =
    alt.ausstehend && alt.ausstehend.fingerprint === abdruck
      ? { fingerprint: abdruck, anzahl: alt.ausstehend.anzahl + 1, seit: alt.ausstehend.seit }
      : { fingerprint: abdruck, anzahl: 1, seit: jetzt };

  if (ausstehend.anzahl >= BESTAETIGUNGEN) {
    return uebernehmen(
      `${name}: nach ${BESTAETIGUNGEN} gleichen Antworten übernommen — jetzt ${nNeu} statt ${nAlt} Termine.`,
    );
  }

  return {
    entscheidung: "behalten",
    neu: { ...alt, gesehenAm: jetzt, ausstehend },
    warnung: [
      warnung,
      `${name}: ${nNeu} statt ${nAlt} Termine — alter Stand bleibt, bis es ${BESTAETIGUNGEN}-mal so kommt (${ausstehend.anzahl} von ${BESTAETIGUNGEN}).`,
    ]
      .filter(Boolean)
      .join(" "),
    satz: null,
  };
}
