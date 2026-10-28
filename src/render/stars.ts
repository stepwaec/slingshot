import type { Bounds } from "../sim/physics";

export interface Star {
  x: number;
  y: number;
  radius: number;
  /** 0, 1, or 2 — brightness bucket, so the frame can fill each bucket once. */
  bucket: 0 | 1 | 2;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStarfield(bounds: Bounds, count: number, seed = 0x51e5): Star[] {
  const rand = mulberry32(seed);
  const stars: Star[] = [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  for (let i = 0; i < count; i++) {
    const roll = rand();
    const bucket: 0 | 1 | 2 = roll > 0.92 ? 2 : roll > 0.6 ? 1 : 0;
    stars.push({
      x: bounds.minX + rand() * width,
      y: bounds.minY + rand() * height,
      radius: bucket === 2 ? 1.6 : bucket === 1 ? 1.05 : 0.7,
      bucket,
    });
  }
  return stars;
}
