/**
 * Läufe von Jev nach „Fach ändern“ (Plan 3.8): Solange Jev für das neue Fach
 * die Themen bestimmt, steht in der Blattzeile „Thema folgt“. Der Lauf ist
 * kurz (ein Aufruf an Jev) und lebt im Prozess, wie die Warteschlangen der
 * Leser (`globalThis`). Nach einem Neustart des Containers ist er ohnehin
 * vorbei; eine Frist schützt vor einem Lauf, der nie zurückkommt.
 */

const FRIST_MS = 3 * 60_000;

type Laeufe = Map<string, number>;
const g = globalThis as typeof globalThis & { __schulappThemenLaeufe?: Laeufe };
const laeufe: Laeufe = (g.__schulappThemenLaeufe ??= new Map());

export function themenLaufStart(materialId: string, jetzt = Date.now()): void {
  laeufe.set(materialId, jetzt);
}

export function themenLaufEnde(materialId: string): void {
  laeufe.delete(materialId);
}

export function themenLaufAktiv(materialId: string, jetzt = Date.now()): boolean {
  const seit = laeufe.get(materialId);
  if (seit === undefined) return false;
  if (jetzt - seit > FRIST_MS) {
    laeufe.delete(materialId);
    return false;
  }
  return true;
}
