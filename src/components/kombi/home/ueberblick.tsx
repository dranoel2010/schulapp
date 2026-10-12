"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AufgabeZeile } from "@/components/kombi/aufgabe-zeile";
import { WiederholenBlock } from "@/components/kombi/home/wiederholen";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { E, reduce } from "@/lib/kombi/motion";
import {
  eingangskorbText,
  fmtRest,
  lbDauer,
  lernblockRest,
  relTage,
  tagName,
  verpasstText,
  weitereKlausuren,
  type AufgabeT,
  type BlattT,
  type LernblockT,
  type TagDaten,
} from "@/lib/kombi/startseite";
import { kurz, tn, weekdayOrDate } from "@/lib/kombi/text";

/**
 * Der Überblick (V2 Abschnitt 4, Prototyp `renderUeberblick`, Z. 1932):
 * Aufgaben für den nächsten Schultag (ohne sichtbares Label, die Überschrift
 * sagt es), die nächste Klausur mit Lernblock, Wiederholen (Abschnitt E) und
 * „Zuletzt abgelegt“. In den Ferien nur die Blätter.
 */
export function Ueberblick({
  d,
  gezeigt,
  zeilen,
  onAbhaken,
  onBearbeiten,
  onLoeschen,
}: {
  d: TagDaten;
  gezeigt: AufgabeT[];
  zeilen: { key: string; text: string }[];
  onAbhaken: (id: string, done: boolean) => void;
  onBearbeiten: (id: string) => void;
  onLoeschen: (id: string) => void;
}) {
  const kombi = useKombi();
  const router = useRouter();
  const k = d.klausurenBald[0] ?? null;
  const weitere = weitereKlausuren(d);

  return (
    <>
      {!d.ferien ? (
        <div className="blk enter" id="ovHa">
          {/* kein sichtbares Label „Für Dienstag“: die Überschrift sagt es schon */}
          <h2 className="sr" id="ovHaLab">{`Für ${tagName(d.naechsterSchultag, d.tag)}`}</h2>
          <div id="ovHaList">
            {gezeigt.map((a) => (
              <AufgabeZeile
                key={a.id}
                a={a}
                modus="ov"
                heute={d.tag}
                onAbhaken={onAbhaken}
                onBearbeiten={onBearbeiten}
                onLoeschen={onLoeschen}
              />
            ))}
          </div>
          <div id="ovHaMore">
            {zeilen.map((l) => (
              <button
                key={l.key + l.text}
                data-k={l.key + l.text}
                className="textline more"
                type="button"
                onPointerDown={() => kombi.vorladen("hausaufgaben")}
                onClick={() => kombi.openPage("hausaufgaben")}
              >
                {l.text}
                <Icon name="chevron_right" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!d.ferien && k ? (
        <div className="blk enter" id="ovKl">
          <h2 className="lab">Klausur</h2>
          <button
            className="exam-row"
            type="button"
            aria-label={`Klausur ${k.fachName} öffnen`}
            onPointerDown={() => kombi.vorladen("klausur", { id: k.id })}
            onClick={() => kombi.openPage("klausur", { id: k.id })}
          >
            <span>
              <b>{k.fach}</b>
              <span>{`${kurz(k.datum)} · ${relTage(k.datum, d.tag)}`}</span>
            </span>
            <Icon name="chevron_right" />
          </button>
          {d.lernblock ? (
            <LernblockZeile b={d.lernblock} stand={d.stand} />
          ) : d.naechsterLernblock ? (
            <div className="lb-row">
              <p>{`Nächster Lernblock ${weekdayOrDate(d.naechsterLernblock.tag, d.tag)} · ${d.naechsterLernblock.label}`}</p>
            </div>
          ) : null}
          {d.verpasst ? (
            <button
              className="textline more"
              type="button"
              onClick={() => kombi.openPage("klausur", { id: d.verpasst!.examId })}
            >
              {verpasstText(d.verpasst, d.tag)}
              <Icon name="chevron_right" />
            </button>
          ) : null}
          {weitere ? (
            <button
              className="textline more"
              type="button"
              onPointerDown={() => kombi.vorladen("klausuren")}
              onClick={() => kombi.openPage("klausuren")}
            >
              {weitere}
              <Icon name="chevron_right" />
            </button>
          ) : null}
        </div>
      ) : null}
      <WiederholenBlock stand={d.wiederholen} />
      <div className="blk enter" id="ovBl">
        <div className="lab">
          <h2 style={{ font: "inherit" }}>Zuletzt abgelegt</h2>
          <button
            className="lab-r"
            type="button"
            onPointerDown={() => kombi.vorladen("ablage")}
            onClick={() => kombi.openPage("ablage")}
          >
            Alle
          </button>
        </div>
        <div className="thumbs" id="ovThumbs">
          {d.blaetter.map((b) => (
            <Miniatur key={b.id} b={b} />
          ))}
        </div>
        {d.eingangskorb > 0 ? (
          <button className="textline more" type="button" onClick={() => router.push("/material/eingang")}>
            {eingangskorbText(d.eingangskorb)}
            <Icon name="chevron_right" />
          </button>
        ) : null}
      </div>
    </>
  );
}

/** Zuletzt abgelegt: Titel einzeilig, darunter nur das Fach (Prototyp `thumbCell`, `cellTexts`). */
function Miniatur({ b }: { b: BlattT }) {
  const kombi = useKombi();
  const [t, s] = b.einordnen ? ["Blatt von heute", "Wird eingeordnet"] : [b.titel || "Blatt von heute", b.fachName];
  return (
    <button
      className="tcell"
      type="button"
      data-bid={b.id}
      aria-label={`Blatt ${b.titel || "ohne Titel"} öffnen`}
      onPointerDown={() => kombi.vorladen("blatt", { id: b.id })}
      onClick={() => kombi.openPage("blatt", { id: b.id })}
    >
      <span
        className="tmini"
        style={b.cover ? { backgroundImage: `url("/api/material/${b.cover}/vorschau")` } : undefined}
      />
      <b className="tc-t">{t}</b>
      <span className="tc-s">{s}</span>
    </button>
  );
}

/**
 * Die Lernblockzeile (Prototyp `ovKlausur` und `updateBlockUI`, Z. 1976–2014):
 * „Lernblock · Scheitelpunktform“, darunter die Dauer; rechts „Starten“, die
 * Restzeit, „Weiter“ oder „Erledigt“. Starten öffnet den Tisch (Abschnitt F).
 */
function LernblockZeile({ b, stand }: { b: LernblockT; stand: string }) {
  const kombi = useKombi();
  const rowRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const gezeigt = useRef(false);
  // Uhr des Servers plus die seitdem vergangene Zeit (Testuhr eingeschlossen)
  const [jetzt, setJetzt] = useState(() => Date.parse(stand));
  const done = b.zustand === "erledigt";

  useEffect(() => {
    if (b.zustand !== "laeuft") return;
    const basis = Date.parse(stand);
    const start = Date.now();
    const t = setInterval(() => setJetzt(basis + Date.now() - start), 1000);
    return () => clearInterval(t);
  }, [b.zustand, stand]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    if (done && gezeigt.current && !reduce()) {
      row.querySelector(".lbdone")?.animate(
        [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }],
        { duration: 240, easing: E.out },
      );
    }
    gezeigt.current = true;
  }, [done]);

  const rest = lernblockRest(b, Math.max(jetzt, Date.parse(stand)));
  const text =
    b.zustand === "ruhe" || done ? "Starten" : b.zustand === "pausiert" ? "Weiter" : tn(fmtRest(rest));
  const sub = done
    ? lbDauer(b.minuten)
    : b.zustand === "pausiert"
      ? `Pausiert bei ${tn(fmtRest(rest))}`
      : lbDauer(b.minuten);

  return (
    <div className={`lb-row${done ? " erledigt" : ""}`} id="lbRow" ref={rowRef}>
      <p>
        <span className="lbk">{"Lernblock · "}</span>
        {b.label}
        <span>
          <span className="lbk2">Lernblock · </span>
          <span id="lbSub" dangerouslySetInnerHTML={{ __html: sub }} />
        </span>
      </p>
      <div className="lb-act">
        <button
          className="lbbtn"
          type="button"
          id="lbBtn"
          ref={btnRef}
          tabIndex={done ? -1 : 0}
          aria-label={b.zustand === "ruhe" ? "Lernblock starten" : `Lernblock fortsetzen, noch ${fmtRest(rest)}`}
          onClick={() => kombi.openTisch({ mode: "block", blockId: b.id, examId: b.examId, origin: btnRef.current })}
        >
          <span id="lbText" dangerouslySetInnerHTML={{ __html: text }} />
        </button>
        <span className="lbdone">
          <Icon name="check" className="s18" />
          Erledigt
        </span>
      </div>
    </div>
  );
}
