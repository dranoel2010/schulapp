import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import { transcriptPreview } from "@/lib/transcripts";
import { blaetterMitAbschrift, blattMitAbschrift } from "@/recall/source";

import { createItemAction } from "../../actions";
import { ItemForm } from "../item-form";

/**
 * Einen Baustein anlegen — in zwei Schritten, weil der erste die eigentliche
 * Arbeit ist.
 *
 * Ohne `?blatt=` steht hier die Auswahl: welche Blätter haben überhaupt eine
 * Abschrift? Das ist die ehrlichste Stelle, um die Grenze des ganzen Vorhabens
 * zu zeigen — aus einer Seite ohne Abschrift lässt sich keine Frage bauen, und
 * kein Knopf hier ändert daran etwas. Der Weg dahin führt über den Postboten,
 * nicht über dieses Formular.
 *
 * Mit `?blatt=` steht das Formular da, mit dem Wortlaut der Seite daneben.
 */

export const metadata: Metadata = {
  title: "Baustein anlegen",
};

export default async function NeuerBausteinPage({
  searchParams,
}: PageProps<"/abruf/bausteine/neu">) {
  const user = await requireUser();
  const { blatt } = await searchParams;

  const gewaehlt =
    typeof blatt === "string" ? await blattMitAbschrift(user.id, blatt) : null;

  if (gewaehlt) {
    const farbe = subjectColor(gewaehlt.subjectColor);

    return (
      <div className="space-y-6 md:max-w-3xl">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">
            Baustein anlegen
          </h1>
          <p className="text-sm text-muted">
            <span style={{ color: farbe.hex }}>{gewaehlt.subjectName}</span> ·{" "}
            {gewaehlt.title} · {formatGerman(gewaehlt.capturedOn, "kurz")} ·{" "}
            <Link
              href="/abruf/bausteine/neu"
              className="underline underline-offset-2"
            >
              anderes Blatt
            </Link>
          </p>
        </header>

        <ItemForm
          action={createItemAction}
          subjectId={gewaehlt.subjectId}
          seiten={gewaehlt.seiten}
          zurueckHref="/abruf/bausteine"
        />
      </div>
    );
  }

  const blaetter = await blaetterMitAbschrift(user.id);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          Baustein anlegen
        </h1>
        <p className="text-sm text-muted">
          Aus welchem Blatt? Jede Frage stützt sich auf einen Wortlaut, den man
          zitieren kann.
        </p>
      </header>

      {blaetter.length === 0 ? (
        <EmptyState
          title="Kein Blatt mit Abschrift"
          description="Ein Foto allein genügt nicht — eine Frage braucht den Text. Sobald ein Blatt abgeschrieben ist, steht es hier."
          action={<ButtonLink href="/material">Zur Ablage</ButtonLink>}
        />
      ) : (
        <ul className="space-y-3">
          {blaetter.map((b) => {
            const farbe = subjectColor(b.subjectColor);
            const zeichen = b.seiten.reduce(
              (summe, s) => summe + s.transcript.length,
              0,
            );

            return (
              <li key={b.materialId}>
                <Link
                  href={`/abruf/bausteine/neu?blatt=${b.materialId}`}
                  className="block"
                >
                  <Card
                    className="transition-shadow hover:shadow-lift"
                    style={{
                      backgroundColor: `color-mix(in oklab, ${farbe.hex} 7%, var(--surface))`,
                    }}
                  >
                    <CardContent className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {b.title}
                      </p>
                      <p className="text-xs" style={{ color: farbe.hex }}>
                        {b.subjectName} · {formatGerman(b.capturedOn, "kurz")} ·{" "}
                        {b.seiten.length}{" "}
                        {b.seiten.length === 1 ? "Seite" : "Seiten"} ·{" "}
                        {zeichen} Zeichen
                      </p>
                      <p className="text-sm text-muted">
                        {transcriptPreview(b.seiten[0].transcript, 120)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
