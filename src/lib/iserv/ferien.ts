import { addDays, daysBetween } from "@/lib/dates";
import { MAX_FREE_DAYS, type FreeKind } from "@/lib/free-days";
import { istFerienTitel, istFreiTitel, urteil, type FilterConfig } from "@/lib/iserv/klasse";
import { sprechName } from "@/lib/iserv/sprechtitel";
import type { IservItem } from "@/lib/iserv/types";

/**
 * Ferien und unterrichtsfreie Tage aus IServ — als freie Tage der App.
 *
 * Bis zum 12.10.2026 schrieb IServ nie in `free_periods`: Die Ferien trug der
 * Mensch von Hand ein, und die Landesferien aus IServ galten an dieser Schule
 * als falsch. Beides ist überholt. Der Nutzer hat bestätigt, dass die Ferien
 * aus IServ stimmen („ne die aus iserv sind richtig“), und die Seite zum
 * Eintragen gibt es seit Modell 23 nicht mehr. Seitdem legt der Abruf bei
 * IServ (@/lib/iserv/abruf) die freien Tage selbst an. Frei heißt weiter ganz
 * frei: kein Unterricht, keine Lernblöcke, kein Abruf, keine Erinnerung.
 *
 * Reine Rechnung, in zwei Schritten:
 *
 *   1. `ferienAusIserv()` — welche freien Zeiträume IServ meldet;
 *   2. `ferienPlan()`     — was dafür an den Zeilen der App zu tun ist.
 *
 * Geschrieben wird in @/lib/iserv/store (`saveRun`), in derselben Transaktion
 * wie die Snapshots.
 *
 * ── Was ein freier Zeitraum aus IServ ist ────────────────────────────────────
 *
 *   a) jeder ganztägige Eintrag des Plugins „holiday“ (Ferien und
 *      gesetzliche Feiertage);
 *   b) eine ganztägige Ferien- oder Frei-Meldung des öffentlichen Kalenders
 *      (`istFreiTitel()`: Ferien, unterrichtsfrei, schulfrei, „Schule
 *      geschlossen“), die der Klassenfilter (@/lib/iserv/klasse) für die
 *      eigene Klasse gelten lässt — für alle (Regel c, „alle-unterricht“, auch
 *      „knapp“ trotz Hort-Erwähnung, wenn die SCHULE zu ist) oder ausdrücklich
 *      für sie („eigene-klasse“, „bereich“).
 *
 * Nie: ein Termin mit Uhrzeit („Unterrichtsende 11:30“ ist ein Schultag), Hort
 * und Ferienbetreuung (der Filter lässt sie draußen; „Hort geschlossen“ ist
 * kein schulfreier Tag), eine AG, ein Termin einer anderen Klasse, alles, was
 * ISERV_NIE ausschließt. Auch nichts aus dem Klassenkalender und den
 * Aufgaben: Eine Abgabe am letzten Ferientag ist eine Abgabe, keine Ferien.
 *
 * ── Doppelte und Überschneidungen ────────────────────────────────────────────
 *
 * Plugin und öffentlicher Kalender melden dieselben Herbstferien — das Plugin
 * etwa Montag bis Freitag, der Schulkalender Samstag bis Samstag. Was sich um
 * mindestens einen Tag überschneidet, wird EIN Zeitraum, vom frühesten Anfang
 * bis zum spätesten Ende. Ein Feiertag in den Ferien geht darin auf. Was nur
 * aneinandergrenzt (der pädagogische Tag vor den Herbstferien), bleibt ein
 * eigener Zeitraum mit eigenem Namen.
 *
 * Der Name ist der, den ein Bot vorlesen kann (@/lib/iserv/sprechtitel):
 * „Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026“ heißt „Herbstferien“. Kommen
 * mehrere zusammen, gewinnt Ferien vor Feiertag, das Plugin vor dem
 * Schulkalender.
 *
 * ── Tage ─────────────────────────────────────────────────────────────────────
 *
 * Die Tage kommen fertig aus @/lib/iserv/parse: Berliner Kalendertage, das
 * exklusive Ende von IServ schon in ein inklusives umgerechnet.
 */

/** Ein freier Zeitraum, den IServ meldet — schon zusammengeführt. */
export type FerienWunsch = {
  /** Der Schlüssel, unter dem die Zeile steht (`iserv_key`) */
  schluessel: string;
  /** Alle Schlüssel der zusammengeführten Einträge — daran wird eine Zeile wiedererkannt */
  alleSchluessel: string[];
  kind: Extract<FreeKind, "ferien" | "frei">;
  /** Höchstens 60 Zeichen, nie leer */
  title: string;
  startsOn: string;
  /** Inklusiv */
  endsOn: string;
};

/** Regeln des Klassenfilters, mit denen eine Frei-Meldung für die eigene Klasse gilt. */
const NIMMT: ReadonlySet<string> = new Set([
  "alle-unterricht",
  "unterricht-trotz-marker",
  "eigene-klasse",
  "bereich",
]);

/** So lang darf ein Name sein — wie im Formular, das es früher gab (@/lib/free-days). */
const TITEL_MAX = 60;

type Kandidat = {
  schluessel: string;
  kind: FerienWunsch["kind"];
  title: string;
  startsOn: string;
  endsOn: string;
  /** 0 Plugin, 1 Schulkalender */
  vorrang: number;
};

function kurz(titel: string): string {
  const t = titel.trim();
  return t.length <= TITEL_MAX ? t : `${t.slice(0, TITEL_MAX - 1).trimEnd()}…`;
}

function kandidat(item: IservItem, filter: FilterConfig): Kandidat | null {
  if (item.fest || !item.ganztaegig) return null;
  if (daysBetween(item.ersterTag, item.letzterTag) >= MAX_FREE_DAYS) return null;

  if (item.quelle === "oeffentlich") {
    const eingabe = { titel: item.titel, ganztaegig: true };
    if (!istFreiTitel(eingabe)) return null;
    const u = urteil(eingabe, filter);
    if (!u.nehmen || !NIMMT.has(u.regel)) return null;
  } else if (item.quelle !== "ferien") {
    return null;
  }

  const name = sprechName(item, filter.klasse);
  const kind = name.ferien || istFerienTitel(item.titel) ? "ferien" : "frei";

  return {
    schluessel: item.fremdId,
    kind,
    title: kurz(name.name) || (kind === "ferien" ? "Ferien" : "Schulfrei"),
    startsOn: item.ersterTag,
    endsOn: item.letzterTag,
    vorrang: item.quelle === "ferien" ? 0 : 1,
  };
}

/** Wer einer Gruppe den Namen gibt: Ferien vor Feiertag, Plugin vor Schulkalender, der längere, dann der Schlüssel. */
function besser(a: Kandidat, b: Kandidat): number {
  if (a.kind !== b.kind) return a.kind === "ferien" ? -1 : 1;
  if (a.vorrang !== b.vorrang) return a.vorrang - b.vorrang;
  const la = daysBetween(a.startsOn, a.endsOn);
  const lb = daysBetween(b.startsOn, b.endsOn);
  if (la !== lb) return lb - la;
  return a.schluessel < b.schluessel ? -1 : a.schluessel > b.schluessel ? 1 : 0;
}

/**
 * Die freien Zeiträume, die IServ meldet und die heute oder später noch
 * gelten — zusammengeführt, nach Anfang sortiert.
 */
export function ferienAusIserv(input: {
  items: readonly IservItem[];
  filter: FilterConfig;
  heute: string;
}): FerienWunsch[] {
  const kandidaten = input.items
    .map((item) => kandidat(item, input.filter))
    .filter((k): k is Kandidat => k !== null && k.endsOn >= input.heute)
    .sort((a, b) => (a.startsOn !== b.startsOn ? (a.startsOn < b.startsOn ? -1 : 1) : besser(a, b)));

  const gruppen: Kandidat[][] = [];
  let ende = "";
  for (const k of kandidaten) {
    const letzte = gruppen.at(-1);
    if (letzte && k.startsOn <= ende) {
      letzte.push(k);
      if (k.endsOn > ende) ende = k.endsOn;
    } else {
      gruppen.push([k]);
      ende = k.endsOn;
    }
  }

  return gruppen.map((gruppe) => {
    const kopf = [...gruppe].sort(besser)[0];
    return {
      schluessel: kopf.schluessel,
      alleSchluessel: [...new Set(gruppe.map((k) => k.schluessel))].sort(),
      kind: gruppe.some((k) => k.kind === "ferien") ? "ferien" : "frei",
      title: kopf.title,
      startsOn: gruppe.reduce((min, k) => (k.startsOn < min ? k.startsOn : min), gruppe[0].startsOn),
      endsOn: gruppe.reduce((max, k) => (k.endsOn > max ? k.endsOn : max), gruppe[0].endsOn),
    };
  });
}

/** Eine Zeile aus `free_periods` mit `quelle = 'iserv'`. */
export type IservFreiZeile = {
  id: string;
  iservKey: string;
  kind: string;
  title: string | null;
  startsOn: string;
  endsOn: string;
};

export type FerienAenderung = {
  id: string;
  iservKey: string;
  kind: string;
  title: string | null;
  startsOn: string;
  endsOn: string;
};

export type FerienPlan = {
  neu: FerienWunsch[];
  aendern: FerienAenderung[];
  /** ids */
  loeschen: string[];
};

/**
 * Was an den IServ-Zeilen der App zu tun ist, damit sie dem entsprechen, was
 * IServ meldet. Von Hand eingetragene Zeilen kommen hier gar nicht erst an
 * (der Store liest nur `quelle = 'iserv'`).
 *
 * Wiedererkannt wird eine Zeile zuerst an ihrem Schlüssel (irgendeiner der
 * zusammengeführten), dann an einer Überschneidung — so bleibt sie dieselbe
 * Zeile (und derselbe Balken in Google), auch wenn IServ die Ferien
 * verschiebt oder ein Schlüssel wechselt.
 *
 * Vergangene freie Tage bleiben stehen:
 *
 *   - eine Zeile, die vor heute endete, wird nie gelöscht und nie gekürzt —
 *     höchstens verlängert, wenn IServ unter ihrem Schlüssel weiter meldet;
 *   - eine laufende Zeile (Anfang vor heute), die IServ nicht mehr meldet,
 *     endet gestern, statt zu verschwinden;
 *   - der Anfang einer laufenden Zeile rückt nie nach vorn.
 *
 * Die Wünsche kommen aus den Snapshots, die @/lib/iserv/schutz bewacht: Eine
 * leere oder kaputte Antwort von IServ ändert den Snapshot nicht — und damit
 * auch keine Zeile hier.
 */
export function ferienPlan(
  bestehend: readonly IservFreiZeile[],
  wuensche: readonly FerienWunsch[],
  heute: string,
): FerienPlan {
  const gestern = addDays(heute, -1);
  const vergangen = (z: IservFreiZeile) => z.endsOn < heute;

  const frei = new Set(bestehend.map((z) => z.id));
  const paare: { zeile: IservFreiZeile; wunsch: FerienWunsch }[] = [];
  const ohne: FerienWunsch[] = [];

  // 1. Am Schlüssel.
  for (const wunsch of wuensche) {
    const zeile = bestehend.find((z) => frei.has(z.id) && wunsch.alleSchluessel.includes(z.iservKey));
    if (zeile) {
      frei.delete(zeile.id);
      paare.push({ zeile, wunsch });
    } else {
      ohne.push(wunsch);
    }
  }

  // 2. An der Überschneidung — nur mit Zeilen, die noch gelten.
  const neu: FerienWunsch[] = [];
  for (const wunsch of ohne) {
    const zeile = bestehend.find(
      (z) => frei.has(z.id) && !vergangen(z) && z.startsOn <= wunsch.endsOn && wunsch.startsOn <= z.endsOn,
    );
    if (zeile) {
      frei.delete(zeile.id);
      paare.push({ zeile, wunsch });
    } else {
      neu.push(wunsch);
    }
  }

  const aendern: FerienAenderung[] = [];
  for (const { zeile, wunsch } of paare) {
    const startsOn =
      zeile.startsOn < heute && zeile.startsOn < wunsch.startsOn ? zeile.startsOn : wunsch.startsOn;
    const endsOn = vergangen(zeile) && zeile.endsOn > wunsch.endsOn ? zeile.endsOn : wunsch.endsOn;
    const iservKey = wunsch.alleSchluessel.includes(zeile.iservKey) ? zeile.iservKey : wunsch.schluessel;
    const soll = { id: zeile.id, iservKey, kind: wunsch.kind, title: wunsch.title, startsOn, endsOn };

    if (
      soll.iservKey !== zeile.iservKey ||
      soll.kind !== zeile.kind ||
      soll.title !== zeile.title ||
      soll.startsOn !== zeile.startsOn ||
      soll.endsOn !== zeile.endsOn
    ) {
      aendern.push(soll);
    }
  }

  // 3. Was IServ nicht mehr meldet.
  const loeschen: string[] = [];
  for (const zeile of bestehend) {
    if (!frei.has(zeile.id) || vergangen(zeile)) continue;
    if (zeile.startsOn < heute) {
      aendern.push({ ...zeile, endsOn: gestern });
    } else {
      loeschen.push(zeile.id);
    }
  }

  return { neu, aendern, loeschen };
}

/** Hat der Plan etwas zu tun? */
export function planTutEtwas(plan: FerienPlan): boolean {
  return plan.neu.length + plan.aendern.length + plan.loeschen.length > 0;
}
