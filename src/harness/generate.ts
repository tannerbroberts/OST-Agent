/**
 * Materialise an `EnvironmentSpec` into a vault the kernel will actually read.
 *
 * This module does NOT hand-write Markdown. The node format has four traps and
 * every one of them yields a vault that parses cleanly into the WRONG tree: a
 * blank line between the tag line and the edge block silently kills every edge
 * (`src/ost/node.ts`); a `[[link]]` in prose is not an edge and never becomes
 * one; the filename IS the title, so a file not named `fileNameForTitle(title)`
 * dangles permanently; and an unrecognised `evidence:` is dropped rather than
 * rejected, after which the evidence-class invariant fires on the node. So it
 * builds `OstNode` values and calls the repo's own `serialize`, which is the one
 * function that provably emits what `deserialize` reads.
 * `test/eval/planted-instance.test.ts` records the lesson from the last time
 * this was done by hand: "a plant that is not the shape the check looks for
 * proves nothing about the check."
 *
 * It writes bytes directly rather than going through `vault.createNode`, and it
 * does not call `initVault`. Both of those stamp `new Date()` into the vault —
 * `## History` lines and the root node's `created` — and `initVault` shells out
 * to git twice per vault besides. For a harness generating hundreds of
 * environments that is a process spawn each and a date that changes between
 * runs, which forfeits byte-reproducibility for nothing. The verified minimum
 * `buildPassContext` accepts is `ost.config.yaml` plus node files at the vault
 * root: no `.ost-agent/`, no git repo.
 *
 * The answer key is not written. Findable answers reach the vault only through
 * planted EVIDENCE — that is what findable means — but the spec itself, which
 * names which unknowns are findable at all, never lands on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { serialize, type OstNode } from "../ost/node.js";
import { fileNameForTitle } from "../ost/sanitize.js";
import { writeEvidence, type EvidenceRecord } from "../processes/tree.js";
import { makeRng } from "./random.js";
import { EnvironmentSpecSchema, type EnvironmentSpec, type PlantedUnknown } from "./spec.js";

/** A planted environment: where it lives, and the spec that is its key. */
export interface GeneratedEnvironment {
  dir: string;
  spec: EnvironmentSpec;
}

/** The rung every generated node declares. The floor, so no plant claims unearned believability. */
const GENERATED_RUNG = "assertion" as const;

/** Render one planted unknown's body from the sections it declares. */
function unknownBody(u: PlantedUnknown): string {
  const section = (name: string): string => {
    if (name === "Format") return "## Format\na single recorded value";
    if (name === "Methodology") return "## Methodology\nread it from the planted channel";
    return "## Rationale\nserves the node it darkens";
  };
  if (u.sections.length === 0) return "nothing declared at all";
  return u.sections.map(section).join("\n\n");
}

/**
 * The spec's nodes plus its unknowns, as `OstNode` values.
 *
 * The edge direction is the settled one and is not negotiable here: the
 * DARKENED node carries the `[[unknown]]` link, and the unknown links to
 * nothing. `computeNextWork` resolves `darkens` by searching for the
 * non-Unknown node that links TO the unknown, so emitting it the other way
 * resolves `darkens: null` for every planted unknown and degrades every
 * coverage metric without erroring.
 */
export function specToNodes(spec: EnvironmentSpec): OstNode[] {
  const darkensOf = new Map<string, string[]>();
  for (const u of spec.unknowns) {
    const list = darkensOf.get(u.darkens) ?? [];
    list.push(u.title);
    darkensOf.set(u.darkens, list);
  }

  const planted: OstNode[] = spec.nodes.map((n) => ({
    title: n.title,
    layer: n.layer,
    status: "validated",
    created: spec.created,
    evidence: GENERATED_RUNG,
    tags: [],
    links: [...n.links, ...(darkensOf.get(n.title) ?? [])],
    body: n.body,
  }));

  const unknowns: OstNode[] = spec.unknowns.map((u) => ({
    title: u.title,
    layer: "Unknown",
    // Deliberately NOT `validated` and NOT `deferred`: either would make the
    // unknown read as resolved before the run has done anything, because
    // resolution is a rule list over status and sections.
    status: "unvalidated",
    created: spec.created,
    evidence: GENERATED_RUNG,
    tags: [],
    links: [],
    body: unknownBody(u),
  }));

  return [...planted, ...unknowns];
}

/**
 * Write the spec into `dir`. The directory should be a fresh `mkdtemp` — this
 * function does not clear anything, because nothing in this repo deletes.
 */
export function generateEnvironment(spec: EnvironmentSpec, dir: string): GeneratedEnvironment {
  const parsed = EnvironmentSpecSchema.parse(spec);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ost.config.yaml"),
    `outcome: ${JSON.stringify(parsed.outcome)}\noutcomeTitle: ${JSON.stringify(parsed.outcomeTitle)}\n`,
    "utf8",
  );

  for (const node of specToNodes(parsed)) {
    fs.writeFileSync(path.join(dir, fileNameForTitle(node.title)), serialize(node), "utf8");
  }

  for (const e of parsed.evidence) {
    const rec: EvidenceRecord = {
      id: e.id,
      source: e.source,
      title: e.title,
      // Fixed, from the spec — `writeEvidence` stores whatever it is given, and
      // a clock read here would break byte-reproducibility.
      timestamp: `${parsed.created}T00:00:00.000Z`,
      body: e.body,
    };
    writeEvidence(dir, rec);
  }

  return { dir, spec: parsed };
}

/**
 * Build a generated spec from a seed. The workhorse source of environments:
 * cheap, so n is large, which is the whole statistical advantage over waiting
 * on real users.
 *
 * `findableRatio` is the dial that reaches a null environment by parameter —
 * `0` means nothing is discoverable, which is the shape the mandatory guard
 * needs. Note that a null environment still PLANTS unknowns; an empty vault
 * would make the guard pass vacuously.
 */
export function makeSpec(
  seed: number,
  opts: { unknowns?: number; findableRatio?: number; name?: string } = {},
): EnvironmentSpec {
  const rng = makeRng(seed);
  const count = opts.unknowns ?? 3;
  const findableRatio = opts.findableRatio ?? 0.5;

  const SECTION_SETS: readonly string[][] = [
    ["Format", "Methodology", "Rationale"],
    ["Format", "Rationale"],
    ["Format"],
    [],
  ];

  const parents = ["Retention", "Activation", "Expansion"] as const;
  const nodes = parents.map((title, i) => ({
    title,
    layer: (i === 0 ? "Outcome" : "Opportunity") as "Outcome" | "Opportunity",
    body: `A planted ${i === 0 ? "outcome" : "opportunity"} named ${title}.`,
    links: [] as string[],
  }));

  const unknowns: PlantedUnknown[] = [];
  const evidence: EnvironmentSpec["evidence"] = [];
  for (let i = 0; i < count; i++) {
    // Draw findability from the same stream as everything else so the whole
    // spec is one pure function of the seed.
    const findable = rng.next() < findableRatio;
    const title = `Unknown ${i + 1} of seed ${seed}`;
    const answer = findable ? `value-${seed}-${i}` : "";
    unknowns.push({
      title,
      darkens: rng.pick(parents),
      sections: rng.pick(SECTION_SETS),
      findable,
      answer,
    });
    if (findable) {
      evidence.push({
        id: `seed-${seed}-e${i}`,
        source: "INBOX",
        title: `observation ${i + 1}`,
        body: `The recorded value is ${answer}.`,
      });
    }
  }

  // `kind` describes the WORLD, not the request. A findableRatio of 0.5 over
  // four unknowns draws nothing findable about one seed in sixteen, and such an
  // environment IS a null one however it was asked for — labelling it
  // "generated" would quietly put a null world in the generated arm of every
  // later comparison that groups by kind. Provenance is not lost: `name` and
  // `seed` still say where it came from.
  const drewNothing = unknowns.every((u) => !u.findable);
  return EnvironmentSpecSchema.parse({
    name: opts.name ?? `generated-${seed}`,
    kind: findableRatio === 0 || drewNothing ? "null" : "generated",
    seed,
    created: "2026-07-28",
    outcome: "Reach 10,000 daily active users",
    outcomeTitle: "Retention",
    nodes,
    unknowns,
    evidence,
  });
}
