/**
 * The genome variant write path — the only place a `Genome` becomes bytes.
 *
 * Phase 2 gave the kernel a genome to read. A harness needs one to write, and
 * writing is the direction where the mistakes are expensive: a genome that
 * loads but means something other than intended produces a fitness record that
 * is a lie, and a genome that fails to load produces it at `buildPassContext`,
 * mid-run, after the environment has already been generated.
 *
 * So this module validates before it writes. `GenomeSchema` carries two
 * cross-field `.refine`s that reject values TypeScript accepts — a `fallback`
 * or a rule `class` outside `classifier.classes`, and a classifier rule
 * predicated on neither `present` nor `absent`. A mutator will hit both. Better
 * a thrown error at the write than a thrown error inside the measurement.
 *
 * Serialization uses `yaml.stringify` rather than string templating for one
 * specific reason: `ResolutionRule.section` is the single optional field in the
 * whole genome tree, and it is `z.string().min(1).optional()`, so `null` and
 * `""` both fail validation. `stringify` omits undefined-valued keys; a
 * hand-rolled writer emitting `section: null` would round-trip into a throw.
 */
import fs from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import { genomePath } from "./load.js";
import { GenomeSchema, type Genome } from "./schema.js";

/** The outcome of checking a candidate against the real schema. */
export type GenomeValidation = { ok: true; genome: Genome } | { ok: false; issues: string[] };

/**
 * Render a genome to the exact bytes `loadGenome` will read back.
 *
 * A `Genome` value is total — every field required but `ResolutionRule.section`
 * — so this relies on no defaulting: what is written is what was meant.
 */
export function serializeGenome(genome: Genome): string {
  return stringifyYaml(genome);
}

/**
 * Check a candidate against `GenomeSchema` without touching the filesystem.
 *
 * Issues are formatted the way `loadGenome` formats them (`<dotted.path>:
 * <message>`, root-level issues labelled `(root)`) so a harness log and a
 * runtime failure read the same.
 */
export function validateGenome(candidate: unknown): GenomeValidation {
  const result = GenomeSchema.safeParse(candidate);
  if (result.success) return { ok: true, genome: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/**
 * Plant a genome at the vault root, beside `ost.config.yaml`.
 *
 * Throws on an invalid genome and writes nothing — an unwritten file means the
 * default genome, which is a defined state, while a half-written invalid one is
 * a run that dies later and blames the wrong thing.
 */
export function writeGenome(vaultDir: string, genome: Genome): void {
  const check = validateGenome(genome);
  if (!check.ok) {
    throw new Error(
      `refusing to write an invalid genome.yaml:\n${check.issues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }
  fs.writeFileSync(genomePath(vaultDir), serializeGenome(check.genome), "utf8");
}
