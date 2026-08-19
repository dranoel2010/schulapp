import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** PGlite bringt eigene WASM-Dateien mit und darf nicht mitgebündelt werden. */
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
