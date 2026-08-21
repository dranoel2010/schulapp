import { pageImageResponse } from "./page-image-response";

/**
 * Das Vollbild einer Seite — 1600 Pixel lange Kante.
 *
 * Hier steht nur noch, was diese Adresse von der Vorschau nebenan
 * unterscheidet: welche der beiden bytea-Spalten gelesen wird. Sitzung,
 * Formatschranke und die Header liegen in ./page-image-response, und dort steht
 * auch, warum das Bild überhaupt über einen eigenen Route Handler geht und
 * nicht über `next/image`.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/material/[id]">,
) {
  const { id } = await context.params;

  return pageImageResponse(id, "voll");
}
