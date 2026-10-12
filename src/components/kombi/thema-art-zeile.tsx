"use client";

import { useRef, useState } from "react";

import { artAction, artZuruecknehmenAction } from "@/app/(app)/arbeitsblatt-actions";
import { useKombi } from "@/components/kombi/kontext";
import { artText, type ThemaMitArt } from "@/lib/arbeitsblatt/art-text";
import { swapText } from "@/lib/kombi/motion";

/**
 * Art je Thema umstellen (Kriterium 5; Prototyp `themaArtRow`, Z. 3210):
 * „Abfragen“ mit Karten oder „Üben“ mit Arbeitsblatt, als `.seg2` in einer
 * `.lrow`. Toast „Ab jetzt mit Arbeitsblatt“ / „Ab jetzt mit Karten“ mit
 * Rückgängig. Optimistisch: scheitert das Speichern, kommt erst der Toast
 * „Nicht gespeichert“, dann springt die Wahl zurück (Plan 2.4, Punkt 9).
 */
export function ThemaArtZeile({ thema }: { thema: ThemaMitArt }) {
  const kombi = useKombi();
  const [art, setArt] = useState(thema.art);
  const subRef = useRef<HTMLSpanElement>(null);

  const zeigen = (neu: typeof art) => {
    setArt(neu);
    if (subRef.current) swapText(subRef.current, artText(thema, neu));
  };

  async function waehlen(neu: typeof art) {
    if (neu === art) return;
    const vorher = art;
    zeigen(neu);
    const a = await artAction(thema.id, neu).catch(() => null);
    if (!a?.ok) {
      kombi.fehlerToast("Nicht gespeichert", () => void waehlen(neu), "Erneut");
      setTimeout(() => zeigen(vorher), 320);
      return;
    }
    kombi.toast(neu === "ueben" ? "Ab jetzt mit Arbeitsblatt" : "Ab jetzt mit Karten", () => {
      zeigen(vorher);
      void artZuruecknehmenAction(thema.id, a.daten).then((r) => {
        if (!r.ok) {
          kombi.fehlerToast("Nicht gespeichert", () => void artZuruecknehmenAction(thema.id, a.daten), "Erneut");
          zeigen(neu);
        }
      });
    });
  }

  return (
    <div className="lrow plain" style={{ cursor: "default", display: "block" }}>
      <span>
        <b>{thema.title}</b>
        <span className="s" ref={subRef}>
          {artText(thema, thema.art)}
        </span>
      </span>
      <div className="seg2" role="group" aria-label={`Art von ${thema.title}`} style={{ margin: "8px 0 2px" }}>
        <button type="button" aria-pressed={art === "abfragen"} onClick={() => void waehlen("abfragen")}>
          Abfragen
        </button>
        <button type="button" aria-pressed={art === "ueben"} onClick={() => void waehlen("ueben")}>
          Üben
        </button>
      </div>
    </div>
  );
}

/** Der Abschnitt „Themen“ der Fachseite (Prototyp Z. 3188). */
export function ThemenArt({ themen, mitTitel = true }: { themen: ThemaMitArt[]; mitTitel?: boolean }) {
  if (themen.length === 0) return null;
  return (
    <section>
      {mitTitel ? <h3 className="p-lab">Themen</h3> : null}
      {themen.map((t) => (
        <ThemaArtZeile key={t.id} thema={t} />
      ))}
    </section>
  );
}
