"use client";

/**
 * Was die Zeile vom Ablauf wissen muss (Prototyp `suggestions()`, Z. 2592):
 * ob „Nach der Schule“ als Vorschlag erscheint (Schultag, nach Schulschluss,
 * Ablauf heute übersprungen und gerade nicht offen) und ob gerade Schritt
 * „Blätter“ zu sehen ist („Blatt aufnehmen“).
 *
 * Abschnitt D baut die Vorschläge der Zeile vollständig; dieser Speicher ist
 * die Stelle, an der er den Ablauf abfragt.
 */
export type AblaufZustand = {
  /** die Ansicht `ablauf` ist zu sehen */
  sichtbar: boolean;
  schritt: "blaetter" | "ha";
  /** „Nach der Schule“ gehört unter „Vorschläge“ */
  nachDerSchule: boolean;
};

let zustand: AblaufZustand = { sichtbar: false, schritt: "blaetter", nachDerSchule: false };
const hoerer = new Set<() => void>();

export const ablaufStore = {
  get: (): AblaufZustand => zustand,
  getServer: (): AblaufZustand => SERVER,
  subscribe(f: () => void): () => void {
    hoerer.add(f);
    return () => hoerer.delete(f);
  },
  setzen(teil: Partial<AblaufZustand>): void {
    const neu = { ...zustand, ...teil };
    if (neu.sichtbar === zustand.sichtbar && neu.schritt === zustand.schritt && neu.nachDerSchule === zustand.nachDerSchule) return;
    zustand = neu;
    hoerer.forEach((f) => f());
  },
};

/** „Nach der Schule“ aus der Zeile: der nächste Wechsel in den Ablauf trägt „Schließen“ statt „Überspringen“. */
let ausMenu = false;
export function ablaufAusMenuMerken(): void {
  ausMenu = true;
}
export function ablaufAusMenuNehmen(): boolean {
  const war = ausMenu;
  ausMenu = false;
  return war;
}

const SERVER: AblaufZustand = { sichtbar: false, schritt: "blaetter", nachDerSchule: false };

/**
 * Der App-Tag, den der Server zuletzt für den Ablauf genannt hat (Testuhr
 * eingeschlossen). Die Kamera schreibt ihn in jedes abgelegte Blatt: Im
 * Ablauf stehen nur die Blätter dieses Tages.
 */
let ablaufTag: string | null = null;
export function ablaufTagSetzen(tag: string): void {
  ablaufTag = tag;
}
export function ablaufTagLesen(): string | null {
  return ablaufTag;
}

