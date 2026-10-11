import { ABSCHREIBER_SYSTEM } from "@/lib/abschrift-regeln";
import {
  anthropicSenden,
  bildBlock,
  claudeRufen,
  type ClaudeBildfassung,
  type ClaudeSender,
} from "@/lib/claude/client";
import type { ClaudeErgebnis, Messung } from "@/lib/claude/ergebnis";
import { getMaterial, listMaterialTranscripts, readPageImage } from "@/lib/materials";

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
  type EinordnenAntwort,
  type EinordnenVorab,
  type NachleseAntwort,
  type NachleseVorab,
} from "./claude-auftrag";

/**
 * Der Abschreiber zur Probe: derselbe Aufruf wie im Betrieb, aber die Antwort
 * geht an niemanden (seit dem 11.10.2026, für die Abnahme-Messung in
 * scripts/abschrift-messen.mts).
 *
 * **Warum es das gibt.** Gemessen ist der Leser an der 1000-px-Lesefassung,
 * und zwar nicht über diesen Weg: am 11.10.2026 lasen Opus 5.5 und Sonnet 5.5
 * 31 echte Seiten blind, außerhalb der App. Ob der Aufruf, den die App jetzt
 * selbst macht, genauso liest — und ob das 1600-px-Vollbild (`CLAUDE_BILD=voll`)
 * besser liest oder nur mehr kostet —, zeigt erst eine Messung über genau
 * diesen Aufruf. Die soll keine Spuren hinterlassen: kein Vorschlag im Korb,
 * den danach jemand verwerfen muss, und kein Vermerk in `leser_laeufe`, der
 * ein Blatt für den Betrieb als „gelesen“ abhakt, ohne dass seine Abschrift
 * irgendwo steht.
 *
 * **Derselbe Aufruf, Baustein für Baustein.** Systemtext (`ABSCHREIBER_SYSTEM`),
 * Auftrag (`einordnenAuftrag()` oder `nachleseAuftrag()`), der Aufbau mit der
 * Zeile vor jedem Foto (`abschreibInhalt()`), die Form der Antwort, die Frist
 * und `claudeRufen()` sind die aus @/lib/leser/claude-leser — nichts davon
 * steht hier ein zweites Mal. Eine Messung über einen nachgebauten Aufruf
 * maße den Nachbau.
 *
 * **Eine Seite je Aufruf**, auch wenn das Blatt mehr hat: gemessen wird je
 * Seite und je Bildfassung, und eine Zeile der Messung soll genau einer
 * Seite gehören — mit ihrem eigenen Preis. Der Auftrag sagt dann, was er im
 * Betrieb für ein Teilblatt sagte (die übrigen Seiten las die App selbst),
 * und ohne die erste Seite gibt es keinen Titel. Mehr kostet das kaum: der
 * Preis einer Seite ist ihre Abschrift, und die ist dieselbe.
 *
 * **Was hier NICHT geschieht, prüft claude-leser.test.ts am Quelltext:** kein
 * Weg in den Bestand und keiner durch die Tür (`blattVorschlagen`), kein
 * Vermerk (`laufVermerken`), keine Datenbank außer drei lesenden Funktionen
 * aus @/lib/materials. Die gespeicherte Abschrift wird mitgelesen, aber nur
 * für die Ausgabe, damit man vergleichen kann — ins Modell geht sie nie.
 */

export type TrockenArt = "einordnen" | "nachlese";

/** Eine Zeile der Messung: eine Seite, eine Bildfassung, ein Aufruf. */
export type TrockenZeile = {
  page: string;
  blatt: string;
  /** Die Nummer der Seite am Blatt, ab 1 — wie über dem Foto in der App. */
  nummer: number;
  fassung: ClaudeBildfassung;
  art: TrockenArt;
  /**
   * Was daraus im Betrieb geworden wäre: `vorschlag` oder `kein-vorschlag`
   * (das Modell hat geantwortet), `nichts` (Ablehnung, abgeschnitten, Form
   * passt nicht, oder nichts Brauchbares), `pause` oder `spaeter`.
   */
  ergebnis: "vorschlag" | "kein-vorschlag" | "nichts" | "pause" | "spaeter";
  /** Was das Modell für diese Seite geschrieben hat, ungekürzt — `null`: nichts zu ihr. */
  text: string | null;
  /** Nur beim Einordnen: was das Modell oben auf dem Blatt gelesen hat. */
  titel: string | null;
  themen: string[];
  datum: string | null;
  notiz: string | null;
  /** Der Grund des Modells — oder, ohne Antwort, warum es keine gab. */
  grund: string;
  /** Was die Tür im Betrieb davon weggelassen hätte (zu lang, fremde id, …). */
  hinweise: string[];
  /** Die Abschrift, die heute an der Seite steht — zum Vergleich, `null`: noch keine. */
  bisher: string | null;
  /** Ob `bisher` von Docling stammt und niemand sie gegengelesen hat. */
  bisherMaschinell: boolean;
  messung: Messung | null;
  wandMs: number;
};

export type TrockenErgebnis =
  | { gelaufen: false; grund: string }
  | { gelaufen: true; zeile: TrockenZeile };

/** Was der Auftrag über die eine Seite wissen muss — oder `null`, wenn sie nicht zum Blatt gehört. */
export type TrockenVorab = {
  seite: AuftragsSeite;
  einordnen: EinordnenVorab;
  nachlese: NachleseVorab;
};

/**
 * Die eine Seite als Auftrag, so wie der Betrieb sie für ein Blatt stellte,
 * an dem nur sie für Claude ist: vollständig nur, wenn das Blatt keine andere
 * hat; mit Titel nur, wenn sie die erste ist. Bei der Nachlese gilt sie als
 * „noch nie gelesen“ und nicht als nachgereicht — welche das sind, entscheidet
 * im Betrieb `listPageActivity()`, und gemessen wird hier die Abschrift, nicht
 * diese Regel.
 */
export function trockenVorab(
  seitenIds: readonly string[],
  pageId: string,
  capturedOn: string,
): TrockenVorab | null {
  const index = seitenIds.indexOf(pageId);
  if (index < 0) return null;

  const seite: AuftragsSeite = { id: pageId, nummer: index + 1 };
  return {
    seite,
    einordnen: {
      capturedOn,
      seiten: [seite],
      vollstaendig: seitenIds.length === 1,
      ersteSeiteDabei: index === 0,
    },
    nachlese: { seiten: [seite], nachgereicht: false },
  };
}

/** Was eine Antwort für die Zeile ergibt — ohne Tür, nur ihre Vorprüfung. */
type Auswertung = Pick<
  TrockenZeile,
  "ergebnis" | "text" | "titel" | "themen" | "datum" | "notiz" | "grund" | "hinweise" | "messung" | "wandMs"
>;

/** Die Felder, die nur eine Antwort zum Einordnen hat — leer. */
function ohneFelder(): Pick<TrockenZeile, "titel" | "themen" | "datum" | "notiz"> {
  return { titel: null, themen: [], datum: null, notiz: null };
}

/** Kein Aufruf mit Antwort: Ergebnis und Grund des Aufrufs, sonst nichts. */
function ohneAntwort(gerufen: Exclude<ClaudeErgebnis<unknown>, { art: "antwort" }>): Auswertung {
  return {
    ergebnis: gerufen.art,
    text: null,
    ...ohneFelder(),
    grund: gerufen.grund,
    hinweise: [],
    messung: gerufen.messung,
    wandMs: gerufen.wandMs,
  };
}

/** Die Abschrift des Modells zu genau dieser Seite: der erste Eintrag mit ihrer id. */
function textFuer(transcripts: readonly { page: string; text: string }[], pageId: string): string | null {
  return transcripts.find((eintrag) => eintrag.page.trim() === pageId)?.text ?? null;
}

/**
 * Die Antwort zum Einordnen als Zeile. Weitergegeben wird nichts; was die Tür
 * damit getan hätte, zeigt `einordnenEingabe()`, dieselbe Vorprüfung wie im
 * Betrieb — ihr Ergebnis und ihre Hinweise stehen in der Zeile.
 */
export function einordnenAuswerten(
  gerufen: ClaudeErgebnis<EinordnenAntwort>,
  vorab: EinordnenVorab,
  pageId: string,
  blatt: string,
): Auswertung {
  if (gerufen.art !== "antwort") return ohneAntwort(gerufen);

  const { antwort } = gerufen;
  const eingabe = einordnenEingabe(blatt, antwort, vorab);
  return {
    ergebnis: eingabe.art,
    text: textFuer(antwort.transcripts, pageId),
    titel: antwort.title,
    themen: antwort.topics,
    datum: antwort.captured_on,
    notiz: antwort.note,
    grund: eingabe.art === "nichts" ? eingabe.grund : antwort.grund.trim(),
    hinweise: eingabe.art === "vorschlag" ? eingabe.hinweise : [],
    messung: gerufen.messung,
    wandMs: gerufen.wandMs,
  };
}

/** Die Antwort der Nachlese als Zeile — nur Abschrift, Ergebnis und Grund. */
export function nachleseAuswerten(
  gerufen: ClaudeErgebnis<NachleseAntwort>,
  vorab: NachleseVorab,
  pageId: string,
  blatt: string,
): Auswertung {
  if (gerufen.art !== "antwort") return ohneAntwort(gerufen);

  const { antwort } = gerufen;
  const eingabe = nachleseEingabe(blatt, antwort, vorab);
  return {
    ergebnis: eingabe.art,
    text: textFuer(antwort.transcripts, pageId),
    ...ohneFelder(),
    grund: eingabe.art === "nichts" ? eingabe.grund : antwort.grund.trim(),
    hinweise: eingabe.art === "vorschlag" ? eingabe.hinweise : [],
    messung: gerufen.messung,
    wandMs: gerufen.wandMs,
  };
}

/**
 * Liest eine Seite trocken: ein Aufruf, eine Zeile, sonst nichts.
 *
 * `senden` ersetzt den echten Sender in der Probe (scripts/probe-claude-leser.mts).
 * Ohne Schlüssel ruft `claudeRufen()` gar nicht erst und sagt `pause` — wie im
 * Betrieb.
 *
 * Wirft nur, wenn die Datenbank selbst nicht antwortet.
 */
export async function seiteTrockenLesen(
  userId: string,
  materialId: string,
  pageId: string,
  fassung: ClaudeBildfassung,
  art: TrockenArt,
  senden: ClaudeSender = anthropicSenden,
): Promise<TrockenErgebnis> {
  const blatt = await getMaterial(userId, materialId);
  if (!blatt) return { gelaufen: false, grund: "Das Blatt gibt es nicht (mehr)." };

  const vorab = trockenVorab(
    blatt.pages.map((seite) => seite.id),
    pageId,
    blatt.capturedOn,
  );
  if (!vorab) return { gelaufen: false, grund: "Die Seite gehört nicht (mehr) zu diesem Blatt." };

  const bild = await readPageImage(userId, pageId, fassung);
  const block = bild ? bildBlock(bild.bytes, bild.mimeType) : null;
  if (!block) {
    return { gelaufen: false, grund: `Von dieser Seite ließ sich kein Foto (${fassung}) laden.` };
  }
  const fotos = [{ seite: vorab.seite, bild: block }];

  const auswertung =
    art === "einordnen"
      ? einordnenAuswerten(
          await claudeRufen(
            {
              system: ABSCHREIBER_SYSTEM,
              inhalt: abschreibInhalt(einordnenAuftrag(vorab.einordnen), fotos),
              schema: EINORDNEN_ANTWORT,
              fristMs: fristFuer(fotos.length),
              maxTokens: maxTokensFuer(fotos.length),
            },
            senden,
          ),
          vorab.einordnen,
          pageId,
          materialId,
        )
      : nachleseAuswerten(
          await claudeRufen(
            {
              system: ABSCHREIBER_SYSTEM,
              inhalt: abschreibInhalt(nachleseAuftrag(vorab.nachlese), fotos),
              schema: NACHLESE_ANTWORT,
              fristMs: fristFuer(fotos.length),
              maxTokens: maxTokensFuer(fotos.length),
            },
            senden,
          ),
          vorab.nachlese,
          pageId,
          materialId,
        );

  // Erst nach dem Aufruf gelesen, und nur für die Ausgabe.
  const gespeichert = (await listMaterialTranscripts(userId, materialId)).find(
    (seite) => seite.pageId === pageId,
  );

  return {
    gelaufen: true,
    zeile: {
      page: pageId,
      blatt: materialId,
      nummer: vorab.seite.nummer,
      fassung,
      art,
      ...auswertung,
      bisher: gespeichert?.transcript ?? null,
      bisherMaschinell: gespeichert?.maschinell ?? false,
    },
  };
}
