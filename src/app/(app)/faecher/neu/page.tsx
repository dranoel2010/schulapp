import type { Metadata } from "next";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";

import { createSubjectAction, quickAddSubjectsAction } from "../actions";
import { QuickAdd } from "../quick-add";
import { SubjectForm } from "../subject-form";

/** Fach anlegen (Plan 2.2): einzeln mit allen Angaben oder mehrere auf einmal. */

export const metadata: Metadata = {
  title: "Neues Fach",
};

export default async function NewSubjectPage() {
  await requireUser();

  return (
    <>
      <SeitenKopf titel="Fach anlegen" sub="Name, Kürzel und Gewichtung; ändern lässt sich alles später." />
      <div style={{ marginTop: 16 }}>
        <SubjectForm action={createSubjectAction} submitLabel="Fach anlegen" />
      </div>
      <QuickAdd action={quickAddSubjectsAction} />
    </>
  );
}
