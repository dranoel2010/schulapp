/**
 * Rahmen für Anmelden und Einrichten: eine ruhige, mittige Seite ohne
 * Navigation — hier ist der Nutzer noch nicht in der App drin.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="page pt-safe pb-safe flex flex-1 flex-col justify-center py-12">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-card bg-accent-soft text-accent">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 6.5A2.5 2.5 0 0 0 9.5 4H4.8a.8.8 0 0 0-.8.8v11.4c0 .44.36.8.8.8h4.7A2.5 2.5 0 0 1 12 19.5z" />
              <path d="M12 6.5A2.5 2.5 0 0 1 14.5 4h4.7c.44 0 .8.36.8.8v11.4a.8.8 0 0 1-.8.8h-4.7a2.5 2.5 0 0 0-2.5 2.5z" />
            </svg>
          </span>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Schulapp
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Klausuren, Stundenplan und Noten an einem Ort.
          </p>
        </div>

        {children}
      </div>
    </main>
  );
}
