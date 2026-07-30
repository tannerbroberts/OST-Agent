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
import { classifyProvenance, rungRank, type RungId } from "../knowledge/believability.js";
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
  const found: UnearnedRung[] = [];

  for (const n of tree) {
    if (!isMeasurementRung(n.evidence)) continue;

    const ownResult = hasRecordedResult(n);
    const childResult = n.links.map((t) => index.get(t)).find((c) => c && hasRecordedResult(c));
    const resultBacked = ownResult || !!childResult;
    const sourceRung = classifyProvenance(n.source ?? "");
    const sourceObserved = rungRank(sourceRung) <= rungRank("observed");

    if (n.evidence === "money" && !resultBacked) {
      found.push({
        node: n.title,
        declared: "money",
        supported: sourceObserved ? "observed" : sourceRung,
        missing:
          "'money' means behavior with a cost attached, which only a result can show — " +
          "record one (a `## Results` section on this node or on a test beneath it), " +
          "or declare the rung its sources have earned",
      });
      continue;
    }

    if (n.evidence === "observed" && !resultBacked && !sourceObserved) {
      found.push({
        node: n.title,
        declared: "observed",
        supported: sourceRung,
        missing:
          "'observed' means a recording of what happened — cite provenance that is one " +
          `(source: TRANSCRIPT:…; this node's source is ${n.source ? `"${n.source}"` : "unset"}, ` +
          `which classifies as ${sourceRung}), record a result, or declare the weaker rung`,
      });
    }
  }

  return found;
}
