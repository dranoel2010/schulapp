"use client";

import Link from "next/link";
import { createPortal } from "react-dom";

import { useAuswahl } from "./auswahl";

/**
 * Eine leere Liste am Rechner: rechts steht statt einer leeren Spalte ein
 * Satz und die Handlung dazu (in der Detailspalte, solange nichts gewählt
 * ist). Am Handy und mit Auswahl rendert es nichts.
 */
export function LeeresDetail({ satz, knopf, href }: { satz: string; knopf?: string; href?: string }) {
  const auswahl = useAuswahl();
  if (!auswahl?.detailEl || auswahl.sel) return null;
  return createPortal(
    <div className="d-in d-leer">
      <p className="d-lede">{satz}</p>
      {knopf && href ? (
        <Link className="textbtn" href={href}>
          {knopf}
        </Link>
      ) : null}
    </div>,
    auswahl.detailEl,
  );
}
