// Pure ship-stat formatters shared by the ship HUD (PilotPanel) and the
// full-center ship-detail screen (ShipDetailView, TASK-127.2). Kept in a
// DOM-free module so exporting them next to a component doesn't trip
// react-refresh's component-only-export rule.

// hullVariant colours a hull bar by remaining fraction: green ≥50%, amber
// 25–50%, red below. Shield/energy/speed/cargo stay on the default accent.
export function hullVariant(hp: number, max: number): string {
  if (max <= 0) return '';
  const r = hp / max;
  if (r >= 0.5) return 'good';
  if (r >= 0.25) return 'warn';
  return 'danger';
}

// fmtScalar renders a one-decimal scalar (acceleration, turn rate).
export function fmtScalar(n: number): string {
  return n.toFixed(1);
}
