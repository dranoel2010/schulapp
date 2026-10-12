"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { EinstellungenDaten } from "@/lib/seiten/einstellungen";

import { PLab, RowBtn } from "./zeilen";

/**
 * Einstellungen (Prototyp Z. 3194–3201): oben die drei Zeilen des Prototyps,
 * darunter die Unterseiten, in die die bisherige Einstellungsseite aufgeteilt
 * ist (Plan 2.2). Hell und Dunkel folgen dem System (Plan 1.5) — die Zeile
 * sagt es nur.
 */
export function EinstellungenInhalt({ daten }: { daten: EinstellungenDaten }) {
  const router = useRouter();
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
        <RowBtn titel="Epoche" sub={`${daten.epoche.name} im Hauptunterricht`} ziel={{ seite: "fach", params: { id: daten.epoche.id } }} />
      ) : (
        <RowBtn titel="Epoche" sub="Den Hauptunterricht auf ein anderes Fach umtragen" ziel={{ href: "/stundenplan/epoche" }} />
      )}
      <div className="set-row">
        Hell und dunkel<span>wie am Handy</span>
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
      <RowBtn titel="Als App installieren" sub="Am Handy in Chrome" ziel={{ href: "/einstellungen/installieren" }} />
      <RowBtn titel="Wo deine Daten liegen" sub="Was die App speichert und was hinausgeht" ziel={{ href: "/einstellungen/daten" }} />
      <RowBtn titel="Konto" sub={daten.konto} ziel={{ href: "/einstellungen/konto" }} />
    </>
  );
}
