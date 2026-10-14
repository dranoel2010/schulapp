import type { Metadata } from "next";

import { Button, SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { listConnections } from "@/lib/oauth";

import { revokeConnectionAction } from "../actions";

/**
 * Einstellungen › Verbundene Programme: was über den Web MCP mitlesen darf.
 * Ein verbundenes Programm sieht die Schulsachen und kann Vorschläge in den
 * Eingangskorb legen — ändern kann es nichts.
 */

export const metadata: Metadata = { title: "Verbundene Programme" };

const tag = (value: Date) =>
  value.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

export default async function VerbindungenPage() {
  const user = await requireUser();
  const connections = await listConnections(user.id);

  return (
    <>
      <SeitenKopf
        titel="Verbundene Programme"
        sub="Was über den Web MCP mitlesen darf. Ein verbundenes Programm liest und schlägt vor, ändern kann es nichts."
      />
      {connections.length === 0 ? (
        <p className="p-sub" style={{ marginTop: 16 }}>
          Nichts verbunden. Verbunden wird in der Claude-App unter Connectors, mit der Adresse <code>/api/mcp</code> dieser
          App; die Frage danach stellt dir diese App selbst.
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {connections.map((connection) => (
            <div key={connection.id} className="set-row">
              <div>
                <b style={{ fontWeight: 560 }}>{connection.clientName}</b>
                <span style={{ display: "block" }}>{`verbunden seit ${tag(connection.createdAt)}`}</span>
              </div>
              <form action={revokeConnectionAction}>
                <input type="hidden" name="id" value={connection.id} />
                <Button type="submit" variant="ghost">
                  Trennen
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
