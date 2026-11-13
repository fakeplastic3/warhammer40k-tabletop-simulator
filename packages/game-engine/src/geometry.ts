import type { Point, Model, Unit, Terrain, GameState } from "@tabletop/shared";
export const EPS = 1e-7;
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const edgeDistance = (a: Model, b: Model) =>
  Math.max(0, distance(a, b) - a.radius - b.radius);
export const living = (u: Unit) => u.models.filter((m) => m.wounds > 0);
export function unitDistance(a: Unit, b: Unit) {
  if (a.reserve || b.reserve) return Infinity;
  return Math.min(
    ...living(a).flatMap((m) => living(b).map((n) => edgeDistance(m, n))),
  );
}
export function coherent(models: Model[]) {
  if (models.length < 2) return true;
  if (!models.every((a) => models.every((b) => edgeDistance(a, b) <= 9 + EPS)))
    return false;
  const visited = new Set([models[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of models)
      if (
        !visited.has(a.id) &&
        models.some((b) => visited.has(b.id) && edgeDistance(a, b) <= 2 + EPS)
      ) {
        visited.add(a.id);
        changed = true;
      }
  }
  return visited.size === models.length;
}
export function engaged(a: Unit, b: Unit) {
  return a.owner !== b.owner && unitDistance(a, b) <= 2 + EPS;
}
export function isEngaged(s: GameState, u: Unit) {
  return s.units.some((v) => engaged(u, v));
}
export function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const k = dx * dx + dy * dy;
  const t = k
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / k))
    : 0;
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
export function intersectsRect(a: Point, b: Point, r: Terrain, padding = 0) {
  let low = 0,
    high = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x + padding],
    [dx, r.x + r.width + padding - a.x],
    [-dy, a.y - r.y + padding],
    [dy, r.y + r.height + padding - a.y],
  ]) {
    if (Math.abs(p) < EPS) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low > high) return false;
    }
  }
  return true;
}
export function withinArea(m: Model, r: Terrain) {
  const x = Math.max(r.x, Math.min(m.x, r.x + r.width)),
    y = Math.max(r.y, Math.min(m.y, r.y + r.height));
  return distance(m, { x, y }) <= m.radius + EPS;
}
export function modelVisible(s: GameState, a: Model, target: Unit, b: Model) {
  if (target.reserve) return false;
  const area = s.terrain.find(
    (t) => t.category !== "exposed" && withinArea(b, t),
  );
  if (
    area &&
    target.shotTurn < s.turnNumber - 1 &&
    edgeDistance(a, b) > 15 + EPS
  )
    return false;
  const blockers = s.terrain.filter(
    (t) =>
      t.solid ||
      (t.category !== "exposed" && !withinArea(a, t) && !withinArea(b, t)),
  );
  // Agreed original counter geometry: five silhouette points, all on ground level.
  const points = (m: Model) => [
    m,
    { x: m.x + m.radius, y: m.y },
    { x: m.x - m.radius, y: m.y },
    { x: m.x, y: m.y + m.radius },
    { x: m.x, y: m.y - m.radius },
  ];
  return points(a).some((p) =>
    points(b).some(
      (q) => !blockers.some((t) => intersectsRect(p, q, t, 0.5 / 25.4)),
    ),
  );
}
export function covered(s: GameState, a: Model, u: Unit) {
  return (
    !!u.stealth ||
    (s.smokeUnits ?? []).some(
      (x) => x.turn === s.turnNumber && x.unitId === u.id,
    ) ||
    living(u).every(
      (m) =>
        (s.smokeUnits ?? []).some(
          (x) =>
            x.turn === s.turnNumber &&
            s.units.some(
              (v) =>
                v.id === x.unitId &&
                living(v).some(
                  (n) => pointSegmentDistance(n, a, m) <= n.radius,
                ),
            ),
        ) ||
        s.terrain.some((t) => withinArea(m, t)) ||
        s.terrain.some((t) => intersectsRect(a, m, t) && !withinArea(a, t)),
    )
  );
}
