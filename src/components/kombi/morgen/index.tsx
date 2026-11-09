"use client";

import { useCallback, useEffect, useState } from "react";

import type { MorgenDaten } from "@/lib/morgen";

/**
 * Der Ablauf vor der Schule: 1. Briefing, 2. Packliste zum Abhaken,
 * 3. „Ab in die Schule“. Liegt als eigene Ebene über allem, solange er
 * heute dran ist (Server: Schultag, vor der ersten Stunde, Datei da) und
 * noch nicht beendet wurde.
 *
 * Abgehaktes und „fertig“ merkt sich nur dieses Gerät (localStorage, je
 * Tag) — es ist ein Spickzettel für den Morgen, kein Stand in der Datenbank.
 */

type Schritt = 0 | 1 | 2;

const SCHLUESSEL = (tag: string) => `schulapp-morgen-${tag}`;

type Gemerkt = { fertig?: boolean; gepackt?: string[]; schritt?: Schritt };

function lesen(tag: string): Gemerkt {
  try {
    return JSON.parse(localStorage.getItem(SCHLUESSEL(tag)) ?? "{}") as Gemerkt;
  } catch {
    return {};
  }
}

function schreiben(tag: string, g: Gemerkt) {
  try {
    localStorage.setItem(SCHLUESSEL(tag), JSON.stringify(g));
  } catch {
    /* privates Fenster o. ä.: dann eben ohne Merken */
  }
}

async function holen(): Promise<MorgenDaten | null> {
  try {
    const r = await fetch("/api/morgen", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as MorgenDaten;
  } catch {
    return null;
  }
}

export function MorgenEbene() {
  const [daten, setDaten] = useState<MorgenDaten | null>(null);
  const [offen, setOffen] = useState(false);
  const [schritt, setSchritt] = useState<Schritt>(0);
  const [gepackt, setGepackt] = useState<Set<string>>(() => new Set());

  const pruefen = useCallback(async () => {
    const d = await holen();
    if (!d || !d.zeigen) {
      setOffen(false);
      return;
    }
    const g = lesen(d.tag);
    if (g.fertig) {
      setOffen(false);
      return;
    }
    setDaten(d);
    setGepackt(new Set(g.gepackt ?? []));
    setSchritt(g.schritt ?? (d.briefing.length ? 0 : 1));
    setOffen(true);
  }, []);

  useEffect(() => {
    void pruefen();
    const sichtbar = () => {
      if (document.visibilityState === "visible") void pruefen();
    };
    document.addEventListener("visibilitychange", sichtbar);
    return () => document.removeEventListener("visibilitychange", sichtbar);
  }, [pruefen]);

  const merken = useCallback(
    (g: Gemerkt) => {
      if (!daten) return;
      schreiben(daten.tag, { ...lesen(daten.tag), ...g });
    },
    [daten],
  );

  const gehZu = (s: Schritt) => {
    setSchritt(s);
    merken({ schritt: s });
  };

  const umschalten = (text: string) => {
    setGepackt((alt) => {
      const neu = new Set(alt);
      if (neu.has(text)) neu.delete(text);
      else neu.add(text);
      merken({ gepackt: [...neu] });
      return neu;
    });
  };

  const beenden = () => {
    merken({ fertig: true });
    setOffen(false);
  };

  if (!offen || !daten) return null;

  const alle = daten.packliste.length;
  const fertigGepackt = daten.packliste.filter((p) => gepackt.has(p.text)).length;

  return (
    <div className="morgen" role="dialog" aria-modal="true" aria-label="Vor der Schule">
      <style>{CSS}</style>
      <header className="morgen-kopf">
        <ol className="morgen-band" aria-label="Schritte">
          {["Briefing", "Packen", "Los"].map((n, i) => (
            <li key={n} className={i === schritt ? "an" : i < schritt ? "war" : ""}>
              <button type="button" onClick={() => gehZu(i as Schritt)}>
                {n}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="morgen-weg" onClick={beenden}>
          Überspringen
        </button>
      </header>

      <main className="morgen-inhalt">
        {schritt === 0 && (
          <>
            <h1>Guten Morgen</h1>
            {daten.briefing.length === 0 && <p className="morgen-leer">Heute kein Briefing.</p>}
            {daten.briefing.map((a) => (
              <section key={a.titel} className="morgen-karte">
                <h2>{a.titel}</h2>
                <ul>
                  {a.punkte.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {schritt === 1 && (
          <>
            <h1>Was du einpacken musst</h1>
            <p className="morgen-zahl">
              {fertigGepackt} von {alle} eingepackt
            </p>
            <ul className="morgen-packen">
              {daten.packliste.map((p) => {
                const an = gepackt.has(p.text);
                return (
                  <li key={p.text}>
                    <button type="button" className={an ? "an" : ""} aria-pressed={an} onClick={() => umschalten(p.text)}>
                      <span className="morgen-haken" aria-hidden="true">
                        {an ? "✓" : ""}
                      </span>
                      <span className="morgen-text">
                        {p.text}
                        {p.grund && <small>{p.grund}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {schritt === 2 && (
          <div className="morgen-los">
            <h1>Ab in die Schule!</h1>
            {daten.schulbeginn && <p>Erste Stunde um {daten.schulbeginn} Uhr.</p>}
            {alle > 0 && fertigGepackt < alle && (
              <p className="morgen-warn">
                Noch {alle - fertigGepackt} {alle - fertigGepackt === 1 ? "Sache" : "Sachen"} nicht abgehakt.
              </p>
            )}
          </div>
        )}
      </main>

      <footer className="morgen-fuss">
        {schritt < 2 ? (
          <button type="button" className="morgen-weiter" onClick={() => gehZu((schritt + 1) as Schritt)}>
            {schritt === 0 ? "Weiter zum Packen" : "Alles gepackt"}
          </button>
        ) : (
          <button type="button" className="morgen-weiter" onClick={beenden}>
            Los geht&apos;s
          </button>
        )}
      </footer>
    </div>
  );
}

const CSS = `
.morgen{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:var(--bg,#fff);color:var(--ink,#111);
  padding:calc(var(--safe-t,0px) + 12px) var(--pad,16px) calc(var(--safe-b,0px) + 12px)}
.morgen-kopf{display:flex;align-items:center;gap:12px}
.morgen-band{display:flex;gap:6px;list-style:none;margin:0;padding:0;flex:1}
.morgen-band li button{border:1px solid var(--line,#ddd);background:none;color:inherit;border-radius:999px;padding:6px 12px;font:inherit;font-size:14px;opacity:.55}
.morgen-band li.war button{opacity:.8}
.morgen-band li.an button{opacity:1;background:var(--ink,#111);color:var(--bg,#fff);border-color:transparent}
.morgen-weg{border:0;background:none;color:inherit;opacity:.6;font:inherit;font-size:14px;padding:6px 0}
.morgen-inhalt{flex:1;overflow-y:auto;padding:16px 0;-webkit-overflow-scrolling:touch}
.morgen-inhalt h1{font-size:28px;line-height:1.15;margin:4px 0 16px}
.morgen-karte{background:var(--card,rgba(127,127,127,.08));border:1px solid var(--card-edge,transparent);border-radius:16px;padding:14px 16px;margin-bottom:12px}
.morgen-karte h2{font-size:15px;margin:0 0 6px;opacity:.7;font-weight:600}
.morgen-karte ul{margin:0;padding-left:18px}
.morgen-karte li{margin:4px 0;line-height:1.4}
.morgen-leer,.morgen-zahl{opacity:.6;margin:0 0 12px}
.morgen-packen{list-style:none;margin:0;padding:0}
.morgen-packen button{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line,#ddd);background:none;color:inherit;font:inherit;font-size:17px;padding:12px 2px}
.morgen-haken{flex:none;width:26px;height:26px;border-radius:8px;border:2px solid var(--line,#ccc);display:grid;place-items:center;font-size:16px}
.morgen-packen button.an .morgen-haken{background:var(--accent,#2a7);border-color:transparent;color:#fff}
.morgen-packen button.an .morgen-text{opacity:.5;text-decoration:line-through}
.morgen-text small{display:block;font-size:13px;opacity:.6}
.morgen-los{display:flex;flex-direction:column;justify-content:center;min-height:60%}
.morgen-los p{font-size:17px;opacity:.75;margin:4px 0}
.morgen-warn{color:var(--accent,#c60)}
.morgen-fuss{padding-top:8px}
.morgen-weiter{width:100%;border:0;border-radius:14px;padding:16px;font:inherit;font-size:17px;font-weight:600;background:var(--ink,#111);color:var(--bg,#fff)}
`;
