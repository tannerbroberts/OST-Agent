/**
 * The built-in environment set.
 *
 * NULL ENVIRONMENTS ARE MANDATORY, and they are not empty vaults. A null
 * environment plants unknowns whose answers are discoverable in no channel; the
 * fit response is to spend little and say so. Without them fitness selects for
 * hyperactive exploration — variants that always sail, because in a world where
 * sailing always pays, sailing always pays. An EMPTY vault would not do the job:
 * it has no Unknown layer at all, so the rollup is empty, every variant scores
 * identically, and the guard passes while proving nothing.
 */
import { makeSpec } from "./generate.js";
import type { EnvironmentSpec } from "./spec.js";

/** Environments where nothing is findable. Seeds are fixed, so the set is reproducible. */
export function nullEnvironments(count = 3): EnvironmentSpec[] {
  return Array.from({ length: count }, (_, i) =>
    makeSpec(1000 + i, { unknowns: 4, findableRatio: 0, name: `null-${i}` }),
  );
}

/** The workhorse set: cheap, so n is large. */
export function generatedEnvironments(count = 8): EnvironmentSpec[] {
  return Array.from({ length: count }, (_, i) =>
    makeSpec(i, { unknowns: 4, findableRatio: 0.5, name: `generated-${i}` }),
  );
}

export const BUILT_IN_ENVIRONMENTS: readonly EnvironmentSpec[] = Object.freeze([
  ...generatedEnvironments(),
  ...nullEnvironments(),
]);
