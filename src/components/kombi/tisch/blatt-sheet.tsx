"use client";

import { useEffect, useState } from "react";

import { blattHolen } from "@/components/kombi/tisch/daten";
import type { BlattImSheet } from "@/components/kombi/tisch/typen";
import { fxTeile } from "@/lib/kombi/text";

/**
 * „Blatt ansehen“ von der Rückseite einer Karte: das Blatt als Sheet von
 * unten auf dem Tisch (Prototyp `openSheet` mit `abschriftEl`, Z. 3236 und
 * 3335): Titel, „Fach, n Seiten“, darunter die Abschrift. Ohne Abschrift
 * steht „Abschrift folgt“.
 */
export function BlattSheet({ id }: { id: string }) {
  const [blatt, setBlatt] = useState<BlattImSheet | null>(null);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    let weg = false;
    blattHolen(id).then(
      (b) => {
        if (!weg) setBlatt(b);
      },
      () => {
        if (!weg) setFehler(true);
      },
    );
    return () => {
      weg = true;
    };
  }, [id]);

  if (fehler) return <p className="p-sub">Keine Verbindung</p>;
  if (!blatt) return null;

  const absaetze = blatt.abschrift
    .filter((t): t is string => !!t && t.trim().length > 0)
    .flatMap((t) => t.split(/\n\s*\n/))
    .map((a) => a.trim())
    .filter(Boolean);

  return (
    <>
      <h2 className="p-title">{blatt.titel}</h2>
      <p className="p-sub">
        {blatt.fach}, {blatt.seiten} {blatt.seiten === 1 ? "Seite" : "Seiten"}
      </p>
      <div className="abschrift">
        {absaetze.length === 0 ? (
          <p className="p-sub">Abschrift folgt</p>
        ) : (
          absaetze.map((a, i) => (
            <p key={i} style={{ whiteSpace: "pre-line" }}>
              {fxTeile(a).map((t, k) =>
                t.formel ? (
                  <span key={k} className={`f-in${t.lead ? " lead" : ""}`}>
                    {t.text}
                  </span>
                ) : (
                  t.text
                ),
              )}
            </p>
          ))
        )}
      </div>
    </>
  );
}
