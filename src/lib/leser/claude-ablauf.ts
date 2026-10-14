import type { Leser, LeserLaufAbbruch, LeserLaufArt, LeserLaufErgebnis } from "@/db/schema";
import type { BlattVorschlagErgebnis } from "@/lib/blatt-vorschlag";
import { dollar } from "@/lib/claude/ergebnis";
import { berlinDay, formatGerman, timeInBerlin } from "@/lib/dates";

import type { AuftragsSeite, EinordnenVorab, NachleseVorab } from "./claude-auftrag";

/**
 * Wann der Leser der App liest, was, und was er sich danach merkt — reine
 * Rechnung, ohne Netz und ohne Datenbank (seit dem 11.10.2026). Die
 * Abfragen dazu stehen in @/lib/leser/laeufe, den Ablauf mit Queue und
 * Weckern führt @/lib/leser/claude-leser.
 *
 * Alles hier war bis zu diesem Tag die Schleife des Postboten
 * (harness/postbote.mts): `offene()`, `ruhig()`, `korbSchluessel()`, die
 * Pause nach einem leeren Kontingent. Die Regeln sind geblieben, nur das
 * Gedächtnis ist umgezogen — aus `gesehen.json` neben dem Dienst in die
 * Tabelle `leser_laeufe`, und dort hat es einen Grund mehr als vorher: jeder
 * Lauf kostet jetzt Geld vom API-Schlüssel.
 */

// ── Die drei Arten ───────────────────────────────────────────────────────────

/**
 * Wie der Leser an ein Blatt geht.
 *
 * - `einordnen`: ein Blatt im Korb ohne Vorschlag — abschreiben und Titel,
 *   ein Thema und die Notiz vorschlagen; danach ordnet Jev ein.
 * - `nachlese`: nachgereichte, ungelesene Seiten an einem eingeordneten Blatt
 *   — NUR abschreiben.
 * - `von-hand`: der Knopf am Blatt. Fragt das Gedächtnis nicht und liest an
 *   einem eingeordneten Blatt jede ungelesene Seite, die nicht Docling gehört
 *   — der Weg für die Altblätter und nach einem „nichts“. Ersetzt
 *   harness/nachlese.mts und `postbote --blatt`. Nur eines fragt auch er:
 *   ob gerade ein Lauf an dem Blatt unterwegs ist (`laeuftNochMs`).
 */
export type AbschreibModus = Extract<LeserLaufArt, "einordnen" | "nachlese" | "von-hand">;

// ── Das Gedächtnis ───────────────────────────────────────────────────────────

/** Die Ergebnisse, die ein Blatt für seinen jetzigen Stand erledigen. */
export const GEMERKT: readonly LeserLaufErgebnis[] = ["vorschlag", "kein-vorschlag", "nichts"];

/**
 * So viele BEZAHLTE Abbrüche, die am Blatt liegen können, darf ein Blatt im
 * selben Stand haben, bevor der Leser es von selbst nicht mehr anfasst.
 *
 * `spaeter` wird nicht gemerkt — die Frist gehört diesem Versuch, nicht dem
 * Blatt. Beim Postboten lief ein solches Blatt deshalb Runde für Runde
 * wieder, und das kostete nur Kontingent. Mit der API kostet ein Versuch, der
 * abbricht, nachdem das Modell zu schreiben begann, die Tokens bis dahin.
 * Gezählt werden davon die, die an DIESEM Blatt hängen können
 * (`AUF_DIE_GRENZE`: die eigene Frist, ein Strom, der mitten in der Antwort
 * abreißt, ein ausgelasteter Rückfall nach einer Ablehnung, eine Antwort, die
 * sich nicht speichern ließ) — gleich, ob die Zeile `spaeter` oder `pause`
 * heißt —, und jede `laeuft`-Zeile, deren Frist um ist — ein Neustart mitten
 * im Aufruf.
 *
 * Was nichts gekostet hat, zählt nicht: ein 400 oder 429, bevor das Modell
 * schrieb, ist meist ein Fehler am Aufruf und nicht am Blatt, und er träfe
 * jedes Blatt gleich (Abnahme vom 11.10.2026 — bis dahin zählte jedes
 * `spaeter`, und ein abgelehnter Beta-Kopf hätte nach drei Anstößen alle
 * Blätter stillgelegt, auch nach der Behebung). **Und ein Ausfall der API
 * zählt nie, auch wenn er bezahlt war** (`ausfall`, Nachprüfung vom selben
 * Tag): eine Überlastung, eine Grenze, das Konto oder der Schlüssel, als
 * Ereignis mitten im Strom gemeldet, trifft jedes Blatt, das gerade dran ist.
 * Zählten sie, legte ein Ausfall von zwei Stunden ein Blatt nach dem anderen
 * still, und nach der Behebung läse niemand mehr eines. Bezahlt bleibt ein
 * solcher Abbruch trotzdem, und die Monatssumme sagt es („mindestens …“,
 * `laufKosten()` in @/lib/leser/laeufe).
 *
 * **Jeder andere Abbruch mitten im Strom zählt (`strom`)** — ein `api_error`
 * oder ein 400 im Strom, eine Verbindung, die mitten in der Antwort abreißt,
 * auch wenn die Zeile eine Pause ist. Am Blatt ausgeschlossen ist keiner
 * davon, und jeder hat Tokens gekostet. Bis zur Regression vom 11.10.2026
 * zählten auch sie nicht: ein Blatt, an dem der Strom jedes Mal abriss, kam
 * nach jeder Pause und jeder Stunde Ruhe wieder dran und wurde jedes Mal
 * bezahlt — zwanzig Anstöße, zwanzig bezahlte Aufrufe. Jetzt sind es
 * höchstens zwei je Stand; `strom` und `rueckfall` verfallen nach einem Tag,
 * höchstens `ABBRUECHE_GESAMT` insgesamt (`ABBRUCH_VERFALL_MS`). Hält ein
 * solcher Fehler die ganze API an, ruhen die Blätter, die in der Zeit
 * drankamen, deshalb nur einen Tag (`PAUSEN_JE_BLATT` gilt daneben weiter, im
 * Prozess).
 *
 * Zwei und nicht mehr: seit die Frist aus `max_tokens` gerechnet ist
 * (`fristFuer()` in @/lib/leser/claude-auftrag), endet eine Antwort, die nicht
 * aufhört, als „nichts“; ein bezahlter Fristabbruch heißt jetzt, dass die API
 * langsamer schrieb als angenommen. Einmal ist ein Ausreißer, zweimal am
 * selben Stand ein Blatt, an dem es liegt — danach liest es nur noch der
 * Knopf. Gezählt wird in der Datenbank und nicht im Speicher: ein Neustart
 * soll den Zähler nicht zurücksetzen.
 */
export const SPAETER_HOECHSTENS = 2;

/**
 * Wie lange ein bezahlter Abbruch auf `SPAETER_HOECHSTENS` zählt: einen Tag.
 *
 * Nur für die Abbrüche, die sich nicht zuordnen lassen: `strom` und
 * `rueckfall`. Ein `api_error` im Strom, eine Verbindung, die nach dem ersten
 * Inhalt abreißt, ein ausgelasteter Rückfall — das kann am Blatt liegen,
 * dann wäre jeder weitere Versuch bezahlt und vergeblich, oder an der API und
 * am Netz, und dann soll das Blatt nach der Störung wieder drankommen
 * (Abnahme vom 11.10.2026: zwei Runden lang kippte die Regel jeweils in eine
 * der beiden Richtungen). Mit Verfall gilt beides — aber nicht ohne Ende:
 * insgesamt zählen höchstens `ABBRUECHE_GESAMT` solcher Abbrüche je Stand,
 * danach ist er erledigt wie nach zwei an einem Tag.
 *
 * `frist`, `ablage` und eine verwaiste „läuft“-Zeile verfallen NICHT: die
 * liegen am Blatt oder am eigenen Prozess (ein Neustart, der jedes Mal am
 * selben Blatt kommt), und ein Verfall machte daraus zwei bezahlte Versuche
 * je Tag, für immer (letzte Prüfung vom 11.10.2026).
 */
export const ABBRUCH_VERFALL_MS = 24 * 60 * 60 * 1000;

/** Wie viele verfallende Abbrüche (`strom`, `rueckfall`) je Stand höchstens zählen, über alle Tage. */
export const ABBRUECHE_GESAMT = 4;

const VERFALLEND: readonly LeserLaufAbbruch[] = ["strom", "rueckfall"];

/**
 * Die bezahlten Abbrüche, die auf `SPAETER_HOECHSTENS` zählen — alle außer
 * `ausfall` (siehe dort). An einer `spaeter`- wie an einer `pause`-Zeile: ein
 * `api_error` mitten im Strom ist eine Pause für alle und trotzdem ein
 * bezahlter Abbruch an diesem Blatt.
 */
export const AUF_DIE_GRENZE: readonly LeserLaufAbbruch[] = ["frist", "strom", "rueckfall", "ablage"];

/** Zählt diese Zeile auf die Grenze je Blatt? */
export function zaehltAufGrenze(zeile: Pick<GedaechtnisZeile, "ergebnis" | "abbruch">): boolean {
  return (
    (zeile.ergebnis === "spaeter" || zeile.ergebnis === "pause") &&
    zeile.abbruch !== null &&
    AUF_DIE_GRENZE.includes(zeile.abbruch)
  );
}

/** Eine Zeile aus `leser_laeufe`, so weit das Gedächtnis sie braucht. */
export type GedaechtnisZeile = {
  materialId: string;
  art: LeserLaufArt;
  schluessel: string;
  ergebnis: LeserLaufErgebnis;
  abbruch: LeserLaufAbbruch | null;
  /** Die Seiten, deren Abschrift der Lauf durch die Tür brachte; `null`: keine bekannt. */
  abgeschrieben: readonly string[] | null;
  /**
   * Wie alt die Zeile ist, nach der Uhr der Datenbank; fehlt es, gilt sie als
   * frisch. Nur für den Verfall der Abbrüche (`ABBRUCH_VERFALL_MS`).
   */
  alterMs?: number | null;
  /**
   * Nur bei `laeuft`: wie lange seine Frist noch läuft, nach der Uhr der
   * Datenbank. Null oder weniger heißt verwaist — der Prozess, der rief, ist
   * nicht mehr da.
   */
  fristRestMs: number | null;
};

/** Was das Gedächtnis zu einem Blatt in einem Stand sagt. */
export type Erinnerung = {
  /** Ein gemerktes Ergebnis erledigt diesen Stand für diese Art. */
  gemerkt: boolean;
  /** Bezahlte Abbrüche unter diesem Stand, die am Blatt liegen können (`zaehltAufGrenze`), gleich welcher Art. */
  abbrueche: number;
  /**
   * Ein Aufruf an diesem Blatt ist gerade unterwegs (eine frische
   * `laeuft`-Zeile, womöglich aus einem anderen Prozess): wie lange höchstens
   * noch. `null`: keiner.
   */
  laeuftNochMs: number | null;
  /**
   * Nur für die Nachlese: Seiten, die ein gemerktes Einordnen in diesem Stand
   * schon abgeschrieben hat — die liest sie nicht noch einmal.
   */
  schonAbgeschrieben: ReadonlySet<string>;
};

export type Gedaechtnis = (
  art: "einordnen" | "nachlese",
  materialId: string,
  schluessel: string,
  /** Für die Nachlese: die Seiten, die sie lesen würde. */
  seiten?: readonly string[],
) => Erinnerung;

/**
 * Das Gedächtnis aus den Zeilen der Tabelle.
 *
 * **Ein gemerktes Ergebnis gleich welcher Art erledigt den Stand für beide
 * Arten** — Einordnen, Nachlese, ein Lauf von Hand. So lösen „Verwerfen und
 * abhaken“ und „wieder in den Korb“ kein neues, bezahltes Lesen aus: das
 * Blatt wechselt die Art, aber sein Stand ist derselbe, und gelesen ist er.
 * Bis zur Abnahme vom 11.10.2026 zählten Einordnen und Nachlese nicht
 * füreinander; dann las die Nachlese ein Blatt, dessen Vorschlag ein Mensch
 * eben verworfen und abgehakt hatte, ein zweites Mal — und die App übernahm
 * die verworfene Abschrift ohne ihn.
 *
 * **Mit einer Ausnahme, und sie ist der Grund, warum es zwei Arten gibt:**
 * eine Seite, die ein gemerktes EINORDNEN nicht abschreiben konnte (unlesbar,
 * ohne Foto, zu lang), bekommt am eingeordneten Blatt ihren zweiten Versuch
 * durch die Nachlese — so wie beim Postboten unter `korb:` und `nachlese:`.
 * Nur sie: was das Einordnen abgeschrieben hat (`abgeschrieben`), liest die
 * Nachlese nicht noch einmal (`schonAbgeschrieben`), und ist nichts anderes
 * übrig, ist der Stand auch für sie erledigt. Eine gemerkte Nachlese oder
 * ein gemerkter Lauf von Hand erledigt ihn ganz — hat ein Mensch das Blatt in
 * diesem Stand lesen lassen und kam „nichts“ heraus, soll der Leser es nicht
 * von selbst noch einmal bezahlen.
 */
export function gedaechtnisAus(zeilen: readonly GedaechtnisZeile[]): Gedaechtnis {
  return (art, materialId, schluessel, seiten = []) => {
    let gemerkt = false;
    let einordnenGemerkt = false;
    let abbrueche = 0;
    let verfallendGesamt = 0;
    let laeuftNochMs: number | null = null;
    const schonAbgeschrieben = new Set<string>();

    for (const zeile of zeilen) {
      if (zeile.materialId !== materialId || zeile.schluessel !== schluessel) continue;
      const frisch = zeile.alterMs == null || zeile.alterMs < ABBRUCH_VERFALL_MS;

      if (zeile.ergebnis === "laeuft") {
        if (zeile.fristRestMs !== null && zeile.fristRestMs > 0) {
          laeuftNochMs = Math.max(laeuftNochMs ?? 0, zeile.fristRestMs);
        } else {
          // Verwaist: wie ein bezahlter Fristabbruch — und wie der ohne Verfall.
          abbrueche += 1;
        }
        continue;
      }
      if (zaehltAufGrenze(zeile)) {
        if (zeile.abbruch !== null && VERFALLEND.includes(zeile.abbruch)) {
          verfallendGesamt += 1;
          if (frisch) abbrueche += 1;
        } else {
          abbrueche += 1;
        }
      }
      if (!GEMERKT.includes(zeile.ergebnis)) continue;

      if (art === "einordnen" || zeile.art !== "einordnen") {
        gemerkt = true;
      } else {
        einordnenGemerkt = true;
        for (const id of zeile.abgeschrieben ?? []) schonAbgeschrieben.add(id);
      }
    }

    if (!gemerkt && einordnenGemerkt && seiten.every((id) => schonAbgeschrieben.has(id))) {
      gemerkt = true;
    }

    if (verfallendGesamt >= ABBRUECHE_GESAMT) abbrueche = Math.max(abbrueche, SPAETER_HOECHSTENS);

    return { gemerkt, abbrueche, laeuftNochMs, schonAbgeschrieben };
  };
}

/** Ist dieses Blatt in diesem Stand für die Leser von selbst erledigt? */
export function erledigt(erinnerung: Erinnerung): boolean {
  return erinnerung.gemerkt || erinnerung.abbrueche >= SPAETER_HOECHSTENS;
}

// ── Die Auswahl ──────────────────────────────────────────────────────────────

/**
 * Ein Blatt, an dem Claude vielleicht etwas zu lesen hat, mit allem, was die
 * Auswahl braucht — gelesen in @/lib/leser/laeufe.
 */
export type Kandidat = {
  materialId: string;
  eingeordnet: boolean;
  /** `lastPageAt` wie `listPageActivity()` ihn liefert — der Schlüssel. */
  lastPageAt: string;
  /** Alter der jüngsten Seite nach der Uhr der Datenbank. */
  seitLetzterSeiteMs: number;
  /** Seiten mit `leser = 'offen'`. */
  offen: number;
  /** Ungelesene Seiten mit `leser` `claude` oder NULL. */
  fuerClaude: number;
  /**
   * Davon die mit `leser = 'claude'` — ohne die Seiten ohne Leser, die nur der
   * Knopf liest (die Altblätter, siehe `auswaehlen()`).
   */
  claudeSeiten: number;
  /** `unreadAttachedPageIds` — die eine Quelle für die Nachlese. */
  nachgereicht: readonly string[];
  vorschlaege: number;
  /** Der jüngste Vorschlag am Blatt (ISO), oder `null`. */
  juengsterVorschlagAt: string | null;
};

export type Auswahl = {
  /** Korbblätter, die jetzt dran sind — das älteste zuerst. */
  einordnen: string[];
  /** Eingeordnete Blätter mit nachgereichten Seiten — die älteste Seite zuerst. */
  nachlese: string[];
  /** Blätter, die nur noch auf ihre Ruhe warten, und wie lange noch. */
  wecker: { materialId: string; ms: number }[];
};

/**
 * Liegt am Blatt ein Vorschlag, der jünger ist als seine letzte Seite?
 *
 * Dann stammt er aus der Zeit nach dieser Seite — aus einem Chat, von Hand,
 * oder aus einem Lauf, dessen Vorschlag die App nicht selbst übernehmen
 * durfte —, und ein zweiter läge nur daneben. Gemerkt wird das nicht: es
 * kostet keinen Aufruf, jedes Mal nachzusehen.
 */
export function vorschlagJuenger(lastPageAt: string, juengster: string | null): boolean {
  if (juengster === null) return false;
  const seite = Date.parse(lastPageAt);
  const vorschlag = Date.parse(juengster);
  return !Number.isNaN(seite) && !Number.isNaN(vorschlag) && vorschlag > seite;
}

/**
 * Welche Blätter jetzt dran sind.
 *
 * **Korbblätter** (`einordnen`): nicht eingeordnet, kein Vorschlag, keine
 * Seite, über die die App noch entscheidet, mindestens eine Seite, die die
 * App Claude zugeteilt hat, in diesem Stand nicht erledigt — und ruhig. Ein
 * Blatt, dessen jüngste Seite jünger ist als `ruheMs`, bekommt einen Wecker
 * auf den Rest: die Rückseite kommt über „Seite hinzufügen“ erst nach der
 * Vorderseite, und ein Lauf dazwischen läse ein halbes Blatt (RUHE_MS in
 * @/lib/leser/regel).
 *
 * Seiten ohne Leser (NULL) zählen im Korb NIE — seit dem 6.10.2026 bekommt
 * jede neue Seite einen Leser, eine NULL-Seite ist also eine alte, und ihre
 * Altblätter schreibt nach dem Willen des Nutzers niemand von selbst ab. Bis
 * zur Abnahme vom 11.10.2026 galt das nur, solange so ein Blatt eingeordnet
 * war: „wieder in den Korb“ machte es zu einem Korbblatt ohne Vorschlag, und
 * der Leser schrieb es ganz ab, bezahlt. Jetzt liest es nur der Knopf.
 *
 * **Nachlese**: eingeordnet, nachgereichte ungelesene Seiten, keine offene
 * Seite, kein jüngerer Vorschlag, nicht erledigt, ruhig. Eine offene Seite
 * hält das Blatt hier aus einem Grund mehr an: gemerkt wird unter
 * `lastPageAt`, und das ist schon das Datum der offenen Seite. Liefe die
 * Nachlese jetzt für die übrigen und fiele die offene danach Claude zu, bliebe
 * sie unter demselben Schlüssel für immer ungelesen. Das Ende der Zuteilung
 * stößt den Leser ohnehin wieder an.
 *
 * Ein Blatt, auf dem eine Seite offen ist, bekommt keinen Wecker: es wartet
 * auf die Zuteilung, nicht auf die Uhr.
 *
 * Läuft an einem Blatt gerade ein Aufruf (eine frische `laeuft`-Zeile, etwa
 * aus einem Prozess vor einem Neustart), wartet es mit einem Wecker auf das
 * Ende dieser Frist; danach zählt die Zeile als bezahlter Abbruch.
 *
 * `ausgenommen`: was dieser Lauf schon versucht hat, was nach einer Frist
 * ruht, und was ein Knopfdruck für sich angefordert hat
 * (@/lib/leser/claude-leser).
 */
export function auswaehlen(
  kandidaten: readonly Kandidat[],
  gedaechtnis: Gedaechtnis,
  { ruheMs, ausgenommen }: { ruheMs: number; ausgenommen: ReadonlySet<string> },
): Auswahl {
  const einordnen: Kandidat[] = [];
  const nachlese: Kandidat[] = [];
  const wecker: Auswahl["wecker"] = [];

  for (const blatt of kandidaten) {
    if (ausgenommen.has(blatt.materialId) || blatt.offen > 0) continue;

    let erinnerung: Erinnerung;
    if (!blatt.eingeordnet) {
      if (blatt.vorschlaege > 0 || blatt.claudeSeiten === 0) continue;
      erinnerung = gedaechtnis("einordnen", blatt.materialId, blatt.lastPageAt);
    } else {
      if (blatt.nachgereicht.length === 0) continue;
      if (vorschlagJuenger(blatt.lastPageAt, blatt.juengsterVorschlagAt)) continue;
      erinnerung = gedaechtnis("nachlese", blatt.materialId, blatt.lastPageAt, blatt.nachgereicht);
    }
    if (erledigt(erinnerung)) continue;

    if (erinnerung.laeuftNochMs !== null) {
      wecker.push({ materialId: blatt.materialId, ms: erinnerung.laeuftNochMs + 500 });
      continue;
    }

    if (blatt.seitLetzterSeiteMs < ruheMs) {
      // Die halbe Sekunde obendrauf wie bei `appVorschlagFaellig()`: der
      // Wecker soll nicht eine Millisekunde zu früh klingeln.
      wecker.push({ materialId: blatt.materialId, ms: ruheMs - blatt.seitLetzterSeiteMs + 500 });
      continue;
    }

    (blatt.eingeordnet ? nachlese : einordnen).push(blatt);
  }

  // Das älteste Blatt zuerst: wer am längsten wartet, ist zuerst dran. Die
  // Zeit kommt als ISO-Text in UTC, und der sortiert wie die Zeit selbst.
  const nachAlter = (a: Kandidat, b: Kandidat) => a.lastPageAt.localeCompare(b.lastPageAt);

  return {
    einordnen: einordnen.sort(nachAlter).map((blatt) => blatt.materialId),
    nachlese: nachlese.sort(nachAlter).map((blatt) => blatt.materialId),
    wecker,
  };
}

// ── Der Plan für ein Blatt ───────────────────────────────────────────────────

/** Ein Blatt, frisch gelesen, so weit der Plan es braucht. */
export type BlattStand = {
  eingeordnet: boolean;
  capturedOn: string;
  /** In der Reihenfolge des Blattes; `gelesen` heißt: eine Abschrift steht da, auch die leere. */
  seiten: readonly { id: string; leser: Leser | null; gelesen: boolean }[];
  lastPageAt: string;
  nachgereicht: readonly string[];
  vorschlaege: number;
  juengsterVorschlagAt: string | null;
};

export type Plan =
  | { art: "kein-lauf"; grund: string }
  | { art: "einordnen"; laufArt: AbschreibModus; vorab: EinordnenVorab }
  | { art: "nachlese"; laufArt: AbschreibModus; vorab: NachleseVorab };

/** Eine Seite für Claude: ungelesen, und weder Docling noch die Zuteilung ist dran. */
function fuerClaude(seite: { leser: Leser | null; gelesen: boolean }): boolean {
  return !seite.gelesen && (seite.leser === "claude" || seite.leser === null);
}

/** Eine Seite, die die App Claude zugeteilt hat — ohne die Seiten ohne Leser (Altbestand). */
function claudeZugeteilt(seite: { leser: Leser | null; gelesen: boolean }): boolean {
  return !seite.gelesen && seite.leser === "claude";
}

/** Die Seiten des Blattes, die `behalten` nennt — mit ihrer Nummer am Blatt (ab 1). */
function nummeriert(
  stand: BlattStand,
  behalten: (seite: BlattStand["seiten"][number]) => boolean,
): AuftragsSeite[] {
  return stand.seiten.flatMap((seite, index) =>
    behalten(seite) ? [{ id: seite.id, nummer: index + 1 }] : [],
  );
}

function einordnenPlan(stand: BlattStand, laufArt: AbschreibModus): Plan {
  // Von selbst nur Seiten, die die App Claude zugeteilt hat; die Seiten ohne
  // Leser eines Altblattes im Korb nur von Hand (siehe `auswaehlen()`).
  const seiten = nummeriert(stand, laufArt === "von-hand" ? fuerClaude : claudeZugeteilt);
  if (seiten.length === 0) {
    return { art: "kein-lauf", grund: "Keine Seite für Claude. Jede ist gelesen oder gehört Docling." };
  }

  return {
    art: "einordnen",
    laufArt,
    vorab: {
      capturedOn: stand.capturedOn,
      seiten,
      vollstaendig: seiten.length === stand.seiten.length,
      ersteSeiteDabei: seiten[0]?.id === stand.seiten[0]?.id,
    },
  };
}

/**
 * Was ein Lauf an diesem Blatt tun soll — oder warum keiner.
 *
 * Für alle drei Arten zuerst: liest die App eine Seite noch (`offen`), läuft
 * nichts. Ob diese Seite an Claude geht, weiß dann niemand, und ein Lauf
 * jetzt läse sie doppelt oder ließe sie aus.
 *
 * - `einordnen`: nur im Korb und nur ohne Vorschlag; Seiten sind die
 *   ungelesenen mit `leser = 'claude'` — eine Seite ohne Leser (NULL) liest
 *   im Korb nur der Knopf.
 * - `nachlese`: nur eingeordnet; Seiten sind die nachgereichten
 *   (`unreadAttachedPageIds`), die jetzt noch ungelesen und für Claude sind —
 *   die Liste der Auswahl kann Minuten alt sein —, ohne die, die ein gemerktes
 *   Einordnen in diesem Stand schon abgeschrieben hat (`ohne`, aus
 *   `gedaechtnisAus()`). Kein Lauf, wenn ein jüngerer Vorschlag liegt.
 * - `von-hand`: liegt ein Vorschlag am Blatt, nichts — erst über den
 *   entscheiden. Im Korb wie `einordnen`. Eingeordnet die Nachlese über JEDE
 *   ungelesene Seite für Claude, auch die alten eines Altblattes. Dass ein
 *   solcher Vorschlag dann für einen Menschen im Korb bleibt, liegt an
 *   `onlyTranscribesAttachedPages()` in @/lib/auto-file, und das ist gewollt:
 *   über die Altblätter entscheidet ein Mensch.
 */
export function planen(
  modus: AbschreibModus,
  stand: BlattStand,
  ohne: ReadonlySet<string> = new Set(),
): Plan {
  if (stand.seiten.some((seite) => seite.leser === "offen")) {
    return { art: "kein-lauf", grund: "Die App liest eine Seite dieses Blattes noch selbst." };
  }

  if (modus === "einordnen") {
    if (stand.eingeordnet) return { art: "kein-lauf", grund: "Das Blatt ist schon eingeordnet." };
    if (stand.vorschlaege > 0) return { art: "kein-lauf", grund: "Am Blatt liegt schon ein Vorschlag." };
    return einordnenPlan(stand, "einordnen");
  }

  if (modus === "nachlese") {
    if (!stand.eingeordnet) return { art: "kein-lauf", grund: "Das Blatt liegt noch im Korb." };
    if (vorschlagJuenger(stand.lastPageAt, stand.juengsterVorschlagAt)) {
      return { art: "kein-lauf", grund: "Ein Vorschlag zu diesen Seiten liegt schon im Korb." };
    }

    const genannt = new Set(stand.nachgereicht);
    const seiten = nummeriert(
      stand,
      (seite) => genannt.has(seite.id) && fuerClaude(seite) && !ohne.has(seite.id),
    );
    if (seiten.length === 0) {
      return { art: "kein-lauf", grund: "Keine nachgereichte Seite ist mehr ungelesen." };
    }
    return { art: "nachlese", laufArt: "nachlese", vorab: { seiten, nachgereicht: true } };
  }

  if (stand.vorschlaege > 0) {
    return {
      art: "kein-lauf",
      grund: "Am Blatt liegt schon ein Vorschlag. Erst über den im Eingangskorb entscheiden.",
    };
  }
  if (!stand.eingeordnet) return einordnenPlan(stand, "von-hand");

  const seiten = nummeriert(stand, fuerClaude);
  if (seiten.length === 0) {
    return { art: "kein-lauf", grund: "Keine Seite für Claude. Jede ist gelesen oder gehört Docling." };
  }

  const genannt = new Set(stand.nachgereicht);
  return {
    art: "nachlese",
    laufArt: "von-hand",
    vorab: { seiten, nachgereicht: seiten.every((seite) => genannt.has(seite.id)) },
  };
}

// ── Die Pause ────────────────────────────────────────────────────────────────

/**
 * Die Pause nach einem Fehler, der nicht am Blatt liegt — Schlüssel,
 * Abrechnung, Kontingent, die API gestört (`pause` in @/lib/claude/ergebnis).
 *
 * Dieselben Zahlen wie beim Postboten: fünf Minuten, bei jeder weiteren
 * Absage verdoppelt, höchstens eine halbe Stunde. Ohne Pause fragte jeder
 * Anstoß eine API, die gerade nein sagt; länger hielte den Leser noch zurück,
 * wenn sie längst wieder will. Ein Lauf, der wieder zu einem Ergebnis kommt,
 * setzt sie auf den Anfang zurück, ein Neustart auch — die Pause lebt nur im
 * Prozess und ist keine zweite Warteschlange.
 */
export const PAUSE_ANFANG_MS = 5 * 60_000;
export const PAUSE_HOECHSTENS_MS = 30 * 60_000;

/** Die übernächste Pause, wenn diese nicht geholfen hat. */
export function naechstePause(jetztMs: number): number {
  return Math.min(jetztMs * 2, PAUSE_HOECHSTENS_MS);
}

/**
 * So viele Pausen hintereinander darf DASSELBE Blatt auslösen, ohne dass
 * dazwischen ein anderes drankam, bevor es selbst ruht (`SPAETER_RUHE_MS`,
 * nur im Prozess).
 *
 * Eine Pause gilt für alle Blätter, und danach nimmt die Auswahl wieder das
 * älteste zuerst. Liegt der 5xx oder der Abbruch des Stroms an genau diesem
 * Blatt — reproduzierbar, bei jedem Versuch —, käme nach jeder Pause wieder
 * dasselbe dran, und kein jüngeres würde je gelesen (Abnahme vom 11.10.2026).
 * Nach der dritten Pause in Folge an ihm ruht es; die Pause selbst gilt
 * trotzdem, denn es kann ebenso gut die API sein, und dann trifft sie das
 * nächste Blatt genauso — dann beginnt die Zählung dort von vorn.
 *
 * Gezählt werden nur Pausen, die an diesem Blatt liegen KÖNNEN
 * (`pauseAmBlatt` in @/lib/claude/ergebnis: ein 5xx, ein Strom, der mitten in
 * der Antwort abreißt). Ein erreichtes Ausgabelimit, ein abgewiesener
 * Schlüssel, ein 429, ein Netz ohne Namensauflösung treffen jedes Blatt
 * gleich; bis zur Nachprüfung vom 11.10.2026 zählten auch sie, und ein
 * Ausfall von einer halben Stunde ließ ein Blatt nach dem anderen ruhen, bis
 * keines mehr übrig war und kein Wecker den Leser wieder anstieß.
 */
export const PAUSEN_JE_BLATT = 3;

/**
 * Die Pausen in Folge, nachdem `materialId` eine ausgelöst hat: um eins mehr,
 * wenn die letzte auch von ihm kam, sonst die erste. Eine Pause, die nicht am
 * Blatt liegen kann (`amBlatt` falsch), ändert nichts: sie sagt weder etwas
 * gegen das Blatt noch für es.
 */
export function pausenFolge(
  bisher: { materialId: string; anzahl: number } | null,
  materialId: string,
  amBlatt: boolean,
): { materialId: string; anzahl: number } | null {
  if (!amBlatt) return bisher;
  return bisher?.materialId === materialId
    ? { materialId, anzahl: bisher.anzahl + 1 }
    : { materialId, anzahl: 1 };
}

/**
 * Wie lange ein Blatt nach einem „später“ ruht (eigene Frist, ein Abbruch,
 * ein 400, ein ausgelasteter Rückfall) — oder nach den Pausen in Folge an ihm
 * (`PAUSEN_JE_BLATT`) —, bevor ein Anstoß es wieder nimmt: nur im Prozess.
 *
 * Ohne diese Ruhe liefe ein solches Blatt bei jedem Anstoß gleich wieder: nach
 * jedem Hochladen, nach jedem `read_inbox` eines Chats. Mit ihr höchstens
 * einmal die Stunde; was davon Geld kostet und am Blatt liegt, höchstens
 * `SPAETER_HOECHSTENS`-mal je Stand.
 *
 * Nach einem „später“ ohne Wecker: kein Blatt bekommt einen Takt, und es
 * wartet auf den nächsten Anstoß, der ohnehin kommt. Nach den Pausen in Folge
 * MIT einem Wecker auf das Ende der Ruhe (`claude-leser.ts`): dort ersetzt die
 * Ruhe den Wecker der Pause, der das Blatt sonst wieder angestoßen hätte — und
 * war es doch die API, wäre ohne ihn nach der Behebung niemand mehr da, der
 * anstößt (Nachprüfung vom 11.10.2026).
 */
export const SPAETER_RUHE_MS = 60 * 60_000;

// ── Was der Lauf ergab ───────────────────────────────────────────────────────

/** „1 Seite“, „3 Seiten“. */
export function seitenZahl(zahl: number): string {
  return `${zahl} Seite${zahl === 1 ? "" : "n"}`;
}

/**
 * Was aus der Antwort der Tür als Ergebnis des Laufs wird.
 *
 * Ein Nein der Tür ist „nichts“ und gemerkt, wo dieselbe Antwort auf dasselbe
 * Blatt wiederkäme: ein ungültiger Vorschlag, ein Blatt, das es nicht mehr
 * gibt. Zwei Neins sagen dagegen nichts über die Antwort, sondern über ein
 * Rennen mit einem Menschen — `fremde-seiten` und `nicht-angelegt` heißen
 * hier, dass eine Seite gelöscht wurde, zwischen dem frischen Blick auf das
 * Blatt gleich vor der Tür und der Tür selbst. Die sind „später“ und nicht
 * gemerkt (Abnahme vom 11.10.2026: bis dahin waren sie ein gemerktes
 * „nichts“, und die übrigen Seiten las niemand mehr). Ein Vorschlag, der nur
 * aus Verworfenem bestand, ist „kein-vorschlag“ — die Regel „ein Leser je
 * Seite“ hat entschieden, nicht ein Fehler.
 */
export function tuerErgebnis(
  tuer: BlattVorschlagErgebnis,
): { ergebnis: Exclude<LeserLaufErgebnis, "laeuft">; grund: string } {
  switch (tuer.art) {
    case "angelegt": {
      const teile: string[] = [];
      const e = tuer.eingeordnet;

      if (e.ok && e.art === "jev") {
        teile.push(`eingeordnet: ${e.subjectName}${e.topics.length > 0 ? `: ${e.topics.join(", ")}` : ""}`);
      } else if (e.ok) {
        teile.push(`Abschrift von ${seitenZahl(e.seiten)} übernommen`);
      } else {
        teile.push(`Vorschlag liegt im Korb: ${e.grund}`);
      }
      if (tuer.verworfen.length > 0) {
        teile.push(`${seitenZahl(tuer.verworfen.length)} verworfen (gelesen oder Docling)`);
      }
      return { ergebnis: "vorschlag", grund: teile.join("; ") };
    }
    case "leer":
      return {
        ergebnis: "kein-vorschlag",
        grund: "Nur Abschriften zu Seiten, die schon gelesen sind oder die die App selbst liest. Nichts angelegt.",
      };
    case "abgewiesen":
      switch (tuer.grund) {
        case "kein-blatt":
          return { ergebnis: "nichts", grund: "Das Blatt gibt es nicht mehr." };
        case "fremde-seiten":
          return {
            ergebnis: "spaeter",
            grund: "Eine Seite gibt es nicht mehr. Nicht gemerkt.",
          };
        case "ungueltig":
          return { ergebnis: "nichts", grund: `Die Tür hat den Vorschlag abgewiesen: ${tuer.meldungen.join(" ")}` };
        case "nicht-angelegt":
          return {
            ergebnis: "spaeter",
            grund: "Der Vorschlag ließ sich nicht anlegen, Blatt oder Seite fehlt. Nicht gemerkt.",
          };
      }
  }
}

/**
 * Was die Nachlese wirklich erreicht hat — an den Seiten gezählt, nicht dem
 * Modell geglaubt. Gelesen ist eine Seite, an der jetzt eine Abschrift steht;
 * eine inzwischen gelöschte fehlt in `nachher` und zählt nicht mit.
 *
 * `fremd` sind Seiten, die vorher ungelesen waren, nicht im Auftrag standen
 * und jetzt gelesen sind. Der Leser schickt nur die Fotos der Seiten im
 * Auftrag, und die Tür lässt keine fremde Seite durch; steht hier trotzdem
 * eine, hat sie in derselben Minute ein Mensch abgetippt. Gesagt wird es
 * trotzdem — gerade bei einem Altblatt will ein Mensch das wissen.
 */
export function nachleseZaehlen(
  ziel: readonly string[],
  vorherUngelesen: readonly string[],
  nachher: ReadonlyMap<string, boolean>,
): { uebernommen: number; offen: number; fremd: number } {
  const genannt = new Set(ziel);
  const gelesen = (id: string) => nachher.get(id) === true;
  const uebernommen = ziel.filter(gelesen).length;

  return {
    uebernommen,
    offen: ziel.length - uebernommen,
    fremd: vorherUngelesen.filter((id) => !genannt.has(id) && gelesen(id)).length,
  };
}

/** Die Zählung der Nachlese als Satz fürs Protokoll und für die Anzeige am Blatt. */
export function nachleseSatz(
  zaehlung: { uebernommen: number; offen: number; fremd: number },
  ziel: number,
): string {
  const teile = [
    zaehlung.uebernommen > 0
      ? `${zaehlung.uebernommen} von ${seitenZahl(ziel)} übernommen`
      : "nichts übernommen",
  ];
  if (zaehlung.uebernommen > 0 && zaehlung.offen > 0) {
    teile.push(`${zaehlung.offen} nicht zu lesen, ${zaehlung.offen === 1 ? "bleibt" : "bleiben"} offen`);
  }
  if (zaehlung.fremd > 0) {
    teile.push(`dazu ${seitenZahl(zaehlung.fremd)} gelesen, die nicht im Auftrag standen`);
  }
  return teile.join(", ");
}

// ── Die Anzeige am Blatt ─────────────────────────────────────────────────────

/** Ein Lauf, so wie die Blattseite ihn zeigt. */
export type LaufZeile = {
  art: LeserLaufArt;
  ergebnis: LeserLaufErgebnis;
  grund: string;
  kostenUsd: number | null;
  /** Bezahlt und ohne Ergebnis — siehe die Spalte. */
  abbruch: LeserLaufAbbruch | null;
  /** Kam eine Antwort, steht also eine Messung da? */
  gemessen: boolean;
  /** Nur bei `laeuft`: wie lange seine Frist noch läuft; null oder weniger heißt verwaist. */
  fristRestMs: number | null;
  createdAt: Date;
};

/** Was über einem Lauf steht — in den Worten des Menschen, nicht der Tabelle. */
const ERGEBNIS_TEXT: Record<LeserLaufErgebnis, string> = {
  vorschlag: "abgeschrieben",
  "kein-vorschlag": "kein Vorschlag",
  nichts: "ohne Ergebnis",
  spaeter: "nicht fertig geworden",
  pause: "angehalten",
  laeuft: "liest gerade",
};

/**
 * Der letzte Lauf als eine Zeile: wann, was, warum und — wenn bekannt — was
 * er gekostet hat. Ohne Antwort (Pause, Frist) gibt es keinen Betrag, und ein
 * Modell ohne bekannten Preis bekommt keinen geratenen; die ganze Messung
 * steht in der Tabelle. Ein bezahlter Abbruch ohne Messung sagt das, statt zu
 * schweigen: er hat Geld gekostet, nur weiß niemand, wie viel. Eine
 * `laeuft`-Zeile, deren Frist um ist, ist ein Lauf, den ein Neustart
 * abgebrochen hat.
 *
 * Dieselbe Zeile steht seit dem 11.10.2026 auch an der Klausurseite des
 * Abrufs, für den Fragenlauf (@/lib/fragenlauf) — dort heißt ein Vorschlag
 * nicht „abgeschrieben“, sondern „Fragen vorgeschlagen“; der Rest ist gleich.
 */
export function laufAnzeige(lauf: LaufZeile): string {
  const wann = `${formatGerman(berlinDay(lauf.createdAt), "kurz")}, ${timeInBerlin(lauf.createdAt)} Uhr`;
  const wer = lauf.art === "von-hand" ? " (von Hand angestoßen)" : "";
  const verwaist =
    lauf.ergebnis === "laeuft" && (lauf.fristRestMs === null || lauf.fristRestMs <= 0);
  const was = verwaist
    ? "abgebrochen (die App startete mitten im Lauf neu)"
    : lauf.art === "fragen" && lauf.ergebnis === "vorschlag"
      ? "Fragen vorgeschlagen"
      : lauf.art === "arbeitsblatt" && lauf.ergebnis === "vorschlag"
        ? "Arbeitsblatt gebaut"
        : lauf.art === "arbeitsblatt" && lauf.ergebnis === "kein-vorschlag"
          ? "kein Arbeitsblatt"
          : ERGEBNIS_TEXT[lauf.ergebnis];
  const grund = lauf.grund.trim();
  const kosten =
    lauf.kostenUsd !== null
      ? ` · ${dollar(lauf.kostenUsd)}`
      : !lauf.gemessen && (lauf.abbruch !== null || verwaist)
        ? " · bezahlt, Betrag unbekannt"
        : "";

  return `Zuletzt ${wann}${wer}: ${was}${grund ? `: ${grund}` : ""}${kosten}`;
}

/**
 * Was Läufe gekostet haben, als Satz — für die Einstellungen (der Monat) und
 * die Blattseite (alle Läufe am Blatt). Fehlt der Summe etwas — ein Modell
 * ohne bekannten Preis, oder ein bezahlter Abbruch, von dem keine Messung
 * kam —, steht „mindestens“ davor und dahinter, was fehlt. Bis zur Abnahme
 * vom 11.10.2026 fielen die Abbrüche still aus der Summe, und die sah
 * vollständig aus.
 */
export function kostenSatz(kosten: {
  laeufe: number;
  usd: number;
  unbekannt: number;
  abgebrochen: number;
}): string {
  const luecke = kosten.unbekannt > 0 || kosten.abgebrochen > 0;
  const laeufe = `${kosten.laeufe} ${kosten.laeufe === 1 ? "Lauf" : "Läufe"} mit Antwort`;
  const fehlt: string[] = [];
  if (kosten.unbekannt > 0) {
    fehlt.push(`${kosten.unbekannt} davon ohne bekannten Preis`);
  }
  if (kosten.abgebrochen > 0) {
    fehlt.push(
      kosten.abgebrochen === 1
        ? "dazu 1 abgebrochener Lauf, dessen Kosten nicht bekannt sind"
        : `dazu ${kosten.abgebrochen} abgebrochene Läufe, deren Kosten nicht bekannt sind`,
    );
  }

  return `${luecke ? "mindestens " : ""}${dollar(kosten.usd)} für ${laeufe}${fehlt.length > 0 ? ` (${fehlt.join("; ")})` : ""}`;
}
