import type { Metadata } from "next";
import Link from "next/link";

import "@/components/kombi/form/form.css";

export const metadata: Metadata = {
  title: "Keine Verbindung",
};

export default function OfflinePage() {
  return (
    <main className="solo">
      <div className="solo-in">
        <h1 className="hl">Keine Verbindung</h1>
        <p className="q-sub">Dein Gerät ist gerade offline. Was du vorher schon geöffnet hattest, kannst du weiter lesen — neue Seiten und Änderungen brauchen Netz.</p>
        <div className="foot">
          <Link className="btn primary" href="/">
            Nochmal versuchen
          </Link>
        </div>
      </div>
    </main>
  );
}
