import { cookies } from "next/headers";

import { berlinZeitpunkt } from "./blaetter";

/**
 * Die Uhr für den Ablauf: `new Date()`. Nur mit `SCHULAPP_TESTUHR=1` (auf dem
 * NAS nie gesetzt) gilt der Zeitpunkt aus dem Cookie `testuhr`
 * („2026-10-12T13:11“, Berliner Zeit), wie es Plan 3.1 für `jetzt()` vorsieht.
 *
 * Abschnitt B baut `jetzt()` in src/lib/tag.ts samt `/api/testuhr`; beim
 * Zusammenführen ruft diese Datei nur noch dorthin weiter.
 */
export async function jetztFuerAblauf(): Promise<Date> {
  if (process.env.SCHULAPP_TESTUHR !== "1") return new Date();
  const wert = (await cookies()).get("testuhr")?.value;
  if (!wert) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(decodeURIComponent(wert));
  if (!m) return new Date();
  return berlinZeitpunkt(`${m[1]}-${m[2]}-${m[3]}`, Number(m[4]), Number(m[5]));
}
