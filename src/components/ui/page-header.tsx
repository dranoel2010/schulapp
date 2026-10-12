import type { ReactNode } from "react";

export function PageHeader({ title, description, eyebrow, action }: { title: string; description?: ReactNode; eyebrow?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="min-w-0 flex-1 basis-60">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="page-heading">{title}</h1>
        {description && <div className="page-description">{description}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </header>
  );
}
