"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { probeEintragenAction } from "../actions";

/**
 * Das Probe-Formular: Speichern, dann zurück — so landet Android-Zurück
 * danach auf der Seite, von der man kam (Plan 2.4, Prüfung 2). Felder in den
 * Maßen aus Plan 2.3 (Höhe 52, Radius 12, Fläche --raise, 17/450).
 */
export function ProbeFormular() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          const r = await probeEintragenAction({ text });
          if (!r.ok) {
            setFehler(r.fehler ?? "Nicht gespeichert");
            return;
          }
          router.back();
        });
      }}
    >
      <h2 className="p-title">Aufgabe eintragen</h2>
      <p className="p-sub">Probe für den Weg über ein Formular.</p>
      <label htmlFor="probe-text" style={{ display: "block", fontSize: 15, fontWeight: 560, color: "var(--ink-2)", margin: "16px 0 6px" }}>
        Was ist auf?
      </label>
      <input
        id="probe-text"
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", height: 52, borderRadius: 12, border: 0, background: "var(--raise)", padding: "0 14px", fontSize: 17, fontWeight: 450 }}
      />
      {fehler ? <p style={{ color: "var(--error)", fontSize: 15, marginTop: 6 }}>{fehler}</p> : null}
      <div className="foot">
        <button className="btn primary" type="submit" disabled={laeuft}>
          Speichern
        </button>
      </div>
    </form>
  );
}
