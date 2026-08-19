"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Die Navigation der App. Am Handy als feste Leiste unten (Daumen-Reichweite),
 * ab Tablet-Breite als schmale Spalte links.
 *
 * Vier Punkte — Stundenplan und Noten kommen in späteren Ausbaustufen dazu.
 * Am Handy teilen sich die vier die Breite: die Fläche zum Antippen bleibt
 * 56px hoch, nur die Beschriftung wird kleiner.
 */

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const ICON = {
  className: "size-6 shrink-0",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Start",
    icon: (
      <svg {...ICON}>
        <path d="M3.5 10.2 12 3.5l8.5 6.7" />
        <path d="M5.5 9v10.5h13V9" />
        <path d="M9.75 19.5V14h4.5v5.5" />
      </svg>
    ),
  },
  {
    href: "/klausuren",
    label: "Klausuren",
    icon: (
      <svg {...ICON}>
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-9Z" />
        <path d="M4 10.5h16" />
        <path d="M8.5 3.5v3" />
        <path d="M15.5 3.5v3" />
        <path d="m9.5 14.75 1.75 1.75 3.25-3.5" />
      </svg>
    ),
  },
  {
    href: "/faecher",
    label: "Fächer",
    icon: (
      <svg {...ICON}>
        <path d="M4 19.25A2.25 2.25 0 0 1 6.25 17H20" />
        <path d="M6.25 3H20v18H6.25A2.25 2.25 0 0 1 4 18.75V5.25A2.25 2.25 0 0 1 6.25 3Z" />
      </svg>
    ),
  },
  {
    href: "/einstellungen",
    label: "Einstellungen",
    icon: (
      <svg {...ICON}>
        <path d="M20 7h-8.5" />
        <path d="M13.5 17H4" />
        <circle cx="7.5" cy="7" r="2.5" />
        <circle cx="16.5" cy="17" r="2.5" />
      </svg>
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
    <>
      {/* Handy: feste Leiste unten. pb-safe hält die Gestenleiste frei. */}
      <nav
        aria-label="Hauptbereiche"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-safe md:hidden"
      >
        <ul className="mx-auto flex max-w-md">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 py-2 text-[0.6875rem] transition-colors ${
                    active
                      ? "font-medium text-accent"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {item.icon}
                  {/* Auf schmalen Bildschirmen darf die Beschriftung kürzen,
                      die Fläche zum Antippen bleibt gleich groß. */}
                  <span className="w-full truncate text-center leading-none">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Ab Tablet: Spalte links, bleibt beim Scrollen stehen. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 pt-safe md:flex">
        <div className="px-3 pb-6 pt-6">
          <p className="text-base font-semibold tracking-tight">Schulapp</p>
          <p className="mt-0.5 truncate text-sm text-muted">{userName}</p>
        </div>

        <nav aria-label="Hauptbereiche">
          <ul className="space-y-1">
            {ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-[0.9375rem] transition-colors ${
                      active
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-muted hover:bg-surface-muted hover:text-foreground"
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
