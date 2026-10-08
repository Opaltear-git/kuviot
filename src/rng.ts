export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Genes are stored at byte precision so any specimen fits in a shareable URL.
export const quantize = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255;

export function randomGenes(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => quantize(rng()));
}

function gaussian(rng: Rng): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Nudge every gene by gaussian noise; occasionally re-roll one outright. */
export function mutateGenes(genes: number[], rng: Rng, amount: number, jumpChance = 0): number[] {
  return genes.map((v) => {
    if (rng() < jumpChance) return quantize(rng());
    let n = Math.abs(v + gaussian(rng) * amount);
    if (n > 1) n = 2 - n; // reflect instead of wrap, so small nudges stay small
    return quantize(n);
  });
}
