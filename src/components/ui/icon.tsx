import type { ComponentProps } from "react";

const paths = {
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 14h2m6 0h2m-10 4h2",
  tasks: "m3 6 2 2 4-4m3 2h9M3 14h5v6H3zM12 15h9m-9 4h6",
  material: "M8 3h10a2 2 0 0 1 2 2v12M4 7h12v14H4zM7 11h6m-6 4h6",
  learn: "M12 6C8 3 4 3 2 4v15c3-1 7 0 10 2m0-15c4-3 8-3 10-2v15c-3-1-7 0-10 2V6",
  recall: "M20 7a8 8 0 1 0 0 10M20 3v5h-5M12 8v4l3 2",
  grades: "M4 21h17M7 17v-6m5 6V4m5 13V8",
  subjects: "M4 19a2 2 0 0 1 2-2h14M6 3h14v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 0v8l3-2 3 2V3",
  settings: "M3 7h7m6 0h5M3 17h3m6 0h9M10 4h6v6h-6zM6 14h6v6H6z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  camera: "M8 6 9.5 3h5L16 6h5v15H3V6h5Zm8 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  back: "M19 12H5m5-5-5 5 5 5",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-5", ...props }: ComponentProps<"svg"> & { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...props}>
      <path d={paths[name]} />
    </svg>
  );
}
