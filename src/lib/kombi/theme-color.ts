/**
 * Die Farbe der Systemleiste (Plan A; Prototyp Z. 1495–1505, V2 11.3).
 *
 * Papier, Kamera und Tisch haben je eine Farbe für hell und dunkel. Next legt
 * zwei `meta[name=theme-color]` an (mit `media` je Schema, aus `viewport` im
 * Root-Layout). Hier werden **beide** auf die Farbe der Ebene gestellt, die
 * gerade oben liegt; so zählt auch ein `data-theme`-Prüfschalter, und ein
 * Wechsel des Schemas bei offener App greift ohne Neuladen.
 *
 * Next kann das Tag bei einer Navigation neu schreiben — deshalb nach jedem
 * `popPage` und `closeTisch` erneut `themeColor()` rufen (Plan 6, Risiken).
 */

export type ThemeArt = "paper" | "camera" | "table";

export const TC: Record<ThemeArt, readonly [hell: string, dunkel: string]> = {
  paper: ["#F7F7F5", "#141416"],
  camera: ["#0B0B0C", "#0B0B0C"],
  table: ["#2A44C0", "#121A4E"],
};

let art: ThemeArt = "paper";
let timer: ReturnType<typeof setTimeout> | undefined;
let dark: MediaQueryList | null = null;

export function isDark(): boolean {
  const f = document.documentElement.dataset.theme;
  if (f === "dark" || f === "light") return f === "dark";
  dark ??= window.matchMedia("(prefers-color-scheme: dark)");
  return dark.matches;
}

function anwenden(): void {
  const farbe = TC[art][isDark() ? 1 : 0];
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((m) => {
      if (m.content !== farbe) m.content = farbe;
    });
}

/** Setzt die Farbe der Systemleiste, auf Wunsch verzögert (Kamera: 200 ms). */
export function themeColor(neu: ThemeArt, delay = 0): void {
  clearTimeout(timer);
  art = neu;
  if (delay) timer = setTimeout(anwenden, delay);
  else anwenden();
}

/** Die zuletzt gesetzte Art, etwa zum Wiederherstellen. */
export const themeArt = (): ThemeArt => art;

/**
 * Einmal beim Start: reagiert auf einen Wechsel des Schemas am Handy — und
 * darauf, dass Next die Tags nach einer Navigation neu in den <head> legt
 * (dann mit den Werten aus `viewport`, also wieder Papier je Schema).
 */
export function themeColorBeobachten(): () => void {
  dark ??= window.matchMedia("(prefers-color-scheme: dark)");
  const neu = () => anwenden();
  dark.addEventListener("change", neu);
  const mo = new MutationObserver((eintraege) => {
    const betrifft = eintraege.some((e) =>
      [e.target, ...Array.from(e.addedNodes)].some(
        (n) => n instanceof HTMLMetaElement && n.name === "theme-color",
      ),
    );
    if (betrifft) anwenden();
  });
  mo.observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["content"],
  });
  anwenden();
  return () => {
    dark?.removeEventListener("change", neu);
    mo.disconnect();
  };
}
