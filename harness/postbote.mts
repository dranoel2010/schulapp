import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auftragFuer, laufFuerBlatt, nachleseAuftragFuer } from "./auftrag.mts";
import { fristFuer, messungZeile, type LaufErgebnis } from "./kaefig.mts";
import {
  liesZugang,
  Verbindung,
  WerkzeugFehler,
  ZugangVerloren,
} from "./mcp.mts";
import { sperren } from "./sperre.mts";

/**
 * Der Postbote: sieht nach, ob im Eingangskorb etwas liegt, und setzt Claude
 * darauf an.
 *
 *   npx tsx harness/postbote.mts                 — läuft, bis du ihn beendest
 *   npx tsx harness/postbote.mts --einmal        — eine Runde, dann Schluss
 *   npx tsx harness/postbote.mts --blatt <id>    — genau dieses Blatt, auch
 *                                                  wenn es schon dran war
 *   npx tsx harness/postbote.mts --intervall 300 — alle fünf Minuten
 *   npx tsx harness/postbote.mts --ruhe 60       — ein Blatt erst eine Minute
 *                                                  nach seiner letzten Seite
 *                                                  (bei --einmal ohne --ruhe: 0)
 *   npx tsx harness/postbote.mts --modell sonnet — ein anderes Modell
 *
 * **Der Korb ist die Warteschlange.** Der Dienst führt keine eigene Liste
 * dessen, was zu tun wäre: ein Blatt ohne Vorschlag, das noch niemand
 * durchgesehen hat, IST die offene Aufgabe. Damit gibt es nichts, was zwischen
 * App und Dienst auseinanderlaufen könnte — und nichts aufzuräumen, wenn der
 * Dienst wochenlang aus war.
 *
 * **Er schreibt selbst nichts in die App.** Er liest den Korb, um zu
 * entscheiden, ob sich ein Lauf lohnt; geschrieben wird ausschließlich im
 * Käfig, durch `propose_sheet` — dieselbe Tür wie für jeden anderen.
 *
 * **Gemerkt wird trotzdem etwas, und zwar genau eine Sache:** welche Blätter
 * schon einen Lauf hatten. Ohne diese Liste käme ein verworfener Vorschlag
 * beim nächsten Durchgang wieder — der Korb sähe wieder aus wie „ohne
 * Vorschlag", und der Dienst schlüge dasselbe noch einmal vor. Das ist die
 * einzige Stelle, an der er ein Gedächtnis braucht. Seit dem 4.10.2026 merkt
 * sie sich ein Blatt samt dem Stand seiner jüngsten Seite (`korbSchluessel()`):
 * hängt jemand ein besseres Foto an, ist das ein neuer Fall. Und in derselben
 * Liste stehen auch nachgereichte Seiten (`nachleseSchluessel()`) — es ist
 * dieselbe Frage, nur an einer anderen Stelle des Blattes.
 *
 * Die Pause nach einem leeren Kontingent (`ruheBis` in `main()`) ist kein
 * zweites Gedächtnis: sie lebt nur im laufenden Prozess, verfällt bei jedem
 * Neustart und sagt über kein Blatt etwas — nur, wann der Dienst das nächste
 * Mal fragt. Eine zweite Warteschlange neben dem Korb ist sie nicht. Dasselbe
 * gilt für die drei Kleinigkeiten, die seit dem 4.10.2026 daneben stehen: wann
 * frühestens wieder nach nachgereichten Seiten gesucht wird
 * (`NachleseTakt`), welche Absage der App dazu schon gesagt ist, und über
 * welche wartenden Blätter schon eine Zeile ging (`letzteWartende`). Alle
 * drei sagen nur, wann gefragt und was gesagt wird — welches Blatt dran ist,
 * entscheidet weiter allein, was die App liefert.
 *
 * **Nachgereichte Seiten** (seit dem 4.10.2026). Seit Jev einordnet, liegt ein
 * Blatt nur Sekunden im Korb. Kommt die Rückseite danach — „Seite hinzufügen"
 * an einem eingeordneten Blatt —, sähe der Korb sie nie, und sie bliebe für
 * immer ungelesen. Die App nennt solche Seiten deshalb an jedem Blatt beim
 * Namen (`unreadAttachedPageIds`): ohne Abschrift an einem eingeordneten
 * Blatt, und entweder nach dem Einordnen dazugekommen oder jünger als eine
 * schon abgeschriebene Seite desselben Blattes. Das Zweite fängt die Seite,
 * die WÄHREND eines Laufs dazukam — sie ist älter als das Einordnen, aber
 * jünger als die Seiten, die der Lauf abgeschrieben hat. Wenn im Korb nichts
 * zu tun ist, schreibt der Postbote GENAU DIESE Seiten mit dem Auftrag der
 * Nachlese ab (`nachleseAuftragFuer(id, nurSeiten)`), und keine andere.
 *
 * Die fünfzehn Altblätter vom August bleiben dabei mit Absicht liegen: keine
 * ihrer Seiten hat eine Abschrift, und alle sind älter als ihr Einordnen. Ob
 * sie abgeschrieben werden, entscheidet ein Mensch mit nachlese.mts. Bekommt
 * ein Altblatt eine neue Seite, wird nur diese abgeschrieben — dafür steht die
 * Liste im Auftrag und nicht bloß eine Zahl.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const GESEHEN_DATEI = path.join(HIER, "gesehen.json");

/**
 * Wie oft nachgesehen wird, wenn nichts anderes gesagt ist.
 *
 * Fünfzehn Sekunden seit dem 4.10.2026, vorher hundertzwanzig. Ein Blatt soll
 * eingeordnet sein, kurz nachdem es fotografiert ist; bei zwei Minuten lag im
 * Mittel eine ganze Minute Warten vor jedem Lauf. Ein Blick in den Korb kostet
 * kein Kontingent, nur eine kleine Anfrage über den Funnel.
 */
const INTERVALL_SEKUNDEN = 15;

/**
 * Wie lange die letzte Seite eines Blattes her sein muss, bevor es dran ist.
 *
 * Die Rückseite kommt oft ein paar Sekunden nach der Vorderseite. Startet der
 * Lauf vorher, schreibt er nur die Vorderseite ab, Jev ordnet ein, und die
 * Rückseite kommt als nachgereichte Seite hinterher — ein zweiter Lauf für ein
 * Blatt. Bei fünfzehn Sekunden zwischen den Runden ist das kein Randfall mehr.
 *
 * Gemessen wird an `lastPageAt`, das die App an jedem Blatt mitliefert (die
 * jüngste Seite, nach der Uhr der App), und nicht an einer eigenen
 * Beobachtung: so übersteht die Regel jeden Neustart und braucht kein
 * Gedächtnis. Läuft der Postbote auf einem anderen Rechner als die App, geht
 * deren Uhrenabstand mit in die Rechnung — auf dem NAS ist es dieselbe Uhr.
 *
 * Liefert eine ältere App das Feld nicht, gilt jedes Blatt als ruhig — so wie
 * bis zum 4.10.2026. `--blatt` fragt gar nicht erst: wer ein Blatt beim Namen
 * nennt, will es jetzt.
 *
 * `--einmal` ohne `--ruhe` wartet ebenfalls nicht (seit dem 4.10.2026). Eine
 * einzelne Runde, die ein frisches Blatt nur ansieht und dann still endet,
 * sähe aus wie „nichts zu tun" — wer von Hand einmal laufen lässt, hat die
 * Fotos meist gerade fertig und will jetzt ein Ergebnis. Wer die Ruhe doch
 * will, nennt sie; wartet dann ein Blatt, steht es in einer Zeile da.
 */
const RUHE_SEKUNDEN = 20;

/**
 * Wie oft höchstens nach nachgereichten Seiten gesucht wird.
 *
 * Seit dem 4.10.2026 eine eigene Zahl und nicht der Takt des Korbs. Die Suche
 * fragt die ganze Ablage (`read_material`), nicht den Korb: mehr Arbeit für
 * die App und eine größere Antwort über den Funnel. Alle fünfzehn Sekunden
 * wäre das zu oft für etwas, das an einer Rückseite hängt, die ohnehin erst
 * nach ihrer Ruhe dran ist. Die Uhr dafür lebt im Prozess (`NachleseTakt`) —
 * nach einem Neustart wird gleich in der ersten Runde gesucht.
 */
const NACHLESE_SEKUNDEN = 60;

/**
 * Wie viele Blätter eine Runde höchstens bearbeitet, bevor wieder in den Korb
 * gesehen wird.
 *
 * Drei, damit zwischen den Läufen frisch gelesen wird — falls der Mensch
 * inzwischen selbst eingeordnet hat oder ein neues Blatt dazugekommen ist.
 *
 * Bis zum 4.10.2026 stand hier auch, die Zahl schütze das Tageskontingent: ein
 * Stapel von zehn Zetteln verteilte sich über Runden im Zwei-Minuten-Takt. Bei
 * fünfzehn Sekunden stimmt das nicht mehr, der nächste Dreierpack ist fast
 * sofort dran. Geschützt wird das Kontingent jetzt erst hinterher: läuft es
 * leer (429), pausiert der Dienst (`PAUSE_ANFANG_MS`).
 */
const PRO_RUNDE = 3;

/**
 * Die Pause nach einem leeren Kontingent, und wie weit sie wachsen darf.
 *
 * Ohne Pause fragte der Dienst alle fünfzehn Sekunden ein Kontingent ab, das
 * leer ist, und jeder Versuch startet ein ganzes `claude` — rund siebenhundert
 * vergebliche Starts in drei Stunden. Fünf Minuten, bei jeder weiteren Absage
 * verdoppelt, höchstens eine halbe Stunde: länger hielte den Dienst noch
 * zurück, wenn das Kontingent längst wieder da ist. Ein Lauf, der wieder zu
 * einem Ergebnis kommt, setzt die Pause auf den Anfang zurück, ein Neustart
 * auch.
 */
const PAUSE_ANFANG_MS = 5 * 60_000;
const PAUSE_HOECHSTENS_MS = 30 * 60_000;

/** Ein Blatt, wie read_inbox es nennt. */
type Zeile = {
  id: string;
  title: string;
  subject: string;
  pageCount: number;
  filedAt: string | null;
  proposals: unknown[];
  /** Die jüngste Seite (ISO-8601). Fehlt bei einer App vor dem 4.10.2026. */
  lastPageAt?: string | null;
};

/** Ein Blatt, wie read_material es nennt. */
type Ablagezeile = {
  id: string;
  title: string;
  subject: string;
  pageCount: number;
  lastPageAt?: string | null;
  /** Wie viele nachgereichte Seiten noch niemand gelesen hat. */
  unreadAttachedPages?: number;
  /**
   * Genau diese Seiten, nach `sortOrder` (seit dem 4.10.2026). Fehlt bei einer
   * älteren App — dann bleibt das Blatt liegen, denn ohne die Liste wüsste der
   * Auftrag nicht, welche ungelesenen Seiten er NICHT anfassen darf.
   */
  unreadAttachedPageIds?: string[];
};

/** Ein Blatt, wie read_sheet es nennt — nur, was hier gebraucht wird. */
type BlattDetail = {
  id: string;
  title: string;
  subject: string;
  capturedOn: string;
  topics: string[];
  filedAt: string | null;
  /** Die jüngste Seite, gelesen VOR den Seiten unten. Fehlt bei einer App vor dem 4.10.2026. */
  lastPageAt?: string | null;
  pages: { id: string; sortOrder: number; transcriptChars: number | null }[];
};

/**
 * Wie eine Runde ausging — das, was `main()` für die Pause wissen muss.
 *
 * Es wird WÄHREND der Runde gefüllt und nicht erst am Ende zurückgegeben:
 * reißt ein Netzfehler die Runde nach dem ersten Blatt ab, war der erste Lauf
 * trotzdem ein Ergebnis, und die Pause gehört zurückgesetzt.
 */
type Rundenausgang = {
  /** Mindestens ein Lauf kam zu einem Ergebnis („antwort" oder „nichts"). */
  gearbeitet: boolean;
  /** Die Runde endete an einer „pause" — mit diesem Grund. */
  pause: string | null;
  /**
   * Die Blätter im Korb, die am Ende der Runde noch auf ihre Ruhe warteten
   * (ids). `main()` sagt das einmal je neuer Menge und nicht jede Runde.
   */
  wartend: string[];
};

/**
 * Wann wieder nach nachgereichten Seiten gesucht wird — flüchtig wie
 * `ruheBis`, siehe den Kopf dieser Datei.
 */
type NachleseTakt = {
  /** Frühester Zeitpunkt (ms) der nächsten Suche. 0: gleich. */
  ab: number;
  /**
   * Die letzte Absage der App auf die Suche, schon gesagt. Eine App vor dem
   * 4.10.2026 kennt `nachgereicht` nicht und sagt jede Minute dasselbe nein —
   * im Mitlesen steht es einmal.
   */
  absage: string | null;
};

function argument(name: string): string | undefined {
  const stelle = process.argv.indexOf(`--${name}`);
  return stelle === -1 ? undefined : process.argv[stelle + 1];
}

function schalter(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Eine Angabe in Sekunden, geprüft; ohne Angabe `vorgabe`.
 *
 * Bis zum 4.10.2026 stand hier `Number(argument(…))`, und „--ruhe 20s" ergab
 * NaN. Damit war kein Blatt je ruhig (`jetzt - zuletzt >= NaN` ist immer
 * falsch), und `setTimeout` mit NaN feuert sofort — der Dienst lief also, sah
 * in den Korb und tat nie etwas, ohne ein Wort. Ein Tippfehler beim Start soll
 * deshalb beim Start scheitern, laut und vor der Sperre, damit er keinen
 * laufenden Postboten aussperrt. Null ist erlaubt: `--ruhe 0` heißt „nicht
 * warten".
 */
function sekunden(name: string, vorgabe: number): number {
  if (!schalter(name)) return vorgabe;

  const wert = argument(name);
  const zahl = wert === undefined || wert.trim() === "" ? Number.NaN : Number(wert);

  if (!Number.isFinite(zahl) || zahl < 0) {
    throw new Error(
      `--${name} erwartet eine Zahl von Sekunden (0 oder mehr), bekam ${
        wert === undefined ? "nichts" : `„${wert}"`
      }.`,
    );
  }

  return zahl;
}

function liesGesehen(): Set<string> {
  if (!existsSync(GESEHEN_DATEI)) return new Set();

  try {
    return new Set(JSON.parse(readFileSync(GESEHEN_DATEI, "utf8")) as string[]);
  } catch {
    // Eine kaputte Merkliste ist kein Grund aufzugeben — sie kostet höchstens
    // einen doppelten Vorschlag, und der steht sichtbar im Korb.
    return new Set();
  }
}

function schreibeGesehen(gesehen: Set<string>): void {
  writeFileSync(GESEHEN_DATEI, `${JSON.stringify([...gesehen], null, 2)}\n`);
}

/**
 * Der Eintrag in gesehen.json für die nachgereichten Seiten eines Blattes.
 *
 * Mit `lastPageAt` darin und nicht nur der Blatt-id: kommt später noch eine
 * Seite dazu, ist das ein neuer Schlüssel, und das Blatt ist wieder dran. Ein
 * Lauf, der nichts zustande brachte, bleibt dagegen gemerkt und wird nicht
 * jede Runde wiederholt — dieselbe Regel wie für Blätter im Korb.
 */
function nachleseSchluessel(blatt: Ablagezeile): string {
  return `nachlese:${blatt.id}:${blatt.lastPageAt}`;
}

/** Eine Zeile fürs Mitlesen: Uhrzeit, dann der Satz. */
function sagen(satz: string): void {
  const jetzt = new Date().toLocaleTimeString("de-DE", { hour12: false });
  console.log(`${jetzt}  ${satz}`);
}

function uhrzeit(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fehlertext(grund: unknown): string {
  return grund instanceof Error ? grund.message : String(grund);
}

/** Ist die letzte Seite lange genug her? Ohne Angabe: ja (ältere App). */
function ruhig(
  lastPageAt: string | null | undefined,
  ruheMs: number,
  jetzt: number,
): boolean {
  if (typeof lastPageAt !== "string") return true;

  const zuletzt = Date.parse(lastPageAt);
  if (Number.isNaN(zuletzt)) return true;

  return jetzt - zuletzt >= ruheMs;
}

/**
 * Unter welchem Schlüssel ein Blatt aus dem Korb in gesehen.json steht: seine
 * id und der Stand seiner jüngsten Seite (4.10.2026).
 *
 * Bis dahin war es die id allein. Ein Blatt, dessen Lauf nichts brachte — ein
 * unscharfes Foto, „kein Vorschlag" —, blieb danach für immer liegen, auch
 * wenn jemand ein scharfes Foto anhängte: der Dienst hatte es ja schon gesehen.
 * Mit der jüngsten Seite im Schlüssel ist ein Blatt mit neuer Seite ein neuer
 * Fall und kommt wieder dran; dasselbe Blatt ohne neue Seite nicht.
 *
 * Der Stand kommt aus `read_sheet`, auch bei `--blatt`. Nur eine App vor dem
 * 4.10.2026 nennt ihn nicht; dann bleibt es bei der bloßen id — dem alten
 * Verhalten.
 */
function korbSchluessel(zeile: { id: string; lastPageAt?: string | null }): string {
  return typeof zeile.lastPageAt === "string"
    ? `korb:${zeile.id}:${zeile.lastPageAt}`
    : zeile.id;
}

/**
 * Alte Einträge (bloße id) auf den neuen Schlüssel umziehen, sobald das Blatt
 * im Korb auftaucht. Gibt zurück, ob sich etwas geändert hat.
 *
 * Gebunden wird an den Stand, den der Korb JETZT zeigt — welchen Stand die
 * alte Liste meinte, weiß sie nicht. Hing an so einem Blatt vor dem Umzug
 * schon eine neue Seite, zählt sie als gesehen; das war mit der bloßen id
 * genauso, es wird also nichts schlechter. Ab dem Umzug macht jede neue Seite
 * das Blatt wieder offen. Neue bloße ids schreibt der Postbote selbst nur
 * noch für eine App, die `lastPageAt` nicht kennt; von Hand eingetragene
 * ziehen hier um, und genau das ist für sie gewollt.
 */
function alteSchluesselUmziehen(zeilen: Zeile[], gesehen: Set<string>): boolean {
  let geaendert = false;

  for (const zeile of zeilen) {
    const neu = korbSchluessel(zeile);
    if (neu !== zeile.id && gesehen.has(zeile.id)) {
      gesehen.delete(zeile.id);
      gesehen.add(neu);
      geaendert = true;
    }
  }

  return geaendert;
}

/** Die offenen Blätter: noch nicht durchgesehen, kein Vorschlag, in diesem Stand noch nie dran. */
function offene(zeilen: Zeile[], gesehen: Set<string>): Zeile[] {
  return zeilen.filter(
    (zeile) =>
      zeile.filedAt === null &&
      zeile.proposals.length === 0 &&
      !gesehen.has(korbSchluessel(zeile)),
  );
}

/**
 * Die offenen Blätter, die vor der Nachlese drankommen: in dieser Runde noch
 * nicht versucht und zu Rundenbeginn noch nicht ruhig.
 *
 * Gemessen wird mit der Uhr vom Rundenbeginn und nicht mit der von jetzt.
 * Liefen vorher Läufe, sind Minuten vergangen, und ein Blatt, das damals noch
 * auf seine Ruhe wartete, ist jetzt womöglich so weit — es ist trotzdem das
 * frische Blatt, dem die Runde den Vortritt lässt, und kommt in fünfzehn
 * Sekunden dran statt nach einem Nachlese-Lauf. Ein Blatt, das erst während
 * der Läufe hereinkam, zählt aus demselben Grund mit: seine letzte Seite ist
 * jünger als der Rundenbeginn.
 *
 * Nicht dabei sind zwei Arten: was diese Runde schon versucht hat (sonst hielte
 * ein Blatt, das jedes Mal in die Frist läuft, die Nachlese für immer auf), und
 * was schon zu Rundenbeginn ruhig war, aber hinter den ersten `PRO_RUNDE`
 * stand. Das Zweite käme auch in der nächsten Runde nicht dran, solange die
 * vorderen zäh bleiben — auf es zu warten hieße, die Nachlese mit
 * aufzuhalten, ohne ihm zu helfen.
 */
function frischeBlaetter(
  zeilen: Zeile[],
  gesehen: Set<string>,
  versucht: ReadonlySet<string>,
  ruheMs: number,
  rundenbeginn: number,
): Zeile[] {
  return offene(zeilen, gesehen).filter(
    (zeile) => !versucht.has(zeile.id) && !ruhig(zeile.lastPageAt, ruheMs, rundenbeginn),
  );
}

/**
 * Darf die Runde nach ihren Läufen aus dem Korb noch zur Nachlese?
 *
 * Nur, wenn KEIN Lauf zu einem Ergebnis kam und keine Pause kam. Bis zum
 * 4.10.2026 endete jede Runde mit Korb-Läufen vor der Nachlese, und ein Blatt,
 * das jedes Mal in die Frist lief, war jede Runde wieder der erste Lauf — die
 * nachgereichten Seiten kamen nie dran. Kam dagegen ein Ergebnis, sieht die
 * nächste Runde zuerst wieder in den Korb: dort ist womöglich noch mehr, und
 * der Korb geht vor. Und nach einer Pause läuft gar nichts mehr, auch keine
 * Nachlese — das leere Kontingent träfe sie genauso.
 */
function nachKorbWeiter(ausgang: Rundenausgang): boolean {
  return !ausgang.gearbeitet && ausgang.pause === null;
}

/**
 * Was ein Lauf gemessen hat, als eigene Zeile unter dem Blatt.
 *
 * Bei einem Zeitablauf gibt es nur die Wanduhr — ein abgebrochener Lauf
 * schreibt kein Ergebnis, aus dem sich mehr lesen ließe.
 */
function messungSagen(ergebnis: LaufErgebnis<unknown>): void {
  if (ergebnis.art === "spaeter") {
    if (ergebnis.wandMs !== undefined) {
      sagen(`   Wand ${Math.round(ergebnis.wandMs / 1000)} s`);
    }
    return;
  }

  if (ergebnis.messung) sagen(`   ${messungZeile(ergebnis.messung)}`);
}

/** Ein Blatt nachschlagen; `null`, wenn die App sagt, dass es das nicht gibt. */
async function blattLesen(
  verbindung: Verbindung,
  blattId: string,
): Promise<BlattDetail | null> {
  try {
    const antwort = await verbindung.werkzeug("read_sheet", { sheet: blattId });
    return (antwort.daten ?? null) as BlattDetail | null;
  } catch (grund) {
    if (grund instanceof WerkzeugFehler) {
      sagen(`→ ${blattId.slice(0, 8)} übersprungen: ${grund.message}`);
      return null;
    }
    throw grund;
  }
}

/**
 * Ein Blatt aus dem Korb durch den Käfig.
 *
 * Vor dem Lauf liest der Postbote das Blatt selbst (seit dem 4.10.2026). Zwei
 * Gründe, eine Anfrage: ein Blatt, das inzwischen eingeordnet ist, wird
 * übersprungen, statt einen Lauf zu kosten — das gilt auch für `--blatt` —,
 * und die Seiten-ids gehen gleich in den Auftrag, statt dass der Lauf einen
 * Zug dafür braucht. Die Seitenzahl daraus ist zugleich die frischeste für die
 * Frist (`fristFuer()`): der Korb kann eine Runde alt sein.
 */
async function blattEinordnen(
  verbindung: Verbindung,
  gesehen: Set<string>,
  { id: blattId, lastPageAt }: KorbBlatt,
  modell: string | undefined,
  ausgang: Rundenausgang,
): Promise<void> {
  const blatt = await blattLesen(verbindung, blattId);
  if (!blatt) return;

  sagen(`→ ${blattId.slice(0, 8)} „${blatt.title}" (${blatt.subject})`);

  if (blatt.filedAt !== null) {
    sagen("   schon eingeordnet — kein Lauf. Nachgereichte Seiten liest der Postbote von selbst.");
    return;
  }

  const seiten = [...blatt.pages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((seite) => seite.id);

  // Das Token wird vor dem Lauf geholt und nicht währenddessen: es gilt eine
  // Stunde, der Lauf dauert Minuten, und in den Käfig kommt es als Datei.
  const ergebnis = await laufFuerBlatt(
    blattId,
    verbindung.adresse,
    await verbindung.zugriffstoken(),
    modell,
    auftragFuer(blattId, { seiten, capturedOn: blatt.capturedOn }),
    fristFuer(seiten.length),
  );

  // Zwei Arten von „später", und sie unterscheiden sich hier in genau einem
  // Punkt: die Pause beendet die Runde, die Frist nimmt das nächste Blatt.
  // Gemeinsam ist beiden das Wichtigere — das Blatt wird NICHT gemerkt und
  // ist beim nächsten Durchgang wieder dran. Warum die beiden getrennt
  // gehören, steht ausführlich an `LaufErgebnis` in kaefig.mts; kurz: das
  // leere Kontingent gehört dem Abo und trifft das nächste Blatt genauso, die
  // abgelaufene Frist gehört diesem Blatt und sagt über das nächste nichts.
  if (ergebnis.art === "pause") {
    messungSagen(ergebnis);
    ausgang.pause = ergebnis.grund;
    return;
  }

  if (ergebnis.art === "spaeter") {
    sagen(`   übersprungen, später noch einmal: ${ergebnis.grund}`);
    messungSagen(ergebnis);
    // Ein Blatt, das jedes Mal in die Frist läuft, kommt auch jedes Mal
    // wieder und kostet dann jede Runde einen ganzen Lauf, ohne je fertig zu
    // werden. Eine zweite Merkliste („dreimal versucht, jetzt lass es") wäre
    // die Antwort darauf, und sie steht hier bewusst nicht: das eine
    // Gedächtnis dieses Dienstes ist mit Absicht das einzige, und ein
    // Zähler, den niemand sieht, wäre der Anfang einer zweiten Warteschlange
    // neben dem Korb. Wer so ein Blatt loswerden will, trägt seine id von
    // Hand in gesehen.json ein — oder fotografiert es besser ab.
    return;
  }

  ausgang.gearbeitet = true;
  // Der Stand, aus dem der Auftrag gebaut wurde — `read_sheet` liest ihn vor
  // den Seiten. Kam danach eine Seite dazu, ist das Blatt mit ihr ein neuer
  // Fall (siehe `korbSchluessel()`). Der Stand aus dem Korb ist nur der
  // Rückfall für eine App, die ihn in read_sheet noch nicht nennt: er ist vom
  // Rundenbeginn, und eine Seite, die seither kam, liefe noch einmal.
  gesehen.add(korbSchluessel({ id: blattId, lastPageAt: blatt.lastPageAt ?? lastPageAt }));
  schreibeGesehen(gesehen);

  if (ergebnis.art === "nichts") {
    sagen(`   kein Vorschlag: ${ergebnis.grund}`);
    messungSagen(ergebnis);
    return;
  }

  const { antwort: gesagt, kostenUsd, dauerMs } = ergebnis;
  const dauer = `${Math.round(dauerMs / 1000)} s`;

  if (gesagt.ergebnis === "vorschlag") {
    const themen = gesagt.themen.length > 0 ? gesagt.themen.join(", ") : "ohne Thema";
    // Der Betrag ist keine Rechnung, sondern was derselbe Lauf über die API
    // gekostet hätte — über das Abo zahlt er auf das Kontingent ein, nicht
    // auf die Kreditkarte. Er steht trotzdem da: er ist das einzige Maß
    // dafür, wie teuer ein Blatt den Tag macht.
    const preis = `(${dauer}, entspricht ${kostenUsd.toFixed(2)} $)`;

    sagen(`   ${await verbleib(verbindung, blattId, themen)} ${preis}`);

    // Die Abschrift bekommt eine eigene Zeile, und zwar mit beiden Zahlen.
    // „9 von 12" ist die einzige Stelle, an der jemand, der nur das Mitlesen
    // vor sich hat, merkt, dass drei Seiten nicht zu lesen waren — und das
    // ist der Hinweis, das Blatt noch einmal zu fotografieren. Ein bloßes
    // „abgeschrieben" verschwiege genau den Fall, der einen Blick wert ist.
    // Bei `seiten === 0` bleibt die Zeile weg: dann hat das Modell die Zahl
    // nicht gefüllt, und „0 von 0" wäre eine Behauptung und keine Auskunft.
    if (gesagt.seiten > 0) {
      const offen = gesagt.seiten - gesagt.abschriften;
      sagen(
        `   Abschrift: ${gesagt.abschriften} von ${gesagt.seiten} Seiten` +
          (offen > 0 ? ` — ${offen} nicht zu lesen, bleibt offen` : ""),
      );
    }

    if (gesagt.grund) sagen(`   dazu: ${gesagt.grund}`);
  } else {
    sagen(`   kein Vorschlag: ${gesagt.grund || "ohne Angabe"} (${dauer})`);
  }

  messungSagen(ergebnis);
}

/**
 * Wo das Blatt nach dem Vorschlag liegt — eingeordnet oder noch im Korb.
 *
 * Seit Jev einordnet (4.10.2026), ist „Vorschlag liegt im Korb" meistens
 * falsch: die App hat ihn Sekunden später schon übernommen. Ob, sagt nur sie,
 * also wird nachgelesen, und zwar mit dem, was Jev entschieden hat — Fach und
 * Themen des Blattes, nicht die des Modells.
 *
 * Geht das Nachlesen schief, bleibt es bei der alten Zeile: eine Kontrolle
 * darf die Runde nicht umwerfen, deren Arbeit längst getan ist (dieselbe Lehre
 * wie in nachlese.mts vom 7.9.2026).
 */
async function verbleib(
  verbindung: Verbindung,
  blattId: string,
  themen: string,
): Promise<string> {
  try {
    const antwort = await verbindung.werkzeug("read_sheet", { sheet: blattId });
    const blatt = antwort.daten as BlattDetail | null;

    if (blatt && blatt.filedAt !== null) {
      const eingeordnet = blatt.topics.length > 0 ? blatt.topics.join(", ") : "ohne Thema";
      return `eingeordnet: ${blatt.subject} — ${eingeordnet}`;
    }

    if (blatt) return `liegt im Korb: ${themen}`;
  } catch (grund) {
    if (grund instanceof ZugangVerloren) throw grund;
    sagen(`   nicht nachgesehen, ob Jev eingeordnet hat: ${fehlertext(grund)}`);
  }

  return `Vorschlag liegt im Korb: ${themen}`;
}

/**
 * Die Seiten eines Blattes mit der Länge ihrer Abschrift (`null`: ungelesen);
 * `null` insgesamt, wenn das Nachsehen nicht ging.
 */
async function seitenstand(
  verbindung: Verbindung,
  blattId: string,
): Promise<Map<string, number | null> | null> {
  try {
    const antwort = await verbindung.werkzeug("read_sheet", { sheet: blattId });
    const blatt = antwort.daten as BlattDetail | null;
    return blatt
      ? new Map(blatt.pages.map((seite) => [seite.id, seite.transcriptChars]))
      : null;
  } catch (grund) {
    if (grund instanceof ZugangVerloren) throw grund;
    return null;
  }
}

/** „1 Seite", „3 Seiten". */
function seitenZahl(zahl: number): string {
  return `${zahl} Seite${zahl === 1 ? "" : "n"}`;
}

/**
 * Nachgereichte Seiten eines eingeordneten Blattes durch den Käfig.
 *
 * Mit dem Auftrag und dem Käfig der Nachlese (`nachleseAuftragFuer()`), nicht
 * mit einem dritten: der Auftrag nennt genau EIN Feld, die Abschriften, und
 * genau einen solchen Vorschlag übernimmt die App an einem eingeordneten Blatt
 * sofort. Nennt der Lauf doch mehr, bleibt der Vorschlag im Korb, und ein
 * Mensch sieht ihn — das sagt die Zeile danach.
 *
 * Seit dem 4.10.2026 nennt der Auftrag die Seiten beim Namen
 * (`unreadAttachedPageIds`) und schließt jede andere ungelesene Seite aus —
 * warum, steht an `nachleseAuftragFuer()`. Davor liest der Postbote das Blatt
 * selbst und nimmt nur die genannten Seiten, die JETZT noch ungelesen sind:
 * die Liste der App kann eine Minute alt sein.
 *
 * Ob übernommen wurde, wird gezählt und nicht geglaubt — und zwar an genau
 * diesen Seiten, vorher und nachher aus read_sheet. Bis zum 4.10.2026 zählte
 * der Postbote alle ungelesenen Seiten des Blattes, und das Mitlesen zeigte
 * „1 nachgereichte Seite ungelesen" über „übernommen: 4 Seiten": die Zahl oben
 * kam von der App, die unten vom ganzen Blatt. Jetzt meinen beide Zeilen
 * dieselben Seiten; schreibt der Lauf trotzdem eine andere ab, steht das als
 * eigene Warnung da.
 */
/**
 * Liegt am Blatt schon ein Vorschlag, der jünger ist als seine letzte Seite?
 * Gefragt wird im Korb (read_inbox nennt je Vorschlag `createdAt`). Geht die
 * Frage schief, ist die Antwort nein — dann läuft die Nachlese wie sonst.
 */
async function vorschlagWartetSchon(
  verbindung: Verbindung,
  blatt: Ablagezeile,
): Promise<boolean> {
  if (typeof blatt.lastPageAt !== "string") return false;
  const seit = Date.parse(blatt.lastPageAt);
  if (Number.isNaN(seit)) return false;

  try {
    const zeile = (await korbLesen(verbindung, new Set())).find(
      (eintrag) => eintrag.id === blatt.id,
    );
    const vorschlaege = (zeile?.proposals ?? []) as { createdAt?: unknown }[];
    return vorschlaege.some(
      (vorschlag) =>
        typeof vorschlag.createdAt === "string" &&
        Date.parse(vorschlag.createdAt) > seit,
    );
  } catch (grund) {
    if (grund instanceof ZugangVerloren) throw grund;
    return false;
  }
}

async function seitenNachlesen(
  verbindung: Verbindung,
  gesehen: Set<string>,
  blatt: Ablagezeile,
  nachgereicht: readonly string[],
  modell: string | undefined,
  ausgang: Rundenausgang,
): Promise<void> {
  // Vorher einmal lesen: gibt es das Blatt nicht mehr, kostet es keinen Lauf,
  // und der Stand von jetzt ist der, gegen den nachher gezählt wird.
  const detail = await blattLesen(verbindung, blatt.id);
  if (!detail) return;

  const genannt = new Set(nachgereicht);
  const ziel = [...detail.pages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((seite) => genannt.has(seite.id) && seite.transcriptChars === null)
    .map((seite) => seite.id);
  const vorherUngelesen = detail.pages
    .filter((seite) => seite.transcriptChars === null)
    .map((seite) => seite.id);

  sagen(
    `→ ${blatt.id.slice(0, 8)} „${blatt.title}" (${blatt.subject}) — ` +
      `${seitenZahl(ziel.length)} nachgereicht und ungelesen`,
  );

  if (ziel.length === 0) {
    // Inzwischen gelesen oder gelöscht. Kein Lauf und kein Eintrag in
    // gesehen.json: die App nennt das Blatt dann ohnehin nicht mehr.
    sagen("   inzwischen nichts mehr offen — kein Lauf.");
    return;
  }

  // Wartet an dem Blatt schon ein Vorschlag, der NACH der letzten Seite kam,
  // stammt er von einem früheren Lauf zu genau diesen Seiten — einer, der
  // seinen Vorschlag abgab und danach an Pause oder Frist scheiterte, oder
  // dessen Vorschlag die App nicht selbst übernehmen durfte. Ein zweiter
  // läge nur daneben (4.10.2026). Gemerkt wird das Blatt dann wie nach einem
  // Ergebnis; eine neue Seite macht es wieder offen.
  if (await vorschlagWartetSchon(verbindung, blatt)) {
    sagen("   ein Vorschlag zu diesen Seiten liegt schon im Korb — kein zweiter Lauf.");
    gesehen.add(nachleseSchluessel(blatt));
    schreibeGesehen(gesehen);
    return;
  }

  const ergebnis = await laufFuerBlatt(
    blatt.id,
    verbindung.adresse,
    await verbindung.zugriffstoken(),
    modell,
    nachleseAuftragFuer(blatt.id, ziel),
    fristFuer(ziel.length),
  );

  // Dieselbe Unterscheidung wie im Korb, mit demselben Gedächtnis: gemerkt
  // wird nur, was zu einem Ergebnis kam.
  if (ergebnis.art === "pause") {
    messungSagen(ergebnis);
    ausgang.pause = ergebnis.grund;
    return;
  }

  if (ergebnis.art === "spaeter") {
    sagen(`   übersprungen, später noch einmal: ${ergebnis.grund}`);
    messungSagen(ergebnis);
    return;
  }

  ausgang.gearbeitet = true;
  gesehen.add(nachleseSchluessel(blatt));
  schreibeGesehen(gesehen);

  if (ergebnis.art === "nichts") {
    sagen(`   kein Vorschlag: ${ergebnis.grund}`);
    messungSagen(ergebnis);
    return;
  }

  const { antwort, kostenUsd, dauerMs } = ergebnis;
  const preis = `(${Math.round(dauerMs / 1000)} s, entspricht ${kostenUsd.toFixed(2)} $)`;

  if (antwort.ergebnis !== "vorschlag") {
    sagen(`   kein Vorschlag: ${antwort.grund || "ohne Angabe"} ${preis}`);
    messungSagen(ergebnis);
    return;
  }

  const nachher = await seitenstand(verbindung, blatt.id);

  if (nachher === null) {
    sagen(`   Vorschlag angelegt: ${antwort.abschriften} Abschrift(en) ${preis}`);
  } else {
    // Gelesen ist eine Seite, an der jetzt eine Zahl steht. Eine Seite, die
    // inzwischen gelöscht wurde, fehlt in `nachher` und zählt nicht mit.
    const gelesen = (id: string) => typeof nachher.get(id) === "number";
    const uebernommen = ziel.filter(gelesen).length;
    const fremd = vorherUngelesen.filter((id) => !genannt.has(id) && gelesen(id)).length;
    const offen = ziel.length - uebernommen;

    if (uebernommen > 0) {
      sagen(
        `   abgeschrieben und übernommen: ${uebernommen} von ${seitenZahl(ziel.length)}` +
          (offen > 0 ? ` — ${offen} nicht zu lesen, bleibt offen` : "") +
          ` ${preis}`,
      );
    } else if (fremd === 0) {
      // Übernommen wird nur ein Vorschlag, der nichts als Abschriften noch
      // ungelesener Seiten nennt. Alles andere bleibt für einen Menschen liegen.
      sagen(`   nichts übernommen — was der Lauf vorschlug, liegt im Korb ${preis}`);
    } else {
      sagen(`   keine der ${seitenZahl(ziel.length)} aus dem Auftrag übernommen ${preis}`);
    }

    if (fremd > 0) {
      // Der Auftrag schließt diese Seiten ausdrücklich aus; sind sie jetzt
      // trotzdem gelesen, hat sie fast sicher der Lauf mit abgeschrieben und
      // die App übernommen (oder, seltener, ein Mensch in derselben Minute).
      // Nicht falsch im Ergebnis, aber gegen die Abmachung — gerade bei einem
      // Altblatt ist das der Fall, den ein Mensch wissen will.
      sagen(
        `   ⚠ dazu ${fremd === 1 ? "ist" : "sind"} ${seitenZahl(fremd)} gelesen, die nicht im Auftrag ${fremd === 1 ? "stand" : "standen"} — vermutlich vom Lauf mit abgeschrieben.`,
      );
    }
  }

  if (antwort.grund) sagen(`   dazu: ${antwort.grund}`);
  messungSagen(ergebnis);
}

/** Ein Blatt aus dem Korb: seine id und, wenn bekannt, der Stand seiner jüngsten Seite. */
type KorbBlatt = { id: string; lastPageAt?: string | null };

/** Blätter des Korbs, eins nach dem anderen, bis eine Pause kommt. */
async function blaetterEinordnen(
  verbindung: Verbindung,
  gesehen: Set<string>,
  blaetter: KorbBlatt[],
  modell: string | undefined,
  ausgang: Rundenausgang,
): Promise<void> {
  for (const blatt of blaetter) {
    await blattEinordnen(verbindung, gesehen, blatt, modell, ausgang);
    if (ausgang.pause !== null) return;
  }
}

/** Der Korb, wie read_inbox ihn nennt — alte Merkeinträge gleich umgezogen. */
async function korbLesen(
  verbindung: Verbindung,
  gesehen: Set<string>,
): Promise<Zeile[]> {
  const antwort = await verbindung.werkzeug("read_inbox", { limit: 50 });
  const zeilen = (antwort.daten ?? []) as Zeile[];
  if (alteSchluesselUmziehen(zeilen, gesehen)) schreibeGesehen(gesehen);
  return zeilen;
}

/**
 * Eine Runde: erst der Korb, danach — wenn es sich ergibt — die nachgereichten
 * Seiten.
 *
 * Zur Nachlese geht es auf zwei Wegen. Entweder ist im Korb nichts dran. Oder
 * es liefen Blätter aus dem Korb, und keines kam zu einem Ergebnis
 * (`nachKorbWeiter()`) — dann wird der Korb noch einmal gelesen, denn die
 * Läufe können Minuten gedauert haben. In beiden Fällen geht ein frisches
 * Blatt vor (`frischeBlaetter()`): ein Nachlese-Lauf jetzt hielte es Minuten
 * auf, und in fünfzehn Sekunden ist es selbst dran.
 */
async function runde(
  verbindung: Verbindung,
  gesehen: Set<string>,
  modell: string | undefined,
  nurDieses: string | undefined,
  ruheMs: number,
  ausgang: Rundenausgang,
  takt: NachleseTakt,
): Promise<void> {
  if (nurDieses) {
    await blaetterEinordnen(verbindung, gesehen, [{ id: nurDieses }], modell, ausgang);
    return;
  }

  const rundenbeginn = Date.now();
  let korb = await korbLesen(verbindung, gesehen);

  const dran = offene(korb, gesehen)
    .filter((zeile) => ruhig(zeile.lastPageAt, ruheMs, rundenbeginn))
    .slice(0, PRO_RUNDE)
    .map((zeile) => ({ id: zeile.id, lastPageAt: zeile.lastPageAt }));
  const versucht = new Set(dran.map((blatt) => blatt.id));

  if (dran.length > 0) {
    sagen(`${dran.length} Blatt/Blätter zu bearbeiten.`);
    await blaetterEinordnen(verbindung, gesehen, dran, modell, ausgang);

    if (!nachKorbWeiter(ausgang)) return;
    korb = await korbLesen(verbindung, gesehen);
  }

  const frisch = frischeBlaetter(korb, gesehen, versucht, ruheMs, rundenbeginn);

  if (frisch.length > 0) {
    // Gesagt wird nur, was JETZT noch wartet. Ein Blatt, das während der
    // Läufe ruhig geworden ist, ist in der nächsten Runde dran und bekommt
    // dort seine eigene Zeile.
    const jetzt = Date.now();
    ausgang.wartend = frisch
      .filter((zeile) => !ruhig(zeile.lastPageAt, ruheMs, jetzt))
      .map((zeile) => zeile.id);
    return;
  }

  await nachgereichteSeiten(verbindung, gesehen, modell, ruheMs, ausgang, takt);
}

/**
 * Die Seiten, die die App an einem Blatt als nachgereicht nennt; `null`, wenn
 * keine — oder wenn die App die Liste gar nicht liefert (vor dem 4.10.2026).
 * Dann bleibt das Blatt liegen: ohne die Liste schriebe der Auftrag jede
 * ungelesene Seite ab, auch die eines Altblattes.
 */
function nachgereichteIds(blatt: Ablagezeile): string[] | null {
  const ids = blatt.unreadAttachedPageIds;
  if (!Array.isArray(ids)) return null;

  const gueltig = ids.filter((id): id is string => typeof id === "string" && id !== "");
  return gueltig.length > 0 ? gueltig : null;
}

/**
 * Die eingeordneten Blätter mit nachgereichten, ungelesenen Seiten.
 *
 * Nur, wenn im Korb nichts zu tun ist — ein neues Blatt geht vor. Ein
 * Vorschlag, der an dem Blatt schon auf einen Menschen wartet, hält die
 * nachgereichte Seite seit dem 4.10.2026 nicht mehr auf: die App übernimmt
 * die reine Abschrift und räumt dabei nur diesen einen Vorschlag weg
 * (`nurVorschlag` in @/lib/inbox-apply), der andere bleibt stehen. Bis dahin
 * blieb die Seite liegen, solange der andere Vorschlag wartete — und das
 * Foto wäre nicht mehr der einzige Handgriff gewesen. Die Regel
 * `mitVorschlag()` gilt nur noch in nachlese.mts, wo ein Mensch sie liest.
 *
 * Gefragt wird seit dem 4.10.2026 mit `nachgereicht: true`: die App liefert
 * dann nur die Blätter, um die es geht, und filtert selbst, VOR ihrer Grenze
 * von zweihundert Zeilen. Vorher kam die ganze Ablage — jede Runde, über den
 * Funnel —, und sobald sie mehr als zweihundert Blätter hätte, fiele ein
 * älteres Blatt mit neuer Rückseite hinter die Grenze und käme nie dran. Und
 * gefragt wird höchstens alle `NACHLESE_SEKUNDEN`, nicht in jeder Runde.
 */
async function nachgereichteSeiten(
  verbindung: Verbindung,
  gesehen: Set<string>,
  modell: string | undefined,
  ruheMs: number,
  ausgang: Rundenausgang,
  takt: NachleseTakt,
): Promise<void> {
  if (Date.now() < takt.ab) return;

  // Vor der Anfrage gesetzt und nicht danach: geht sie schief, wird trotzdem
  // erst in einer Minute wieder gefragt.
  takt.ab = Date.now() + NACHLESE_SEKUNDEN * 1000;

  let blaetter: Ablagezeile[];
  try {
    const liste = await verbindung.werkzeug("read_material", { nachgereicht: true });
    blaetter = (liste.daten ?? []) as Ablagezeile[];
    takt.absage = null;
  } catch (grund) {
    if (!(grund instanceof WerkzeugFehler)) throw grund;

    // Ein Nein der App und kein Netzfehler — meist eine App, die
    // `nachgereicht` noch nicht kennt. Die Runde ist trotzdem durchgegangen;
    // als „Diese Runde ging schief" stünde es jede Minute einmal und dazwischen
    // „Die Runde ging wieder durch". So steht es einmal da.
    if (grund.message !== takt.absage) {
      sagen(`Nachgereichte Seiten bleiben liegen — read_material sagt: ${grund.message}`);
      takt.absage = grund.message;
    }
    return;
  }

  const jetzt = Date.now();
  const dran = blaetter
    .flatMap((blatt) => {
      const seiten = nachgereichteIds(blatt);
      return seiten ? [{ blatt, seiten }] : [];
    })
    .filter(
      ({ blatt }) =>
        // Ohne `lastPageAt` gäbe es keinen Schlüssel, der eine spätere Seite
        // von dieser unterscheidet — dann lieber gar nicht.
        typeof blatt.lastPageAt === "string" &&
        ruhig(blatt.lastPageAt, ruheMs, jetzt) &&
        !gesehen.has(nachleseSchluessel(blatt)),
    )
    .slice(0, PRO_RUNDE);

  if (dran.length === 0) return;

  sagen(`${dran.length} Blatt/Blätter mit nachgereichten Seiten.`);

  for (const { blatt, seiten } of dran) {
    await seitenNachlesen(verbindung, gesehen, blatt, seiten, modell, ausgang);
    if (ausgang.pause !== null) return;
  }
}

async function main(): Promise<void> {
  // Die Angaben zuerst, vor der Sperre: ein Tippfehler soll scheitern, bevor
  // er einem laufenden Postboten in die Quere kommt (`sekunden()`).
  const intervall = sekunden("intervall", INTERVALL_SEKUNDEN) * 1000;
  const modell = argument("modell");
  const nurDieses = argument("blatt");
  const einmal = schalter("einmal") || nurDieses !== undefined;
  const ruheMs = sekunden("ruhe", einmal ? 0 : RUHE_SEKUNDEN) * 1000;

  sperren("Der Postbote");

  const verbindung = new Verbindung(liesZugang());
  const gesehen = liesGesehen();

  sagen(`Postbote wach. ${verbindung.adresse}`);
  if (!einmal) sagen(`Sieht alle ${Math.round(intervall / 1000)} s nach. Beenden mit Strg-C.`);

  // Aufhören heißt aufhören: ohne diese Zeile bliebe der Prozess nach Strg-C
  // noch bis zum Ende der laufenden Runde stehen, und das kann seit der Frist
  // nach Seitenzahl eine Dreiviertelstunde dauern.
  process.on("SIGINT", () => {
    sagen("Postbote macht Feierabend.");
    process.exit(0);
  });

  // Flüchtiger Zustand dieses Prozesses, kein Gedächtnis — siehe oben.
  let ruheBis = 0;
  let pauseMs = PAUSE_ANFANG_MS;
  let letzterFehler: string | null = null;
  let letzteWartende = "";
  const takt: NachleseTakt = { ab: 0, absage: null };

  for (;;) {
    if (Date.now() >= ruheBis) {
      const ausgang: Rundenausgang = { gearbeitet: false, pause: null, wartend: [] };

      try {
        await runde(verbindung, gesehen, modell, nurDieses, ruheMs, ausgang, takt);

        if (letzterFehler !== null) {
          sagen("Die Runde ging wieder durch.");
          letzterFehler = null;
        }
      } catch (grund) {
        if (grund instanceof ZugangVerloren) throw grund;

        // Alles andere ist der Alltag eines Dienstes: ein Netz, das kurz weg
        // war, ein Werkzeug, das nein sagt. Aufhören wäre die falsche Antwort.
        // Gesagt wird es einmal und nicht alle fünfzehn Sekunden: ein Funnel,
        // der eine Stunde weg ist, füllte sonst das Mitlesen mit 240 gleichen
        // Zeilen und verdeckte alles andere.
        const satz = fehlertext(grund);
        if (satz !== letzterFehler) {
          sagen(`Diese Runde ging schief: ${satz}`);
          letzterFehler = satz;
        }
      }

      // Wartende Blätter einmal je neuer Menge, aus demselben Grund wie der
      // Fehler oben: alle fünfzehn Sekunden dieselbe Zeile wäre Rauschen. Eine
      // Runde ohne Wartende setzt das zurück.
      const wartende = [...ausgang.wartend].sort().join(",");
      if (wartende !== letzteWartende && ausgang.wartend.length > 0) {
        sagen(`${ausgang.wartend.length} Blatt/Blätter warten noch auf Ruhe.`);
      }
      letzteWartende = wartende;

      if (ausgang.gearbeitet) pauseMs = PAUSE_ANFANG_MS;

      if (ausgang.pause !== null) {
        ruheBis = Date.now() + pauseMs;
        sagen(`Pause bis ${uhrzeit(ruheBis)}: ${ausgang.pause}`);
        pauseMs = Math.min(pauseMs * 2, PAUSE_HOECHSTENS_MS);
      }
    }

    if (einmal) return;

    await new Promise((weiter) => setTimeout(weiter, intervall));
  }
}

main().catch((grund: unknown) => {
  console.error(`\n${grund instanceof Error ? grund.message : String(grund)}`);
  process.exit(1);
});
