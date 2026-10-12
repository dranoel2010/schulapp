/**
 * Bewegung wie im Prototyp (Modell 23, Z. 982–1050 und 1506–1564): WAAPI und
 * requestAnimationFrame, keine CSS-Transitions für Gesten, kein Framer, kein
 * React-ViewTransition. Unterbrechen heißt: aus der aktuellen Matrix neu
 * starten (`moveTo`), nicht `finish()`.
 *
 * Alles hier läuft nur im Browser; auf dem Server wird nichts davon
 * aufgerufen. Die reinen Teile (`spring`, `SPRING`, `rubber`) sind ohne DOM
 * testbar.
 */

/** Die Kurven als Tokens (V2 13.1), dieselben Werte wie `--ease-*` in globals.css. */
export const E = {
  out: "cubic-bezier(0.23,1,0.32,1)",
  drawer: "cubic-bezier(0.32,0.72,0,1)",
  io: "cubic-bezier(0.77,0,0.175,1)",
  grow: "cubic-bezier(0.6,0,0.2,1)",
  flip: "cubic-bezier(0.2,0.8,0.2,1)",
} as const;

export type Feder = { easing: string; duration: number; punkte: number };

/** Feder spring(k, c) als linear()-Kurve (14 spring() Z. 485 bis 494). */
export function spring(k: number, c: number): Feder {
  let x = 0;
  let v = 0;
  const dt = 1 / 120;
  const pts: number[] = [];
  for (let i = 0; i < 360; i++) {
    const f = -k * (x - 1) - c * v;
    v += f * dt;
    x += v * dt;
    pts.push(x);
    if (i > 10 && Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.02) break;
  }
  pts[pts.length - 1] = 1;
  return {
    easing: `linear(0, ${pts.map((p) => p.toFixed(4)).join(", ")})`,
    duration: Math.round(pts.length * dt * 1000),
    punkte: pts.length,
  };
}

/** spring(520, 42): 392 ms, 47 Stützpunkte — für alles, was nach einer Geste losgelassen wird. */
export const SPRING = spring(520, 42);

/** Die Feder als WAAPI-Optionen. */
export const springOpts = (): KeyframeAnimationOptions => ({
  easing: SPRING.easing,
  duration: SPRING.duration,
});

/** Gummiband: zieht nach, wird aber zäher (03 rubber()). */
export const rubber = (o: number, d: number, c: number): number =>
  (o * d * c) / (d + c * Math.abs(o));

let rmq: MediaQueryList | null = null;
/** prefers-reduced-motion, bei jeder Animation neu gefragt (V2 13.4). */
export function reduce(): boolean {
  if (typeof window === "undefined") return false;
  rmq ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return rmq.matches;
}

/** Aktuellen Zustand lesen, laufende Animation abbrechen, von dort zum Ziel. */
export function moveTo(
  el: HTMLElement,
  to: Partial<Record<"transform" | "opacity", string>>,
  opts: KeyframeAnimationOptions,
): Animation {
  const cs = getComputedStyle(el);
  const from: Record<string, string> = {};
  for (const k of Object.keys(to) as Array<"transform" | "opacity">) {
    from[k] = k === "transform" ? (cs.transform === "none" ? "none" : cs.transform) : cs[k];
  }
  el.getAnimations().forEach((a) => a.cancel());
  Object.assign(el.style, to);
  return el.animate([from, to as Record<string, string>], opts);
}

type MitText = HTMLElement & { _text?: string };

/** Text tauschen: 100 ms aus, 160 ms ein (16 swapText() Z. 812 bis 818). */
export function swapText(el: MitText, text: string): void {
  if (el._text === text) return;
  el._text = text;
  if (reduce() || !el.isConnected || !el.textContent) {
    el.textContent = text;
    return;
  }
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 100,
    easing: "ease-out",
    fill: "forwards",
  }).onfinish = () => {
    el.textContent = el._text ?? text;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
  };
}

/** Neue Zeile gelandet: `::before` in --mark leuchtet kurz auf (13.3 Nr. 25). */
export function flash(el: HTMLElement, pseudoElement = "::before"): void {
  el.animate(
    { opacity: [0.3, 0] },
    { duration: 650, delay: 180, easing: E.out, pseudoElement, fill: "backwards" },
  );
}

/** Die Knoten, die `flip` verfolgt (Prototyp FLIPSEL). */
export const FLIPSEL =
  ".task, .lab, .textline, .exam-row, .lb-row, .wh, .thumbs, .lesson-row, .examtoday, .subj, .item, .foot, .empty, .group";

type FlipKnoten = HTMLElement & { _noFade?: boolean };

/**
 * FLIP: was sich verschoben hat, gleitet aus der alten Lage an die neue.
 * Verschachtelte Teile rechnen relativ zum Elternteil. `mutate` ändert den
 * DOM synchron (in React: `flushSync`).
 */
export function flip(
  scope: HTMLElement,
  mutate: () => void,
  { duration = 280, easing = E.out }: { duration?: number; easing?: string } = {},
): void {
  const pick = () =>
    [...scope.querySelectorAll<FlipKnoten>(FLIPSEL)].filter((x) => x.offsetParent);
  const before = new Map(pick().map((x) => [x, x.getBoundingClientRect().top]));
  mutate();
  if (reduce()) return;
  const after = pick();
  const dmap = new Map<Element, number>();
  after.forEach((x) => {
    if (before.has(x)) dmap.set(x, before.get(x)! - x.getBoundingClientRect().top);
  });
  after.forEach((x) => {
    if (!before.has(x)) {
      const pa = x.parentElement?.closest(FLIPSEL) as FlipKnoten | null | undefined;
      if (!x._noFade && !(pa && scope.contains(pa) && !before.has(pa))) {
        x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
      }
      return;
    }
    let p = x.parentElement;
    let pd = 0;
    while (p && p !== scope) {
      if (dmap.has(p)) {
        pd = dmap.get(p)!;
        break;
      }
      p = p.parentElement;
    }
    const d = dmap.get(x)! - pd;
    if (Math.abs(d) > 0.5) {
      x.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration, easing });
    }
  });
}

/** Zwei Frames warten (Layout steht). */
export const raf2 = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Kurzes Antippen fühlbar machen. */
export const buzz = (): void => {
  try {
    navigator.vibrate?.(8);
  } catch {
    // ohne Vibration geht es auch
  }
};

/** Wartet, bis `visualViewport` zwei Frames stabil ist (Tastatur fertig). */
export function vvStable(): Promise<void> {
  return new Promise((res) => {
    const vv = window.visualViewport;
    if (!vv) return res();
    let last = vv.height;
    let same = 0;
    let n = 0;
    const tick = () => {
      n++;
      if (vv.height === last) same++;
      else {
        same = 0;
        last = vv.height;
      }
      if (same >= 2 || n > 40) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
