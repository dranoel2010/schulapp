import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";
import { loadIservStatus } from "@/lib/iserv/status";

import { IservCard } from "../iserv-card";

/** Einstellungen › IServ: was die App aus IServ liest und in „Schule“ einträgt. */

export const metadata: Metadata = { title: "IServ" };

export default async function IservPage() {
  const user = await requireUser();
  const status = await loadIservStatus(user.id);
  return <IservCard status={status} />;
}
