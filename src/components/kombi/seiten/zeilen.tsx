"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { dm } from "@/lib/kombi/text";
import type { BlattZeile } from "@/lib/seiten/ablage";

/**
 * Die kleinen Bausteine der Nachschlage-Seiten, wörtlich aus dem Prototyp:
 * `plab` (Z. 3003), `rowBtn` (Z. 3004) und `blattRow` (Z. 3242). Ein Ziel ist
 * entweder eine andere Stapelseite (`seite`) oder eine echte Route (`href`,
 * Formular-Unterseite, Plan 2.1).
 */

export const PLab = ({ children }: { children: ReactNode }) => <h3 className="p-lab">{children}</h3>;

type Ziel =
  | { seite: string; params?: Record<string, string>; href?: never; onClick?: never }
  | { href: string; seite?: never; params?: never; onClick?: never; download?: boolean }
  | { onClick: () => void; seite?: never; params?: never; href?: never };

export function RowBtn({
  titel,
  sub,
  rechts,
  strong,
  ziel,
  ariaLabel,
}: {
  titel: ReactNode;
  sub?: ReactNode;
  rechts?: ReactNode;
  strong?: boolean;
  ziel: Ziel;
  ariaLabel?: string;
}) {
  const kombi = useKombi();
  const inhalt = (
    <>
      <span>
        <b style={strong ? { fontWeight: 650 } : undefined}>{titel}</b>
        {sub ? <span className="s">{sub}</span> : null}
      </span>
      {rechts ?? <Icon name="chevron_right" />}
    </>
  );
  if (ziel.href) {
    const download = "download" in ziel && ziel.download;
    if (download) {
      return (
        <a className="lrow plain" href={ziel.href} download aria-label={ariaLabel}>
          {inhalt}
        </a>
      );
    }
    return (
      <Link className="lrow plain" href={ziel.href} aria-label={ariaLabel}>
        {inhalt}
      </Link>
    );
  }
  return (
    <button
      className="lrow plain"
      type="button"
      aria-label={ariaLabel}
      onPointerDown={ziel.seite ? () => kombi.vorladen(ziel.seite!, ziel.params ?? {}) : undefined}
      onClick={() => {
        if (ziel.seite) kombi.openPage(ziel.seite, ziel.params ?? {});
        else ziel.onClick?.();
      }}
    >
      {inhalt}
    </button>
  );
}

export function BlattRow({ b }: { b: BlattZeile }) {
  const kombi = useKombi();
  return (
    <button
      className="lrow"
      type="button"
      onPointerDown={() => kombi.vorladen("blatt", { id: b.id })}
      onClick={() => kombi.openPage("blatt", { id: b.id })}
    >
      <span className="mini" style={b.mini ? { backgroundImage: `url("${b.mini}")` } : undefined} />
      <span>
        <b>{b.titel}</b>
        <span className="s">{`${dm(b.datum)}, ${b.thema || b.fach}`}</span>
      </span>
      <Icon name="chevron_right" />
    </button>
  );
}

/**
 * Bestätigung im Stil `.t-confirm` (Prototyp Z. 589–596), auf Papier mit
 * `--sheet` statt auf der Karte des Tisches (Plan 2.3).
 */
export function Bestaetigung({
  titel,
  text,
  ja,
  nein = "Abbrechen",
  onJa,
  onNein,
}: {
  titel: string;
  text?: string;
  ja: string;
  nein?: string;
  onJa: () => void;
  onNein: () => void;
}) {
  return (
    <div
      className="t-confirm on"
      role="alertdialog"
      aria-label={titel}
      style={{ position: "fixed", zIndex: 30, background: "var(--sheet)", color: "var(--ink)", boxShadow: "var(--pop-shadow)" }}
    >
      <h2>{titel}</h2>
      {text ? <p style={{ color: "var(--ink-2)" }}>{text}</p> : null}
      <div className="row">
        <button className="btn nein" type="button" style={{ background: "var(--raise)", color: "var(--ink)" }} onClick={onNein}>
          {nein}
        </button>
        <button className="btn ja" type="button" style={{ background: "var(--ink)", color: "var(--bg)" }} onClick={onJa}>
          {ja}
        </button>
      </div>
    </div>
  );
}

/** Eine Textzeile mit Chevron (`.textline`), als Link oder Knopf. */
export function TextLine({
  children,
  href,
  onClick,
  big,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  big?: boolean;
}) {
  const cls = `textline${big ? " big" : ""}`;
  if (href) {
    return (
      <Link className={cls} href={href}>
        {children}
        <Icon name="chevron_right" />
      </Link>
    );
  }
  return (
    <button className={cls} type="button" onClick={onClick}>
      {children}
      <Icon name="chevron_right" />
    </button>
  );
}
