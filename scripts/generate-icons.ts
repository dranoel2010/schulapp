/**
 * Erzeugt die PWA-Icons in public/icons aus dem SVG weiter unten.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Motiv: abgerundetes Quadrat in der Akzentfarbe, darauf ein aufgeschlagenes
 * Heft aus zwei weißen Seiten. Bewusst grob — das Ding wird auf dem
 * Homescreen nur 48px groß angezeigt.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ACCENT = "#4f46e5";
const MARK = "#ffffff";
const OUT_DIR = path.join(process.cwd(), "public", "icons");

type IconSpec = {
  file: string;
  size: number;
  /** Eckenradius im 512er-Raster. 0 heißt randlos — das braucht maskable. */
  radius: number;
  /** Größe des Zeichens. Kleiner als 1 schafft den Sicherheitsrand. */
  glyphScale: number;
};

const ICONS: IconSpec[] = [
  { file: "icon-192.png", size: 192, radius: 112, glyphScale: 1.15 },
  { file: "icon-512.png", size: 512, radius: 112, glyphScale: 1.15 },
  // Android schneidet maskable-Icons rund zu: Fläche randlos füllen und das
  // Zeichen kleiner halten, damit rundum gut 10% Luft bleiben.
  { file: "icon-maskable-512.png", size: 512, radius: 0, glyphScale: 0.95 },
];

function svgFor({ size, radius, glyphScale }: IconSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" ry="${radius}" fill="${ACCENT}"/>
  <g transform="translate(256 256) scale(${glyphScale}) translate(-256 -256)"
     fill="${MARK}" stroke="${MARK}" stroke-width="26" stroke-linejoin="round">
    <path d="M140 180 L232 164 L232 348 L140 332 Z"/>
    <path d="M372 180 L280 164 L280 348 L372 332 Z"/>
  </g>
</svg>`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  for (const spec of ICONS) {
    const png = await sharp(Buffer.from(svgFor(spec))).png().toBuffer();
    await writeFile(path.join(OUT_DIR, spec.file), png);
    console.log(`${spec.file}  ${spec.size}x${spec.size}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
