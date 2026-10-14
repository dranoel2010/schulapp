import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { leserLaeufe, materialPages, materials } from "@/db/schema";
import { markFiled } from "@/lib/inbox";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { addPage, createMaterialWithPage, defaultMaterialTitle, getMaterial, type NewPage } from "@/lib/materials";
import { BLATT_VOLL, MAX_PAGES } from "@/lib/images";
import { protokollieren } from "@/lib/protokoll";
import { listSubjects } from "@/lib/subjects";
import { ensurePeriods, lessonsForWeekday, weekdayOf } from "@/lib/timetable";
import { timeInBerlin } from "@/lib/dates";
import { eindeutigVerletzt } from "@/lib/leser/laeufe";

/**
 * Ein Blatt ohne Fachwahl ablegen (Modell 23, Plan 3.8). `materials.subject_id`
 * bleibt NOT NULL: das Blatt bekommt ein **vorläufiges** Fach, die Oberfläche
 * zeigt es aber erst, wenn `filed_at` gesetzt ist — bis dahin steht dort
 * „Wird eingeordnet …“. Das richtige Fach bestimmt Jev.
 *
 * Vorläufig ist, in dieser Reihenfolge: das Fach der Stunde, die gerade läuft;
 * sonst die letzte Stunde des Tages, die schon begonnen hat; sonst das Fach
 * des zuletzt abgelegten Blatts; sonst das erste aktive Fach. Abgewählte
 * Fächer nie.
 */
export async function vorlaeufigesFach(userId: string, now: Date): Promise<string | null> {
  const aktiv = await listSubjects(userId);
  if (aktiv.length === 0) return null;
  const istAktiv = (id: string) => aktiv.some((s) => s.id === id);

  const tag = appTagVon(now);
  const wd = weekdayOf(tag);
  if (wd >= 1 && wd <= 5) {
    const [stunden, raster] = await Promise.all([lessonsForWeekday(userId, wd), ensurePeriods(userId)]);
    const uhr = timeInBerlin(now);
    let letzte: string | null = null;
    for (const l of stunden) {
      if (!istAktiv(l.subjectId)) continue;
      const p = raster.find((r) => r.number === l.period);
      if (!p) continue;
      if (p.startsAt <= uhr && uhr < p.endsAt) return l.subjectId;
      if (p.startsAt <= uhr) letzte = l.subjectId;
    }
    if (letzte) return letzte;
  }

  const [zuletzt] = await db
    .select({ subjectId: materials.subjectId })
    .from(materials)
    .where(eq(materials.userId, userId))
    .orderBy(desc(materials.createdAt))
    .limit(1);
  if (zuletzt && istAktiv(zuletzt.subjectId)) return zuletzt.subjectId;
  return aktiv[0].id;
}

/**
 * `wiederholt`: diese Seite war schon angekommen, nichts wurde neu angelegt.
 * `voll`: das Blatt hat schon `MAX_PAGES` Seiten; die Kamera legt die Seite
 * dann als neues Blatt ab, statt sie zu verwerfen.
 */
export type AblageErgebnis =
  | { ok: true; id: string; wiederholt?: boolean }
  | { ok: false; status: number; message: string; voll?: boolean };

/**
 * Der Schlüssel einer Seite aus der Kamera (`material_pages.upload_key`):
 * Nutzer, uid der Aufnahme und Nummer der Seite. Ohne gültige uid oder
 * Seitennummer null, dann gibt es keinen Schutz vor Wiederholungen (alte
 * Fassung der App im Cache).
 */
export function uploadSchluessel(userId: string, aufnahme: string, seite: string): string | null {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(aufnahme)) return null;
  if (!/^\d{1,2}$/.test(seite) || Number(seite) >= MAX_PAGES) return null;
  return `${userId}:${aufnahme}:${Number(seite)}`;
}

/** Das Blatt, an dem die Seite mit diesem Schlüssel schon hängt, sonst null. */
export async function blattZurAufnahme(userId: string, schluessel: string | null | undefined): Promise<string | null> {
  if (!schluessel) return null;
  const [zeile] = await db
    .select({ id: materials.id })
    .from(materialPages)
    .innerJoin(materials, and(eq(materials.id, materialPages.materialId), eq(materials.userId, userId)))
    .where(eq(materialPages.uploadKey, schluessel))
    .limit(1);
  return zeile?.id ?? null;
}

/**
 * Anlegen oder Anhängen, aber eine Seite mit demselben Schlüssel nur einmal
 * (Abnahmerunde 16): Kam sie schon an, nur die Antwort ging verloren, gibt
 * es das vorhandene Blatt zurück. Laufen beide Anfragen zugleich (der Proxy
 * gab 504, der Server schreibt noch), hält der eindeutige Index die zweite
 * auf; ihre Transaktion fällt ganz zurück, samt eines neu angelegten Blatts.
 */
async function hoechstensEinmal(
  userId: string,
  schluessel: string | null | undefined,
  f: () => Promise<AblageErgebnis>,
): Promise<AblageErgebnis> {
  const vorhanden = await blattZurAufnahme(userId, schluessel);
  if (vorhanden) return { ok: true, id: vorhanden, wiederholt: true };
  try {
    return await f();
  } catch (fehler) {
    if (!schluessel || !eindeutigVerletzt(fehler)) throw fehler;
    const id = await blattZurAufnahme(userId, schluessel);
    if (!id) throw fehler;
    return { ok: true, id, wiederholt: true };
  }
}

/**
 * Ein neues Blatt mit seiner ersten Seite; protokolliert `blatt_abgelegt`.
 * Trägt die Seite einen Schlüssel, der schon da ist: das vorhandene Blatt.
 */
export async function blattAnlegen(
  userId: string,
  now: Date,
  page: NewPage,
  { seiten = 1, ziel = "liste" }: { seiten?: number; ziel?: string } = {},
): Promise<AblageErgebnis> {
  return hoechstensEinmal(userId, page.uploadKey, () => blattNeu(userId, now, page, { seiten, ziel }));
}

async function blattNeu(userId: string, now: Date, page: NewPage, { seiten, ziel }: { seiten: number; ziel: string }): Promise<AblageErgebnis> {
  const subjectId = await vorlaeufigesFach(userId, now);
  if (!subjectId) return { ok: false, status: 409, message: "Noch kein Fach angelegt." };
  const tag = appTagVon(now);
  const id = await createMaterialWithPage(
    userId,
    { subjectId, title: defaultMaterialTitle(tag), capturedOn: tag, note: null },
    page,
  );
  await protokollieren(userId, tag, "blatt_abgelegt", id, { n: Math.max(1, Math.min(MAX_PAGES, seiten)), row: ziel });
  return { ok: true, id };
}

/**
 * Eine Seite an ein Blatt. `folge`: die zweite Seite eines eben abgelegten
 * Blatts (gehört zu `blatt_abgelegt`); sonst „Seite dazu“ mit `seite_dazu`.
 */
export async function seiteAnhaengen(
  userId: string,
  now: Date,
  materialId: string,
  page: NewPage,
  { folge = false, seiten = 1 }: { folge?: boolean; seiten?: number } = {},
): Promise<AblageErgebnis> {
  return hoechstensEinmal(userId, page.uploadKey, () => seiteDran(userId, now, materialId, page, { folge, seiten }));
}

async function seiteDran(
  userId: string,
  now: Date,
  materialId: string,
  page: NewPage,
  { folge, seiten }: { folge: boolean; seiten: number },
): Promise<AblageErgebnis> {
  const material = await getMaterial(userId, materialId);
  if (!material) return { ok: false, status: 404, message: "Dieses Blatt gibt es nicht mehr." };
  if (material.pages.length >= MAX_PAGES) {
    return { ok: false, status: 409, message: BLATT_VOLL, voll: true };
  }
  const neu = await addPage(userId, material.id, page);
  if (!neu) return { ok: false, status: 500, message: "Das Blatt konnte nicht gespeichert werden. Versuch es noch einmal." };
  if (!folge) {
    await protokollieren(userId, appTagVon(now), "seite_dazu", material.id, { n: Math.max(1, Math.min(MAX_PAGES, seiten)) });
  }
  return { ok: true, id: material.id };
}

/**
 * Testweiche `?fehler=abschrift` (nur mit `SCHULAPP_TESTUHR=1`, Plan 3.8):
 * das Blatt gilt als eingeordnet, seine Seiten als Claude-Seiten, und der
 * „letzte Lauf“ endete ohne Ergebnis. So steht die rote Zeile „Abschrift
 * fehlgeschlagen“ mit „Erneut versuchen“ ohne echten Lauf da.
 */
export async function abschriftScheitern(userId: string, materialId: string, now: Date): Promise<void> {
  if (process.env.SCHULAPP_TESTUHR !== "1") return;
  await markFiled(userId, materialId, true, now);
  await db.update(materialPages).set({ leser: "claude" }).where(eq(materialPages.materialId, materialId));
  await db.insert(leserLaeufe).values({
    userId,
    materialId,
    art: "von-hand",
    ergebnis: "nichts",
    grund: "Testweiche fehler=abschrift",
  });
}

/** Testweiche, zweiter Teil: „Erneut versuchen“ ohne Schlüssel startet einen Lauf, der 15 Minuten „läuft“. */
export async function abschriftLaufVormerken(userId: string, materialId: string): Promise<void> {
  if (process.env.SCHULAPP_TESTUHR !== "1") return;
  const [m] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
    .limit(1);
  if (!m) return;
  await db.insert(leserLaeufe).values({
    userId,
    materialId,
    art: "von-hand",
    ergebnis: "laeuft",
    grund: "Testweiche fehler=abschrift",
    fristBis: new Date(Date.now() + 15 * 60_000),
  });
}
