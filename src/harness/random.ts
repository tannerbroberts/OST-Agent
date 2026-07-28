/**
 * A seeded PRNG, hand-written because the plan forbids a new dependency and the
 * house definition of determinism is byte-level: "no dates, no randomness,
 * stable ordering" (`scripts/gen-skill.ts`). A generated environment must be a
 * pure function of its seed, or a fitness record cannot be reproduced and the
 * replication requirement the design rests on is unenforceable.
 *
 * mulberry32: 32 bits of state, well-distributed for planting fixtures, short
 * enough to read. It is NOT cryptographic and does not need to be — nothing
 * here is secret, and the requirement is reproducibility, not unpredictability.
 *
 * State is threaded through the returned object rather than held at module
 * level. A module-level generator would make two environments built in one
 * process depend on the order they were built in, which is the precise shape of
 * hidden coupling that makes a run irreproducible from its recorded seed.
 */

/** A seeded source of randomness. Every method advances the same private state. */
export interface Rng {
  /** The next value in [0, 1). */
  next(): number;
  /** An integer in [0, maxExclusive). Returns 0 when `maxExclusive <= 0`. */
  int(maxExclusive: number): number;
  /** A uniformly chosen member. Throws on an empty array rather than yielding undefined. */
  pick<T>(items: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  // `>>> 0` keeps the state an unsigned 32-bit integer at every step; without
  // it the shifts below would drift into signed territory and the sequence
  // would stop matching across engines.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("cannot pick from an empty array");
    return items[int(items.length)] as T;
  };

  return { next, int, pick };
}
