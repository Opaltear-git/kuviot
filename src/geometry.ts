/**
 * Shape primitives. Everything is built in a local frame where the shape's
 * base sits at (0,0) and it grows "up" toward negative y (SVG convention).
 */

export interface PetalShape {
  length: number;
  halfWidth: number;
  /** Where the widest point sits along the length, 0..1. */
  bulge: number;
  /** 0 = round tip, 1 = sharp tip. */
  pointy: number;
  /** 0 = none, 1 = deep heart-shaped notch at the tip. */
  notch: number;
  /** Sideways bend of the tip, as a fraction of length. Signed. */
  curl: number;
}

type Pt = [number, number];
type Seg = [Pt, Pt, Pt]; // cubic: control1, control2, end

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function petalPath(s: PetalShape): string {
  const L = s.length;
  const w = s.halfWidth;
  const p = s.pointy;
  const yb = -L * s.bulge;
  const upper = L - L * s.bulge;

  // Right half only; the left half is its mirror.
  const segs: Seg[] = [[[w * 0.3, -L * s.bulge * 0.1], [w, yb + L * s.bulge * 0.5], [w, yb]]];
  if (s.notch > 0) {
    const tipY = -L * (1 - 0.16 * s.notch);
    segs.push([[w, yb - upper * 0.55], [w * 0.95, -L], [w * 0.45, -L]]);
    segs.push([[w * 0.15, -L], [w * 0.04, tipY - L * 0.03], [0, tipY]]);
  } else {
    segs.push([
      [w, yb - upper * lerp(0.6, 0.35, p)],
      [lerp(w * 0.62, w * 0.06, p), lerp(-L, -L * 0.9, p)],
      [0, -L],
    ]);
  }

  // Bend the whole petal sideways, more strongly toward the tip.
  const bend = ([x, y]: Pt): string => {
    const t = Math.max(0, -y / L);
    return `${fmt(x + s.curl * L * t * t)} ${fmt(y)}`;
  };

  let d = 'M0 0';
  for (const [c1, c2, e] of segs) d += ` C${bend(c1)} ${bend(c2)} ${bend(e)}`;
  const starts: Pt[] = [[0, 0], ...segs.slice(0, -1).map((sg) => sg[2])];
  for (let i = segs.length - 1; i >= 0; i--) {
    const [c1, c2] = segs[i];
    const st = starts[i];
    d += ` C${bend([-c2[0], c2[1]])} ${bend([-c1[0], c1[1]])} ${bend([-st[0], st[1]])}`;
  }
  return d + 'Z';
}

/** Where the petal's spine sits at distance `d` from its base, after curl. */
export function petalAxisX(s: PetalShape, d: number): number {
  const t = d / s.length;
  return s.curl * s.length * t * t;
}

/** Heart centred on the origin, point down. */
export function heartPath(r: number): string {
  return `M0 ${fmt(r * 0.9)} C${fmt(-r * 1.3)} ${fmt(-r * 0.1)} ${fmt(-r * 0.6)} ${fmt(-r * 1.1)} 0 ${fmt(-r * 0.35)} ` +
    `C${fmt(r * 0.6)} ${fmt(-r * 1.1)} ${fmt(r * 1.3)} ${fmt(-r * 0.1)} 0 ${fmt(r * 0.9)}Z`;
}

/** Teardrop centred roughly on the origin, point up. */
export function teardropPath(r: number): string {
  return `M0 ${fmt(-r * 1.3)} C${fmt(r * 0.5)} ${fmt(-r * 0.6)} ${fmt(r)} ${fmt(-r * 0.1)} ${fmt(r)} ${fmt(r * 0.3)} ` +
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(-r)} ${fmt(r * 0.3)} ` +
    `C${fmt(-r)} ${fmt(-r * 0.1)} ${fmt(-r * 0.5)} ${fmt(-r * 0.6)} 0 ${fmt(-r * 1.3)}Z`;
}

// ---- brush strokes -------------------------------------------------------------

export type P2 = { x: number; y: number };

/**
 * Trace a path from the origin, heading up, turning by `curvature(t)`
 * (radians per unit length) as it goes. Constant curvature gives an arc;
 * growing curvature gives a spiral that tightens toward the end.
 */
export function walk(len: number, curvature: (t: number) => number, steps = 40): P2[] {
  const pts: P2[] = [{ x: 0, y: 0 }];
  const ds = len / steps;
  let x = 0, y = 0, h = 0;
  for (let i = 1; i <= steps; i++) {
    h += curvature((i - 0.5) / steps) * ds;
    x += Math.sin(h) * ds;
    y -= Math.cos(h) * ds;
    pts.push({ x, y });
  }
  return pts;
}

/** Filled outline around a centerline whose width varies along it: a brush stroke. */
export function taperedStroke(pts: P2[], width: (t: number) => number): string {
  const n = pts.length;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
    const w = width(i / (n - 1)) / 2;
    left.push(`${fmt(pts[i].x + nx * w)} ${fmt(pts[i].y + ny * w)}`);
    right.push(`${fmt(pts[i].x - nx * w)} ${fmt(pts[i].y - ny * w)}`);
  }
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

/** Heading (degrees clockwise from up) of a walked path at index i. */
export function headingAt(pts: P2[], i: number): number {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  return (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI;
}

export { fmt };
