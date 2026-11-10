/**
 * Nach einem `nas.sh hoch` kennt der Server die Server Actions des alten
 * Stands nicht mehr. Eine App, die seit vorher offen ist (PWA im
 * Hintergrund), schickt aber noch die alten Kennungen: Jeder Knopf mit einer
 * Action („Nachholen“, Abhaken …) scheitert dann still, und im Log steht
 * „Failed to find Server Action … older or newer deployment“.
 *
 * Next markiert diese Antwort mit `x-nextjs-action-not-found: 1`. Kommt sie,
 * lädt die Seite einmal neu — die Navigation geht im Service Worker
 * network-first und holt damit den neuen Stand. Höchstens einmal pro Minute,
 * damit ein echter Fehler nicht in eine Neulade-Schleife führt.
 */

const MERKER = "schulapp-neu-geladen";
let eingebaut = false;

function neuLadenErlaubt(): boolean {
  try {
    const zuletzt = Number(sessionStorage.getItem(MERKER) ?? "0");
    if (Date.now() - zuletzt < 60_000) return false;
    sessionStorage.setItem(MERKER, String(Date.now()));
  } catch {
    /* ohne sessionStorage trotzdem neu laden */
  }
  return true;
}

export function aufNeueVersionAchten() {
  if (eingebaut || typeof window === "undefined") return;
  eingebaut = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const antwort = await original(...args);
    if (antwort.headers.get("x-nextjs-action-not-found") === "1" && neuLadenErlaubt()) {
      window.location.reload();
    }
    return antwort;
  };
}
