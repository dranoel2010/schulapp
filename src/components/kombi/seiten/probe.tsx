"use client";

import Link from "next/link";
import { useState } from "react";

import { probeAbhakenAction } from "@/app/(app)/kombi-probe/actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { useOptimistischeAktion } from "@/lib/kombi/aktion";
import type { ProbeDaten } from "@/lib/seiten/probe";

/**
 * Die Probe-Stapelseite (Abschnitt A): offene Aufgaben zum Abhaken, eine
 * Zeile eine Ebene tiefer und eine Zeile zu einem Formular (echte Route).
 * Gestalt aus den vorhandenen Bausteinen (`.task`, `.lrow`, `.textbtn`);
 * sie verschwindet, sobald G die echten Seiten bringt.
 */

export const probeTitel = (p: Record<string, string>): string =>
  p.ebene && p.ebene !== "1" ? `Probe, Ebene ${p.ebene}` : "Probe";

type Aufgabe = ProbeDaten["aufgaben"][number];
type Umschalten = { id: string; done: boolean };

export function ProbeInhalt({ daten }: { params: Record<string, string>; daten: ProbeDaten }) {
  const kombi = useKombi();
  const [liste, setListe] = useState<Aufgabe[]>(daten.aufgaben);
  const [vorher, setVorher] = useState(daten);
  if (vorher !== daten) {
    // neue Daten vom Server (neuLaden): sie gelten
    setVorher(daten);
    setListe(daten.aufgaben);
  }

  const [sicht, ausfuehren] = useOptimistischeAktion<Aufgabe[], Umschalten>(
    liste,
    (s, a) => s.map((x) => (x.id === a.id ? { ...x, done: a.done } : x)),
    kombi.fehlerToast,
  );

  function abhaken(a: Aufgabe, scheitern = false) {
    const done = !a.done;
    ausfuehren(
      { id: a.id, done },
      () => probeAbhakenAction({ id: a.id, done, scheitern }),
      () => {
        setListe((l) => l.map((x) => (x.id === a.id ? { ...x, done } : x)));
        if (done) {
          kombi.toast(`${a.fach} abgehakt`, () => abhaken({ ...a, done: true }), a.text);
        }
        void kombi.neuLaden();
      },
    );
  }

  const tiefer = String(daten.ebene + 1);
  const erste = sicht.find((a) => !a.done);

  return (
    <>
      <div className="group">
        <h3 className="lab">Aufgaben</h3>
        <div>
          {sicht.length === 0 ? <p className="empty">Nichts offen.</p> : null}
          {sicht.map((a) => (
            <div key={a.id} className={`task${a.done ? " done" : ""}`} data-id={a.id} data-mode="page">
              <div className="t-under" aria-hidden="true">
                <Icon name="check" />
              </div>
              <div className="t-front">
                <button
                  className="check"
                  type="button"
                  aria-pressed={a.done}
                  aria-label={`${a.fach}, ${a.text}, ${a.done ? "wieder öffnen" : "abhaken"}`}
                  onClick={() => abhaken(a)}
                >
                  <span className="ring">
                    <span className="cfill">
                      <Icon name="check" />
                    </span>
                  </span>
                </button>
                <div className="t-text">
                  <p className="t-title">
                    <b>{a.fach}</b>
                    <span className="t-txt">{a.text}</span>
                  </p>
                </div>
                <span />
              </div>
            </div>
          ))}
        </div>
      </div>
      <h3 className="p-lab">Probe</h3>
      {daten.ebene < 3 ? (
        <button
          className="lrow plain"
          type="button"
          onPointerDown={() => kombi.vorladen("probe", { ebene: tiefer })}
          onClick={() => kombi.openPage("probe", { ebene: tiefer })}
        >
          <span>
            <b>Eine Ebene tiefer</b>
            <span className="s">Seite {tiefer} im Stapel</span>
          </span>
          <Icon name="chevron_right" />
        </button>
      ) : null}
      <Link className="lrow plain" href="/kombi-probe/formular">
        <span>
          <b>Aufgabe eintragen</b>
          <span className="s">Formular als echte Route</span>
        </span>
        <Icon name="chevron_right" />
      </Link>
      {erste ? (
        <button className="textbtn" type="button" onClick={() => abhaken(erste, true)}>
          Abhaken scheitern lassen
        </button>
      ) : null}
    </>
  );
}
