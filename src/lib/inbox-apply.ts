import {
  clearProposals,
  markFiled,
} from "@/lib/inbox";
import {
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
  /** Alle weggeräumten Vorschläge, der übernommene eingeschlossen. */
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
): Promise<AppliedProposal | null> {
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

  const { verworfen, zusammengefallen, umbenannt } = await setMaterialTopics(
    userId,
    materialId,
    werte.topics,
  );

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
    );

    // Wird zwischen dem Lesen und dem Schreiben eine Seite gelöscht, kommt sie
    // in `geschrieben` nicht mehr vor. Der Deckel sorgt dafür, dass der Korb
    // hinterher keine Seite mehr nennt, als wirklich beschrieben wurde.
    abschrift = Math.min(geaendert, geschrieben);
  }

  const entfernt = await clearProposals(userId, materialId);

  // Erst ganz zum Schluss abhaken. Ein schon gesetzter Zeitpunkt bleibt dabei
  // stehen — `markFiled()` fasst ihn nicht noch einmal an, damit „wann hat ein
  // Mensch hingesehen?“ eine Antwort behält.
  await markFiled(userId, materialId, true);

  return {
    entfernt,
    abschrift,
    verworfen: verworfen.length,
    zusammengefallen: zusammengefallen.length,
    umbenannt: umbenannt.length,
  };
}
