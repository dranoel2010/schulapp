/**
 * Die Worte des Tischs über einem Blatt (Prototyp Z. 4427 und 4491): das
 * Zählwort unter dem Kopf und der Knopf zum Drucken. Beim Lernblock
 * „Probeklausur“ sagen beide „Probeklausur“ statt „Arbeitsblatt“
 * (Antwort vom 14.10.2026), das Zählwort nur die Dauer wie eine Klausur.
 */

type BlattFuerText = {
  probe: boolean;
  inhalt: { aufgaben: readonly unknown[]; minuten: number } | null;
};

export function blattArtWort(stand: { probe: boolean }): "Probeklausur" | "Arbeitsblatt" {
  return stand.probe ? "Probeklausur" : "Arbeitsblatt";
}

/** „Arbeitsblatt · 6 Aufgaben, etwa 25 Minuten“, „Probeklausur · 45 Minuten“, nach dem Druck „… · gedruckt um 16:40“. */
export function blattZaehlerText(stand: BlattFuerText, gedrucktUm: string | null, bewerten: boolean): string {
  const art = blattArtWort(stand);
  if (!stand.inhalt) return art;
  if (bewerten && gedrucktUm) return `${art} · gedruckt um ${gedrucktUm}`;
  if (stand.probe) return `${art} · ${stand.inhalt.minuten} Minuten`;
  return `${art} · ${stand.inhalt.aufgaben.length} Aufgaben, etwa ${stand.inhalt.minuten} Minuten`;
}

/** „Arbeitsblatt drucken“ oder „Probeklausur drucken“ */
export function blattDruckenText(stand: { probe: boolean }): string {
  return `${blattArtWort(stand)} drucken`;
}
