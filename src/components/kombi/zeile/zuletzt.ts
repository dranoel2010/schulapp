/**
 * „Zuletzt geöffnet“ im leeren Menü (Prototyp `remember`, Z. 3002): die drei
 * zuletzt geöffneten Nachschlage-Seiten, die neueste zuerst.
 *
 * Wie `ui.recent` im Prototyp lebt die Liste im Speicher der Shell; eine
 * Kopie in `sessionStorage` (nur Bequemlichkeit, darf fehlen) übersteht ein
 * Neuladen. Gemerkt wird dort, wo die Seite gezeigt wird: Seiten ohne
 * Parameter beim Wechsel der Adresse (Shell) und in `openPage`, Klausur,
 * Noten eines Fachs, Fach und Blatt mit Titel und Unterzeile aus ihren
 * Seitendaten (`ZuletztMerken` bzw. `zuletzt` der Stapelseite).
 */

export type Zuletzt = { key: string; label: string; sub: string | null; art: string; params: Record<string, string> };

const SPEICHER = "kombi-zuletzt";

/** Seiten ohne Parameter tragen ihren Namen selbst (Prototyp Z. 3095–3199). */
const FEST: Record<string, string> = {
  woche: "Woche",
  hausaufgaben: "Hausaufgaben",
  klausuren: "Klausuren",
  noten: "Noten",
  ablage: "Ablage",
  faecher: "Fächer",
  einstellungen: "Einstellungen",
  archiv: "Archiv",
};

/**
 * Bis Abschnitt G sind die Seiten noch Routen: welche Adresse welche Seite
 * ohne Parameter ist. Die Shell merkt sie bei jedem Wechsel der Adresse,
 * egal über welchen Link sie geöffnet wurde.
 */
const FEST_ROUTE: Record<string, string> = {
  "/stundenplan": "woche",
  "/hausaufgaben": "hausaufgaben",
  "/klausuren": "klausuren",
  "/noten": "noten",
  "/material": "ablage",
  "/faecher": "faecher",
  "/einstellungen": "einstellungen",
  "/archiv": "archiv",
};

/** Die Seite ohne Parameter hinter einer Adresse, sonst null. */
export function festeSeiteVon(pfad: string): string | null {
  return Object.hasOwn(FEST_ROUTE, pfad) ? FEST_ROUTE[pfad] : null;
}

/** Titel für „Zuletzt geöffnet“ wie im Prototyp (Klausur, Noten eines Fachs, Blatt, Fach). */
export const zuletztTitel = {
  klausur: (fach: string) => `Klausur ${fach}`,
  notenfach: (fach: string) => `Noten ${fach}`,
  blatt: (titel: string | null | undefined) => `Blatt »${titel || "Blatt von heute"}«`,
  fach: (fach: string) => fach,
};

let liste: Zuletzt[] | null = null;

function laden(): Zuletzt[] {
  if (liste) return liste;
  liste = [];
  try {
    const roh = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SPEICHER) : null;
    const x = roh ? (JSON.parse(roh) as unknown) : null;
    if (Array.isArray(x)) liste = x.filter((e): e is Zuletzt => !!e && typeof e.key === "string" && typeof e.label === "string").slice(0, 3);
  } catch {
    /* ohne Speicher geht es auch */
  }
  return liste;
}

export function zuletztListe(): Zuletzt[] {
  return laden();
}

/**
 * Eine geöffnete Seite merken. Ohne `angabe` nur die Seiten mit festem Namen;
 * Klausur, Noten eines Fachs, Fach und Blatt bringen Titel und Unterzeile mit.
 */
export function zuletztMerken(art: string, params: Record<string, string>, angabe?: { label: string; sub?: string | null }): void {
  const label = angabe?.label ?? FEST[art];
  if (!label) return;
  // „woche“ merkt sich ohne Tag (Prototyp: openPage('woche', {}))
  const p = art === "woche" ? {} : { ...params };
  delete (p as Record<string, string>).flash;
  const key = params.id ? `${art}:${params.id}` : art;
  liste = [{ key, label, sub: angabe?.sub ?? null, art, params: p }, ...laden().filter((r) => r.key !== key)].slice(0, 3);
  try {
    sessionStorage.setItem(SPEICHER, JSON.stringify(liste));
  } catch {
    /* ohne Speicher geht es auch */
  }
}
