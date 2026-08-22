/**
 * The draw for a human review pass — 10% of the tree, stratified, reproducible.
 *
 * `docs/reference/evaluating-ost-agent.md` names three layers of efficacy and
 * says plainly that only the first is machinery: the structural invariants are a
 * gate, and **faithfulness and usefulness are read by a person, one node at a
 * time**. On a 1,400-node tree "one node at a time" is not a review anybody runs,
 * so the tree that owns this repo proposed sampling: rate a tenth, and take the
 * tenth as a read on the whole.
 *
 * This module builds the half of that a machine may build, and stops hard at the
 * line the doc draws. It DRAWS THE SAMPLE. It does not rate one node, produce a
 * grounding rate, or emit any number that could be mistaken for a quality score —
 * the rubric below is printed for a person to apply, and nothing here applies it.
 * There is still no command in this repo that scores faithfulness or usefulness,
 * and this one must not become the first by accident.
 *
 * What a *sample* has to be, before any estimate drawn from it means anything:
 *
 *   - **Sized.** A stated fraction of the reviewable nodes, with the denominator
 *     printed beside it, so the reader can see the tenth is a tenth of what they
 *     think it is.
 *   - **Stratified.** Every bucket and every layer represented. The failure this
 *     replaces is the alphabetical head — `ls | head -140` is a sample of the
 *     letter A, and on this vault it would review forty nodes from one bucket and
 *     none at all from twenty others. Strata are `bucket × layer` cells rather
 *     than two independent margins, because "every bucket appears" and "every
 *     layer appears" can both hold while every Solution drawn comes from one
 *     bucket.
 *   - **Reproducible.** The same seed draws the same set, so two reviewers can
 *     rate the same nodes and a disagreement is about the nodes rather than about
 *     which nodes. A different seed draws a different set, so a second opinion is
 *     one flag away.
 *
 * One consequence of stratifying by cell is worth stating before anybody averages
 * a finished sheet, because it is silent and it changes the answer. On this
 * repo's own vault there are more `bucket × layer` cells (150) than a tenth of
 * the tree has nodes (142), so the floor of one-per-cell IS the whole draw: every
 * cell contributes one node whether it holds five or fifty. That makes the sheet
 * a coverage sample rather than a proportional one, and the plain mean of its
 * ratings is a mean over cells, not over the tree. Each cell therefore prints the
 * number of nodes one rating stands for, and the sheet says out loud that the
 * estimate has to be weighted by it. See {@link ReviewSample.uniform}.
 *
 * Nothing here reads the clock or calls `Math.random`. The seed is a string the
 * caller supplies and the CLI defaults to the UTC date; every ordering decision
 * downstream of it is a pure function of that string, which is what makes the
 * header's "reproduce this exact draw" line true rather than aspirational.
 */
import { LAYERS, type Layer, type OstNode, type NodeStatus } from "../ost/node.js";
import type { RungId } from "../knowledge/believability.js";
import type { CensusDrop, TreeCensus } from "../ost/census.js";
import { byTitle } from "../processes/tree.js";
import { subtree } from "./rollup.js";

/** The bucket label for a node the Outcome reaches through no category Opportunity. */
export const NO_BUCKET = "(in no bucket)";

/** The fraction the assumption test names, as the default nothing has to restate. */
export const DEFAULT_FRACTION = 0.1;

export interface RubricCriterion {
  /** Short handle, used as the checkbox label on the review sheet. */
  id: string;
  /** The question the reviewer answers about one node. */
  question: string;
  /** Why it is on the sheet — the failure it is looking for. */
  looksFor: string;
}

/**
 * The faithfulness rubric, transcribed from the three-layer argument in
 * `docs/reference/evaluating-ost-agent.md` rather than invented here.
 *
 * Layer 2 is two truth-values — *grounded* (the claim stays inside the evidence
 * it cites; inventing evidence is the cardinal Torres sin) and *classified* (an
 * opportunity is a need, not a feature). Layer 3 is one human-acceptance
 * question — *useful* (would you keep it). Three checkboxes, because a rubric a
 * reviewer will not finish measures nothing.
 */
export const FAITHFULNESS_RUBRIC: readonly RubricCriterion[] = [
  {
    id: "grounded",
    question: "Does the node's claim stay inside the evidence it cites?",
    looksFor: "invented support — a source that does not say what the node says it says",
  },
  {
    id: "classified",
    question: "Is it in the right layer? An opportunity is a need, not a feature.",
    looksFor: "a solution filed as an opportunity, or a belief filed as its own test",
  },
  {
    id: "useful",
    question: "Would you keep it?",
    looksFor: "true, well-formed and not worth anybody's next hour",
  },
] as const;

/** One `bucket × layer` cell of the frame, and what the draw took from it. */
export interface Stratum {
  bucket: string;
  layer: Layer;
  /** Reviewable nodes in this cell — the cell's own denominator. */
  population: number;
  /** How many of them the draw took. Never zero for a non-empty cell. */
  drawn: number;
}

/** One node on the review sheet, carrying what a reviewer needs before opening it. */
export interface SampledNode {
  title: string;
  layer: Layer;
  bucket: string;
  evidence?: RungId;
  status?: NodeStatus;
  source?: string;
  /** True when more than one bucket reaches this node; see {@link ReviewSample.multiHomed}. */
  alsoUnder: string[];
}

export interface ReviewSample {
  /** The string every ordering decision below was derived from. */
  seed: string;
  fraction: number;
  /** Nodes eligible for review — the tree minus the human-set Outcome. */
  reviewable: number;
  /** `ceil(fraction × reviewable)` — what the fraction asks for. */
  target: number;
  drawn: SampledNode[];
  /** Every non-empty cell of the frame, in bucket-then-layer order. */
  strata: Stratum[];
  /**
   * How far the draw exceeds `target`, because covering every cell takes one node
   * per cell and there can be more cells than a tenth of the tree.
   *
   * Said out loud rather than resolved by dropping cells: a draw silently capped
   * at the target is a draw that misses whole buckets, which is the exact defect
   * stratifying exists to prevent.
   */
  overflow: number;
  /**
   * Nodes in the frame that more than one bucket reaches, each homed under the
   * first alphabetically so it occupies exactly one cell.
   */
  multiHomed: number;
  /**
   * Whether every cell drew the same number of nodes — which on a tree with more
   * cells than the fraction has nodes is *always* one apiece.
   *
   * This is the honest name for what a 10% draw over a 37-bucket tree is: a
   * COVERAGE sample, not a proportional one. Every cell contributes one node
   * whether it holds five or fifty, so the unweighted mean of the ratings is the
   * mean over CELLS and not over the tree, and it over-weights the small buckets
   * by however far their populations differ. The estimate has to weight each
   * rated node by `population / drawn` for its cell; the sheet prints that number
   * and says so, because a reviewer who averages the checkmarks gets a real
   * number that answers a different question.
   */
  uniform: boolean;
  /**
   * Files the walk could not read, and which are therefore outside the frame
   * entirely. A sample of a tree it could not read is not a sample of that tree,
   * so these are named beside the draw rather than folded into the denominator.
   */
  unreadable: CensusDrop[];
}

/** FNV-1a, 32-bit. A string seed in, a well-mixed integer out. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, seeded, and identical on every platform this runs on. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded stream. Pure: the input array is not touched. */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Stable cell key, and the order strata are reported and allocated in. */
function key(bucket: string, layer: Layer): string {
  return `${bucket} ${layer}`;
}

/**
 * Which bucket each node is reviewed under.
 *
 * A bucket is a category Opportunity hanging directly off the Outcome, and
 * `subtree` reaches a node from every bucket that links it — the rollup counts
 * such a node under both on purpose. A sample cannot: a node drawn twice is a
 * node reviewed twice and a denominator that no longer adds up. So each node gets
 * exactly one home, the alphabetically-first bucket that reaches it, and the
 * count of nodes that had a choice is reported so the arbitrariness is visible.
 */
function homeBuckets(tree: readonly OstNode[]): Map<string, string[]> {
  const index = byTitle([...tree]);
  const outcome = tree.find((n) => n.layer === "Outcome");
  const buckets = (outcome?.links ?? [])
    .map((t) => index.get(t))
    .filter((n): n is OstNode => n !== undefined && n.layer === "Opportunity")
    .map((n) => n.title)
    .sort((a, b) => a.localeCompare(b));

  const homes = new Map<string, string[]>();
  for (const bucket of buckets) {
    for (const n of subtree(bucket, index)) {
      const existing = homes.get(n.title);
      if (existing) existing.push(bucket);
      else homes.set(n.title, [bucket]);
    }
  }
  return homes;
}

/**
 * Hand out `target` draws across the cells, one to every cell first.
 *
 * The floor is the stratification guarantee in one line — a cell that gets zero
 * is a bucket or a layer nobody reviewed. What is left after the floors goes to
 * whichever cell is furthest below its proportional share, repeatedly, which is
 * the largest-remainder answer computed the way that cannot overshoot a cell's
 * population. Ties break on the cell key so the allocation is a pure function of
 * the frame and never of insertion order.
 */
function allocate(populations: readonly number[], keys: readonly string[], target: number): number[] {
  const total = populations.reduce((a, b) => a + b, 0);
  if (total === 0) return populations.map(() => 0);
  const alloc: number[] = populations.map((p) => (p > 0 ? 1 : 0));
  let left = target - alloc.reduce((a, b) => a + b, 0);

  while (left > 0) {
    let pick = -1;
    let best = -Infinity;
    for (let i = 0; i < populations.length; i++) {
      if (alloc[i] >= populations[i]) continue; // saturated: it has no more nodes
      const deficit = (populations[i] * target) / total - alloc[i];
      if (deficit > best || (deficit === best && pick >= 0 && keys[i] < keys[pick])) {
        best = deficit;
        pick = i;
      }
    }
    if (pick < 0) break; // every cell exhausted — target exceeded the population
    alloc[pick]++;
    left--;
  }
  return alloc;
}

export interface DrawOptions {
  /** Every ordering below is a pure function of this string. */
  seed: string;
  /** Defaults to {@link DEFAULT_FRACTION}. `1` draws the whole tree, which is the sheet the estimate is compared against. */
  fraction?: number;
}

/**
 * Draw the review sample.
 *
 * The frame is every node in the census except the Outcome: the Outcome is the
 * human's own mandate, set by `set-outcome` and never ideated, so rating it for
 * faithfulness would be the reviewer grading their own sentence. Everything else
 * is in — including `Unknown`-layer nodes and nodes in no bucket, which are the
 * two populations a tidier frame would drop and the two most likely to be wrong.
 */
export function drawReviewSample(census: TreeCensus, opts: DrawOptions): ReviewSample {
  const fraction = opts.fraction ?? DEFAULT_FRACTION;
  const reviewable = census.nodes.filter((n) => n.layer !== "Outcome");
  const homes = homeBuckets(census.nodes);

  const cells = new Map<string, { bucket: string; layer: Layer; nodes: OstNode[] }>();
  for (const n of reviewable) {
    const under = homes.get(n.title) ?? [];
    const bucket = under[0] ?? NO_BUCKET;
    const k = key(bucket, n.layer);
    const cell = cells.get(k) ?? { bucket, layer: n.layer, nodes: [] };
    cell.nodes.push(n);
    cells.set(k, cell);
  }

  // Bucket alphabetically, layer root-first — the order a reader walks a tree in,
  // and fixed rather than insertion-ordered so two runs render identically.
  const ordered = [...cells.entries()].sort(([, a], [, b]) => {
    const byBucket = a.bucket.localeCompare(b.bucket);
    return byBucket !== 0 ? byBucket : LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer);
  });

  const target = reviewable.length === 0 ? 0 : Math.max(1, Math.ceil(fraction * reviewable.length));
  const alloc = allocate(
    ordered.map(([, c]) => c.nodes.length),
    ordered.map(([k]) => k),
    target,
  );

  const strata: Stratum[] = [];
  const drawn: SampledNode[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const [k, cell] = ordered[i];
    strata.push({ bucket: cell.bucket, layer: cell.layer, population: cell.nodes.length, drawn: alloc[i] });
    // Sort before shuffling: the shuffle is only reproducible if what it shuffles
    // arrives in a fixed order, and directory-walk order is not one.
    const byName = [...cell.nodes].sort((a, b) => a.title.localeCompare(b.title));
    // Per-cell stream, keyed by the seed AND the cell, so a change to one bucket's
    // population cannot reshuffle every other bucket's draw.
    for (const n of shuffled(byName, prng(hash32(`${opts.seed} ${k}`))).slice(0, alloc[i])) {
      const under = homes.get(n.title) ?? [];
      drawn.push({
        title: n.title,
        layer: n.layer,
        bucket: cell.bucket,
        evidence: n.evidence,
        status: n.status,
        source: n.source,
        alsoUnder: under.slice(1),
      });
    }
  }

  return {
    seed: opts.seed,
    fraction,
    reviewable: reviewable.length,
    target,
    drawn,
    strata,
    overflow: Math.max(0, drawn.length - target),
    // Over the whole frame rather than over the sheet: whether a node had a
    // choice of homes is a fact about the frame, and counting only the drawn ones
    // would report zero on a tree full of them just because none came up.
    multiHomed: reviewable.filter((n) => (homes.get(n.title) ?? []).length > 1).length,
    uniform: new Set(strata.filter((s) => s.drawn > 0).map((s) => s.drawn)).size <= 1,
    unreadable: census.unreadable,
  };
}

function pct(fraction: number): string {
  const n = fraction * 100;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/**
 * The review sheet.
 *
 * Written to be filled in by hand — a checkbox per rubric criterion per node,
 * grouped by the stratum the node was drawn from, so a reviewer who stops halfway
 * can see which buckets they have covered. The header says what the draw is and
 * how to reproduce it; the footer says, in the same words the solution node uses,
 * what a completed sheet does and does not establish.
 */
export function formatReviewSample(sample: ReviewSample): string {
  const lines: string[] = [];

  lines.push(
    `Review sample — ${sample.drawn.length} of ${sample.reviewable} reviewable node(s) ` +
      `(${pct(sample.fraction)} asks for ${sample.target}), seed ${JSON.stringify(sample.seed)}`,
  );
  lines.push(`Reproduce this exact draw: ost-agent review-sample --seed ${JSON.stringify(sample.seed)}`);
  lines.push("");

  if (sample.reviewable === 0) {
    lines.push("Nothing to review: this vault holds no node other than its Outcome.");
    return lines.join("\n");
  }

  lines.push("Rubric — applied by a person, to each node below. This command rates nothing.");
  for (const c of FAITHFULNESS_RUBRIC) {
    lines.push(`  ${c.id} — ${c.question}`);
    lines.push(`    looking for: ${c.looksFor}`);
  }
  lines.push("");

  const covered = sample.strata.filter((s) => s.drawn > 0).length;
  lines.push(
    `Frame: ${sample.strata.length} bucket × layer cell(s) hold a node; ${covered} are represented in this draw` +
      `${covered === sample.strata.length ? " — every bucket and every layer" : ` (${sample.strata.length - covered} MISSED)`}.`,
  );
  if (sample.overflow > 0) {
    lines.push(
      `  The draw is ${sample.overflow} above the ${pct(sample.fraction)} target: there are more cells than that ` +
        `fraction has nodes, and one per cell is what "every bucket and every layer" costs.`,
    );
  }
  if (sample.multiHomed > 0) {
    lines.push(
      `  ${sample.multiHomed} node(s) in the frame hang under more than one bucket and are homed under the first ` +
        `alphabetically, so each occupies one cell and can be on this sheet at most once.`,
    );
  }
  // The trap this warns about is silent and arithmetically real: on a tree with
  // more cells than a tenth has nodes, every cell draws one, so the plain mean of
  // the checkmarks is a mean over CELLS. A five-node cell and a fifty-node cell
  // then weigh the same, and the answer is off by however far bucket sizes differ.
  lines.push(
    sample.uniform
      ? `  Every cell drew the same number, so this is a COVERAGE sample and not a proportional one: to estimate the ` +
          `whole tree, weight each node's ratings by the "stands for" figure on its cell rather than averaging the sheet.`
      : `  Cells drew in proportion to their size where the fraction allowed it. Weight each node's ratings by the ` +
          `"stands for" figure on its cell anyway — the one-per-cell floor leaves small cells over-represented.`,
  );
  const orphans = sample.strata.filter((s) => s.bucket === NO_BUCKET);
  if (orphans.length > 0) {
    lines.push(
      `  ${orphans.reduce((a, s) => a + s.population, 0)} node(s) sit under no bucket at all and are drawn as ` +
        `"${NO_BUCKET}" rather than dropped — \`ost-agent rollup\` names these unfiled.`,
    );
  }
  if (sample.unreadable.length > 0) {
    lines.push(
      `  ${sample.unreadable.length} file(s) could not be read and are OUTSIDE this frame entirely — a sample of a ` +
        `tree it cannot read is not a sample of that tree:`,
    );
    for (const u of sample.unreadable) lines.push(`    ${u.file} — ${u.reason}`);
  }
  lines.push("");

  const boxes = FAITHFULNESS_RUBRIC.map((c) => `[ ] ${c.id}`).join("  ");
  let bucket: string | null = null;
  for (const s of sample.strata) {
    if (s.drawn === 0) continue;
    if (s.bucket !== bucket) {
      bucket = s.bucket;
      lines.push(`Bucket: ${bucket}`);
    }
    // The weight, printed on the cell rather than left for the reviewer to work
    // out, because the arithmetic that makes the sample an estimate is the part
    // most likely to be skipped.
    const weight = s.population / s.drawn;
    lines.push(
      `  ${s.layer} — ${s.drawn} of ${s.population} drawn · each stands for ` +
        `${Number.isInteger(weight) ? weight : weight.toFixed(2)}`,
    );
    for (const n of sample.drawn.filter((d) => d.bucket === s.bucket && d.layer === s.layer)) {
      const meta = [n.evidence ?? "no rung declared", n.status ?? "no status", n.source ?? "no source"];
      lines.push(`    ${boxes}  ${n.title}`);
      lines.push(`        ${meta.join(" · ")}`);
      if (n.alsoUnder.length > 0) lines.push(`        also under: ${n.alsoUnder.join(", ")}`);
    }
  }

  lines.push("");
  lines.push(
    "This is the draw, and only the draw. Whether a sample this size estimates whole-tree quality is settled by a " +
      "person rating BOTH this sheet and the whole tree (`--fraction 1`) against the rubric above, weighting each " +
      "rated node by its cell's \"stands for\" figure, and comparing the two — no command in this repo does that, " +
      "and none scores faithfulness or usefulness.",
  );
  return lines.join("\n");
}
