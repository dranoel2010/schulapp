/**
 * Die eigenen Icons von Modell 23 (Prototyp Z. 1016–1033): einheitliche
 * Linie 1.75px, nur wo sie etwas tragen. Gerendert als `span.ic` mit SVG,
 * Größe über `s18`/`s20` oder die Klasse des Elternteils.
 */

export const ICON_PFADE = {
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l4.5 4.5" />
    </>
  ),
  add: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M5 19l1.2-4.2L15.6 5.4a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L9.2 17.8z" />,
  arrow_back: <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  arrow_forward: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  chevron_right: <path d="M9.5 6l6 6-6 6" />,
  expand_more: <path d="M6 9.5l6 6 6-6" />,
  camera: (
    <>
      <path d="M3.5 8.5a2 2 0 0 1 2-2h2.3l1.5-2h5.4l1.5 2h2.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.6" />
    </>
  ),
  pause: <path d="M9 6.5v11M15 6.5v11" />,
} as const;

export type IconName = keyof typeof ICON_PFADE;

export function Icon({
  name,
  className,
  id,
}: {
  name: IconName;
  /** zusätzliche Klassen, etwa `s18`, `s20` oder `su-cam` */
  className?: string;
  id?: string;
}) {
  return (
    <span
      className={`ic${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      data-i={name}
      id={id}
    >
      <svg viewBox="0 0 24 24">{ICON_PFADE[name]}</svg>
    </span>
  );
}
