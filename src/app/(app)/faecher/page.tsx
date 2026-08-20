import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { listSubjects } from "@/lib/subjects";

import { quickAddSubjectsAction } from "./actions";
import { QuickAdd } from "./quick-add";
import { SubjectList } from "./subject-list";

export const metadata: Metadata = {
  title: "Fächer",
};

export default async function SubjectsPage() {
  const user = await requireUser();
  const subjects = await listSubjects(user.id, { includeArchived: true });

  const active = subjects.filter((subject) => !subject.archived);
  const archived = subjects.filter((subject) => subject.archived);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Fächer</h1>
        {subjects.length > 0 ? (
          <ButtonLink href="/faecher/neu" variant="secondary">
            Fach anlegen
          </ButtonLink>
        ) : null}
      </header>

      {subjects.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title="Noch keine Fächer"
            description="Fächer sind der Anfang: Klausuren, Stundenplan, Hausaufgaben und Noten hängen alle an ihnen."
            action={<ButtonLink href="/faecher/neu">Fach anlegen</ButtonLink>}
            icon={
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
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v13H5.5A1.5 1.5 0 0 0 4 18.5z" />
                <path d="M4 18.5A1.5 1.5 0 0 0 5.5 20H19v-3" />
                <path d="M9 4v9l2.5-1.8L14 13V4" />
              </svg>
            }
          />

          <QuickAdd action={quickAddSubjectsAction} />
        </div>
      ) : (
        <SubjectList active={active} archived={archived} />
      )}
    </div>
  );
}
