import { leafMarkup, type Params } from './bloom';
import { petalPath, walk, taperedStroke, headingAt, fmt, type P2 } from './geometry';
import type { Palette } from './palettes';

/**
 * Small decorative pieces shared by bushes and wallpapers. Each is drawn in a
 * local frame: base at the origin, growing up (negative y).
 */

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Curvature for a curl that arcs gently, then winds into a spiral: it grows
 * with t², so total turning is `turns` revolutions over the length.
 */
const spiral = (len: number, side: number, turns: number, lean = 0.08) => (t: number) => side * (TAU / len) * (lean + turns * 3 * t * t);

/** Width profile that thins steadily and ends in a sharp point. */
const toPoint = (width: number) => (t: number) => width * Math.max(0, 1 - t) ** 0.65;

/** A tapered stem that curls into a tightening spiral. side +1 curls clockwise. */
export function tendril(len: number, width: number, side: number, color: string, turns = 1.25): string {
  const pts = walk(len, spiral(len, side, turns), 56);
  return `<path d="${taperedStroke(pts, toPoint(width))}" fill="${color}"/>`;
}

/** A single Khokhloma-style brush stroke: swells early, tapers to a sharp tip. */
export function feather(len: number, width: number, bend: number, color: string): string {
  const pts = walk(len, () => bend / len, 24);
  return `<path d="${taperedStroke(pts, (t) => width * (0.08 + 0.92 * Math.sin(Math.PI * t ** 0.6)) * (1 - t ** 4))}" fill="${color}"/>`;
}

/** Three brush strokes fanned out from one point. */
export function featherFan(len: number, width: number, side: number, colors: string[]): string {
  return [-1, 0, 1]
    .map((k, i) => {
      const l = len * (k === 0 ? 1 : 0.72);
      const bend = side * (0.7 + k * side * 0.35); // outer strokes bend away from the middle one
      return `<g transform="rotate(${k * 34})">${feather(l, width * (k === 0 ? 1 : 0.8), bend, colors[i % colors.length])}</g>`;
    })
    .join('');
}

/** "Kudrina": a big curling swirl with brush strokes sprouting off its outer edge. */
export function kudrina(r: number, side: number, u: number, main: string, accents: string[]): string {
  const len = r * 2.8;
  const base = r * 0.6;
  const pts = walk(len, spiral(len, side, 1.7, 0.3), 64);
  let strokes = '';
  const n = 3 + Math.floor(u * 3);
  for (let k = 0; k < n; k++) {
    const i = Math.round(lerp(0.08, 0.5, k / (n - 1)) * (pts.length - 1));
    const p = pts[i];
    const h = headingAt(pts, i);
    const fl = r * lerp(0.95, 0.5, k / n);
    strokes += `<g transform="translate(${fmt(p.x)} ${fmt(p.y + base)}) rotate(${fmt(h - side * 55)})">${feather(fl, r * 0.2, -side * 0.9, accents[k % accents.length])}</g>`;
  }
  return strokes + `<path transform="translate(0 ${fmt(base)})" d="${taperedStroke(pts, toPoint(r * 0.26))}" fill="${main}"/>`;
}

export function budMarkup(r: number, c1: string, c2: string, pal: Palette): string {
  const L = r * 1.35;
  const base = r * 0.5; // sit the bud a little back down the stem
  let s = '';
  for (const side of [-1, 1]) {
    s += `<g transform="translate(0 ${fmt(base)}) rotate(${side * 38})"><path d="${petalPath({ length: L * 0.55, halfWidth: L * 0.18, bulge: 0.5, pointy: 0.85, notch: 0, curl: side * 0.2 })}" fill="${pal.leaf}"/></g>`;
  }
  s += `<path transform="translate(0 ${fmt(base)})" d="${petalPath({ length: L, halfWidth: L * 0.36, bulge: 0.42, pointy: 0.55, notch: 0, curl: 0 })}" fill="${c1}"/>`;
  s += `<path transform="translate(0 ${fmt(base - L * 0.18)})" d="${petalPath({ length: L * 0.62, halfWidth: L * 0.19, bulge: 0.5, pointy: 0.85, notch: 0, curl: 0 })}" fill="${c2}"/>`;
  return s;
}

export function berriesMarkup(r: number, u: number, color: string, pal: Palette): string {
  const k = 3 + Math.min(2, Math.floor(u * 3));
  const br = r * 0.27;
  let stems = '', dots = '';
  for (let i = 0; i < k; i++) {
    const a = ((i / (k - 1)) * 2 - 1) * 55 * (Math.PI / 180);
    const d = r * (i % 2 ? 0.75 : 0.55);
    const bx = Math.sin(a) * d, by = r * 0.35 - Math.cos(a) * d;
    stems += `<path d="M0 ${fmt(r * 0.35)} L${fmt(bx)} ${fmt(by)}" stroke="${pal.stem}" stroke-width="${fmt(r * 0.06)}" stroke-linecap="round"/>`;
    dots += `<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="${fmt(br)}" fill="${color}"/>`;
  }
  return stems + dots;
}

export function sprigMarkup(r: number, u: number, p: Params, pal: Palette): string {
  const len = r * 1.7;
  const leafPal = u > 0.5 ? { ...pal, leaf: pal.leaf2 } : pal;
  let s = `<path d="M0 ${fmt(r * 0.4)} L0 ${fmt(r * 0.4 - len)}" stroke="${leafPal.leaf}" stroke-width="${fmt(r * 0.07)}" stroke-linecap="round"/>`;
  const pairs = 3;
  for (let i = 0; i < pairs; i++) {
    const t = (i + 0.6) / (pairs + 0.6);
    const ll = r * 0.62 * (1 - t * 0.45);
    const y = r * 0.4 - len * t;
    for (const side of [-1, 1]) {
      s += `<g transform="translate(0 ${fmt(y)}) rotate(${side * 48})">${leafMarkup(ll, ll * 0.28, side * (0.05 + p.curl * 0.3), false, leafPal)}</g>`;
    }
  }
  s += `<g transform="translate(0 ${fmt(r * 0.4 - len)})">${leafMarkup(r * 0.5, r * 0.15, 0, false, leafPal)}</g>`;
  return s;
}

// ---- foliage sprays (wallpaper) -----------------------------------------------------

export type Foliage = 'leafy' | 'bigleaf' | 'budstem' | 'curl' | 'fan';

/**
 * A spray of foliage `len` long, growing up from the origin. `u` holds stable
 * randoms; `side` picks which way it leans; `accent` colors buds.
 */
export function foliage(kind: Foliage, len: number, u: number[], side: number, p: Params, pal: Palette, accent: string): string {
  const [green, other] = u[0] < 0.5 ? [pal.leaf, pal.leaf2] : [pal.leaf2, pal.leaf];
  const greenPal = { ...pal, leaf: green, leaf2: other };
  const at = (pts: P2[], t: number) => {
    const i = Math.round(t * (pts.length - 1));
    return { pt: pts[i], h: headingAt(pts, i) };
  };
  const place = (pt: P2, rot: number, inner: string) => `<g transform="translate(${fmt(pt.x)} ${fmt(pt.y)}) rotate(${fmt(rot)})">${inner}</g>`;
  const curvedStem = (bend: number, width: number, color: string) => {
    const pts = walk(len, () => (side * bend) / len, 30);
    return { pts, svg: `<path d="${taperedStroke(pts, (t) => width * (1 - 0.7 * t))}" fill="${color}"/>` };
  };

  switch (kind) {
    case 'leafy': {
      const { pts, svg } = curvedStem(lerp(0.2, 0.9, u[1]), Math.max(2.5, len * 0.028), green);
      const paired = u[2] < 0.5;
      const n = Math.max(3, Math.round(len / (paired ? 70 : 48)));
      let leaves = '';
      for (let k = 0; k < n; k++) {
        const t = lerp(0.22, 0.86, k / (n - 1));
        const { pt, h } = at(pts, t);
        const ll = len * lerp(0.42, 0.24, t);
        const sides = paired ? [-1, 1] : [k % 2 ? 1 : -1];
        for (const sd of sides) leaves += place(pt, h + sd * 52, leafMarkup(ll, ll * 0.34, sd * (0.06 + p.curl * 0.25), false, greenPal));
      }
      const tip = at(pts, 1);
      return svg + leaves + place(tip.pt, tip.h, leafMarkup(len * 0.28, len * 0.095, 0, false, greenPal));
    }
    case 'bigleaf': {
      const stem = `<path d="M0 0 L0 ${fmt(-len * 0.22)}" stroke="${green}" stroke-width="${fmt(Math.max(2.5, len * 0.03))}" stroke-linecap="round"/>`;
      return stem + place({ x: 0, y: -len * 0.18 }, 0, leafMarkup(len * 0.82, len * lerp(0.3, 0.4, u[1]), side * (0.1 + p.curl * 0.3), true, greenPal));
    }
    case 'budstem': {
      const { pts, svg } = curvedStem(lerp(0.4, 1.2, u[1]), Math.max(2, len * 0.022), green);
      const n = Math.max(2, Math.round(len / 50));
      let buds = '';
      const bud = (L: number) =>
        `<path d="${petalPath({ length: L, halfWidth: L * 0.36, bulge: 0.42, pointy: 0.5, notch: 0, curl: 0 })}" fill="${accent}"/>` +
        `<path d="${petalPath({ length: L * 0.42, halfWidth: L * 0.3, bulge: 0.55, pointy: 0.3, notch: 0, curl: 0 })}" fill="${green}"/>`;
      for (let k = 0; k < n; k++) {
        const t = lerp(0.3, 0.85, n > 1 ? k / (n - 1) : 0);
        const { pt, h } = at(pts, t);
        const sd = k % 2 ? 1 : -1;
        buds += place(pt, h + sd * 50, bud(len * lerp(0.24, 0.17, t)));
      }
      const tip = at(pts, 1);
      return svg + buds + place(tip.pt, tip.h, bud(len * 0.22));
    }
    case 'curl': {
      const pts = walk(len, spiral(len, side, lerp(0.9, 1.4, u[1])), 56);
      let leaves = '';
      for (const t of [0.18, 0.4]) {
        const { pt, h } = at(pts, t);
        const ll = len * (t < 0.3 ? 0.4 : 0.3);
        leaves += place(pt, h - side * 58, leafMarkup(ll, ll * 0.34, -side * 0.1, false, greenPal));
      }
      return leaves + `<path d="${taperedStroke(pts, toPoint(Math.max(4, len * 0.065)))}" fill="${green}"/>`;
    }
    case 'fan':
      return featherFan(len * 0.95, len * 0.3, side, [green, accent, other]);
  }
}
