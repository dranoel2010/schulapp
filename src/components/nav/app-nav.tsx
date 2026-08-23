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
 * Ab Tablet-Breite bleibt die schmale Seitenspalte links. Dort stehen alle
 * zehn Bereiche der App.
 *
 * Lernen und Klausuren sind zwei Bereiche, nicht einer: unter "Lernen" steht
 * der Lernplan zum Abhaken, unter "Klausuren" werden die Termine verwaltet.
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

/**
 * Die Reihenfolge folgt dem Tag, nicht dem Alphabet: erst was täglich
 * ansteht — der Stundenplan, die Hausaufgaben und das Material —, dann was
 * verwaltet wird — Lernplan, Klausuren, Noten, Fächer —, und zuletzt die
 * Einstellungen. Wer die Liste umsortieren will, ändert damit diese Aussage,
 * nicht nur die Optik.
 *
 * Das Material steht deshalb bei den Hausaufgaben und nicht bei den Fächern:
 * ein Blatt wird im Unterricht abfotografiert, an jedem Schultag, so wie eine
 * Aufgabe aufgeschrieben wird. Dass es später nach Fach und Thema sortiert
 * dasteht, macht es noch nicht zur Verwaltung.
 *
 * Der Eingangskorb steht direkt hinter dem Material, weil er daran hängt: was
 * dort liegt, ist ein Vorschlag zu einem Blatt. Er ist der zweite Halt auf
 * demselben Weg — erst fotografieren, dann entscheiden, was daraus wird.
 *
 * Die Noten stehen hinter den Klausuren und vor den Fächern: sie sind das
 * Ergebnis der Prüfungen und hängen an den Fächern — genau dazwischen also.
 */
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
    href: "/stundenplan",
    label: "Stundenplan",
    // Ein Raster mit Kopfzeile: genau das, was die Seite zeigt. Kein Kalender —
    // der steht schon für die Klausuren und meint einzelne Termine, nicht die
    // Woche, die sich wiederholt.
    icon: (
      <>
        <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h12A2.5 2.5 0 0 1 20.5 7v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7Z" />
        <path d="M3.5 9.5h17" />
        <path d="M9.5 9.5v10" />
        <path d="M15 9.5v10" />
        <path d="M3.5 14.5h17" />
      </>
    ),
  },
  {
    href: "/hausaufgaben",
    label: "Hausaufgaben",
    // Kästchen mit Zeile, zweimal: eine Liste zum Abhaken. Die beiden anderen
    // Häkchen der Leiste stecken in einem Kreis (Lernen) und in einem Kalender
    // (Klausuren) — das leere Kästchen bleibt davon unterscheidbar.
    icon: (
      <>
        <rect x="3.5" y="4.75" width="5.5" height="5.5" rx="1.5" />
        <path d="M12.5 7.5h8" />
        <rect x="3.5" y="13.75" width="5.5" height="5.5" rx="1.5" />
        <path d="M12.5 16.5h8" />
      </>
    ),
  },
  {
    href: "/material",
    label: "Material",
    // Zwei Blätter übereinander: der Stapel, der sich im Laufe des Halbjahrs
    // ansammelt. Kein Fotoapparat — die Kamera ist der Weg hinein, nicht der
    // Bereich. Und keins der anderen Symbole ist ein Blatt: das Buch steht für
    // die Fächer, das Kästchen für die Hausaufgaben, das Raster für die Woche.
    icon: (
      <>
        <path d="M8.25 4.25h7.5A1.75 1.75 0 0 1 17.5 6v9.5" />
        <rect x="4.5" y="7" width="11.5" height="12.75" rx="1.75" />
      </>
    ),
  },
  {
    href: "/eingang",
    label: "Eingangskorb",
    // Ein Ablagefach mit einem Blatt, das hineinfällt. Kein Briefumschlag —
    // hier kommt keine Post an, sondern es liegt etwas bereit; und kein
    // Häkchen, das steht schon zweimal in dieser Leiste.
    icon: (
      <>
        <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
        <path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      </>
    ),
  },
  {
    href: "/lernen",
    label: "Lernen",
    // Ein Häkchen im Kreis: hier wird abgehakt. Der Kalender daneben steht
    // für die Termine, dieser Punkt für das Tun.
    icon: (
      <>
        <circle cx="12" cy="12" r="8.25" />
        <path d="m8.5 12.15 2.35 2.35 4.65-4.9" />
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
    href: "/noten",
    label: "Noten",
    // Drei Balken, von links nach rechts kürzer werdend: der Schnitt je Fach,
    // so wie ihn die Seite zeigt. Ein Balkenbild und kein Zeugnisblatt — das
    // Buch daneben steht schon für die Fächer.
    icon: (
      <>
        <path d="M4 19.5h16" />
        <path d="M7.25 16.5V8" />
        <path d="M12 16.5V4.5" />
        <path d="M16.75 16.5v-5.5" />
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
  "/stundenplan": "Stundenplan",
  "/stundenplan/zeiten": "Stundenzeiten",
  "/lernen": "Lernen",
  "/klausuren": "Klausuren",
  "/klausuren/neu": "Neue Klausur",
  "/hausaufgaben": "Hausaufgaben",
  "/hausaufgaben/neu": "Neue Aufgabe",
  "/material": "Material",
  "/eingang": "Eingangskorb",
  "/eingang/neu": "Neuer Vorschlag",
  "/noten": "Noten",
  "/noten/neu": "Neue Note",
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

  // Eine Prüfung oder ein Fach antippen heißt: bearbeiten. Eine eigene
  // Unterseite dafür gibt es nicht mehr, die Detailseite ist das Formular.
  if (pathname.startsWith("/klausuren/")) return "Klausur bearbeiten";
  // Ein Fach hat genau eine echte Unterseite: seine Themen. Sie liegt unter
  // /faecher/, meint aber nicht das Fach, sondern seine Themenliste — die
  // Regel darunter würde sie „Fach bearbeiten“ nennen. Als Muster und nicht
  // als fester Eintrag, weil die Fach-id mitten in der Adresse steht.
  if (pathname.startsWith("/faecher/") && pathname.endsWith("/themen")) {
    return "Themen";
  }
  if (pathname.startsWith("/faecher/")) return "Fach bearbeiten";
  if (pathname.startsWith("/hausaufgaben/")) return "Aufgabe bearbeiten";
  // Ein Blatt antippen heißt: die Seiten ansehen und nebenbei richtigstellen,
  // wohin es gehört. "Blatt bearbeiten" verspräche einen Bildbearbeiter —
  // hier steht das Blatt selbst im Mittelpunkt.
  if (pathname.startsWith("/material/")) return "Blatt";
  // Ein Vorschlag antippen heißt: das Formular ansehen, das ihn übernehmen
  // würde. „Vorschlag bearbeiten“ verspräche, dass man am Vorschlag selbst
  // etwas ändert — geändert wird das, was daraus entsteht.
  if (pathname.startsWith("/eingang/")) return "Vorschlag";
  // Ein Fach unter den Noten ist keine Bearbeitung, sondern die Liste seiner
  // Noten — deshalb steht dort der Bereichsname und nicht "bearbeiten".
  if (pathname.startsWith("/noten/fach/")) return "Noten";
  if (pathname.startsWith("/noten/")) return "Note bearbeiten";
  // Ein Feld im Wochenraster: /stundenplan/<tag>/<stunde>
  if (pathname.startsWith("/stundenplan/")) return "Stunde bearbeiten";

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
