"use client";

import { useEffect } from "react";

import { zuletztMerken } from "@/components/kombi/zeile/zuletzt";

/**
 * Merkt eine Seite für „Zuletzt geöffnet“ dort, wo ihre Daten ankommen —
 * wie `remember` im Prototyp beim Rendern der Seite (Z. 3119, 3143, 3164,
 * 3191). So zählt jeder Einstieg: aus der Zeile, aus einer Liste, aus dem
 * Überblick oder über die Adresse. Rendert nichts.
 */
export function ZuletztMerken({
  art,
  id,
  label,
  sub = null,
}: {
  art: string;
  id: string;
  label: string;
  sub?: string | null;
}) {
  useEffect(() => {
    zuletztMerken(art, { id }, { label, sub });
  }, [art, id, label, sub]);
  return null;
}
