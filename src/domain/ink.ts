/**
 * Freehand ink geometry. Strokes are stored as flat `[x0, y0, x1, y1, …]` arrays in absolute
 * world coordinates, the same space as cards. Everything here is pure and used by both the
 * domain tests and the renderer.
 */
export type Point = [number, number];
export function pairs(flat: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}
export function flatten(points: readonly Point[]): number[] {
  const out: number[] = [];
  for (const [x, y] of points) out.push(x, y);
  return out;
}
/** Distance from a point to a segment. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
/** Ramer–Douglas–Peucker, iterative so long strokes cannot overflow the stack. */
export function simplify(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3 || epsilon <= 0) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let index = -1,
      max = 0;
    const [ax, ay] = points[start]!,
      [bx, by] = points[end]!;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i]![0], points[i]![1], ax, ay, bx, by);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index !== -1 && max > epsilon) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
/** SVG path with quadratic smoothing through segment midpoints; a single point becomes a dot. */
export function strokePath(points: readonly Point[]): string {
  if (!points.length) return '';
  const r = (n: number) => Math.round(n * 100) / 100;
  const [x0, y0] = points[0]!;
  if (points.length === 1) return `M${r(x0)} ${r(y0)}l0.01 0`;
  if (points.length === 2) return `M${r(x0)} ${r(y0)}L${r(points[1]![0])} ${r(points[1]![1])}`;
  let d = `M${r(x0)} ${r(y0)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i]!,
      [nx, ny] = points[i + 1]!;
    d += `Q${r(cx)} ${r(cy)} ${r((cx + nx) / 2)} ${r((cy + ny) / 2)}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  d += `L${r(lx)} ${r(ly)}`;
  return d;
}
/** True when a point lies within `tolerance` of the stroke's visible body. */
export function hitStroke(flat: readonly number[], width: number, x: number, y: number, tolerance: number): boolean {
  const reach = width / 2 + tolerance;
  if (flat.length < 2) return false;
  if (flat.length === 2) return Math.hypot(x - flat[0]!, y - flat[1]!) <= reach;
  for (let i = 0; i + 3 < flat.length; i += 2)
    if (distanceToSegment(x, y, flat[i]!, flat[i + 1]!, flat[i + 2]!, flat[i + 3]!) <= reach) return true;
  return false;
}
export function strokeBounds(flat: readonly number[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    minX = Math.min(minX, flat[i]!);
    maxX = Math.max(maxX, flat[i]!);
    minY = Math.min(minY, flat[i + 1]!);
    maxY = Math.max(maxY, flat[i + 1]!);
  }
  return { minX, minY, maxX, maxY };
}
