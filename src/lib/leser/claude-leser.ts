import type { LeserLaufAbbruch, LeserLaufErgebnis } from "@/db/schema";
import { ABSCHREIBER_SYSTEM } from "@/lib/abschrift-regeln";
import { blattVorschlagen } from "@/lib/blatt-vorschlag";
import {
  CLAUDE_EFFORT,
  CLAUDE_MODELL,
  anthropicSenden,
  bildBlock,
  claudeBildfassung,
  claudeConfigured,
  claudeRufen,
  type ClaudeInhalt,
  type ClaudeSender,
} from "@/lib/claude/client";
import { messungZeile, type Messung } from "@/lib/claude/ergebnis";
import { RUHE_MS } from "@/lib/leser/regel";
import { getMaterial, listPageActivity, readPageImage } from "@/lib/materials";

import {
  PAUSE_ANFANG_MS,
  PAUSEN_JE_BLATT,
  SPAETER_HOECHSTENS,
  SPAETER_RUHE_MS,
  auswaehlen,
  erledigt,
  gedaechtnisAus,
  nachleseSatz,
  nachleseZaehlen,
  naechstePause,
  pausenFolge,
  planen,
  seitenZahl,
  tuerErgebnis,
  type AbschreibModus,
  type BlattStand,
} from "./claude-ablauf";
import {
  EINORDNEN_ANTWORT,
  NACHLESE_ANTWORT,
  abschreibInhalt,
  einordnenAuftrag,
  einordnenEingabe,
  fristFuer,
  maxTokensFuer,
  nachleseAuftrag,
  nachleseEingabe,
  type AuftragsSeite,
  type EingabeErgebnis,
} from "./claude-auftrag";
import { claudeEingeplant, claudeProzess, type ClaudeProzess } from "./claude-zustand";
import {
  claudeKandidaten,
  gedaechtnisZeilen,
  laufAbschliessen,
  laufBeginnen,
  letzterLauf,
  vorschlagStand,
} from "./laeufe";

/**
 * Der Abschreiber: die App ruft Opus selbst, für jede Seite, die Docling nicht
 * sicher liest (seit dem 11.10.2026).
 *
 * Bis zu diesem Tag tat das ein eigener Dienst neben der App, der Postbote —
 * ein `claude` im Käfig, alle fünfzehn Sekunden über den Web MCP. Jetzt ist es
 * ein Aufruf ohne Werkzeuge aus der App heraus (@/lib/claude/client), und
 * alles, was der Postbote um diesen Aufruf herum tat, steht hier und in
 * @/lib/leser/claude-ablauf: welches Blatt dran ist, was er sich merkt, wann
 * er Pause macht.
 *
 * ── Was der Leser schreiben darf: nichts außer Vorschlägen ──────────────────
 *
 * Opus liest Blätter, auf denen Sätze stehen können, die wie Anweisungen
 * aussehen — genau der Leser, vor dem die Regel „Agenten schreiben nie in den
 * Bestand“ schützt (src/db/schema.ts an `materialProposals`). Seine Antwort
 * geht deshalb durch DIESELBE Tür wie propose_sheet im Chat:
 * `blattVorschlagen()` in @/lib/blatt-vorschlag, also Seitenprüfung,
 * `abschriftenSieben()`, `proposalInputSchema`, `createProposal(…, "agent")`
 * und `autoFile()`. Übernommen wird danach nach den Regeln von
 * @/lib/auto-file oder von einem Menschen. Diese Datei selbst schreibt genau
 * eine andere Zeile: den Vermerk des Laufs in `leser_laeufe`. Dass es dabei
 * bleibt, prüft claude-leser.test.ts an ihrem Quelltext.
 *
 * ── Kein Takt ───────────────────────────────────────────────────────────────
 *
 * Der Postbote fragte den Korb alle fünfzehn Sekunden. Hier gibt es keinen
 * Takt, aus demselben Grund wie bei der Zuteilung (@/lib/leser/zuteilung):
 * die Datenbank weiß, was zu tun ist (`leser`, `transcript`, `leser_laeufe`),
 * und jemand muss nur fragen, wenn sich etwas geändert haben kann. Gefragt
 * wird
 *
 * - am Ende jedes Laufs der Zuteilung (`zuteilungLaufen()`), auch wenn dort
 *   keine Seite offen war — sonst blieben Seiten liegen, die mit gezogener
 *   Notbremse (`LESER_REGEL=aus`) gleich auf `claude` entstehen, ohne dass je
 *   eine Seite offen war. Die Zuteilung wiederum stoßen das Hochladen, das
 *   Löschen einer Seite und `read_inbox` eines Chats an;
 * - beim Start der App (src/instrumentation.ts, über die Zuteilung) — das
 *   Netz nach einem Neustart, das bis hierher das `read_inbox` des Postboten
 *   war;
 * - vom Wecker, wenn ein Blatt noch auf seine Ruhe wartet oder die Pause um ist;
 * - vom Knopf „Abschreiben lassen“ am Blatt (`claudeVonHandAnstossen()`).
 *
 * ── Eine eigene Queue ───────────────────────────────────────────────────────
 *
 * Getrennt von der der Zuteilung (@/lib/leser/claude-zustand): ein Aufruf
 * dauert Minuten, und Docling-Seiten sollen nicht dahinter warten. In der
 * eigenen läuft nur einer zur Zeit — zwei Läufe nebeneinander könnten dasselbe
 * Blatt zweimal bezahlen. Ein Anstoß, während ein Lauf wartet, hängt sich an
 * ihn an; der Lauf liest die Datenbank erst beim Start und nimmt jedes neue
 * Blatt mit.
 *
 * ── Nie doppelt bezahlen ────────────────────────────────────────────────────
 *
 * Jeder Lauf steht in `leser_laeufe`, unter dem Stand der jüngsten Seite
 * (`lastPageAt`, gelesen VOR den Seiten) — und zwar schon, bevor er ruft
 * (`laeuft`), damit auch ein Neustart mitten im Aufruf eine Spur hinterlässt.
 * Ein Ergebnis — Vorschlag, kein Vorschlag, nichts — erledigt das Blatt für
 * diesen Stand, gleich in welcher Art es kam; erst eine neue Seite macht es
 * wieder zum Fall. Verwerfen, „wieder in den Korb“, Abhaken oder ein Neustart
 * lösen also kein neues, bezahltes Lesen aus (die eine Ausnahme für die
 * Nachlese steht an `gedaechtnisAus()`) — auch nicht bei einem Vorschlag, der
 * nicht von hier kam: den verworfenen merkt sich die App beim Verwerfen
 * (`verworfenVermerken()` in @/lib/leser/laeufe). `pause` und `spaeter` erledigen
 * nichts; wie viele bezahlte Abbrüche ein Blatt haben darf, steht an
 * `SPAETER_HOECHSTENS`. Und der Knopf liest kein Blatt, an dem seit dem Druck
 * schon ein Lauf war (`claudeVonHand()`).
 */

/** Was ein Lauf von außen braucht; jede Angabe hat eine Vorgabe für den Betrieb. */
export type ClaudeLeserDeps = {
  /** Wer die Anfrage verschickt — in der Probe ein nachgemachter. */
  senden: ClaudeSender;
  /** Ist ein Schlüssel da? Mit einem nachgemachten Sender: ja. */
  konfiguriert: boolean;
};

/**
 * Erst beim Start eines Laufs ausgewertet: der Schlüssel kann inzwischen da
 * sein. Ausgeführt für den Fragenlauf (@/lib/fragenlauf), der dieselbe Regel
 * braucht: ein nachgemachter Sender gilt als eingerichtet, der echte nur mit
 * Schlüssel.
 */
export function claudeDeps(deps: Partial<ClaudeLeserDeps> | undefined): ClaudeLeserDeps {
  const senden = deps?.senden ?? anthropicSenden;
  return {
    senden,
    konfiguriert: deps?.konfiguriert ?? (senden !== anthropicSenden || claudeConfigured()),
  };
}

function prozess(): ClaudeProzess {
  return claudeProzess(PAUSE_ANFANG_MS);
}

/**
 * Schreibt einmal je Prozess ins Protokoll, ob der Leser liest — wie Jev und
 * Docling ohne Schlüssel kein Fehler, aber etwas, das man sehen muss: ohne
 * `ANTHROPIC_API_KEY` läuft die App wie bisher, nur Handschrift liest niemand.
 */
export function claudeZustandMelden(konfiguriert: boolean = claudeConfigured()): void {
  const p = prozess();
  if (p.gemeldet) return;
  p.gemeldet = true;

  if (konfiguriert) {
    console.info(
      `Claude-Leser bereit: ${CLAUDE_MODELL}, effort ${CLAUDE_EFFORT}, Bild ${claudeBildfassung()}.`,
    );
  } else {
    console.warn(
      "Claude-Leser aus: kein ANTHROPIC_API_KEY — Handschrift liest niemand, die App läuft sonst wie bisher.",
    );
  }
}

// ── Ein Blatt ────────────────────────────────────────────────────────────────

/**
 * Was `blattAbschreiben()` ergab.
 *
 * - `gelaufen: false`: es gab nichts zu tun oder es durfte nicht — kein
 *   Aufruf, kein Vermerk.
 * - `gelaufen: true`: ein Lauf mit Ergebnis; `vermerkt` sagt, ob seine Zeile
 *   in `leser_laeufe` steht.
 */
export type AbschreibErgebnis =
  | { gelaufen: false; grund: string }
  | {
      gelaufen: true;
      ergebnis: LeserLaufErgebnis;
      grund: string;
      vermerkt: boolean;
      /** Nur bei `pause`: kann sie an diesem Blatt liegen (`pauseAmBlatt` in @/lib/claude/ergebnis)? */
      pauseAmBlatt: boolean;
    };

/** Was ein Aufruf samt Tür ergeben hat, bevor es vermerkt wird. */
type Ausgang = {
  ergebnis: Exclude<LeserLaufErgebnis, "laeuft">;
  grund: string;
  messung: Messung | null;
  /** Bezahlt und ohne gemerktes Ergebnis — woran es abbrach. */
  abbruch: LeserLaufAbbruch | null;
  /** Die Seiten, deren Abschrift durch die Tür in einen Vorschlag kam. */
  abgeschrieben: readonly string[];
  /** Nur bei `pause` gesetzt — kann sie am Blatt liegen? Sonst fehlt es (falsch). */
  pauseAmBlatt?: boolean;
  wandMs: number;
};

/**
 * Schreibt ein Blatt ab — als `einordnen`, `nachlese` oder `von-hand`
 * (@/lib/leser/claude-ablauf, `AbschreibModus`).
 *
 * Die Reihenfolge ist die Logik:
 *
 * 1. **Der Stand VOR den Seiten.** `lastPageAt` ist der Schlüssel des
 *    Gedächtnisses. Früher gelesen ist er höchstens älter, und das Blatt
 *    kommt einmal zu viel dran; später gelesen könnte eine Seite hinter dem
 *    Schlüssel verschwinden, ohne je gelesen zu werden. Dieselbe Reihenfolge
 *    wie read_sheet in @/lib/mcp/run.
 * 2. **Das Gedächtnis**, außer von Hand: in diesem Stand schon erledigt, dann
 *    kein Aufruf. Auch von Hand: läuft an dem Blatt gerade ein Aufruf (eine
 *    frische `laeuft`-Zeile), kein zweiter.
 * 3. **Der Plan** (`planen()`): welche Seiten, welcher Auftrag — oder warum
 *    keiner. Die Nachlese ohne die Seiten, die ein Einordnen in diesem Stand
 *    schon abgeschrieben hat.
 * 4. **Die Fotos**, in der Fassung von `CLAUDE_BILD`. Eine Seite ohne Foto —
 *    eben gelöscht, ein Format, das die API nicht nimmt — ist nur für DIESE
 *    Seite unlesbar; der Auftrag nennt sie, und die übrigen gehen trotzdem.
 * 5. **Die Zeile in `leser_laeufe`**, als `laeuft` — VOR dem Aufruf.
 * 6. **Der Aufruf**, ohne Werkzeuge, mit eigener Frist und eigener Grenze der
 *    Tokens, beide aus der Seitenzahl.
 * 7. **Die Tür**, Feld für Feld vorgeprüft (@/lib/leser/claude-auftrag), gegen
 *    die Seiten, die das Blatt nach dem Aufruf noch hat.
 * 8. **Nachzählen** an den Seiten, bei der Nachlese — nicht dem Modell
 *    glauben.
 * 9. **Das Ergebnis in dieselbe Zeile** und eine Zeile mit der Messung ins
 *    Protokoll.
 *
 * Wirft nur, wenn die Datenbank selbst nicht antwortet.
 */
export async function blattAbschreiben(
  userId: string,
  materialId: string,
  modus: AbschreibModus,
  deps?: Partial<ClaudeLeserDeps>,
): Promise<AbschreibErgebnis> {
  const d = claudeDeps(deps);

  const aktivitaet = (await listPageActivity(userId, [materialId])).get(materialId);
  if (!aktivitaet) return { gelaufen: false, grund: "Das Blatt gibt es nicht (mehr)." };

  const blatt = await getMaterial(userId, materialId);
  if (!blatt) return { gelaufen: false, grund: "Das Blatt gibt es nicht (mehr)." };
  const vorschlag = await vorschlagStand(userId, materialId);

  const stand: BlattStand = {
    eingeordnet: blatt.filedAt !== null,
    capturedOn: blatt.capturedOn,
    seiten: blatt.pages.map((seite) => ({
      id: seite.id,
      leser: seite.leser,
      gelesen: seite.transcriptLength !== null,
    })),
    lastPageAt: aktivitaet.lastPageAt,
    nachgereicht: aktivitaet.unreadAttachedPageIds,
    vorschlaege: vorschlag.anzahl,
    juengsterVorschlagAt: vorschlag.juengster,
  };

  const erinnerung = gedaechtnisAus(await gedaechtnisZeilen(userId, [materialId]))(
    modus === "einordnen" || (modus === "von-hand" && !stand.eingeordnet) ? "einordnen" : "nachlese",
    materialId,
    stand.lastPageAt,
    stand.nachgereicht,
  );
  if (erinnerung.laeuftNochMs !== null) {
    return {
      gelaufen: false,
      grund: `An diesem Blatt läuft gerade ein Aufruf — noch höchstens ${Math.ceil(erinnerung.laeuftNochMs / 60_000)} min.`,
    };
  }
  if (modus !== "von-hand" && erledigt(erinnerung)) {
    return {
      gelaufen: false,
      grund: erinnerung.gemerkt
        ? "In diesem Stand schon gelesen."
        : `${SPAETER_HOECHSTENS}-mal bezahlt abgebrochen — bis morgen nur von Hand.`,
    };
  }

  const plan = planen(modus, stand, modus === "nachlese" ? erinnerung.schonAbgeschrieben : undefined);
  if (plan.art === "kein-lauf") return { gelaufen: false, grund: plan.grund };

  const fassung = claudeBildfassung();
  const fotos: { seite: AuftragsSeite; bild: ClaudeInhalt }[] = [];
  const ohneFoto: AuftragsSeite[] = [];
  for (const seite of plan.vorab.seiten) {
    const bild = await readPageImage(userId, seite.id, fassung);
    const block = bild ? bildBlock(bild.bytes, bild.mimeType) : null;
    if (block) fotos.push({ seite, bild: block });
    else ohneFoto.push(seite);
  }
  if (fotos.length === 0) {
    return { gelaufen: false, grund: "Von keiner der Seiten ließ sich ein Foto laden." };
  }

  const p = prozess();
  const laufId = await laufBeginnen({
    userId,
    materialId,
    art: plan.laufArt,
    schluessel: stand.lastPageAt,
    fristMs: fristFuer(fotos.length),
  });

  // Gezählt, sobald die Zeile steht — daran misst der Knopf, ob seit seinem
  // Druck ein Lauf an diesem Blatt war (`claudeVonHand()`).
  p.gestartet.set(materialId, (p.gestartet.get(materialId) ?? 0) + 1);
  p.liest.set(materialId, userId);
  let ausgang: Ausgang;
  try {
    ausgang =
      plan.art === "einordnen"
        ? await einordnenRufen(userId, materialId, plan.vorab, fotos, ohneFoto, d)
        : await nachleseRufen(userId, materialId, plan.vorab, fotos, ohneFoto, stand, d);
  } finally {
    p.liest.delete(materialId);
  }

  const vermerkt = await laufAbschliessen(laufId, {
    ergebnis: ausgang.ergebnis,
    grund: ausgang.grund,
    messung: ausgang.messung,
    abbruch: ausgang.abbruch,
    abgeschrieben: ausgang.abgeschrieben,
  }).catch((error: unknown) => {
    console.error(`Claude ${kurz(materialId)}: Ergebnis nicht vermerkt — ${ersteZeile(meldung(error))}`);
    return false;
  });

  const zeile = `Claude ${kurz(materialId)} (${plan.laufArt}, ${seitenZahl(fotos.length)}): ${ausgang.ergebnis}${ausgang.grund ? ` — ${ausgang.grund}` : ""}`;
  if (ausgang.ergebnis === "pause" || ausgang.ergebnis === "nichts") console.warn(zeile);
  else console.info(zeile);
  console.info(
    `   ${ausgang.messung ? messungZeile(ausgang.messung) : `Wand ${Math.round(ausgang.wandMs / 1000)} s, keine Antwort${ausgang.abbruch ? ", bezahlt abgebrochen" : ""}`}`,
  );
  if (!vermerkt) {
    console.warn(
      `   nicht vermerkt — für diesen Stand stand schon ein Ergebnis da, das Blatt ist weg, oder die Tabelle antwortete nicht. Die Zeile „läuft“ zählt dann nach ihrer Frist als bezahlter Abbruch.`,
    );
  }

  return {
    gelaufen: true,
    ergebnis: ausgang.ergebnis,
    grund: ausgang.grund,
    vermerkt,
    pauseAmBlatt: ausgang.ergebnis === "pause" && ausgang.pauseAmBlatt === true,
  };
}

/** Grund des Modells und die Hinweise der Prüfung, angehängt an einen Satz. */
function mitHinweisen(satz: string, modellGrund: string, hinweise: readonly string[]): string {
  const modell = modellGrund.trim();
  return [satz, ...(modell ? [`Claude: ${modell}`] : []), ...hinweise].filter(Boolean).join("; ");
}

/**
 * Die Antwort durch die Tür. Scheitert die Datenbank dabei, ist das
 * `spaeter` mit dem Abbruch `ablage`: bezahlt ist die Antwort schon, aber ein
 * Blatt, das in diesem Stand als erledigt gälte, ohne dass seine Abschrift
 * irgendwo steht, wäre schlimmer als ein zweiter Lauf — und gezählt wird es,
 * damit ein Fehler, der jedes Mal wiederkommt, nicht jede Stunde bezahlt wird.
 * Von der Meldung der Datenbank nur die erste Zeile: die übrigen tragen die
 * Parameter der Anweisung, also den Text des Modells.
 */
async function durchDieTuer(
  userId: string,
  eingabe: Extract<EingabeErgebnis, { art: "vorschlag" }>["eingabe"],
): Promise<
  | { art: "ok"; tuer: Awaited<ReturnType<typeof blattVorschlagen>> }
  | { art: "fehler"; grund: string }
> {
  try {
    return { art: "ok", tuer: await blattVorschlagen(userId, eingabe) };
  } catch (error) {
    return { art: "fehler", grund: `Der Vorschlag ließ sich nicht speichern: ${ersteZeile(meldung(error))}` };
  }
}

/** Ein Aufruf ohne Antwort, oder eine Antwort ohne Tür, als Ausgang. */
function ohneTuer(
  gerufen: {
    art: "nichts" | "pause" | "spaeter";
    grund: string;
    messung: Messung | null;
    abbruch: LeserLaufAbbruch | null;
    pauseAmBlatt: boolean;
    wandMs: number;
  },
): Ausgang {
  return { ...gerufen, ergebnis: gerufen.art, abgeschrieben: [] };
}

/**
 * Die Seiten, die das Blatt JETZT hat — gleich nach der Antwort gelesen, also
 * unmittelbar vor der Tür. `null`: das Blatt gibt es nicht mehr. Siehe
 * `abschriftenSieben()` in @/lib/leser/claude-auftrag, warum.
 */
async function seitenJetzt(userId: string, materialId: string): Promise<ReadonlySet<string> | null> {
  const jetzt = await getMaterial(userId, materialId);
  return jetzt ? new Set(jetzt.pages.map((seite) => seite.id)) : null;
}

/** Welche Seiten die Tür wirklich in einen Vorschlag gelegt hat. */
function abgeschriebenAus(tuer: Awaited<ReturnType<typeof blattVorschlagen>>): string[] {
  return tuer.art === "angelegt"
    ? (tuer.vorschlag.transcripts ?? []).map((eintrag) => eintrag.pageId)
    : [];
}

async function einordnenRufen(
  userId: string,
  materialId: string,
  vorab: Parameters<typeof einordnenAuftrag>[0],
  fotos: readonly { seite: AuftragsSeite; bild: ClaudeInhalt }[],
  ohneFoto: readonly AuftragsSeite[],
  d: ClaudeLeserDeps,
): Promise<Ausgang> {
  const gerufen = await claudeRufen(
    {
      system: ABSCHREIBER_SYSTEM,
      inhalt: abschreibInhalt(einordnenAuftrag(vorab, ohneFoto), fotos),
      schema: EINORDNEN_ANTWORT,
      fristMs: fristFuer(fotos.length),
      maxTokens: maxTokensFuer(fotos.length),
    },
    d.senden,
  );

  if (gerufen.art !== "antwort") return ohneTuer(gerufen);

  const { messung, wandMs, antwort } = gerufen;
  const vorhanden = await seitenJetzt(userId, materialId);
  if (!vorhanden) {
    return { ergebnis: "nichts", grund: "Das Blatt gibt es nicht mehr.", messung, abbruch: null, abgeschrieben: [], wandMs };
  }

  const eingabe = einordnenEingabe(materialId, antwort, vorab, vorhanden);
  if (eingabe.art !== "vorschlag") {
    return { ergebnis: eingabe.art, grund: eingabe.grund, messung, abbruch: null, abgeschrieben: [], wandMs };
  }

  const durch = await durchDieTuer(userId, eingabe.eingabe);
  if (durch.art === "fehler") {
    return { ergebnis: "spaeter", grund: durch.grund, messung, abbruch: "ablage", abgeschrieben: [], wandMs };
  }

  const { ergebnis, grund } = tuerErgebnis(durch.tuer);
  const abschriften =
    durch.tuer.art === "angelegt"
      ? `Abschrift ${durch.tuer.vorschlag.transcripts?.length ?? 0} von ${seitenZahl(vorab.seiten.length)}`
      : "";

  return {
    ergebnis,
    grund: mitHinweisen([grund, abschriften].filter(Boolean).join("; "), antwort.grund, eingabe.hinweise),
    messung,
    abbruch: null,
    abgeschrieben: abgeschriebenAus(durch.tuer),
    wandMs,
  };
}

async function nachleseRufen(
  userId: string,
  materialId: string,
  vorab: Parameters<typeof nachleseAuftrag>[0],
  fotos: readonly { seite: AuftragsSeite; bild: ClaudeInhalt }[],
  ohneFoto: readonly AuftragsSeite[],
  stand: BlattStand,
  d: ClaudeLeserDeps,
): Promise<Ausgang> {
  const gerufen = await claudeRufen(
    {
      system: ABSCHREIBER_SYSTEM,
      inhalt: abschreibInhalt(nachleseAuftrag(vorab, ohneFoto), fotos),
      schema: NACHLESE_ANTWORT,
      fristMs: fristFuer(fotos.length),
      maxTokens: maxTokensFuer(fotos.length),
    },
    d.senden,
  );

  if (gerufen.art !== "antwort") return ohneTuer(gerufen);

  const { messung, wandMs, antwort } = gerufen;
  const vorhanden = await seitenJetzt(userId, materialId);
  if (!vorhanden) {
    return { ergebnis: "nichts", grund: "Das Blatt gibt es nicht mehr.", messung, abbruch: null, abgeschrieben: [], wandMs };
  }

  const eingabe = nachleseEingabe(materialId, antwort, vorab, vorhanden);
  if (eingabe.art !== "vorschlag") {
    return { ergebnis: eingabe.art, grund: eingabe.grund, messung, abbruch: null, abgeschrieben: [], wandMs };
  }

  const durch = await durchDieTuer(userId, eingabe.eingabe);
  if (durch.art === "fehler") {
    return { ergebnis: "spaeter", grund: durch.grund, messung, abbruch: "ablage", abgeschrieben: [], wandMs };
  }

  const { ergebnis, grund } = tuerErgebnis(durch.tuer);
  const abgeschrieben = abgeschriebenAus(durch.tuer);
  if (ergebnis !== "vorschlag") {
    return {
      ergebnis,
      grund: mitHinweisen(grund, antwort.grund, eingabe.hinweise),
      messung,
      abbruch: null,
      abgeschrieben,
      wandMs,
    };
  }

  // Gezählt wird an den Seiten selbst, vorher und nachher — nicht, was das
  // Modell über sich sagt. Geht das Nachsehen schief, bleibt es beim Satz der
  // Tür: eine Kontrolle darf den Lauf nicht umwerfen, dessen Arbeit getan ist.
  const ziel = vorab.seiten.map((seite) => seite.id);
  const vorherUngelesen = stand.seiten.filter((seite) => !seite.gelesen).map((seite) => seite.id);
  const nachher = await getMaterial(userId, materialId).catch(() => null);
  const gezaehlt = nachher
    ? nachleseSatz(
        nachleseZaehlen(
          ziel,
          vorherUngelesen,
          new Map(nachher.pages.map((seite) => [seite.id, seite.transcriptLength !== null])),
        ),
        ziel.length,
      )
    : "";

  return {
    ergebnis,
    grund: mitHinweisen([gezaehlt, grund].filter(Boolean).join("; "), antwort.grund, eingabe.hinweise),
    messung,
    abbruch: null,
    abgeschrieben,
    wandMs,
  };
}

// ── Der Ablauf ───────────────────────────────────────────────────────────────

/**
 * Stößt den Leser für diesen Nutzer an und kehrt sofort zurück. Wirft nie —
 * ein Fehler landet im Protokoll. Die Funktion, die die Zuteilung und die
 * Wecker benutzen.
 */
export function claudeAnstossen(userId: string): void {
  try {
    void claudeLaufen(userId).catch((error: unknown) => {
      console.error(`Claude: Lauf abgebrochen — ${meldung(error)}`);
    });
  } catch (error) {
    console.error(`Claude: Lauf nicht angestoßen — ${meldung(error)}`);
  }
}

/**
 * Ein Lauf über alle Blätter dieses Nutzers, an denen etwas zu lesen ist —
 * oder das Warten auf den Lauf, der schon ansteht. `deps` ersetzt den Sender
 * für die Probe (scripts/probe-claude-leser.mts); hängt sich der Aufruf an
 * einen wartenden Lauf an, gelten dessen Angaben.
 */
export function claudeLaufen(
  userId: string,
  deps?: Partial<ClaudeLeserDeps>,
): Promise<void> {
  return prozess().queue.request(
    `lauf:${userId}`,
    { frist: null, geduld: null },
    () => lauf(userId, claudeDeps(deps)),
    () => undefined,
  );
}

/**
 * Der Lauf: immer das nächste Blatt, bis keines mehr dran ist oder eine Pause
 * kommt.
 *
 * Nach jedem Blatt wird neu ausgewählt und nicht eine Liste vom Anfang
 * abgearbeitet. Ein Aufruf dauert Minuten, und in der Zeit kann ein frisches
 * Korbblatt ruhig geworden sein — es geht der Nachlese vor, wie beim
 * Postboten (`frischeBlaetter()` in harness/postbote.mts), nur ohne dessen
 * Runden. Was dieser Lauf schon versucht hat, nimmt er nicht noch einmal;
 * sonst drehte sich ein Blatt, dessen Plan „kein Lauf“ sagt, im Kreis.
 *
 * Ein Blatt, für das ein Knopfdruck wartet (`angefordert`), lässt er liegen:
 * es gehört dem Lauf von Hand, der hinter ihm in derselben Queue steht. Was
 * er als Nächstes liest, steht in `eingeplant` — solange zeigt die Blattseite
 * keinen Knopf (Abnahme vom 11.10.2026: bis dahin nahm der Lauf ein Blatt,
 * dessen Knopf eben gedrückt war, selbst, und der Lauf von Hand las es danach
 * ein zweites Mal, bezahlt).
 */
async function lauf(userId: string, d: ClaudeLeserDeps): Promise<void> {
  const p = prozess();
  claudeZustandMelden(d.konfiguriert);
  if (!d.konfiguriert) return;

  if (Date.now() < p.pauseBis) {
    // Der Wecker der Pause stößt diesen Nutzer an, wenn sie um ist.
    p.wartenAufPause.add(userId);
    return;
  }

  const versucht = new Set<string>();
  try {
    for (;;) {
      const jetzt = Date.now();
      for (const [id, bis] of p.spaeterBis) if (bis <= jetzt) p.spaeterBis.delete(id);

      const kandidaten = await claudeKandidaten(userId);
      const gedaechtnis = gedaechtnisAus(
        await gedaechtnisZeilen(
          userId,
          kandidaten.map((kandidat) => kandidat.materialId),
        ),
      );
      const auswahl = auswaehlen(kandidaten, gedaechtnis, {
        ruheMs: RUHE_MS,
        ausgenommen: new Set([...versucht, ...p.spaeterBis.keys(), ...p.angefordert.keys()]),
      });

      for (const { materialId, ms } of auswahl.wecker) {
        weckerStellen(materialId, ms, () => claudeAnstossen(userId));
      }

      eingeplantSetzen(userId, [...auswahl.einordnen, ...auswahl.nachlese]);

      const naechstes: { id: string; modus: AbschreibModus } | null =
        auswahl.einordnen[0] !== undefined
          ? { id: auswahl.einordnen[0], modus: "einordnen" }
          : auswahl.nachlese[0] !== undefined
            ? { id: auswahl.nachlese[0], modus: "nachlese" }
            : null;
      if (!naechstes) return;
      versucht.add(naechstes.id);

      let ergebnis: AbschreibErgebnis;
      try {
        ergebnis = await blattAbschreiben(userId, naechstes.id, naechstes.modus, d);
      } catch (error) {
        console.error(`Claude ${kurz(naechstes.id)}: Lauf gescheitert — ${ersteZeile(meldung(error))}`);
        continue;
      } finally {
        p.eingeplant.delete(naechstes.id);
      }

      if (!ergebnis.gelaufen) {
        console.info(`Claude ${kurz(naechstes.id)}: kein Lauf — ${ergebnis.grund}`);
        continue;
      }

      if (ergebnis.ergebnis === "pause") {
        // Löst dasselbe Blatt die Pausen in Folge aus, ruht es danach selbst
        // — sonst käme es nach jeder Pause wieder zuerst dran
        // (`PAUSEN_JE_BLATT`). Gezählt nur, was an ihm liegen kann; die Pause
        // gilt trotzdem für alle. Die Ruhe bekommt einen eigenen Wecker: sie
        // ersetzt für dieses Blatt den der Pause, und war es doch die API,
        // stieße sonst nach der Behebung niemand mehr an (SPAETER_RUHE_MS).
        // Unter eigenem Namen und nicht unter der id des Blattes — der zählte
        // als „eingeplant“, und die Blattseite verbärge eine Stunde lang den
        // Knopf.
        const folge = pausenFolge(p.pausenFolge, naechstes.id, ergebnis.pauseAmBlatt);
        if (folge && folge.anzahl >= PAUSEN_JE_BLATT) {
          p.spaeterBis.set(naechstes.id, Date.now() + SPAETER_RUHE_MS);
          p.pausenFolge = null;
          weckerStellen(`ruhe:${naechstes.id}`, SPAETER_RUHE_MS + 500, () => claudeAnstossen(userId));
          console.warn(
            `Claude ${kurz(naechstes.id)}: ${folge.anzahl}. Pause in Folge an diesem Blatt — es ruht ${Math.round(SPAETER_RUHE_MS / 60_000)} min, die übrigen gehen vor.`,
          );
        } else {
          p.pausenFolge = folge;
        }
        pauseSetzen(userId, ergebnis.grund);
        return;
      }
      // Ein anderes Ergebnis an einem Blatt: die Folge der Pausen ist gerissen.
      p.pausenFolge = null;

      if (ergebnis.ergebnis === "spaeter") {
        p.spaeterBis.set(naechstes.id, Date.now() + SPAETER_RUHE_MS);
        continue;
      }

      // Ein Ergebnis: die API antwortet wieder, die nächste Pause beginnt vorn.
      p.naechstePauseMs = PAUSE_ANFANG_MS;
    }
  } finally {
    eingeplantSetzen(userId, []);
  }
}

/** Was der Lauf dieses Nutzers als Nächstes liest — ersetzt die vorige Auswahl. */
function eingeplantSetzen(userId: string, ids: readonly string[]): void {
  const p = prozess();
  for (const [id, wer] of p.eingeplant) if (wer === userId) p.eingeplant.delete(id);
  for (const id of ids) p.eingeplant.set(id, userId);
}

/**
 * Hält den Leser an — alle Läufe, nicht nur den eines Blattes: was eine Pause
 * auslöst (Schlüssel, Abrechnung, Kontingent, API gestört), träfe das nächste
 * Blatt genauso. Ein Wecker stößt danach jeden Nutzer an, dessen Lauf daran
 * stehen blieb.
 */
function pauseSetzen(userId: string, grund: string): void {
  const p = prozess();
  const dauer = p.naechstePauseMs;
  p.pauseBis = Date.now() + dauer;
  p.naechstePauseMs = naechstePause(dauer);
  p.wartenAufPause.add(userId);

  console.warn(`Claude: Pause für ${Math.round(dauer / 60_000)} min — ${grund}`);

  weckerStellen("pause", dauer, () => {
    p.pauseBis = 0;
    const wartende = [...p.wartenAufPause];
    p.wartenAufPause.clear();
    for (const wer of wartende) claudeAnstossen(wer);
  });
}

/**
 * Ein Wecker nur im Speicher. Ein neuer ersetzt den alten desselben Blattes —
 * eine weitere Seite verschiebt die Ruhe, statt einen zweiten Lauf zu wecken.
 * `unref()`, damit er den Prozess nicht am Beenden hindert; nach einem
 * Neustart ist er weg, und das ist gewollt: dann stößt der Start selbst an
 * (src/instrumentation.ts).
 */
function weckerStellen(schluessel: string, ms: number, aktion: () => void): void {
  const p = prozess();
  const alt = p.wecker.get(schluessel);
  if (alt) clearTimeout(alt);

  const wecker = setTimeout(() => {
    p.wecker.delete(schluessel);
    aktion();
  }, ms);
  wecker.unref?.();
  p.wecker.set(schluessel, wecker);
}

// ── Von Hand ─────────────────────────────────────────────────────────────────

/**
 * Darf der Knopf an diesem Blatt jetzt etwas anstoßen? Nein, solange der
 * Leser es gerade liest, ein Knopfdruck schon darauf wartet, oder der laufende
 * Lauf es als Nächstes nimmt (`claudeEingeplant()`). Die Blattseite zeigt den
 * Knopf dann nicht, und die Server Action fragt dasselbe noch einmal — ein
 * Druck aus einem Tab, der älter ist als der Lauf, ändert dann nichts.
 */
export function claudeKnopfMoeglich(materialId: string): boolean {
  const p = prozess();
  return !p.liest.has(materialId) && !p.angefordert.has(materialId) && !claudeEingeplant(materialId);
}

/**
 * Merkt einen Knopfdruck vor, bevor sein Lauf beginnt — damit die Seite, die
 * die Server Action gleich neu zeichnet, schon „liest gerade“ zeigt. Der Lauf
 * selbst beginnt erst nach der Antwort (`after()`), und ohne diesen Vermerk
 * sähe die Seite nach dem Druck aus wie davor. Vermerkt wird, wie viele Läufe
 * an dem Blatt beim Druck schon begonnen hatten; daran misst der Lauf von
 * Hand, ob seitdem schon gelesen wurde.
 */
export function claudeVonHandVormerken(userId: string, materialId: string): void {
  const p = prozess();
  p.angefordert.set(materialId, { userId, gestartetBeimDruck: gestartetBeimDruck(materialId) });
}

/**
 * Wie viele Läufe an diesem Blatt der Drückende kennen konnte: die begonnenen,
 * ohne den, der gerade noch liest — dessen Ergebnis stand beim Druck nirgends,
 * und es kommt wie einer nach dem Druck.
 */
function gestartetBeimDruck(materialId: string): number {
  const p = prozess();
  const begonnen = p.gestartet.get(materialId) ?? 0;
  return p.liest.has(materialId) ? begonnen - 1 : begonnen;
}

/**
 * Stößt den Lauf von Hand an und kehrt sofort zurück. Wirft nie. `gesehen`:
 * die id des letzten Laufs, den die Seite beim Druck zeigte (`null`: keinen).
 */
export function claudeVonHandAnstossen(
  userId: string,
  materialId: string,
  gesehen?: string | null,
): void {
  try {
    void claudeVonHand(userId, materialId, undefined, gesehen).catch((error: unknown) => {
      console.error(`Claude ${kurz(materialId)}: Lauf von Hand abgebrochen — ${ersteZeile(meldung(error))}`);
    });
  } catch (error) {
    console.error(`Claude ${kurz(materialId)}: Lauf von Hand nicht angestoßen — ${ersteZeile(meldung(error))}`);
  }
}

/**
 * Der Lauf von Hand, in derselben Queue wie die anderen — nie zwei Aufrufe
 * zugleich. Er fragt das Gedächtnis nicht und wartet keine Pause ab: wer den
 * Knopf drückt, will es jetzt wissen, und ein Aufruf, den die API abweist,
 * kostet nichts. Kommt dabei eine Pause heraus, gilt sie danach für alle.
 *
 * **Unmittelbar vor dem Aufruf fragt er noch einmal**, ob er etwas zu tun hat
 * (seit der Abnahme vom 11.10.2026). Er wartet hinter dem Lauf, der gerade
 * liest, und der kann in der Zeit genau dieses Blatt gelesen haben — oder ein
 * zweiter Tab drückte, während der erste las. Hat dieser Prozess seit dem
 * Druck einen Lauf an dem Blatt begonnen (oder lief beim Druck einer), oder
 * ist der jüngste Lauf am Blatt ein anderer als der, den die Seite beim Druck
 * zeigte (`gesehen`), tut er nichts: das Ergebnis steht schon am Blatt, und
 * wer es danach noch einmal will, drückt auf der neu geladenen Seite. Liegt
 * inzwischen ein Vorschlag oder ist nichts mehr ungelesen, sagt es
 * `planen()`, und läuft gerade anderswo ein Aufruf, `blattAbschreiben()`.
 *
 * Gefragt wird mit einer Zahl und einer id, nie mit einer Uhr: bis zur
 * Nachprüfung vom 11.10.2026 hieß „seit dem Druck“ `created_at` der Zeile
 * gegen `Date.now()` beim Druck — die Uhr der Datenbank gegen die des
 * Prozesses —, und ein paar Millisekunden Vorsprung der Datenbank ließen
 * einen Druck wegfallen, der hätte lesen sollen (`gestartet` in
 * @/lib/leser/claude-zustand).
 */
export function claudeVonHand(
  userId: string,
  materialId: string,
  deps?: Partial<ClaudeLeserDeps>,
  gesehen?: string | null,
): Promise<void> {
  const p = prozess();
  const vorgemerkt =
    p.angefordert.get(materialId)?.gestartetBeimDruck ?? gestartetBeimDruck(materialId);
  p.angefordert.set(materialId, { userId, gestartetBeimDruck: vorgemerkt });

  return p.queue.request(
    `hand:${materialId}`,
    { frist: null, geduld: null },
    async () => {
      try {
        const d = claudeDeps(deps);
        claudeZustandMelden(d.konfiguriert);
        if (!d.konfiguriert) return;

        const seitDemDruck = (p.gestartet.get(materialId) ?? 0) > vorgemerkt;
        const neuester = gesehen === undefined ? null : await letzterLauf(userId, materialId);
        if (seitDemDruck || (gesehen !== undefined && (neuester?.id ?? null) !== gesehen)) {
          console.info(
            `Claude ${kurz(materialId)}: von Hand — kein Lauf: seit dem Druck lief der Leser schon an diesem Blatt; das Ergebnis steht dort.`,
          );
          return;
        }

        const ergebnis = await blattAbschreiben(userId, materialId, "von-hand", d);
        if (!ergebnis.gelaufen) {
          console.info(`Claude ${kurz(materialId)}: von Hand — kein Lauf: ${ergebnis.grund}`);
        } else {
          claudeAusgangMelden(userId, ergebnis.ergebnis, ergebnis.grund);
        }
      } finally {
        p.angefordert.delete(materialId);
      }
    },
    () => undefined,
  );
}

/**
 * Was ein Lauf, der nicht aus der eigenen Schleife kam, für die Pause
 * bedeutet — der Knopf am Blatt und der Fragenlauf (@/lib/fragenlauf), der
 * mit demselben Schlüssel dieselbe API ruft.
 *
 * Beide warten keine Pause ab (wer drückt, will es jetzt wissen, und ein
 * abgewiesener Aufruf kostet nichts), aber was sie erleben, gilt danach für
 * alle: eine Pause hält auch den Leser an — ein abgewiesener Schlüssel weist
 * jedes Blatt ab —, und ein Ergebnis setzt die nächste Pause auf den Anfang
 * zurück, weil die API wieder antwortet. „später“ sagt über die API nichts.
 */
export function claudeAusgangMelden(
  userId: string,
  ergebnis: LeserLaufErgebnis,
  grund: string,
): void {
  if (ergebnis === "pause") pauseSetzen(userId, grund);
  else if (ergebnis !== "spaeter") prozess().naechstePauseMs = PAUSE_ANFANG_MS;
}

/** Die ersten acht Zeichen einer id — genug, um sie im Protokoll wiederzufinden. */
function kurz(id: string): string {
  return id.slice(0, 8);
}

function meldung(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Die erste Zeile einer Meldung, gekürzt. Eine Meldung der Datenbank trägt in
 * den Zeilen danach die Parameter der Anweisung mit — Text des Modells, der
 * weder in einen Vermerk noch ins Protokoll gehört.
 */
function ersteZeile(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 300);
}
