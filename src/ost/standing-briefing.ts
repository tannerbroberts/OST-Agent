/**
 * The standing tree briefing — regenerated in full from the tree, every pass.
 *
 * This is the other briefing, and the difference from `briefing.ts` is the whole
 * design. NEXT-BUILD.md is a *reading* — a pass's judgement about what to build
 * next — so a rewrite there preserves every prior reading, because the history of
 * judgements is a record nothing can recompute. This file is a *derivation*: every
 * line is computed from what the nodes already carry, so its history is the git
 * history of the vault and keeping prior copies inside the file would only let a
 * stale sentence masquerade as a current one. {@link regenerateStandingBriefing}
 * therefore overwrites wholesale, and the spec in
 * `test/ost/standing-briefing.test.ts` pins that nothing survives from the
 * previous briefing.
 *
 * The job is comprehension rather than record. A changelog tells a reader what
 * moved and assumes they hold the tree in their head; this rebuilds the tree in
 * their head each time — where it stands, which branch is live and why, what the
 * last week's evidence changed, and the belief the whole thing currently rests
 * on. That last one is the mechanical core: the weakest rung of the
 * believability rollup, which the tree already computes
 * ({@link believabilityRollup}), named with its definition so a cold reader
 * learns what the tree's footing *is*, not just that it has one.
 *
 * What this deliberately cannot fix, per the node that asked for it: the
 * briefing is derived by the same machinery whose reading it is meant to keep
 * the operator able to check. If the tree is misread upstream, a full
 * regeneration misreads it identically and confidently. Whether an operator can
 * actually answer questions about their own tree from this file is a
 * humans-required test, and no green here settles it.
 */
import fs from "node:fs";
import path from "node:path";
import type { OstNode } from "./node.js";
import { nodeInstrument, observedGreen } from "./instrument.js";
import { BELIEVABILITY_LADDER, believabilityRollup } from "../knowledge/believability.js";
import { rollupTree, subtree } from "../eval/rollup.js";
import { byTitle } from "../processes/tree.js";

/** The one filename, exported so no caller spells it independently. */
export const STANDING_BRIEFING_FILENAME = "BRIEFING.md";

/**
 * The briefing's stable address for a vault: `<vault>/.ost-agent/BRIEFING.md`.
 * `path.resolve` for the same reason `nextBuildPath` uses it — two spellings of
 * one vault must answer identically.
 */
export function standingBriefingPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", STANDING_BRIEFING_FILENAME);
}

/** A YYYY-MM-DD minus n days, in UTC — no clock is read anywhere in this module. */
function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Compose the briefing from the tree — a pure function of (tree, today), which
 * is what makes "regenerated in full" checkable: regenerating over any prior
 * state must produce the byte-identical file a fresh vault would get.
 *
 * `today` is a parameter rather than a clock read so the composition is
 * deterministic under test and so the loop, not this module, owns what day it
 * is.
 */
export function composeStandingBriefing(tree: readonly OstNode[], today: string): string {
  const rollup = rollupTree(tree);
  const lines: string[] = [];

  lines.push(`# TREE BRIEFING — ${today}`);
  lines.push("");
  lines.push(
    "**Regenerated in full from the tree every pass; nothing in this file survives from " +
      "the previous briefing.** Written to be read cold: if you have not been following, " +
      "this is where the tree stands, not a list of what changed since you left.",
  );

  // Where the tree stands — the totals, then breadth and build state in one
  // sentence each, so a cold reader gets the shape before any detail.
  lines.push("");
  lines.push("## Where the tree stands");
  lines.push("");
  if (rollup.outcome === null) {
    lines.push("This vault has no Outcome node — there is no root to stand anywhere.");
  } else {
    const tests = tree.filter((n) => n.layer === "AssumptionTest");
    const instrumented = tests.filter((t) => nodeInstrument(t) !== undefined);
    const green = instrumented.filter(observedGreen);
    lines.push(`The outcome is **${rollup.outcome}**.`);
    lines.push("");
    lines.push(
      `The tree holds ${rollup.totals.nodes} nodes — ${rollup.totals.opportunities} opportunities, ` +
        `${rollup.totals.solutions} solutions, ${rollup.totals.tests} tests — filed under ` +
        `${rollup.buckets.length} top-level need(s). Of the ${instrumented.length} test(s) that name a ` +
        `runnable definition of done, ${green.length} currently pass; ` +
        `${tests.filter((t) => t.status === "validated").length} test(s) stand validated by a human.`,
    );
  }

  // The belief everything rests on — the weakest rung of the believability
  // rollup. Named with its definition, because "rests on assertion" only
  // teaches a reader who already knows the ladder.
  lines.push("");
  lines.push("## The belief everything rests on");
  lines.push("");
  const belief = believabilityRollup(tree);
  const declared = Object.values(belief.counts).reduce((a, b) => a + b, 0);
  if (declared === 0) {
    // `believabilityRollup` answers the floor for an empty ladder, but a tree
    // where nobody declared anything has not been assessed and found weak — it
    // has not been assessed, and the briefing must not dress that up.
    lines.push(
      `No node in this tree declares a believability rung (${belief.unlabelled} unlabelled), ` +
        "so the honest answer is: the tree rests on nothing anyone has weighed.",
    );
  } else {
    const rung = BELIEVABILITY_LADDER.find((r) => r.id === belief.weakest);
    const label = rung ? rung.label : belief.weakest;
    const definition = rung ? rung.definition : "";
    lines.push(
      `A conclusion is only as believable as its weakest input, and the weakest rung declared ` +
        `anywhere in this tree is **${belief.weakest} (${label})**: ${definition} ` +
        `${belief.counts[belief.weakest]} node(s) sit on that rung` +
        (belief.unlabelled > 0 ? `, and ${belief.unlabelled} declare no rung at all.` : "."),
    );
  }

  // The live branch — where the newest node landed. "Live" is derived from
  // dates the nodes already carry, never from anyone's sense of momentum.
  lines.push("");
  lines.push("## The live branch");
  lines.push("");
  const live = liveBranch(tree, rollup.buckets.map((b) => b.title));
  if (live === null) {
    lines.push("No bucket holds a dated node, so nothing marks one branch as more alive than another.");
  } else {
    lines.push(
      `The most recent work landed under **${live.bucket}**: "${live.node.title}" ` +
        `(${live.node.layer}, created ${live.node.created}). Live here means only that this branch ` +
        "holds the newest dated node — it says where attention has been, not where it should go.",
    );
  }

  // What the last week changed — additions dated inside the window, so a
  // reader returning after a week away sees the delta without needing a diff.
  lines.push("");
  lines.push("## What the last week changed");
  lines.push("");
  const since = daysBefore(today, 7);
  const recent = tree
    .filter((n) => typeof n.created === "string" && n.created > since && n.created <= today)
    .sort((a, b) => (a.created as string) < (b.created as string) ? 1 : -1);
  if (recent.length === 0) {
    lines.push(`No node is dated after ${since}: the last week added nothing to the picture above.`);
  } else {
    lines.push(`${recent.length} node(s) entered the tree since ${since}, newest first:`);
    lines.push("");
    const shown = recent.slice(0, 10);
    for (const n of shown) lines.push(`- ${n.created} — ${n.layer}: "${n.title}"`);
    // Never truncate silently: a list that stops without saying so reads as
    // complete coverage of a week it only sampled.
    if (recent.length > shown.length) lines.push(`- …and ${recent.length - shown.length} more, in the tree itself.`);
  }

  return lines.join("\n") + "\n";
}

/** The bucket holding the newest dated node, or null when no bucket holds one. */
function liveBranch(
  tree: readonly OstNode[],
  buckets: readonly string[],
): { bucket: string; node: OstNode } | null {
  const index = byTitle([...tree]);
  let best: { bucket: string; node: OstNode } | null = null;
  for (const bucket of buckets) {
    for (const node of subtree(bucket, index)) {
      if (typeof node.created !== "string" || node.created.trim() === "") continue;
      if (best === null || node.created > (best.node.created as string)) best = { bucket, node };
    }
  }
  return best;
}

/**
 * Regenerate the briefing at its stable address, in full.
 *
 * Overwrites wholesale — see the module comment for why this file, unlike
 * NEXT-BUILD.md, keeps no history of itself. Returns the address it wrote.
 */
export function regenerateStandingBriefing(vaultDir: string, tree: readonly OstNode[], today: string): string {
  const p = standingBriefingPath(vaultDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, composeStandingBriefing(tree, today));
  return p;
}
