"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ABFRAGE_FRIST_MS,
  BERUEHRT_RUHE_MS,
  antwortLesen,
  beimKnopf,
  entscheiden,
  istEingabefeld,
  naechsteAbfrageIn,
  sofortFragen,
  sperreAus,
  type Anstoss,
  type BlaetterStand,
} from "@/lib/blaetter-stand";

/**
 * Die Blätter laden sich von selbst nach (seit dem 6.10.2026).
 *
 * Steht einmal auf jeder der vier Ansichten — Ablage, Blattseite,
 * Eingangskorb, Vorschlagsseite — und fragt `/api/material/stand`: alle fünf
 * Sekunden, solange gelesen wird, sonst alle dreißig, und nur, solange der Tab
 * sichtbar ist. Wer zurück in den Tab kommt, bekommt sofort eine Frage. Ist
 * der Stand ein anderer als der, mit dem die Seite gerendert wurde, holt
 * `router.refresh()` sie neu vom Server — ohne Scrollen, ohne dass ein State
 * im Browser verloren geht. Ist er derselbe, passiert nichts. Was gezählt und
 * entschieden wird, steht in @/lib/blaetter-stand.
 *
 * **Eingaben gehen vor.** Nachgeladen wird nicht,
 *
 * - solange ein Formular der Seite `data-ungespeichert` trägt — dann steht
 *   unten ein Hinweis ohne Knopf: ein „Neu laden“ dort könnte Getipptes
 *   kosten (`savedMark` in material-form.tsx, der Schlüssel in
 *   proposal-form.tsx). Nach dem Speichern kommt der neue Stand mit der
 *   Antwort, und der Hinweis geht von selbst;
 * - solange ein Eingabefeld den Fokus hat — dann ein Hinweis mit „Neu laden“,
 *   und der Knopf sieht beim Druck noch einmal nach, ob inzwischen getippt
 *   wurde;
 * - solange der Auslöser hochlädt oder sein Sucher offen ist
 *   (`data-aufnahme-laeuft` in capture-button.tsx) — er lädt am Ende selbst
 *   nach;
 * - solange eben gescrollt oder mit Maus oder Finger gezeigt wurde
 *   (`BERUEHRT_RUHE_MS`) — wer auf „Übernehmen“ zielt, soll nicht die Zeile
 *   darunter treffen. Hier gibt es keinen Hinweis; gefragt wird gleich noch
 *   einmal.
 *
 * Wer auf diese Seiten ein weiteres Formular stellt, muss daran
 * `data-ungespeichert` setzen, solange darin etwas steht, das der Server nicht
 * kennt. Sonst lädt dieser Baustein ihm unter den Fingern nach.
 *
 * Fehler bleiben leise: kein Fenster, keine Meldung, die nächste Frage in
 * dreißig Sekunden. Bei 401 hört er ganz auf. Nie zwei Fragen zugleich.
 */

const STAND_ADRESSE = "/api/material/stand";

/** Wie es nach einer Frage weitergeht: im Takt, nach einem Fehler, oder bald. */
type Ausgang = "takt" | "fehler" | "bald";

/** Was eine Frage an den Server ergeben hat. */
type Antwort =
  | { art: "stand"; stand: BlaetterStand }
  | { art: "abgemeldet" }
  | { art: "fehler" };

/**
 * Eine Frage an den Server. Wirft nie: Netz weg, Zeit abgelaufen, 5xx oder
 * eine Antwort, die nicht wie ein Stand aussieht, sind alle „fehler“.
 */
async function standHolen(): Promise<Antwort> {
  try {
    const antwort = await fetch(STAND_ADRESSE, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(ABFRAGE_FRIST_MS),
    });
    if (antwort.status === 401) return { art: "abgemeldet" };
    if (!antwort.ok) return { art: "fehler" };

    const stand = antwortLesen(await antwort.json().catch(() => null));
    return stand ? { art: "stand", stand } : { art: "fehler" };
  } catch {
    return { art: "fehler" };
  }
}

/** Steht der Fokus gerade in einem Feld, in das getippt wird? */
function eingabeHatFokus(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;

  return istEingabefeld({
    tag: el.tagName,
    typ: el instanceof HTMLInputElement ? el.type : null,
    editierbar: el.isContentEditable,
  });
}

const ungespeichert = () =>
  document.querySelector("form[data-ungespeichert]") !== null;

const aufnahmeLaeuft = () =>
  document.querySelector("[data-aufnahme-laeuft]") !== null;

export type AutoRefreshProps = {
  /** Der Fingerabdruck, mit dem die Seite gerendert wurde (`blaetterStand()`). */
  stand: string;
  /** Wird gerade gelesen? Bestimmt den Takt — und ob die Zeile dasteht. */
  inArbeit: boolean;
  /**
   * Die Zeile „Ein Blatt wird gerade gelesen …“ zeigen, solange gelesen wird.
   * Falsch dort, wo die Seite das Lesen schon selbst anzeigt.
   */
  leseZeile: boolean;
};

export function AutoRefresh({ stand, inArbeit, leseZeile }: AutoRefreshProps) {
  const router = useRouter();

  /**
   * Der Hinweis — und der Stand, gegen den er entschieden wurde. Gezeigt wird
   * er nur, solange die Seite noch in genau diesem Stand gerendert ist: ein
   * neuer Stand vom Server, nachgeladen oder nach dem Speichern, nimmt ihn
   * schon im ersten Bild weg. Auch einer, dessen Antwort erst nach dem neuen
   * Stand ankommt, kann so nicht stehen bleiben.
   */
  const [hinweis, setHinweis] = useState<{
    art: "ungespeichert" | "fokus";
    bei: string;
  } | null>(null);
  const zeigeHinweis =
    hinweis !== null && hinweis.bei === stand ? hinweis.art : null;

  const aktiv = useRef(false);
  const laeuft = useRef(false);
  const abgemeldet = useRef(false);
  const letzteAbfrage = useRef<number | null>(null);
  const zuletztGesehen = useRef<string | null>(null);
  const angestossen = useRef<Anstoss | null>(null);
  const zuletztInArbeit = useRef(inArbeit);
  /** Wann zuletzt gescrollt oder gezeigt wurde. */
  const zuletztBewegt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `planen()` aus dem Effekt unten, damit neue Props den Takt neu stellen. */
  const neuPlanen = useRef<((ausgang: Ausgang) => void) | null>(null);

  /**
   * Was aus einer Antwort folgt; zurück kommt, wie es weitergeht.
   *
   * Ein Effect Event und erst NACH dem Warten auf den Server aufgerufen: so
   * vergleicht es mit dem `stand`, mit dem die Seite JETZT gerendert ist, und
   * nicht mit dem von vor der Frage. Dazwischen kann gespeichert oder
   * nachgeladen worden sein.
   */
  const auswerten = useEffectEvent((antwort: Antwort): Ausgang => {
    // Abgemeldet, etwa in einem anderen Tab: hier gibt es nichts mehr zu
    // fragen, und die Seite selbst schickt beim nächsten Klick zur Anmeldung.
    if (antwort.art === "abgemeldet") {
      abgemeldet.current = true;
      setHinweis(null);
      return "takt";
    }
    // Netz weg, Zeit abgelaufen, Server verschluckt: leise, im ruhigen Takt
    // weiter.
    if (antwort.art === "fehler") return "fehler";
    if (!aktiv.current) return "takt";

    const gelesen = antwort.stand;
    zuletztInArbeit.current = gelesen.inArbeit;
    zuletztGesehen.current = gelesen.stand;

    const sperre = sperreAus({
      aufnahme: aufnahmeLaeuft(),
      ungespeichert: ungespeichert(),
      fokus: eingabeHatFokus(),
      beruehrt: Date.now() - zuletztBewegt.current < BERUEHRT_RUHE_MS,
    });
    const tun = entscheiden({
      bekannt: stand,
      neu: gelesen.stand,
      sperre,
      angestossen: angestossen.current,
      jetzt: Date.now(),
    });

    if (tun === "neu-laden") {
      angestossen.current = { stand: gelesen.stand, seit: Date.now() };
      router.refresh();
    }

    setHinweis(
      tun === "hinweis" && (sperre === "ungespeichert" || sperre === "fokus")
        ? { art: sperre, bei: stand }
        : null,
    );
    return tun === "spaeter" ? "bald" : "takt";
  });

  /*
   * Der Takt. `planen` und `runde` stehen hier im Effekt und nicht als Effect
   * Events daneben: sie rufen einander gegenseitig auf, und das lässt der
   * React Compiler zwischen zwei Effect Events nicht zu.
   */
  useEffect(() => {
    aktiv.current = true;

    /** Die nächste Frage stellen — oder keine, wenn der Tab versteckt ist. */
    function planen(ausgang: Ausgang) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (!aktiv.current) return;

      const ms = naechsteAbfrageIn({
        sichtbar: document.visibilityState === "visible",
        inArbeit: zuletztInArbeit.current,
        fehler: ausgang === "fehler",
        abgemeldet: abgemeldet.current,
        bald: ausgang === "bald",
      });
      if (ms !== null) timer.current = setTimeout(() => void runde(), ms);
    }

    async function runde() {
      // Nie zwei zugleich: die zweite fiele nur mit der ersten zusammen.
      if (laeuft.current || abgemeldet.current || !aktiv.current) return;
      if (document.visibilityState !== "visible") {
        planen("takt");
        return;
      }

      laeuft.current = true;
      letzteAbfrage.current = Date.now();
      let ausgang: Ausgang = "fehler";

      try {
        ausgang = auswerten(await standHolen());
      } finally {
        laeuft.current = false;
        planen(ausgang);
      }
    }

    // Versteckt: Takt aus. Zurück: sofort fragen, außer es wurde eben erst
    // gefragt — `visibilitychange` und `focus` kommen beim Wechsel beide.
    function zurueck() {
      if (document.visibilityState !== "visible") {
        planen("takt");
        return;
      }
      if (sofortFragen(Date.now(), letzteAbfrage.current)) void runde();
      else planen("takt");
    }

    // Nur die Uhrzeit merken — das kostet bei jeder Mausbewegung nichts.
    // `scroll` im Capture, damit auch eine scrollende Liste in der Seite zählt.
    function bewegt() {
      zuletztBewegt.current = Date.now();
    }
    const leise = { capture: true, passive: true } as const;

    neuPlanen.current = planen;
    document.addEventListener("visibilitychange", zurueck);
    window.addEventListener("focus", zurueck);
    window.addEventListener("pointerdown", bewegt, leise);
    window.addEventListener("pointermove", bewegt, leise);
    window.addEventListener("wheel", bewegt, leise);
    document.addEventListener("scroll", bewegt, leise);

    return () => {
      aktiv.current = false;
      neuPlanen.current = null;
      document.removeEventListener("visibilitychange", zurueck);
      window.removeEventListener("focus", zurueck);
      window.removeEventListener("pointerdown", bewegt, leise);
      window.removeEventListener("pointermove", bewegt, leise);
      window.removeEventListener("wheel", bewegt, leise);
      document.removeEventListener("scroll", bewegt, leise);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  // Neue Props — nach dem Nachladen, nach einer eigenen Aufnahme — stellen den
  // Takt neu: wer hier eben ein Blatt aufgenommen hat, ist sofort im
  // schnellen Takt. Steht hinter dem Effekt oben, damit `planen` beim ersten
  // Mal schon da ist.
  useEffect(() => {
    zuletztInArbeit.current = inArbeit;
    neuPlanen.current?.("takt");
  }, [inArbeit, stand]);

  /**
   * Nur im Fokus-Fall angeboten. Ob seitdem etwas Ungespeichertes dazukam,
   * sieht erst der Druck selbst (`beimKnopf()`) — der Hinweis steht bis zur
   * nächsten Frage.
   */
  function neuLaden() {
    const tun = beimKnopf(
      sperreAus({
        aufnahme: aufnahmeLaeuft(),
        ungespeichert: ungespeichert(),
        fokus: false,
      }),
    );

    if (tun === "hinweis") {
      setHinweis({ art: "ungespeichert", bei: stand });
      return;
    }

    setHinweis(null);
    if (tun === "nichts") return;

    angestossen.current = {
      stand: zuletztGesehen.current ?? stand,
      seit: Date.now(),
    };
    setHinweis(null);
    router.refresh();
  }

  return (
    <>
      {/* Folgt der Prop und nicht der letzten Antwort: die Zeile kommt und
          geht nur mit einem Nachladen, also nie, während jemand tippt. */}
      {leseZeile && inArbeit ? (
        <p className="text-sm text-muted">
          Ein Blatt wird gerade gelesen … die Anzeige aktualisiert sich von
          selbst.
        </p>
      ) : null}

      {/* Unten am Rand und `fixed`: verschiebt nichts auf der Seite. Unter
          dem Sucher (z-50), nicht darüber. */}
      {zeigeHinweis ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div
            role="status"
            className="pointer-events-auto flex max-w-full items-center gap-3 rounded-pill border border-border bg-surface py-1.5 pl-4 pr-1.5 text-sm text-foreground shadow-lift"
          >
            {zeigeHinweis === "fokus" ? (
              <>
                <span>Neuer Stand da.</span>
                <Button type="button" variant="secondary" onClick={neuLaden}>
                  Neu laden
                </Button>
              </>
            ) : (
              <span className="py-2.5 pr-2.5">
                Neuer Stand da — er erscheint, sobald du gespeichert hast.
              </span>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
