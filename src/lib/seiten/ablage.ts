import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { materials } from "@/db/schema";
import { claudeConfigured } from "@/lib/claude/client";
import { berlinDay } from "@/lib/dates";
import { countInbox } from "@/lib/inbox";
import { blattStatusVon } from "@/lib/kombi/blaetter";
import { kostenSatz, laufAnzeige } from "@/lib/leser/claude-ablauf";
import { claudeEingeplant, claudeLiestGerade } from "@/lib/leser/claude-zustand";
import { blattKosten, letzterLauf, vorschlagStand } from "@/lib/leser/laeufe";
import {
  getMaterial,
  listMaterials,
  listMaterialTranscripts,
  resolveMaterialTopic,
  type MaterialListItem,
} from "@/lib/materials";
import { listTopics } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";

/**
 * Die Seiten „Ablage“ und „Blatt“ (Prototyp Z. 3146–3174, `blattRow`
 * Z. 3242). Die Ablage behält den Filter der bisherigen Seite als Parameter
 * (`fach`, `thema`, Plan 2.2); oben steht der Eingangskorb, wenn er nicht
 * leer ist. Die Blattseite zeigt Abschrift und Original, Fach und Thema und
 * darunter die Wege, die es bisher auf der Blattseite gab (Plan 2.2, Zeile
 * `blatt`).
 */

export type BlattZeile = {
  id: string;
  titel: string;
  datum: string;
  fach: string;
  /** erstes Thema, sonst null — die Zeile zeigt dann das Fach */
  thema: string | null;
  /** Vorschau der ersten Seite */
  mini: string | null;
};

export function blattZeile(b: MaterialListItem): BlattZeile {
  return {
    id: b.id,
    titel: b.title,
    datum: b.capturedOn,
    fach: b.subject.name,
    thema: b.topics[0]?.title ?? null,
    mini: b.coverPageId ? `/api/material/${b.coverPageId}/vorschau` : null,
  };
}

/**
 * Die Blätter, deren `filed_at` leer ist. Ihr Fach ist vorläufig (geraten aus
 * der letzten Stunde): Ablage und Fachseite führen sie nicht unter einem Fach
 * (Plan 3.8), sie sind über den Eingangskorb erreichbar.
 */
export async function blaetterImKorb(userId: string): Promise<Set<string>> {
  const zeilen = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), isNull(materials.filedAt)));
  return new Set(zeilen.map((z) => z.id));
}

export type AblageDaten = {
  filter: { art: "fach" | "thema"; id: string; titel: string } | null;
  /** Mit Filter: die Themen des Fachs, an denen Blätter hängen (Themenfilter) */
  themen: { id: string; titel: string; aktiv: boolean }[];
  gruppen: { fachId: string; fach: string; blaetter: BlattZeile[] }[];
  eingang: number;
};

export async function ablageSeite(
  userId: string,
  params: Record<string, string>,
): Promise<AblageDaten> {
  const [faecher, eingang, imKorb] = await Promise.all([
    listSubjects(userId, { includeArchived: true }),
    countInbox(userId),
    // Nicht eingeordnete Blätter (Plan 3.8): ihr Fach ist geraten und wird
    // nicht gezeigt — sie stehen nur hinter „Eingangskorb · n Blätter“.
    blaetterImKorb(userId),
  ]);

  // Das Thema gewinnt, wenn beides in der Adresse steht (wie bisher).
  let filter: AblageDaten["filter"] = null;
  let liste: MaterialListItem[];
  const thema = params.thema ? await resolveMaterialTopic(userId, params.thema) : null;
  const fach = !thema && params.fach ? faecher.find((f) => f.id === params.fach) : undefined;
  if (thema) {
    filter = { art: "thema", id: thema.id, titel: thema.title };
    liste = await listMaterials(userId, { topicId: thema.id });
  } else if (fach) {
    filter = { art: "fach", id: fach.id, titel: fach.name };
    liste = await listMaterials(userId, { subjectId: fach.id });
  } else {
    liste = await listMaterials(userId);
  }

  // Gruppen in der Reihenfolge, in der ihr jüngstes Blatt kommt (Prototyp `order`)
  const gruppen: AblageDaten["gruppen"] = [];
  for (const b of liste) {
    if (imKorb.has(b.id)) continue;
    let g = gruppen.find((x) => x.fachId === b.subject.id);
    if (!g) {
      g = { fachId: b.subject.id, fach: b.subject.name, blaetter: [] };
      gruppen.push(g);
    }
    g.blaetter.push(blattZeile(b));
  }

  const fachId = thema ? thema.subjectId : fach?.id;
  const themen = fachId
    ? (await listTopics(userId, fachId))
        .filter((t) => t.materialCount > 0)
        .map((t) => ({ id: t.id, titel: t.title, aktiv: t.id === thema?.id }))
    : [];

  return { filter, themen, gruppen, eingang };
}

export type BlattDaten = {
  id: string;
  titel: string;
  fachId: string;
  fach: string;
  datum: string;
  seiten: { id: string; abschrift: string | null; maschinell: boolean }[];
  /** Abschrift da, folgt, oder der letzte Lauf ist gescheitert */
  stand: "da" | "folgt" | "fehler";
  themen: { id: string; titel: string }[];
  faecher: { id: string; name: string }[];
  /** Laufzeile (`laufAnzeige`), Kostenzeile, Zustand des Lesers */
  lauf: string | null;
  kosten: string | null;
  liestGerade: boolean;
  eingeplant: boolean;
  vorschlag: boolean;
  /** Seiten, die Claude abschreiben könnte, und ob der Knopf geht */
  fuerClaude: number;
  knopf: boolean;
  konfiguriert: boolean;
  letzterLaufId: string | null;
  /** Durchgesehen am (Berliner Tag) oder null: liegt im Eingangskorb */
  durchgesehen: string | null;
  /**
   * Solange `filed_at` leer ist, steht hier, was die Oberfläche statt des
   * Fachs zeigt (Plan 3.8): Jev ordnet gerade ein, oder das Blatt liegt im
   * Eingangskorb. Null, sobald es eingeordnet ist.
   */
  warte: "einordnen" | "im_korb" | null;
};

export async function blattSeite(
  userId: string,
  params: Record<string, string>,
): Promise<BlattDaten | null> {
  const item = await getMaterial(userId, params.id ?? "");
  if (!item) return null;

  const [wortlaut, faecher, letzter, vorschlaege, kosten, status] = await Promise.all([
    listMaterialTranscripts(userId, item.id),
    listSubjects(userId),
    letzterLauf(userId, item.id),
    vorschlagStand(userId, item.id),
    blattKosten(userId, item.id),
    item.filedAt ? null : blattStatusVon(userId, [item.id]),
  ]);
  const text = new Map(wortlaut.map((w) => [w.pageId, w] as const));

  const fuerClaude = item.pages.filter(
    (p) => p.transcriptLength === null && p.leser !== "docling" && p.leser !== "offen",
  ).length;
  const konfiguriert = claudeConfigured();
  const liestGerade = claudeLiestGerade(item.id);
  const eingeplant = !liestGerade && claudeEingeplant(item.id);
  const hatAbschrift = item.pages.some((p) => (text.get(p.id)?.transcript ?? "").trim().length > 0);
  const gescheitert =
    !!letzter &&
    !liestGerade &&
    !eingeplant &&
    (letzter.ergebnis === "nichts" || letzter.ergebnis === "spaeter" || letzter.abbruch !== null);
  const summeZeigen = kosten.laeufe + kosten.abgebrochen > 1 || kosten.abgebrochen > 0;

  return {
    id: item.id,
    titel: item.title,
    fachId: item.subject.id,
    fach: item.subject.name,
    datum: item.capturedOn,
    seiten: item.pages.map((p) => ({
      id: p.id,
      abschrift: text.get(p.id)?.transcript ?? null,
      maschinell: text.get(p.id)?.maschinell ?? false,
    })),
    stand: hatAbschrift ? "da" : gescheitert ? "fehler" : "folgt",
    themen: item.topics.map((t) => ({ id: t.id, titel: t.title })),
    faecher: (faecher.some((f) => f.id === item.subject.id) ? faecher : [item.subject, ...faecher]).map(
      (f) => ({ id: f.id, name: f.name }),
    ),
    lauf: letzter ? laufAnzeige(letzter) : null,
    kosten: summeZeigen ? `Alle Läufe an diesem Blatt: ${kostenSatz(kosten)}.` : null,
    liestGerade,
    eingeplant,
    vorschlag: vorschlaege.anzahl > 0,
    fuerClaude,
    knopf: konfiguriert && fuerClaude > 0 && vorschlaege.anzahl === 0 && !liestGerade && !eingeplant,
    konfiguriert,
    letzterLaufId: letzter?.id ?? null,
    durchgesehen: item.filedAt ? berlinDay(item.filedAt) : null,
    warte: item.filedAt ? null : status?.get(item.id) === "einordnen" ? "einordnen" : "im_korb",
  };
}
