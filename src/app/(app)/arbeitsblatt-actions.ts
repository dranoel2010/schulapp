"use server";

import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { subjectTopics, subjects } from "@/db/schema";
import {
  blattAuswerten,
  blattFuerBlock,
  blattFuerThema,
  blattStand,
  faelligeUebungsthemen,
  type Auswertung,
  type BlattStand,
} from "@/lib/arbeitsblatt/ablauf";
import { blattAnstossen } from "@/lib/arbeitsblatt/bauen";
import { gedrucktSetzen, wertungSetzen } from "@/lib/arbeitsblatt/stand";
import { requireUser } from "@/lib/auth";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { themaArtSetzen, themaArtZuruecknehmen, type ArtUmstellung } from "@/lib/themen-art";

/**
 * Die Actions des Arbeitsblatts (Modell 23, Plan H). Eigene Datei neben
 * `kombi-actions.ts`, damit die Abschnitte getrennt bauen können.
 *
 * Alle prüfen `requireUser()` und validieren mit zod. Keine ruft `refresh()`
 * auf (Plan 2.4, Punkt 2): sie geben ihre neuen Daten zurück, die Shell lädt
 * gezielt nach.
 */

const id = z.uuid();

export type ArbeitsblattAntwort<T> = { ok: true; daten: T } | { ok: false; fehler: string };

const fehler = (text: string): { ok: false; fehler: string } => ({ ok: false, fehler: text });

/** Baut im Hintergrund, wenn ein Bau starten darf. */
function anstossenWennNoetig(userId: string, stand: BlattStand | null) {
  if (stand?.bauBar) after(() => blattAnstossen(userId, stand.id));
}

/**
 * Das Blatt für ein Übungsthema (Wiederholen) oder einen Lernblock — angelegt
 * und angestoßen, falls nötig. `null` beim Block heißt: der Block ist kein
 * Arbeitsblatt und läuft mit Karten.
 */
export async function blattOeffnenAction(
  ziel: { thema: string } | { block: string },
): Promise<ArbeitsblattAntwort<BlattStand | null>> {
  const user = await requireUser();
  const now = new Date();
  try {
    let zeileId: string | null;
    if ("thema" in ziel) {
      const thema = id.parse(ziel.thema);
      zeileId = (await blattFuerThema(user.id, thema, appTagVon(now))).id;
    } else {
      const block = id.parse(ziel.block);
      zeileId = (await blattFuerBlock(user.id, block))?.id ?? null;
    }
    if (!zeileId) return { ok: true, daten: null };
    const stand = await blattStand(user.id, zeileId, now);
    anstossenWennNoetig(user.id, stand);
    return { ok: true, daten: stand };
  } catch (error) {
    console.error("Arbeitsblatt öffnen", error);
    return fehler("Das Blatt ließ sich nicht öffnen.");
  }
}

/** „Arbeitsblatt drucken“: `gedruckt_am` und Protokoll `blatt_gedruckt`. */
export async function gedrucktAction(
  blattId: string,
): Promise<ArbeitsblattAntwort<{ gedrucktAm: string; protokollId: string }>> {
  const user = await requireUser();
  const now = new Date();
  try {
    const protokollId = await gedrucktSetzen(user.id, id.parse(blattId), now, appTagVon(now));
    return { ok: true, daten: { gedrucktAm: now.toISOString(), protokollId } };
  } catch (error) {
    console.error("Arbeitsblatt gedruckt", error);
    return fehler("Nicht gespeichert");
  }
}

/** Eine Zeile in „Wie lief es?“. */
export async function bewertenAction(
  blattId: string,
  nr: number,
  richtig: boolean,
): Promise<ArbeitsblattAntwort<null>> {
  const user = await requireUser();
  try {
    await wertungSetzen(user.id, id.parse(blattId), z.number().int().min(1).max(8).parse(nr), z.boolean().parse(richtig));
    return { ok: true, daten: null };
  } catch (error) {
    console.error("Arbeitsblatt werten", error);
    return fehler("Nicht gespeichert");
  }
}

/**
 * „Fertig“: erst wenn jede Aufgabe bewertet ist. Schließt die heute fälligen
 * Termine der Fragen des Themas (Frage 3, Antwort a) und, beim Blatt des
 * heutigen Lernblocks, den Block.
 */
export async function auswertenAction(
  blattId: string,
  imBlock: boolean,
): Promise<ArbeitsblattAntwort<Auswertung>> {
  const user = await requireUser();
  try {
    const a = await blattAuswerten(user.id, id.parse(blattId), new Date(), z.boolean().parse(imBlock));
    return { ok: true, daten: a };
  } catch (error) {
    console.error("Arbeitsblatt auswerten", error);
    return fehler("Nicht gespeichert");
  }
}

/** Der Stand eines Blatts — auch für das Nachfragen alle 3 s. */
export async function blattStandAction(blattId: string): Promise<ArbeitsblattAntwort<BlattStand | null>> {
  const user = await requireUser();
  const stand = await blattStand(user.id, id.parse(blattId), new Date());
  anstossenWennNoetig(user.id, stand);
  return { ok: true, daten: stand };
}

const artSchema = z.enum(["abfragen", "ueben"]);

/** Art eines Themas umstellen (Kriterium 5): Spalte und Protokoll `thema_art`. */
export async function artAction(
  topicId: string,
  art: "abfragen" | "ueben",
): Promise<ArbeitsblattAntwort<ArtUmstellung>> {
  const user = await requireUser();
  try {
    const thema = id.parse(topicId);
    const [fach] = await db
      .select({ name: subjects.name })
      .from(subjectTopics)
      .innerJoin(subjects, eq(subjects.id, subjectTopics.subjectId))
      .where(and(eq(subjectTopics.userId, user.id), eq(subjectTopics.id, thema)));
    if (!fach) return fehler("Thema nicht gefunden");
    const umstellung = await themaArtSetzen(user.id, thema, artSchema.parse(art), appTagVon(new Date()), fach);
    return { ok: true, daten: umstellung };
  } catch (error) {
    console.error("Art umstellen", error);
    return fehler("Nicht gespeichert");
  }
}

/** Rückgängig: alter Wert zurück, Protokolleintrag weg. */
export async function artZuruecknehmenAction(
  topicId: string,
  umstellung: ArtUmstellung,
): Promise<ArbeitsblattAntwort<null>> {
  const user = await requireUser();
  try {
    const thema = id.parse(topicId);
    const vorher = z.enum(["abfragen", "ueben"]).nullable().parse(umstellung.vorher);
    await themaArtZuruecknehmen(user.id, thema, { vorher, protokollId: id.parse(umstellung.protokollId) });
    return { ok: true, daten: null };
  } catch (error) {
    console.error("Art zurücknehmen", error);
    return fehler("Nicht gespeichert");
  }
}

/**
 * Bis Abschnitt E den Tisch mit allen Themen bringt: das erste fällige
 * Übungsthema von heute (für „Wiederholen“ aus der Zeile) — oder null.
 */
export async function naechstesUebungsthemaAction(): Promise<ArbeitsblattAntwort<string | null>> {
  const user = await requireUser();
  const themen = await faelligeUebungsthemen(user.id, appTagVon(new Date()));
  return { ok: true, daten: themen[0]?.topicId ?? null };
}
