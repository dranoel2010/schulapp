"use client";

import { Icon, type IconName } from "@/components/kombi/icon";
import { kurz } from "@/lib/kombi/text";

import type { Geparst } from "./parser";

/**
 * Die Tokens über der Zeile (Prototyp `renderTokens`, Z. 2687): Absicht zum
 * Umschalten, dann Fach und Termin. Was fehlt, steht gestrichelt da
 * („welches Fach?“, „bis wann?“).
 */

export type Token = { key: string; cls: string; icon?: IconName; label: string; tap?: () => void };

export function tokensFuer(p: Geparst | null, sichtbar: boolean, umschalten: () => void): Token[] {
  if (!p || !sichtbar) return [];
  const it = p.intent;
  const list: Token[] = [
    {
      key: "int:" + it,
      cls: "int" + (it === "suchen" ? " suchen" : ""),
      icon: it === "suchen" ? "search" : it === "aendern" ? "edit" : "add",
      label: it === "suchen" ? "Suchen" : it === "aendern" ? "Ändern" : "Eintragen",
      tap: umschalten,
    },
  ];
  if (it !== "suchen") {
    if (p.eFach) list.push({ key: "fach:" + p.eFach.id, cls: "", label: p.eFach.name });
    else list.push({ key: "fach:none", cls: "want", label: "welches Fach?" });
    if (p.eFach) {
      if (p.due) list.push({ key: "due:" + p.due + p.dueAuto, cls: "", label: `${kurz(p.due)}${p.dueAuto ? ", nächste Stunde" : ""}` });
      else list.push({ key: "due:none", cls: "want", label: "bis wann?" });
    }
  } else {
    if (p.fach) list.push({ key: "s:fach:" + p.fach.id, cls: "", label: p.fach.name });
    if (p.dueExplicit && p.due) list.push({ key: "s:due:" + p.due, cls: "", label: kurz(p.due) });
  }
  return list;
}

export function Tokens({ list }: { list: Token[] }) {
  return (
    <>
      {list.map((t) => (
        <button key={"tok:" + t.key} data-k={"tok:" + t.key} className={`tok ${t.cls}`} type="button" onClick={() => t.tap?.()}>
          {t.icon ? <Icon name={t.icon} /> : null}
          {t.label}
        </button>
      ))}
    </>
  );
}
