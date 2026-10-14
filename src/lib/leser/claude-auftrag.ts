import { z } from "zod";

import type { BlattVorschlagEingabe } from "@/lib/blatt-vorschlag";
import { CLAUDE_MAX_TOKENS, fristFuerTokens, type ClaudeInhalt } from "@/lib/claude/client";
import { PROPOSAL_TRANSCRIPT_MAX, proposalInputSchema } from "@/lib/inbox";
import { MATERIAL_NOTE_MAX } from "@/lib/materials";

/**
 * Was der Leser der App dem Modell sagt und was er von ihm zurück annimmt —
 * reine Rechnung, ohne Netz und ohne Datenbank (seit dem 11.10.2026).
 *
 * **Der Auftrag ist der des Postboten, umgeschrieben für einen Aufruf ohne
 * Werkzeuge.** Bis zu diesem Tag stand er in harness/auftrag.mts
 * (`auftragFuer()`, `nachleseAuftragFuer()`), und ein `claude` im Käfig holte
 * sich die Seiten mit read_page und legte den Vorschlag mit propose_sheet an.
 * Jetzt schickt die App die Fotos selbst mit und nimmt eine strukturierte
 * Antwort zurück; die Schritte „read_page für jede Seite“ und „propose_sheet,
 * genau einmal“ gibt es nicht mehr. Geblieben ist alles, was der Auftrag über
 * die Felder sagte — kein Fach, höchstens ein Thema, ein Titel nur wörtlich
 * von oben, der Tag nur, wenn er abweicht, eine kurze Notiz ohne Abschrift,
 * das Teilblatt, die fehlende erste Seite, und wann KEIN Vorschlag das gute
 * Ergebnis ist.
 *
 * **Wie abgeschrieben wird, steht hier nicht.** Das steht im Systemtext
 * (`ABSCHREIBER_SYSTEM` in @/lib/abschrift-regeln), Wort für Wort derselbe
 * wie an propose_sheet im Chat. Hier steht nur, was von der Art des Laufs
 * abhängt: welche Felder es gibt, wohin eine Bemerkung gehört — beim
 * Einordnen in die Notiz, bei der Nachlese in `grund`, weil eine Notiz dort
 * beim Übernehmen die des Menschen ersetzte.
 *
 * **Das Schema ist die Sperre, die Prosa nur die Bitte.** Die Nachlese
 * bekommt ein Schema, in dem es Titel, Thema, Tag und Notiz gar nicht gibt:
 * was das Modell dort sagen wollte, hat keinen Platz. Und was zurückkommt,
 * prüft zod Feld für Feld (@/lib/claude/ergebnis), danach diese Datei noch
 * einmal gegen die Regeln der Tür: dieselben Feldschemas wie
 * `proposalInputSchema`, nur je Feld statt am Ganzen. Ein zu langer Titel
 * kostet so den Titel und nicht die bezahlte Abschrift von zwölf Seiten.
 */

/** Eine Seite, wie der Auftrag sie nennt: ihre id und ihre Nummer am Blatt (ab 1). */
export type AuftragsSeite = { id: string; nummer: number };

/** Was der Auftrag zum Einordnen über das Blatt weiß. */
export type EinordnenVorab = {
  /** Der eingetragene Tag (JJJJ-MM-TT). */
  capturedOn: string;
  /** Die Seiten für das Modell, in der Reihenfolge des Blattes. */
  seiten: readonly AuftragsSeite[];
  /** Sind das alle Seiten des Blattes? Nein: die übrigen hat Docling gelesen. */
  vollstaendig: boolean;
  /** Ist die erste Seite dabei? Nein: ein Titel aus einer späteren wäre falsch. */
  ersteSeiteDabei: boolean;
};

/** Was der Auftrag zur Nachlese über das Blatt weiß. */
export type NachleseVorab = {
  /** Genau die Seiten, die abgeschrieben werden — nie leer. */
  seiten: readonly AuftragsSeite[];
  /**
   * Sind es nachgereichte Seiten (`unreadAttachedPageIds`)? Nein heißt: der
   * Knopf an einem Altblatt, dessen Seiten nie gelesen wurden.
   */
  nachgereicht: boolean;
};

// ── Fristen und Grenzen ──────────────────────────────────────────────────────

/**
 * Was jeder Aufruf an Ausgabe braucht, gleich wie viele Seiten: das Denken
 * über das Blatt bei `effort: "high"`, das sich nicht vorhersagen lässt, das
 * JSON drumherum, Titel, Thema, Notiz und Grund.
 */
const TOKENS_GRUND = 16_000;

/**
 * Was eine Seite höchstens dazu braucht: eine volle Seite Handschrift sind bis
 * zu 8 000 Zeichen (`PROPOSAL_TRANSCRIPT_MAX`), deutsch mit ⟨…⟩ und Formeln
 * grob 2 700 bis 3 500 Tokens, als JSON-Text etwas mehr, und das Denken über
 * diese eine Seite. Achttausend lassen dafür das Doppelte.
 */
const TOKENS_JE_SEITE = 8_000;

/** MAX_PAGES in @/lib/images — eine Seitenzahl, die keine ist, zählt so. */
const MAX_SEITEN = 12;

/** Eine Seitenzahl, wie sie hier zählt: eine echte, oder die höchste. */
function seitenAnzahl(seiten: number): number {
  return Number.isInteger(seiten) && seiten > 0 ? seiten : MAX_SEITEN;
}

/**
 * Wie viele Tokens die Antwort zu so vielen Seiten höchstens haben darf:
 * 16 000 Grundlast und 8 000 je Seite, höchstens `CLAUDE_MAX_TOKENS` —
 * also 24 000 für eine Seite, ab sechs Seiten 64 000 (seit der Abnahme vom
 * 11.10.2026; bis dahin bekam jedes Blatt 64 000).
 *
 * Eine Antwort, die daran stößt, endet als „nichts“ und ist gemerkt (die
 * halbe Abschrift ist schlimmer als keine, @/lib/claude/ergebnis). Bei einem
 * Blatt mit einer Seite ist das eine Schleife und keine Abschrift — und die
 * soll nicht so viel kosten dürfen wie zwölf Seiten. Zu knapp darf es auch
 * nicht sein: dann wäre eine echte Abschrift „nichts“, und gemerkt. Deshalb
 * je Seite das Doppelte dessen, was eine volle Seite braucht.
 */
export function maxTokensFuer(seiten: number): number {
  return Math.min(CLAUDE_MAX_TOKENS, TOKENS_GRUND + seitenAnzahl(seiten) * TOKENS_JE_SEITE);
}

/**
 * Die Frist für einen Aufruf über so viele Seiten — aus `maxTokensFuer()`
 * gerechnet und nicht geschätzt (`fristFuerTokens()` in @/lib/claude/client):
 * Anlauf plus die Zeit, die diese Tokens bei langsamen 25 je Sekunde
 * brauchen. Eine Seite also gut 19 Minuten, ab sechs Seiten gut 45.
 *
 * Bis zur Abnahme vom 11.10.2026 war es umgekehrt: eine Viertelstunde bis zu
 * fünf Seiten, höchstens 29 Minuten, bei 64 000 Tokens für jedes Blatt. Eine
 * Antwort, die bis `max_tokens` lief, brauchte dafür mehr als 71 Tokens je
 * Sekunde — darunter brach die eigene Frist sie ab. Das war „später“, nicht
 * gemerkt, und das Blatt kam wieder: dieselbe Schleife zwei-, dreimal
 * bezahlt statt einmal als „nichts“. Jetzt ist ein bezahlter Fristabbruch der
 * seltene Fall, an dem die API langsamer schrieb als angenommen.
 *
 * Nachmessen lässt es sich an der Zeile „Wand … s“, die der Leser nach jedem
 * Lauf ins Protokoll schreibt (`messungZeile()` in @/lib/claude/ergebnis).
 */
export function fristFuer(seiten: number): number {
  return fristFuerTokens(maxTokensFuer(seiten));
}

// ── Die Antworten ────────────────────────────────────────────────────────────

/**
 * Eine Abschrift, wie das Modell sie zurückgibt — `page` ist die id, die vor
 * dem Foto stand. Ohne Längengrenze im Schema: das SDK schreibt `maxLength`
 * nur in die Beschreibung, die API hält sie also nicht ein, und zod wiese
 * sonst die GANZE Antwort ab. Zu lang wird stattdessen je Seite verworfen
 * (`abschriftenSieben()` unten).
 */
const abschriftSchema = z
  .object({
    page: z.string().describe("Die id der Seite, genau so, wie sie vor ihrem Foto steht."),
    text: z.string().describe("Was auf der Seite steht — leer, wenn nichts darauf steht."),
  })
  .strict();

/**
 * „vorschlag“ oder „kein-vorschlag“. Die API hält die beiden Werte nicht ein
 * — das SDK schreibt `enum` in die Beschreibung —, zod danach schon; ein
 * dritter Wert ist eine Antwort, die nicht zur Form passt („nichts“).
 */
const ergebnisSchema = z
  .enum(["vorschlag", "kein-vorschlag"])
  .describe("„vorschlag“ oder „kein-vorschlag“ — siehe Auftrag.");

/**
 * Die Antwort zum Einordnen.
 *
 * Die Abschrift steht VORN: das Modell schreibt die Felder in dieser
 * Reihenfolge, und Notiz und `grund` sagen, was beim Abschreiben unsicher
 * blieb — das weiß es erst danach. Jedes Feld ist verlangt; „sagt nichts“ ist
 * `null` oder die leere Liste, damit kein Leser raten muss, ob ein fehlendes
 * Feld „nichts“ heißt oder „vergessen“.
 *
 * `topics` ohne Höchstzahl im Schema, aus demselben Grund wie die Länge oben:
 * ein zweites Thema soll nicht die Abschrift kosten. Genommen wird das erste.
 */
export const EINORDNEN_ANTWORT = z
  .object({
    transcripts: z.array(abschriftSchema),
    title: z.string().nullable(),
    topics: z.array(z.string()),
    captured_on: z.string().nullable().describe("JJJJ-MM-TT oder null."),
    note: z.string().nullable(),
    ergebnis: ergebnisSchema,
    grund: z.string(),
  })
  .strict();

export type EinordnenAntwort = z.infer<typeof EINORDNEN_ANTWORT>;

/**
 * Die Antwort der Nachlese: die Abschrift, sonst nur Ergebnis und Grund.
 * Titel, Thema, Tag und Notiz gibt es hier nicht — warum, steht am Auftrag.
 */
export const NACHLESE_ANTWORT = z
  .object({
    transcripts: z.array(abschriftSchema),
    ergebnis: ergebnisSchema,
    grund: z.string(),
  })
  .strict();

export type NachleseAntwort = z.infer<typeof NACHLESE_ANTWORT>;

// ── Die Aufträge ─────────────────────────────────────────────────────────────

/** „Seite 3 (id …)“ — die Nummer, die auch über dem Bild in der App steht. */
function seiteNennen(seite: AuftragsSeite): string {
  return `Seite ${seite.nummer} (id ${seite.id})`;
}

function seitenNennen(seiten: readonly AuftragsSeite[]): string {
  return seiten.map(seiteNennen).join(", ");
}

/** Der Satz zu Seiten, deren Foto nicht mitkam — leer, wenn alle da sind. */
function ohneFotoSatz(ohneFoto: readonly AuftragsSeite[], wohin: "Notiz" | "grund"): string {
  if (ohneFoto.length === 0) return "";

  const gesagt = wohin === "Notiz" ? "die Notiz nennt" : "grund nennt";
  return ohneFoto.length === 1
    ? ` Von ${seiteNennen(ohneFoto[0])} kam kein Foto mit — sie fehlt in transcripts, und ${gesagt} sie.`
    : ` Von ${seitenNennen(ohneFoto)} kamen keine Fotos mit — sie fehlen in transcripts, und ${gesagt} sie.`;
}

/**
 * Der Auftrag für ein Blatt im Eingangskorb, an dem noch kein Vorschlag liegt.
 *
 * Die Angaben zum Blatt stehen am ENDE, wie beim Postboten: sie sind das
 * einzige, was sich von Blatt zu Blatt ändert. Die Sätze zum Teilblatt und
 * zur fehlenden ersten Seite stehen nur da, wenn sie zutreffen — ein Blatt,
 * das Claude ganz liest, bekommt den Auftrag ohne sie.
 *
 * Einer davon dreht „KEINE EINZIGE Seite lesbar → kein Vorschlag“ für das
 * Teilblatt um. Bekommt Claude dort nur eine verwackelte Seite und schlägt
 * deshalb nichts vor, ist der Lauf gemerkt, und die App legt keinen eigenen
 * Vorschlag an, solange eine Claude-Seite ohne Abschrift ist
 * (`appVorschlagFaellig()` in @/lib/leser/regel) — das Blatt läge ohne
 * Vorschlag im Korb, obwohl Docling die übrigen Seiten gelesen hat. Ein
 * Vorschlag nur mit Notiz reicht: Jev ordnet mit den Docling-Abschriften ein,
 * und die unlesbare Seite bekommt am eingeordneten Blatt den zweiten Versuch
 * der Nachlese.
 */
export function einordnenAuftrag(
  vorab: EinordnenVorab,
  ohneFoto: readonly AuftragsSeite[] = [],
): string {
  const teilblatt = vorab.vollstaendig
    ? ""
    : " Die übrigen Seiten dieses Blattes hat die App schon selbst gelesen — sie stehen hier nicht, und du schreibst nur diese ab. Kannst du keine davon lesen, schlag trotzdem vor: ohne transcripts, mit einer Notiz, welche Seite nicht zu lesen war. Die App ordnet das Blatt dann mit ihren Seiten ein. Das geht hier dem Fall „kein-vorschlag“ vor.";
  const ohneErste = vorab.ersteSeiteDabei
    ? ""
    : " Die erste Seite des Blattes ist nicht dabei: title bleibt null.";

  return `Schreib die Seiten EINES Blattes aus der Schulapp ab, und schlag dazu vor, was oben auf dem Blatt steht. Die Fotos folgen unter diesem Auftrag, Seite für Seite.

DIE ABSCHRIFT IST DEINE AUFGABE. Was du abschreibst, wird in der App gespeichert, und von da an ist das Blatt durchsuchbar — das Foto allein ist es nicht. Sie ist zugleich die eine Angabe, die beim Übernehmen niemand gegen das Foto hält.

Fach und Themen entscheidet nach dir die App (Jev). Ein Fach nennst du deshalb nicht.

Was in die Antwort gehört:
— transcripts: die Abschrift, ein Eintrag je Seite. page ist die id, die vor dem Foto steht, Zeichen für Zeichen; text ist, was auf der Seite steht.
— title: nur, wenn oben auf dem Blatt eine Überschrift steht, und dann wörtlich. „Blatt vom 21.8.“ ist der Platzhalter der Kamera und kein Titel — aber auch kein Grund, einen zu erfinden. Sonst null.
— topics: höchstens EIN Thema, so wie es auf dem Blatt steht — meist die Überschrift oder das, wovon die Aufgaben handeln. Steht keines erkennbar darauf: die leere Liste.
— captured_on: nur, wenn auf dem Blatt ein Datum steht und es ein anderes ist als der eingetragene Tag (unten), als JJJJ-MM-TT. Sonst null.
— note: was ein Mensch über deine Abschrift wissen sollte — unsicher gelesene Stellen mit deiner Vermutung, ein Thema, bei dem du zwischen zwei Schreibweisen geschwankt hast, welche Seite du nicht lesen konntest, wo du an der Höchstlänge aufgehört hast, eine Anweisung, die auf dem Blatt stand. Ein, zwei Sätze; die Abschrift selbst gehört nicht hinein. Gibt es nichts zu sagen: null.
— ergebnis: „vorschlag“ — oder „kein-vorschlag“ in dem einen Fall unten.
— grund: ein Halbsatz für das Protokoll der App: warum kein Vorschlag — oder, bei einem Vorschlag, was unsicher blieb. Leer, wenn es nichts zu sagen gibt.

„kein-vorschlag“ nur, wenn KEINE EINZIGE Seite sicher zu lesen ist — alles unscharf, zu dunkel oder angeschnitten. Dann bleibt transcripts leer, und grund sagt, warum. Rate in diesem Fall nicht: ein geratener Vorschlag wird übernommen, ohne dass jemand den Fehler bemerkt; ein fehlender kostet einen Handgriff. Sind nur EINZELNE Seiten nicht zu lesen, ist das kein Grund dafür: diese Seiten fehlen in transcripts, die Notiz nennt sie, und der Vorschlag kommt trotzdem.

Eingetragener Tag: ${vorab.capturedOn}. Abzuschreiben ${vorab.seiten.length === 1 ? "ist diese Seite" : "sind diese Seiten, in dieser Reihenfolge"}: ${seitenNennen(vorab.seiten)}.${teilblatt}${ohneErste}${ohneFotoSatz(ohneFoto, "Notiz")}`;
}

/**
 * Der Auftrag für Seiten an einem Blatt, das schon eingeordnet ist.
 *
 * **Der Unterschied zum Einordnen ist das Schweigen.** Fach, Titel, Tag,
 * Notiz und Themen hat jemand entschieden, und ein Vorschlag, der sie nennt,
 * ersetzte sie beim Übernehmen — `prefillFromProposal()` in @/lib/inbox kann
 * nichts entfernen, aber alles ersetzen, und die Notiz des Menschen gegen die
 * des Modells zu tauschen ist ein Verlust, den nichts zurückgibt. Deshalb hat
 * die Antwort nur `transcripts` (`NACHLESE_ANTWORT`), und was das Modell sonst
 * zu sagen hat, steht in `grund` — im Protokoll und nicht am Blatt. Nur einen
 * solchen Vorschlag übernimmt die App an einem eingeordneten Blatt von selbst
 * (@/lib/auto-file).
 *
 * **Genau diese Seiten und keine andere.** Die Liste kommt aus
 * `listPageActivity().unreadAttachedPageIds`, und mitgeschickt werden nur
 * deren Fotos; eine andere ungelesene Seite — die alte eines Altblattes —
 * sieht das Modell gar nicht. Eine LEERE Liste ist ein Fehler und kein „ohne
 * Einschränkung“: fiele sie auf „alle ungelesenen“ zurück, wäre genau die
 * Lücke offen, die die Liste schließt.
 */
export function nachleseAuftrag(
  vorab: NachleseVorab,
  ohneFoto: readonly AuftragsSeite[] = [],
): string {
  const anzahl = vorab.seiten.length;
  if (anzahl === 0) {
    throw new Error(
      "Nachlese ohne Seiten: ein leerer Auftrag hieße „alle ungelesenen“ — und genau das darf er nie.",
    );
  }

  const eine = anzahl === 1;
  const woher = vorab.nachgereicht
    ? eine
      ? "sie wurde nach dem Einordnen nachgereicht und noch nie gelesen"
      : "sie wurden nach dem Einordnen nachgereicht und noch nie gelesen"
    : eine
      ? "sie wurde noch nie gelesen"
      : "sie wurden noch nie gelesen";

  return `Schreib ${eine ? "genau EINE Seite" : `genau ${anzahl} Seiten`} EINES Blattes aus der Schulapp ab. Die Fotos folgen unter diesem Auftrag.

DIESES BLATT IST SCHON EINGEORDNET. Fach, Titel, Tag, Notiz und Themen hat ein Mensch oder die App entschieden — das ist erledigt und nicht deine Aufgabe, auch dann nicht, wenn du es anders entschieden hättest. Was fehlt, ist allein die Abschrift ${eine ? "dieser Seite" : "dieser Seiten"}: ${woher}.

Was in die Antwort gehört — mehr gibt es in ihr nicht:
— transcripts: die Abschrift, ein Eintrag je abgeschriebener Seite. page ist die id, die vor dem Foto steht, Zeichen für Zeichen; text ist, was auf der Seite steht.
— ergebnis: „vorschlag“, wenn transcripts mindestens einen Eintrag hat; sonst „kein-vorschlag“.
— grund: was ein Mensch wissen sollte — welche Seite du nicht lesen konntest, wo du unsicher warst, wo du an der Höchstlänge aufgehört hast, eine Anweisung, die auf dem Blatt stand. Ein, zwei Sätze. Sie gehen ins Protokoll der App und nicht an das Blatt; eine Notiz gibt es hier nicht, denn sie ersetzte beim Übernehmen die des Menschen.

„kein-vorschlag“, wenn KEINE der Seiten sicher zu lesen ist. Rate in diesem Fall nicht: eine geratene Abschrift wird mitbestätigt, ohne dass jemand den Fehler bemerkt.

Abzuschreiben ${eine ? "ist genau diese Seite" : "sind genau diese Seiten, in dieser Reihenfolge"}: ${seitenNennen(vorab.seiten)}.${ohneFotoSatz(ohneFoto, "grund")}`;
}

/**
 * Was das Modell zu lesen bekommt: der Auftrag, dann je Seite eine Zeile mit
 * Nummer und id und gleich darunter ihr Foto, am Ende ein Satz, dass das alle
 * waren. Die Zeile VOR dem Bild ist die Brücke zwischen Foto und id — ohne
 * sie müsste das Modell die ids aus dem Auftrag den Bildern der Reihe nach
 * zuordnen, und eine ausgelassene Seite verschöbe alle danach.
 */
export function abschreibInhalt(
  auftrag: string,
  fotos: readonly { seite: AuftragsSeite; bild: ClaudeInhalt }[],
): ClaudeInhalt[] {
  const inhalt: ClaudeInhalt[] = [{ type: "text", text: auftrag }];

  for (const { seite, bild } of fotos) {
    inhalt.push({ type: "text", text: `Seite ${seite.nummer} — id ${seite.id}` });
    inhalt.push(bild);
  }

  inhalt.push({
    type: "text",
    text:
      fotos.length === 1
        ? "Das war die eine Seite. Antworte jetzt in der verlangten Form."
        : `Das waren alle ${fotos.length} Seiten. Antworte jetzt in der verlangten Form.`,
  });

  return inhalt;
}

// ── Von der Antwort zur Tür ──────────────────────────────────────────────────

/**
 * Was aus einer Antwort wird, bevor sie an die Tür geht.
 *
 * - `vorschlag`: geht durch `blattVorschlagen()` (@/lib/blatt-vorschlag);
 *   `hinweise` sagt, was dabei weggefallen ist — fürs Protokoll.
 * - `kein-vorschlag`: das Modell hat es so entschieden, mit seinem Grund.
 * - `nichts`: es wollte vorschlagen, aber nichts davon hielt der Prüfung
 *   stand. Gemerkt wie „nichts“ beim Aufruf: dieselbe Antwort käme wieder.
 */
export type EingabeErgebnis =
  | { art: "vorschlag"; eingabe: BlattVorschlagEingabe; hinweise: string[] }
  | { art: "kein-vorschlag"; grund: string }
  | { art: "nichts"; grund: string };

/**
 * Die Abschriften, die an die Tür dürfen: nur zu Seiten, die im Auftrag
 * standen und das Blatt JETZT noch hat, je Seite die erste, und keine über
 * `PROPOSAL_TRANSCRIPT_MAX`.
 *
 * Eine fremde id fängt die Tür selbst (`fremde-seiten`) — aber dort scheitert
 * der GANZE Vorschlag. Hier fällt nur der eine Eintrag weg. Dasselbe gilt für
 * eine Seite, die während des Aufrufs gelöscht wurde (`vorhanden`, frisch
 * gelesen gleich nach der Antwort): ein Aufruf dauert Minuten, und in der Zeit
 * löscht ein Mensch gern das verwackelte Foto. Bis zur Abnahme vom 11.10.2026
 * wurde nur gegen den Plan von vor dem Aufruf gesiebt; die Tür fand die Seite
 * nicht mehr und wies den ganzen, bezahlten Vorschlag ab, samt den Abschriften
 * der übrigen Seiten.
 *
 * Zu lang heißt weggelassen und nicht gekürzt: eine abgeschnittene Abschrift
 * behauptete, das sei alles, was auf der Seite steht (siehe
 * `PROPOSAL_TRANSCRIPT_MAX`); weggelassen bleibt die Seite ungelesen und ist
 * wieder dran.
 */
export function abschriftenSieben(
  eintraege: readonly { page: string; text: string }[],
  seiten: readonly AuftragsSeite[],
  vorhanden?: ReadonlySet<string>,
): { bleiben: { page: string; text: string }[]; hinweise: string[] } {
  const nummern = new Map(seiten.map((seite) => [seite.id, seite.nummer]));
  const gesehen = new Set<string>();
  const bleiben: { page: string; text: string }[] = [];
  const hinweise: string[] = [];

  for (const eintrag of eintraege) {
    const page = eintrag.page.trim();
    const nummer = nummern.get(page);

    if (nummer === undefined) {
      hinweise.push(`eine Abschrift zu einer Seite, die nicht im Auftrag stand (${page.slice(0, 8) || "ohne id"}), verworfen`);
      continue;
    }
    if (gesehen.has(page)) {
      hinweise.push(`Seite ${nummer} doppelt, der erste Eintrag zählt`);
      continue;
    }
    gesehen.add(page);

    if (vorhanden && !vorhanden.has(page)) {
      hinweise.push(`Seite ${nummer} während des Laufs gelöscht, ihre Abschrift verworfen`);
      continue;
    }

    if (eintrag.text.trim().length > PROPOSAL_TRANSCRIPT_MAX) {
      hinweise.push(`Seite ${nummer} länger als ${PROPOSAL_TRANSCRIPT_MAX} Zeichen, weggelassen und ungelesen`);
      continue;
    }

    bleiben.push({ page, text: eintrag.text });
  }

  return { bleiben, hinweise };
}

/** Ein Text, getrimmt; leer heißt `null`. */
function textOderNull(wert: string | null): string | null {
  const getrimmt = wert?.trim() ?? "";
  return getrimmt === "" ? null : getrimmt;
}

/**
 * Die Antwort zum Einordnen als Eingabe der Tür — Feld für Feld gegen
 * dieselben Schemas, mit denen `proposalInputSchema` gleich danach das Ganze
 * prüft. Was an einem Feld scheitert, kostet nur dieses Feld.
 */
export function einordnenEingabe(
  sheet: string,
  antwort: EinordnenAntwort,
  vorab: EinordnenVorab,
  vorhanden?: ReadonlySet<string>,
): EingabeErgebnis {
  if (antwort.ergebnis === "kein-vorschlag") {
    return { art: "kein-vorschlag", grund: antwort.grund.trim() || "ohne Angabe" };
  }

  const felder = proposalInputSchema.shape;
  const { bleiben, hinweise } = abschriftenSieben(antwort.transcripts, vorab.seiten, vorhanden);

  let title = textOderNull(antwort.title);
  if (title !== null && !vorab.ersteSeiteDabei) {
    // Der Auftrag sagt es; gehalten wird es hier. Die Überschrift steht auf
    // einer Seite, die das Modell nicht gesehen hat, und den Titel nimmt die
    // App dann aus Doclings erster Seite (@/lib/auto-file).
    hinweise.push("Titel verworfen, die erste Seite war nicht dabei");
    title = null;
  }
  if (title !== null && !felder.title.safeParse(title).success) {
    hinweise.push("Titel verworfen, zu lang");
    title = null;
  }

  const themen = antwort.topics.map((thema) => thema.trim()).filter((thema) => thema !== "");
  if (themen.length > 1) hinweise.push(`${themen.length} Themen genannt, nur das erste genommen`);

  let capturedOn = textOderNull(antwort.captured_on);
  if (capturedOn === vorab.capturedOn) capturedOn = null;
  if (capturedOn !== null && !felder.capturedOn.safeParse(capturedOn).success) {
    hinweise.push(`Datum „${capturedOn.slice(0, 20)}“ verworfen`);
    capturedOn = null;
  }

  let note = textOderNull(antwort.note);
  if (note !== null && note.length > MATERIAL_NOTE_MAX) {
    // Gekürzt und nicht verworfen: die Notiz ist ein Hinweis an den Menschen
    // — welche Seite fehlt, was unsicher ist —, und ihr Anfang ist mehr wert
    // als nichts. Anders als eine Abschrift behauptet sie nicht, vollständig
    // zu sein; das „…“ sagt, dass sie es nicht ist.
    note = `${note.slice(0, MATERIAL_NOTE_MAX - 1).trimEnd()}…`;
    hinweise.push("Notiz gekürzt");
  }

  const eingabe: BlattVorschlagEingabe = {
    sheet,
    subjectId: null,
    title,
    capturedOn,
    note,
    topics: themen.slice(0, 1),
    transcripts: bleiben,
  };

  if (bleiben.length === 0 && title === null && capturedOn === null && note === null && themen.length === 0) {
    return {
      art: "nichts",
      grund: ["Die Antwort schlug nichts vor, was sich verwenden ließ", ...hinweise].join("; "),
    };
  }

  return { art: "vorschlag", eingabe, hinweise };
}

/** Die Antwort der Nachlese als Eingabe der Tür: nur Abschriften, sonst nichts. */
export function nachleseEingabe(
  sheet: string,
  antwort: NachleseAntwort,
  vorab: NachleseVorab,
  vorhanden?: ReadonlySet<string>,
): EingabeErgebnis {
  if (antwort.ergebnis === "kein-vorschlag") {
    return { art: "kein-vorschlag", grund: antwort.grund.trim() || "ohne Angabe" };
  }

  const { bleiben, hinweise } = abschriftenSieben(antwort.transcripts, vorab.seiten, vorhanden);
  if (bleiben.length === 0) {
    return {
      art: "nichts",
      grund: ["Keine Abschrift, die sich verwenden ließ", ...hinweise].join("; "),
    };
  }

  return {
    art: "vorschlag",
    eingabe: { sheet, subjectId: null, transcripts: bleiben },
    hinweise,
  };
}
