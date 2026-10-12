"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { PagerPageProvider } from "./pager-context";
import { cameraSwipe } from "./camera-swipe";

const TABS: { id: number; label: string; icon: IconName }[] = [
  { id: 1, label: "Übersicht", icon: "home" },
  { id: 2, label: "Tagesablauf", icon: "calendar" },
  { id: 0, label: "Kamera", icon: "camera" },
];

/** Tabs und eine zusätzliche Wischgeste am Handy teilen denselben Kamerazustand. */
export function HomeWorkspace({ overview, calendar, camera }: { overview: ReactNode; calendar: ReactNode; camera: ReactNode }) {
  const [active, setActive] = useState(1);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<{ pointerId: number; swipe: ReturnType<typeof cameraSwipe> } | null>(null);
  const suppressClickUntil = useRef(0);
  const panels: Record<number, ReactNode> = { 0: camera, 1: overview, 2: calendar };

  return (
    <PagerPageProvider value={active}>
      <div
        className={`space-y-5 ${active !== 2 ? "max-lg:[touch-action:pan-y_pinch-zoom]" : ""}`}
        onPointerDown={(event) => {
          if (!event.isPrimary) {
            gesture.current = null;
            return;
          }
          gesture.current = null;
          suppressClickUntil.current = 0;
          if (event.pointerType !== "touch" || !window.matchMedia("(max-width: 1023px)").matches || active === 2) return;
          const target = event.target as HTMLElement;
          if (target.closest("input, textarea, select, button, a[role=button], [contenteditable], [role=slider], [data-no-swipe]")) return;
          gesture.current = { pointerId: event.pointerId, swipe: cameraSwipe(active, event.clientX, event.clientY) };
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          if (current.swipe.move(event.clientX, event.clientY)) {
            // Erst beim Ziehen übernehmen, damit ein Antippen Links weiter öffnet.
            event.currentTarget.setPointerCapture(event.pointerId);
            suppressClickUntil.current = Date.now() + 500;
          }
        }}
        onPointerUp={(event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          gesture.current = null;
          const next = current.swipe.finish(event.clientX, event.clientY);
          if (next === null) return;
          suppressClickUntil.current = Date.now() + 500;
          setActive(next);
          const button = buttons.current[TABS.findIndex((tab) => tab.id === next)];
          button?.focus({ preventScroll: true });
          // Auch nach einem Wisch weiter unten auf der Übersicht ist die Kamera sichtbar.
          button?.scrollIntoView({ block: "nearest" });
        }}
        onPointerCancel={() => { gesture.current = null; }}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) gesture.current = null;
        }}
        onClickCapture={(event) => {
          if (event.detail !== 0 && Date.now() < suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div role="tablist" aria-label="Ansicht der Startseite" className="home-tabs">
          {TABS.map((tab, index) => (
            <button key={tab.id} ref={(element) => { buttons.current[index] = element; }} type="button" role="tab" id={`home-tab-${tab.id}`} aria-controls={`home-panel-${tab.id}`} aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} className="home-tab" onClick={() => setActive(tab.id)} onKeyDown={(event) => {
              const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              setActive(TABS[next].id);
              buttons.current[next]?.focus();
            }}>
              <Icon name={tab.icon} className="size-4" /><span>{tab.label}</span>
            </button>
          ))}
        </div>
        {active !== 2 && (
          <p className="text-xs text-muted lg:hidden">
            {active === 1 ? "Nach rechts wischen, um die Kamera zu öffnen →" : "← Nach links wischen, um zur Übersicht zurückzukehren"}
          </p>
        )}
        {TABS.map((tab) => (
          <div key={tab.id} role="tabpanel" id={`home-panel-${tab.id}`} aria-labelledby={`home-tab-${tab.id}`} hidden={active !== tab.id} tabIndex={0}>
            {/* touch-action wird nur bis zum nächsten Scroll-Container ausgewertet.
                Deshalb auch auf die Karte und alle Inhalte von CapturePane anwenden,
                insbesondere die separat scrollende Kamera-Ersatzansicht. */}
            <div className={tab.id === 0 ? "flex min-h-[28rem] flex-col overflow-hidden rounded-card border border-border bg-surface max-lg:[touch-action:pan-y_pinch-zoom] max-lg:[&_*]:[touch-action:pan-y_pinch-zoom]" : tab.id === 2 ? "overflow-hidden rounded-card border border-border bg-surface" : ""}>
              {panels[tab.id]}
            </div>
          </div>
        ))}
      </div>
    </PagerPageProvider>
  );
}
