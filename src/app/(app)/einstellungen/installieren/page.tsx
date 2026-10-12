import type { Metadata } from "next";

import { SeitenKopf } from "@/components/kombi/form";

/** Einstellungen › Als App installieren (Android, Chrome). */

export const metadata: Metadata = { title: "Als App installieren" };

const SCHRITTE = [
  "Oben rechts das Menü öffnen — die drei Punkte.",
  "„App installieren“ antippen. Steht dort stattdessen „Zum Startbildschirm hinzufügen“, ist das dasselbe.",
  "Bestätigen.",
];

export default function InstallierenPage() {
  return (
    <>
      <SeitenKopf titel="Als App installieren" sub="Am Handy in Chrome, dann fühlt sich die Schulapp wie eine richtige App an:" />
      <ol style={{ marginTop: 8 }}>
        {SCHRITTE.map((s, i) => (
          <li key={s} className="lesson" style={{ gridTemplateColumns: "28px 1fr" }}>
            <time>{`${i + 1}.`}</time>
            <span style={{ fontSize: 17 }}>{s}</span>
          </li>
        ))}
      </ol>
      <p className="p-sub" style={{ marginTop: 12 }}>
        Danach liegt sie mit eigenem Symbol im App-Menü und startet ohne Browserleiste.
      </p>
    </>
  );
}
