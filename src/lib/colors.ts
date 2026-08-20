/**
 * Farben für Fächer. Bewusst als Hex-Werte statt als Tailwind-Klassen, damit
 * sie zur Laufzeit frei kombiniert werden können — Stundenplan-Kacheln,
 * Notenbalken und Klausur-Countdown greifen auf dieselbe Palette zu.
 *
 * In Komponenten am besten als CSS-Variable setzen:
 *   style={{ "--subject": color.hex } as React.CSSProperties}
 * und dann mit color-mix() abtönen, das funktioniert in hell und dunkel.
 */
export const SUBJECT_COLORS = [
  { key: "slate", label: "Grau", hex: "#64748b" },
  { key: "red", label: "Rot", hex: "#ef4444" },
  { key: "orange", label: "Orange", hex: "#f97316" },
  { key: "amber", label: "Gelb", hex: "#f59e0b" },
  { key: "green", label: "Grün", hex: "#22c55e" },
  { key: "teal", label: "Türkis", hex: "#14b8a6" },
  { key: "blue", label: "Blau", hex: "#3b82f6" },
  { key: "indigo", label: "Indigo", hex: "#6366f1" },
  { key: "violet", label: "Violett", hex: "#8b5cf6" },
  { key: "pink", label: "Pink", hex: "#ec4899" },
] as const;

export type SubjectColor = (typeof SUBJECT_COLORS)[number];
export type SubjectColorKey = SubjectColor["key"];

export const SUBJECT_COLOR_KEYS = SUBJECT_COLORS.map((c) => c.key) as [
  SubjectColorKey,
  ...SubjectColorKey[],
];

const FALLBACK = SUBJECT_COLORS[0];

/** Findet eine Farbe anhand ihres Schlüssels, mit Rückfall auf Grau. */
export function subjectColor(key: string | null | undefined): SubjectColor {
  return SUBJECT_COLORS.find((c) => c.key === key) ?? FALLBACK;
}
