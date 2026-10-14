/**
 * Die Bereiche am Rechner (desktop.html, EINBAU.md „Am Rechner“): welche
 * Seite der App in welchem Bereich steht, was links in der Liste und was
 * rechts im Detail liegt. Reine Daten ohne React, damit die Zuordnung ohne
 * Browser prüfbar ist (bereiche.test.ts). Die Seitenarten in
 * seiten/registry.tsx verweisen mit `bereich` hierher.
 *
 * Am Handy ändert diese Datei nichts: dort stapelt `openPage` wie bisher.
 */

export type Bereich = "heute" | "hausaufgaben" | "klausuren" | "woche" | "ablage" | "faecher" | "noten" | "einstellungen";

/** Die Seitenleiste in ihrer Reihenfolge; `taste` ist die Ziffer (1 bis 7). */
export const BEREICHE: readonly { key: Bereich; label: string; taste: number | null }[] = [
  { key: "heute", label: "Heute", taste: 1 },
  { key: "hausaufgaben", label: "Hausaufgaben", taste: 2 },
  { key: "klausuren", label: "Klausuren", taste: 3 },
  { key: "woche", label: "Woche", taste: 4 },
  { key: "ablage", label: "Ablage", taste: 5 },
  { key: "faecher", label: "Fächer", taste: 6 },
  { key: "noten", label: "Noten", taste: 7 },
  { key: "einstellungen", label: "Einstellungen", taste: null },
];

/**
 * Wie die Bühne steht: `heute` die Startseite, `scroll` eine Fläche über die
 * Breite (Woche), `split` Liste und Detail, `spalte` eine Seite ohne Bereich
 * als Spalte bis --col (Ablauf, Stoff und Fragen, Stundenplan bearbeiten …).
 */
export type Lage = "heute" | "scroll" | "split" | "spalte";

/**
 * Was im Detail steht:
 * - `eigen`: die Seite selbst (die Stapelseite oder die Route, um die es geht);
 * - `{ art, params }`: eine andere Seite der Registry, nachgeladen;
 * - `slot`: ein Teil rendert es selbst (etwa die Aufgabe, die keine eigene Seite hat);
 * - `null`: nichts gewählt.
 */
export type DetailAngabe = { art: string; params: Record<string, string> } | "eigen" | "slot" | null;

/** Die Liste links: die Seite selbst (`eigen`) oder eine andere Seite der Registry. */
export type ListeAngabe = { art: string; params: Record<string, string> } | "eigen" | null;

export type BereichZiel = {
  bereich: Bereich | null;
  lage: Lage;
  liste: ListeAngabe;
  /** Was in der Liste gewählt ist (id, bei den Einstellungen die Unterseite) */
  sel: string | null;
  detail: DetailAngabe;
};

/** Angabe je Seitenart der Registry (Feld `bereich`). */
export type BereichAngabe = {
  bereich: Bereich;
  /** Die Listenseite des Bereichs; fehlt sie, ist die Seite selbst eine Fläche (Woche) */
  liste?: string;
  /** Die Art ist ein Detail ihrer Liste (Klausur, Blatt, Fach, Noten eines Fachs, Archiv) */
  detail?: boolean;
  /** Welcher Parameter die Auswahl trägt (Vorgabe: `id` bei Details, `sel` bei Listen) */
  sel?: string;
};

export const BEREICH_JE_ART: Record<string, BereichAngabe> = {
  woche: { bereich: "woche" },
  hausaufgaben: { bereich: "hausaufgaben", liste: "hausaufgaben" },
  archiv: { bereich: "hausaufgaben", liste: "hausaufgaben", detail: true, sel: "" },
  klausuren: { bereich: "klausuren", liste: "klausuren" },
  klausur: { bereich: "klausuren", liste: "klausuren", detail: true },
  ablage: { bereich: "ablage", liste: "ablage" },
  blatt: { bereich: "ablage", liste: "ablage", detail: true },
  faecher: { bereich: "faecher", liste: "faecher" },
  fach: { bereich: "faecher", liste: "faecher", detail: true },
  noten: { bereich: "noten", liste: "noten" },
  notenfach: { bereich: "noten", liste: "noten", detail: true },
  einstellungen: { bereich: "einstellungen", liste: "einstellungen" },
};

/**
 * Was eine Auswahl in der Liste eines Bereichs im Detail zeigt. Die Aufgabe
 * hat keine eigene Seite (ihr Detail baut der Teil „Hausaufgaben“), die
 * Unterseiten der Einstellungen sind Routen.
 */
export function detailFuerAuswahl(bereich: Bereich, sel: string): DetailAngabe {
  switch (bereich) {
    case "klausuren":
      return { art: "klausur", params: { id: sel } };
    case "ablage":
      return { art: "blatt", params: { id: sel } };
    case "faecher":
      return { art: "fach", params: { id: sel } };
    case "noten":
      return { art: "notenfach", params: { id: sel } };
    default:
      return "slot";
  }
}

/** Wohin eine Auswahl führt (Klick, ↑/↓): eine Seite der Registry oder eine Route. */
export function auswahlZiel(bereich: Bereich, sel: string): { art: string; params: Record<string, string> } | { url: string } | null {
  switch (bereich) {
    case "klausuren":
      return { art: "klausur", params: { id: sel } };
    case "ablage":
      return { art: "blatt", params: { id: sel } };
    case "faecher":
      return { art: "fach", params: { id: sel } };
    case "noten":
      return { art: "notenfach", params: { id: sel } };
    case "hausaufgaben":
      return { art: "hausaufgaben", params: { sel } };
    case "einstellungen":
      return { url: `/einstellungen/${encodeURIComponent(sel)}` };
    default:
      return null;
  }
}

const SPALTE: BereichZiel = { bereich: null, lage: "spalte", liste: null, sel: null, detail: "eigen" };

/** Eine Seite der Registry, wie `openPage` sie öffnet. */
export function zielFuerArt(art: string, params: Record<string, string> = {}): BereichZiel {
  if (art === "heute") return { bereich: "heute", lage: "heute", liste: null, sel: null, detail: null };
  const a = Object.hasOwn(BEREICH_JE_ART, art) ? BEREICH_JE_ART[art] : undefined;
  if (!a) return SPALTE;
  if (!a.liste) return { bereich: a.bereich, lage: "scroll", liste: null, sel: null, detail: "eigen" };
  if (a.detail) {
    const schluessel = a.sel ?? "id";
    const sel = schluessel ? (params[schluessel] ?? null) : null;
    return { bereich: a.bereich, lage: "split", liste: { art: a.liste, params: {} }, sel, detail: "eigen" };
  }
  const sel = params[a.sel ?? "sel"] ?? null;
  return { bereich: a.bereich, lage: "split", liste: "eigen", sel, detail: sel ? detailFuerAuswahl(a.bereich, sel) : null };
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Liste ihres Bereichs mit der Route (Formular, Archiv, Eingangskorb, Unterseite) im Detail. */
const mitRoute = (bereich: Bereich, liste: string, sel: string | null = null): BereichZiel => ({
  bereich,
  lage: "split",
  liste: { art: liste, params: {} },
  sel,
  detail: "eigen",
});

/**
 * Eine echte Route (Direktaufruf, Link, Formular). `suche` ist der
 * Abfrageteil ohne „?“; dort steht bei Listen die Auswahl (`sel`) und bei der
 * Ablage der Filter.
 */
export function zielFuerPfad(pfad: string, suche = ""): BereichZiel {
  const s = pfad
    .split("/")
    .filter(Boolean)
    .map((x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    });
  const q = new URLSearchParams(suche);
  const params: Record<string, string> = {};
  q.forEach((v, k) => {
    params[k] = v;
  });
  const [a, b, c] = s;
  if (!a) return zielFuerArt("heute");
  switch (a) {
    case "stundenplan":
      return s.length === 1 ? zielFuerArt("woche", params) : { ...SPALTE, bereich: "woche" };
    case "hausaufgaben":
      if (s.length === 1) return zielFuerArt("hausaufgaben", params);
      return mitRoute("hausaufgaben", "hausaufgaben", b === "neu" ? null : b);
    case "archiv":
      return s.length === 1 ? zielFuerArt("archiv", params) : SPALTE;
    case "klausuren":
      if (s.length === 1) return zielFuerArt("klausuren", params);
      if (b === "neu") return mitRoute("klausuren", "klausuren");
      return mitRoute("klausuren", "klausuren", ID.test(b) ? b : null);
    case "material":
      if (s.length === 1) return zielFuerArt("ablage", params);
      if (b === "eingang") return mitRoute("ablage", "ablage");
      return mitRoute("ablage", "ablage", ID.test(b) ? b : null);
    case "faecher":
      if (s.length === 1) return zielFuerArt("faecher", params);
      return mitRoute("faecher", "faecher", ID.test(b) ? b : null);
    case "noten":
      if (s.length === 1) return zielFuerArt("noten", params);
      if (b === "fach" && c && ID.test(c)) return mitRoute("noten", "noten", c);
      return mitRoute("noten", "noten");
    case "einstellungen":
      if (s.length === 1) return zielFuerArt("einstellungen", params);
      return mitRoute("einstellungen", "einstellungen", b);
    default:
      return SPALTE;
  }
}
