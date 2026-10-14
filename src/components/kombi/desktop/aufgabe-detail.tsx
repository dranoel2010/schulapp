"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { aufgabeSetzenAction } from "@/app/(app)/hausaufgaben/zeile-actions";
import { useKombi } from "@/components/kombi/kontext";
import { relTageSeite } from "@/components/kombi/seiten/klausur";
import { BlattRow } from "@/components/kombi/seiten/zeilen";
import { Tn } from "@/components/kombi/tn";
import { lang } from "@/lib/kombi/text";
import type { AufgabeSeite } from "@/lib/seiten/hausaufgaben";

import { detailSlotSetzen } from "./auswahl";
import { useSeitenDaten } from "./liste-detail";

/**
 * Das Detail einer Aufgabe am Rechner (desktop.html `aufgabeDetail`), rechts
 * neben der Liste „Hausaufgaben“. Die Aufgabe hat keine Seite der Registry;
 * ihre Daten kommen aus dem Loader `aufgabe` (src/lib/seiten/hausaufgaben.ts).
 *
 * - Fach und Aufgabe als Überschrift, darunter Abgabe mit relativer Angabe,
 *   die Stunde des Fachs an diesem Tag, Eingetragen und Erledigt;
 * - die jüngsten Blätter des Fachs;
 * - „Erledigt“ bzw. „Wieder öffnen“ (wie der Ring in der Liste, mit Strich und
 *   Rückgängig, auch per Taste X) und „Bearbeiten“, das das Formular der App
 *   im Detail öffnet (/hausaufgaben/<id>).
 */

detailSlotSetzen("hausaufgaben", (sel) => <AufgabeDetail key={sel} id={sel} />);

function AufgabeDetail({ id }: { id: string }) {
  const kombi = useKombi();
  const router = useRouter();
  const { daten, ohneNetz } = useSeitenDaten("aufgabe", { id });
  const a = daten as AufgabeSeite | undefined;
  const [arbeitet, setArbeitet] = useState(false);
  if (!a) return ohneNetz ? <p className="empty">Ohne Verbindung. Diese Aufgabe war noch nicht geöffnet.</p> : null;

  const schalten = () => {
    // Steht die Aufgabe in der Liste, schaltet ihr Ring: derselbe Strich, Toast und Rückgängig
    const ring = document.querySelector<HTMLElement>(`.d-list .task[data-id="${CSS.escape(a.id)}"] .check`);
    if (ring) {
      ring.click();
      return;
    }
    // Sonst (eine Aufgabe aus dem Archiv) direkt
    if (arbeitet) return;
    setArbeitet(true);
    aufgabeSetzenAction(a.id, !a.done)
      .then(async (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        kombi.toast(a.done ? `${a.fach} wieder offen` : `${a.fach} abgehakt`, null, `${a.fach}, ${a.text}`);
        await kombi.neuLaden();
      })
      .catch(() => kombi.fehlerToast("Nicht gespeichert", schalten, "Erneut"))
      .finally(() => setArbeitet(false));
  };

  const stunde = a.stunde ? [`${a.stunde.nr}. Stunde`, a.stunde.von, a.stunde.raum].filter(Boolean).join(", ") : null;

  return (
    <div className="d-aufgabe">
      <h1 className="d-h1">
        {a.fach}: {a.text}
      </h1>
      <div className="d-facts">
        <div className="d-fact">
          <span>Abgabe</span>
          <span>
            <Tn s={lang(a.due)} /> <em>{relTageSeite(a.heute, a.due)}</em>
          </span>
        </div>
        {stunde ? (
          <div className="d-fact">
            <span>Stunde</span>
            <span>
              <Tn s={stunde} />
            </span>
          </div>
        ) : null}
        <div className="d-fact">
          <span>Eingetragen</span>
          <span>
            <Tn s={lang(a.eingetragen)} />
          </span>
        </div>
        {a.done && a.erledigtAm ? (
          <div className="d-fact">
            <span>Erledigt</span>
            <span>
              <Tn s={lang(a.erledigtAm)} />
            </span>
          </div>
        ) : null}
        {a.notiz ? (
          <div className="d-fact">
            <span>Notiz</span>
            <span className="d-notiz">{a.notiz}</span>
          </div>
        ) : null}
      </div>
      {a.blaetter.length ? (
        <>
          <h3 className="p-lab">Blätter in {a.fachName}</h3>
          <div>
            {a.blaetter.map((b) => (
              <BlattRow key={b.id} b={b} />
            ))}
          </div>
        </>
      ) : null}
      <div className="d-foot">
        <button className="btn primary" type="button" disabled={arbeitet} onClick={schalten}>
          {a.done ? "Wieder öffnen" : "Erledigt"}
          <span className="d-k" aria-hidden="true">
            X
          </span>
        </button>
        <button className="btn quiet" type="button" onClick={() => router.push(`/hausaufgaben/${a.id}`)}>
          Bearbeiten
        </button>
      </div>
    </div>
  );
}
