import { iservEvent, type WantedEvent } from "@/lib/calendar/events";
import { addDays, daysBetween, timeInBerlin, weekdayIndex } from "@/lib/dates";
import type { FreeRange } from "@/lib/free-days";
import { istFreiTitel, urteil, type FilterConfig } from "@/lib/iserv/klasse";
import type { IservItem, IservQuelle } from "@/lib/iserv/types";

/**
 * Was aus IServ in den Kalender „Schule" kommt — und was nicht, mit Grund.
 *
 * Reine Rechnung: Die Snapshots der drei Quellen, die Konfiguration und
 * die freien Tage der App gehen hinein, heraus kommen die Wünsche für Google
 * (@/lib/calendar/sources) und die Listen für die Karte in den Einstellungen.
 *
 * ── Je Termin, in dieser Reihenfolge ─────────────────────────────────────────
 *
 *   a) eingefroren (`fest`)  → wie damals entschieden (@/lib/iserv/schutz)
 *   b) Klassenkalender       → ganz
 *   c) Aufgaben              → ganz
 *   d) öffentlicher Kalender → nur, was der Filter nimmt (@/lib/iserv/klasse)
 *   e) freie Tage            → eine ganztägige Ferien- oder Frei-Meldung aus
 *                              dem öffentlichen Kalender entfällt, wenn die
 *                              App jeden ihrer Werktage schon als frei kennt
 *
 * ── Warum e): Ferien nicht doppelt ───────────────────────────────────────────
 *
 * Die App trägt ihre freien Tage (free_periods) selbst in „Schule" ein, als
 * Basilikum-Balken. Stehen die Herbstferien dort schon, wäre ein zweiter
 * Balken „IServ: Herbstferien…" in Pfau nur Lärm. Umgekehrt schreibt IServ NIE
 * in free_periods: Was frei ist, entscheidet der Mensch von Hand — die
 * Landesferien aus IServ sind an dieser Schule sogar falsch. Deshalb gilt die
 * Richtung nur so herum: Kennt die App die Tage, entfällt der IServ-Termin;
 * kennt sie sie nicht, steht er da — und ist dann der Hinweis, dass in den
 * Einstellungen etwas fehlt.
 *
 * Entfallen darf nur, was SELBST sagt, dass frei ist (`istFreiTitel()`:
 * Ferien, unterrichtsfrei, schulfrei, „Schule geschlossen“) und aus dem
 * öffentlichen Kalender kommt — denn nur das ist ein Doppel der freien Tage.
 * Eine Abgabe im Klassenkalender am letzten Ferientag, eine Fahrt der eigenen
 * Klasse während einer Klassenfahrt-Zeit der App, ein Schulsamstag: Das sind
 * Termine, keine Ferien, und sie bleiben stehen, auch wenn ihre Tage frei sind.
 * Der Klassenkalender kommt ganz, die Aufgaben auch.
 *
 * Geprüft werden die Werktage (Mo–Fr): Herbstferien von Samstag bis Samstag
 * sind gedeckt, wenn die App Montag bis Freitag kennt. Ein Termin nur am
 * Wochenende braucht alle seine Tage. Termine mit Uhrzeit und Punkt-Termine
 * entfallen nie.
 *
 * ── Doppelte ─────────────────────────────────────────────────────────────────
 *
 * Steht derselbe Termin (dieselbe uid) in zwei Kalendern, gewinnt der
 * Klassenkalender vor dem öffentlichen vor den Aufgaben, und der zweite zählt
 * als `doppelt`. collectWishes() darf nie einen Schlüssel zweimal sehen — es
 * würfe die ganze Art weg.
 */

export type Eintrag = {
  quelle: IservQuelle;
  /** Erster Tag */
  tag: string;
  /** Letzter Tag, inklusiv */
  bisTag: string;
  /** "HH:MM" in Berlin, wenn IServ eine Uhrzeit nennt */
  uhrzeit: string | null;
  titel: string;
  grund: string;
  regel: string;
};

export type IservAuswertung = {
  wuensche: WantedEvent[];
  genommen: Eintrag[];
  knapp: Eintrag[];
  zweifel: Eintrag[];
  ausgelassenFrei: Eintrag[];
  ausgeschlossen: number;
  doppelt: number;
};

/** Das Urteil über einen einzelnen Termin, mit Schritt e). */
export type EinzelUrteil = {
  genommen: boolean;
  regel: string;
  grund: string;
  knapp: boolean;
  zweifel: boolean;
  /** Genommen, aber wegen freier Tage ausgelassen */
  frei: boolean;
};

const VORRANG: Record<IservQuelle, number> = { klasse: 0, oeffentlich: 1, aufgaben: 2 };

/** Längster Termin, dessen Tage einzeln geprüft werden — darüber ist er sicher keine Feriensache der App. */
const MAX_TAGE = 120;

/**
 * Kennt die App jeden Werktag dieses Zeitraums als frei? Hat er keinen
 * Werktag, zählen alle Tage. Gerechnet nur mit `addDays()` und `weekdayIndex()`.
 */
export function vonFreienTagenGedeckt(
  ersterTag: string,
  letzterTag: string,
  freieZeiten: readonly Pick<FreeRange, "startsOn" | "endsOn">[],
): boolean {
  if (freieZeiten.length === 0) return false;

  const anzahl = daysBetween(ersterTag, letzterTag) + 1;
  if (anzahl < 1 || anzahl > MAX_TAGE) return false;

  const tage: string[] = [];
  for (let i = 0; i < anzahl; i += 1) tage.push(addDays(ersterTag, i));

  const werktage = tage.filter((tag) => weekdayIndex(tag) < 5);
  const pruefen = werktage.length > 0 ? werktage : tage;

  return pruefen.every((tag) =>
    freieZeiten.some((zeit) => zeit.startsOn <= tag && tag <= zeit.endsOn),
  );
}

/** Ein Termin, für sich beurteilt — a) bis e). */
export function beurteileEinzeln(
  item: IservItem,
  filter: FilterConfig,
  freieZeiten: readonly Pick<FreeRange, "startsOn" | "endsOn">[],
): EinzelUrteil {
  if (item.fest) {
    return {
      genommen: item.fest.genommen,
      regel: item.fest.regel,
      grund: "vergangen — so stehen geblieben, wie zuletzt entschieden",
      knapp: false,
      zweifel: false,
      frei: false,
    };
  }

  let ergebnis: EinzelUrteil;

  if (item.quelle === "klasse") {
    ergebnis = { genommen: true, regel: "klassenkalender", grund: "Kalender deiner Klasse", knapp: false, zweifel: false, frei: false };
  } else if (item.quelle === "aufgaben") {
    ergebnis = { genommen: true, regel: "aufgabe", grund: "deine Aufgabe", knapp: false, zweifel: false, frei: false };
  } else {
    const u = urteil({ titel: item.titel, ganztaegig: item.ganztaegig }, filter);
    ergebnis = u.nehmen
      ? { genommen: true, regel: u.regel, grund: u.grund, knapp: u.knapp, zweifel: false, frei: false }
      : { genommen: false, regel: u.regel, grund: u.grund, knapp: false, zweifel: u.zweifel, frei: false };
  }

  if (
    ergebnis.genommen &&
    item.quelle === "oeffentlich" &&
    item.ganztaegig &&
    istFreiTitel({ titel: item.titel, ganztaegig: item.ganztaegig }) &&
    vonFreienTagenGedeckt(item.ersterTag, item.letzterTag, freieZeiten)
  ) {
    return {
      genommen: false,
      regel: "freie-tage",
      grund: "Ferien oder frei — die App kennt diese Tage schon als frei",
      knapp: false,
      zweifel: false,
      frei: true,
    };
  }

  return ergebnis;
}

function eintrag(item: IservItem, u: EinzelUrteil): Eintrag {
  return {
    quelle: item.quelle,
    tag: item.ersterTag,
    bisTag: item.letzterTag,
    uhrzeit: !item.ganztaegig && item.beginn ? timeInBerlin(new Date(item.beginn)) : null,
    titel: item.titel,
    grund: u.grund,
    regel: u.regel,
  };
}

export function iservAuswahl(input: {
  items: readonly IservItem[];
  filter: FilterConfig;
  freieZeiten: readonly Pick<FreeRange, "startsOn" | "endsOn">[];
  iservOrigin: string;
  appOrigin: string;
}): IservAuswertung {
  const sortiert = [...input.items].sort((a, b) => VORRANG[a.quelle] - VORRANG[b.quelle]);
  const gesehen = new Set<string>();

  const auswertung: IservAuswertung = {
    wuensche: [],
    genommen: [],
    knapp: [],
    zweifel: [],
    ausgelassenFrei: [],
    ausgeschlossen: 0,
    doppelt: 0,
  };

  for (const item of sortiert) {
    if (gesehen.has(item.fremdId)) {
      auswertung.doppelt += 1;
      continue;
    }
    gesehen.add(item.fremdId);

    const u = beurteileEinzeln(item, input.filter, input.freieZeiten);
    const zeile = eintrag(item, u);

    if (u.genommen) {
      auswertung.genommen.push(zeile);
      if (u.knapp) auswertung.knapp.push(zeile);
      auswertung.wuensche.push(
        iservEvent({ item, iservOrigin: input.iservOrigin, appOrigin: input.appOrigin }),
      );
    } else if (u.frei) {
      auswertung.ausgelassenFrei.push(zeile);
    } else if (u.zweifel) {
      auswertung.zweifel.push(zeile);
    } else {
      auswertung.ausgeschlossen += 1;
    }
  }

  auswertung.wuensche.sort((a, b) =>
    a.firstDay !== b.firstDay ? (a.firstDay < b.firstDay ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  return auswertung;
}
