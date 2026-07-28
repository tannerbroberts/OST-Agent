/**
 * Load the genome from a vault directory.
 *
 * Two failure directions, opposite on purpose:
 *
 * ABSENT ⇒ the default genome, silently, always. There is no `missing` option
 * and no caller may ask for one. `loadConfig`'s equivalent exists because a
 * missing *config* means "this directory is not a vault"; a missing *genome*
 * means nothing at all — every vault in existence has none, and every one of
 * them must keep behaving exactly as it does today.
 *
 * PRESENT BUT WRONG ⇒ throws, naming the file and every offending path, on the
 * precedent `loadConfig` sets: a broken file is a mistake to report, not a
 * state to tolerate. Combined with the schema's strictness this is the point of
 * the whole module — a typo'd allele must never read as "behaviour unchanged",
 * because a fitness record computed under a policy nobody applied is worse than
 * no record.
 *
 * Load it ONCE per pass, in `buildPassContext`, and thread it. Never call this
 * inside a tool closure: a genome re-read mid-pass would let the policy change
 * under a run whose fitness is being measured.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { GenomeSchema, type Genome } from "./schema.js";

export const GENOME_FILENAME = "genome.yaml";

/** Beside `ost.config.yaml` at the vault root: policy a human reads lives where a human looks. */
export function genomePath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), GENOME_FILENAME);
}

/**
 * The genome that reads no file at all. Defaults come from the schema and are
 * never restated in a hand-kept object — a second copy is a second thing to
 * drift, and the whole regression contract rests on there being one.
 */
export function defaultGenome(): Genome {
  return GenomeSchema.parse({});
}

/** Read + validate the genome. An absent file is the default; a broken one throws. */
export function loadGenome(vaultDir: string): Genome {
  const p = genomePath(vaultDir);
  if (!fs.existsSync(p)) return defaultGenome();
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(p, "utf8")) ?? {};
  } catch (err) {
    // The YAML parser's own error names a line, not a file, and a vault carries
    // more than one YAML. Say which one.
    throw new Error(`invalid ${GENOME_FILENAME}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = GenomeSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`invalid ${GENOME_FILENAME}:\n${issues}`);
  }
  return result.data;
}
