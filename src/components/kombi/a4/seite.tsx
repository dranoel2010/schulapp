import { Fragment, type CSSProperties, type ReactNode } from "react";

import type { ArbeitsblattInhalt } from "@/lib/arbeitsblatt/schema";
import { dm, voll } from "@/lib/kombi/text";

import { Kaestchen } from "./kaestchen";
import { Loesung } from "./loesung";

/**
 * Das A4-Blatt (Prototyp `a4HTML`, Z. 4352ff.): ein Blatt, drei
 * Darstellungen — Vorschau auf dem Tisch, Lesegröße (`flow`) und Druck. Alle
 * drei bauen dasselbe `.a4`, gestaltet in src/app/kombi.css. Der Inhalt wird
 * als Text gesetzt, nie als HTML; `{…}` wird eine Formel (`.m`, Newsreader
 * kursiv), `___` eine Lücke (`.gap`).
 */

const ABC = "abcdefgh";

/** Text mit {Formeln} und, auf Wunsch, ___-Lücken als React-Teile (Prototyp `mx`, `gapx`). */
export function Mx({ text, luecken = false }: { text: string; luecken?: boolean }) {
  const teile: ReactNode[] = [];
  const re = /\{([^}]+)\}/g;
  let last = 0;
  let k = 0;
  const normal = (t: string) => {
    if (!luecken) {
      if (t) teile.push(<Fragment key={k++}>{t}</Fragment>);
      return;
    }
    t.split("___").forEach((s, i, alle) => {
      if (s) teile.push(<Fragment key={k++}>{s}</Fragment>);
      if (i < alle.length - 1) teile.push(<span key={k++} className="gap" />);
    });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    normal(text.slice(last, m.index));
    teile.push(
      <span key={k++} className="m">
        {m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  normal(text.slice(last));
  return <>{teile}</>;
}

/** Die Teile a), b), … (Prototyp `teileHTML`): kurze in einer Zeile, lange je eine. */
export function Teile({ liste, kursiv, marke = true }: { liste: string[]; kursiv?: boolean; marke?: boolean }) {
  const kurz = liste.every((x) => x.replace(/[{}]/g, "").length <= 22);
  if (kurz) {
    return (
      <p className="a4-parts">
        {liste.map((x, i) => (
          <span key={i} className="p">
            {marke ? <span className="lb">{ABC[i]})</span> : null}
            <span className={kursiv ? "fr" : undefined}>
              <Mx text={x} luecken />
            </span>
          </span>
        ))}
      </p>
    );
  }
  return (
    <>
      {liste.map((x, i) => (
        <p key={i}>
          {marke ? <span className="tl">{ABC[i]})</span> : null}
          <span className={kursiv ? "fr" : undefined}>
            <Mx text={x} luecken />
          </span>
        </p>
      ))}
    </>
  );
}

/** „Aus deinen Blättern vom 8.10.: »Scheitelpunktform, Übungen«“ */
export function Quellen({ inhalt }: { inhalt: ArbeitsblattInhalt }) {
  const tage = [...new Set(inhalt.quellen.map((q) => dm(q.datum)))];
  return (
    <>
      {`Aus deinen Blättern vom ${tage.join(" und ")}: `}
      {inhalt.quellen.slice(0, 3).map((q, i) => (
        <Fragment key={q.materialId}>
          {i > 0 ? ", " : null}
          <b>{`»${q.titel || q.zitat}«`}</b>
        </Fragment>
      ))}
    </>
  );
}

export type A4Daten = {
  fach: string;
  thema: string;
  /** App-Tag 'YYYY-MM-DD' für den Kopf */
  tag: string;
  inhalt: ArbeitsblattInhalt;
  /** Probeklausur: Kopf „⟨Fach⟩ · Probeklausur“ statt „· Arbeitsblatt“ */
  probe?: boolean;
};

export function A4Seite({
  daten,
  seite,
  flow = false,
  style,
}: {
  daten: A4Daten;
  seite: 1 | 2;
  /** Lesegröße: umbrochen auf die Bildschirmbreite, ohne Kästchen */
  flow?: boolean;
  /** Vorschau: `transform: scale(…)` auf dem Blatt selbst (fitBlatt) */
  style?: CSSProperties;
}) {
  const { inhalt } = daten;
  const datum = `${voll(daten.tag)} ${daten.tag.slice(0, 4)}`;
  const kopf = (
    <div className="a4-top">
      <span>
        <b>{daten.fach}</b> · {seite === 1 ? (daten.probe ? "Probeklausur" : "Arbeitsblatt") : "Lösungen"}
      </span>
      <span>{datum}</span>
    </div>
  );
  const klasse = `a4${flow ? " flow" : ""}`;

  if (seite === 1) {
    return (
      <div className={klasse} aria-hidden="true" style={style}>
        {kopf}
        <h1>{daten.thema}</h1>
        <p className="a4-sub">
          {`${inhalt.teil} · ${inhalt.aufgaben.length} Aufgaben, von leicht nach schwer · etwa ${inhalt.minuten} Minuten`}
        </p>
        <p className="a4-src">
          <Quellen inhalt={inhalt} />
        </p>
        <ol className="a4-list" style={{ listStyle: "none" }}>
          {inhalt.aufgaben.map((a, i) => (
            <li key={i} className="a4-task">
              <span className="a4-nr">{i + 1}</span>
              <div>
                <p className="a4-q">
                  <Mx text={a.q} />
                </p>
                {a.teile ? (
                  <div className={a.teile.some((x) => x.includes("___")) ? "a4-luecke" : ""}>
                    <Teile liste={a.teile} kursiv={a.fr} />
                  </div>
                ) : null}
                {a.platz ? <Kaestchen papier={inhalt.papier} n={a.platz} /> : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="a4-foot">
          <span>
            {inhalt.papier === "kaestchen" ? "Rechne in den Kästchen." : "Schreib auf die Linien."} Die Lösungen stehen
            auf Seite 2.
          </span>
          <b>1 / 2</b>
        </div>
      </div>
    );
  }

  const kursiv = inhalt.papier === "linien";
  return (
    <div className={klasse} aria-hidden="true" style={style}>
      {kopf}
      <h1>Lösungen</h1>
      <p className="a4-sub">
        {`${daten.thema} · ${inhalt.teil}${inhalt.papier === "kaestchen" ? ", mit Rechenweg" : ""}`}
      </p>
      <p className="a4-src">Erst nach dem Lösen ansehen. Danach trägst du in der App je Aufgabe ein, ob sie richtig war.</p>
      <ol className="a4-sol" style={{ listStyle: "none" }}>
        {inhalt.aufgaben.map((a, i) => (
          <li key={i} className="a4-task a4-s">
            <span className="a4-nr">{i + 1}</span>
            <div>
              <Loesung teile={a.l} kursiv={kursiv} />
            </div>
          </li>
        ))}
      </ol>
      <div className="a4-foot">
        <span>
          <Quellen inhalt={inhalt} />
        </span>
        <b>2 / 2</b>
      </div>
    </div>
  );
}
