"use server";

import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { homework } from "@/db/schema";
import { themenFuerFach } from "@/lib/auto-file";
import { requireUser } from "@/lib/auth";
import { requestCalendarSync } from "@/lib/calendar/sync";
import { claudeConfigured } from "@/lib/claude/client";
import { deleteHomework, getHomework, setHomeworkDone } from "@/lib/homework";
import { ablaufBeenden } from "@/lib/kombi/ablauf";
import { jetztFuerAblauf } from "@/lib/kombi/ablauf-uhr";
import { blattKurz, fachAendern, type BlattKurz } from "@/lib/kombi/blaetter";
import { abschriftLaufVormerken } from "@/lib/kombi/blatt-aufnahme";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { claudeKnopfMoeglich, claudeVonHandAnstossen, claudeVonHandVormerken } from "@/lib/leser/claude-leser";
import { letzterLauf } from "@/lib/leser/laeufe";
import { getMaterial, ownsSubject } from "@/lib/materials";
import { protokollieren, protokollLoeschen } from "@/lib/protokoll";

/**
 * Die Actions des Ablaufs nach der Schule (Modell 23, Abschnitt C).
 *
 * Keine ruft `refresh()` oder `revalidatePath()` auf (Plan 2.4, Punkt 2): sie
 * geben ihre neuen Daten zurück, die Ebene lädt gezielt nach.
 *
 * Die Aufgaben-Actions hier sind die des Ablaufs, bis Abschnitt B seine
 * gemeinsamen in `kombi-actions.ts` bringt (3.9); sie tun dasselbe:
 * schreiben, protokollieren, Kalender-Abgleich anstoßen.
 */

const id = z.uuid();

async function heute(): Promise<string> {
  return appTagVon(await jetztFuerAblauf());
}

/** Der Schritt, bei dem er gerade ist (Kriterium 5). */
export async function ablaufSchrittAction(schritt: "blaetter" | "ha"): Promise<void> {
  const user = await requireUser();
  const s = z.enum(["blaetter", "ha"]).parse(schritt);
  await protokollieren(user.id, await heute(), "ablauf_schritt", s);
}

/**
 * „Fertig“ oder „Überspringen“ (Prototyp `ablaufEnde`, Z. 2254). Aus dem
 * Menü geöffnet schreibt Überspringen nichts (Plan C); Fertig schreibt
 * `ablauf_beendet` wie sonst. Jeder Typ höchstens einmal am Tag, und ein
 * Überspringen nach einem Stand schreibt nichts mehr.
 */
export async function ablaufEndeAction(
  typ: "ablauf_beendet" | "ablauf_uebersprungen",
  ausMenu: boolean,
): Promise<{ stand: "erledigt" | "übersprungen" | null }> {
  const user = await requireUser();
  const t = z.enum(["ablauf_beendet", "ablauf_uebersprungen"]).parse(typ);
  return { stand: await ablaufBeenden(user.id, await heute(), t, z.boolean().parse(ausMenu)) };
}

/**
 * „Erneut versuchen“ nach einer gescheiterten Abschrift (Plan 3.8): stößt den
 * Leser auf dem Weg von „Abschreiben lassen“ neu an und liefert das Blatt
 * mit dem neuen Status zurück.
 */
export async function abschriftErneutAction(materialId: string): Promise<BlattKurz | null> {
  const user = await requireUser();
  const mid = id.parse(materialId);
  const material = await getMaterial(user.id, mid);
  if (!material) return null;

  if (claudeConfigured()) {
    if (claudeKnopfMoeglich(mid)) {
      const gesehen = (await letzterLauf(user.id, mid))?.id ?? null;
      claudeVonHandVormerken(user.id, mid);
      after(() => claudeVonHandAnstossen(user.id, mid, gesehen));
    }
  } else {
    await abschriftLaufVormerken(user.id, mid);
  }
  return blattKurz(user.id, mid);
}

/**
 * „Fach ändern“ in der Blattzeile (Plan 3.8): Fach und `filed_at` sofort, die
 * Themen bestimmt Jev danach für das neue Fach. Kein Protokoll.
 */
export async function fachAendernAction(materialId: string, subjectId: string): Promise<BlattKurz | null> {
  const user = await requireUser();
  const mid = id.parse(materialId);
  const sid = id.parse(subjectId);
  if (!(await fachAendern(user.id, mid, sid))) return null;
  after(async () => {
    try {
      await themenFuerFach(user.id, mid);
    } catch (fehler) {
      console.error("Themen nach Fach ändern fehlgeschlagen", fehler);
    }
  });
  return blattKurz(user.id, mid);
}

/** Abhaken oder wieder öffnen; gibt die Protokoll-ID zurück (Rückgängig). */
export async function aufgabeAbhakenAblaufAction(aufgabeId: string, erledigt: boolean): Promise<{ protokollId: string }> {
  const user = await requireUser();
  const hid = id.parse(aufgabeId);
  await setHomeworkDone(user.id, hid, erledigt);
  const protokollId = await protokollieren(user.id, await heute(), erledigt ? "aufgabe_abgehakt" : "aufgabe_geoeffnet", hid);
  requestCalendarSync(user.id);
  return { protokollId };
}

/** Rückgängig nach dem Abhaken: alter Stand und Protokoll weg. */
export async function abhakenZuruecknehmenAction(aufgabeId: string, erledigt: boolean, protokollId: string): Promise<void> {
  const user = await requireUser();
  await setHomeworkDone(user.id, id.parse(aufgabeId), erledigt);
  await protokollLoeschen(user.id, id.parse(protokollId));
  requestCalendarSync(user.id);
}

const zeileSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  title: z.string().min(1).max(120),
  details: z.string().max(2000).nullable(),
  dueDate: z.iso.date(),
  doneAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AufgabeZeileDaten = z.infer<typeof zeileSchema>;

/** Löschen; gibt die ganze Zeile zurück, damit Rückgängig sie mit alter ID wieder einsetzt (Plan 3.3). */
export async function aufgabeLoeschenAblaufAction(
  aufgabeId: string,
): Promise<{ zeile: AufgabeZeileDaten; protokollId: string } | null> {
  const user = await requireUser();
  const hid = id.parse(aufgabeId);
  const alt = await getHomework(user.id, hid);
  if (!alt) return null;
  await deleteHomework(user.id, hid);
  const protokollId = await protokollieren(user.id, await heute(), "aufgabe_geloescht", hid);
  requestCalendarSync(user.id);
  return {
    zeile: {
      id: alt.id,
      subjectId: alt.subjectId,
      title: alt.title,
      details: alt.details ?? null,
      dueDate: alt.dueDate,
      doneAt: alt.doneAt ? alt.doneAt.toISOString() : null,
      createdAt: alt.createdAt.toISOString(),
    },
    protokollId,
  };
}

/** Rückgängig nach dem Löschen: dieselbe Zeile mit alter ID, dann der Eintrag `aufgabe_geloescht` weg. */
export async function aufgabeWiederherstellenAblaufAction(zeile: AufgabeZeileDaten, protokollId: string): Promise<void> {
  const user = await requireUser();
  const z0 = zeileSchema.parse(zeile);
  if (!(await ownsSubject(user.id, z0.subjectId))) return;
  await db
    .insert(homework)
    .values({
      id: z0.id,
      userId: user.id,
      subjectId: z0.subjectId,
      title: z0.title,
      details: z0.details,
      dueDate: z0.dueDate,
      doneAt: z0.doneAt ? new Date(z0.doneAt) : null,
      createdAt: new Date(z0.createdAt),
    })
    .onConflictDoNothing();
  await protokollLoeschen(user.id, id.parse(protokollId));
  requestCalendarSync(user.id);
}
