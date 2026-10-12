import type { Metadata } from "next";

import { logout } from "@/app/(app)/actions";
import { Button, SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";

/** Einstellungen › Konto: Name, seit wann, Abmelden. */

export const metadata: Metadata = { title: "Konto" };

export default async function KontoPage() {
  const user = await requireUser();
  const seit = user.createdAt.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  });

  return (
    <>
      <SeitenKopf titel="Konto" />
      <div style={{ marginTop: 8 }}>
        <div className="set-row">
          Name<span>{user.name}</span>
        </div>
        <div className="set-row">
          Angelegt am<span>{seit}</span>
        </div>
      </div>
      <form action={logout} className="foot">
        <Button type="submit" variant="secondary">
          Abmelden
        </Button>
      </form>
    </>
  );
}
