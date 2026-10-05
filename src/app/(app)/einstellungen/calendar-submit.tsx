"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Ein Knopf für die Formulare der Karte „Google Kalender", der von selbst
 * merkt, dass sein Formular gerade läuft — „Jetzt abgleichen" kann bis zu
 * 25 Sekunden dauern, und ohne Rückmeldung tippt man ein zweites Mal.
 *
 * Diese Datei importiert absichtlich NICHTS aus @/lib/calendar: Sie landet im
 * Bündel für den Browser, und dort gibt es kein node:crypto.
 */
export function CalendarSubmit({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel?: string;
  variant?: ButtonProps["variant"];
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} loading={pending}>
      {pending && pendingLabel ? pendingLabel : label}
    </Button>
  );
}
