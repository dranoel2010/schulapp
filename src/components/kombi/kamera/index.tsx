"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  blaetterStore,
  blattHochladen,
  blattNachAblehnung,
  landen,
  seitenDazu,
  testweicheLesen,
  ueberlaufHoeren,
  vorLandungAusloesen,
  type Aufnahme,
} from "@/components/kombi/ablauf/blaetter-store";
import { ablaufTagLesen } from "@/components/kombi/ablauf/ablauf-store";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { prepareCanvas, prepareFile } from "@/components/material/prepare-page";
import { BLATT_VOLL_TOAST, MAX_PAGES, UEBERLAUF_TOAST } from "@/lib/images";
import { E, buzz, moveTo, reduce } from "@/lib/kombi/motion";
import { cap, zahl } from "@/lib/kombi/text";
import { themeColor } from "@/lib/kombi/theme-color";

import { kameraInGebrauch, stopCamera, warmCamera } from "./stream";

/**
 * Die Kamera (Prototyp `#cam`, Z. 918–941 und 3368–3607; V2 Abschnitt 8).
 *
 * Er wählt beim Fotografieren nie ein Fach: der Chip zeigt immer „Fach
 * erkennen“, Jev ordnet ein. Jedes Auslösen ist ein neues Blatt; „Seite dazu“
 * an der letzten Miniatur legt das nächste Foto als Seite an dieses Blatt.
 * „Fertig“ legt alle zugleich ab, Schließen legt ab, was schon fotografiert
 * ist — es geht nichts verloren.
 *
 * Aus dem Sucher im Ablauf wächst sie per `clip-path` aus genau dieser Fläche
 * und geht beim Ablegen in sie zurück; sonst fährt sie von unten ein.
 *
 * Die Seiten rechnet der Browser wie bisher (@/components/material/
 * prepare-page): beim Auslösen friert er das Bild in voller Auflösung ein und
 * rechnet die drei Fassungen nebenher, damit der nächste Tipp sofort geht.
 * Hochgeladen wird erst beim Ablegen, je Blatt eine Anfrage an
 * `POST /api/blaetter`.
 */

type Ziel = "liste" | "zeile";
type Ziel0 = { id: string; seiten: number; bild: string | null };
type Blatt = { key: string; pages: Aufnahme[]; target: Ziel0 | null };
type OeffnenMit = { ziel?: Ziel | { kind?: string }; attach?: Ziel0; origin?: HTMLElement | null };

let kz = 0;

/** Wie viele Seiten das Blatt im Streifen nach dem Ablegen hat: vorhandene und neue. */
const seitenVon = (b: Blatt): number => (b.target ? b.target.seiten : 0) + b.pages.length;

/** Das letzte Blatt im Streifen ist voll: „Seite dazu“ geht nicht mehr (Abnahmerunde 19). */
const letztesVoll = (liste: Blatt[]): boolean => liste.length > 0 && seitenVon(liste[liste.length - 1]) >= MAX_PAGES;

/** Ein kleines JPEG (360px breit, A4-Format) für Streifen und Liste (Prototyp `grab`, Z. 3451). */
function grab(src: CanvasImageSource, w: number, hgt: number): string {
  const c = document.createElement("canvas");
  const W = 360;
  c.width = W;
  c.height = Math.round(W * 1.414);
  const x = c.getContext("2d");
  if (!x) return "";
  const r = Math.max(c.width / w, c.height / hgt);
  const dw = w * r;
  const dh = hgt * r;
  x.drawImage(src, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  return c.toDataURL("image/jpeg", 0.72);
}

/** Was unter der Kamera liegt: die oberste Seite, sonst die sichtbare Ebene (Prototyp `underOf`). */
function underOf(): HTMLElement | null {
  const seiten = [...document.querySelectorAll<HTMLElement>("#pages > .page")];
  if (seiten.length) return seiten[seiten.length - 1];
  return document.querySelector<HTMLElement>("#flow.on") ?? document.getElementById("home");
}

export function KameraEbene() {
  const kombi = useKombi();
  const { registriere, toast, hideToast, openPage, neuLaden } = kombi;
  const appTag = kombi.tagDaten?.tag ?? null;

  const camRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const finderRef = useRef<HTMLDivElement>(null);
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const cflashRef = useRef<HTMLDivElement>(null);
  const csRowRef = useRef<HTMLDivElement>(null);
  const ablegenRef = useRef<HTMLButtonElement>(null);
  const camSheetRef = useRef<HTMLDivElement>(null);
  const fileLibRef = useRef<HTMLInputElement>(null);
  const fileCapRef = useRef<HTMLInputElement>(null);

  const [offen, setOffen] = useState(false);
  const [blaetter, setBlaetter] = useState<Blatt[]>([]);
  const [armed, setArmed] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; knopf: boolean } | null>({ text: "Kamera startet", knopf: false });
  const [bereit, setBereit] = useState(false);
  const [sheetOffen, setSheetOffen] = useState(false);

  const st = useRef({
    offen: false,
    denied: false,
    ziel: "zeile" as Ziel,
    origin: null as HTMLElement | null,
    blaetter: [] as Blatt[],
    armed: false,
    ausHistory: false,
    wake: null as WakeLockSentinel | null,
  });

  // ── Kamera-Sheet „n Blätter“ ──────────────────────────────────────────────
  const closeCamSheet = useCallback((instant = false) => {
    const el = camSheetRef.current;
    if (!el || !el.classList.contains("open")) return;
    const done = () => {
      el.classList.remove("open");
      el.style.transform = "translateY(105%)";
      setSheetOffen(false);
    };
    if (instant || reduce()) {
      el.getAnimations().forEach((a) => a.cancel());
      done();
      return;
    }
    moveTo(el, { transform: "translateY(105%)" }, { duration: 300, easing: E.drawer }).finished.then(done, () => {});
  }, []);

  const openCamSheet = useCallback(() => {
    const el = camSheetRef.current;
    if (!el || !st.current.blaetter.some((s) => s.pages.length) || el.classList.contains("open")) return;
    flushSync(() => setSheetOffen(true));
    el.classList.add("open");
    if (reduce()) {
      el.style.transform = "none";
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    } else moveTo(el, { transform: "translateY(0px)" }, { duration: 380, easing: E.drawer });
  }, []);

  // ── Schließen ────────────────────────────────────────────────────────────
  const closeCam = useCallback(() => {
    const s = st.current;
    if (!s.offen) return;
    s.offen = false;
    // sofort, nicht erst nach dem Wegfahren: ein Toast direkt danach steht
    // über der Zeile, nicht unter der wegfahrenden Kopfzeile (Prototyp ui.cam)
    document.body.classList.remove("cam-offen");
    closeCamSheet(true);
    document.getElementById("zeile")?.classList.remove("hide");
    themeColor("paper");
    void s.wake?.release().catch(() => {});
    s.wake = null;
    const cam = camRef.current;
    const finder = finderRef.current;
    const video = videoRef.current;
    if (!cam || !finder) return;
    const fertig = () => {
      if (st.current.offen) return;
      cam.classList.remove("open");
      cam.style.clipPath = "";
      stopCamera();
      kameraInGebrauch(false);
      if (video) video.srcObject = null;
      setOffen(false);
    };
    if (!s.ausHistory && window.history.state?.overlay === "kamera") window.history.back();
    s.ausHistory = false;
    const b = underOf();
    const stapel = document.querySelectorAll("#pages > .page").length > 0;
    cam.getAnimations().forEach((a) => a.cancel());
    if (reduce()) {
      cam.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).finished.then(fertig, fertig);
      if (b) {
        b.getAnimations().forEach((a) => a.cancel());
        b.style.transform = "";
        b.style.opacity = "";
      }
      return;
    }
    const o = s.origin && s.origin.isConnected && s.origin.offsetParent ? s.origin : null;
    if (o) {
      // zurück in den Sucher, aus dem sie kam
      const r = o.getBoundingClientRect();
      const cr = cam.getBoundingClientRect();
      [...cam.children].forEach((c) => {
        if (c !== finder) c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
      });
      cam
        .animate(
          [
            { clipPath: "inset(0px 0px 0px 0px round 0px)" },
            { clipPath: `inset(${r.top - cr.top}px ${cr.right - r.right}px ${cr.bottom - r.bottom}px ${r.left - cr.left}px round 22px)` },
          ],
          { duration: 300, easing: E.grow, fill: "forwards" },
        )
        .finished.then(
          () => {
            [...cam.children].forEach((c) => c.getAnimations().forEach((a) => a.cancel()));
            cam.getAnimations().forEach((a) => a.cancel());
            fertig();
          },
          () => {},
        );
    } else {
      moveTo(cam, { transform: "translateY(100%)" }, { duration: 300, easing: E.drawer }).finished.then(fertig, () => {});
    }
    if (b) {
      moveTo(b, { transform: stapel ? "translateX(0px) scale(1)" : "scale(1)", opacity: "1" }, { duration: 300, easing: E.drawer }).finished.then(
        () => {
          if (!st.current.offen) {
            b.style.transform = stapel ? "translateX(0px)" : "";
            b.style.opacity = "";
          }
        },
        () => {},
      );
    }
  }, [closeCamSheet]);

  // ── Ablegen (Prototyp `ablegen`, Z. 3574) ───────────────────────────────────
  const ablegen = useCallback(() => {
    const s = st.current;
    const list = s.blaetter.filter((b) => b.pages.length);
    if (!list.length) {
      closeCam();
      return;
    }
    const base = Date.now();
    const neu: { key: string; from: DOMRect | null }[] = [];
    const dazu: { id: string; from: DOMRect | null }[] = [];
    const miniRect = (k: string) =>
      (csRowRef.current?.querySelector<HTMLElement>(`.cs-mini[data-k="${k}"]`) ?? finderRef.current)?.getBoundingClientRect() ?? null;
    const uploads: Promise<unknown>[] = [];
    const dazuErgebnisse: Promise<boolean>[] = [];
    list.forEach((b, i) => {
      const from = miniRect(b.key);
      if (b.target) {
        const t = b.target;
        dazu.push({ id: t.id, from });
        const pages = b.pages;
        // Ohne Netz hängt der Upload (IndexedDB, an der Blattzeile „Hängt, wird
        // erneut versucht“) und geht von selbst weiter. Lehnt der Server ab,
        // bleiben die Seiten hier im Speicher: „Erneut“ schickt sie noch einmal.
        const senden = (): Promise<boolean> =>
          seitenDazu(t.id, pages, ablaufTagLesen() ?? appTag).then(
            (kurz) => {
              if (kurz) blaetterStore.setzen(blaetterStore.get().find((x) => x.id === t.id)?.key ?? "", { kurz, seiten: kurz.seiten });
              return true;
            },
            () => {
              toast(
                "Nicht gespeichert",
                () =>
                  void senden().then((ok) => {
                    if (!ok) return;
                    void neuLaden();
                    toast("Seite dazugelegt");
                  }),
                "Nicht gespeichert",
                "Erneut",
              );
              return false;
            },
          );
        const p = senden();
        uploads.push(p);
        dazuErgebnisse.push(p);
        return;
      }
      const eintrag = blaetterStore.neu({
        id: null,
        lokal: "hochladen",
        bild: b.pages[0].bild,
        seiten: b.pages.length,
        order: base + i,
        kurz: null,
        // der App-Tag des Servers (Testuhr eingeschlossen): im Ablauf stehen nur die Blätter dieses Tages
        tag: ablaufTagLesen() ?? appTag,
      });
      neu.push({ key: eintrag.key, from });
      uploads.push(
        blattHochladen(eintrag.key, b.pages, s.ziel).catch((e: unknown) => {
          // was schon ankam, bleibt in der Liste
          blattNachAblehnung(eintrag.key);
          toast(e instanceof Error ? e.message : "Nicht gespeichert");
        }),
      );
    });
    // „Seite dazugelegt“ erst, wenn der Server die Seiten angenommen hat;
    // danach zeigt die Seite darunter (etwa die Blattseite) die neue Zahl.
    const dazuOk = Promise.all(dazuErgebnisse).then((r) => r.every(Boolean));
    if (dazu.length) void dazuOk.then((ok) => ok && void neuLaden());
    // Kommt die Kamera aus dem großen Sucher, wird er schon jetzt flach
    if (neu.length) vorLandungAusloesen(s.origin?.id === "blShoot");
    closeCam();
    window.setTimeout(
      () => {
        const z = s.ziel;
        if (landen({ neu: neu.slice().reverse(), dazu, dazuOk, ziel: z })) return;
        if (!neu.length) {
          if (dazu.length) void dazuOk.then((ok) => ok && toast("Seite dazugelegt"));
          return;
        }
        const n = neu.length;
        const ersterKey = neu[0].key;
        toast(n === 1 ? "Blatt abgelegt" : `${cap(zahl(n, "n"))} Blätter abgelegt`, () => {
          const id = blaetterStore.get().find((x) => x.key === ersterKey)?.id;
          if (n === 1 && id) openPage("blatt", { id });
          else openPage("ablage");
        }, undefined, "Ansehen");
      },
      reduce() ? 170 : 300,
    );
  }, [appTag, closeCam, neuLaden, openPage, toast]);

  // ── Öffnen (Prototyp `openCam`, Z. 3387) ───────────────────────────────────
  const openCam = useCallback(
    (o: OeffnenMit = {}) => {
      const cam = camRef.current;
      const finder = finderRef.current;
      const video = videoRef.current;
      if (!cam || !finder || !video) return;
      testweicheLesen();
      kameraInGebrauch(true);
      const p = warmCamera();
      hideToast();
      const s = st.current;
      s.offen = true;
      s.denied = false;
      s.ziel = (typeof o.ziel === "string" ? o.ziel : o.ziel?.kind) === "liste" ? "liste" : "zeile";
      s.origin = o.origin && o.origin.isConnected && o.origin.offsetParent ? o.origin : null;
      // An ein volles Blatt kommt keine Seite: dann wird das Foto ein neues Blatt
      const attach = o.attach && o.attach.seiten < MAX_PAGES ? o.attach : undefined;
      const start: Blatt[] = attach ? [{ key: `c${++kz}`, pages: [], target: attach }] : [];
      s.blaetter = start;
      flushSync(() => {
        setOffen(true);
        setBlaetter(start);
        setArmed(!!attach);
        st.current.armed = !!attach;
        setMeldung({ text: "Kamera startet", knopf: false });
        setBereit(false);
      });
      finder.classList.remove("frozen");
      document.body.classList.add("cam-offen");
      closeCamSheet(true);
      document.getElementById("zeile")?.classList.add("hide");
      cam.classList.add("open");
      if (window.history.state?.overlay !== "kamera") {
        window.history.pushState({ ...(window.history.state ?? {}), overlay: "kamera" }, "");
      }
      void navigator.wakeLock
        ?.request("screen")
        .then((w) => {
          if (st.current.offen) st.current.wake = w;
          else void w.release();
        })
        .catch(() => {});
      const b = underOf();
      const stapel = document.querySelectorAll("#pages > .page").length > 0;
      cam.getAnimations().forEach((a) => a.cancel());
      cam.style.clipPath = "";
      if (reduce()) {
        cam.style.transform = "none";
        cam.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
        themeColor("camera");
      } else if (s.origin) {
        // die Kamera wächst aus dem Sucher: Form und Radius der Fläche, dann Vollbild
        cam.style.transform = "none";
        const r = s.origin.getBoundingClientRect();
        const cr = cam.getBoundingClientRect();
        cam.animate(
          [
            { clipPath: `inset(${r.top - cr.top}px ${cr.right - r.right}px ${cr.bottom - r.bottom}px ${r.left - cr.left}px round 22px)` },
            { clipPath: "inset(0px 0px 0px 0px round 0px)" },
          ],
          { duration: 340, easing: E.grow },
        );
        [...cam.children].forEach((c) => {
          if (c !== finder) c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 140, easing: E.out, fill: "backwards" });
        });
        if (b) moveTo(b, { transform: `${stapel ? "translateX(0px) " : ""}scale(.96)`, opacity: ".5" }, { duration: 340, easing: E.drawer });
        themeColor("camera", 200);
      } else {
        cam.style.transform = "translateY(100%)";
        moveTo(cam, { transform: "translateY(0px)" }, { duration: 340, easing: E.drawer });
        if (b) moveTo(b, { transform: `${stapel ? "translateX(0px) " : ""}scale(.96)`, opacity: ".5" }, { duration: 340, easing: E.drawer });
        themeColor("camera", 200);
      }
      p.then(
        (strom) => {
          if (!st.current.offen) return;
          video.srcObject = strom;
          const ready = () => {
            if (!st.current.offen) return;
            setMeldung(null);
            setBereit(true);
          };
          if (video.readyState >= 2) ready();
          else video.addEventListener("loadeddata", ready, { once: true });
          video.play().catch(() => {});
        },
        () => {
          if (st.current.offen) {
            st.current.denied = true;
            setMeldung({ text: "Kein Zugriff auf die Kamera", knopf: true });
          }
        },
      );
    },
    [closeCamSheet, hideToast],
  );

  useEffect(() => registriere("kamera", (o) => openCam((o ?? {}) as OeffnenMit)), [registriere, openCam]);

  // Seiten, die der Server nicht mehr an ihr Blatt nahm, wurden ein neues Blatt
  useEffect(() => ueberlaufHoeren(() => toast(UEBERLAUF_TOAST)), [toast]);

  // Android-Zurück: das Kamera-Sheet zuerst, dann die Kamera (Plan 1.4)
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (!st.current.offen) return;
      if ((e.state as { overlay?: string } | null)?.overlay === "kamera") return;
      if (camSheetRef.current?.classList.contains("open")) {
        closeCamSheet();
        window.history.pushState({ ...(window.history.state ?? {}), overlay: "kamera" }, "");
        return;
      }
      st.current.ausHistory = true;
      if (st.current.blaetter.some((b) => b.pages.length)) ablegen();
      else closeCam();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !st.current.offen) return;
      e.stopImmediatePropagation();
      if (camSheetRef.current?.classList.contains("open")) closeCamSheet();
      else if (st.current.blaetter.some((b) => b.pages.length)) ablegen();
      else closeCam();
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ablegen, closeCam, closeCamSheet]);

  // ── Aufnehmen ────────────────────────────────────────────────────────────
  const addShot = useCallback((auf: Aufnahme) => {
    const s = st.current;
    let ziel = s.armed && s.blaetter.length ? s.blaetter[s.blaetter.length - 1] : null;
    if (ziel && seitenVon(ziel) >= MAX_PAGES) {
      // voll: das Foto wird ein neues Blatt, nicht die dreizehnte Seite
      ziel = null;
      toast(BLATT_VOLL_TOAST);
    }
    const neu = !ziel;
    const wasOn = s.blaetter.some((b) => b.pages.length);
    let liste: Blatt[];
    if (neu) {
      ziel = { key: `c${++kz}`, pages: [auf], target: null };
      liste = [...s.blaetter, ziel];
    } else {
      const k = ziel!.key;
      liste = s.blaetter.map((b) => (b.key === k ? { ...b, pages: [...b.pages, auf] } : b));
    }
    s.blaetter = liste;
    flushSync(() => {
      setBlaetter(liste);
      setArmed(false);
    });
    s.armed = false;
    const row = csRowRef.current;
    const m = row?.querySelector<HTMLElement>(`.cs-mini[data-k="${ziel!.key}"]`) ?? null;
    row?.scrollTo({ left: row.scrollWidth, behavior: "auto" });
    if (!wasOn && !reduce()) {
      ablegenRef.current?.animate([{ opacity: 0, transform: "translateX(12px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: E.out });
    }
    const finder = finderRef.current;
    if (reduce() || !m || !finder) return;
    // das Foto fliegt aus dem Sucher in den Streifen
    const fr = finder.getBoundingClientRect();
    const sr = m.getBoundingClientRect();
    if (neu) m.style.visibility = "hidden";
    const g = document.createElement("div");
    g.className = "fly";
    g.style.cssText = `left:${fr.left}px;top:${fr.top}px;width:${fr.width}px;height:${fr.height}px;background-image:url("${auf.bild}")`;
    document.body.append(g);
    g.animate(
      [
        { transform: "translate(0px,0px) scale(1,1) rotate(-4deg)", opacity: 1 },
        { transform: `translate(${sr.left - fr.left}px,${sr.top - fr.top}px) scale(${sr.width / fr.width},${sr.height / fr.height}) rotate(0deg)`, opacity: 0.9 },
      ],
      { duration: 420, easing: E.drawer },
    ).finished.then(
      () => {
        g.remove();
        m.style.visibility = "";
        if (!neu) {
          m.animate([{ transform: "scale(.9)" }, { transform: "none" }], { duration: 220, easing: E.out });
          m.querySelector(".n")?.animate([{ transform: "scale(.6)" }, { transform: "none" }], { duration: 200, easing: E.out });
        }
      },
      () => {
        g.remove();
        m.style.visibility = "";
      },
    );
  }, [toast]);

  const ausloesen = useCallback(() => {
    const video = videoRef.current;
    const finder = finderRef.current;
    const fz = freezeRef.current;
    if (!video || !finder || !fz) return;
    if (!video.videoWidth) {
      if (st.current.denied) fileCapRef.current?.click();
      return;
    }
    fz.width = finder.clientWidth;
    fz.height = finder.clientHeight;
    const cx = fz.getContext("2d");
    if (cx) {
      const r = Math.max(fz.width / video.videoWidth, fz.height / video.videoHeight);
      cx.drawImage(video, (fz.width - video.videoWidth * r) / 2, (fz.height - video.videoHeight * r) / 2, video.videoWidth * r, video.videoHeight * r);
    }
    finder.classList.add("frozen");
    buzz();
    cflashRef.current?.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 240, easing: "ease-out" });
    // das ganze Kamerabild einfrieren; die drei Fassungen rechnen nebenher
    const shot = document.createElement("canvas");
    shot.width = video.videoWidth;
    shot.height = video.videoHeight;
    shot.getContext("2d")?.drawImage(video, 0, 0);
    const bild = grab(shot, shot.width, shot.height);
    const fassungen = prepareCanvas(shot);
    fassungen.catch(() => {});
    addShot({ bild, fassungen });
    window.setTimeout(() => finder.classList.remove("frozen"), 260);
  }, [addShot]);

  const ausDatei = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      const bild = grab(img, img.naturalWidth || 300, img.naturalHeight || 424);
      URL.revokeObjectURL(url);
      const fassungen = prepareFile(file);
      fassungen.catch(() => {});
      addShot({ bild, fassungen });
    },
    [addShot],
  );

  const removeSheet = useCallback(
    (b: Blatt) => {
      const s = st.current;
      const i = s.blaetter.findIndex((x) => x.key === b.key);
      if (i < 0) return;
      const pages = b.pages;
      const liste = b.target ? s.blaetter.map((x) => (x.key === b.key ? { ...x, pages: [] } : x)) : s.blaetter.filter((x) => x.key !== b.key);
      s.blaetter = liste;
      flushSync(() => setBlaetter(liste));
      if (!liste.some((x) => x.pages.length)) closeCamSheet();
      toast(b.target ? "Seite entfernt" : "Blatt entfernt", () => {
        const jetzt = st.current.blaetter;
        const zurueck = b.target
          ? jetzt.map((x) => (x.key === b.key ? { ...x, pages } : x))
          : [...jetzt.slice(0, i), b, ...jetzt.slice(i)];
        st.current.blaetter = zurueck;
        setBlaetter(zurueck);
      });
    },
    [closeCamSheet, toast],
  );

  // Toast in der Kamera: unter der Kopfzeile (Prototyp Z. 1604)
  useLayoutEffect(() => {
    document.body.classList.toggle("cam-offen", offen && st.current.offen);
  }, [offen]);

  const mitSeiten = blaetter.filter((b) => b.pages.length);
  const real = blaetter.filter((b) => !b.target).length;
  const mehr = blaetter.filter((b) => b.target && b.pages.length).length;
  const camN = real ? `${cap(zahl(real, "n"))} ${real === 1 ? "Blatt" : "Blätter"}` : mehr ? "Seite dazu" : "";
  const nSheet = mitSeiten.length;

  return (
    <section
      className="cam"
      id="cam"
      aria-label="Blatt aufnehmen"
      role="dialog"
      ref={camRef}
      aria-hidden={!offen}
      // Solange die Kamera offen ist, lädt AutoRefresh die Seite darunter nicht nach
      data-aufnahme-laeuft={offen ? "" : undefined}
    >
      <div className="cam-top">
        <button
          className="cbtn"
          id="camClose"
          type="button"
          aria-label="Kamera schließen"
          onClick={() => (st.current.blaetter.some((b) => b.pages.length) ? ablegen() : closeCam())}
        >
          <Icon name="close" />
        </button>
        <span className="cam-chip" id="camChip">
          Fach erkennen
        </span>
        <span />
      </div>
      <div className="finder" id="finder" ref={finderRef}>
        <video id="video" ref={videoRef} playsInline muted autoPlay />
        <canvas id="freeze" ref={freezeRef} />
        <div className="f-msg" id="fMsg" hidden={!meldung}>
          {meldung ? <span>{meldung.text}</span> : null}
          {meldung?.knopf ? (
            <button className="btn" type="button" onClick={() => fileCapRef.current?.click()}>
              Foto auswählen
            </button>
          ) : null}
        </div>
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div className="cflash" id="cflash" ref={cflashRef} />
      </div>
      <div className={`cam-strip${blaetter.length ? " has" : ""}`} id="camStrip">
        <p className="cs-empty">Jedes Foto ist ein Blatt.</p>
        <div className="cs-row" id="csRow" ref={csRowRef}>
          {blaetter.map((b, i) => {
            const n = seitenVon(b);
            const img = b.target ? b.target.bild : b.pages[0]?.bild;
            return (
              <button
                key={b.key}
                className="cs-mini"
                type="button"
                data-k={b.key}
                style={img ? { backgroundImage: `url("${img}")` } : undefined}
                aria-label={`Blatt ${i + 1}${n > 1 ? `, ${n} Seiten` : ""}, ansehen`}
                onClick={openCamSheet}
              >
                <span className="n" hidden={n < 2}>
                  {n}
                </span>
              </button>
            );
          })}
          {blaetter.length ? (
            <button
              className="cs-add"
              type="button"
              id="csAdd"
              aria-pressed={armed}
              aria-disabled={letztesVoll(blaetter) || undefined}
              aria-label={armed ? "Nächstes Foto kommt als Seite an das letzte Blatt" : "Seite an das letzte Blatt dazu"}
              onClick={() => {
                if (!st.current.armed && letztesVoll(st.current.blaetter)) {
                  toast(BLATT_VOLL_TOAST);
                  return;
                }
                st.current.armed = !st.current.armed;
                setArmed(st.current.armed);
              }}
            >
              <Icon name="add" />
              Seite dazu
            </button>
          ) : null}
        </div>
      </div>
      <div className="cam-bottom">
        <span className="cam-n" id="camN" aria-live="polite">
          {camN}
        </span>
        <button className={`shutter${bereit ? "" : " off"}`} id="shutter" type="button" aria-label="Auslösen" onClick={ausloesen}>
          <i />
        </button>
        <button className={`ablegen${mitSeiten.length ? " on" : ""}`} id="ablegen" type="button" ref={ablegenRef} onClick={ablegen}>
          Fertig
        </button>
      </div>
      <button className="fotos" id="fotos" type="button" onClick={() => fileLibRef.current?.click()}>
        Aus Fotos
      </button>
      <div className="cam-sheet" id="camSheet" role="dialog" aria-label="Aufgenommene Blätter" ref={camSheetRef}>
        <div className="cs-head">
          <span id="csTitle">{`${cap(zahl(nSheet, "n"))} ${nSheet === 1 ? "Blatt" : "Blätter"}`}</span>
          <button type="button" id="csDone" onClick={() => closeCamSheet()}>
            Zurück
          </button>
        </div>
        <div className="cs-grid" id="csGrid">
          {sheetOffen
            ? mitSeiten.map((b) => {
                const pn = b.pages.length;
                const img = b.target ? b.target.bild : b.pages[0]?.bild;
                return (
                  <figure key={b.key}>
                    <span className="pg" style={img ? { backgroundImage: `url("${img}")` } : undefined} />
                    <figcaption>{b.target ? `+${pn} ${pn === 1 ? "Seite" : "Seiten"}` : `${pn} ${pn === 1 ? "Seite" : "Seiten"}`}</figcaption>
                    <button type="button" aria-label={`${b.target ? "Neue Seiten" : "Blatt"} entfernen`} onClick={() => removeSheet(b)}>
                      Entfernen
                    </button>
                  </figure>
                );
              })
            : null}
        </div>
      </div>
      <input
        type="file"
        id="fileLib"
        accept="image/*"
        hidden
        ref={fileLibRef}
        onChange={(e) => {
          void ausDatei(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        id="fileCap"
        accept="image/*"
        capture="environment"
        hidden
        ref={fileCapRef}
        onChange={(e) => {
          void ausDatei(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </section>
  );
}
