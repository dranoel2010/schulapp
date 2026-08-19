import type { MetadataRoute } from "next";

/**
 * Web-App-Manifest. Damit bietet Android-Chrome „App installieren“ an und die
 * App startet danach im Vollbild mit eigenem Icon.
 *
 * Die PNGs liegen in public/icons und werden von scripts/generate-icons.ts
 * erzeugt (npx tsx scripts/generate-icons.ts).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Schulapp",
    short_name: "Schulapp",
    description: "Klausuren, Stundenplan und Noten an einem Ort.",
    lang: "de",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf9f7",
    theme_color: "#faf9f7",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Android schneidet Icons rund zu — dieses hat rundum Luft.
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
