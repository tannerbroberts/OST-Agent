/**
 * Unearned rungs — the believability label checked against what backs it.
 *
 * Two rungs on the ladder are claims about measurement rather than about
 * authorship: `observed` says a recording exists, `money` says behavior with a
 * cost attached happened. The shipped tool descriptions already say those two
 * cannot be conferred by a byline — "observed/money can only be earned by
 * first-party measurement (AssumptionTests + ost_set_evidence), never by a
 * byline" (`src/security/tools.ts`, `src/knowledge/web-trust.ts`). Until now that
 * was a sentence addressed to the model, in the place where the model is the
 * actor being constrained. This computes it.
 *
 * What backs a measurement rung:
 *
 * - a **recorded result** — the node's own `## Results`, or a node it links to
 *   with one ({@link hasRecordedResult}, reused rather than restated, so this
 *   tightens when B1 does). Licenses `observed` and `money` both.
 * - **provenance that is itself a recording** — `classifyProvenance` returning
 *   `observed`, i.e. `TRANSCRIPT:`. Licenses `observed` only. A source string can
 *   describe a measurement; it cannot be one with a price on it.
 *
 * Three scope limits, each a place this could have become a wedge:
 *
 * 1. **Only the two measurement rungs are held to it.** `stated` and `expert` are
 *    also claims a source has to earn, but deriving their ceiling from `source`
 *    is B3's wire and `expert`'s is B6's actor namespace; a detector that
 *    demanded both today would flag every hand-authored node in every existing
 *    vault, and a rule that fires on everything is a rule someone turns off.
 * 2. **Demotion is always free.** The violation clears by declaring a weaker
 *    rung, which both surfaces can do (`ost_set_evidence`, granted since R4/R7).
 *    The agent never needs a human to get out of this one.
 * 3. **It proves a result exists, not that the result is about money.** Reading
 *    result prose for a currency figure is a judgement, and this is the
 *    deterministic layer. Same floor-not-verdict stance as `evidence-debt.ts`:
 *    mechanical enough to be a build failure, and explicitly not the whole
 *    question.
 */
import { BELIEVABILITY_LADDER, classifyProvenance, rungRank, type RungId } from "../knowledge/believability.js";
import { byTitle } from "../processes/tree.js";
import type { OstNode } from "../ost/node.js";
import { hasRecordedResult } from "./evidence-debt.js";

/** The rungs that assert a measurement happened, strongest first. */
export const MEASUREMENT_RUNGS: readonly RungId[] = ["money", "observed"];

export interface UnearnedRung {
  /** The node making the claim. */
  node: string;
  /** The rung it declares. */
  declared: RungId;
  /** The strongest rung what it points at actually supports. */
  supported: RungId;
  /** What is missing, in the terms the reader can act on. */
  missing: string;
}

function isMeasurementRung(rung: string | undefined): rung is RungId {
  return !!rung && MEASUREMENT_RUNGS.includes(rung as RungId);
}

/**
 * Nodes whose declared rung is stronger than what backs it.
 *
 * A node "points at a result" through its own body or through one of its
 * `[[links]]` — one level, not the transitive closure. One level is what the
 * vault already means by a result for a node: `gateSolution` clears a Solution on
 * a test directly beneath it, and this reuses that relation rather than inventing
 * a second, deeper one that would let a grandchild's result launder a claim two
 * layers up.
 */
export function unearnedRungs(tree: readonly OstNode[]): UnearnedRung[] {
  const index = byTitle([...tree]);
  return tree.map((n) => unearnedRung(n, index)).filter((u): u is UnearnedRung => u !== null);
}

/**
 * One node's verdict — the ceiling, computed once, for both of its readers.
 *
 * Split out of the loop above so the WRITE boundary can ask the same question
 * the detector asks (B3) instead of deriving a second ceiling beside it. R4's
 * lesson at the moment a second caller appeared: two hand-written derivations of
 * one rule drift, and the drift is invisible until something rests on it.
 *
 * `index` need only resolve this node's own `links` — the walk is one level, so
 * a partial index is exact rather than an approximation. That is what lets the
 * write boundary avoid a whole-tree read on every label write.
 */
export function unearnedRung(n: OstNode, index: ReadonlyMap<string, OstNode>): UnearnedRung | null {
  if (!isMeasurementRung(n.evidence)) return null;

  const ownResult = hasRecordedResult(n);
  const childResult = n.links.map((t) => index.get(t)).find((c) => c && hasRecordedResult(c));
  const resultBacked = ownResult || !!childResult;
  const sourceRung = classifyProvenance(n.source ?? "");
  const sourceObserved = rungRank(sourceRung) <= rungRank("observed");

  if (n.evidence === "money" && !resultBacked) {
    return {
      node: n.title,
      declared: "money",
      supported: sourceObserved ? "observed" : sourceRung,
      missing:
        "'money' means behavior with a cost attached, which only a result can show — " +
        "record one (a `## Results` section on this node or on a test beneath it), " +
        "or declare the rung its sources have earned",
    };
  }

  if (n.evidence === "observed" && !resultBacked && !sourceObserved) {
    return {
      node: n.title,
      declared: "observed",
      supported: sourceRung,
      missing:
        "'observed' means a recording of what happened — cite provenance that is one " +
        `(source: TRANSCRIPT:…; this node's source is ${n.source ? `"${n.source}"` : "unset"}, ` +
        `which classifies as ${sourceRung}), record a result, or declare the weaker rung`,
    };
  }

  return null;
}

/**
 * The clause every rung refusal carries: the value that WOULD have been accepted.
 *
 * Both rung refusals on this surface already ended with a sentence like this —
 * `rungRefusal` for the measurement pair, `standingRefusal` for the channel
 * ceiling — written independently, four days apart, in the same words by
 * coincidence rather than by construction. That coincidence is not something to
 * rest a measurement on. {@link namedAcceptableRung} reads this clause back out
 * of a refusal so the reflex census can tell "the caller was told the answer"
 * from "the caller was told no", and a reword that broke the pairing would not
 * fail anything — the census would simply find nothing and report a clean sheet.
 * A false clean is the worst reading a census can produce, so the sentence and
 * its reader live here as one unit, and `test/telemetry/rung-suggestion-reflex.test.ts`
 * holds every refusal on the surface to the round trip.
 *
 * "or lower" is part of the suggestion rather than decoration: a caller told only
 * the ceiling learns one legal value, and a caller told the ceiling *and* that
 * everything under it is free learns the whole remaining choice — which is the
 * difference between informing a judgement and replacing it.
 */
export function acceptableRungClause(supported: RungId): string {
  return `declare '${supported}' or lower (demotion is never gated)`;
}

/**
 * The rung a refusal named as acceptable, or null when it named none.
 *
 * Case-insensitive on the verb alone, because the clause begins a sentence in one
 * refusal and continues one in the other. Nothing else about the wording is
 * matched loosely: a census that guessed at the shape of the sentence it reads
 * would drift out of agreement with the sentence that is written.
 */
export function namedAcceptableRung(message: string): RungId | null {
  const m = /\bdeclare '([a-z]+)' or lower\b/i.exec(message);
  if (!m) return null;
  const rung = m[1];
  return BELIEVABILITY_LADDER.some((r) => r.id === rung) ? (rung as RungId) : null;
}

/**
 * The same verdict, addressed to the caller being refused rather than to the
 * reader being informed (B3).
 *
 * It deliberately does NOT reuse `UnearnedRung.missing`. That sentence tells its
 * reader to "record one (a `## Results` section …)" — advice that is correct for
 * a human reading `ost_check` and is, at the write boundary, addressed to the one
 * actor forbidden to record a result, naming the forgery B1 closed as the remedy.
 * One module owns the ceiling and both of its renderings, so they cannot drift;
 * they are different sentences because they have different readers.
 */
export function rungRefusal(u: UnearnedRung): string {
  const ways =
    u.declared === "money"
      ? `${acceptableRungClause(u.supported)}, or have a human record a result — ` +
        `ost-agent result "<test>" -v <verdict> -n "<what happened>" -b "<who ran it>" -u "<what it did not cover>" — ` +
        `on this node or on a test one level beneath it`
      : `${acceptableRungClause(u.supported)}, have a human record a result, or cite ` +
        `provenance that IS a recording (source: TRANSCRIPT:…). Note that \`source\` is settable only at ` +
        `ost_create_node — on a node that already exists, the rung is the route`;
  return (
    `"${u.node}" cannot declare '${u.declared}': what it points at supports '${u.supported}'. ` +
    `The two measurement rungs assert that something was measured, and no byline confers them. ${ways}.`
  );
}
