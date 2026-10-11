import { autoFile, type AutoFileResult } from "@/lib/auto-file";
import { createProposal, proposalInputSchema, type ProposalInput } from "@/lib/inbox";
import { getMaterial } from "@/lib/materials";
import {
  abschriftenSieben,
  nurVerworfen,
  type Verworfen,
} from "@/lib/mcp/verwerfen";

/**
 * Die Tür, durch die ein Modell einen Vorschlag zu einem Blatt anlegt — für
 * den Chat (`propose_sheet` in @/lib/mcp/run) und für den Leser, mit dem die
 * App Opus selbst ruft (@/lib/claude). Eine Tür und nicht zwei (seit dem
 * 11.10.2026).
 *
 * **Der Agent schreibt nie in den Bestand.** Was ein Modell von einem Blatt
 * abliest, kommt hier als VORSCHLAG an — nie über `setMaterialTranscripts()`,
 * nie über `applyProposal()` selbst. Übernommen wird danach von `autoFile()`
 * (@/lib/auto-file) nach seinen Regeln oder von einem Menschen im Korb. Das ist
 * keine Vorsicht, sondern die Bedingung des ganzen KI-Anschlusses
 * (KONZEPT.md): wer nicht vertrauenswürdige Blätter liest und gleichzeitig
 * schreiben darf, ist über das Blatt selbst angreifbar. Dass diese Datei nur
 * über `createProposal` und `autoFile` schreibt, prüft blatt-vorschlag.test.ts
 * an ihrem Quelltext.
 *
 * **Warum die Tür hierher gezogen ist.** Bis zu diesem Tag stand sie im
 * Handler von `propose_sheet`, und der Postbote ging durch sie, weil er über
 * den Web MCP las. Ruft die App das Modell selbst, gibt es keinen MCP-Aufruf
 * mehr, durch den es gehen könnte — und eine zweite, nachgebaute Tür für den
 * Leser der App wäre genau die Stelle, an der die Regeln auseinanderlaufen:
 * eine Prüfung hier vergessen, und eine Abschrift landete auf einer
 * Docling-Seite. Jetzt rufen beide dasselbe, in derselben Reihenfolge:
 *
 * 1. **Die Seiten gegen das Blatt.** Eine Seiten-id kann von überall kommen;
 *    hier zählt nur, ob sie zu GENAU diesem Blatt dieses Nutzers gehört.
 * 2. **Ein Leser je Seite** (`abschriftenSieben()`, @/lib/mcp/verwerfen):
 *    eine Abschrift zu einer Seite, die die App selbst liest oder die schon
 *    eine Abschrift trägt, wird verworfen — die übrigen bleiben.
 * 3. **Dasselbe Schema wie das Handformular** (`proposalInputSchema`). Was hier
 *    durchkäme und dort nicht, wäre ein Vorschlag, den niemand übernehmen kann.
 * 4. **`createProposal(…, "agent")`** — Herkunft „agent“, denn der Inhalt stammt
 *    aus einem Blatt, das die App nicht geschrieben hat, gleich ob ein Chat
 *    oder der Leser der App es las.
 * 5. **`autoFile()`** gleich danach: Jev ordnet ein, oder die Abschrift
 *    nachgereichter Seiten wird übernommen; sonst bleibt der Vorschlag im Korb.
 *    Ein Fehler dabei reißt den angelegten Vorschlag nicht mit.
 *
 * **Sätze an ein Modell stehen hier nicht.** Die Tür antwortet mit einem Typ;
 * was daraus im Chat wird, schreibt @/lib/mcp/run, und was der Leser der App
 * daraus macht, schreibt er selbst. Die deutschen Sätze an das Modell im Chat
 * sind eine Sache dieser einen Tür nach draußen.
 */

/** Was ein Modell vorschlägt — in der Sprache der App, schon ohne Fachnamen. */
export type BlattVorschlagEingabe = {
  /** Das Blatt, um das es geht. */
  sheet: string;
  /** Das vorgeschlagene Fach als id — aufgelöst hat es der Aufrufer, oder `null`. */
  subjectId: string | null;
  title?: string | null;
  capturedOn?: string | null;
  note?: string | null;
  topics?: readonly string[] | null;
  /** Je Seite ein Eintrag; `page` ist die id der Seite, wie sie das Modell nennt. */
  transcripts?: readonly { page: string; text: string }[] | null;
};

/**
 * Wie die Tür antwortet.
 *
 * - `angelegt`: der Vorschlag liegt im Korb; `vorschlag` ist, was das Schema
 *   wirklich durchgelassen hat (nicht, was hereinkam), `eingeordnet` das
 *   Ergebnis von `autoFile()`.
 * - `leer`: es kam nur Verworfenes — kein Fehler, sondern das Ergebnis der
 *   Regel „ein Leser je Seite“. Nichts angelegt.
 * - `abgewiesen`: nichts angelegt, und `grund` sagt, woran es lag.
 */
export type BlattVorschlagErgebnis =
  | {
      art: "angelegt";
      id: string;
      verworfen: Verworfen[];
      vorschlag: ProposalInput;
      eingeordnet: AutoFileResult;
    }
  | { art: "leer"; verworfen: Verworfen[] }
  | { art: "abgewiesen"; grund: "kein-blatt" }
  | { art: "abgewiesen"; grund: "fremde-seiten"; seiten: string[] }
  | { art: "abgewiesen"; grund: "ungueltig"; meldungen: string[] }
  | {
      art: "abgewiesen";
      /** `createProposal()` sagte nein: Blatt weg, Fach fremd, oder eine Seite gerade gelöscht. */
      grund: "nicht-angelegt";
      mitAbschrift: boolean;
    };

/**
 * Legt einen Vorschlag zu einem Blatt an und lässt ihn gleich einordnen —
 * die eine Tür für jedes Modell. Was an jedem Schritt geprüft wird und warum,
 * steht im Kopf dieser Datei.
 */
export async function blattVorschlagen(
  userId: string,
  eingabe: BlattVorschlagEingabe,
): Promise<BlattVorschlagErgebnis> {
  const transcripts: { pageId: string; text: string }[] = [];
  const verworfen: Verworfen[] = [];

  // Die Abschriften hängen an SEITEN, und ein Modell nennt sie nur als ids.
  // Eine id kann von überall herkommen: aus einem früheren Aufruf, aus einem
  // anderen Blatt, aus dem Blatt eines anderen Nutzers. Ohne diese Prüfung
  // hinge am Vorschlag die Abschrift einer fremden Seite, und beim Übernehmen
  // schriebe ein Mensch sie in ein Blatt, das er nie gesehen hat; der
  // Fremdschlüssel allein fängt das nicht, die fremde Seite gibt es ja.
  // `getMaterial()` liefert nur Seiten, die diesem Nutzer und diesem Blatt
  // gehören. `createProposal()` stellt dieselbe Frage danach noch einmal
  // (`ownsProposedPages()`), als Sicherung der Datenschicht und mit einem
  // bloßen Nein — hier ist sie die Auskunft, WELCHE ids fremd sind.
  //
  // Nur mit Abschriften wird das Blatt nachgeschlagen: ein Vorschlag ohne —
  // der Normalfall des Handformulars und jedes älteren Clients — prüft
  // `createProposal()` gleich ohnehin.
  if (eingabe.transcripts && eingabe.transcripts.length > 0) {
    const sheet = await getMaterial(userId, eingabe.sheet);
    if (!sheet) return { art: "abgewiesen", grund: "kein-blatt" };

    const seiten = new Map(sheet.pages.map((page) => [page.id, page]));
    const fremd = eingabe.transcripts
      .map((eintrag) => eintrag.page)
      .filter((page) => !seiten.has(page));

    if (fremd.length > 0) {
      return { art: "abgewiesen", grund: "fremde-seiten", seiten: fremd };
    }

    // Ein Leser je Seite (seit dem 6.10.2026). Eine Abschrift zu einer Seite,
    // die die App selbst liest oder schon gelesen hat, oder die schon eine
    // Abschrift trägt, kommt nicht in den Vorschlag — sonst ersetzte, wer ihn
    // übernimmt, die Docling-Abschrift oder die schon bestätigte, ohne es zu
    // merken.
    //
    // VERWORFEN und nicht abgewiesen, und darauf kommt es an: ein Modell im
    // Chat sieht alle Seiten eines Blattes und schreibt gern auch die
    // Druckseiten ab. Scheiterte der ganze Aufruf daran, gingen die Seiten,
    // die wirklich ein Modell lesen sollte, mit verloren. So bleibt, was übrig
    // ist, und die Antwort sagt, was weg ist.
    //
    // Geprüft gegen den Stand von eben. Wird eine Seite in den Millisekunden
    // danach entschieden, fängt das `nurUngelesene` beim Übernehmen auf
    // (@/lib/inbox-apply): eine Abschrift landet nie auf einer Seite, die
    // schon eine hat.
    const gesiebt = abschriftenSieben(eingabe.transcripts, seiten);
    verworfen.push(...gesiebt.verworfen);

    // Draußen `page`, drinnen `pageId` — übersetzt an genau dieser Stelle.
    for (const eintrag of gesiebt.bleiben) {
      transcripts.push({ pageId: eintrag.page, text: eintrag.text });
    }
  }

  const parsed = proposalInputSchema.safeParse({
    subjectId: eingabe.subjectId,
    title: eingabe.title ?? null,
    capturedOn: eingabe.capturedOn ?? null,
    note: eingabe.note ?? null,
    topics: eingabe.topics ? [...eingabe.topics] : [],
    transcripts,
  });

  if (!parsed.success) {
    // Blieb nach dem Verwerfen nichts übrig, ist das kein Fehler des
    // Aufrufers, sondern das Ergebnis der Regel oben. Wie der leere Vorschlag
    // erkannt wird, steht an `nurVerworfen()`.
    if (nurVerworfen(parsed.error.issues, verworfen, transcripts.length)) {
      return { art: "leer", verworfen };
    }

    return {
      art: "abgewiesen",
      grund: "ungueltig",
      meldungen: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const id = await createProposal(userId, eingabe.sheet, parsed.data, "agent");
  if (!id) {
    return {
      art: "abgewiesen",
      grund: "nicht-angelegt",
      mitAbschrift: transcripts.length > 0,
    };
  }

  // Scheitert das Einordnen — kein Schlüssel, Jev nicht erreichbar, nichts
  // lesbar —, bleibt der Vorschlag im Korb. Ein Fehler hier darf den eben
  // angelegten Vorschlag nicht mitreißen.
  const eingeordnet = await autoFile(userId, id).catch(
    (error): AutoFileResult => {
      console.error("Einordnen durch Jev fehlgeschlagen", error);
      return { ok: false, grund: "Jev war nicht erreichbar." };
    },
  );

  return { art: "angelegt", id, verworfen, vorschlag: parsed.data, eingeordnet };
}
