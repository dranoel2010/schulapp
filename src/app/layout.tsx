import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";

import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";

import "./globals.css";
import "./kombi.css";

/**
 * Die Schriften von Modell 23: Schibsted Grotesk für alles, Newsreader nur
 * für Kartenfrage, Themenende und Formeln (notiz.md, Kriterium 64 ohne
 * Material Symbols). Beide als variable Schrift ohne `weight` — gebraucht
 * werden 450, 560 und 650. next/font legt sie selbst ab; im Netzwerk taucht
 * fonts.googleapis.com nicht auf.
 */
const schibsted = Schibsted_Grotesk({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Schulapp",
    template: "%s · Schulapp",
  },
  description: "Klausuren, Stundenplan und Noten an einem Ort.",
  applicationName: "Schulapp",
  appleWebApp: {
    capable: true,
    title: "Schulapp",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

/**
 * Fest statt `generateViewport`: Hell und Dunkel folgen allein dem Gerät
 * (Plan 1.5), es gibt keine gespeicherte Wahl mehr, die der Server lesen
 * müsste. `interactiveWidget: resizes-content` lässt die Tastatur den
 * Bildbereich verkleinern, so bleibt die Zeile über ihr (Kriterium 53).
 * Die Farbe der Systemleiste stellt zur Laufzeit src/lib/kombi/theme-color.ts
 * je Ebene (Papier, Kamera, Tisch).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7F5" },
    { media: "(prefers-color-scheme: dark)", color: "#141416" },
  ],
};

/**
 * Läuft vor dem ersten Malen (Plan A, „Kaltstart ohne Aufblitzen“):
 *
 * - `html.pre` blendet die Einblend-Blöcke (`.enter`) aus, bis die Shell
 *   nach `document.fonts.ready` die Einblendung startet — nur ohne
 *   reduzierte Bewegung. Spätestens nach 1200 ms fällt `pre` in jedem Fall.
 * - `?theme=dark|light` überstimmt das System, aber nur als Prüfschalter mit
 *   `SCHULAPP_TESTUHR=1` (Kriterium 62; auf dem NAS nie gesetzt). Dann steht
 *   auch `data-pruefung` am <html>: die Shell hängt ihre API für die
 *   Playwright-Prüfungen an `window.__kombi`.
 */
function startSkript(themaSchalter: boolean): string {
  return [
    "(function(){var d=document.documentElement;",
    "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.add('pre');setTimeout(function(){d.classList.remove('pre')},1200)}}catch(e){}",
    themaSchalter
      ? "d.setAttribute('data-pruefung','1');try{var t=new URLSearchParams(location.search).get('theme');if(t==='dark'||t==='light'){d.setAttribute('data-theme',t);sessionStorage.setItem('kombi-theme',t)}else{t=sessionStorage.getItem('kombi-theme');if(t==='dark'||t==='light')d.setAttribute('data-theme',t)}}catch(e){}"
      : "",
    "})();",
  ].join("");
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const themaSchalter = process.env.SCHULAPP_TESTUHR === "1";

  return (
    <html
      lang="de"
      className={`${schibsted.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: startSkript(themaSchalter) }} />
      </head>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
