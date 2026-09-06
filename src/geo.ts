export type Coordinate = [number, number];
const rad = Math.PI / 180;
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
export function distance(a: Coordinate, b: Coordinate): number {
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
const vector = ([lon, lat]: Coordinate) => [
  Math.cos(lat * rad) * Math.cos(lon * rad),
  Math.cos(lat * rad) * Math.sin(lon * rad),
  Math.sin(lat * rad),
];
export function interpolate(
  a: Coordinate,
  b: Coordinate,
  fraction: number,
): Coordinate {
  const t = Math.max(0, Math.min(1, fraction));
  if (t === 0) return [...a];
  if (t === 1) return [...b];
  const u = vector(a),
    v = vector(b);
  const dot = clamp(u.reduce((s, x, i) => s + x * v[i], 0));
  const angle = Math.acos(dot);
  if (angle < 1e-10) return [...a];
  let tangent = v.map((x, i) => x - dot * u[i]);
  let length = Math.hypot(...tangent);
  // Antipodes have infinitely many routes: choose a deterministic perpendicular.
  if (length < 1e-10) {
    const axis = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const projection = u.reduce((s, x, i) => s + x * axis[i], 0);
    tangent = axis.map((x, i) => x - projection * u[i]);
    length = Math.hypot(...tangent);
  }
  const p = u.map(
    (x, i) =>
      x * Math.cos(t * angle) + (tangent[i] / length) * Math.sin(t * angle),
  );
  return [
    Math.atan2(p[1], p[0]) / rad,
    Math.atan2(p[2], Math.hypot(p[0], p[1])) / rad,
  ];
}
export function bearing(a: Coordinate, b: Coordinate): number {
  const d = (b[0] - a[0]) * rad;
  return (
    (Math.atan2(
      Math.sin(d) * Math.cos(b[1] * rad),
      Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
        Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(d),
    ) /
      rad +
      360) %
    360
  );
}
export function route(a: Coordinate, b: Coordinate): Coordinate[] {
  const points: Coordinate[] = [];
  for (let i = 0; i <= 128; i++) {
    const point = interpolate(a, b, i / 128);
    if (points.length) {
      while (point[0] - points[i - 1][0] > 180) point[0] -= 360;
      while (point[0] - points[i - 1][0] < -180) point[0] += 360;
    }
    points.push(point);
  }
  return points;
}
