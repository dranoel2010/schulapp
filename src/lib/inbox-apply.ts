import {
  clearProposals,
  deleteProposal,
  markFiled,
} from "@/lib/inbox";
import {
  getMaterial,
  listMaterialTranscripts,
  setMaterialTopics,
  setMaterialTranscripts,
  updateMaterial,
  type NewPageTranscript,
} from "@/lib/materials";

/**
 * Aus einem Vorschlag wird der Bestand — die eine Stelle, die das tut.
 *
 * Bis zum 4.10.2026 stand sie in den Server Actions des Eingangskorbs. Seitdem
 * gibt es einen dritten Weg neben Formular und Knopf: Jev ordnet ein Blatt
 * selbst ein (@/lib/auto-file). Auch der muss durch dieselbe Tür, sonst ginge
 * eines Tages der eine Weg abhaken und der andere nicht. Deshalb steht sie
 * hier, ohne Next, und die Actions frischen danach nur noch auf.
 */

/** Was beim Übernehmen geschrieben wurde — die Zahlen für die Bestätigung. */
export type AppliedProposal = {
  /**
   * Alle weggeräumten Vorschläge, der übernommene eingeschlossen. Mit
   * `nurVorschlag` höchstens 1.
   */
  entfernt: number;
  /** Seiten, deren Abschrift sich wirklich geändert hat. */
  abschrift: number;
  /** Getippte Themen ohne Fachwort, die nicht angelegt wurden. */
  verworfen: number;
  /** Themen, die auf ein schon vorhandenes fielen. */
  zusammengefallen: number;
  /** Themen, die das Fach schon anders schreibt. */
  umbenannt: number;
};

/**
 * Was beim Übernehmen wirklich geschieht — einmal geschrieben, von zwei Wegen
 * benutzt.
 *
 * Die beiden Wege sind das Formular (ansehen, vielleicht ändern, dann
 * übernehmen) und der Knopf am Korb (ein Druck, so wie vorgeschlagen). Sie
 * unterscheiden sich nur darin, WOHER die Werte kommen; was danach passiert,
 * muss dasselbe sein. Stünde es zweimal da, ginge eines Tages der eine Weg
 * abhaken und der andere nicht, oder der eine räumte die übrigen Vorschläge
 * weg und der andere ließe sie liegen.
 *
 * Es gibt drei Optionen, und gesetzt werden sie nur von den Wegen ohne
 * Menschen in @/lib/auto-file. Formular und Knöpfe lassen sie weg und
 * verhalten sich wie bisher.
 *
 * - `nurUngelesene`: die Abschrift landet nur auf Seiten, die noch keine haben
 *   — geprüft im Schreiben selbst (`setMaterialTranscripts()`), nicht in einer
 *   Frage davor. Dort hat kein Mensch die Abschrift gesehen, und sie darf keine
 *   ersetzen, die inzwischen jemand bestätigt hat. Seit dem 6.10.2026 setzt
 *   sie auch das Einordnen durch Jev im Korb: an einem Blatt, dessen
 *   Druckseiten Docling schon abgeschrieben hat, ersetzte ein Vorschlag sonst
 *   still die Docling-Abschrift — zwei Leser für eine Seite, und der zweite
 *   gewänne.
 * - `nurVorschlag`: weggeräumt wird nur dieser eine Vorschlag und nicht alle
 *   des Blattes. Der Grund, alle wegzuräumen (`clearProposals()`), ist eine
 *   Entscheidung über Fach, Titel und Themen; die trifft eine reine Abschrift
 *   nicht. Ein anderer Vorschlag, der dort auf einen Menschen wartet — auch
 *   einer, der erst zwischen Prüfen und Übernehmen angelegt wurde —, bleibt
 *   deshalb stehen.
 * - `nurAbschrift`: Fach, Titel, Tag, Notiz und Themen bleiben unberührt; es
 *   wird nur die Abschrift geschrieben. Kein Mensch sieht diesen Weg, und ein
 *   Zurückschreiben aus dem eben gelesenen Stand stellte eine Änderung, die
 *   jemand dazwischen gespeichert hat, still wieder her.
 *
 * `maschinell` (die Kennzeichnung einer Docling-Abschrift) setzt dieser Weg
 * nie: was hier geschrieben wird, kommt aus einem Vorschlag, also von Claude
 * oder einem Menschen. `setMaterialTranscripts()` lässt die Kennzeichnung nur
 * stehen, wo der Text gleich bleibt; einen geänderten Text kennzeichnet sie
 * als nicht maschinell.
 */
export async function applyProposal(
  userId: string,
  materialId: string,
  werte: {
    subjectId: string;
    title: string;
    capturedOn: string;
    note: string | null;
    topics: string[];
    /**
     * Nur die Seiten, über die etwas gesagt wird — nicht alle Seiten des
     * Blattes.
     *
     * Bei den Themen IST die Menge die Aussage, deshalb ersetzt
     * `setMaterialTopics()` sie ganz. Bei der Abschrift ist jede Seite eine
     * eigene Aussage, und „zu Seite 1 sage ich nichts" heißt nicht „Seite 1 ist
     * leer": genannte Seiten werden gesetzt, ungenannte bleiben stehen. Die
     * ausführliche Begründung steht an `setMaterialTranscripts()`.
     */
    transcripts: NewPageTranscript[];
  },
  options?: {
    nurUngelesene?: boolean;
    nurVorschlag?: string;
    nurAbschrift?: boolean;
  },
): Promise<AppliedProposal | null> {
  // Ohne Themen-Schreiben gibt es nichts zu melden; die Zahlen bleiben 0.
  let verworfen = 0;
  let zusammengefallen = 0;
  let umbenannt = 0;

  if (options?.nurAbschrift) {
    // Nichts am Blatt selbst schreiben — nur nachsehen, dass es noch da ist,
    // weil `updateMaterial()` hier sonst diese Frage beantwortet hätte.
    if (!(await getMaterial(userId, materialId))) return null;
  } else {
    if (
      !(await updateMaterial(userId, materialId, {
        subjectId: werte.subjectId,
        title: werte.title,
        capturedOn: werte.capturedOn,
        note: werte.note,
      }))
    ) {
      return null;
    }

    const themen = await setMaterialTopics(userId, materialId, werte.topics);
    verworfen = themen.verworfen.length;
    zusammengefallen = themen.zusammengefallen.length;
    umbenannt = themen.umbenannt.length;
  }

  /*
   * Die Abschriften, und zwar mit einer Zählung davor.
   *
   * Gezählt werden die Seiten, an denen sich der Text WIRKLICH ändert, und
   * nicht die, die geschrieben werden. Der Unterschied ist auf dem Bildschirm
   * zu sehen: das Formular schickt jede Seite mit, auch die unberührten, weil
   * geschrieben wird, was im Feld steht. Ohne diesen Vergleich stünde im Korb
   * „die Abschrift von 4 Seiten ist mit übernommen“, wenn der Vorschlag nur
   * eine einzige angefasst hat — eine Zahl, die stimmt und trotzdem die
   * Unwahrheit sagt.
   *
   * Gelesen wird nur, wenn überhaupt eine Abschrift im Spiel ist. Ein
   * gewöhnliches Übernehmen ohne Abschrift kostet damit keine Abfrage mehr als
   * vorher.
   */
  let abschrift = 0;

  if (werte.transcripts.length > 0) {
    const vorher = new Map(
      (await listMaterialTranscripts(userId, materialId)).map(
        (page) => [page.pageId, page.transcript] as const,
      ),
    );

    const geaendert = werte.transcripts.filter(
      // `undefined` steht für eine Seite, die es nicht mehr gibt — der
      // Vergleich gegen einen String ist dann „anders“.
      (entry) => entry.text !== vorher.get(entry.pageId),
    ).length;

    const geschrieben = await setMaterialTranscripts(
      userId,
      materialId,
      werte.transcripts,
      { nurUngelesene: options?.nurUngelesene },
    );

    // Wird zwischen dem Lesen und dem Schreiben eine Seite gelöscht, kommt sie
    // in `geschrieben` nicht mehr vor — ebenso eine, die mit `nurUngelesene`
    // inzwischen schon eine Abschrift hatte. Der Deckel sorgt dafür, dass der
    // Korb hinterher keine Seite mehr nennt, als wirklich beschrieben wurde.
    abschrift = Math.min(geaendert, geschrieben);
  }

  const entfernt =
    options?.nurVorschlag !== undefined
      ? (await deleteProposal(userId, options.nurVorschlag))
        ? 1
        : 0
      : await clearProposals(userId, materialId);

  // Erst ganz zum Schluss abhaken. Ein schon gesetzter Zeitpunkt bleibt dabei
  // stehen — `markFiled()` fasst ihn nicht noch einmal an, damit „wann hat ein
  // Mensch hingesehen?“ eine Antwort behält.
  await markFiled(userId, materialId, true);

  return {
    entfernt,
    abschrift,
    verworfen,
    zusammengefallen,
    umbenannt,
  };
}
