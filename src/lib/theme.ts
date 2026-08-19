import { cookies } from "next/headers";

/**
 * Hell oder dunkel — und die Möglichkeit, es dem Gerät zu überlassen.
 *
 * Die Wahl steht in einem Cookie und nicht in der Datenbank: der Server liest
 * sie dadurch schon beim Ausliefern und schreibt sie direkt ins <html>. Käme
 * sie erst im Browser an, würde die Seite zuerst hell gezeichnet und danach
 * auf dunkel springen — ein sichtbares Zucken bei jedem Aufruf.
 *
 * Ein Cookie gilt außerdem pro Gerät, und das ist hier richtig: das Handy darf
 * abends dunkel sein, während der Laptop hell bleibt.
 */

export const THEME_COOKIE = "schulapp_theme";

/** Ein Jahr — die Wahl trifft man einmal. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemePreference = "system" | "light" | "dark";

export const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
}[] = [
  {
    value: "system",
    label: "Automatisch",
    hint: "folgt deinem Gerät",
  },
  { value: "light", label: "Hell", hint: "immer hell" },
  { value: "dark", label: "Dunkel", hint: "immer dunkel" },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Die gespeicherte Wahl. Ohne Cookie gilt "system" — so verhält sich die App
 * wie bisher, nämlich wie das Betriebssystem es vorgibt.
 */
export async function readThemePreference(): Promise<ThemePreference> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isThemePreference(value) ? value : "system";
}

/**
 * Was ins data-theme-Attribut geschrieben wird. Bei "system" bleibt es leer:
 * dann entscheidet allein die prefers-color-scheme-Regel im Stylesheet.
 */
export function themeAttribute(
  preference: ThemePreference,
): "light" | "dark" | undefined {
  return preference === "system" ? undefined : preference;
}
