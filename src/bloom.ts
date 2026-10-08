import { petalPath, petalAxisX, heartPath, teardropPath, fmt, type PetalShape } from './geometry';
import type { Palette } from './palettes';

/**
 * A specimen is two gene arrays of 0..1 floats:
 *   dna  — shape. Read by fixed slot so mutating one trait never reshuffles the rest.
 *   cdna — color assignment within the chosen palette.
 * The sliders (Params) don't change the genes; they change how genes map to
 * shapes, so dragging a slider morphs the *same* flower.
 */
export interface Params {
  lush: number;  // sparse ↔ lush
  open: number;  // fan ↔ rosette
  shape: number; // round ↔ pointy
  curl: number;  // straight ↔ curly
}

const MAX_LAYERS = 6;
const LAYER_BASE = 16;
const LAYER_SLOTS = 12;
export const DNA_LEN = LAYER_BASE + MAX_LAYERS * LAYER_SLOTS + 8;
export const CDNA_LEN = 16;

// Global dna slots
export const G = {
  layers: 0, shrink: 1, centerKind: 2, centerSize: 3, sepal: 4, sepalLen: 5,
  leafAngle: 6, leafLen: 7, leafWidth: 8, leafY: 9, leafCurl: 10, leafPair2: 11,
  arcJitter: 13, leafInset: 14, centerDetail: 15,
} as const;
// Per-layer dna slots
const S = {
  count: 0, overlap: 1, bulge: 2, pointy: 3, notch: 4, curl: 5, fringe: 6,
  inset: 7, insetScale: 8, length: 9, arc: 10, tipDots: 11,
} as const;

export const VIEWBOX = { x: -150, y: -135, w: 300, h: 340 };

/** Petal length of the outermost layer; blooms are roughly this radius. */
export const BLOOM_R = 100;
const STEM_LEN = 190;
const RAD = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const pick = (v: number, n: number) => Math.min(n - 1, Math.floor(v * n));

/** Wrap content in a group that scales in from its local origin when animating. */
export const popper = (animate: boolean | undefined) => (delay: number, inner: string) =>
  animate ? `<g class="k-pop" style="--d:${Math.round(delay)}ms">${inner}</g>` : inner;

export interface RenderOpts {
  animate?: boolean;
  background?: boolean;
  /** Rendering for a small offspring card; layouts may simplify. */
  thumb?: boolean;
}

/**
 * The flower head alone (sepals, petal layers, center), centred on the origin
 * and opening upward, about BLOOM_R in radius.
 */
export function bloomBody(dna: number[], cdna: number[], p: Params, pal: Palette, animate?: boolean): string {
  const g = (i: number) => dna[i] ?? 0.5;
  const pop = popper(animate);
  const out: string[] = [];

  // ---- colors -------------------------------------------------------------
  // The palette background is never used inside a flower.
  const m = pal.blooms.length;
  const co = pick(cdna[0], m);
  const cstep = 1 + pick(cdna[1], m - 1); // never a multiple of m → neighbours differ
  const col = (i: number) => pal.blooms[(co + i * cstep) % m];
  const insetCol = (i: number) => pal.blooms[(co + i * cstep + 1 + pick(cdna[2], m - 1)) % m];

  // ---- structure ----------------------------------------------------------
  const nL = clamp(Math.round(lerp(2, 5.4, p.lush) + (g(G.layers) - 0.5) * 1.6), 2, MAX_LAYERS);
  const shrink = lerp(0.55, 0.8, g(G.shrink)) / nL;
  let arcBase = lerp(150, 360, p.open) + (g(G.arcJitter) - 0.5) * 40;
  const full = arcBase >= 340;
  arcBase = clamp(arcBase, 120, 340);

  // ---- sepals (green cup under the bloom) ---------------------------------
  if (g(G.sepal) > 0.3) {
    const a = lerp(110, 150, g(G.sepal));
    const len = lerp(28, 52, g(G.sepalLen));
    for (const side of [-1, 1]) {
      const shape: PetalShape = { length: len, halfWidth: len * 0.32, bulge: 0.5, pointy: 0.8, notch: 0, curl: side * 0.25 };
      out.push(`<g transform="rotate(${fmt(side * a)})">${pop(140, `<path d="${petalPath(shape)}" fill="${pal.leaf}"/>`)}</g>`);
    }
  }

  // ---- petal layers, back to front ------------------------------------------
  let innerL = BLOOM_R;
  for (let i = 0; i < nL; i++) {
    const lg = (k: number) => g(LAYER_BASE + i * LAYER_SLOTS + k);
    const t = nL > 1 ? i / (nL - 1) : 0;
    const L = BLOOM_R * (1 - i * shrink) * lerp(0.94, 1.04, lg(S.length));
    innerL = L;
    const fringe = lg(S.fringe) < 0.2 && i < nL - 1 && nL > 2;
    const arc = full ? 360 : clamp(arcBase * lerp(1, lerp(0.55, 1, lg(S.arc)), t), 60, 340);

    let count = Math.round((arc / 360) * lerp(6, 15, clamp(p.lush * 0.55 + lg(S.count) * 0.45)) * (1 - t * 0.25));
    if (fringe) count = Math.round(count * 2.2);
    count = Math.max(full ? 4 : 3, count);
    const stepDeg = arc / count;

    const overlap = fringe ? lerp(0.45, 0.75, lg(S.overlap)) : lerp(1.0, 1.7, lg(S.overlap));
    const bulge = fringe ? lerp(0.5, 0.7, lg(S.bulge)) : lerp(0.38, 0.68, lg(S.bulge));
    const hw = Math.min(L * 0.6, L * bulge * Math.tan(Math.min((stepDeg * RAD * overlap) / 2, 1.15)));
    const pointy = fringe ? Math.max(0.75, p.shape) : clamp(p.shape + (lg(S.pointy) - 0.5) * 0.7);
    const notch = !fringe && pointy < 0.45 && lg(S.notch) > 0.6 ? lerp(0.5, 1, (lg(S.notch) - 0.6) / 0.4) : 0;
    const curlAmt = p.curl * lerp(0.25, 1, lg(S.curl)) * 0.42;
    const inset = !fringe && lg(S.inset) > 0.45;
    const insetS = lerp(0.42, 0.66, lg(S.insetScale));
    const tipDots = i === 0 && lg(S.tipDots) > 0.7;
    const color = col(i);

    // Angles symmetric about vertical; alternate rosette layers interleave.
    const angles: number[] = [];
    for (let k = 0; k < count; k++) {
      let a = full ? k * stepDeg + (i % 2) * (stepDeg / 2) : -arc / 2 + stepDeg * (k + 0.5);
      a = ((a + 180) % 360 + 360) % 360 - 180;
      angles.push(a);
    }
    // Draw the bottom-most petals first so the top of each layer sits on top.
    angles.sort((a, b) => Math.abs(b) - Math.abs(a));

    for (const a of angles) {
      const curlSign = Math.sign(a) * Math.min(1, Math.abs(Math.sin(a * RAD)) * 2.5);
      const shape: PetalShape = { length: L, halfWidth: hw, bulge, pointy, notch, curl: curlAmt * curlSign };
      let inner = `<path d="${petalPath(shape)}" fill="${color}"/>`;
      if (inset) {
        const sub: PetalShape = { ...shape, length: L * insetS, halfWidth: hw * insetS * 0.75, notch: 0, pointy: Math.max(pointy, 0.3) };
        const dy = L * (1 - insetS) * 0.55;
        inner += `<path transform="translate(${fmt(petalAxisX(shape, dy))} ${fmt(-dy)})" d="${petalPath(sub)}" fill="${insetCol(i)}"/>`;
      }
      if (tipDots) {
        const r = Math.max(2.5, L * 0.045);
        const d = L + r * 2.4;
        inner += `<circle cx="${fmt(petalAxisX(shape, d))}" cy="${fmt(-d)}" r="${fmt(r)}" fill="${insetCol(i + 1)}"/>`;
      }
      const delay = 260 + i * 120 + (Math.abs(a) / 180) * 160;
      out.push(`<g transform="rotate(${fmt(a)})">${pop(delay, inner)}</g>`);
    }
  }

  // ---- center ---------------------------------------------------------------
  const cr = Math.max(9, innerL * lerp(0.28, 0.5, g(G.centerSize)));
  const cBase = col(nL);
  const cDet = cdna[4] > 0.5 ? pal.ink : col(nL + 1);
  let center = '';
  switch (pick(g(G.centerKind), 4)) {
    case 0: {
      center = `<circle r="${fmt(cr)}" fill="${cBase}"/>`;
      if (g(G.centerDetail) > 0.5) {
        const n = 6 + pick(g(G.centerDetail), 5);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          center += `<circle cx="${fmt(Math.sin(a) * cr * 0.62)}" cy="${fmt(-Math.cos(a) * cr * 0.62)}" r="${fmt(cr * 0.14)}" fill="${cDet}"/>`;
        }
      }
      center += `<circle r="${fmt(cr * 0.26)}" fill="${cDet}"/>`;
      break;
    }
    case 1:
      center = `<circle r="${fmt(cr)}" fill="${cBase}"/><path d="${heartPath(cr * 0.62)}" fill="${cDet}"/>`;
      break;
    case 2:
      center = `<path d="${teardropPath(cr)}" fill="${cBase}"/><path transform="translate(0 ${fmt(cr * 0.25)})" d="${teardropPath(cr * 0.5)}" fill="${cDet}"/>`;
      break;
    default:
      center = `<circle r="${fmt(cr)}" fill="${cBase}"/><circle r="${fmt(cr * 0.66)}" fill="${cDet}"/><circle r="${fmt(cr * 0.33)}" fill="${cBase}"/>`;
  }
  out.push(pop(260 + nL * 120 + 120, center));
  return out.join('');
}

/** A single flower on its stem, as a complete SVG document. */
export function renderBloom(dna: number[], cdna: number[], p: Params, pal: Palette, opts: RenderOpts = {}): string {
  const g = (i: number) => dna[i] ?? 0.5;
  const pop = popper(opts.animate);
  const out: string[] = [];

  if (opts.background) {
    out.push(`<rect x="${VIEWBOX.x}" y="${VIEWBOX.y}" width="${VIEWBOX.w}" height="${VIEWBOX.h}" fill="${pal.bg}"/>`);
  }

  out.push(`<path class="k-stem" pathLength="1" d="M0 ${STEM_LEN} L0 0" stroke="${pal.stem}" stroke-width="6" stroke-linecap="round" fill="none"/>`);

  const leafPair = (y: number, angle: number, len: number, delay: number) => {
    const w = len * lerp(0.17, 0.32, g(G.leafWidth));
    const curl = 0.08 + p.curl * 0.45 * lerp(0.4, 1, g(G.leafCurl));
    for (const side of [-1, 1]) {
      const inner = leafMarkup(len, w, side * curl, g(G.leafInset) > 0.5, pal);
      out.push(`<g transform="translate(0 ${fmt(y)}) rotate(${fmt(side * angle)})">${pop(delay, inner)}</g>`);
    }
  };
  const leafY = lerp(85, 135, g(G.leafY));
  const leafA = lerp(35, 78, g(G.leafAngle));
  const leafL = lerp(42, 78, g(G.leafLen));
  leafPair(leafY, leafA, leafL, 220);
  if (g(G.leafPair2) > 0.45) leafPair(leafY + 40, leafA + 8, leafL * 0.72, 300);

  out.push(bloomBody(dna, cdna, p, pal, opts.animate));

  const { x, y, w, h } = VIEWBOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${opts.animate ? ' class="anim"' : ''}>${out.join('')}</svg>`;
}

/** A leaf with its base at the origin, pointing up, optionally with a lighter vein. */
export function leafMarkup(len: number, halfWidth: number, curl: number, vein: boolean, pal: Palette): string {
  const shape: PetalShape = { length: len, halfWidth, bulge: 0.45, pointy: 0.9, notch: 0, curl };
  let s = `<path d="${petalPath(shape)}" fill="${pal.leaf}"/>`;
  if (vein) {
    const v: PetalShape = { ...shape, length: len * 0.62, halfWidth: halfWidth * 0.32 };
    const dy = len * 0.16;
    s += `<path transform="translate(${fmt(petalAxisX(shape, dy))} ${fmt(-dy)})" d="${petalPath(v)}" fill="${pal.leaf2}"/>`;
  }
  return s;
}
