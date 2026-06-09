// Seeded RNG — mulberry32. State is a single uint32, serialized as a number.
// All engine randomness flows through this module (spec §1.1 architecture rule).

export interface Rng {
  next(): number /* [0,1) */;
  getState(): number;
  setState(s: number): void;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  // mulberry32 state 0 is a degenerate seed; remap it to the golden-ratio constant.
  if (state === 0) state = 0x9e3779b9;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState(): number {
      return state;
    },
    setState(s: number): void {
      state = s >>> 0;
    },
  };
}

/** FNV-1a 32-bit hash, e.g. for the daily 'YYYYMMDD' seed. */
export function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
