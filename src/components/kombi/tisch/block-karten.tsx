"use client";

import { useLayoutEffect, useRef } from "react";

import {
  lernblockUrteilAction,
  lernblockVersuchAction,
  lernblockZurueckziehenAction,
  type VersuchAntwort,
} from "@/app/(app)/lernblock-actions";
import type { BlockFrage } from "@/lib/kombi/lernblock-daten";
import { E, buzz, moveTo, reduce, rubber, springOpts, swapText, vvStable } from "@/lib/kombi/motion";
import { fxTeile } from "@/lib/kombi/text";

/**
 * Die Karten im Lernblock (Prototyp Z. 3760–4027, V2 9.1 und 6.4): die heute
 * offenen Fragen der Klausurthemen (`fragenFuerLernblock`) als Stapel mit
 * Ticks und Zähler, Antwort schreiben, „Weiß ich nicht“/„Aufdecken“, dann
 * „Daneben“/„Saß“ (Knöpfe oder Wurf), „Stelle im Blatt“ und „Stand so nicht
 * im Heft“. Sind alle durch, meldet `onEnde` die Zahlen, und der Tisch zeigt
 * „Fragen für heute durch.“ mit „Weiter mit Material“ und „Block beenden“.
 *
 * Wie im Prototyp imperativ über das DOM, mit WAAPI. Versuch und Urteil
 * gehen über `versuchFesthalten`/`urteilFesthalten` — derselbe Weg wie beim
 * Wiederholen (Abschnitt E), mit dem Kalendertag. Eine Frage, die hier saß,
 * ist deshalb auch für Wiederholen erledigt (Kriterium 47).
 *
 * Aufdecken ohne Warten (Plan E): die Drehung startet beim Tipp, die
 * Rückseite wird am Halbdreh-Punkt gefüllt, sobald die Lösung vom Server da
 * ist (A2); ohne Netz dreht die Karte zurück („Keine Verbindung“ · „Erneut“).
 *
 * Beim Zusammenführen mit E kann dieser Stapel durch Es Steuerung ersetzt
 * werden; die Gestalt (Klassen, Texte, Bewegung) ist dieselbe.
 */

export type BlockKartenDeps = {
  toast: (text: string, fn?: (() => void) | null, desc?: string, label?: string) => void;
  blattAnsehen: (materialId: string) => void;
};

export type BlockKartenProps = {
  blockId: string;
  fragen: BlockFrage[];
  /** Heute schon beantwortete Fragen des Blocks vom Server: itemId → beim ersten Mal gewusst */
  erste: Record<string, boolean>;
  /** n Fragen, ok davon beim ersten Mal gewusst */
  onEnde: (ergebnis: { n: number; ok: number }) => void;
  deps: BlockKartenDeps;
};

// ── Stand je Block über Schließen und Wiederöffnen (Prototyp `db.block.session`) ──
//
// Der Prototyp hält die Sitzung in `db.block.session`, sie übersteht ein
// Neuladen. Hier kommt der Stand vom Server (`erste`, aus den heutigen
// `recall_attempts` der Fragen des Blocks) und wird mit dem Speicher der Seite
// zusammengelegt: der weiß von Urteilen, deren Aufruf noch unterwegs ist.

type Stand = { sass: Set<string>; first: Record<string, boolean> };
const staende = new Map<string, Stand>();

function standVon(blockId: string, erste: Record<string, boolean>): Stand {
  let s = staende.get(blockId);
  if (!s) {
    s = { sass: new Set(), first: {} };
    staende.set(blockId, s);
  }
  for (const [id, ok] of Object.entries(erste)) if (!(id in s.first)) s.first[id] = ok;
  return s;
}

/** Fragen, die der Block heute schon hatte (gewusst oder beantwortet) */
const bisher = (s: Stand) => new Set([...s.sass, ...Object.keys(s.first)]);

/** Was der Block heute an Fragen hatte: für das Ende ohne offene Fragen. */
export function blockKartenErgebnis(blockId: string, erste: Record<string, boolean>): { n: number; ok: number } {
  const s = standVon(blockId, erste);
  return { n: bisher(s).size, ok: Object.values(s.first).filter(Boolean).length };
}

// ── DOM-Helfer (wie `h` im Prototyp, nie innerHTML aus Daten) ────────────────

type Attrs = Record<string, string | boolean | null | undefined>;

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

const SVG = "http://www.w3.org/2000/svg";
const EXPAND_MORE = "M6 9.5l6 6 6-6";

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

/** Text mit `{…}`-Formeln als Knoten (Prototyp `fx`). */
function fxKnoten(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const t of fxTeile(text)) {
    if (t.formel) f.append(h("span", { class: `f-in${t.lead ? " lead" : ""}` }, t.text));
    else f.append(t.text);
  }
  return f;
}

/**
 * Die Drehung (`ease-flip`, 320 ms) in zwei Hälften geteilt, genau dort, wo
 * die Kurve 90° erreicht (Karte hochkant). Dazwischen kann die Karte auf die
 * Lösung warten.
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

type Geloest = Extract<VersuchAntwort, { ok: true }>;
type Karte = HTMLDivElement & { _frontH?: number; _bound?: boolean; _geloest?: Geloest | null };

type Teile = {
  tisch: HTMLElement;
  ticks: HTMLElement;
  meta: HTMLElement;
  count: HTMLElement & { _text?: string };
  stack: HTMLElement;
  foot: HTMLElement;
  ask: HTMLElement;
  rate: HTMLElement;
};

type Steuerung = {
  reveal: (dunno: boolean) => void;
  urteil: (kind: "sass" | "daneben") => void;
  ende: () => void;
};

function erzeugeKarten(
  t: Teile,
  blockId: string,
  fragen: BlockFrage[],
  erste: Record<string, boolean>,
  onEnde: (e: { n: number; ok: number }) => void,
  deps: BlockKartenDeps,
): Steuerung {
  const { tisch, stack } = t;
  const stand = standVon(blockId, erste);
  const fragenMap = new Map(fragen.map((f) => [f.itemId, f]));
  // Was heute schon dran war, zählt mit: der Zähler zeigt den ganzen Block
  const frueher = [...bisher(stand)].filter((id) => !fragenMap.has(id)).length;
  const T = {
    queue: fragen.map((f) => f.itemId),
    qi: 0,
    again: new Set<string>(fragen.filter((f) => f.heuteDaneben > 0).map((f) => f.itemId)),
    weg: new Set<string>(),
    total: frueher + fragen.length,
    frueher,
    phase: "frage" as "frage" | "loesung",
    ended: false,
    aus: false,
  };
  let kbInset = 0;
  const qResize = "ResizeObserver" in window ? new ResizeObserver(() => fitStack()) : null;

  const valid = (id: string) => !T.weg.has(id);
  const topCard = () => stack.querySelector<Karte>('.sc[data-pos="0"]');

  function cardEl(q: BlockFrage, i: number): Karte {
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

    ansehen.addEventListener("click", () => {
      const id = el._geloest?.materialId;
      if (id) deps.blattAnsehen(id);
    });
    heftBtn.addEventListener("click", () => {
      const open = quote.hidden;
      const sc = heftBtn.closest<HTMLElement>(".c-back")!;
      const below = [...sc.querySelectorAll<HTMLElement>(".cb-retire, .cb-ask")];
      const before = below.map((x) => x.getBoundingClientRect().top);
      quote.hidden = !open;
      heftBtn.setAttribute("aria-expanded", String(open));
      fitStack({ grow: open });
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

  /** Die Rückseite füllen, sobald die Lösung vom Server da ist (A2). */
  function fillBack(el: Karte, r: Geloest) {
    el._geloest = r;
    el.querySelector(".cb-sol")!.replaceChildren(...r.loesung.map((x) => h("li", null, h("span", null, fxKnoten(x)))));
    el.querySelector(".cb-verw")!.textContent = r.verwechslung;
    el.querySelector(".cb-quote p")!.replaceChildren(fxKnoten(r.zitat));
    el.querySelector<HTMLButtonElement>(".cb-quote button")!.hidden = !r.materialId;
  }

  /* Nur die oberste Karte und ihre sichtbare Seite gehören zur Antwort. */
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

  function askRetire(btn: HTMLElement, q: BlockFrage) {
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
    const cb = btn.closest<HTMLElement>(".c-back")!;
    requestAnimationFrame(() => cb.scrollTo({ top: cb.scrollHeight, behavior: reduce() ? "auto" : "smooth" }));
    no.addEventListener("click", () => ask.remove());
    yes.addEventListener("click", () => {
      zurueckziehen(q.itemId);
      advance("retire", 0);
    });
  }

  function zurueckziehen(itemId: string) {
    const nochmal = () => zurueckziehen(itemId);
    lernblockZurueckziehenAction(itemId).then(
      (r) => {
        if (!r.ok) deps.toast("Nicht gespeichert", nochmal, "Nicht gespeichert", "Erneut");
      },
      () => deps.toast("Nicht gespeichert", nochmal, "Nicht gespeichert", "Erneut"),
    );
  }

  function buildStack() {
    stack.replaceChildren();
    for (let k = 0; k < 3; k++) {
      const id = T.queue[T.qi + k];
      if (!id) break;
      stack.append(cardEl(fragenMap.get(id)!, k));
    }
    bindTop();
    fitStack();
  }

  /* Die Karte ist so hoch wie ihr Inhalt; aufgeklappt darf sie bis zu den Knöpfen wachsen */
  function stackAvail() {
    const top = stack.getBoundingClientRect().top;
    const foot = t.foot.getBoundingClientRect().top - 16;
    return Math.max(160, foot - top - 30);
  }

  function fitStack(opts: { grow?: boolean } = {}) {
    if (T.aus || T.ended) return;
    const top = topCard();
    const old = stack.offsetHeight;
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
    stack.style.height = `${Math.round(H)}px`;
    if (opts.grow && !reduce() && top && H > old + 1) {
      top.querySelectorAll<HTMLElement>(".face").forEach((f) =>
        f.animate(
          [{ clipPath: `inset(0px 0px ${H - old}px 0px round 22px)` }, { clipPath: "inset(0px 0px 0px 0px round 22px)" }],
          { duration: 240, easing: E.out },
        ),
      );
    }
    requestAnimationFrame(() => stack.querySelectorAll<HTMLElement>(".c-back").forEach(moreHint));
  }

  function moreHint(b: HTMLElement) {
    b.classList.toggle("more", b.scrollHeight - b.scrollTop - b.clientHeight > 2);
  }

  const offenIds = () => new Set(T.queue.slice(T.qi).filter(valid));
  const doneCount = () => T.total - offenIds().size;

  function renderTicks(animate: boolean) {
    const box = t.ticks;
    const n = T.total;
    const done = Math.max(0, doneCount());
    if (n <= 20) {
      if (box.children.length !== n || box.classList.contains("bar")) {
        box.classList.remove("bar");
        box.replaceChildren(...Array.from({ length: n }, () => h("span", { class: "tick" }, h("i"))));
      }
      [...box.children].forEach((tk, i) => {
        const was = tk.classList.contains("past");
        tk.classList.toggle("past", i < done);
        if (animate && !was && i < done && !reduce())
          (tk.firstChild as HTMLElement).animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
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
    const txt = `${n} ${n === 1 ? "Frage" : "Fragen"}${a ? ` · ${a} ${a === 1 ? "kommt" : "kommen"} nochmal` : ""}`;
    if (animate) swapText(t.count, txt);
    else {
      t.count.getAnimations().forEach((x) => x.cancel());
      t.count.textContent = txt;
      t.count._text = txt;
    }
  }

  function footState(rev: boolean) {
    const { ask, rate } = t;
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

  /* erst schließt die Tastatur, dann dreht die Karte (7.2 Nr. 46 und 47) */
  async function reveal(dunno: boolean) {
    const top = topCard();
    if (!top || T.phase !== "frage" || T.ended || T.aus) return;
    const q = fragenMap.get(top.dataset.id!)!;
    const ta = top.querySelector("textarea")!;
    const text = dunno ? "" : ta.value.trim();
    T.phase = "loesung";
    const mine = top.querySelector<HTMLElement>(".cb-mine")!;
    mine.textContent = text || "Nichts geschrieben";
    mine.classList.toggle("none", !text);
    t.meta.classList.remove("hint");
    footState(true);
    const p = lernblockVersuchAction(q.scheduleId, q.itemId, text);
    p.catch(() => {});
    top._geloest = null;
    const hadKb = document.activeElement === ta;
    ta.blur();
    tisch.classList.remove("typing");
    if (hadKb) await vvStable();
    if (topCard() !== top || T.phase !== "loesung" || T.aus) return;
    drehen(top, p, dunno);
  }

  function drehen(top: Karte, p: Promise<VersuchAntwort>, dunno: boolean) {
    const flipEl = top.querySelector<HTMLElement>(".sc-flip")!;
    const lift = top.querySelector<HTMLElement>(".sc-lift")!;
    let fertig = false;
    const zurueck = () => {
      if (topCard() !== top || T.aus) return;
      T.phase = "frage";
      footState(false);
      deps.toast("Keine Verbindung", () => void reveal(dunno), "Keine Verbindung", "Erneut");
    };
    if (reduce()) {
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
    let antwort: Geloest | null = null;
    const weiter = () => {
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
          /* inzwischen anderswo erledigt oder zurückgezogen: überspringen, ohne Meldung (6.7) */
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
    stack.querySelectorAll<HTMLElement>(".sc").forEach(setCardAccess);
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
        if (T.phase !== "loesung") t.meta.classList.add("hint");
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
      setTimeout(() => t.meta.classList.remove("hint"), 900);
    };
    top.addEventListener("pointerup", up);
    top.addEventListener("pointercancel", up);
  }

  function urteilen(attemptId: string, sass: boolean) {
    const nochmal = () => urteilen(attemptId, sass);
    lernblockUrteilAction(attemptId, sass).then(
      (r) => {
        if (!r.ok) deps.toast("Nicht gespeichert", nochmal, "Nicht gespeichert", "Erneut");
      },
      () => deps.toast("Nicht gespeichert", nochmal, "Nicht gespeichert", "Erneut"),
    );
  }

  /* Urteil: Saß schließt den Termin, Daneben legt die Frage ans Ende. Keine Sperre */
  function advance(kind: "sass" | "daneben" | "retire" | "skip", vx: number) {
    const top = topCard();
    if (!top || T.ended || T.aus) return;
    if ((kind === "sass" || kind === "daneben") && (T.phase !== "loesung" || !top._geloest)) return;
    const id = top.dataset.id!;
    if (kind === "sass" || kind === "daneben") {
      urteilen(top._geloest!.attemptId, kind === "sass");
      if (!(id in stand.first)) stand.first[id] = kind === "sass";
      if (kind === "sass") {
        T.weg.add(id);
        T.again.delete(id);
        stand.sass.add(id);
        buzz();
      } else {
        T.queue.push(id);
        T.again.add(id);
      }
    } else if (kind === "retire") {
      T.total = Math.max(0, T.total - 1);
      T.again.delete(id);
      delete stand.first[id];
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
    const live = [...stack.querySelectorAll<HTMLElement>(".sc")].filter((x) => x !== top && x.dataset.pos !== "out");
    live.forEach((x) => {
      if (!T.queue.slice(T.qi, T.qi + 3).includes(x.dataset.id!)) x.remove();
    });
    const keep = [...stack.querySelectorAll<HTMLElement>(".sc")].filter((x) => x !== top && x.dataset.pos !== "out");
    keep.forEach((x) => {
      const p = Number(x.dataset.pos);
      x.style.transitionDelay = reduce() ? "0ms" : `${30 * Math.max(0, p - 1)}ms`;
      x.dataset.pos = String(p - 1);
    });
    for (let k = keep.length; k < 3; k++) {
      const nid = T.queue[T.qi + k];
      if (!nid) break;
      const el = cardEl(fragenMap.get(nid)!, 3);
      stack.append(el);
      void el.offsetWidth;
      el.dataset.pos = String(k);
    }
    setTimeout(() => stack.querySelectorAll<HTMLElement>(".sc").forEach((x) => (x.style.transitionDelay = "")), 400);
    bindTop();
    fitStack();
    renderTicks(true);
    if (T.qi >= T.queue.length) ende();
    else footState(false);
  }

  function ende() {
    if (T.ended) return;
    T.ended = true;
    const ok = Object.values(stand.first).filter(Boolean).length;
    onEnde({ n: T.total, ok });
  }

  // ── Tastatur: der Tisch wird so hoch wie der sichtbare Bereich ──────────────

  function fitTisch() {
    if (T.aus || !window.visualViewport) return;
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

  // ── Start ──────────────────────────────────────────────────────────────────

  t.rate.style.visibility = "hidden";
  t.rate.inert = true;
  t.rate.setAttribute("aria-hidden", "true");
  buildStack();
  renderTicks(false);
  setTimeout(() => fitStack(), reduce() ? 0 : 420);
  document.fonts?.ready.then(() => fitStack(), () => {});
  /* Der Stapel blendet als Gruppe ein, die Karten kommen einzeln (Prototyp `staggerStack`) */
  if (!reduce()) {
    stack.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 60, easing: "ease-out", fill: "backwards" });
    [...stack.children].forEach((c, i) => {
      const p = (c as HTMLElement).dataset.pos;
      (c as HTMLElement).animate(
        [
          { transform: "translateY(60px) scale(.94)" },
          { transform: p === "0" ? "none" : p === "1" ? "translateY(14px) scale(.95)" : "translateY(28px) scale(.9)" },
        ],
        { duration: 340, delay: 60 + i * 40, easing: E.out, fill: "backwards" },
      );
    });
  }

  return {
    reveal: (dunno) => void reveal(dunno),
    urteil: (kind) => advance(kind, 0),
    ende: () => {
      T.aus = true;
      qResize?.disconnect();
      window.visualViewport?.removeEventListener("resize", vvFit);
      window.visualViewport?.removeEventListener("scroll", vvFit);
      tisch.classList.remove("typing", "kb");
      tisch.style.height = "";
      tisch.style.transform = "";
    },
  };
}

export function BlockKarten({ blockId, fragen, erste, onEnde, deps }: BlockKartenProps) {
  const ticksRef = useRef<HTMLDivElement>(null);
  const metaRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const rateRef = useRef<HTMLDivElement>(null);
  const steuerung = useRef<Steuerung | null>(null);
  const rueckruf = useRef({ onEnde, deps });
  useLayoutEffect(() => {
    rueckruf.current = { onEnde, deps };
  });

  useLayoutEffect(() => {
    const tisch = stackRef.current?.closest<HTMLElement>(".tisch");
    if (!tisch) return;
    const s = erzeugeKarten(
      {
        tisch,
        ticks: ticksRef.current!,
        meta: metaRef.current!,
        count: countRef.current!,
        stack: stackRef.current!,
        foot: footRef.current!,
        ask: askRef.current!,
        rate: rateRef.current!,
      },
      blockId,
      fragen,
      erste,
      (e) => rueckruf.current.onEnde(e),
      {
        toast: (...a) => rueckruf.current.deps.toast(...a),
        blattAnsehen: (id) => rueckruf.current.deps.blattAnsehen(id),
      },
    );
    steuerung.current = s;
    return () => {
      s.ende();
      steuerung.current = null;
    };
  }, [blockId, fragen, erste]);

  const ohneFokus = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <>
      <div className="t-ticks" ref={ticksRef} />
      <div className="t-meta" ref={metaRef}>
        <p className="t-count" ref={countRef} />
        <p className="t-hint" aria-live="polite">
          Erst antworten.
        </p>
      </div>
      <div className="t-stack" ref={stackRef} />
      <div className="t-foot" ref={footRef}>
        <div className="t-ask" ref={askRef}>
          <button className="rb" type="button" onMouseDown={ohneFokus} onClick={() => steuerung.current?.reveal(true)}>
            Weiß ich nicht
          </button>
          <button className="rb known" type="button" onMouseDown={ohneFokus} onClick={() => steuerung.current?.reveal(false)}>
            Aufdecken
          </button>
        </div>
        <div className="t-rate" ref={rateRef}>
          <button className="rb" type="button" onClick={() => steuerung.current?.urteil("daneben")}>
            Daneben
          </button>
          <button className="rb known" type="button" onClick={() => steuerung.current?.urteil("sass")}>
            Saß
          </button>
        </div>
      </div>
    </>
  );
}
