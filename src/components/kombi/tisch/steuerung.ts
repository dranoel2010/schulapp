"use client";

import { flushSync } from "react-dom";

import { blattHolen, blattVorwaermen, laufHolen, wiederholenHolen } from "@/components/kombi/tisch/daten";
import type { BlattImSheet, FrageKarte, ThemaKurz, ThemaLauf } from "@/components/kombi/tisch/typen";
import { whSetzen } from "@/components/kombi/tisch/wh-stand";
import { E, buzz, moveTo, reduce, rubber, springOpts, swapText, vvStable } from "@/lib/kombi/motion";
import { TAG, dm, fxTeile, tn, wd } from "@/lib/kombi/text";
import { themeColor } from "@/lib/kombi/theme-color";
import {
  fragenText,
  whLeerText,
  whText,
  whUnterzeile,
  type WhStand,
} from "@/lib/kombi/wiederholen-text";
import {
  frageZurueckziehenAction,
  themaBeendenAction,
  urteilThemaAction,
  versuchThemaAction,
  type VersuchAntwort,
} from "@/app/(app)/wiederholen-actions";

/**
 * Der Tisch beim Wiederholen (Modell 23, Plan E; Prototyp Z. 3760–4350 ohne
 * die Teile des Lernblocks). Wie im Prototyp imperativ über das DOM, mit WAAPI
 * und `requestAnimationFrame`: Kartenstapel, Antwort schreiben, Aufdecken,
 * Saß/Daneben (Knöpfe oder Wurf), Zurückziehen, Themenende mit „Weiter mit …“
 * oder „Fertig“, und der Tisch, der aus dem Knopf wächst und in ihn zurückgeht.
 *
 * Was sich gegenüber dem Prototyp ändert, ist nur die Herkunft der Daten:
 *
 * - Themen und Fragen kommen von `GET /api/wiederholen` (fälligstes Thema
 *   zuerst, `src/recall/themen.ts`), ohne Lösung (A2).
 * - **Aufdecken ohne Warten** (Plan E): die Drehung startet beim Tipp,
 *   gleichzeitig läuft `versuchThemaAction`. Am Halbdreh-Punkt (90°, Karte
 *   hochkant) wird die Rückseite gefüllt, wenn die Antwort da ist — sonst
 *   hält die Karte dort an und dreht weiter, sobald sie kommt. Scheitert die
 *   Anfrage, dreht sie zurück, und der Toast „Keine Verbindung“ bietet
 *   „Erneut“.
 * - Saß/Daneben gehen über `urteilThemaAction` an `urteilFesthalten()`; der
 *   Takt bleibt unverändert. Keine Sperre: die nächste Karte nimmt Eingaben
 *   an, während die alte noch fliegt.
 * - Der Fortsetzen-Stand steht in der Datenbank (noch fällige Fragen plus
 *   heutige Versuche), eine eigene Sitzung gibt es nicht (Plan 3.4).
 */

export type TischDeps = {
  toast: (text: string, fn?: (() => void) | null, desc?: string, label?: string) => void;
  hideToast: (keepUndo?: boolean) => void;
  closeMenu: () => void;
  closeSheet: () => void;
  sheetOffen: () => boolean;
  /** das Sheet „Blatt ansehen“ öffnen — erst mit fertigen Daten (Plan 2.4 Punkt 6 und 7) */
  blattAnsehen: (blatt: BlattImSheet) => void;
  neuLaden: () => Promise<void>;
  /**
   * Das Arbeitsblatt eines Übungsthemas (Abschnitt H): die Steuerung meldet,
   * welches Thema gerade als Blatt auf dem Tisch liegt (null: keins), React
   * füllt `#tBlatt` und `#tBFoot` mit Vorschau, „Wie lief es?“ und Knopf.
   * `beimOeffnen`: der Tisch geht gerade auf (Einblenden nach dem Wachsen).
   */
  blatt?: (t: ThemaKurz | null, beimOeffnen: boolean) => void;
  /** Die Lupe über dem Blatt: Escape schließt erst sie */
  lupeOffen?: () => boolean;
  lupeSchliessen?: () => void;
};

/** Das Ergebnis eines ausgewerteten Blatts fürs Themenende (Prototyp `endThema`, Zweig Blatt). */
export type BlattErgebnis = { n: number; richtig: number; falsch: number[]; wiederDran: string | null };

export type TischOptionen = { mode?: string; origin?: HTMLElement | null; fach?: string | null };

type Karte = HTMLDivElement & {
  _frontH?: number;
  _bound?: boolean;
  _versuch?: Promise<VersuchAntwort>;
  _geloest?: Extract<VersuchAntwort, { ok: true }> | null;
};

type Zustand = {
  offen: boolean;
  fach: string | null;
  origin: HTMLElement | null;
  themen: ThemaKurz[];
  ti: number;
  key: string | null;
  kind: "karten" | "blatt";
  fragen: Map<string, FrageKarte>;
  queue: string[];
  qi: number;
  first: Record<string, boolean>;
  again: Set<string>;
  /** saß heute, zurückgezogen oder anderswo erledigt: zählt nicht mehr als offen */
  weg: Set<string>;
  total: number;
  phase: "frage" | "loesung";
  ended: boolean;
  keepEnd: boolean;
  fertig: Set<string>;
  wiederDran: string | null;
  naechstesThema: string | null;
  laeufe: Map<string, Promise<ThemaLauf>>;
  /** heute für Karten gewählt statt Arbeitsblatt (ohne `art` zu speichern) */
  lieberAbfragen: Set<string>;
};

const SVG = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | boolean | null | undefined> & { dataset?: never };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/** Icon wie `span.ic` mit SVG (eigene Pfade, Prototyp Z. 1016–1033). */
function ic(pfad: string): HTMLSpanElement {
  const s = h("span", { class: "ic", "aria-hidden": "true" });
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", pfad);
  svg.append(p);
  s.append(svg);
  return s;
}
const EXPAND_MORE = "M6 9.5l6 6 6-6";

/** Text mit `{…}`-Formeln als Knoten, nie über innerHTML (Prototyp `fx`). */
function fxKnoten(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const t of fxTeile(text)) {
    if (t.formel) f.append(h("span", { class: `f-in${t.lead ? " lead" : ""}` }, t.text));
    else f.append(t.text);
  }
  return f;
}

/**
 * Die Drehung der Karte (`ease-flip`, 320 ms) in zwei Hälften geteilt, genau
 * an der Stelle, an der die Kurve 90° erreicht (Karte hochkant). Beide
 * Hälften zusammen laufen exakt wie die eine Kurve; dazwischen kann die Karte
 * auf die Lösung warten (Plan E, „Aufdecken ohne Warten“).
 */
const FLIP_MS = 320;
const FLIP = (() => {
  type P = [number, number];
  const P0: P = [0, 0];
  const P1: P = [0.2, 0.8];
  const P2: P = [0.2, 1];
  const P3: P = [1, 1];
  const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const y = (s: number) => 3 * (1 - s) * (1 - s) * s * P1[1] + 3 * (1 - s) * s * s * P2[1] + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (y(m) < 0.5) lo = m;
    else hi = m;
  }
  const s = lo;
  // de Casteljau: die Kurve bei s teilen
  const a = lerp(P0, P1, s);
  const b = lerp(P1, P2, s);
  const c = lerp(P2, P3, s);
  const d = lerp(a, b, s);
  const e = lerp(b, c, s);
  const m = lerp(d, e, s);
  const f = (v: number) => Number(v.toFixed(4));
  const erste = `cubic-bezier(${f(a[0] / m[0])},${f(a[1] / m[1])},${f(d[0] / m[0])},${f(d[1] / m[1])})`;
  const nx = (v: number) => (v - m[0]) / (1 - m[0]);
  const ny = (v: number) => (v - m[1]) / (1 - m[1]);
  const zweite = `cubic-bezier(${f(nx(e[0]))},${f(ny(e[1]))},${f(nx(c[0]))},${f(ny(c[1]))})`;
  const halb = m[0] * FLIP_MS;
  return { erste, zweite, halb, rest: FLIP_MS - halb };
})();

export function erzeugeTisch(tisch: HTMLElement, deps: TischDeps) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => tisch.querySelector<T>(`#${id}`)!;
  const tStack = $("tStack");
  const T: Zustand = {
    offen: false,
    fach: null,
    origin: null,
    themen: [],
    ti: 0,
    key: null,
    kind: "karten",
    fragen: new Map(),
    queue: [],
    qi: 0,
    first: {},
    again: new Set(),
    weg: new Set(),
    total: 0,
    phase: "frage",
    ended: false,
    keepEnd: false,
    fertig: new Set(),
    wiederDran: null,
    naechstesThema: null,
    laeufe: new Map(),
    lieberAbfragen: new Set(),
  };
  /** gesetzt, wenn das Blatt des aktuellen Themas ausgewertet ist */
  let blattErgebnis: BlattErgebnis | null = null;
  let oeffnetGerade = false;
  let kbInset = 0;
  let qResize: ResizeObserver | null = null;
  let oeffnet = 0;

  const valid = (id: string) => !T.weg.has(id);
  const thema = () => T.themen[T.ti];
  const istBlatt = (t: ThemaKurz | undefined) => !!t && t.art === "ueben" && !T.lieberAbfragen.has(t.key);

  // ── Karte ──────────────────────────────────────────────────────────────────

  function cardEl(q: FrageKarte, i: number): Karte {
    const ta = h("textarea", {
      rows: "1",
      placeholder: "Schreib, was du weißt.",
      "aria-label": "Deine Antwort",
      autocapitalize: "sentences",
      spellcheck: "false",
      enterkeyhint: "done",
    });
    /* das Feld selbst ist die Trefffläche (mindestens 48px) und wächst bis vier Zeilen */
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 48), 120)}px`;
    });
    ta.addEventListener("focus", () => tisch.classList.add("typing"));
    ta.addEventListener("blur", () =>
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || !tisch.contains(a) || a.tagName !== "TEXTAREA") tisch.classList.remove("typing");
      }, 0),
    );
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void reveal(false);
      }
    });
    const fieldBox = h("div", { class: "c-field" }, ta);
    fieldBox.addEventListener("click", () => ta.focus());

    const heftBtn = h("button", { class: "cb-heft", type: "button", "aria-expanded": "false" }, "Stelle im Blatt", ic(EXPAND_MORE));
    const quoteP = h("p");
    const ansehen = h("button", { type: "button" }, "Blatt ansehen");
    const quote = h("div", { class: "cb-quote", hidden: true }, quoteP, ansehen);
    const retire = h("button", { class: "cb-retire", type: "button" }, "Stand so nicht im Heft");

    const el = h(
      "div",
      { class: "sc", "data-pos": String(i), "data-id": q.itemId },
      h(
        "div",
        { class: "sc-lift" },
        h(
          "div",
          { class: "sc-flip" },
          h("div", { class: "face front" }, h("div", { class: "c-q" }, h("p", null, fxKnoten(q.frage))), fieldBox),
          h(
            "div",
            { class: "face back" },
            h(
              "div",
              { class: "c-back" },
              h("p", { class: "cb-lab" }, "Deine Antwort"),
              h("p", { class: "cb-mine" }),
              h("p", { class: "cb-lab" }, "Musterlösung"),
              h("ol", { class: "cb-sol" }),
              h("p", { class: "cb-verw" }),
              heftBtn,
              quote,
              retire,
            ),
          ),
        ),
      ),
      h("span", { class: "stamp l" }, "Daneben"),
      h("span", { class: "stamp r" }, "Saß"),
    ) as Karte;

    ansehen.addEventListener("click", () => blattOeffnen(el));
    heftBtn.addEventListener("click", () => {
      const open = quote.hidden;
      const sc = heftBtn.closest<HTMLElement>(".c-back")!;
      const below = [...sc.querySelectorAll<HTMLElement>(".cb-retire, .cb-ask")];
      const before = below.map((x) => x.getBoundingClientRect().top);
      quote.hidden = !open;
      heftBtn.setAttribute("aria-expanded", String(open));
      /* das Blatt schon holen: „Blatt ansehen“ öffnet das Sheet dann gleich mit Inhalt */
      const mid = el._geloest?.materialId;
      if (open && mid) blattVorwaermen(mid);
      fitStack({ grow: open });
      /* der aufgeklappte Teil scrollt sanft ins Bild, mit "Blatt ansehen" und "Stand so nicht im Heft" */
      if (open)
        requestAnimationFrame(() => {
          const want = retire.offsetTop + retire.offsetHeight + 14 - sc.clientHeight;
          if (want > sc.scrollTop)
            sc.scrollTo({ top: Math.min(want, heftBtn.offsetTop - 8), behavior: reduce() ? "auto" : "smooth" });
        });
      if (reduce()) return;
      if (open)
        quote.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], {
          duration: 220,
          easing: E.out,
        });
      below.forEach((x, k) => {
        const d = before[k] - x.getBoundingClientRect().top;
        if (Math.abs(d) > 0.5)
          x.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 220, easing: E.out });
      });
    });
    retire.addEventListener("click", () => askRetire(retire, q));
    const cb = el.querySelector<HTMLElement>(".c-back")!;
    cb.addEventListener("scroll", () => moreHint(cb), { passive: true });
    setCardAccess(el);
    return el;
  }

  /**
   * „Blatt ansehen“: das Sheet fährt erst mit fertigen Daten ein (vorgewärmt
   * beim Aufklappen von „Stelle im Blatt“). Scheitert der Abruf, erscheint
   * kein Sheet, sondern der Toast „Keine Verbindung“ mit „Erneut“ (Plan 2.4
   * Punkt 7).
   */
  let blattLaedt = false;
  function blattOeffnen(el: Karte) {
    const id = el._geloest?.materialId;
    if (!id || blattLaedt) return;
    blattLaedt = true;
    blattHolen(id).then(
      (b) => {
        blattLaedt = false;
        if (T.offen && topCard() === el) deps.blattAnsehen(b);
      },
      () => {
        blattLaedt = false;
        if (T.offen && topCard() === el)
          deps.toast("Keine Verbindung", () => blattOeffnen(el), "Keine Verbindung", "Erneut");
      },
    );
  }

  /** Die Rückseite füllen, sobald die Lösung vom Server da ist (A2). */
  function fillBack(el: Karte, r: Extract<VersuchAntwort, { ok: true }>) {
    el._geloest = r;
    const sol = el.querySelector(".cb-sol")!;
    sol.replaceChildren(...r.loesung.map((x) => h("li", null, h("span", null, fxKnoten(x)))));
    el.querySelector(".cb-verw")!.textContent = r.verwechslung;
    const qp = el.querySelector(".cb-quote p")!;
    qp.replaceChildren(fxKnoten(r.zitat));
    const ansehen = el.querySelector<HTMLButtonElement>(".cb-quote button")!;
    ansehen.hidden = !r.materialId;
  }

  /* Nur die oberste Karte und ihre sichtbare Seite gehören zur Antwort.
     Die Rückseiten und Reservekarten bleiben für die Bewegung im DOM. */
  function setCardAccess(el: HTMLElement) {
    const active = el.dataset.pos === "0";
    const flipped = el.classList.contains("flipped");
    el.inert = !active;
    el.setAttribute("aria-hidden", String(!active));
    for (const side of ["front", "back"]) {
      const face = el.querySelector<HTMLElement>(`.face.${side}`)!;
      const hidden = !active || (side === "back" ? !flipped : flipped);
      face.inert = hidden;
      face.setAttribute("aria-hidden", String(hidden));
    }
    el.querySelectorAll(".stamp").forEach((s) => s.setAttribute("aria-hidden", "true"));
  }

  const topCard = () => tStack.querySelector<Karte>('.sc[data-pos="0"]');

  function askRetire(btn: HTMLElement, q: FrageKarte) {
    const nx = btn.nextElementSibling;
    if (nx && nx.classList.contains("cb-ask")) return;
    const yes = h("button", { class: "yes", type: "button" }, "Zurückziehen");
    const no = h("button", { type: "button" }, "Abbrechen");
    const ask = h(
      "div",
      { class: "cb-ask", role: "group", "aria-label": "Frage zurückziehen" },
      h("p", null, "Diese Frage zurückziehen?"),
      h("div", null, no, yes),
    );
    btn.after(ask);
    if (!reduce())
      ask.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], {
        duration: 200,
        easing: E.out,
      });
    /* die Rückfrage steht ganz im Bild, nicht unter dem Verlauf der Unterkante */
    const cb = btn.closest<HTMLElement>(".c-back")!;
    requestAnimationFrame(() => cb.scrollTo({ top: cb.scrollHeight, behavior: reduce() ? "auto" : "smooth" }));
    no.addEventListener("click", () => ask.remove());
    yes.addEventListener("click", () => {
      zurueckziehen(q.itemId);
      advance("retire", 0);
    });
  }

  function zurueckziehen(itemId: string) {
    frageZurueckziehenAction(itemId).then(
      (r) => {
        if (!r.ok) deps.toast("Nicht gespeichert", () => zurueckziehen(itemId), "Nicht gespeichert", "Erneut");
      },
      () => deps.toast("Nicht gespeichert", () => zurueckziehen(itemId), "Nicht gespeichert", "Erneut"),
    );
  }

  function buildStack() {
    tStack.replaceChildren();
    for (let k = 0; k < 3; k++) {
      const id = T.queue[T.qi + k];
      if (!id) break;
      tStack.append(cardEl(T.fragen.get(id)!, k));
    }
    bindTop();
    fitStack();
  }

  /* Die Karte ist so hoch wie ihr Inhalt und steht oben: vorn Frage und Feld, hinten die Lösung.
     Die Höhe wechselt beim Umdrehen in dem Moment, in dem die Karte hochkant steht. Aufgeklappt darf sie bis zu den Knöpfen wachsen */
  function stackAvail() {
    const top = tStack.getBoundingClientRect().top;
    const foot = $("tFoot").getBoundingClientRect().top - 16;
    return Math.max(160, foot - top - 30);
  }

  function fitStack(opts: { grow?: boolean } = {}) {
    if (!T.offen || T.ended || T.kind === "blatt") return;
    const top = topCard();
    const old = tStack.offsetHeight;
    const avail = stackAvail();
    let H: number;
    if (tisch.classList.contains("typing")) H = Math.min(448, avail);
    else if (top && top.classList.contains("flipped") && top._geloest) {
      const b = top.querySelector<HTMLElement>(".c-back")!;
      const open = top.querySelector('.cb-heft[aria-expanded="true"]');
      H = Math.min(Math.max(b.scrollHeight, top._frontH || 0, 220), avail, open ? Infinity : 448);
    } else if (top && top.classList.contains("flipped")) {
      H = old;
    } else {
      let need = 0;
      if (top) {
        const q = top.querySelector<HTMLElement>(".c-q")!;
        const f = top.querySelector<HTMLElement>(".c-field")!;
        need = q.scrollHeight + f.offsetHeight + 12;
      }
      H = Math.min(Math.max(need, 200), avail, 448);
      if (top) top._frontH = H;
    }
    tStack.style.height = `${Math.round(H)}px`;
    if (opts.grow && !reduce() && top && H > old + 1) {
      /* wachsen beim Aufklappen: die Fläche öffnet nach unten, statt zu springen */
      top.querySelectorAll<HTMLElement>(".face").forEach((f) =>
        f.animate(
          [
            { clipPath: `inset(0px 0px ${H - old}px 0px round 22px)` },
            { clipPath: "inset(0px 0px 0px 0px round 22px)" },
          ],
          { duration: 240, easing: E.out },
        ),
      );
    }
    requestAnimationFrame(() => tStack.querySelectorAll<HTMLElement>(".c-back").forEach(moreHint));
  }

  function moreHint(b: HTMLElement) {
    b.classList.toggle("more", b.scrollHeight - b.scrollTop - b.clientHeight > 2);
  }

  const offenIds = () => new Set(T.queue.slice(T.qi).filter(valid));
  const doneCount = () => T.total - offenIds().size;

  function renderTicks(animate: boolean) {
    const box = $("tTicks");
    const n = T.total;
    const done = Math.max(0, doneCount());
    if (n <= 20) {
      if (box.children.length !== n || box.classList.contains("bar")) {
        box.classList.remove("bar");
        box.replaceChildren(...Array.from({ length: n }, () => h("span", { class: "tick" }, h("i"))));
      }
      [...box.children].forEach((t, i) => {
        const was = t.classList.contains("past");
        t.classList.toggle("past", i < done);
        if (animate && !was && i < done && !reduce())
          (t.firstChild as HTMLElement).animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
            duration: 300,
            easing: E.out,
          });
      });
    } else {
      if (!box.classList.contains("bar")) {
        box.classList.add("bar");
        box.replaceChildren(h("span", { class: "tick" }, h("i")));
      }
      const i = box.firstChild!.firstChild as HTMLElement;
      const to = `scaleX(${done / n})`;
      if (animate && !reduce()) moveTo(i, { transform: to }, { duration: 300, easing: E.out });
      else i.style.transform = to;
    }
    const a = T.again.size;
    const txt = `${fragenText(n)}${a ? ` · ${a} ${a === 1 ? "kommt" : "kommen"} nochmal` : ""}`;
    const c = $("tCount") as HTMLElement & { _text?: string };
    if (animate) swapText(c, txt);
    else {
      c.getAnimations().forEach((x) => x.cancel());
      c.textContent = txt;
      c._text = txt;
    }
  }

  function footState(rev: boolean) {
    const ask = $("tAsk");
    const rate = $("tRate");
    ask.inert = rev;
    rate.inert = !rev;
    ask.setAttribute("aria-hidden", String(rev));
    rate.setAttribute("aria-hidden", String(!rev));
    [ask, ...ask.children, ...rate.children].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    if (rev) {
      rate.style.visibility = "visible";
      ask.style.visibility = "hidden";
      if (reduce()) return;
      ask.style.visibility = "visible";
      ask.style.pointerEvents = "none";
      ask
        .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px)" }], {
          duration: 120,
          easing: E.out,
          fill: "forwards",
        })
        .finished.then(
          () => {
            if (T.phase === "loesung") {
              ask.style.visibility = "hidden";
              ask.getAnimations().forEach((a) => a.cancel());
            }
            ask.style.pointerEvents = "";
          },
          () => {
            ask.style.pointerEvents = "";
          },
        );
      [...rate.children].forEach((b, i) =>
        (b as HTMLElement).animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
          duration: 200,
          delay: 120 + i * 30,
          easing: E.out,
          fill: "backwards",
        }),
      );
    } else {
      rate.style.visibility = "hidden";
      ask.style.visibility = "visible";
      ask.style.pointerEvents = "";
      if (!reduce())
        ask.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
          duration: 200,
          easing: E.out,
        });
    }
  }

  // ── Aufdecken ───────────────────────────────────────────────────────────────

  /* Aufdecken: erst schließt die Tastatur, dann dreht die Karte (7.2 Nr. 46 und 47) */
  async function reveal(dunno: boolean) {
    const top = topCard();
    if (!top || T.phase !== "frage" || T.ended) return;
    const q = T.fragen.get(top.dataset.id!)!;
    const ta = top.querySelector("textarea")!;
    const text = dunno ? "" : ta.value.trim();
    T.phase = "loesung";
    const mine = top.querySelector<HTMLElement>(".cb-mine")!;
    mine.textContent = text || "Nichts geschrieben";
    mine.classList.toggle("none", !text);
    $("tMeta").classList.remove("hint");
    footState(true);
    /* der Versuch geht sofort los, die Drehung auch */
    const p = versuchThemaAction(q.scheduleId, q.itemId, text);
    p.catch(() => {});
    top._versuch = p;
    top._geloest = null;
    const hadKb = document.activeElement === ta;
    ta.blur();
    tisch.classList.remove("typing");
    if (hadKb) await vvStable();
    if (topCard() !== top || T.phase !== "loesung") return;
    drehen(top, p, dunno);
  }

  /**
   * Die Rückseite nach der Drehung einmal neu setzen. Gefüllt wird sie, wenn
   * sie hochkant steht (90°); Chrome behält die Lage der Zeilen aus diesem
   * Moment, und die zweite Lösungszeile und der Verwechslungssatz standen
   * danach um einen Gerätepixel höher als im Prototyp, der die Rückseite vor
   * der Drehung füllt (gemessen: gleiche Maße, anderes Raster; erst ein neues
   * Setzen gleicht es an). Unsichtbar, solange niemand auf der Rückseite steht.
   */
  function frischSetzen(top: Karte) {
    const back = top.querySelector<HTMLElement>(".face.back")!;
    const cb = back.querySelector<HTMLElement>(".c-back")!;
    if (back.contains(document.activeElement) || cb.scrollTop !== 0) return;
    back.style.display = "none";
    void back.offsetHeight;
    back.style.display = "";
  }

  function drehen(top: Karte, p: Promise<VersuchAntwort>, dunno: boolean) {
    const flipEl = top.querySelector<HTMLElement>(".sc-flip")!;
    const lift = top.querySelector<HTMLElement>(".sc-lift")!;
    let fertig = false;
    const zurueck = () => {
      /* ohne Netz: die Karte dreht zurück, die Frage bleibt */
      if (topCard() !== top) return;
      T.phase = "frage";
      footState(false);
      deps.toast("Keine Verbindung", () => void reveal(dunno), "Keine Verbindung", "Erneut");
    };
    if (reduce()) {
      /* reduzierte Bewegung: Überblenden, erst wenn die Lösung da ist */
      p.then(
        (r) => {
          if (topCard() !== top || T.phase !== "loesung") return;
          if (!r.ok) return advance("skip", 0);
          fillBack(top, r);
          top.classList.add("flipped");
          setCardAccess(top);
          fitStack();
        },
        zurueck,
      );
      return;
    }
    flipEl.style.transition = "none";
    top.classList.add("flipped");
    setCardAccess(top);
    /* erste Hälfte bis hochkant; die Hebung läuft über die ganze Drehung und hält mit */
    let dreh = flipEl.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }], {
      duration: FLIP.halb,
      easing: FLIP.erste,
      fill: "both",
    });
    const hebt = lift.animate(
      [{ transform: "none" }, { transform: "scale(1.02) translateY(-3px)" }, { transform: "none" }],
      { duration: FLIP_MS, easing: E.flip },
    );
    let hochkant = false;
    let antwort: Extract<VersuchAntwort, { ok: true }> | null = null;
    const weiter = () => {
      /* hochkant und Lösung da: Rückseite füllen, Höhe wechseln, zu Ende drehen */
      if (fertig || !hochkant || !antwort) return;
      fertig = true;
      fillBack(top, antwort);
      fitStack();
      const alt = dreh;
      dreh = flipEl.animate([{ transform: "rotateY(90deg)" }, { transform: "rotateY(180deg)" }], {
        duration: FLIP.rest,
        easing: FLIP.zweite,
      });
      alt.cancel();
      hebt.play();
      dreh.finished.then(() => {
        if (topCard() === top) frischSetzen(top);
      }, () => {});
    };
    dreh.finished.then(
      () => {
        hochkant = true;
        if (!antwort && !fertig) {
          hebt.pause();
          hebt.currentTime = FLIP.halb;
        }
        weiter();
      },
      () => {},
    );
    p.then(
      (r) => {
        if (fertig) return;
        if (!r.ok) {
          /* zwischen Start und Antwort anderswo erledigt oder zurückgezogen: überspringen, ohne Meldung (6.7) */
          fertig = true;
          dreh.cancel();
          hebt.cancel();
          if (topCard() === top) advance("skip", 0);
          return;
        }
        antwort = r;
        weiter();
      },
      () => {
        if (fertig) return;
        fertig = true;
        hebt.cancel();
        if (topCard() !== top) return;
        /* zurück auf die Vorderseite, auf derselben Kurve rückwärts */
        dreh.reverse();
        dreh.finished.then(
          () => {
            top.classList.remove("flipped");
            dreh.cancel();
            setCardAccess(top);
            fitStack();
          },
          () => {},
        );
        zurueck();
      },
    );
  }

  // ── Ziehen und Werfen ──────────────────────────────────────────────────────

  function setStamps(top: HTMLElement, dx: number) {
    top.querySelector<HTMLElement>(".stamp.r")!.style.opacity = String(Math.max(0, Math.min(1, dx / 100)));
    top.querySelector<HTMLElement>(".stamp.l")!.style.opacity = String(Math.max(0, Math.min(1, -dx / 100)));
  }

  function bindTop() {
    tStack.querySelectorAll<HTMLElement>(".sc").forEach(setCardAccess);
    const top = topCard();
    if (qResize && top) {
      qResize.disconnect();
      const qp = top.querySelector(".c-q p");
      if (qp) qResize.observe(qp);
    }
    if (!top || top._bound) return;
    top._bound = true;
    let d: {
      id: number;
      x0: number;
      y0: number;
      sx: number;
      sy: number;
      moved: boolean;
      hist: [number, number][];
      x: number;
      y: number;
    } | null = null;
    top.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || top.dataset.pos !== "0" || (e.target as HTMLElement).closest("textarea, button, .cb-ask")) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(top).transform);
      top.getAnimations().forEach((a) => a.cancel());
      top.style.transition = "none";
      top.style.transform = `translate(${m.m41}px,${m.m42}px)`;
      d = {
        id: e.pointerId,
        x0: e.clientX - m.m41,
        y0: e.clientY - m.m42,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
        hist: [[e.timeStamp, e.clientX]],
        x: m.m41,
        y: m.m42,
      };
      top.setPointerCapture(e.pointerId);
    });
    top.addEventListener("pointermove", (e) => {
      if (!d || e.pointerId !== d.id) return;
      let dx = e.clientX - d.x0;
      let dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.moved = true;
      /* vor dem Aufdecken nur zäh (19 rubber() Z. 632) */
      const frei = T.phase === "loesung" && !!top._geloest;
      if (!frei) {
        dx = rubber(dx, 300, 0.35);
        dy = rubber(dy, 300, 0.35);
        if (T.phase !== "loesung") $("tMeta").classList.add("hint");
      }
      d.x = dx;
      d.y = dy;
      top.style.transform = `translate(${dx}px,${dy}px) rotate(${dx * 0.055}deg)`;
      if (frei) setStamps(top, dx);
      d.hist.push([e.timeStamp, e.clientX]);
      if (d.hist.length > 6) d.hist.shift();
    });
    const up = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.id) return;
      const s = d;
      d = null;
      if (!s.moved) {
        top.style.transition = "";
        top.style.transform = "";
        if (e.type === "pointerup" && T.phase === "frage") top.querySelector("textarea")!.focus();
        return;
      }
      const [ta, xa] = s.hist[0];
      const [tb, xb] = s.hist[s.hist.length - 1];
      const vx = (xb - xa) / Math.max(1, tb - ta);
      const px = s.x + vx * 99;
      if (T.phase === "loesung" && top._geloest && Math.abs(px) > 120 && e.type === "pointerup") {
        advance(px > 0 ? "sass" : "daneben", vx);
        return;
      }
      const from = top.style.transform;
      top.style.transform = "";
      if (reduce()) {
        top.style.transition = "";
        setStamps(top, 0);
      } else {
        top
          .animate([{ transform: from }, { transform: "translate(0px,0px) rotate(0deg)" }], springOpts())
          .finished.then(
            () => {
              top.style.transition = "";
            },
            () => {},
          );
        top.querySelectorAll<HTMLElement>(".stamp").forEach((st) => {
          const o = st.style.opacity;
          st.style.opacity = "0";
          st.animate([{ opacity: o || 0 }, { opacity: 0 }], { duration: 200, easing: "ease" });
        });
      }
      setTimeout(() => $("tMeta").classList.remove("hint"), 900);
    };
    top.addEventListener("pointerup", up);
    top.addEventListener("pointercancel", up);
  }

  function urteilen(attemptId: string, sass: boolean) {
    urteilThemaAction(attemptId, sass).then(
      (r) => {
        if (!r.ok) deps.toast("Nicht gespeichert", () => urteilen(attemptId, sass), "Nicht gespeichert", "Erneut");
      },
      () => deps.toast("Nicht gespeichert", () => urteilen(attemptId, sass), "Nicht gespeichert", "Erneut"),
    );
  }

  /* Urteil: Saß schließt den Termin, Daneben legt die Frage ans Ende des Themas. Keine Sperre */
  function advance(kind: "sass" | "daneben" | "retire" | "skip", vx: number) {
    const top = topCard();
    if (!top || T.ended) return;
    if ((kind === "sass" || kind === "daneben") && (T.phase !== "loesung" || !top._geloest)) return;
    const id = top.dataset.id!;
    if (kind === "sass" || kind === "daneben") {
      urteilen(top._geloest!.attemptId, kind === "sass");
      if (!(id in T.first)) T.first[id] = kind === "sass";
      if (kind === "sass") {
        T.weg.add(id);
        T.again.delete(id);
        buzz();
      } else {
        T.queue.push(id);
        T.again.add(id);
      }
    } else if (kind === "retire") {
      T.total = Math.max(0, T.total - 1);
      T.again.delete(id);
      delete T.first[id];
      T.weg.add(id);
    } else {
      T.weg.add(id);
      T.again.delete(id);
    }
    const W = tisch.clientWidth;
    const cs = getComputedStyle(top);
    const m = new DOMMatrixReadOnly(cs.transform);
    const dir = kind === "sass" ? 1 : kind === "daneben" ? -1 : 0;
    /* die geworfene Karte behält ihre Höhe, auch wenn der Stapel sich der nächsten anpasst */
    top.style.height = `${top.offsetHeight}px`;
    top.style.bottom = "auto";
    top.dataset.pos = "out";
    top.style.transition = "none";
    setCardAccess(top);
    if (dir) setStamps(top, dir * 140);
    const from = cs.transform === "none" ? "none" : cs.transform;
    top.getAnimations().forEach((a) => a.cancel());
    const a =
      reduce() || !dir
        ? top.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" })
        : top.animate(
            [
              { transform: from, opacity: 1 },
              {
                transform: `translate(${dir * (W + 160) + vx * 140}px,${m.m42}px) rotate(${dir * 16 + vx * 4}deg)`,
                opacity: 0,
              },
            ],
            { duration: 340, easing: E.out, fill: "forwards" },
          );
    a.finished.then(
      () => top.remove(),
      () => top.remove(),
    );
    T.qi++;
    T.phase = "frage";
    /* übersprungen wird, was inzwischen saß oder zurückgezogen ist (6.7) */
    T.queue = T.queue.slice(0, T.qi).concat(T.queue.slice(T.qi).filter(valid));
    const live = [...tStack.querySelectorAll<HTMLElement>(".sc")].filter((x) => x !== top && x.dataset.pos !== "out");
    live.forEach((x) => {
      if (!T.queue.slice(T.qi, T.qi + 3).includes(x.dataset.id!)) x.remove();
    });
    const keep = [...tStack.querySelectorAll<HTMLElement>(".sc")].filter((x) => x !== top && x.dataset.pos !== "out");
    keep.forEach((x) => {
      const p = Number(x.dataset.pos);
      x.style.transitionDelay = reduce() ? "0ms" : `${30 * Math.max(0, p - 1)}ms`;
      x.dataset.pos = String(p - 1);
    });
    for (let k = keep.length; k < 3; k++) {
      const nid = T.queue[T.qi + k];
      if (!nid) break;
      const el = cardEl(T.fragen.get(nid)!, 3);
      tStack.append(el);
      void el.offsetWidth;
      el.dataset.pos = String(k);
    }
    setTimeout(() => tStack.querySelectorAll<HTMLElement>(".sc").forEach((x) => (x.style.transitionDelay = "")), 400);
    bindTop();
    fitStack();
    renderTicks(true);
    if (T.qi >= T.queue.length) endThema();
    else footState(false);
  }

  // ── Thema laden ────────────────────────────────────────────────────────────

  function laufVon(key: string): Promise<ThemaLauf> {
    let p = T.laeufe.get(key);
    if (!p) {
      p = laufHolen(key);
      T.laeufe.set(key, p);
      p.catch(() => T.laeufe.delete(key));
    }
    return p;
  }

  function loadThema(t: ThemaKurz, lauf: ThemaLauf | null) {
    T.key = t.key;
    T.ended = false;
    T.phase = "frage";
    T.fragen = new Map();
    T.first = {};
    T.again = new Set();
    T.queue = [];
    T.qi = 0;
    T.total = 0;
    T.wiederDran = lauf?.wiederDran ?? null;
    blattErgebnis = null;
    /* Übungsthema: statt Karten das Arbeitsblatt (Zusatz, Kriterium 1; gebaut in Abschnitt H) */
    if (istBlatt(t) || !lauf) {
      T.kind = "blatt";
      deps.blatt?.(t, oeffnetGerade);
      return;
    }
    T.kind = "karten";
    deps.blatt?.(null, false);
    for (const f of lauf.fragen) T.fragen.set(f.itemId, f);
    T.queue = lauf.fragen.map((f) => f.itemId).filter(valid);
    T.first = { ...lauf.erste };
    /* Fortsetzen: heutige Versuche zählen mit, was danebenging, kommt nochmal */
    T.total = new Set([...Object.keys(lauf.erste), ...T.queue]).size;
    T.again = new Set(lauf.fragen.filter((f) => f.heuteDaneben > 0 && valid(f.itemId)).map((f) => f.itemId));
  }

  function setHead() {
    const t = thema();
    $("tFach").textContent = `${t.istEpoche ? "Epoche · " : ""}${t.fach}`;
    $("tThema").textContent = t.titel;
    $("tOf").textContent = `Thema ${T.ti + 1} von ${T.themen.length}`;
  }

  function showRun() {
    tisch.classList.remove("ended");
    tisch.classList.toggle("blatt", T.kind === "blatt");
    ["tStack", "tFoot", "tBlatt", "tBFoot"].forEach((q) => {
      $(q).style.display = "";
      $(q).getAnimations().forEach((a) => a.cancel());
    });
    ["tHead", "tTicks", "tMeta"].forEach((q) => {
      $(q).getAnimations().forEach((a) => a.cancel());
      $(q).style.visibility = "";
    });
    $("tMeta").classList.remove("hint");
    const e = $("tEnd");
    if (!T.keepEnd) {
      e.classList.remove("on");
      e.getAnimations().forEach((a) => a.cancel());
      e.style.opacity = "";
    }
    /* das Ausblenden der Knöpfe vom letzten Aufdecken darf nicht in das nächste Thema hängen bleiben */
    const ask = $("tAsk");
    const rate = $("tRate");
    [ask, ...ask.children, ...rate.children].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    rate.style.visibility = "hidden";
    ask.style.visibility = "visible";
    ask.style.pointerEvents = "";
    ask.inert = false;
    ask.setAttribute("aria-hidden", "false");
    rate.inert = true;
    rate.setAttribute("aria-hidden", "true");
    if (T.kind === "blatt") {
      tStack.replaceChildren();
      renderBlattPlatz();
    } else {
      buildStack();
      renderTicks(false);
    }
  }

  /**
   * Platz des Arbeitsblatts (Abschnitt H baut Vorschau, Druck und „Wie lief
   * es?“). Bis dahin baut niemand ein Blatt; dort steht deshalb der Satz
   * für ein gescheitertes Blatt aus Plan H, „Für dieses Thema ließ sich heute
   * kein Blatt bauen.“, und nicht „Das Blatt wird gerade gebaut.“, das ein
   * Warten verspräche. Darunter der vorhandene Weg „Dieses Thema lieber
   * abfragen“, der für heute auf Karten umschaltet, ohne `art` zu speichern.
   * Bis H muss er ihn bei jedem Übungsthema tippen — deshalb geht vor H
   * nichts auf das NAS (Plan 4).
   */
  function renderBlattPlatz() {
    const t = thema();
    $("tCount").textContent = t.umfang;
  }

  /* Der Stapel blendet als Gruppe ein, die Karten kommen einzeln: so scheint nie eine Karte durch die vordere */
  function staggerStack(base: number) {
    if (reduce()) return;
    tStack.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: base, easing: "ease-out", fill: "backwards" });
    [...tStack.children].forEach((c, i) => {
      const p = (c as HTMLElement).dataset.pos;
      (c as HTMLElement).animate(
        [
          { transform: "translateY(60px) scale(.94)" },
          { transform: p === "0" ? "none" : p === "1" ? "translateY(14px) scale(.95)" : "translateY(28px) scale(.9)" },
        ],
        { duration: 340, delay: base + i * 40, easing: E.out, fill: "backwards" },
      );
    });
  }

  function staggerBlatt(base: number) {
    if (reduce() || T.kind !== "blatt") return;
    $("tBlatt").animate([{ opacity: 0, transform: "translateY(60px) scale(.94)" }, { opacity: 1, transform: "none" }], {
      duration: 340,
      delay: base,
      easing: E.out,
      fill: "backwards",
    });
  }

  /* Themenende (6.5): der Kopf blendet aus, an seiner Stelle steht nur der Satz. Nichts springt */
  function endThema() {
    T.ended = true;
    const t = thema();
    ["tStack", "tFoot", "tMat", "tBlatt", "tBFoot"].forEach((q) => {
      $(q).style.display = "none";
    });
    tStack.replaceChildren();
    const heads = ["tHead", "tTicks", "tMeta"].map((q) => $(q));
    if (reduce())
      heads.forEach((x) => {
        x.style.visibility = "hidden";
      });
    else
      heads.forEach((x) =>
        x
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" })
          .finished.then(
            () => {
              if (T.ended) x.style.visibility = "hidden";
            },
            () => {},
          ),
      );
    tisch.classList.add("ended");
    const n = T.total;
    const ok = Object.values(T.first).filter(Boolean).length;
    const end = $("tEnd");
    T.fertig.add(t.key);
    beenden(t.key, T.kind === "blatt" && blattErgebnis ? blattErgebnis.n : n);
    const rest = T.themen.slice(T.ti + 1).filter((x) => !T.fertig.has(x.key));
    const be = T.kind === "blatt" ? blattErgebnis : null;
    const und = (l: number[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} und ${l[l.length - 1]}`);
    /* beim Blatt zählt die eigene Wertung je Aufgabe; falsche Aufgaben kommen aufs nächste Blatt */
    const kids: HTMLElement[] = be
      ? [
          h("h2", null, be.richtig === be.n ? `${t.titel} sitzt.` : `${t.titel} geübt.`),
          h("p", null, `${be.n} Aufgaben, ${be.richtig === be.n ? "alle" : be.richtig} richtig.`),
          ...(be.falsch.length
            ? [
                h(
                  "p",
                  null,
                  `${be.falsch.length === 1 ? "Aufgabe" : "Aufgaben"} ${und(be.falsch)} ${be.falsch.length === 1 ? "kommt" : "kommen"} aufs nächste Blatt.`,
                ),
              ]
            : []),
        ]
      : [
          h("h2", null, `${t.titel} sitzt.`),
          h("p", null, `${fragenText(n)}, ${ok === n ? "alle" : ok} beim ersten Mal.`),
        ];
    const nt = be ? be.wiederDran : T.wiederDran;
    if (nt) kids.push(h("p", null, `Wieder dran: ${TAG[wd(nt)]}, ${dm(nt)}`));
    const rows: HTMLElement[] = [];
    if (rest.length) {
      const nx = rest[0];
      if (!istBlatt(nx)) void laufVon(nx.key).catch(() => {});
      const go = h(
        "button",
        { class: "tlink known", type: "button" },
        h("span", null, `Weiter mit ${nx.fach}`),
        h("span", { class: "s" }, `${nx.titel}, ${nx.umfang}`),
      );
      go.addEventListener("click", () => void nextThema());
      rows.push(go);
      const stop = h("button", { class: "tlink", type: "button" }, "Für heute aufhören");
      stop.addEventListener("click", () => closeTisch());
      rows.push(stop);
    } else {
      rows.push(h("p", { class: "tnote" }, "Alle Themen für heute durch."));
      const fin = h("button", { class: "tlink", type: "button" }, "Fertig");
      fin.addEventListener("click", () => closeTisch());
      rows.push(fin);
    }
    kids.push(h("div", { class: "tnext" }, ...rows));
    end.replaceChildren(...kids);
    end.classList.add("on");
    if (reduce()) return;
    end.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 340, easing: "ease" });
    [...end.children]
      .filter((c) => !c.classList.contains("tnext"))
      .forEach((c) =>
        (c as HTMLElement).animate([{ transform: "translateY(16px)" }, { transform: "none" }], { duration: 340, easing: E.out }),
      );
    end.querySelectorAll<HTMLElement>(".tnext > *").forEach((b, i) =>
      b.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], {
        duration: 340,
        delay: 100 + i * 40,
        easing: E.out,
        fill: "backwards",
      }),
    );
  }

  /** Protokoll `thema_beendet` {n}; scheitert es, sagt es der Toast. */
  function beenden(key: string, n: number) {
    themaBeendenAction(key, n).then(
      (r) => {
        if (!r.ok) deps.toast("Nicht gespeichert", () => beenden(key, n), "Nicht gespeichert", "Erneut");
      },
      () => deps.toast("Nicht gespeichert", () => beenden(key, n), "Nicht gespeichert", "Erneut"),
    );
  }

  /* Weiter mit dem nächsten Thema, ohne den Tisch zu verlassen (7.2 Nr. 56) */
  async function nextThema() {
    const rest = T.themen.slice(T.ti + 1).filter((x) => !T.fertig.has(x.key));
    if (!rest.length) return;
    const nx = rest[0];
    let lauf: ThemaLauf | null = null;
    if (!istBlatt(nx)) {
      try {
        lauf = await laufVon(nx.key);
      } catch {
        deps.toast("Keine Verbindung", () => void nextThema(), "Keine Verbindung", "Erneut");
        return;
      }
    }
    if (!T.offen || !T.ended) return;
    T.ti = T.themen.indexOf(nx);
    const end = $("tEnd");
    const head = $("tHead");
    const meta = $("tMeta");
    const go = () => {
      loadThema(nx, lauf);
      setHead();
      showRun();
      if (T.kind === "karten" && T.queue.length === 0) {
        endThema();
        return;
      }
      if (reduce()) {
        $("tBody").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
        return;
      }
      [head, meta].forEach((x) =>
        x.animate([{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], {
          duration: 260,
          easing: E.out,
        }),
      );
      $("tOf").animate([{ opacity: 0 }, { opacity: 0.76 }], { duration: 260, easing: E.out });
      $("tTicks").style.transformOrigin = "left";
      $("tTicks").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 300, easing: E.out });
      staggerStack(60);
      staggerBlatt(60);
      $("tFoot").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 120, easing: E.out, fill: "backwards" });
    };
    if (reduce()) {
      go();
      return;
    }
    /* das Themenende geht nach links, der neue Kopf kommt schon nach 60ms von rechts: nie ein leerer Tisch */
    end.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-24px)" }], {
      duration: 120,
      easing: E.out,
      fill: "forwards",
    });
    T.keepEnd = true;
    setTimeout(() => {
      go();
      T.keepEnd = false;
    }, 60);
    setTimeout(() => {
      if (T.ended) return;
      end.getAnimations().forEach((a) => a.cancel());
      end.classList.remove("on");
    }, 130);
  }

  /** Für heute auf Karten umschalten, ohne `art` zu speichern (Plan H). */
  async function lieberAbfragen() {
    const t = thema();
    if (!t || T.kind !== "blatt") return;
    let lauf: ThemaLauf;
    try {
      lauf = await laufVon(t.key);
    } catch {
      deps.toast("Keine Verbindung", () => void lieberAbfragen(), "Keine Verbindung", "Erneut");
      return;
    }
    T.lieberAbfragen.add(t.key);
    T.themen[T.ti] = { ...t, umfang: fragenText(lauf.fragen.length) };
    loadThema(T.themen[T.ti], lauf);
    showRun();
    staggerStack(0);
    if (T.queue.length === 0) endThema();
  }

  // ── Tastatur ───────────────────────────────────────────────────────────────

  /* Tastatur: der Tisch wird so hoch wie der sichtbare Bereich, die Karte folgt ohne eigene Animation */
  function fitTisch() {
    if (!T.offen || !window.visualViewport) return;
    const vv = window.visualViewport;
    tisch.style.height = kbInset ? `${vv.height}px` : "";
    tisch.classList.toggle("kb", !!kbInset);
    tisch.style.transform = kbInset && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
    fitStack();
  }
  const vvFit = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    kbInset = inset >= 100 ? inset : 0;
    fitTisch();
  };
  window.visualViewport?.addEventListener("resize", vvFit);
  window.visualViewport?.addEventListener("scroll", vvFit);
  if ("ResizeObserver" in window) qResize = new ResizeObserver(() => fitStack());

  // ── Öffnen und Schließen ────────────────────────────────────────────────────

  /* Startmaske: genau die Pille, aus der der Tisch kommt, mit ihrem Radius */
  function clipOf(r: DOMRect) {
    const tr = tisch.getBoundingClientRect();
    const R = Math.min(r.height / 2, 26);
    return `inset(${r.top - tr.top}px ${tr.right - r.right}px ${tr.bottom - r.bottom}px ${r.left - tr.left}px round ${R}px)`;
  }

  function showGhost(origin: HTMLElement, r: DOMRect) {
    const g = $("tGhost");
    const tr = tisch.getBoundingClientRect();
    g.replaceChildren(...[...origin.children].map((c) => h("span", null, c.textContent ?? "")));
    Object.assign(g.style, {
      left: `${r.left - tr.left}px`,
      top: `${r.top - tr.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    return g;
  }

  /** Der Knopf „Wiederholen“, wenn er gerade sichtbar auf dem Überblick steht. */
  function originNow(): HTMLElement | null {
    const b = document.getElementById("whBtn");
    if (!b || !b.offsetParent) return null;
    if (document.querySelector("#pages > .page")) return null;
    return b;
  }

  const zeile = () => document.getElementById("zeile");

  async function openTisch(opts: TischOptionen = {}) {
    if (T.offen) return;
    deps.closeMenu();
    const nr = ++oeffnet;
    const fach = opts.fach ?? null;
    let daten;
    try {
      daten = await wiederholenHolen(fach);
    } catch {
      deps.toast("Keine Verbindung", () => void openTisch(opts), "Keine Verbindung", "Erneut");
      return;
    }
    if (nr !== oeffnet || T.offen) return;
    if (!daten.themen.length) {
      deps.toast(whLeerText({ ...daten, fachName: fach ? daten.fachName : null }));
      return;
    }
    T.themen = daten.themen.slice();
    T.ti = 0;
    T.fach = fach;
    T.fertig = new Set();
    T.weg = new Set();
    T.laeufe = new Map();
    T.lieberAbfragen = new Set();
    T.naechstesThema = daten.naechstesThema;
    if (daten.lauf) T.laeufe.set(daten.lauf.key, Promise.resolve(daten.lauf));
    const origin = opts.origin && opts.origin.isConnected ? opts.origin : null;

    deps.hideToast();
    if (deps.sheetOffen()) deps.closeSheet();
    T.offen = true;
    T.origin = origin;
    tisch.classList.toggle("rm", reduce());
    tisch.classList.remove("typing");
    oeffnetGerade = !!origin;
    loadThema(T.themen[0], daten.lauf);
    oeffnetGerade = false;
    setHead();
    showRun();
    /* die Zeile geht erst, wenn der Tisch sie bedeckt */
    if (reduce() || !origin) zeile()?.classList.add("hide");
    else
      setTimeout(() => {
        if (T.offen) zeile()?.classList.add("hide");
      }, 340);
    tisch.classList.add("open");
    tisch.setAttribute("aria-hidden", "false");
    historyAuf();
    vvFit();
    fitStack();
    /* Während der Tisch aufgeht, stimmen die gemessenen Kanten noch nicht, und die Schrift bricht
       erst nach dem Laden endgültig um. Deshalb nach dem Öffnen und nach den Schriften noch einmal messen. */
    setTimeout(() => {
      if (T.offen) fitStack();
    }, reduce() ? 0 : 420);
    void document.fonts?.ready.then(() => {
      if (T.offen) fitStack();
    });
    if (T.kind === "karten" && !T.queue.length) endThema();
    const surf = $("tSurface");
    const body = $("tBody");
    const tint = $("tTint");
    const ghost = $("tGhost");
    [surf, body, tint, ghost, tisch].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    themeColor("table");
    if (reduce()) {
      tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return;
    }
    if (origin && origin.offsetParent) {
      /* der Tisch wächst aus dem Knopf: die Fläche behält die Form der Pille, bis sie den Bildschirm füllt (7.2 Nr. 41) */
      const r = origin.getBoundingClientRect();
      surf.animate([{ clipPath: clipOf(r) }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }], {
        duration: 340,
        easing: E.grow,
      });
      if (origin.classList.contains("whbtn")) {
        tint.animate([{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 340, easing: "ease" });
        showGhost(origin, r).animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], {
          duration: 160,
          easing: "ease-out",
          fill: "forwards",
        });
      }
      body.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
        duration: 200,
        delay: 204,
        easing: E.out,
        fill: "backwards",
      });
      $("tEnd").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 204, easing: E.out, fill: "backwards" });
      staggerStack(204);
      staggerBlatt(204);
    } else {
      tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
      staggerStack(60);
      staggerBlatt(60);
    }
  }

  /** Der Stand für den Knopf auf dem Überblick, wie ihn der Tisch jetzt kennt. */
  function whNeu(): WhStand {
    const offen = T.themen.filter((t) => !T.fertig.has(t.key));
    if (!offen.length) return { kind: "text", text: whText(true, T.naechstesThema), ok: true };
    const cur = T.themen[T.ti];
    const angefangen =
      !!cur && !T.fertig.has(cur.key) && T.kind === "karten" && Object.keys(T.first).length > 0;
    let erstes = offen[0];
    let noch = erstes.fragen;
    if (angefangen) {
      erstes = cur;
      noch = offenIds().size;
    } else if (erstes === cur && T.kind === "karten") noch = offenIds().size;
    return {
      kind: "knopf",
      n: offen.length,
      sub: whUnterzeile({ ...erstes, angefangen: angefangen || erstes.angefangen, fragen: noch }),
    };
  }

  /* Schließen: der Tisch schrumpft in den Knopf, aus dem er kam (7.2 Nr. 57). Schließen fragt nicht nach */
  function closeTisch(instant = false, ausHistory = false) {
    if (!T.offen) return;
    T.offen = false;
    oeffnet++;
    if (deps.sheetOffen()) deps.closeSheet();
    const a = document.activeElement as HTMLElement | null;
    if (a && tisch.contains(a)) a.blur();
    if (!ausHistory) historyZu();
    /* bleibt der Knopf, steht sein neuer Stand schon drin, bevor der Tisch in ihn zurückgeht: kein Textsprung am Ende */
    const neu = whNeu();
    if (neu.kind === "knopf") flushSync(() => whSetzen(neu, false));
    const o = originNow();
    const oRect = o ? o.getBoundingClientRect() : null;
    zeile()?.classList.remove("hide");
    themeColor("paper");
    tisch.style.height = "";
    tisch.style.transform = "";
    tisch.classList.remove("kb");
    /* nach dem Schrumpfen: Zahl und Unterzeile blenden über, oder die Textzeile ersetzt den Knopf (Nr. 58) */
    setTimeout(
      () => {
        whSetzen(neu, true);
        void deps.neuLaden();
      },
      instant || reduce() ? 0 : 260,
    );
    const surf = $("tSurface");
    const body = $("tBody");
    const end = $("tEnd");
    const tint = $("tTint");
    const ghost = $("tGhost");
    const done = () => {
      if (T.offen) return;
      [surf, body, end, tint, ghost, tisch].forEach((x) => x.getAnimations().forEach((an) => an.cancel()));
      tisch.classList.remove("open", "ended", "blatt", "typing");
      tisch.setAttribute("aria-hidden", "true");
      deps.blatt?.(null, false);
      tStack.replaceChildren();
      end.classList.remove("on");
      end.replaceChildren();
    };
    if (instant) {
      done();
      return;
    }
    if (reduce()) {
      tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).finished.then(done, () => {});
      return;
    }
    if (o && oRect && oRect.width && oRect.bottom > 0 && oRect.top < window.innerHeight) {
      /* zurück in den Knopf: Inhalt geht zuerst, die Fläche nimmt Form und Farbe der Pille an */
      [body, end].forEach((x) =>
        x.animate([{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { duration: 280, fill: "forwards" }),
      );
      if (o.classList.contains("whbtn")) {
        tint.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], {
          duration: 280,
          easing: "ease",
          fill: "forwards",
        });
        showGhost(o, oRect).animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], {
          duration: 280,
          easing: "ease-out",
          fill: "forwards",
        });
      }
      surf
        .animate([{ clipPath: "inset(0px 0px 0px 0px round 0px)" }, { clipPath: clipOf(oRect) }], {
          duration: 280,
          easing: E.grow,
          fill: "forwards",
        })
        .finished.then(done, () => {});
      return;
    }
    tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease" }).finished.then(done, () => {});
  }

  // ── Android-Zurück und Escape ──────────────────────────────────────────────

  /* Der Tisch hat einen eigenen Eintrag in der History, damit Android-Zurück ihn schließt (Plan 1.4) */
  let ignorierePop = 0;
  function historyAuf() {
    const s = (window.history.state ?? {}) as Record<string, unknown>;
    if (s.overlay === "tisch") return;
    window.history.pushState({ ...s, overlay: "tisch" }, "");
  }
  function historyZu() {
    const s = (window.history.state ?? {}) as Record<string, unknown>;
    if (s.overlay !== "tisch") return;
    ignorierePop += 1;
    window.history.back();
  }
  const onPop = (e: PopStateEvent) => {
    if (ignorierePop > 0) {
      ignorierePop -= 1;
      return;
    }
    const s = (e.state ?? {}) as Record<string, unknown>;
    if (!T.offen) return;
    if (s.overlay === "tisch" || s.overlay === "sheet") return;
    closeTisch(false, true);
  };
  window.addEventListener("popstate", onPop);

  /* Escape: Sheet → Rückfrage → Tisch (Prototyp Z. 4661–4668) */
  const onKey = (e: KeyboardEvent) => {
    if (!T.offen || e.key !== "Escape") return;
    if (deps.sheetOffen()) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (deps.lupeOffen?.()) {
      deps.lupeSchliessen?.();
      return;
    }
    const ask = tisch.querySelector(".cb-ask");
    if (ask) ask.remove();
    else closeTisch();
  };
  window.addEventListener("keydown", onKey, true);

  $("tClose").addEventListener("click", () => closeTisch());
  $("tReveal").addEventListener("click", () => void reveal(false));
  $("tDunno").addEventListener("click", () => void reveal(true));
  $("tReveal").addEventListener("mousedown", (e) => e.preventDefault());
  $("tDunno").addEventListener("mousedown", (e) => e.preventDefault());
  tisch.querySelectorAll<HTMLElement>("#tRate .rb").forEach((b) =>
    b.addEventListener("click", () => advance(b.dataset.r as "sass" | "daneben", 0)),
  );

  return {
    openTisch,
    closeTisch: () => closeTisch(),
    istOffen: () => T.offen,
    /** „Dieses Thema lieber abfragen“ aus dem Blatt: für heute Karten */
    lieberAbfragen: () => void lieberAbfragen(),
    /** Das Zählwort unter dem Kopf, sobald der Stand des Blatts da ist („Arbeitsblatt · 6 Aufgaben, etwa 25 Minuten“) */
    blattZaehler(text: string) {
      if (!T.offen || T.kind !== "blatt" || T.ended) return;
      $("tCount").innerHTML = tn(text);
    },
    /** Das Blatt ist ausgewertet: das Themenende mit der eigenen Wertung (Prototyp `endThema`, Zweig Blatt) */
    blattFertig(e: BlattErgebnis) {
      if (!T.offen || T.kind !== "blatt" || T.ended) return;
      blattErgebnis = e;
      endThema();
    },
    zerstoeren() {
      window.visualViewport?.removeEventListener("resize", vvFit);
      window.visualViewport?.removeEventListener("scroll", vvFit);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey, true);
      qResize?.disconnect();
    },
  };
}
