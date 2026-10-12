"use client";

import { useRouter } from "next/navigation";

import { AufgabeZeile } from "@/components/kombi/aufgabe-zeile";
import { KlausurBlock } from "@/components/kombi/home/klausur-block";
import { WiederholenBlock } from "@/components/kombi/home/wiederholen";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import {
  eingangskorbText,
  tagName,
  type AufgabeT,
  type BlattT,
  type TagDaten,
} from "@/lib/kombi/startseite";

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
      {!d.ferien && d.klausurBlock ? <KlausurBlock daten={d.klausurBlock} heute={d.tag} /> : null}
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
