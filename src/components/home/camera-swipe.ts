/** Eine Geste behält ihre erste eindeutige Richtung: Scrollen bleibt Scrollen. */
export function cameraSwipe(page: number, startX: number, startY: number) {
  let axis: "horizontal" | "vertical" | null = null;
  let distance = 0;

  function move(x: number, y: number) {
    const dx = x - startX;
    const dy = y - startY;
    if (axis === null && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
      axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "horizontal" : "vertical";
    }
    distance = dx;
    return axis === "horizontal";
  }

  function finish(x: number, y: number) {
    move(x, y);
    if (axis !== "horizontal") return null;
    if (page === 1 && distance >= 60) return 0;
    if (page === 0 && distance <= -60) return 1;
    return null;
  }

  return { move, finish };
}
