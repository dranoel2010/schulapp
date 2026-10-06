import type { LeserGrund } from "@/db/schema";
import { autoFile, type AutoFileResult } from "@/lib/auto-file";
import { createQueue, type Queue } from "@/lib/calendar/queue";
import {
  convertPage,
  doclingConfigured,
  doclingFehlschlag,
  doclingPausiertBis,
  trifftDocling,
  type DoclingResult,
} from "@/lib/docling";
import { createProposal, proposalInputSchema } from "@/lib/inbox";
import {
  SAUBER_FRAGE,
  askJev,
  jevConfigured,
  ocrState,
  readNoul,
} from "@/lib/jev";
import { titelAusErsterSeite } from "@/lib/leser/abschrift";
import {
  JEV_SCHWELLE,
  REGEL_VERSION,
  RUHE_MS,
  appVorschlagFaellig,
  grundOhneMessung,
  leserRegelAus,
  vorpruefen,
} from "@/lib/leser/regel";
import {
  MATERIAL_TITLE_MAX,
  MATERIAL_TRANSCRIPT_MAX,
  defaultMaterialTitle,
  korbblattStand,
  leserFestlegen,
  offeneSeiten,
  readPageImage,
  setMaterialTranscripts,
  type OffeneSeite,
} from "@/lib/materials";

/**
 * Ein Leser je Seite, und die App entscheidet, welcher (seit dem 6.10.2026).
 *
 * Bis hierher las jede Seite zweimal: Docling rechnete sie für den Postboten
 * vor, und Claude schrieb sie danach vom Foto ab, mit Doclings Text als
 * Vorlage — wer was übernimmt, entschied ein Satz im Prompt. Jetzt liest
 * Docling jede neue Seite genau EINMAL, angestoßen von der App nach dem
 * Hochladen, und eine feste Regel samt Einstufung durch Jev entscheidet:
 *
 * - **Docling** liest allein, wenn der Text sauberer Druck ist
 *   (@/lib/leser/regel, Stufe a bis d, dann Jev ≥ `JEV_SCHWELLE`). Die
 *   Abschrift schreibt diese Datei selbst in die Seite; Claude sieht die
 *   Seite nie.
 * - **Claude** liest vom Foto, ohne Vorlage — in jedem anderen Fall, auch
 *   bei jedem Fehler: Docling aus, Zeitablauf, Pause, nicht eingerichtet; Jev
 *   nicht eingerichtet oder nicht erreichbar. Nie blockieren — eine Seite,
 *   über die nicht entschieden werden kann, liest Claude, wie vor Docling.
 *
 * Doclings Rohtext steht danach in `material_pages.docling_text`, für jede
 * Seite, auch eine Handschriftseite; er wird nie neu gerechnet.
 *
 * ── Der direkte Schreibweg und sein benannter Anlass ────────────────────────
 *
 * Agenten schreiben nie in den Bestand; ihre Abschrift wartet als Vorschlag,
 * bis ein Mensch oder Jev sie übernimmt (src/db/schema.ts an
 * `materialProposals`). Diese Datei schreibt eine Abschrift direkt, und das
 * ist keine Ausnahme von der Regel, sondern ihr Grund in anderer Form: die
 * Regel schützt vor einem Leser, der Sätze auf dem Blatt als Anweisung
 * nehmen könnte. Docling ist kein solcher Leser — es erkennt Zeichen und
 * befolgt nichts —, und die Bestätigung, die sonst ein Mensch gibt, gibt hier
 * die feste Regel plus Jevs Einstufung. Geschrieben wird nur in eine Seite
 * ohne Abschrift (`nurUngelesene`), und gekennzeichnet (`maschinell`). Kein
 * Agent kann diesen Weg auslösen oder sein Ergebnis bestimmen: `read_inbox`
 * stößt höchstens die Arbeit an schon hochgeladenen Seiten an.
 *
 * ── Der Prozess ─────────────────────────────────────────────────────────────
 *
 * Eine Queue je Prozess (@/lib/calendar/queue, unverändert benutzt), an
 * `globalThis` aus demselben Grund wie die Datenbank in @/db: Next wertet
 * dieses Modul womöglich in mehreren Bündeln aus, und zwei Queues ließen
 * Docling dieselbe Seite zweimal rechnen. Die Queue hängt einen Anstoß an
 * einen wartenden Lauf an, statt einen zweiten einzureihen — genau die
 * Idempotenz, die hier gebraucht wird: ein Lauf liest die offenen Seiten erst
 * beim Start und nimmt jede neue mit. Und es läuft nur einer zur Zeit, also
 * rechnet Docling seitenweise und nie zwei Seiten nebeneinander auf dem NAS.
 *
 * Angestoßen wird an vier Stellen, keine davon ist ein Takt: nach dem
 * Hochladen (`after()` in src/app/(app)/material/actions.ts), nach dem
 * Löschen einer Seite (dort ebenso — ein Blatt kann dadurch ganz von Docling
 * gelesen sein), bei jedem `read_inbox` des Postboten (das Netz nach einem
 * Neustart, wenn noch Seiten offen sind) und vom Wecker für die Ruhe vor
 * einem App-Vorschlag. Nur Seiten mit `leser = 'offen'` werden angefasst;
 * Fehlschläge von Docling und Jev entscheiden sofort für Claude und werden
 * nie wiederholt.
 *
 * Eine offene Seite, die schon eine Abschrift trägt, liest Docling nicht noch
 * einmal: stammt sie von Docling selbst (ein Abbruch zwischen Schreiben und
 * Festhalten), wird nur die Entscheidung nachgeholt; stammt sie von Hand oder
 * von Claude, ist die Seite gelesen, und Docling wie Jev blieben ein Aufwand
 * für nichts — dazu ein `leser_grund`, der eine fremde Abschrift als
 * Docling-Seite zählte.
 */

/** Was Docling zu einer Seite gesagt hat — oder warum es nicht gefragt wurde. */
export type DoclingAusgang =
  | { art: "ok"; ergebnis: DoclingResult }
  | { art: "nicht-gefragt"; grund: "aus" | "docling-fehlt" | "docling-pause" }
  | { art: "fehler"; ausfall: boolean };

/** Die Entscheidung über eine Seite, samt allem, was dafür gespeichert wird. */
export type LeserWahl = {
  leser: "docling" | "claude";
  grund: LeserGrund;
  /** Die Abschrift, die geschrieben wird — nur bei `'docling'`. */
  abschrift: string | null;
  /** Doclings Rohtext für `docling_text`, wenn Docling geantwortet hat. */
  doclingText: string | null;
};

/** Wie Jev gefragt wird — herausgezogen, damit ein Test es ersetzen kann. */
export type JevEinstufung = {
  konfiguriert: boolean;
  /** Die Wahrscheinlichkeit für „sauber“, oder `null`, wenn Jev nichts sagte. */
  frage(state: string): Promise<number | null>;
};

/**
 * Entscheidet über eine Seite, nachdem Docling sie gelesen hat (oder nicht).
 *
 * Jeder Ausgang außer dem letzten heißt Claude, und Jev wird nur gefragt,
 * wenn die feste Regel davor bestanden ist — das ist die billige Reihenfolge,
 * und es ist der Datenschutz: der OCR-Text einer Handschriftseite geht an
 * kein Modell, wenn er schon an Wortzahl oder Formel scheitert.
 *
 * Wirft nie: ein Fehler beim Fragen ist `jev-fehler`, und dann liest Claude.
 */
export async function leserWaehlen(
  ausgang: DoclingAusgang,
  jev: JevEinstufung,
): Promise<LeserWahl> {
  if (ausgang.art === "nicht-gefragt") {
    return fuerClaude(grundOhneMessung(ausgang.grund), null);
  }

  if (ausgang.art === "fehler") {
    return fuerClaude(
      grundOhneMessung(ausgang.ausfall ? "docling-ausfall" : "docling-fehler"),
      null,
    );
  }

  const { ergebnis } = ausgang;
  const pruefung = vorpruefen(ergebnis, MATERIAL_TRANSCRIPT_MAX);
  const gemessen = (
    grund: LeserGrund["grund"],
    wahrscheinlichkeit: number | null,
  ): LeserGrund => ({
    regel: REGEL_VERSION,
    grund,
    woerter: pruefung.merkmale.woerter,
    formel: pruefung.merkmale.formel,
    zeichen: pruefung.merkmale.zeichen,
    jev: wahrscheinlichkeit,
    sekunden: ergebnis.seconds,
  });

  if (!pruefung.ok) {
    return fuerClaude(gemessen(pruefung.grund, null), ergebnis.markdown);
  }

  if (!jev.konfiguriert) {
    return fuerClaude(gemessen("jev-fehlt", null), ergebnis.markdown);
  }

  let wahrscheinlichkeit: number | null;
  try {
    wahrscheinlichkeit = await jev.frage(ocrState(ergebnis.markdown));
  } catch {
    wahrscheinlichkeit = null;
  }

  if (wahrscheinlichkeit === null) {
    return fuerClaude(gemessen("jev-fehler", null), ergebnis.markdown);
  }

  if (wahrscheinlichkeit < JEV_SCHWELLE) {
    return fuerClaude(
      gemessen("jev-unsicher", wahrscheinlichkeit),
      ergebnis.markdown,
    );
  }

  return {
    leser: "docling",
    grund: gemessen("sauber", wahrscheinlichkeit),
    abschrift: pruefung.abschrift,
    doclingText: ergebnis.markdown,
  };
}

function fuerClaude(grund: LeserGrund, doclingText: string | null): LeserWahl {
  return { leser: "claude", grund, abschrift: null, doclingText };
}

/** Was ein Lauf von außen braucht; jede Angabe hat eine Vorgabe für den Betrieb. */
export type ZuteilungDeps = {
  docling(
    bytes: Uint8Array<ArrayBuffer>,
    mimeType: string,
  ): Promise<DoclingResult>;
  doclingKonfiguriert: boolean;
  jevKonfiguriert: boolean;
  jevFrage(state: string): Promise<number | null>;
};

/**
 * Die echte Frage an Jev. Ein Fehler kommt ins Protokoll und wird zu `null`
 * — dann liest Claude, und der Grund heißt `jev-fehler`.
 */
async function jevFragen(state: string): Promise<number | null> {
  try {
    const { answers } = await askJev(state, { sauber: SAUBER_FRAGE });
    return readNoul(answers.sauber);
  } catch (error) {
    console.error(`Leser: Jev hat nicht eingestuft — ${meldung(error)}`);
    return null;
  }
}

/**
 * So lange ruht eine Seite, deren Zuteilung mit einem unerwarteten Fehler
 * abbrach und die danach nicht einmal für Claude festgehalten werden konnte.
 *
 * Realistisch ist das ein Datenbankfehler — Postgres startet gerade neu
 * (DSM-Update, `compose up -d`), während Docling rechnet. Für immer sperren
 * hieße: die Seite stünde bis zum nächsten Neustart der App auf „offen“, und
 * der Postbote ließe ihr Blatt Runde für Runde liegen. Gar nicht sperren
 * hieße: jeder `read_inbox` alle 15 Sekunden liefe in denselben Fehler und
 * rechnete Docling von vorn. Zehn Minuten liegen dazwischen — genug, dass
 * eine Datenbank wieder da ist, und ein deterministischer Fehler kostet
 * höchstens sechs Versuche in der Stunde.
 */
export const ZWEITER_VERSUCH_MS = 10 * 60_000;

/** Ruht diese Seite noch? `seit` ist der Zeitpunkt des Fehlschlags. */
export function nochGesperrt(seit: number | undefined, jetzt: number): boolean {
  return seit !== undefined && jetzt - seit < ZWEITER_VERSUCH_MS;
}

type Prozess = {
  queue: Queue<void>;
  /** Blätter, die beim nächsten Lauf auf einen App-Vorschlag geprüft werden. */
  pruefen: Map<string, Set<string>>;
  /** Der Wecker für die Ruhe vor dem App-Vorschlag, je Blatt höchstens einer. */
  timer: Map<string, ReturnType<typeof setTimeout>>;
  /**
   * Seiten, deren Zuteilung mit einem unerwarteten Fehler abbrach und die
   * danach offen blieben, mit dem Zeitpunkt (siehe `ZWEITER_VERSUCH_MS`).
   * Nur im Speicher; nach einem Neustart bekommen sie gleich einen Versuch.
   */
  gescheitert: Map<string, number>;
};

const globalForLeser = globalThis as unknown as { __schulappLeser?: Prozess };

function prozess(): Prozess {
  globalForLeser.__schulappLeser ??= {
    queue: createQueue<void>(),
    pruefen: new Map(),
    timer: new Map(),
    gescheitert: new Map(),
  };
  return globalForLeser.__schulappLeser;
}

/**
 * Merkt ein Blatt für die Prüfung auf einen App-Vorschlag vor, ohne dass
 * eine Seite entschieden wurde, und stößt an. Für das Löschen einer Seite:
 * fällt die einzige Claude-Seite eines Blattes weg (ein verwackeltes Foto),
 * ist es danach ganz von Docling gelesen — und ohne diesen Anstoß fragte
 * niemand, denn der Postbote hat es mit „einordnen tut die App“ schon
 * gemerkt. Wirft nie.
 */
export function korbblattAnstossen(userId: string, materialId: string): void {
  try {
    vormerken(userId, materialId);
  } catch (error) {
    console.error(`Leser: Blatt nicht vorgemerkt — ${meldung(error)}`);
  }
  zuteilungAnstossen(userId);
}

function vormerken(userId: string, materialId: string): void {
  const p = prozess();
  const vorgemerkt = p.pruefen.get(userId) ?? new Set<string>();
  vorgemerkt.add(materialId);
  p.pruefen.set(userId, vorgemerkt);
}

/**
 * Stößt die Zuteilung für diesen Nutzer an und kehrt sofort zurück. Wirft
 * nie — ein Fehler landet im Protokoll. Die einzige Funktion, die der
 * MCP-Weg (`read_inbox`) benutzt.
 */
export function zuteilungAnstossen(userId: string): void {
  try {
    void zuteilungLaufen(userId).catch((error: unknown) => {
      console.error(`Leser: Zuteilung abgebrochen — ${meldung(error)}`);
    });
  } catch (error) {
    console.error(`Leser: Zuteilung nicht angestoßen — ${meldung(error)}`);
  }
}

/**
 * Ein Lauf der Zuteilung über alle offenen Seiten dieses Nutzers — oder das
 * Warten auf den Lauf, der schon ansteht (siehe Kopf). `deps` ersetzt Docling
 * und Jev für die Probe (scripts/probe-leser.mts); hängt sich der Aufruf an
 * einen wartenden Lauf an, gelten dessen Angaben.
 */
export function zuteilungLaufen(
  userId: string,
  deps?: Partial<ZuteilungDeps>,
): Promise<void> {
  return prozess().queue.request(
    userId,
    { frist: null, geduld: null },
    () => lauf(userId, deps ?? {}),
    () => undefined,
  );
}

async function lauf(userId: string, deps: Partial<ZuteilungDeps>): Promise<void> {
  const p = prozess();
  // Erst beim Start ausgewertet, nicht beim Anstoßen: ein Lauf, der hinter
  // einem anderen gewartet hat, sieht so den Stand, mit dem er arbeitet.
  const d: ZuteilungDeps = {
    docling: deps.docling ?? convertPage,
    doclingKonfiguriert: deps.doclingKonfiguriert ?? doclingConfigured(),
    jevKonfiguriert: deps.jevKonfiguriert ?? jevConfigured(),
    jevFrage: deps.jevFrage ?? jevFragen,
  };

  const jetzt = Date.now();
  const seiten = (await offeneSeiten(userId)).filter((seite) => {
    if (nochGesperrt(p.gescheitert.get(seite.pageId), jetzt)) return false;
    p.gescheitert.delete(seite.pageId);
    return true;
  });
  const blaetter = new Set<string>();

  // Nacheinander und nie nebeneinander: Docling rechnet auf dem Prozessor des
  // NAS, und zwei Seiten zugleich machten jede langsamer, nicht beide
  // schneller.
  for (const seite of seiten) {
    blaetter.add(seite.materialId);

    const spur: Spur = { doclingText: null, wahl: null, geschrieben: false };

    try {
      await seiteZuteilen(userId, seite, d, spur);
    } catch (error) {
      // So gut es geht festhalten, mit dem, was bis zum Fehler schon da war:
      // steht Doclings Abschrift schon an der Seite, ist sie eine
      // Docling-Seite; sonst liest Claude, und Doclings Rohtext geht nicht
      // verloren, wenn es ihn gab. Ist die Seite danach beim Postboten oder
      // entschieden, ist nichts verloren.
      const rueckfall =
        spur.geschrieben && spur.wahl
          ? {
              leser: "docling" as const,
              grund: spur.wahl.grund,
              doclingText: spur.wahl.doclingText,
            }
          : {
              leser: "claude" as const,
              grund: grundOhneMessung("fehler"),
              doclingText: spur.doclingText,
            };
      const festgehalten = await leserFestlegen(userId, seite.pageId, rueckfall).catch(
        () => false,
      );

      // Scheitert auch das, bleibt sie offen — und ruht, statt bei jedem
      // `read_inbox` von vorn zu beginnen (`ZWEITER_VERSUCH_MS`).
      if (!festgehalten) p.gescheitert.set(seite.pageId, Date.now());

      console.error(
        `Leser ${kurz(seite.pageId)}: Zuteilung gescheitert, ${
          festgehalten
            ? rueckfall.leser === "docling"
              ? "Doclings Abschrift steht"
              : "Claude liest"
            : `bleibt offen, neuer Versuch frühestens in ${Math.round(ZWEITER_VERSUCH_MS / 60_000)} min`
        } — ${meldung(error)}`,
      );
    }
  }

  const vorgemerkt = p.pruefen.get(userId);
  if (vorgemerkt) {
    p.pruefen.delete(userId);
    for (const materialId of vorgemerkt) blaetter.add(materialId);
  }

  for (const materialId of blaetter) {
    try {
      await korbblattPruefen(userId, materialId);
    } catch (error) {
      console.error(
        `Leser ${kurz(materialId)}: Prüfung auf einen Vorschlag der App gescheitert — ${meldung(error)}`,
      );
    }
  }
}

/**
 * Was eine Seite bis zu einem Fehler schon hinter sich hat — damit der
 * Rückfall in `lauf()` nichts wegwirft, was Docling schon gerechnet hat.
 */
type Spur = {
  doclingText: string | null;
  wahl: LeserWahl | null;
  /** Doclings Abschrift steht an der Seite. */
  geschrieben: boolean;
};

/** Eine Seite: Docling fragen (oder nicht), entscheiden, schreiben, festhalten. */
async function seiteZuteilen(
  userId: string,
  seite: OffeneSeite,
  d: ZuteilungDeps,
  spur: Spur,
): Promise<void> {
  // Schon gelesen, bevor die App entschied: Docling und Jev blieben ein
  // Aufwand für nichts (siehe Kopf). Steht dort Doclings eigene Abschrift,
  // fehlte nach einem Abbruch nur die Entscheidung.
  if (seite.gelesen) {
    const leser = seite.maschinell ? "docling" : "claude";
    const grund = grundOhneMessung(seite.maschinell ? "nachgeholt" : "schon-gelesen");
    // Für den Rückfall in `lauf()`, falls das Festhalten wirft: eine Seite
    // mit Doclings Abschrift bleibt auch dort eine Docling-Seite.
    spur.wahl = { leser, grund, abschrift: null, doclingText: null };
    spur.geschrieben = seite.maschinell;
    await leserFestlegen(userId, seite.pageId, { leser, grund, doclingText: null });
    console.info(`Leser ${kurz(seite.pageId)}: ${leser} (${grund.grund}, Docling nicht gefragt)`);
    return;
  }

  let ausgang: DoclingAusgang;

  if (leserRegelAus()) {
    ausgang = { art: "nicht-gefragt", grund: "aus" };
  } else if (!d.doclingKonfiguriert) {
    ausgang = { art: "nicht-gefragt", grund: "docling-fehlt" };
  } else if (doclingPausiertBis() !== null) {
    ausgang = { art: "nicht-gefragt", grund: "docling-pause" };
  } else {
    // Das Vollbild und nicht die Lesefassung: Docling bekommt die Bytes
    // direkt und nicht durch ein Tool-Ergebnis, und für kleine Schrift zählt
    // jedes Pixel.
    const bild = await readPageImage(userId, seite.pageId, "voll");
    // Die Seite ist zwischen Liste und Lesen gelöscht worden — nichts zu tun.
    if (!bild) return;

    try {
      ausgang = { art: "ok", ergebnis: await d.docling(bild.bytes, bild.mimeType) };
    } catch (error) {
      // Öffnet bei einem Ausfall den Schalter: die nächsten Seiten warten
      // dann nicht noch einmal die volle Frist, sondern gehen gleich an
      // Claude (`docling-pause`).
      doclingFehlschlag(error);
      console.error(`Leser ${kurz(seite.pageId)}: Docling gescheitert — ${meldung(error)}`);
      ausgang = { art: "fehler", ausfall: trifftDocling(error) };
    }
  }

  if (ausgang.art === "ok") spur.doclingText = ausgang.ergebnis.markdown;

  let wahl = await leserWaehlen(ausgang, {
    konfiguriert: d.jevKonfiguriert,
    frage: d.jevFrage,
  });
  spur.wahl = wahl;

  // Erst die Abschrift, dann die Entscheidung. Andersherum hinterließe ein
  // Absturz dazwischen eine Seite mit `'docling'` und ohne Abschrift — die
  // Claude nie bekommt und niemand je liest. So bleibt sie im schlimmsten
  // Fall offen, mit Doclings Abschrift, und der nächste Lauf holt nur die
  // Entscheidung nach (`nachgeholt` oben), ohne Docling ein zweites Mal.
  if (wahl.leser === "docling" && wahl.abschrift !== null) {
    const geschrieben = await setMaterialTranscripts(
      userId,
      seite.materialId,
      [{ pageId: seite.pageId, text: wahl.abschrift }],
      { nurUngelesene: true, maschinell: true },
    );
    spur.geschrieben = geschrieben > 0;

    // Null geschrieben heißt: während Docling rechnete, hat jemand die Seite
    // abgetippt (oder ein Vorschlag wurde übernommen). Dann steht dort nicht
    // Doclings Text, und `'docling'` behauptete es. Die Messung bleibt im
    // Grund stehen, der Rohtext ebenso.
    if (!spur.geschrieben) {
      wahl = {
        ...wahl,
        leser: "claude",
        grund: { ...wahl.grund, grund: "schon-gelesen" },
        abschrift: null,
      };
    }
  }

  await leserFestlegen(userId, seite.pageId, {
    leser: wahl.leser,
    grund: wahl.grund,
    doclingText: wahl.doclingText,
  });

  const g = wahl.grund;
  console.info(
    `Leser ${kurz(seite.pageId)}: ${wahl.leser} (${g.grund}, ${g.woerter ?? "–"} Wörter, Formel ${g.formel ?? "–"}, Jev ${g.jev === null ? "–" : g.jev.toFixed(2)}, Docling ${g.sekunden === null ? "–" : g.sekunden.toFixed(1)} s)`,
  );
}

/**
 * Ist ein Blatt im Korb so weit, dass die App selbst einen Vorschlag anlegt
 * (Entscheidung 8)? Wenn ja: genau einen, und Jev ordnet ein.
 *
 * Geprüft wird nur nach einem Seitenentscheid und vom Wecker der Ruhe — nie
 * im Takt. Scheitert Jev, bleibt der Vorschlag im Korb für einen Menschen,
 * und weil ein liegender Vorschlag jede weitere Prüfung mit „nein“
 * beantwortet, wird Jev dafür nicht noch einmal gefragt. Dasselbe EINMAL
 * sichert `createProposal(…, { nurOhneVorschlag })` noch einmal in der
 * Datenbank.
 */
async function korbblattPruefen(userId: string, materialId: string): Promise<void> {
  const stand = await korbblattStand(userId, materialId);
  if (!stand) return;

  const faellig = appVorschlagFaellig(stand, RUHE_MS);
  if (faellig.art === "nein") return;

  if (faellig.art === "warten") {
    weckerStellen(userId, materialId, faellig.ms);
    return;
  }

  // Der Titel: die erste Überschrift der ersten Seite, wörtlich, solange am
  // Blatt der Platzhalter steht — sonst der Titel, der dasteht. Nie leer:
  // ein Vorschlag, der nichts vorschlägt, ist keiner, und der vorhandene
  // Titel ändert beim Übernehmen nichts.
  const titel =
    titelAusErsterSeite(
      stand.title,
      defaultMaterialTitle(stand.capturedOn),
      stand.ersteSeite,
      MATERIAL_TITLE_MAX,
    ) ?? stand.title;

  const eingabe = proposalInputSchema.safeParse({ title: titel });
  if (!eingabe.success) {
    console.error(
      `Leser ${kurz(materialId)}: kein Vorschlag der App — ${eingabe.error.issues[0]?.message ?? "Titel ungültig"}`,
    );
    return;
  }

  const id = await createProposal(userId, materialId, eingabe.data, "app", {
    nurOhneVorschlag: true,
  });
  if (!id) return;

  const eingeordnet = await autoFile(userId, id).catch(
    (error: unknown): AutoFileResult => {
      console.error(`Leser ${kurz(materialId)}: Einordnen durch Jev fehlgeschlagen — ${meldung(error)}`);
      return { ok: false, grund: "Jev war nicht erreichbar." };
    },
  );

  console.info(
    `Leser ${kurz(materialId)}: Vorschlag der App angelegt, Jev: ${
      eingeordnet.ok ? eingeordnet.subjectName : eingeordnet.grund
    }`,
  );
}

/**
 * Prüft ein Blatt noch einmal, sobald seine Ruhe um ist. Ein neuer Wecker
 * ersetzt den alten desselben Blattes — eine weitere Seite verschiebt die
 * Ruhe, statt einen zweiten Vorschlag zu wecken. `unref()`, damit ein
 * Wecker den Prozess nicht am Beenden hindert; nach einem Neustart ist er
 * weg, und das Blatt bleibt für einen Menschen im Korb (bewusst, siehe Kopf:
 * kein Takt).
 */
function weckerStellen(userId: string, materialId: string, ms: number): void {
  const p = prozess();
  const alt = p.timer.get(materialId);
  if (alt) clearTimeout(alt);

  const wecker = setTimeout(() => {
    p.timer.delete(materialId);
    korbblattAnstossen(userId, materialId);
  }, ms);
  wecker.unref?.();
  p.timer.set(materialId, wecker);
}

/** Die ersten acht Zeichen einer id — genug, um sie im Protokoll wiederzufinden. */
function kurz(id: string): string {
  return id.slice(0, 8);
}

function meldung(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
