import { jetzt } from "@/lib/tag";

/**
 * Die Uhr für den Ablauf: `jetzt()` aus src/lib/tag.ts (Plan 3.1) — ohne
 * `SCHULAPP_TESTUHR=1` (auf dem NAS nie gesetzt) einfach `new Date()`.
 */
export async function jetztFuerAblauf(): Promise<Date> {
  return jetzt();
}
