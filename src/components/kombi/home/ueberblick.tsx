"use client";

import { useRouter } from "next/navigation";

import { AufgabeZeile } from "@/components/kombi/aufgabe-zeile";
import { KlausurBlock } from "@/components/kombi/home/klausur-block";
import { WiederholenBlock } from "@/components/kombi/home/wiederholen";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { dm } from "@/lib/kombi/text";
import { eingangskorbText, tagName, type AufgabeT, type BlattT, type TagDaten } from "@/lib/kombi/startseite";

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
      {/* ohne ein einziges Blatt keine Überschrift über leerer Fläche (frisches Konto) */}
      {d.blaetter.length || d.eingangskorb > 0 ? (
        <div className="blk enter" id="ovBl">
          {d.blaetter.length ? (
            <>
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
                  <Miniatur key={b.id} b={b} heute={d.tag} />
                ))}
              </div>
            </>
          ) : null}
          {d.eingangskorb > 0 ? (
            <button className="textline more" type="button" onClick={() => router.push("/material/eingang")}>
              {eingangskorbText(d.eingangskorb)}
              <Icon name="chevron_right" />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Zuletzt abgelegt: Titel einzeilig, darunter nur das Fach (Prototyp
 * `thumbCell`, `cellTexts`). Der Status ist derselbe wie im Ablauf
 * (`blattStatus`): „Wird eingeordnet“ nur, solange ein Lauf arbeitet; ein
 * Blatt, das im Korb liegen blieb, sagt „Liegt im Eingangskorb“.
 */
function Miniatur({ b, heute }: { b: BlattT; heute: string }) {
  const kombi = useKombi();
  const titel = b.titel || (b.datum === heute ? "Blatt von heute" : `Blatt vom ${dm(b.datum)}`);
  const [t, s] =
    b.status === "einordnen"
      ? ["Blatt von heute", "Wird eingeordnet"]
      : b.status === "im_korb"
        ? [titel, "Liegt im Eingangskorb"]
        : [titel, b.fachName];
  return (
    <button
      className="tcell"
      type="button"
      data-bid={b.id}
      // die Ansage nennt denselben Titel, der unter der Miniatur steht
      aria-label={`${/^Blatt\b/.test(t) ? t : `Blatt ${t}`} öffnen`}
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
