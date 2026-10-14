import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  leserLaeufe,
  materialPages,
  materialProposalTranscripts,
  materialProposals,
  materials,
  type LeserLaufAbbruch,
  type LeserLaufArt,
  type LeserLaufErgebnis,
  type LeserLaufMessung,
} from "@/db/schema";
import { listPageActivity } from "@/lib/materials";

import type { GedaechtnisZeile, Kandidat, LaufZeile } from "./claude-ablauf";

/**
 * Die Abfragen des Claude-Lesers: sein Gedächtnis (`leser_laeufe`) und die
 * Frage, wo es etwas zu lesen gibt (seit dem 11.10.2026). Der Fragenlauf
 * (@/lib/fragenlauf) vermerkt seine Läufe in derselben Tabelle, über dieselbe
 * Funktion.
 *
 * Geschrieben wird hier genau eine Sorte Zeile — der Vermerk eines Laufs:
 * angelegt, bevor der Abschreiber ruft (`laufBeginnen()`), und danach mit dem
 * Ergebnis ergänzt (`laufAbschliessen()`); der Fragenlauf legt seine Zeile in
 * einem Zug an (`laufVermerken()`). Dazu, seit der Nachprüfung vom 11.10.2026,
 * die Spur eines verworfenen Vorschlags von außen (`verworfenVermerken()`) —
 * eine Zeile wie die eines Laufs, nur ohne Aufruf. In Blätter, Seiten und Vorschläge schreibt
 * diese Datei nichts; das tut nur die Tür (@/lib/blatt-vorschlag). Was gerechnet wird — welches Blatt dran ist,
 * was als gemerkt gilt —, steht in @/lib/leser/claude-ablauf, damit es ohne
 * Datenbank getestet ist; hier wird nur gelesen und gezählt. Gegen eine echte
 * Datenbank prüft das scripts/probe-claude-leser.mts.
 *
 * Zeitpunkte kommen als ISO-Text in UTC über `to_char()`, in GENAU der Form
 * von `listPageActivity()` — dieselbe Zeichenkette ist der Schlüssel des
 * Gedächtnisses, und eine zweite Schreibweise derselben Zeit wäre ein neuer
 * Fall, also ein zweites Mal bezahlt. Gezählt wird mit `::int`, weil `count()`
 * über postgres-js als Zeichenkette ankäme.
 */

/** Ein Zeitpunkt als Text, wie ihn `listPageActivity()` als `lastPageAt` liefert. */
function isoText(spalte: unknown) {
  return sql<string | null>`to_char(${spalte} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** Ungelesen und für Claude: kein Text, und weder Docling noch die Zuteilung ist dran. */
const FUER_CLAUDE = sql`${materialPages.transcript} is null and (${materialPages.leser} = 'claude' or ${materialPages.leser} is null)`;

/**
 * Ungelesen, und die App hat sie Claude zugeteilt — ohne die Seiten ohne Leser
 * (NULL, vor dem 6.10.2026). Nur solche liest der Leser im Korb von selbst.
 */
const CLAUDE_ZUGETEILT = sql`${materialPages.transcript} is null and ${materialPages.leser} = 'claude'`;

/** Wie lange ist es bis zu diesem Zeitpunkt noch, nach der Uhr der Datenbank (ms)? */
function restMs(spalte: unknown) {
  return sql<number | null>`floor(extract(epoch from (${spalte} - now())) * 1000)::float8`;
}

/** Wie lang ein Grund höchstens gespeichert wird — ein Satz, keine Abschrift. */
const GRUND_MAX = 2_000;

/**
 * Ein Text fürs Speichern in `leser_laeufe`: ohne U+0000 und gedeckelt.
 *
 * Postgres nimmt kein Nullzeichen in `text`, und der Grund eines Laufs trägt
 * Sätze des Modells und Meldungen der Datenbank. Die Antwort des Modells ist
 * schon an ihrer Grenze gesäubert (`ohneNullzeichen()` in
 * @/lib/claude/ergebnis); hier steht es noch einmal, weil das hier die eine
 * Stelle ist, an der ein Vermerk entsteht — und ein Vermerk, der am Speichern
 * scheitert, ist ein Blatt, das beim nächsten Anstoß noch einmal bezahlt wird
 * (Abnahme vom 11.10.2026).
 */
export function vermerkText(text: string): string {
  const sauber = text.replaceAll("\u0000", "");
  return sauber.length > GRUND_MAX ? `${sauber.slice(0, GRUND_MAX - 1)}…` : sauber;
}

/**
 * Die Blätter dieses Nutzers, an denen eine Seite für Claude ungelesen ist —
 * im Korb wie eingeordnet, samt allem, was `auswaehlen()` braucht.
 *
 * Die Altblätter kommen hier mit (ihre Seiten sind NULL und ungelesen), und
 * das ist kein Fehler: eingeordnet ist für sie `nachgereicht` leer, und im
 * Korb zählt `claudeSeiten` sie nicht — die Auswahl lässt sie in beiden
 * Fällen liegen, auch nach „wieder in den Korb“. Ob eine Seite nachgereicht
 * ist, entscheidet allein `listPageActivity()` — die eine Fassung der Regel
 * in @/lib/materials, hier nicht noch einmal getippt.
 *
 * Das Alter der jüngsten Seite rechnet die Datenbank gegen `now()`, wie
 * `korbblattStand()`: dieselbe Uhr, die `created_at` gesetzt hat.
 */
export async function claudeKandidaten(userId: string): Promise<Kandidat[]> {
  const zeilen = await db
    .select({
      materialId: materials.id,
      eingeordnet: sql<boolean>`${materials.filedAt} is not null`,
      seitLetzterSeiteMs: sql<number>`floor(extract(epoch from (now() - max(${materialPages.createdAt}))) * 1000)::float8`,
      offen: sql<number>`(count(*) filter (where ${materialPages.leser} = 'offen'))::int`,
      fuerClaude: sql<number>`(count(*) filter (where ${FUER_CLAUDE}))::int`,
      claudeSeiten: sql<number>`(count(*) filter (where ${CLAUDE_ZUGETEILT}))::int`,
    })
    .from(materials)
    .innerJoin(materialPages, eq(materialPages.materialId, materials.id))
    .where(eq(materials.userId, userId))
    .groupBy(materials.id)
    .having(sql`count(*) filter (where ${FUER_CLAUDE}) > 0`);

  if (zeilen.length === 0) return [];

  const ids = zeilen.map((zeile) => zeile.materialId);
  const [aktivitaet, vorschlaege] = await Promise.all([
    listPageActivity(userId, ids),
    db
      .select({
        materialId: materialProposals.materialId,
        anzahl: sql<number>`count(*)::int`,
        juengster: isoText(sql`max(${materialProposals.createdAt})`),
      })
      .from(materialProposals)
      .where(inArray(materialProposals.materialId, ids))
      .groupBy(materialProposals.materialId),
  ]);
  const vorschlagJe = new Map(vorschlaege.map((zeile) => [zeile.materialId, zeile]));

  return zeilen.flatMap((zeile) => {
    const stand = aktivitaet.get(zeile.materialId);
    // Ohne Aktivität keine Seite, also auch nichts zu lesen — die Seiten
    // sind zwischen den beiden Abfragen verschwunden.
    if (!stand) return [];
    const vorschlag = vorschlagJe.get(zeile.materialId);

    return [
      {
        materialId: zeile.materialId,
        eingeordnet: Boolean(zeile.eingeordnet),
        lastPageAt: stand.lastPageAt,
        seitLetzterSeiteMs: Number(zeile.seitLetzterSeiteMs ?? 0),
        offen: zeile.offen,
        fuerClaude: zeile.fuerClaude,
        claudeSeiten: zeile.claudeSeiten,
        nachgereicht: stand.unreadAttachedPageIds,
        vorschlaege: vorschlag?.anzahl ?? 0,
        juengsterVorschlagAt: vorschlag?.juengster ?? null,
      },
    ];
  });
}

/** Wie viele Vorschläge an einem Blatt liegen und wann der jüngste kam. */
export async function vorschlagStand(
  userId: string,
  materialId: string,
): Promise<{ anzahl: number; juengster: string | null }> {
  const [zeile] = await db
    .select({
      anzahl: sql<number>`count(*)::int`,
      juengster: isoText(sql`max(${materialProposals.createdAt})`),
    })
    .from(materialProposals)
    .innerJoin(
      materials,
      and(eq(materials.id, materialProposals.materialId), eq(materials.userId, userId)),
    )
    .where(eq(materialProposals.materialId, materialId));

  return { anzahl: zeile?.anzahl ?? 0, juengster: zeile?.juengster ?? null };
}

/**
 * Das Gedächtnis zu diesen Blättern: jede Zeile der drei Abschreib-Arten, die
 * etwas erledigt, bezahlt abbrach oder noch läuft. Eine `pause` oder ein
 * `spaeter` ohne `abbruch` steht nicht darin — sie haben nichts gekostet und
 * zählen nirgends. Wie lange eine `laeuft`-Zeile noch gilt, rechnet die
 * Datenbank, mit derselben Uhr, die `frist_bis` gesetzt hat.
 */
export async function gedaechtnisZeilen(
  userId: string,
  materialIds: readonly string[],
): Promise<GedaechtnisZeile[]> {
  if (materialIds.length === 0) return [];

  const zeilen = await db
    .select({
      materialId: leserLaeufe.materialId,
      art: leserLaeufe.art,
      schluessel: leserLaeufe.schluessel,
      ergebnis: leserLaeufe.ergebnis,
      abbruch: leserLaeufe.abbruch,
      abgeschrieben: leserLaeufe.abgeschrieben,
      fristRestMs: restMs(leserLaeufe.fristBis),
      // Nach der Uhr der Datenbank, wie `fristRestMs`: wie alt die Zeile ist.
      alterMs: sql<number>`floor(extract(epoch from (now() - ${leserLaeufe.createdAt})) * 1000)::float8`,
    })
    .from(leserLaeufe)
    .where(
      and(
        eq(leserLaeufe.userId, userId),
        inArray(leserLaeufe.materialId, [...materialIds]),
        inArray(leserLaeufe.art, ["einordnen", "nachlese", "von-hand"]),
        or(
          inArray(leserLaeufe.ergebnis, ["vorschlag", "kein-vorschlag", "nichts", "laeuft"]),
          sql`${leserLaeufe.abbruch} is not null`,
        ),
      ),
    );

  return zeilen.flatMap((zeile) =>
    zeile.materialId
      ? [
          {
            ...zeile,
            materialId: zeile.materialId,
            abgeschrieben: Array.isArray(zeile.abgeschrieben) ? zeile.abgeschrieben : null,
            alterMs: zeile.alterMs === null ? null : Number(zeile.alterMs),
            fristRestMs:
              zeile.ergebnis === "laeuft" && zeile.fristRestMs !== null
                ? Number(zeile.fristRestMs)
                : null,
          },
        ]
      : [],
  );
}

/**
 * Was ein Lauf hinterlässt — an einem Blatt (die drei Arten des
 * Abschreibers) oder an einer Klausur (der Fragenlauf, @/lib/fragenlauf). Ein
 * Typ mit zwei Zielen und nicht zwei Funktionen: die Tabelle verlangt genau
 * eines davon (`leser_laeufe_ziel_check`), und hier gibt es genau eine
 * Stelle, die in sie schreibt (claude-leser.test.ts zählt sie).
 */
export type LaufVermerk = {
  userId: string;
  ergebnis: LeserLaufErgebnis;
  grund: string;
  /** Die Messung des Aufrufs; `null`, wenn keine Antwort kam. */
  messung: LeserLaufMessung | null;
  /** Bezahlt und nicht gemerkt — woran es abbrach (siehe die Spalte). */
  abbruch?: LeserLaufAbbruch | null;
} & (
  | {
      art: Extract<LeserLaufArt, "einordnen" | "nachlese" | "von-hand">;
      materialId: string;
      /** `lastPageAt` beim Lauf, gelesen VOR den Seiten. */
      schluessel: string;
    }
  | {
      art: "fragen";
      examId: string;
    }
  | {
      /** Der Bau eines Arbeitsblatts (Modell 23, Plan H) */
      art: "arbeitsblatt";
      arbeitsblattId: string;
    }
);

/**
 * Vermerkt einen Lauf in einem Zug — der Fragenlauf, und jeder, der seine
 * Zeile nicht vorher mit `laufBeginnen()` angelegt hat. Falsch heißt: nicht
 * geschrieben, weil für diesen Stand schon ein gemerktes Ergebnis dasteht (der
 * eindeutige Teilindex) — zwei Läufe haben sich überschnitten, etwa zwei
 * Prozesse nach einem Neustart. Der zweite war dann umsonst, und das gehört
 * ins Protokoll. Ein Fragenlauf fällt nie unter den Teilindex; er steht immer
 * da.
 *
 * Modell und Kosten stehen neben der Messung als eigene Spalten, damit „was
 * hat der Monat gekostet?“ eine Summe über eine Spalte ist (src/db/schema.ts).
 */
export async function laufVermerken(vermerk: LaufVermerk): Promise<boolean> {
  const ziel =
    vermerk.art === "fragen"
      ? { materialId: null, examId: vermerk.examId, arbeitsblattId: null, schluessel: "" }
      : vermerk.art === "arbeitsblatt"
        ? { materialId: null, examId: null, arbeitsblattId: vermerk.arbeitsblattId, schluessel: "" }
        : { materialId: vermerk.materialId, examId: null, arbeitsblattId: null, schluessel: vermerk.schluessel };

  const geschrieben = await db
    .insert(leserLaeufe)
    .values({
      userId: vermerk.userId,
      materialId: ziel.materialId,
      examId: ziel.examId,
      arbeitsblattId: ziel.arbeitsblattId,
      art: vermerk.art,
      schluessel: ziel.schluessel,
      ergebnis: vermerk.ergebnis,
      grund: vermerkText(vermerk.grund),
      abbruch: vermerk.abbruch ?? null,
      modell: vermerk.messung?.modell ?? null,
      kostenUsd: vermerk.messung?.kostenUsd ?? null,
      messung: vermerk.messung,
    })
    .onConflictDoNothing()
    .returning({ id: leserLaeufe.id });

  return geschrieben.length > 0;
}

/** Was ein Lauf des Abschreibers vor seinem Aufruf festhält. */
export type LaufBeginn = {
  userId: string;
  materialId: string;
  art: Extract<LeserLaufArt, "einordnen" | "nachlese" | "von-hand">;
  /** `lastPageAt` beim Lauf, gelesen VOR den Seiten. */
  schluessel: string;
  /** Die eigene Frist des Aufrufs — so lange gilt die Zeile als laufend. */
  fristMs: number;
};

/**
 * Legt die Zeile eines Laufs an, BEVOR er Opus ruft — `ergebnis = 'laeuft'`
 * und `frist_bis` nach der Uhr der Datenbank (warum, steht am Tabellenkommentar
 * in src/db/schema.ts). Gibt die id zurück, unter der `laufAbschliessen()` das
 * Ergebnis einträgt. Wirft, wenn die Datenbank nicht antwortet: ohne diese
 * Zeile wird nicht gerufen.
 */
export async function laufBeginnen(beginn: LaufBeginn): Promise<string> {
  const [zeile] = await db
    .insert(leserLaeufe)
    .values({
      userId: beginn.userId,
      materialId: beginn.materialId,
      examId: null,
      art: beginn.art,
      schluessel: beginn.schluessel,
      ergebnis: "laeuft",
      grund: "",
      fristBis: sql`now() + make_interval(secs => ${beginn.fristMs / 1000}::double precision)`,
    })
    .returning({ id: leserLaeufe.id });

  if (!zeile) throw new Error("Der Lauf ließ sich nicht anlegen.");
  return zeile.id;
}

/** Was nach dem Aufruf in die Zeile kommt. */
export type LaufAbschluss = {
  ergebnis: Exclude<LeserLaufErgebnis, "laeuft">;
  grund: string;
  messung: LeserLaufMessung | null;
  abbruch: LeserLaufAbbruch | null;
  /** Die Seiten, deren Abschrift durch die Tür kam. */
  abgeschrieben: readonly string[];
};

/** Ist das der Fehler „eindeutiger Index verletzt“ (23505) — auch durch drizzle gereicht? */
function eindeutigVerletzt(fehler: unknown): boolean {
  for (let f: unknown = fehler, tiefe = 0; f && tiefe < 4; tiefe += 1) {
    if ((f as { code?: unknown }).code === "23505") return true;
    f = (f as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Trägt das Ergebnis in die Zeile ein, die `laufBeginnen()` angelegt hat.
 * Falsch heißt: das Ergebnis steht nicht da — die Zeile ist weg (das Blatt
 * wurde gelöscht, und mit ihm seine Läufe), oder für diesen Stand stand schon
 * ein gemerktes Ergebnis (der eindeutige Teilindex: zwei Läufe überschnitten
 * sich). Im zweiten Fall endet die Zeile als `spaeter` ohne Abbruch, mit dem
 * Grund — sie zählt dann nirgends, und das Blatt ist durch das andere
 * Ergebnis ohnehin erledigt.
 */
export async function laufAbschliessen(id: string, abschluss: LaufAbschluss): Promise<boolean> {
  const werte = {
    ergebnis: abschluss.ergebnis,
    grund: vermerkText(abschluss.grund),
    abbruch: abschluss.abbruch,
    abgeschrieben: [...abschluss.abgeschrieben],
    modell: abschluss.messung?.modell ?? null,
    kostenUsd: abschluss.messung?.kostenUsd ?? null,
    messung: abschluss.messung,
  };
  const nurLaufend: SQL | undefined = and(eq(leserLaeufe.id, id), eq(leserLaeufe.ergebnis, "laeuft"));

  try {
    const geschrieben = await db
      .update(leserLaeufe)
      .set(werte)
      .where(nurLaufend)
      .returning({ id: leserLaeufe.id });
    return geschrieben.length > 0;
  } catch (fehler) {
    if (!eindeutigVerletzt(fehler)) throw fehler;
    await db
      .update(leserLaeufe)
      .set({
        ...werte,
        ergebnis: "spaeter",
        abbruch: null,
        grund: vermerkText(`Für diesen Stand stand schon ein Ergebnis da, dieser Lauf war doppelt (${abschluss.ergebnis}). ${abschluss.grund}`),
      })
      .where(nurLaufend);
    return false;
  }
}

/** Der Grund an der Spur eines verworfenen Vorschlags — so steht er am Blatt („Zuletzt …“). */
export const VERWORFEN_GRUND =
  "Ein Vorschlag von außen (Chat oder Postbote) wurde verworfen. Dieser Stand gilt damit als gelesen. Noch einmal lesen: „Abschreiben lassen“.";

/**
 * Vermerkt, dass ein Mensch einen Vorschlag eines Agenten verworfen hat, der
 * NICHT vom Leser der App kam — VOR dem Löschen aufgerufen, solange der
 * Vorschlag noch dasteht (`deleteProposal()` in @/lib/inbox). Gibt zurück, ob
 * eine Zeile geschrieben wurde.
 *
 * **Warum es diese Zeile gibt** (Nachprüfung vom 11.10.2026). Das Gedächtnis
 * des Lesers kennt nur seine eigenen Läufe. Ein Vorschlag aus einem Chat
 * (propose_sheet) oder einer, den der Postbote vor dem Wechsel in den Korb
 * gelegt hat, hinterließ keine Spur: solange er lag, las der Leser das Blatt
 * nicht (es hat einen Vorschlag), und sobald ein Mensch ihn verwarf, war es
 * ein Korbblatt ohne Vorschlag und ohne gemerkten Lauf — der Leser las es
 * bezahlt noch einmal, und Jev ordnete womöglich ein, was der Mensch eben
 * abgelehnt hatte. Verworfen und abgehakt las die Nachlese dieselben Seiten,
 * und die App übernahm die Abschrift ohne ihn. Beim Postboten sperrte sein
 * eigener Schlüssel `korb:` das Blatt danach; diese Zeile ist dasselbe für
 * jeden Vorschlag von außen.
 *
 * **Sie wirkt wie ein gemerktes Einordnen** (`einordnen`, `kein-vorschlag`,
 * unter dem jetzigen Stand) und trägt in `abgeschrieben` genau die Seiten,
 * zu denen der verworfene Vorschlag eine Abschrift hatte. Damit gilt die eine
 * Ausnahme des Gedächtnisses auch hier (`gedaechtnisAus()` in
 * @/lib/leser/claude-ablauf): im Korb liest der Leser das Blatt nicht mehr
 * von selbst, eingeordnet liest die Nachlese nur die Seiten, die der
 * verworfene Vorschlag NICHT abgeschrieben hatte — eine unlesbare Seite
 * bekommt ihren zweiten Versuch, eine abgelehnte Abschrift nicht. Am Blatt
 * bleibt der Knopf.
 *
 * **Steht für diesen Stand schon ein gemerktes Einordnen, wird es um diese
 * Seiten erweitert**, statt dass eine zweite Zeile entstünde — die erlaubt der
 * eindeutige Teilindex nicht. Das ist der Lauf des Lesers selbst, die Spur
 * eines früher verworfenen Vorschlags oder eine Zeile „vor dem Wechsel
 * gesehen“; ihr `abgeschrieben` heißt danach: zu diesen Seiten lag in diesem
 * Stand schon eine Abschrift vor, durch den Lauf oder durch einen verworfenen
 * Vorschlag. Bis zur zweiten Nachprüfung vom 11.10.2026 stieg diese Funktion
 * dort aus, und die Reihenfolge des Verwerfens entschied: zwei Vorschläge von
 * außen, erst der mit Seite 1 verworfen, dann der mit beiden — und die
 * Nachlese las Seite 2 bezahlt und übernahm sie ohne Menschen; ebenso nach
 * einem eigenen Lauf, der nur Seite 1 schaffte, neben einem Chat mit beiden.
 * Ergänzt wird in derselben Anweisung wie angelegt (`on conflict … do
 * update`): endet ein Lauf des Lesers gerade jetzt, gewinnt einer von beiden
 * den Platz im Teilindex, und die Seiten des Verworfenen gehen nicht verloren
 * — schreibt der Lauf als Zweiter, endet seine Zeile als „doppelt“
 * (`laufAbschliessen()`), und der Stand ist durch diese erledigt.
 *
 * **Keine Zeile**, wenn sie nichts zu sagen hätte:
 *
 * - der Vorschlag kam nicht von einem Agenten — einen von Hand (`manuell`)
 *   hat kein Leser gelesen, und einer der App (`app`) gibt es nur zu Blättern,
 *   die Docling ganz gelesen hat;
 * - er ist älter als die jüngste Seite — dann kam eine Seite nach ihm, und
 *   der jetzige Stand ist ein neuer Fall, wie bei einem eigenen Lauf;
 * - am Blatt ist keine Seite mehr ungelesen, die Claude lesen könnte;
 * - für diesen Stand steht schon eine gemerkte Nachlese oder ein gemerkter
 *   Lauf von Hand — die erledigen den Stand ganz, für jede Seite.
 *
 * Kein Aufruf, also keine Messung und keine Kosten: in der Monatssumme zählt
 * die Zeile nicht (`laufKosten()` zählt nur Zeilen mit Messung).
 */
export async function verworfenVermerken(userId: string, proposalId: string): Promise<boolean> {
  const seiteDes = (materialId: unknown) => sql`(select max(${materialPages.createdAt}) from ${materialPages} where ${materialPages.materialId} = ${materialId})`;

  const [vorschlag] = await db
    .select({
      materialId: materialProposals.materialId,
      origin: materialProposals.origin,
      schluessel: isoText(seiteDes(materialProposals.materialId)),
      juenger: sql<boolean>`${materialProposals.createdAt} > ${seiteDes(materialProposals.materialId)}`,
      fuerClaude: sql<number>`(select count(*)::int from ${materialPages} where ${materialPages.materialId} = ${materialProposals.materialId} and ${FUER_CLAUDE})`,
      abgeschrieben: sql<string[] | null>`(select jsonb_agg(${materialProposalTranscripts.pageId}::text order by ${materialProposalTranscripts.pageId}) from ${materialProposalTranscripts} where ${materialProposalTranscripts.proposalId} = ${materialProposals.id})`,
    })
    .from(materialProposals)
    .innerJoin(
      materials,
      and(eq(materials.id, materialProposals.materialId), eq(materials.userId, userId)),
    )
    .where(eq(materialProposals.id, proposalId));

  if (
    !vorschlag ||
    vorschlag.origin !== "agent" ||
    !vorschlag.juenger ||
    !vorschlag.schluessel ||
    vorschlag.fuerClaude === 0
  ) {
    return false;
  }

  const [ganz] = await db
    .select({ id: leserLaeufe.id })
    .from(leserLaeufe)
    .where(
      and(
        eq(leserLaeufe.materialId, vorschlag.materialId),
        eq(leserLaeufe.schluessel, vorschlag.schluessel),
        inArray(leserLaeufe.art, ["nachlese", "von-hand"]),
        inArray(leserLaeufe.ergebnis, ["vorschlag", "kein-vorschlag", "nichts"]),
      ),
    )
    .limit(1);
  if (ganz) return false;

  // Die Bedingung des Teilindex `leser_laeufe_gemerkt_key` (src/db/schema.ts),
  // Wort für Wort: nur so findet Postgres ihn als Ziel von `on conflict`.
  const gemerktesEinordnen = sql`${leserLaeufe.ergebnis} in ('vorschlag', 'kein-vorschlag', 'nichts') and ${leserLaeufe.art} in ('einordnen', 'nachlese')`;

  const geschrieben = await db
    .insert(leserLaeufe)
    .values({
      userId,
      materialId: vorschlag.materialId,
      examId: null,
      art: "einordnen",
      schluessel: vorschlag.schluessel,
      ergebnis: "kein-vorschlag",
      grund: VERWORFEN_GRUND,
      abgeschrieben: Array.isArray(vorschlag.abgeschrieben) ? vorschlag.abgeschrieben : [],
      messung: null,
    })
    .onConflictDoUpdate({
      target: [leserLaeufe.materialId, leserLaeufe.art, leserLaeufe.schluessel],
      targetWhere: gemerktesEinordnen,
      // Nur die Seiten kommen dazu, als Vereinigung; Ergebnis, Grund und
      // Messung der bestehenden Zeile bleiben, wie sie sind.
      set: {
        abgeschrieben: sql`(select coalesce(jsonb_agg(distinct seite order by seite), '[]'::jsonb) from jsonb_array_elements_text(coalesce(${leserLaeufe.abgeschrieben}, '[]'::jsonb) || excluded.abgeschrieben) as seite)`,
      },
    })
    .returning({ id: leserLaeufe.id });

  return geschrieben.length > 0;
}

/** Der jüngste Lauf an einem Blatt — für die Zeile „Zuletzt …“ auf der Blattseite. */
export async function letzterLauf(
  userId: string,
  materialId: string,
): Promise<(LaufZeile & { id: string }) | null> {
  const [zeile] = await db
    .select({
      id: leserLaeufe.id,
      art: leserLaeufe.art,
      ergebnis: leserLaeufe.ergebnis,
      grund: leserLaeufe.grund,
      kostenUsd: leserLaeufe.kostenUsd,
      abbruch: leserLaeufe.abbruch,
      gemessen: sql<boolean>`${leserLaeufe.messung} is not null`,
      fristRestMs: restMs(leserLaeufe.fristBis),
      createdAt: leserLaeufe.createdAt,
    })
    .from(leserLaeufe)
    .where(and(eq(leserLaeufe.userId, userId), eq(leserLaeufe.materialId, materialId)))
    .orderBy(desc(leserLaeufe.createdAt), desc(leserLaeufe.id))
    .limit(1);

  if (!zeile) return null;
  // numeric kommt je nach Treiber als Zahl oder Text an — hier wird es eine Zahl.
  return {
    ...zeile,
    gemessen: Boolean(zeile.gemessen),
    fristRestMs: zeile.fristRestMs === null ? null : Number(zeile.fristRestMs),
    kostenUsd: zeile.kostenUsd === null ? null : Number(zeile.kostenUsd),
  };
}

/**
 * Der jüngste Bau eines Arbeitsblatts — für die Zeile „Zuletzt …“ in den
 * Einstellungen unter „Handschrift abschreiben“ (ein Blatt hat keine eigene
 * Seite, an der sie stehen könnte). Dieselbe Form wie `letzterLauf()`.
 */
export async function letzterArbeitsblattLauf(
  userId: string,
): Promise<(LaufZeile & { id: string }) | null> {
  const [zeile] = await db
    .select({
      id: leserLaeufe.id,
      art: leserLaeufe.art,
      ergebnis: leserLaeufe.ergebnis,
      grund: leserLaeufe.grund,
      kostenUsd: leserLaeufe.kostenUsd,
      abbruch: leserLaeufe.abbruch,
      gemessen: sql<boolean>`${leserLaeufe.messung} is not null`,
      fristRestMs: restMs(leserLaeufe.fristBis),
      createdAt: leserLaeufe.createdAt,
    })
    .from(leserLaeufe)
    .where(and(eq(leserLaeufe.userId, userId), eq(leserLaeufe.art, "arbeitsblatt")))
    .orderBy(desc(leserLaeufe.createdAt), desc(leserLaeufe.id))
    .limit(1);

  if (!zeile) return null;
  return {
    ...zeile,
    gemessen: Boolean(zeile.gemessen),
    fristRestMs: zeile.fristRestMs === null ? null : Number(zeile.fristRestMs),
    kostenUsd: zeile.kostenUsd === null ? null : Number(zeile.kostenUsd),
  };
}

/**
 * Der jüngste Fragenlauf zu einer Klausur — für die Zeile „Zuletzt …“ auf der
 * Klausurseite des Abrufs. Dieselbe Form wie `letzterLauf()` am Blatt.
 */
export async function letzterFragenLauf(
  userId: string,
  examId: string,
): Promise<(LaufZeile & { id: string }) | null> {
  const [zeile] = await db
    .select({
      id: leserLaeufe.id,
      art: leserLaeufe.art,
      ergebnis: leserLaeufe.ergebnis,
      grund: leserLaeufe.grund,
      kostenUsd: leserLaeufe.kostenUsd,
      abbruch: leserLaeufe.abbruch,
      gemessen: sql<boolean>`${leserLaeufe.messung} is not null`,
      createdAt: leserLaeufe.createdAt,
    })
    .from(leserLaeufe)
    .where(
      and(
        eq(leserLaeufe.userId, userId),
        eq(leserLaeufe.examId, examId),
        eq(leserLaeufe.art, "fragen"),
      ),
    )
    .orderBy(desc(leserLaeufe.createdAt), desc(leserLaeufe.id))
    .limit(1);

  if (!zeile) return null;
  return {
    ...zeile,
    gemessen: Boolean(zeile.gemessen),
    fristRestMs: null,
    kostenUsd: zeile.kostenUsd === null ? null : Number(zeile.kostenUsd),
  };
}

/**
 * Was Läufe gekostet haben, so weit es bekannt ist.
 *
 * - `laeufe`: Läufe mit Antwort (und damit mit Messung), `usd` ihre Summe.
 * - `unbekannt`: davon die ohne bekannten Preis.
 * - `abgebrochen`: bezahlte Abbrüche OHNE Messung — die eigene Frist, ein
 *   Abbruch mitten im Strom, eine `laeuft`-Zeile, deren Frist um ist (ein
 *   Neustart mitten im Aufruf). Sie haben Tokens gekostet, und wie viele, weiß
 *   niemand: das SDK reicht bei einem Abbruch keine `usage` heraus.
 *
 * Ist eine der beiden letzten Zahlen größer als null, ist `usd` eine
 * Untergrenze, und das soll dastehen (`kostenSatz()` in
 * @/lib/leser/claude-ablauf). Bis zur Abnahme vom 11.10.2026 fehlten die
 * Abbrüche still — gezählt wurden nur Zeilen mit Messung, und gerade die
 * teuersten Fehlschläge hatten keine.
 */
export type LaufKosten = { laeufe: number; usd: number; unbekannt: number; abgebrochen: number };

async function laufKosten(bedingung: SQL | undefined): Promise<LaufKosten> {
  const [zeile] = await db
    .select({
      laeufe: sql<number>`(count(*) filter (where ${leserLaeufe.messung} is not null))::int`,
      usd: sql<number>`coalesce(sum(${leserLaeufe.kostenUsd}), 0)::float8`,
      unbekannt: sql<number>`(count(*) filter (where ${leserLaeufe.messung} is not null and ${leserLaeufe.kostenUsd} is null))::int`,
      abgebrochen: sql<number>`(count(*) filter (where ${leserLaeufe.messung} is null and (${leserLaeufe.abbruch} is not null or (${leserLaeufe.ergebnis} = 'laeuft' and ${leserLaeufe.fristBis} < now()))))::int`,
    })
    .from(leserLaeufe)
    .where(bedingung);

  return {
    laeufe: zeile?.laeufe ?? 0,
    usd: Number(zeile?.usd ?? 0),
    unbekannt: zeile?.unbekannt ?? 0,
    abgebrochen: zeile?.abgebrochen ?? 0,
  };
}

/** Was die Läufe dieses Nutzers seit `seit` gekostet haben — für die Einstellungen. */
export function laufKostenSeit(userId: string, seit: Date): Promise<LaufKosten> {
  return laufKosten(and(eq(leserLaeufe.userId, userId), gte(leserLaeufe.createdAt, seit)));
}

/** Was alle Läufe an einem Blatt gekostet haben — für die Blattseite. */
export function blattKosten(userId: string, materialId: string): Promise<LaufKosten> {
  return laufKosten(and(eq(leserLaeufe.userId, userId), eq(leserLaeufe.materialId, materialId)));
}

/**
 * Die Nutzer, bei denen ein Leser etwas zu tun haben könnte: eine Seite, über
 * die die App noch nicht entschieden hat, oder eine ungelesene für Claude. Für
 * den Anstoß beim Start der App (src/instrumentation.ts) — nach einem
 * Neustart weiß sonst niemand von ihnen, bis jemand fotografiert.
 */
export async function nutzerMitLeserArbeit(): Promise<string[]> {
  const zeilen = await db
    .selectDistinct({ userId: materials.userId })
    .from(materialPages)
    .innerJoin(materials, eq(materials.id, materialPages.materialId))
    .where(
      or(
        eq(materialPages.leser, "offen"),
        and(
          isNull(materialPages.transcript),
          or(eq(materialPages.leser, "claude"), isNull(materialPages.leser)),
        ),
      ),
    );

  return zeilen.map((zeile) => zeile.userId);
}
