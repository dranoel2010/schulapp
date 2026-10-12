"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

const ITEMS: { href: string; label: string; icon: IconName; group: string }[] = [
  { href: "/", label: "Übersicht", icon: "home", group: "Dein Tag" },
  { href: "/stundenplan", label: "Stundenplan", icon: "calendar", group: "Dein Tag" },
  { href: "/hausaufgaben", label: "Hausaufgaben", icon: "tasks", group: "Dein Tag" },
  { href: "/material", label: "Material", icon: "material", group: "Dein Tag" },
  { href: "/lernen", label: "Lernplan", icon: "learn", group: "Dein Lernen" },
  { href: "/abruf", label: "Wissen abrufen", icon: "recall", group: "Dein Lernen" },
  { href: "/klausuren", label: "Klausuren", icon: "calendar", group: "Dein Lernen" },
  { href: "/noten", label: "Noten", icon: "grades", group: "Dein Lernen" },
  { href: "/faecher", label: "Fächer", icon: "subjects", group: "Organisation" },
  { href: "/einstellungen", label: "Einstellungen", icon: "settings", group: "Organisation" },
];
const PRIMARY = [ITEMS[0], ITEMS[1], ITEMS[2], ITEMS[4]];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function AppNav({ userName }: { userName: string }) {
  const pathname = usePathname();
  return (
    <>
      <aside className="app-sidebar">
        <Link href="/" className="flex items-center gap-3 px-3 py-3">
          <span className="brand-mark"><Icon name="learn" className="size-6" /></span>
          <span className="text-xl font-semibold tracking-tight">schulapp<span className="text-[#c5edac]">.</span></span>
        </Link>
        <nav aria-label="Hauptnavigation" className="mt-8 flex-1 space-y-6">
          {["Dein Tag", "Dein Lernen", "Organisation"].map((group) => (
            <div key={group}>
              <p className="mb-2 px-4 text-[10px] font-semibold tracking-[0.16em] text-[#a4b8b0] uppercase">{group}</p>
              <ul className="space-y-1">
                {ITEMS.filter((item) => item.group === group).map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="sidebar-link">
                      <Icon name={item.icon} /><span>{item.label}</span>
                      {isActive(pathname, item.href) && <span className="ml-auto size-1.5 rounded-full bg-current" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <Link href="/einstellungen" className="mt-8 flex items-center gap-3 border-t border-white/15 px-3 pt-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 font-semibold">{userName.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{userName}</span><span className="text-xs text-[#a4b8b0]">Dein persönlicher Schulalltag</span></span>
        </Link>
      </aside>
      <MobileNavigation key={pathname} pathname={pathname} userName={userName} />
    </>
  );
}

function MobileNavigation({ pathname, userName }: { pathname: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const moreActive = !PRIMARY.some((item) => isActive(pathname, item.href));

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);

  return (
    <>
      <nav aria-label="Mobile Hauptnavigation" className="mobile-nav">
        {PRIMARY.map((item) => (
          <Link key={item.href} href={item.href} aria-label={item.label} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="mobile-nav-item">
            <Icon name={item.icon} />
            <span>{item.href === "/" ? "Heute" : item.href === "/stundenplan" ? "Plan" : item.href === "/hausaufgaben" ? "Aufgaben" : "Lernen"}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`mobile-nav-item ${moreActive ? "is-active" : ""}`}>
          <Icon name="grid" /><span>Mehr</span>
        </button>
      </nav>
      <dialog ref={dialog} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }} aria-labelledby="menu-title" className="navigation-dialog">
        <div className="p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div><p className="eyebrow">Deine Schulapp</p><h2 id="menu-title" className="mt-1 text-2xl font-semibold">Alle Bereiche</h2></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Menü schließen" className="flex size-11 items-center justify-center rounded-full bg-surface-muted"><Icon name="close" /></button>
          </div>
          <nav aria-label="Alle Bereiche" className="grid grid-cols-2 gap-2">
            {ITEMS.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="menu-link">
                <Icon name={item.icon} /><span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <p className="mt-5 truncate text-sm text-muted">Angemeldet als {userName}</p>
        </div>
      </dialog>
    </>
  );
}

/** Der übergeordnete Bereich ist auch bei direkt geöffneten Detailseiten erreichbar. */
export function MobileTopBar() {
  const pathname = usePathname();
  const section = ITEMS.find((item) => item.href !== "/" && isActive(pathname, item.href));
  const parent = pathname.startsWith("/stundenplan/")
    ? "/stundenplan"
    : pathname.startsWith("/noten/fach/")
      ? "/noten"
      : pathname.slice(0, pathname.lastIndexOf("/")) || "/";
  return (
    <header className="app-topbar">
      <div className="flex min-w-0 items-center gap-3">
        {pathname === "/" ? <span className="brand-mark lg:hidden"><Icon name="learn" /></span> : (
          <Link href={parent} aria-label={parent === "/" ? "Zur Übersicht" : "Zur übergeordneten Seite"} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface hover:bg-surface-muted"><Icon name="back" /></Link>
        )}
        <span className="truncate text-sm font-medium">{pathname === "/" ? "Dein Schulalltag" : section?.label ?? "Schulapp"}</span>
        <span className="hidden text-sm text-subtle lg:inline">/ {pathname === "/" ? "Alles im Blick" : "Dein Bereich"}</span>
      </div>
      <Link href="/material" className="flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium text-accent hover:bg-accent-soft"><Icon name="material" /><span className="hidden sm:inline">Meine Materialien</span></Link>
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wide = pathname === "/" || pathname === "/stundenplan";
  return <div className={`page-content ${wide ? "page-content-wide" : ""}`}>{children}</div>;
}
