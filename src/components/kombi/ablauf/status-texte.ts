import type { BlattStatus } from "@/lib/kombi/blaetter";

export type AnzeigeStatus = BlattStatus | "hochladen" | "haengt";

export type BlattAnzeige = {
  key: string;
  id: string | null;
  status: AnzeigeStatus;
  fach: { id: string; name: string } | null;
  titel: string;
  thema: string;
  seiten: number;
  bild: string | null;
};

const STATUS: Partial<Record<AnzeigeStatus, string>> = {
  hochladen: "Wird hochgeladen",
  einordnen: "Wird eingeordnet …",
  haengt: "Hängt, wird erneut versucht",
  im_korb: "Liegt im Eingangskorb",
};

/** Kleinbuchstaben ohne Umlaute und Akzente (Prototyp `norm`, Z. 1042). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Die drei Zeilen (Prototyp `statusTexts`, Z. 3631). */
export function statusTexts(b: Pick<BlattAnzeige, "status" | "fach" | "titel" | "thema">): [string, string, string] {
  const warte = STATUS[b.status];
  if (warte) return [warte, "", ""];
  const fach = b.fach ? b.fach.name : "Ohne Fach";
  const th = b.thema || "";
  // der Titel steht nur, wenn er mehr sagt als das Thema; sonst bleibt allein der Stand der Abschrift
  const t = b.titel && !norm(th).startsWith(norm(b.titel.split(",")[0])) ? `${b.titel.split(",")[0]} · ` : "";
  if (b.status === "abschrift_laeuft") return [fach, th, `${t}Abschrift folgt`];
  if (b.status === "abschrift_da") return [fach, th, `${t}Abschrift da`];
  if (b.status === "fehlgeschlagen") return [fach, th, `${t}Abschrift fehlgeschlagen`];
  return [fach, th, b.titel || ""];
}

/** Während dieser Stände sind „Fach ändern“ und „Seite dazu“ noch nicht da (der Platz bleibt). */
export const wartet = (s: AnzeigeStatus): boolean => s === "hochladen" || s === "einordnen" || s === "haengt";

/** Ist der Status ein Endstand? Danach fragt die Liste nicht mehr nach. */
export function blattFertig(status: AnzeigeStatus): boolean {
  return status === "abschrift_da" || status === "fehlgeschlagen" || status === "im_korb" || status === "eingeordnet";
}
