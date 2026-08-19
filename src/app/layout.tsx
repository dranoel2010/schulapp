import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import "./globals.css";

import { readThemePreference, themeAttribute } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

/** Die beiden Grundfarben, mit denen Android die Systemleisten einfärbt. */
const THEME_COLOR = { light: "#faf9f7", dark: "#121110" } as const;

/**
 * Die Farbe der Systemleiste folgt der Wahl des Nutzers. Ohne Wahl bleiben
 * beide Angaben stehen und das Gerät sucht sich die passende aus.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await readThemePreference();

  return {
    width: "device-width",
    initialScale: 1,
    // Damit die App im Vollbild bis unter die Statusleiste reicht; die
    // Utilities pt-safe / pb-safe halten Leisten trotzdem frei.
    viewportFit: "cover",
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
          ]
        : THEME_COLOR[theme],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Die Wahl steht schon hier fest, nicht erst im Browser: dadurch kommt die
  // Seite von der ersten Bildzeile an in der richtigen Farbe.
  const theme = await readThemePreference();

  return (
    <html
      lang="de"
      data-theme={themeAttribute(theme)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
