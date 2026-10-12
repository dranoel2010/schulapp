import { notFound } from "next/navigation";

import { probeErlaubt } from "@/lib/seiten/probe";

import { ProbeFormular } from "./probe-formular";

/** Ein Formular als echte Route über dem Stapel (Plan 2.4, Punkt 5). */
export default function ProbeFormularPage() {
  if (!probeErlaubt()) notFound();
  return <ProbeFormular />;
}
