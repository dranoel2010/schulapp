import type { Metadata } from "next";
import Link from "next/link";

/**
 * Wird gezeigt, wenn eine Adresse ins Leere zeigt — etwa ein Fach, das es
 * nicht mehr gibt. Ohne diese Seite stünde hier Nextens englischer Standard.
 */

export const metadata: Metadata = {
  title: "Seite nicht gefunden",
};

export default function NotFound() {
  return (
    <main className="solo">
      <div className="solo-in">
        <h1 className="hl">Hier ist nichts</h1>
        <p className="q-sub">Diese Seite gibt es nicht.</p>
        <div className="foot">
          <Link className="btn primary" href="/">
            Zur Startseite
          </Link>
        </div>
      </div>
    </main>
  );
}
