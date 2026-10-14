"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useSyncExternalStore } from "react";

import { useErsteAuswahl } from "@/components/kombi/desktop/ablegen";
import { useDesktop } from "@/components/kombi/desktop/use-desktop";
import { lang } from "@/lib/kombi/text";
import type { EinstellungenDaten } from "@/lib/seiten/einstellungen";

import { PLab, RowBtn } from "./zeilen";

/**
 * Einstellungen (Prototyp Z. 3194–3201): oben die drei Zeilen des Prototyps,
 * darunter die Unterseiten, in die die bisherige Einstellungsseite aufgeteilt
 * ist (Plan 2.2). Hell und Dunkel folgen dem System (Plan 1.5) — die Zeile
 * sagt es nur.
 *
 * Am Rechner (desktop.html `RENDER_einstellungen`) ist das die Liste links;
 * die Unterseiten öffnen rechts im Detail. Unter „App“ steht dort zusätzlich
 * „Tastatur“ mit allen Kürzeln (`TastaturDetail`), und die Zeile „Hell und
 * dunkel“ sagt „wie das System“ statt „wie am Handy“ (zwei Spans, die
 * Umschaltung macht src/app/desktop/ablage.css). Einen Umschalter gibt es
 * auch am Rechner nicht (EINBAU.md).
 */
export function EinstellungenInhalt({ daten }: { daten: EinstellungenDaten }) {
  const router = useRouter();
  const desktop = useDesktop();
  // Am Rechner ohne Auswahl: die Tastatur, wie im Entwurf
  useErsteAuswahl("/einstellungen", { art: "einstellungen", params: { sel: "tastatur" } });
  // Alte Anker (#kalender, #iserv) aus Kalendereinträgen und Benachrichtigungen
  // führen auf die Unterseiten (Plan 2.2).
  useEffect(() => {
    const anker = window.location.hash.slice(1);
    if (anker === "kalender" || anker === "iserv") router.replace(`/einstellungen/${anker}`);
  }, [router]);

  return (
    <>
      <RowBtn
        titel="Stundenplan"
        sub={daten.stunden === 1 ? "Eine Stunde in der Woche" : `${daten.stunden} Stunden in der Woche`}
        ziel={{ seite: "woche" }}
      />
      {daten.epoche ? (
        <RowBtn titel="Epoche" sub={daten.epoche.seit ? `${daten.epoche.name} im Hauptunterricht seit ${lang(daten.epoche.seit)}` : `${daten.epoche.name} im Hauptunterricht`} ziel={{ seite: "fach", params: { id: daten.epoche.id } }} />
      ) : (
        <RowBtn titel="Epoche" sub="Den Hauptunterricht auf ein anderes Fach umtragen" ziel={{ href: "/stundenplan/epoche" }} />
      )}
      <div className="set-row">
        Hell und dunkel<span className="sr-handy">wie am Handy</span>
        {/* ab 1024 px statt „wie am Handy“ (style überstimmt ablage.css) */}
        <span className="sr-desk" style={{ display: "none" }}>
          wie das System
        </span>
      </div>

      <PLab>Schule</PLab>
      <RowBtn titel="Stundenplan bearbeiten" sub="Raster, Räume, Stundenzeiten" ziel={{ href: "/stundenplan/bearbeiten" }} />
      <RowBtn titel="Erinnerungen" sub={daten.erinnerung} ziel={{ href: "/einstellungen/erinnerungen" }} />
      {daten.vorschlaege > 0 ? (
        <RowBtn
          titel="Fragen-Vorschläge"
          sub={daten.vorschlaege === 1 ? "Ein Vorschlag wartet" : `${daten.vorschlaege} Vorschläge warten`}
          ziel={{ href: "/abruf/eingang" }}
        />
      ) : null}

      <PLab>Verbindungen</PLab>
      <RowBtn titel="Google Kalender" sub={daten.kalender} ziel={{ href: "/einstellungen/kalender" }} />
      <RowBtn titel="IServ" sub={daten.iserv} ziel={{ href: "/einstellungen/iserv" }} />
      <RowBtn titel="Verbundene Programme" sub={daten.verbindungen} ziel={{ href: "/einstellungen/verbindungen" }} />
      <RowBtn titel="Handschrift abschreiben" sub={daten.abschrift} ziel={{ href: "/einstellungen/abschrift" }} />

      <PLab>App</PLab>
      {desktop ? <RowBtn titel="Tastatur" sub="Kürzel am Rechner" ziel={{ seite: "einstellungen", params: { sel: "tastatur" } }} /> : null}
      <RowBtn titel="Als App installieren" sub="Am Handy in Chrome" ziel={{ href: "/einstellungen/installieren" }} />
      <RowBtn titel="Wo deine Daten liegen" sub="Was die App speichert und was hinausgeht" ziel={{ href: "/einstellungen/daten" }} />
      <RowBtn titel="Konto" sub={daten.konto} ziel={{ href: "/einstellungen/konto" }} />
    </>
  );
}

/** Strg oder ⌘, je nach Rechner; auf dem Server Strg (der Detailteil rendert ohnehin erst im Browser). */
const istMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const keinAbo = () => () => {};

/** Die Kürzel am Rechner (desktop.html, Einstellungen „Tastatur“). Nur im Detail, nur ab 1024 px. */
export function TastaturDetail() {
  const mac = useSyncExternalStore(keinAbo, istMac, () => false);
  const KUERZEL: [string, (string | null)[]][] = [
    ["Eintragen oder suchen", ["/", null, mac ? "⌘ K" : "Strg K"]],
    ["Bereich wechseln", ["1", "bis", "7"]],
    ["In der Liste nach oben und unten", ["↑", "↓", null, "J", "K"]],
    ["Aufgabe abhaken", ["X"]],
    ["Schließen", ["Esc"]],
    ["Karte aufdecken", ["Leertaste"]],
    ["Daneben oder Saß", ["1", "2"]],
    ["Arbeitsblatt drucken", ["P"]],
  ];
  return (
    <>
      <p className="d-sub d-ober">Nur am Rechner</p>
      <h1 className="d-h1">Tastatur</h1>
      <div className="keys">
        {KUERZEL.map(([text, tasten]) => (
          <div className="key-row" key={text}>
            <span>{text}</span>
            <span>
              {tasten.map((t, i) => (
                <Fragment key={i}>
                  {t === null ? <span className="k-oder">oder</span> : t === "bis" ? <span className="k-oder">bis</span> : <kbd className="kbd">{t}</kbd>}
                </Fragment>
              ))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
