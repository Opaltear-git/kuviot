import { popper, leafMarkup, type Params, type RenderOpts } from './bloom';
import { fmt } from './geometry';
import type { Palette } from './palettes';
import { mulberry32 } from './rng';
import { foliage, type Foliage } from './ornaments';
import { makeSpecies, itemMarkup, seedOf, type BushParams, type BushSpecimen, type Site } from './bush';

/**
 * Seamless wallpaper, laid out on a torus (distances wrap around the tile
 * edges) so it repeats perfectly.
 *
 *   1. Blooms: each species has one fixed size, as in folk art; big ones are
 *      rarer. Weighted Lloyd relaxation spreads them out, then a repulsion
 *      pass guarantees no two blooms overlap.
 *   2. Foliage: the remaining relaxed sites mark the gaps. Each gap grows a
 *      spray out from behind its nearest bloom. An occupancy grid tracks
 *      what's taken; every spray tries a few directions and keeps the longest
 *      one that touches nothing but its own bloom.
 */

export const TILE = 1000;
const BLOOM_SHARE = 0.3;
const COVERAGE = 0.34; // fraction of the tile covered by blooms
const SPECIES_ODDS = [0.14, 0.22, 0.3, 0.34]; // biggest species is rarest
const SPRAY_WIDTH = 0.28; // half-width of a spray's footprint, relative to its length
const RAD = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const pick = (v: number, n: number) => Math.min(n - 1, Math.floor(v * n));
/** Shortest signed distance around the torus. */
const wrap = (d: number) => d - TILE * Math.round(d / TILE);
const mod = (v: number) => ((v % TILE) + TILE) % TILE;

function weighted(u: number, odds: number[]): number {
  let v = u * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < odds.length; i++) if ((v -= odds[i]) < 0) return i;
  return odds.length - 1;
}

interface Bloom extends Site {
  rot: number; // degrees; blooms stay roughly upright like printed fabric
  collar: { angle: number; len: number }[]; // leaves peeking out from behind
}
interface Spray {
  x: number; // base, hidden under the parent bloom
  y: number;
  angle: number; // degrees clockwise from up
  len: number;
  parent: number;
  side: number;
  rnd: number[];
}
interface TileLayout {
  blooms: Bloom[];
  sprays: Spray[];
}

// ---- occupancy grid on the torus ----------------------------------------------------

const CELL = 8;
const GN = TILE / CELL;
const gmod = (g: number) => ((g % GN) + GN) % GN;

class Occupancy {
  owner = new Int32Array(GN * GN).fill(-1);

  /** Visit grid cells whose centers fall inside a disc; stop early when visit returns true. */
  private disc(x: number, y: number, r: number, visit: (i: number) => boolean): boolean {
    r = Math.max(r, CELL * 0.75);
    for (let gy = Math.floor((y - r) / CELL); gy <= Math.floor((y + r) / CELL); gy++) {
      const cy = (gy + 0.5) * CELL;
      for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
        const cx = (gx + 0.5) * CELL;
        if ((cx - x) ** 2 + (cy - y) ** 2 > r * r) continue;
        if (visit(gmod(gy) * GN + gmod(gx))) return true;
      }
    }
    return false;
  }

  /** March along a ray from (x,y), with a disc of radius hw(s) at each distance s. */
  private along(x: number, y: number, angle: number, s0: number, s1: number, hw: (s: number) => number, visit: (i: number) => boolean): boolean {
    const ux = Math.sin(angle * RAD), uy = -Math.cos(angle * RAD);
    for (let s = s0; ; s += Math.max(4, hw(s) * 0.6)) {
      const t = Math.min(s, s1);
      if (this.disc(x + ux * t, y + uy * t, hw(t), visit)) return true;
      if (t >= s1) return false;
    }
  }

  markDisc(x: number, y: number, r: number, id: number) {
    this.disc(x, y, r, (i) => ((this.owner[i] = id), false));
  }
  markRay(x: number, y: number, angle: number, s0: number, s1: number, hw: (s: number) => number, id: number) {
    this.along(x, y, angle, s0, s1, hw, (i) => ((this.owner[i] = id), false));
  }
  /** True when the footprint touches nothing except cells owned by `ignore`. */
  rayFree(x: number, y: number, angle: number, s0: number, s1: number, hw: (s: number) => number, ignore: number): boolean {
    return !this.along(x, y, angle, s0, s1, hw, (i) => this.owner[i] >= 0 && this.owner[i] !== ignore);
  }
}

// ---- layout --------------------------------------------------------------------------

function tileLayout(bdna: number[], density: number): TileLayout {
  const rng = mulberry32(seedOf(bdna) ^ 0x5bd1e995);
  const N = Math.round(lerp(16, 90, density));
  const nBloom = Math.max(2, Math.round(N * BLOOM_SHARE));
  const STEP = 14;
  const spacing = TILE / Math.sqrt(N);

  // One fixed size per species, scaled so blooms cover COVERAGE of the tile.
  const sizes = [1, lerp(0.62, 0.8, bdna[1]), lerp(0.44, 0.6, bdna[2]), lerp(0.3, 0.42, bdna[3])];
  const spec = Array.from({ length: nBloom }, (_, i) => (i === 0 ? 0 : weighted(rng(), SPECIES_ODDS)));
  const sumSq = spec.reduce((s, k) => s + sizes[k] ** 2, 0);
  const base = Math.min(220, Math.sqrt((COVERAGE * TILE * TILE) / (Math.PI * sumSq)));
  const radius = spec.map((k) => base * sizes[k]);

  const X: number[] = [], Y: number[] = [], W: number[] = [];
  for (let i = 0; i < N; i++) {
    X.push(rng() * TILE);
    Y.push(rng() * TILE);
    W.push(i < nBloom ? (radius[i] * 1.6) ** 2 : (spacing * lerp(0.3, 0.55, rng())) ** 2);
  }

  let cnt = new Float64Array(N);
  for (let iter = 0; iter < 8; iter++) {
    const sx = new Float64Array(N), sy = new Float64Array(N);
    cnt = new Float64Array(N);
    for (let py = STEP / 2; py < TILE; py += STEP) {
      for (let px = STEP / 2; px < TILE; px += STEP) {
        let best = Infinity, owner = 0;
        for (let j = 0; j < N; j++) {
          const d = wrap(px - X[j]) ** 2 + wrap(py - Y[j]) ** 2 - W[j];
          if (d < best) { best = d; owner = j; }
        }
        // accumulate offsets from the site so cells straddling an edge average correctly
        sx[owner] += wrap(px - X[owner]);
        sy[owner] += wrap(py - Y[owner]);
        cnt[owner]++;
      }
    }
    for (let j = 0; j < N; j++) {
      if (!cnt[j]) continue;
      X[j] = mod(X[j] + sx[j] / cnt[j]);
      Y[j] = mod(Y[j] + sy[j] / cnt[j]);
    }
  }

  // Push overlapping blooms apart (sizes are fixed, so we move them instead).
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < nBloom; i++) {
      for (let j = i + 1; j < nBloom; j++) {
        const dx = wrap(X[j] - X[i]), dy = wrap(Y[j] - Y[i]);
        const d = Math.hypot(dx, dy) || 1;
        const min = (radius[i] + radius[j]) * 1.04 + 10;
        if (d >= min) continue;
        const push = (min - d) / 2;
        X[i] = mod(X[i] - (dx / d) * push); Y[i] = mod(Y[i] - (dy / d) * push);
        X[j] = mod(X[j] + (dx / d) * push); Y[j] = mod(Y[j] + (dy / d) * push);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const occ = new Occupancy();
  const blooms: Bloom[] = [];
  for (let i = 0; i < nBloom; i++) {
    const rnd = Array.from({ length: 10 }, rng);
    blooms.push({ x: X[i], y: Y[i], r: radius[i], rel: sizes[spec[i]], axis: false, species: spec[i], rnd, rot: (rnd[7] - 0.5) * 40, collar: [] });
    occ.markDisc(X[i], Y[i], radius[i] * 1.04, i);
  }

  // Collar leaves, shortened (or dropped) where they'd touch a neighbour.
  for (const [i, b] of blooms.entries()) {
    for (const sd of [-1, 1]) {
      const angle = b.rot + 180 + sd * lerp(40, 65, b.rnd[6]);
      for (let len = b.r * lerp(1.15, 1.4, b.rnd[5]); len > b.r * 1.08; len -= b.r * 0.06) {
        const hw = () => len * 0.2;
        if (occ.rayFree(b.x, b.y, angle, b.r, len, hw, i)) {
          occ.markRay(b.x, b.y, angle, b.r * 0.5, len, hw, i);
          b.collar.push({ angle, len });
          break;
        }
      }
    }
  }

  // Spray requests: each gap grows from the bloom whose edge is closest,
  // and roomy gaps fork into a second, shorter spray.
  interface Request { parent: number; prefer: number; want: number; side: number; rnd: number[] }
  const requests: Request[] = [];
  for (let j = nBloom; j < N; j++) {
    if (!cnt[j]) continue;
    const rnd = Array.from({ length: 10 }, rng);
    let parent = 0, best = Infinity, vx = 0, vy = 0;
    for (let i = 0; i < nBloom; i++) {
      const dx = wrap(X[j] - X[i]), dy = wrap(Y[j] - Y[i]);
      const d = Math.hypot(dx, dy) - radius[i];
      if (d < best) { best = d; parent = i; vx = dx; vy = dy; }
    }
    const dist = Math.hypot(vx, vy) || 1;
    const R = radius[parent];
    const r = Math.sqrt((cnt[j] * STEP * STEP) / Math.PI);
    const want = clamp(dist - R * 0.55 + r * 1.1, 60, Math.min(400, R * 2.4 + 60));
    const toward = (Math.atan2(vx, -vy) * 180) / Math.PI;
    const side = rnd[2] < 0.5 ? -1 : 1;
    const fork = r > 40 && rnd[9] < 0.7;
    const spread = lerp(22, 38, rnd[6]);
    requests.push({ parent, prefer: toward + (fork ? side * spread * 0.4 : 0), want, side, rnd });
    // the second spray takes the other green, so neighbouring sprays stay distinct
    if (fork) requests.push({ parent, prefer: toward - side * spread, want: want * lerp(0.6, 0.8, rnd[5]), side: -side, rnd: [1 - rnd[0], (rnd[1] + 0.37) % 1, ...rnd.slice(2)] });
  }
  requests.sort((a, b) => b.want - a.want); // big sprays claim their space first

  // Fill pass: afterwards every bloom tries to grow into whatever gaps remain around it.
  const fillers: Request[] = [];
  blooms.forEach((b, i) => {
    const n = 10;
    for (let k = 0; k < n; k++) {
      const rnd = Array.from({ length: 10 }, rng);
      fillers.push({ parent: i, prefer: b.rot + (k / n) * 360 + rnd[3] * 20, want: b.r * lerp(1.3, 1.9, rnd[4]) + 30, side: rnd[2] < 0.5 ? -1 : 1, rnd });
    }
  });
  for (let k = fillers.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [fillers[k], fillers[j]] = [fillers[j], fillers[k]];
  }
  requests.push(...fillers);

  const sprays: Spray[] = [];
  for (const q of requests) {
    const b = blooms[q.parent];
    const tuck = b.r * 0.55; // start hidden under the petals
    const s0 = b.r - tuck + 2; // the parent's rim, measured from the base
    const minLen = s0 + 45;
    let found: Spray | null = null;
    let bestScore = -Infinity;
    for (const delta of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
      const angle = q.prefer + delta;
      const x = b.x + Math.sin(angle * RAD) * tuck, y = b.y - Math.cos(angle * RAD) * tuck;
      for (let len = q.want; len >= minLen; len -= Math.max(10, q.want * 0.1)) {
        const hw = (s: number) => SPRAY_WIDTH * len * Math.min(1, 0.3 + (s - s0) / (0.35 * len));
        if (!occ.rayFree(x, y, angle, s0, len, hw, q.parent)) continue;
        const score = len - Math.abs(delta) * 0.8;
        if (score > bestScore) {
          bestScore = score;
          found = { x: mod(x), y: mod(y), angle, len, parent: q.parent, side: q.side, rnd: q.rnd };
        }
        break;
      }
      if (found && found.len >= q.want && delta === 0) break;
    }
    if (!found) continue; // no room: leave the gap
    const f = found;
    occ.markRay(f.x, f.y, f.angle, s0, f.len, (s) => SPRAY_WIDTH * f.len * Math.min(1, 0.3 + (s - s0) / (0.35 * f.len)), 1000 + sprays.length);
    sprays.push(f);
  }
  return { blooms, sprays };
}

const cache = new Map<string, TileLayout>();
function getTileLayout(bdna: number[], density: number): TileLayout {
  const key = `${bdna.join(',')}|${density.toFixed(3)}`;
  let l = cache.get(key);
  if (!l) {
    l = tileLayout(bdna, density);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    cache.set(key, l);
  }
  return l;
}

/** Flourish shifts the foliage mix from leafy toward curly and brushy. */
function foliageKind(u: number, f: number): Foliage {
  const weights: [Foliage, number][] = [
    ['leafy', 1.3 - 0.7 * f],
    ['bigleaf', 0.9 - 0.6 * f],
    ['budstem', 0.8],
    ['curl', 0.25 + 1.6 * f],
    ['fan', 1.4 * f],
  ];
  let v = u * weights.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of weights) if ((v -= w) < 0) return k;
  return 'leafy';
}

// ---- rendering ---------------------------------------------------------------------

function tileContent(s: BushSpecimen, p: Params, bp: BushParams, pal: Palette, animate?: boolean): string {
  const { blooms, sprays } = getTileLayout(s.bdna, bp.density);
  const species = makeSpecies(s);
  const pop = popper(animate);
  const m = pal.blooms.length;
  const accentOf = (sp: number) => pal.blooms[(pick(species[sp].cdna[0], m) + 1) % m];
  const delay = (b: Bloom) => Math.round(b.rnd[8] * 700);
  const style = (ms: number) => (animate ? ` style="--stagger:${ms}ms"` : '');

  // Draw at every wrapped position that touches the tile.
  const tiled = (x: number, y: number, reach: number, rot: number, ms: number, inner: string, out: string[]) => {
    for (const dy of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        const px = x + dx * TILE, py = y + dy * TILE;
        if (px + reach < 0 || px - reach > TILE || py + reach < 0 || py - reach > TILE) continue;
        out.push(`<g transform="translate(${fmt(px)} ${fmt(py)}) rotate(${fmt(rot)})"${style(ms)}>${inner}</g>`);
      }
    }
  };

  const greens: string[] = [];
  const flowers: { r: number; svg: string[] }[] = [];
  for (const b of blooms) {
    const leafPal = b.rnd[4] < 0.5 ? pal : { ...pal, leaf: pal.leaf2, leaf2: pal.leaf };
    const collar = b.collar
      .map(({ angle, len }) => `<g transform="rotate(${fmt(angle)})">${leafMarkup(len, len * 0.3, Math.sign(angle - b.rot - 180) * 0.15, true, leafPal)}</g>`)
      .join('');
    if (collar) tiled(b.x, b.y, b.r * 1.5, 0, delay(b), pop(0, collar), greens);

    // Fan blooms open upward from their center, so nudge them down to sit
    // centered on their spot.
    const lift = b.r * 0.35 * (1 - p.open);
    const inner = `<g transform="translate(0 ${fmt(lift)})">${itemMarkup(b, 'bloom', species, p, bp.flourish, pal)}</g>`;
    const svg: string[] = [];
    tiled(b.x, b.y, b.r * 1.2, b.rot, delay(b), pop(0, inner), svg);
    flowers.push({ r: b.r, svg });
  }
  for (const sp of sprays) {
    const parent = blooms[sp.parent];
    const inner = foliage(foliageKind(sp.rnd[1], bp.flourish), sp.len, sp.rnd, sp.side, p, pal, accentOf(parent.species));
    tiled(sp.x, sp.y, sp.len + 40, sp.angle, delay(parent) + 220, pop(0, inner), greens);
  }
  // Foliage underneath; blooms small to large so the biggest sit on top.
  flowers.sort((a, b) => a.r - b.r);
  return greens.join('') + flowers.map((f) => f.svg.join('')).join('');
}

let tileId = 0;

/**
 * Exports and thumbnails get one seamless tile; the stage shows a 2×2 repeat
 * that fills the whole card.
 */
export function renderTile(s: BushSpecimen, p: Params, bp: BushParams, pal: Palette, opts: RenderOpts = {}): string {
  const anim = opts.animate ? ' class="anim"' : '';
  if (opts.background || opts.thumb) {
    const content = tileContent(s, p, bp, pal, false);
    const slice = opts.thumb ? ' preserveAspectRatio="xMidYMid slice"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}"${slice}><rect width="${TILE}" height="${TILE}" fill="${pal.bg}"/>${content}</svg>`;
  }
  const id = `ktile${tileId++}`;
  const V = TILE * 1.5;
  const uses = [0, 1].flatMap((j) => [0, 1].map((i) => `<use href="#${id}" x="${i * TILE}" y="${j * TILE}"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}" preserveAspectRatio="xMidYMid slice"${anim}>` +
    `<defs><g id="${id}">${tileContent(s, p, bp, pal, opts.animate)}</g></defs><rect width="${V}" height="${V}" fill="${pal.bg}"/>${uses}</svg>`;
}
