import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** PGlite bringt eigene WASM-Dateien mit und darf nicht mitgebündelt werden. */
  serverExternalPackages: ["@electric-sql/pglite"],

  /**
   * Beim Entwickeln blockiert Next Anfragen an seine internen Dateien, wenn
   * sie von einem anderen Rechner kommen. Ohne diese Freigabe lädt die App
   * auf dem Handy im heimischen WLAN zwar die Seite, aber kein JavaScript —
   * es gäbe kein Wischen, keine Häkchen, keine Formulare.
   *
   * Nur die privaten Adressbereiche des eigenen Netzes, und nur im
   * Entwicklungsmodus: in der Cloud greift das nicht.
   */
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "*.local",
  ],

  /**
   * Wie groß eine Server Action werden darf.
   *
   * Voreingestellt ist ein Megabyte, und daran scheiterte jede Aufnahme. Eine
   * Anfrage trägt genau eine Seite: das Vollbild mit rund 250 KB, dazu die
   * Lesefassung mit rund 100 KB, die Vorschau mit rund 15 KB und ein paar
   * Formularfelder.
   *
   * Die Zahl gilt für den ganzen Body samt multipart-Rahmen, nicht für die
   * Dateien allein — und sie muss deshalb über allem liegen, was der Prüfer der
   * Action überhaupt durchlässt. Der lässt je Anfrage ein Vollbild bis
   * MAX_PAGE_BYTES (3 MB), eine Lesefassung bis MAX_READING_BYTES (400 KB) und
   * eine Vorschau bis MAX_THUMB_BYTES (400 KB) zu, alle drei aus @/lib/images.
   * Zusammen sind das 3,8 MB, und der Rest trägt den multipart-Rahmen und die
   * Felder — die fünf Megabyte hier sind also die Decke über der Summe und
   * nicht über einer der drei Zahlen. (Lägen alle drei Blobs bei 3 MB, wären
   * 9 MB möglich: Next bräche die Anfrage ab, bevor die Action läuft, und der
   * Nutzer läse einen Satz über seine Verbindung, obwohl der Server sie
   * abgewiesen hat.)
   *
   * Erreicht wird der Rand über die Oberfläche nicht: das Vollbild prüft der
   * Auslöser schon im Browser gegen MAX_PAGE_BYTES, bevor etwas losgeschickt
   * wird, und Lesefassung wie Vorschau entstehen daneben aus demselben Canvas
   * mit 1000 beziehungsweise 320 Pixeln langer Kante. Schlägt der Rand doch
   * einmal an, bricht Next die Anfrage mit Status 413 ab; die Action läuft dann
   * gar nicht erst, der Abbruch kommt beim Auslöser als Ausnahme an, und
   * `callAction()` in @/components/material/capture-button fängt sie und
   * schreibt einen Satz unter den Knopf statt eine Fehlermeldung quer über den
   * Bildschirm.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
