"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Die Navigation der App.
 *
 * Am Handy gibt es keine feste Leiste unten mehr: dort ist das Kachelmenü der
 * Startseite selbst das Menü. Jede Kachel führt in ihren Bereich, zurück geht
 * es über den Knopf oben links (`MobileTopBar`). So bleibt der ganze Bildschirm
 * für den Inhalt frei.
 *
 * Ab Tablet-Breite bleibt die schmale Seitenspalte links mit ihren vier
 * Punkten — Stundenplan und Noten kommen in späteren Ausbaustufen dazu.
 */

type NavItem = {
  href: string;
  label: string;
  /** Nur die Striche — die Größe bestimmt der Ort, an dem das Symbol steht. */
  icon: ReactNode;
};

/** Ein Symbol in der gewünschten Größe: in der Spalte 18px. */
function NavIcon({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

const ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Start",
    icon: (
      <>
        <path d="M3.5 10.2 12 3.5l8.5 6.7" />
        <path d="M5.5 9v10.5h13V9" />
        <path d="M9.75 19.5V14h4.5v5.5" />
      </>
    ),
  },
  {
    href: "/klausuren",
    label: "Klausuren",
    icon: (
      <>
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-9Z" />
        <path d="M4 10.5h16" />
        <path d="M8.5 3.5v3" />
        <path d="M15.5 3.5v3" />
        <path d="m9.5 14.75 1.75 1.75 3.25-3.5" />
      </>
    ),
  },
  {
    href: "/faecher",
    label: "Fächer",
    icon: (
      <>
        <path d="M4 19.25A2.25 2.25 0 0 1 6.25 17H20" />
        <path d="M6.25 3H20v18H6.25A2.25 2.25 0 0 1 4 18.75V5.25A2.25 2.25 0 0 1 6.25 3Z" />
      </>
    ),
  },
  {
    href: "/einstellungen",
    label: "Einstellungen",
    icon: (
      <>
        <path d="M20 7h-8.5" />
        <path d="M13.5 17H4" />
        <circle cx="7.5" cy="7" r="2.5" />
        <circle cx="16.5" cy="17" r="2.5" />
      </>
    ),
  },
];

/** Unterseiten färben ihren Oberpunkt mit ein, „/“ nur sich selbst. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type AppNavProps = {
  /** Steht am Laptop klein unter dem App-Namen. */
  userName: string;
};

export function AppNav({ userName }: AppNavProps) {
  const pathname = usePathname();

  return (
    // Ab Tablet: schmale Spalte links, bleibt beim Scrollen stehen.
    // Sie trägt den Namen der App — deshalb hat der Inhalt daneben
    // ab dieser Breite keine eigene Kopfleiste mehr.
    <aside className="sticky top-0 hidden h-dvh w-[226px] shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 pt-[calc(1.25rem_+_env(safe-area-inset-top))] pb-5 md:flex">
      <div className="px-3 pb-[18px]">
        <p className="text-[15px] font-semibold tracking-tight">Schulapp</p>
        <p className="mt-0.5 truncate text-[13px] text-muted">{userName}</p>
      </div>

      <nav aria-label="Hauptbereiche">
        <ul className="flex flex-col gap-1">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-[10px] rounded-control px-3 text-left text-[15px] transition-colors ${
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "bg-transparent text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  <NavIcon className="size-[18px] shrink-0">{item.icon}</NavIcon>
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex-1" />

      {/* Der Entwurf zeigt hier eine Uhrzeit der letzten Synchronisierung.
          So etwas gibt es nicht — also steht hier etwas Wahres. */}
      <p className="px-3 text-[12px] leading-snug text-subtle">
        Alle Daten liegen auf deinem eigenen Server.
      </p>
    </aside>
  );
}

/** Feste Namen für die Seiten, die es genau einmal gibt. */
const SECTION_TITLES: Record<string, string> = {
  "/klausuren": "Klausuren",
  "/klausuren/neu": "Neue Klausur",
  "/faecher": "Fächer",
  "/faecher/neu": "Neues Fach",
  "/einstellungen": "Einstellungen",
};

/**
 * Der Name des Bereichs für die Kopfzeile am Handy — `null` auf der
 * Startseite, die keine Kopfzeile hat.
 *
 * Detailseiten tragen keinen Titel aus der Datenbank: die Kopfzeile wird im
 * Layout gerendert und weiß nichts von Fach oder Klausur. Sie bleibt deshalb
 * allgemein; den genauen Namen zeigt die Seite selbst in ihrer Überschrift.
 */
function sectionTitle(pathname: string): string | null {
  if (pathname === "/") return null;

  const exact = SECTION_TITLES[pathname];
  if (exact) return exact;

  if (pathname.startsWith("/klausuren/")) {
    return pathname.endsWith("/bearbeiten") ? "Klausur bearbeiten" : "Klausur";
  }

  if (pathname.startsWith("/faecher/")) {
    return pathname.endsWith("/bearbeiten") ? "Fach bearbeiten" : "Fach";
  }

  return "Schulapp";
}

/**
 * Die Kopfzeile am Handy: ein Knopf zurück zur Startseite und der Name des
 * Bereichs. Auf der Startseite selbst gibt es sie nicht — dort beginnt das
 * Kachelmenü direkt unter der Statusleiste und bringt seine eigene
 * Überschrift mit.
 *
 * Sie bleibt beim Scrollen stehen: seit die Leiste unten fehlt, ist dieser
 * Knopf der einzige Weg zurück innerhalb der App, er darf nicht oben aus dem
 * Bild laufen. Zum oberen Rand kommt die Statusleiste dazu, im Browser ist
 * dieser Wert 0 — dort bleiben es genau die 14px aus dem Entwurf.
 *
 * Der Name ist bewusst keine Überschrift: jede Seite hat ihr eigenes h1.
 */
export function MobileTopBar() {
  const pathname = usePathname();
  const title = sectionTitle(pathname);

  if (title === null) return null;

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 bg-background px-[22px] pt-[calc(14px_+_env(safe-area-inset-top))] pb-[14px] md:hidden">
      <Link
        href="/"
        aria-label="Zur Startseite"
        className="inline-flex min-h-10 shrink-0 items-center rounded-control border border-border bg-surface px-3 text-[14px] leading-none text-foreground transition-colors duration-150 hover:bg-surface-muted"
      >
        ← Start
      </Link>

      <span className="min-w-0 truncate text-[15px] font-semibold">
        {title}
      </span>
    </header>
  );
}

/**
 * Der Rahmen um den Seiteninhalt am Handy.
 *
 * Die Startseite bekommt keinen seitlichen Rand: das Kachelmenü bringt seine
 * eigenen 14px mit und die Kacheln sollen bis an den Bildschirmrand laufen
 * können. Sie beginnt dafür direkt unter der Statusleiste. Alle anderen
 * Seiten behalten ihre gewohnten 16px und den Abstand nach oben — und
 * unten denselben Abstand, den früher die Leiste dort mitbrachte: ohne ihn
 * klebt die letzte Zeile am Bildschirmrand.
 *
 * Ab md gibt das <main> die Ränder vor — deshalb hängt hier alles an `max-md`.
 * Die Flex-Kette läuft durch: sonst könnte das Kachelmenü den Bildschirm nicht
 * ausfüllen.
 */
export function PageBody({ children }: { children: ReactNode }) {
  const isHome = usePathname() === "/";

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col ${
        isHome ? "max-md:pt-safe" : "max-md:px-4 max-md:pt-6 max-md:pb-6"
      }`}
    >
      {children}
    </div>
  );
}
