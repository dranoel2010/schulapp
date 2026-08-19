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
};

export default nextConfig;
