import { bloomBody, leafMarkup, popper, BLOOM_R, G, type Params, type RenderOpts } from './bloom';
import { fmt } from './geometry';
import type { Palette } from './palettes';
import { mulberry32, mutateGenes } from './rng';
import { budMarkup, berriesMarkup, sprigMarkup, kudrina, tendril, feather, featherFan } from './ornaments';

/**
 * A bush is laid out in three steps:
 *   1. Scatter sites inside a frame shape and relax them with weighted Lloyd
 *      iterations (centroidal power-Voronoi), so cells are even but irregular,
 *      and some are big (hero blooms) while others are small (fillers).
 *   2. Grow a stem tree from the root: each site hooks onto the stem of a
 *      nearby site below it, or straight onto the root.
 *   3. Fill cells with the current flower and a few mutated siblings, plus
 *      buds, berries, sprigs and swirls in the small cells.
 * Steps 1–2 are cached; step 3 runs every frame so sliders stay live.
 * In mirror mode only the right half (plus sites on the axis) is computed and
 * the half is drawn twice.
 */

export const BDNA_LEN = 8;
export type Frame = 'bush' | 'panel' | 'bookmark';
export interface BushParams {
  density: number;  // few big ↔ many small
  flourish: number; // tidy ↔ swirly
  mirror: boolean;
  frame: Frame;
}
export interface Box { x: number; y: number; w: number; h: number }

type Pt = { x: number; y: number };
type Kind = 'bloom' | 'bud' | 'berries' | 'sprig' | 'swirl';

/** A site in the cached layout. Parents always come before their children. */
export interface Site extends Pt {
  r: number;
  rel: number; // radius relative to the median: decides bloom vs filler
  axis: boolean;
  species: number;
  rnd: number[]; // stable per-site randoms for small decisions
}
interface Node extends Site {
  parent: number; // index into nodes, -1 = root
  attachT: number; // where along the parent's stem this one branches off
  depth: number;
  weight: number; // number of nodes fed by this stem, for thickness
}

export const SPECIES = 4;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
const pick = (v: number, n: number) => Math.min(n - 1, Math.floor(v * n));

export function seedOf(genes: number[]): number {
  let s = 0x811c9dc5;
  for (const v of genes.slice(0, 4)) s = Math.imul(s ^ Math.round(v * 255), 0x01000193) >>> 0;
  return s;
}

// ---- frames ---------------------------------------------------------------------

interface Shape {
  inside: (x: number, y: number) => boolean;
  top: number;
  bottom: number;
  rx: number;
  root: Pt;
  view: Box;
  clip: boolean;
}

function frameShape(b: number[], frame: Frame): Shape {
  if (frame === 'bush') {
    const ry = lerp(380, 460, b[5]);
    const rx = lerp(320, 440, b[4]);
    const cy = 400 - ry; // bottom edge sits at y=400, above the root
    const n = lerp(2, 3.4, b[6]); // ellipse → squircle
    const taper = lerp(0.25, 0.8, b[7]); // how much the bottom pinches in, like a bouquet
    const inside = (x: number, y: number) => {
      const v = (y - cy) / ry;
      if (v <= -1 || v >= 1) return false;
      const w = rx * (1 - taper * smooth(v));
      return Math.abs(x / w) ** n + Math.abs(v) ** n < 1;
    };
    return { inside, top: cy - ry, bottom: cy + ry, rx, root: { x: 0, y: 500 }, view: { x: -540, y: -600, w: 1080, h: 1150 }, clip: false };
  }
  // Panels fill a rectangle edge to edge; whatever spills over gets cropped.
  const view = frame === 'panel' ? { x: -450, y: -600, w: 900, h: 1200 } : { x: -270, y: -800, w: 540, h: 1600 };
  const m = frame === 'panel' ? 45 : 30;
  const rx = view.w / 2 - m;
  const top = view.y + m;
  const bottom = view.y + view.h - m * 2.5;
  return {
    inside: (x, y) => Math.abs(x) < rx && y > top && y < bottom,
    top, bottom, rx,
    root: { x: 0, y: view.y + view.h },
    view,
    clip: true,
  };
}

export const bushView = (bp: BushParams): Box => frameShape([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], bp.frame).view;

// ---- 1. relaxation ------------------------------------------------------------------

function relax(bdna: number[], bp: BushParams, shape: Shape) {
  const rng = mulberry32(seedOf(bdna));
  const mirror = bp.mirror;

  // Grid samples standing in for the continuous area (right half only when mirrored).
  const STEP = 12;
  const samples: number[] = [];
  for (let y = shape.top; y < shape.bottom; y += STEP) {
    for (let x = mirror ? STEP / 2 : -shape.rx; x < shape.rx; x += STEP) {
      if (shape.inside(x, y)) samples.push(x, y);
    }
  }
  const area = (samples.length / 2) * STEP * STEP * (mirror ? 2 : 1);
  const N = Math.round(lerp(8, 48, bp.density) * clamp(area / 480000, 0.7, 1.8));
  const spacing = Math.sqrt(area / N);

  const nAxis = mirror ? clamp(Math.round(N * 0.1 + rng() * 1.5), 1, 5) : 0;
  const nFree = mirror ? Math.round((N - nAxis) / 2) : N;
  const X: number[] = [], Y: number[] = [], W: number[] = [], axis: boolean[] = [];
  for (let i = 0; i < nAxis + nFree; i++) {
    const onAxis = i < nAxis;
    let x = 0, y = 0;
    for (let tries = 0; tries < 400; tries++) {
      x = onAxis ? 0 : mirror ? rng() * shape.rx : (rng() * 2 - 1) * shape.rx;
      y = lerp(shape.top, shape.bottom, rng());
      if (shape.inside(x, y)) break;
    }
    const u = i === 0 ? 1 : rng(); // the first site is always a hero-sized cell
    X.push(x); Y.push(y); axis.push(onAxis);
    W.push((spacing * 0.95 * u ** 1.5) ** 2); // power-diagram weight: bigger weight → bigger cell
  }

  const n = X.length;
  let cnt = new Float64Array(n);
  for (let iter = 0; iter < 8; iter++) {
    const sx = new Float64Array(n), sy = new Float64Array(n);
    cnt = new Float64Array(n);
    for (let s = 0; s < samples.length; s += 2) {
      const px = samples[s], py = samples[s + 1];
      let best = Infinity, owner = -1;
      for (let j = 0; j < n; j++) {
        const dy2 = (py - Y[j]) ** 2;
        const d = (px - X[j]) ** 2 + dy2 - W[j];
        if (d < best) { best = d; owner = j; }
        if (mirror && !axis[j]) {
          const dm = (px + X[j]) ** 2 + dy2 - W[j]; // the site's mirror image
          if (dm < best) { best = dm; owner = -1; }
        }
      }
      if (owner >= 0) { sx[owner] += px; sy[owner] += py; cnt[owner]++; }
    }
    for (let j = 0; j < n; j++) {
      if (!cnt[j]) continue;
      X[j] = axis[j] ? 0 : sx[j] / cnt[j];
      Y[j] = sy[j] / cnt[j];
    }
  }

  // Radius from cell area, then shrink pairs that would overlap too much.
  type Disc = Pt & { r: number; axis: boolean; twin: number };
  const discs: Disc[] = [];
  for (let j = 0; j < n; j++) {
    if (!cnt[j]) continue;
    const a = cnt[j] * STEP * STEP * (mirror && axis[j] ? 2 : 1);
    discs.push({ x: X[j], y: Y[j], r: clamp(Math.sqrt(a / Math.PI) * 0.95, 18, 175), axis: axis[j], twin: -1 });
  }
  const all = [...discs];
  if (mirror) {
    discs.forEach((s, i) => {
      if (!s.axis) { s.twin = all.length; all.push({ ...s, x: -s.x, twin: i }); }
    });
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) * 1.1;
        if (all[i].r + all[j].r > d) {
          const k = d / (all[i].r + all[j].r);
          all[i].r *= k;
          all[j].r *= k;
        }
      }
    }
  }
  discs.forEach((s) => (s.r = Math.max(14, s.twin >= 0 ? Math.min(s.r, all[s.twin].r) : s.r)));

  const sorted = discs.map((s) => s.r).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 50;
  const biggest = sorted[sorted.length - 1];
  const sites: Site[] = discs.map((d) => {
    const rnd = Array.from({ length: 10 }, rng);
    return { x: d.x, y: d.y, r: d.r, rel: d.r / median, axis: d.axis, rnd, species: d.r === biggest ? 0 : pick(rnd[0], SPECIES) };
  });
  return sites;
}

// ---- 2. stem tree ------------------------------------------------------------------

interface Stem { a: Pt; c1: Pt; c2: Pt; e: Pt }

/**
 * Stem from a to e: rises first, then sweeps sideways into the flower (the
 * folk-bouquet curve). Flourish bows it the other way first, making an S.
 */
function stemFor(a: Pt, e: Pt, flourish: number): Stem {
  const C = { x: lerp(a.x, e.x, 0.2), y: lerp(a.y, e.y, 0.7) };
  const dx = e.x - a.x;
  return {
    a,
    c1: { x: a.x + ((C.x - a.x) * 2) / 3 - dx * flourish * 0.5, y: a.y + ((C.y - a.y) * 2) / 3 },
    c2: { x: e.x + ((C.x - e.x) * 2) / 3 + dx * flourish * 0.35, y: e.y + ((C.y - e.y) * 2) / 3 },
    e,
  };
}

function stemPoint(s: Stem, t: number): Pt {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return { x: k0 * s.a.x + k1 * s.c1.x + k2 * s.c2.x + k3 * s.e.x, y: k0 * s.a.y + k1 * s.c1.y + k2 * s.c2.y + k3 * s.e.y };
}

/** Degrees clockwise from "up". */
function stemTangent(s: Stem, t: number): number {
  const u = 1 - t;
  const dx = 3 * u * u * (s.c1.x - s.a.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.e.x - s.c2.x);
  const dy = 3 * u * u * (s.c1.y - s.a.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.e.y - s.c2.y);
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Stems for every node, parents first, given the current flourish. */
function growStems(nodes: Node[], root: Pt, flourish: number): Stem[] {
  const stems: Stem[] = [];
  for (const nd of nodes) {
    const a = nd.parent >= 0 ? stemPoint(stems[nd.parent], nd.attachT) : root;
    stems.push(stemFor(a, nd, flourish));
  }
  return stems;
}

function buildLayout(bdna: number[], bp: BushParams) {
  const shape = frameShape(bdna, bp.frame);
  const sites = relax(bdna, bp, shape);
  const root = shape.root;

  // Grow the tree outward from the root (with flourish 0 for stable choices).
  const order = [...sites].sort((p, q) => Math.hypot(p.x - root.x, p.y - root.y) - Math.hypot(q.x - root.x, q.y - root.y));
  const nodes: Node[] = [];
  const stems: Stem[] = [];
  for (const s of order) {
    let parent = -1, attachT = 0, a = root;
    let bestCost = Math.hypot(s.x - root.x, s.y - root.y) * 1.3;
    nodes.forEach((q, j) => {
      if (bp.mirror && s.axis && !q.axis) return; // keep axis stems on the axis
      if (q.y < s.y + 20) return; // only hook onto stems below
      const t = lerp(0.5, 0.75, q.rnd[9]);
      const p = stemPoint(stems[j], t);
      const dx = s.x - p.x, dy = p.y - s.y;
      const ang = Math.atan2(Math.abs(dx), dy);
      if (ang > 1.15) return;
      const cost = Math.hypot(dx, dy) + ang * 70;
      if (cost < bestCost) { bestCost = cost; parent = j; attachT = t; a = p; }
    });
    const nd: Node = { ...s, parent, attachT, depth: parent >= 0 ? nodes[parent].depth + 1 : 0, weight: 1 };
    nodes.push(nd);
    stems.push(stemFor(a, nd, 0));
  }
  for (const nd of nodes) {
    for (let p = nd.parent; p >= 0; p = nodes[p].parent) nodes[p].weight++;
  }
  return { nodes, shape };
}

const layoutCache = new Map<string, ReturnType<typeof buildLayout>>();
function getLayout(bdna: number[], bp: BushParams) {
  const key = `${bdna.join(',')}|${bp.density.toFixed(3)}|${bp.mirror}|${bp.frame}`;
  let l = layoutCache.get(key);
  if (!l) {
    l = buildLayout(bdna, bp);
    if (layoutCache.size > 64) layoutCache.delete(layoutCache.keys().next().value!);
    layoutCache.set(key, l);
  }
  return l;
}

// ---- 3. rendering ----------------------------------------------------------------

export interface BushSpecimen {
  dna: number[];
  cdna: number[];
  bdna: number[];
}

/** The current flower plus mutated siblings, each shifted to other palette colors. */
export function makeSpecies(s: BushSpecimen) {
  const rng = mulberry32(seedOf(s.bdna) ^ 0x9e3779b9);
  return Array.from({ length: SPECIES }, (_, i) => {
    if (i === 0) return { dna: s.dna, cdna: s.cdna };
    const cdna = [...s.cdna];
    cdna[0] = (cdna[0] + i * 0.29) % 1;
    cdna[4] = rng();
    return { dna: mutateGenes(s.dna, rng, 0.22, 0.12), cdna };
  });
}

/** Big cells get blooms; small ones get fillers, with more swirls as flourish rises. */
export function kindOf(site: Site, flourish: number): Kind {
  if (site.rel >= lerp(0.75, 0.95, flourish)) return 'bloom';
  const weights: [Kind, number][] = [['swirl', flourish * 1.8], ['bud', 1], ['berries', 0.8], ['sprig', 0.7 * (1 - flourish * 0.6)]];
  let u = site.rnd[1] * weights.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of weights) if ((u -= w) < 0) return k;
  return 'bud';
}

/** Colors for brush strokes: mostly greens/stem, with the odd bloom-colored accent. */
export function strokeColors(pal: Palette, accent: string): string[] {
  return [pal.leaf, pal.stem, pal.leaf2, accent];
}

/** The ornament or flower that sits in a cell, drawn at the origin pointing up. */
export function itemMarkup(site: Site, kind: Kind, species: ReturnType<typeof makeSpecies>, p: Params, flourish: number, pal: Palette, animateBloom?: boolean): string {
  const m = pal.blooms.length;
  const colorOf = (offset = 0) => pal.blooms[(pick(species[site.species].cdna[0], m) + offset) % m];
  const r = site.r;
  switch (kind) {
    case 'bloom': {
      const sp = species[site.species];
      return `<g transform="scale(${fmt(r / (BLOOM_R * 1.05))})">${bloomBody(sp.dna, sp.cdna, p, pal, animateBloom)}</g>`;
    }
    case 'bud':
      return budMarkup(r, colorOf(), colorOf(2), pal);
    case 'berries':
      return berriesMarkup(r, site.rnd[2], colorOf(1), pal);
    case 'sprig':
      return sprigMarkup(r, site.rnd[2], p, pal);
    case 'swirl': {
      const side = site.x === 0 ? (site.rnd[3] < 0.5 ? -1 : 1) : -Math.sign(site.x);
      const cols = strokeColors(pal, colorOf(1));
      return kudrina(r * lerp(0.9, 1.15, flourish), side, site.rnd[2], pal.stem, [cols[0], cols[3], cols[2]]);
    }
  }
}

/**
 * In folk art each kind of flower always comes at one size. Split the blooms
 * into size classes (biggest first); each class becomes one species, drawn at
 * the smallest radius in its class so nothing grows into its neighbours.
 * Equal radii always share a class, so mirrored twins stay identical.
 */
function sizeClasses(blooms: Site[]): Map<Site, { species: number; r: number }> {
  const out = new Map<Site, { species: number; r: number }>();
  const n = blooms.length;
  if (!n) return out;
  const sorted = blooms.map((b) => b.r).sort((a, b) => b - a);
  const classes = Math.min(SPECIES, n);
  const cuts = Array.from({ length: classes - 1 }, (_, k) => sorted[Math.floor(((k + 1) * n) / classes)]);
  const classOf = (r: number) => cuts.filter((c) => r <= c).length;
  const minR = new Array(classes).fill(Infinity);
  for (const b of blooms) minR[classOf(b.r)] = Math.min(minR[classOf(b.r)], b.r);
  for (const b of blooms) out.set(b, { species: classOf(b.r), r: minR[classOf(b.r)] });
  return out;
}

let clipId = 0;

export function renderBush(s: BushSpecimen, p: Params, bp: BushParams, pal: Palette, opts: RenderOpts = {}): string {
  const { nodes, shape } = getLayout(s.bdna, bp);
  const f = bp.flourish;
  const stems = growStems(nodes, shape.root, f);
  const species = makeSpecies(s);
  const pop = popper(opts.animate);
  const hero = (i: number) => s.dna[i] ?? 0.5;
  const m = pal.blooms.length;
  const accent = (sp: number) => pal.blooms[(pick(species[sp].cdna[0], m) + 1) % m];
  const maxW = Math.max(...nodes.map((n) => n.weight));
  const stagger = (ms: number) => (opts.animate ? ` style="--stagger:${Math.round(ms)}ms"` : '');
  const vein = hero(G.leafInset) > 0.5;

  // Each element goes into the "side" bucket (drawn twice when mirrored) or the "axis" bucket.
  const mk = () => ({ side: [] as string[], axis: [] as string[] });
  const layers = { stems: mk(), leaves: mk(), items: mk() };
  const bucket = (nd: Node) => (bp.mirror && nd.axis ? 'axis' : 'side');

  // root leaves
  const rootLen = 150;
  for (const side of [-1, 1]) {
    const inner = leafMarkup(rootLen, rootLen * 0.3, side * 0.12, vein, pal);
    layers.leaves.axis.push(`<g transform="translate(${shape.root.x} ${shape.root.y}) rotate(${side * 58})"${stagger(0)}>${pop(120, inner)}</g>`);
  }

  const kinds = nodes.map((nd) => kindOf(nd, f));
  const classes = sizeClasses(nodes.filter((_, i) => kinds[i] === 'bloom'));

  const itemOrder: { nd: Node; markup: string }[] = [];
  nodes.forEach((nd, i) => {
    const b = bucket(nd);
    const st = stems[i];
    const len = Math.hypot(nd.x - st.a.x, nd.y - st.a.y);
    const width = lerp(3, 12, Math.sqrt(nd.weight / maxW));
    const t0 = nd.depth * 170;
    const pairUp = bp.mirror && nd.axis; // axis stems sprout symmetric pairs

    layers.stems[b].push(
      `<path${opts.animate ? ' class="k-stem" pathLength="1"' : ''}${stagger(t0)} d="M${fmt(st.a.x)} ${fmt(st.a.y)} C${fmt(st.c1.x)} ${fmt(st.c1.y)} ${fmt(st.c2.x)} ${fmt(st.c2.y)} ${fmt(nd.x)} ${fmt(nd.y)}" ` +
        `stroke="${pal.stem}" stroke-width="${fmt(width)}" stroke-linecap="round" fill="none"/>`,
    );

    // leaves (or brush strokes) along the stem
    if (len > 70) {
      const ts = len > 220 ? [0.38, 0.68] : [0.5];
      ts.forEach((t, k) => {
        const pt = stemPoint(st, t);
        const tan = stemTangent(st, t);
        const sides = pairUp ? [-1, 1] : [(k + Math.round(nd.rnd[4] * 10)) % 2 ? 1 : -1];
        const leafLen = clamp(len * 0.22, 26, 85) * lerp(0.8, 1.15, nd.rnd[5]);
        const brushy = nd.rnd[6 + k] < f;
        for (const side of sides) {
          let inner: string;
          if (brushy) {
            const cols = strokeColors(pal, accent(nd.species));
            inner = nd.rnd[8] < 0.5
              ? featherFan(leafLen * 1.25, leafLen * 0.3, side, [cols[0], cols[2], cols[0]])
              : feather(leafLen * 1.4, leafLen * 0.34, side * 1.1, cols[Math.floor(nd.rnd[3] * 3)]);
          } else {
            inner = leafMarkup(leafLen, leafLen * lerp(0.2, 0.3, hero(G.leafWidth)), side * (0.08 + p.curl * 0.35), vein, pal);
          }
          layers.leaves[b].push(
            `<g transform="translate(${fmt(pt.x)} ${fmt(pt.y)}) rotate(${fmt(tan + side * lerp(40, 62, nd.rnd[5]))})"${stagger(t0)}>${pop(250 * t + 150, inner)}</g>`,
          );
        }
      });
    }

    // tendrils curling off longer stems
    if (len > 90 && nd.rnd[2] < f * 0.9) {
      const t = lerp(0.3, 0.6, nd.rnd[3]);
      const pt = stemPoint(st, t);
      const tan = stemTangent(st, t);
      const tl = clamp(len * 0.38, 45, 140);
      const sides = pairUp ? [-1, 1] : [nd.rnd[4] < 0.5 ? -1 : 1];
      for (const side of sides) {
        layers.leaves[b].push(
          `<g transform="translate(${fmt(pt.x)} ${fmt(pt.y)}) rotate(${fmt(tan + side * lerp(35, 65, nd.rnd[5]))})"${stagger(t0)}>${pop(300, tendril(tl, Math.max(3, width * 0.7), -side, pal.stem))}</g>`,
        );
      }
    }

    // the thing at the tip
    const kind = kinds[i];
    const rot = clamp(stemTangent(st, 1) * 0.8, -75, 75);
    const inner = itemMarkup({ ...nd, ...classes.get(nd) }, kind, species, p, f, pal, opts.animate);
    const markup = `<g transform="translate(${fmt(nd.x)} ${fmt(nd.y)}) rotate(${fmt(rot)})"${stagger(t0 + 300)}>${kind === 'bloom' ? inner : pop(0, inner)}</g>`;
    itemOrder.push({ nd, markup });
  });

  // Small things first so the big blooms sit on top.
  itemOrder.sort((a, b) => a.nd.r - b.nd.r);
  for (const { nd, markup } of itemOrder) layers.items[bucket(nd)].push(markup);

  const emit = ({ side, axis }: { side: string[]; axis: string[] }) =>
    bp.mirror ? `<g>${side.join('')}</g><g transform="scale(-1 1)">${side.join('')}</g>${axis.join('')}` : side.join('') + axis.join('');

  const { x, y, w, h } = shape.view;
  let body = emit(layers.stems) + emit(layers.leaves) + emit(layers.items);
  let defs = '';
  if (shape.clip) {
    const id = `kclip${clipId++}`;
    defs = `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>`;
    body = `<g clip-path="url(#${id})">${body}</g>`;
  }
  const bg = opts.background || shape.clip ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${pal.bg}"/>` : '';
  const cls = [opts.animate && 'anim', shape.clip && 'framed'].filter(Boolean).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${cls ? ` class="${cls}"` : ''}>${defs}${bg}${body}</svg>`;
}
