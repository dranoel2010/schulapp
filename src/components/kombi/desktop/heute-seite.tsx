"use client";

import { Miniatur } from "@/components/kombi/home/ueberblick";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { eingangskorbText, type MorgenT, type TagDaten } from "@/lib/kombi/startseite";
import { dm, TAG, tn, wd } from "@/lib/kombi/text";

/**
 * Heute am Rechner (desktop.html `RENDER_heute`): links steht die Startseite
 * des Handys unverändert, rechts daneben die Packhilfe, darunter über die
 * volle Breite „Zuletzt abgelegt“. Beide Teile hier sind Ergänzungen, die das
 * Handy nicht hat.
 *
 * Gerendert werden sie immer, mit `display:none` im style-Attribut (wie die
 * Seitenleiste): unter 1024 px bleiben sie aus dem Bild, darüber setzt
 * src/app/desktop/heute.css sie mit !important wieder. So rendern Server und
 * Browser dasselbe, am Rechner steht beim ersten Malen schon alles an seinem
 * Platz, und am Handy ändert sich nichts.
 */

/** Unter 1024 px unsichtbar; heute.css überstimmt es ab 1024 px mit !important. */
const AUS = { display: "none" } as const;

/**
 * Die Packhilfe: die Stunden eines Schultags als dieselben Zeilen wie
 * „Stunden“ am Morgen, mit „Woche“ zum Wochenraster. Welcher Tag, sagt
 * `packhilfe()` in @/lib/kombi/startseite.
 */
export function HeutePack({ morgen }: { morgen: MorgenT }) {
  const kombi = useKombi();
  const titel = `${TAG[wd(morgen.tag)]}, ${dm(morgen.tag)}`;
  return (
    <aside className="h-col h-side h-ein enter" aria-labelledby="hPackLab" style={AUS}>
      <div className="blk h-pack">
        <div className="lab">
          <h2 id="hPackLab" style={{ font: "inherit" }}>
            {titel}
          </h2>
          <button
            className="lab-r"
            type="button"
            onPointerDown={() => kombi.vorladen("woche", { tag: morgen.tag })}
            onClick={() => kombi.zeigeBereich("woche", { tag: morgen.tag })}
          >
            Woche
          </button>
        </div>
        {morgen.stunden.length ? (
          <div>
            {morgen.stunden.map((l) => (
              <div className="lesson-row" key={l.nr}>
                <time dangerouslySetInnerHTML={{ __html: tn(l.von) }} />
                <div>
                  <b>{l.fach}</b>
                  {l.hu ? <em>{l.hu}</em> : null}
                </div>
                <span className="room">{l.raum ?? ""}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="h-note">Keine Stunden eingetragen</p>
        )}
      </div>
    </aside>
  );
}

/**
 * „Zuletzt abgelegt“ über die volle Breite: vier Blätter, ab 1440 px sechs
 * (heute.css). Ein Klick zeigt das Blatt in der Ablage, „Alle“ die Ablage.
 * Liegt etwas im Eingangskorb, steht darunter dieselbe Zeile wie am Handy.
 */
export function HeuteAbgelegt({ d }: { d: TagDaten }) {
  const kombi = useKombi();
  if (!d.blaetter.length && d.eingangskorb <= 0) return null;
  return (
    <div className="blk h-thumbs h-ein enter" style={AUS}>
      {d.blaetter.length ? (
        <>
          <div className="lab">
            <h2 style={{ font: "inherit" }}>Zuletzt abgelegt</h2>
            <button
              className="lab-r"
              type="button"
              onPointerDown={() => kombi.vorladen("ablage")}
              onClick={() => kombi.zeigeBereich("ablage")}
            >
              Alle
            </button>
          </div>
          <div className="d-thumbs">
            {d.blaetter.map((b) => (
              <Miniatur key={b.id} b={b} heute={d.tag} onOeffnen={(id) => kombi.zeigeBereich("ablage", { sel: id })} />
            ))}
          </div>
        </>
      ) : null}
      {d.eingangskorb > 0 ? (
        <button className="textline more" type="button" onClick={() => kombi.zeigeBereich("eingang")}>
          {eingangskorbText(d.eingangskorb)}
          <Icon name="chevron_right" />
        </button>
      ) : null}
    </div>
  );
}
