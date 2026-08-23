import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { listMaterialCards } from "@/lib/materials";
import { DECIDED_DAYS, listProposals } from "@/lib/proposals";

import { discardProposalAction } from "./actions";
import { InboxList } from "./inbox-list";

/**
 * Der Eingangskorb: was aus den Blättern noch werden soll.
 *
 * Hier landet, was ein Agent aus einem abfotografierten Blatt gelesen hat —
 * und was man selbst notiert hat, ohne es gleich eintragen zu wollen. Nichts
 * davon steht in der App, bevor es hier bestätigt wurde. Das ist keine
 * Vorsichtsmaßnahme, sondern die Bedingung, unter der ein Agent überhaupt an
 * diese Daten darf: wer nicht vertrauenswürdige Blätter liest und zugleich
 * schreiben dürfte, wäre über das Blatt selbst angreifbar.
 *
 * Offene Vorschläge stehen oben, entschiedene vierzehn Tage lang blass
 * darunter — dieselbe Frist wie bei den abgehakten Hausaufgaben. Gelöscht wird
 * hier nichts.
 *
 * Ein leerer Korb ist der Normalfall und keine Lücke. Deshalb steht im leeren
 * Zustand kein Vorwurf, sondern der Weg dorthin, wo Vorschläge herkommen.
 */

export const metadata: Metadata = {
  title: "Eingangskorb",
};

// `export const dynamic = "force-dynamic"` steht schon im Layout der Gruppe
// (src/app/(app)/layout.tsx) und gilt damit auch hier — hier wäre es doppelt.

/** Das Korb-Symbol des leeren Zustands: ein Ablagefach mit einem Blatt darin. */
function InboxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
      <path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );
}

export default async function InboxPage() {
  const user = await requireUser();

  const [items, materials] = await Promise.all([
    listProposals(user.id, { includeDecided: true }),
    // Ohne ein Blatt gibt es nichts, woran ein Vorschlag hängen könnte — dann
    // führt der leere Zustand in die Ablage und nicht auf ein Formular, das
    // sich gar nicht ausfüllen ließe.
    listMaterialCards(user.id, { limit: 1 }),
  ]);

  const open = items.filter((item) => item.status === "offen");
  const hasMaterial = materials.length > 0;

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Eingangskorb</h1>
        <p className="text-sm text-muted">
          Vorschläge zu deinen Blättern. Nichts davon steht in der App, bis du
          es übernimmst — und übernommen wird es mit demselben Formular, mit dem
          du es auch von Hand einträgst.
        </p>
      </header>

      {items.length === 0 ? (
        hasMaterial ? (
          <EmptyState
            title="Nichts zu entscheiden"
            description="Hier stehen Vorschläge zu deinen Blättern — von einem Agenten in Claude oder von dir selbst notiert."
            action={
              <ButtonLink href="/eingang/neu">
                Vorschlag von Hand anlegen
              </ButtonLink>
            }
            icon={<InboxIcon />}
          />
        ) : (
          <EmptyState
            title="Zuerst ein Blatt"
            description="Jeder Vorschlag hängt an einem abfotografierten Blatt — er sagt, was daraus werden soll. Fotografier eines ab, dann geht es hier weiter."
            action={<ButtonLink href="/material">Zur Ablage</ButtonLink>}
            icon={<InboxIcon />}
          />
        )
      ) : (
        <div className="space-y-3">
          <InboxList items={items} discardAction={discardProposalAction} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {open.length === 0
                ? `Nichts mehr offen. Entschiedenes bleibt ${DECIDED_DAYS} Tage stehen.`
                : open.length === 1
                  ? "Ein Vorschlag wartet."
                  : `${open.length} Vorschläge warten.`}
            </p>

            {hasMaterial ? (
              <ButtonLink href="/eingang/neu" variant="secondary">
                Vorschlag von Hand
              </ButtonLink>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
