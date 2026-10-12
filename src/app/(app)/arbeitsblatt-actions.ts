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
  themaGehoert,
  vorhandenesBlatt,
  type Auswertung,
  type BlattStand,
} from "@/lib/arbeitsblatt/ablauf";
import { blattAnstossen } from "@/lib/arbeitsblatt/bauen";
import { gedrucktSetzen, wertungSetzen } from "@/lib/arbeitsblatt/stand";
import { requireUser } from "@/lib/auth";
import { claudeDeps } from "@/lib/leser/claude-leser";
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

/** Ist Claude eingerichtet? Ohne Schlüssel entsteht kein neues Blatt. */
const mitSchluessel = () => claudeDeps(undefined).konfiguriert;

/**
 * Ohne Schlüssel baut niemand: nicht nachfragen (sonst fragt „wartet“ alle
 * 3 s für immer) und nichts anstoßen.
 */
function ohneSchluessel(stand: BlattStand | null): BlattStand | null {
  if (!stand || mitSchluessel()) return stand;
  return { ...stand, weiter: false, bauBar: false };
}

/** Baut im Hintergrund, wenn ein Bau starten darf. */
function anstossenWennNoetig(userId: string, stand: BlattStand | null) {
  if (stand?.bauBar) after(() => blattAnstossen(userId, stand.id));
}

/**
 * Das Blatt für ein Übungsthema (Wiederholen) oder einen Lernblock — angelegt
 * und angestoßen, falls nötig. `null` heißt: kein Arbeitsblatt, es läuft mit
 * Karten — beim Block, wenn er kein Arbeitsblatt ist; ohne Schlüssel, wenn
 * es noch kein fertiges Blatt gibt (dann wird keins angelegt).
 */
export async function blattOeffnenAction(
  ziel: { thema: string } | { block: string },
): Promise<ArbeitsblattAntwort<BlattStand | null>> {
  const user = await requireUser();
  const now = new Date();
  try {
    const tag = appTagVon(now);
    const z: { thema: string } | { block: string } =
      "thema" in ziel ? { thema: id.parse(ziel.thema) } : { block: id.parse(ziel.block) };
    if ("thema" in z && !(await themaGehoert(user.id, z.thema))) return fehler("Thema nicht gefunden");
    if (!mitSchluessel()) {
      const zeile = await vorhandenesBlatt(user.id, z, tag);
      const stand = zeile ? ohneSchluessel(await blattStand(user.id, zeile.id, now)) : null;
      return { ok: true, daten: stand?.inhalt ? stand : null };
    }
    const zeileId =
      "thema" in z
        ? (await blattFuerThema(user.id, z.thema, tag)).id
        : ((await blattFuerBlock(user.id, z.block))?.id ?? null);
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
  const stand = ohneSchluessel(await blattStand(user.id, id.parse(blattId), new Date()));
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
 * Bis Abschnitt E den Tisch mit allen Themen bringt: das Blatt des ersten
 * fälligen Übungsthemas von heute, das schon einen Inhalt hat (fertig oder
 * schon gedruckt) — oder null, dann laufen die Karten in der alten Sitzung.
 *
 * Ein Thema, dessen Blatt noch gebaut wird, fällt hier durch (Befund der
 * Abnahme: „Wiederholen“ blieb sonst an „Das Blatt wird gerade gebaut.“
 * hängen, ohne Weg zu den Karten); sein Bau wird dabei angestoßen. Ohne
 * Schlüssel wird kein Blatt angelegt.
 *
 * `ohne`: ein Thema, das gerade auf dem Tisch lag (für „Weiter mit …“).
 */
export async function naechstesUebungsthemaAction(
  ohne?: string,
): Promise<ArbeitsblattAntwort<BlattStand | null>> {
  const user = await requireUser();
  const now = new Date();
  try {
    const tag = appTagVon(now);
    const schluessel = mitSchluessel();
    const nicht = ohne ? id.parse(ohne) : null;
    for (const t of await faelligeUebungsthemen(user.id, tag)) {
      if (t.topicId === nicht) continue;
      const zeile = schluessel
        ? await blattFuerThema(user.id, t.topicId, tag)
        : await vorhandenesBlatt(user.id, { thema: t.topicId }, tag);
      if (!zeile) continue;
      const stand = ohneSchluessel(await blattStand(user.id, zeile.id, now));
      if (stand?.inhalt && !stand.ausgewertetAm) return { ok: true, daten: stand };
      anstossenWennNoetig(user.id, stand);
    }
    return { ok: true, daten: null };
  } catch (error) {
    console.error("Nächstes Übungsthema", error);
    return fehler("Keine Verbindung");
  }
}
