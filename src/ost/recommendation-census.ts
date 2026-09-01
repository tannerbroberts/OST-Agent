/**
 * The counter the refuse-when-unclear rule wants before it wants an
 * implementation.
 *
 * The solution "Refuse to recommend when the source does not read cleanly" is a
 * fail-closed move applied to advice: when the agent cannot read a source into
 * exactly one answer it says nothing and names what a human would have to settle.
 * Its own node states where it fails, and it is not a corner case —
 * recommendations are the product's actual output, and this vault's writing is
 * full of *mostly, except, for the census but not the fixing*. A rule that
 * silences most of the output is not a safety improvement, it is a way of turning
 * the tool off while appearing careful.
 *
 * So this module replays {@link ../knowledge/clarity.ts readSource} over the
 * recommendation surfaces a tree already renders and counts what survives. It
 * changes nothing: no surface consults it, no node is written, nothing is
 * classified. The output is a number with a pre-committed threshold attached, and
 * the threshold decides whether the rule gets built at all.
 *
 * **Per surface, never pooled.** The assumption test is explicit about this and
 * the reason is visible in the shapes below: hygiene findings rest on structural
 * sources — set arithmetic, string equality against files on disk — where nothing
 * was excerpted and the rule can never fire. Pool them with the prose-read
 * surfaces and a rule that silenced every caution hint would still report a
 * comfortable overall survival rate, answering a question nobody asked.
 *
 * **What this cannot tell anyone, verbatim from the test it serves:** whether the
 * suppressed recommendations were the *wrong* ones. A rule could silence 5% and
 * silence exactly the 5% that were correct and load-bearing. This is a cost
 * measurement. Nothing here says the survivors are any good.
 */
import { LANES } from "../knowledge/lanes.js";
import { readSource, type AmbiguityReport, type ClarityRule, type RecommendationSource } from "../knowledge/clarity.js";
import { checkInvariants } from "../eval/invariants.js";
import { NOT_DONE_BLOCKING } from "../mcp/next-work.js";
import { scanNearDuplicates } from "./dedupe.js";
import { scanExtentOverlap } from "./extent.js";
import { isRetiredNode } from "./census.js";
import { proseDeclaredLane, suggestCaution } from "./lanes.js";
import type { OstNode } from "./node.js";

/**
 * The surfaces the assumption test names, and the only ones counted. Each is a
 * place this product hands a human something to act on off the back of a source
 * it read.
 */
export const RECOMMENDATION_SURFACES = ["prose-lane", "caution-hint", "hygiene-finding"] as const;

export type RecommendationSurface = (typeof RECOMMENDATION_SURFACES)[number];

/** One thing a surface currently offers a human, with the source it was read out of. */
export interface Recommendation {
  surface: RecommendationSurface;
  /** The node it is about — what the operator would go look at. */
  subject: string;
  /** What it recommends, in the surface's own terms. */
  answer: string;
  source: RecommendationSource;
}

/**
 * Two hygiene rules are NOT enumerated here, and the omission is stated rather
 * than silent: `unresolved-citation` needs the set of ids stored under
 * `.ost-agent/evidence/`, and `suspect-source` needs the trust ledger's
 * withdrawals. Both are read from sidecars rather than from the tree, and this
 * counter is deliberately tree-only so it can be replayed over any vault
 * directory without a pass context.
 *
 * The omission moves the hygiene surface's *count* and cannot move its *rate*:
 * both omitted rules rest on structural sources — exact string equality against
 * a set of files, and a dated ledger entry — so each would have survived, and
 * adding them can only push a 100% survival rate towards 100%.
 */
export const HYGIENE_RULES_NOT_COUNTED = ["unresolved-citation", "suspect-source"] as const;

/**
 * Every recommendation a tree currently renders across the three surfaces.
 *
 * The denominator is deliberately "what renders today", not "what could render".
 * A prose lane declaration that names two lanes is already withheld by
 * `proseDeclaredLane` (the v0.16.0 fix that produced the opportunity in the first
 * place), so it never enters this count — which means the number below measures
 * what the rule would suppress *on top of* what the surfaces already refuse, and
 * that is the only number the decision turns on.
 */
export function recommendationsOf(tree: readonly OstNode[]): Recommendation[] {
  const out: Recommendation[] = [];
  const live = tree.filter((n) => !isRetiredNode(n));
  const laneIds = LANES.map((l) => l.id);

  for (const node of tree) {
    if (node.layer !== "AssumptionTest") continue;

    const declared = proseDeclaredLane(node);
    if (declared) {
      // The span is where the `lane: <id>` fragment sits inside the sentence it
      // was cut from — the negation check needs a position, and the fragment is
      // the only part of the sentence the recommendation actually consumed.
      const at = declared.sentence.toLowerCase().indexOf(declared.quote.toLowerCase());
      out.push({
        surface: "prose-lane",
        subject: node.title,
        answer: `lane "${node.title}" --set ${declared.lane}`,
        source: {
          kind: "prose",
          quote: declared.sentence,
          span: at >= 0 ? { start: at, end: at + declared.quote.length } : undefined,
          alternatives: laneIds,
        },
      });
    }

    // Mirrors `cautionBacklog`: only unlabelled tests are hinted at, because a
    // human's existing lane call must never be quietly re-litigated.
    if (!node.lane) {
      const caution = suggestCaution(node);
      if (caution) {
        const at = caution.phrase ? caution.sentence.toLowerCase().indexOf(caution.phrase.toLowerCase()) : -1;
        out.push({
          surface: "caution-hint",
          subject: node.title,
          answer: `flag ${caution.lane}`,
          source: {
            kind: "prose",
            quote: caution.sentence,
            span: at >= 0 && caution.phrase ? { start: at, end: at + caution.phrase.length } : undefined,
          },
        });
      }
    }
  }

  const outcome = tree.find((n) => n.layer === "Outcome")?.title;
  for (const v of checkInvariants([...tree])) {
    if (v.rule in NOT_DONE_BLOCKING) continue;
    const title = v.node ?? outcome;
    if (!title) continue;
    out.push({
      surface: "hygiene-finding",
      subject: title,
      answer: `annotate: ${v.rule}`,
      source: { kind: "structural", derivation: `invariant ${v.rule} over the node graph — ${v.detail}` },
    });
  }
  for (const d of scanNearDuplicates(live)) {
    out.push({
      surface: "hygiene-finding",
      subject: d.title,
      answer: "annotate: near-duplicate",
      source: { kind: "structural", derivation: `token-set similarity over same-layer titles — ${d.issue}` },
    });
  }
  for (const d of scanExtentOverlap(live)) {
    out.push({
      surface: "hygiene-finding",
      subject: d.title,
      answer: `annotate: ${d.rule}`,
      source: { kind: "structural", derivation: `evidence-extent set arithmetic over siblings — ${d.issue}` },
    });
  }

  return out;
}

/** What one surface costs under the rule. */
export interface SurvivalCount {
  surface: RecommendationSurface;
  /** How many the surface renders today — the denominator. */
  total: number;
  /** How many still render under the rule. */
  rendered: number;
  /** How many are replaced by an ambiguity report. */
  suppressed: number;
  /**
   * Survivors over total, in [0, 1]. A surface with nothing on it is `1` — no
   * recommendation was lost, and reporting `0` there would fail a threshold on a
   * vault that simply has no work of that kind.
   */
  survival: number;
  /** Which clarity rule did the suppressing, so the cost can be attributed rather than guessed at. */
  byRule: Partial<Record<ClarityRule, number>>;
}

export interface SuppressionCensus {
  bySurface: Record<RecommendationSurface, SurvivalCount>;
  /** Every refusal, in tree order — what the surfaces would print instead. */
  refusals: Array<{ surface: RecommendationSurface; subject: string; report: AmbiguityReport }>;
}

/** Replay the rule over a set of recommendations and count what survives, per surface. */
export function censusRecommendations(recommendations: readonly Recommendation[]): SuppressionCensus {
  const bySurface = Object.fromEntries(
    RECOMMENDATION_SURFACES.map((s) => [s, { surface: s, total: 0, rendered: 0, suppressed: 0, survival: 1, byRule: {} }]),
  ) as Record<RecommendationSurface, SurvivalCount>;
  const refusals: SuppressionCensus["refusals"] = [];

  for (const rec of recommendations) {
    const count = bySurface[rec.surface];
    count.total += 1;
    const verdict = readSource(rec.source);
    if (verdict.reads === "cleanly") {
      count.rendered += 1;
      continue;
    }
    count.suppressed += 1;
    count.byRule[verdict.report.rule] = (count.byRule[verdict.report.rule] ?? 0) + 1;
    refusals.push({ surface: rec.surface, subject: rec.subject, report: verdict.report });
  }

  for (const s of RECOMMENDATION_SURFACES) {
    const c = bySurface[s];
    c.survival = c.total === 0 ? 1 : c.rendered / c.total;
  }
  return { bySurface, refusals };
}

/** The census over one tree, in one call — what the counter is for. */
export function censusOfTree(tree: readonly OstNode[]): SuppressionCensus {
  return censusRecommendations(recommendationsOf(tree));
}

/**
 * The census as a person reads it. Per surface, with the denominator on every
 * line: a survival rate whose total is not shown is the same untrustworthy number
 * this repository keeps finding in its own sweeps.
 */
export function formatSuppressionCensus(label: string, census: SuppressionCensus): string {
  const lines = [`${label} — recommendations surviving a refuse-when-unclear rule:`];
  for (const s of RECOMMENDATION_SURFACES) {
    const c = census.bySurface[s];
    const pct = c.total === 0 ? "—" : `${Math.round(c.survival * 1000) / 10}%`;
    const attribution = Object.entries(c.byRule)
      .sort((a, b) => b[1] - a[1])
      .map(([rule, n]) => `${rule} ${n}`)
      .join(", ");
    lines.push(
      `  ${s.padEnd(16)} ${String(c.rendered).padStart(5)}/${String(c.total).padEnd(5)} render (${pct})` +
        (attribution ? ` — suppressed by: ${attribution}` : c.total === 0 ? " — nothing on this surface" : ""),
    );
  }
  return lines.join("\n");
}
