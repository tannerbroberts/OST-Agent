/**
 * The adversarial grounding judge — a pass whose only job is to attack.
 *
 * Every other evaluator here makes existing provenance legible; this one goes
 * looking for provenance that SHOULD exist and doesn't. For each node whose
 * claim outruns what backs it, it states the strongest case the node is wrong,
 * names what is missing, and names the evidence that would settle the question.
 *
 * Two invariants define it, and they are what
 * `test/eval/adversarial-critic-invariants.test.ts` pins:
 *
 * 1. **A critic pass creates no nodes and removes nothing.** Its whole write
 *    surface is {@link applyCritic}, which reaches the vault only through
 *    `Vault.annotate` — add-only, under `## Issues`. There is no channel through
 *    which it could author an opportunity or retire a claim, so an over-eager
 *    critic can waste attention but never rewrite the tree.
 * 2. **Every objection names the evidence that would settle it.** Enforced at
 *    construction: {@link objection} refuses to build one without a non-empty
 *    `settledBy`. A complaint with no way to be answered is not criticism, it is
 *    noise — and noise is the failure mode the solution node itself names.
 *
 * What it deliberately does NOT attack: honesty. A node resting on `assertion`
 * and saying so has claimed nothing an attack can contradict — flagging it
 * would fire on nearly every node in every hand-grown vault, and a rule that
 * fires on everything is a rule someone turns off (the same scope argument
 * `rungs.ts` makes for leaving `stated`/`expert` alone). So every rule here is
 * a CONTRADICTION between a claim and its backing, and a tree that claims only
 * what it can back draws zero objections. Flood control is structural too: at
 * most one objection per node, the strongest charge that fires.
 *
 * Floor, not verdict, same stance as `evidence-debt.ts`: this is the
 * deterministic half. Whether an objection is worth acting on is the
 * humans-required half of the assumption test, and nothing here grades it.
 */
import type { OstNode } from "../ost/node.js";
import type { Vault } from "../ost/vault.js";
import { declaresHeading, entriesUnder, RESULTS_HEADING } from "../ost/headings.js";
import { byTitle } from "../processes/tree.js";
import { classifyProvenance } from "../knowledge/believability.js";
import { hasRecordedResult } from "./evidence-debt.js";
import { thresholdKindOf } from "./coverage.js";
import { unearnedRung } from "./rungs.js";

/** The charges, strongest first — the order {@link criticPass} tries them in. */
export const CRITIC_RULES = [
  "validated-on-nothing",
  "unearned-rung",
  "borrowed-voice",
  "graded-after-the-fact",
] as const;

export type CriticRule = (typeof CRITIC_RULES)[number];

export interface Objection {
  /** The node under attack. */
  readonly node: string;
  readonly rule: CriticRule;
  /** The strongest case that the node is wrong. */
  readonly charge: string;
  /** The provenance that should exist and doesn't. */
  readonly missing: string;
  /** The evidence that would settle it. Never empty — see {@link objection}. */
  readonly settledBy: string;
}

/** One line, however the rule wrote it: annotations and reports read entry-per-line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The only way an {@link Objection} comes into being.
 *
 * Refusing an empty `settledBy` here rather than in a downstream check is what
 * makes the invariant hold for rules that do not exist yet: a future charge
 * cannot forget to name its evidence, because forgetting throws before the
 * objection is a value anything could emit.
 */
export function objection(node: string, rule: CriticRule, charge: string, missing: string, settledBy: string): Objection {
  for (const [field, value] of [["charge", charge], ["missing", missing], ["settledBy", settledBy]] as const) {
    if (!value.trim()) {
      throw new Error(
        `refusing to raise an objection against "${node}" with an empty ${field}: an objection that does not ` +
          `name what is wrong and the evidence that would settle it is noise, and noise is what turns a critic off.`,
      );
    }
  }
  return { node, rule, charge: oneLine(charge), missing: oneLine(missing), settledBy: oneLine(settledBy) };
}

export interface CriticReport {
  /** Sweep discipline: what the pass was offered and what it examined. */
  readonly subject: { readonly offered: number; readonly read: number };
  readonly objections: readonly Objection[];
  readonly byRule: Readonly<Record<CriticRule, number>>;
}

/**
 * A result on the node itself, or on something one level beneath it — the same
 * one-hop relation `rungs.ts` reads.
 *
 * The node's OWN backing must be a `## Results` section, not
 * {@link hasRecordedResult}: that predicate reads `status: validated` as a
 * result, which is the right floor for a test but circular for the charge that
 * asks what a validated status rests on. A CHILD's validated status still
 * counts — for a test one level down, validated is the human's recording.
 */
function resultBacked(n: OstNode, index: ReadonlyMap<string, OstNode>): boolean {
  if (declaresHeading(n.body, RESULTS_HEADING)) return true;
  return n.links.some((t) => {
    const child = index.get(t);
    return !!child && hasRecordedResult(child);
  });
}

/**
 * `status: validated` (or shipped) with no recorded result on the node or one
 * level beneath it. Promotion writes WHY into History, but that is testimony;
 * the gates read results, and a promoted node none backs is the exact shape a
 * well-labelled, entirely wrong branch takes.
 *
 * Outcomes are exempt — the mandate is the human's to declare, not to prove.
 * AssumptionTests are exempt too, because for a test `validated` IS the
 * recorded-result equivalent (`hasRecordedResult` says so), so the charge
 * cannot be true of one.
 */
function validatedOnNothing(n: OstNode, index: ReadonlyMap<string, OstNode>): Objection | null {
  if (n.layer === "Outcome" || n.layer === "AssumptionTest") return null;
  if (n.status !== "validated" && n.status !== "shipped") return null;
  if (resultBacked(n, index)) return null;
  return objection(
    n.title,
    "validated-on-nothing",
    n.status === "shipped"
      ? `status 'shipped' says the build went out, and nothing recorded says it did what the node promised`
      : `status 'validated' says a human was convinced, and nothing recorded shows what convinced them`,
    "a recorded result on this node or on a test one level beneath it",
    "a result recorded via `ost-agent result` on a test beneath this node — or the status this node has actually earned",
  );
}

/** `observed`/`money` with nothing measured — `rungs.ts` computes it; this states it as a charge. */
function unearnedMeasurement(n: OstNode, index: ReadonlyMap<string, OstNode>): Objection | null {
  const u = unearnedRung(n, index);
  if (!u) return null;
  return objection(
    n.title,
    "unearned-rung",
    `declares '${u.declared}' — a claim that something was measured — but what it points at supports '${u.supported}'`,
    u.missing,
    "a recorded result on this node or on a test one level beneath it, or the weaker rung its sources have earned",
  );
}

/**
 * `stated`/`expert` is an outside party's voice, and this node's provenance
 * names no outside party: its source classifies to the assertion floor and no
 * recorded result stands in for one. The rung the node wears says someone else
 * said this; nothing on the node says who.
 */
function borrowedVoice(n: OstNode, index: ReadonlyMap<string, OstNode>): Objection | null {
  if (n.evidence !== "stated" && n.evidence !== "expert") return null;
  if (classifyProvenance(n.source ?? "") !== "assertion") return null;
  if (resultBacked(n, index)) return null;
  return objection(
    n.title,
    "borrowed-voice",
    `declares '${n.evidence}' — an outside party's voice — and its provenance names no outside party ` +
      `(source is ${n.source ? `"${n.source}"` : "unset"}, which classifies as assertion)`,
    "provenance that names the party the rung borrows its weight from",
    "a source that IS the party's own trace (INTERVIEW:…, SLACK:…, TRANSCRIPT:…), a recorded result, or the 'assertion' rung this actually rests on",
  );
}

/**
 * A test that recorded a result without ever fixing a bar. Whatever the run
 * produced, nothing written before it says what would have counted as failure —
 * so the verdict graded itself.
 */
function gradedAfterTheFact(n: OstNode): Objection | null {
  if (n.layer !== "AssumptionTest") return null;
  if (!hasRecordedResult(n)) return null;
  const kind = thresholdKindOf(n);
  if (kind !== "absent" && kind !== "instruction") return null;
  return objection(
    n.title,
    "graded-after-the-fact",
    `records a result, and no bar was fixed before the run (threshold reads '${kind}') — this verdict could not have come out a failure`,
    "a pre-committed threshold the result can be read against",
    "a bar fixed before the next run — the `threshold:` field or a bold pre-commitment lead-in, written down first",
  );
}

/**
 * Attack the whole tree: at most one objection per node, strongest charge first.
 *
 * Pure over the tree it is handed — reads nothing, writes nothing. The subject
 * counts are the sweep lesson (`ost/sweep.ts`): zero objections over zero nodes
 * is a pass that looked at nothing, and the report says so rather than reading
 * as clean.
 */
export function criticPass(tree: readonly OstNode[]): CriticReport {
  const index = byTitle([...tree]);
  const objections: Objection[] = [];
  for (const n of tree) {
    const hit =
      validatedOnNothing(n, index) ?? unearnedMeasurement(n, index) ?? borrowedVoice(n, index) ?? gradedAfterTheFact(n);
    if (hit) objections.push(hit);
  }
  const byRule = Object.fromEntries(CRITIC_RULES.map((r) => [r, objections.filter((o) => o.rule === r).length])) as Record<
    CriticRule,
    number
  >;
  return { subject: { offered: tree.length, read: tree.length }, objections, byRule };
}

/** The annotation line an objection becomes — one string, so the writer and the idempotence check cannot drift. */
export function annotationFor(o: Objection): string {
  return `critic (${o.rule}): ${o.charge}. Missing: ${o.missing}. Settled by: ${o.settledBy}`;
}

export interface AppliedCritic {
  /** Nodes that received a new `## Issues` entry this apply. */
  readonly annotated: string[];
  /** Objections whose annotation was already on the node — nothing written. */
  readonly alreadyRaised: string[];
}

/**
 * Write each objection under its node's `## Issues` — the critic's ONLY write.
 *
 * Everything it can do to the vault is `Vault.annotate`, which is add-only, so
 * "creates no nodes and removes nothing" is a property of the surface rather
 * than of this function's good behaviour. Idempotent by text: an objection whose
 * annotation is already on the node is skipped, so a standing critic in the
 * maintenance loop raises each charge once instead of once per pass — the flood
 * the solution node warns about, kept out of the tree structurally.
 */
export function applyCritic(vault: Vault, report: CriticReport): AppliedCritic {
  const annotated: string[] = [];
  const alreadyRaised: string[] = [];
  for (const o of report.objections) {
    const line = annotationFor(o);
    const existing = entriesUnder(vault.read(o.node).body, "## Issues");
    if (existing.some((e) => e.includes(line))) {
      alreadyRaised.push(o.node);
      continue;
    }
    vault.annotate(o.node, line);
    annotated.push(o.node);
  }
  return { annotated, alreadyRaised };
}

/** The report as an operator reads it — denominator first, then every objection in full. No silent caps. */
export function renderCritic(report: CriticReport): string {
  const { offered, read } = report.subject;
  if (read === 0) {
    return `critic: BLIND — read 0 of ${offered} node(s), so this pass objected to nothing because it saw nothing.`;
  }
  const lines: string[] = [];
  lines.push(`critic: ${report.objections.length} objection(s) over ${read} of ${offered} node(s).`);
  if (report.objections.length === 0) {
    lines.push(`  Every claim this pass knows how to attack is backed — or honestly floored, which it does not attack.`);
    return lines.join("\n");
  }
  const counts = CRITIC_RULES.filter((r) => report.byRule[r] > 0)
    .map((r) => `${r} ${report.byRule[r]}`)
    .join(", ");
  lines.push(`  by charge: ${counts}`);
  for (const o of report.objections) {
    lines.push(`\n- "${o.node}" — ${o.charge}`);
    lines.push(`    missing: ${o.missing}`);
    lines.push(`    settled by: ${o.settledBy}`);
  }
  return lines.join("\n");
}
