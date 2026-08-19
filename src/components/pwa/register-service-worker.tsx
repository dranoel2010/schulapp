"use client";

import { useEffect } from "react";

/**
 * Meldet den Service Worker an — aber nur im fertigen Build. In der
 * Entwicklung würde sein Cache jede Änderung überdecken.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Ohne Service Worker läuft die App normal weiter, nur eben nicht offline.
      });
    };

    // Erst nach dem Laden anmelden, damit die erste Anzeige nicht wartet.
    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
