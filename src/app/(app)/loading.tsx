export default function Loading() {
  return (
    <div role="status" aria-label="Seite wird geladen" className="space-y-6 motion-safe:animate-pulse">
      <span className="sr-only">Deine Seite wird geladen …</span>
      <div className="h-9 w-52 rounded-control bg-surface-muted" />
      <div className="h-4 w-3/4 max-w-md rounded-control bg-surface-muted" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-40 rounded-card border border-border bg-surface" />)}
      </div>
    </div>
  );
}
