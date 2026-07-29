/**
 * The corroboration a promotion has to name. (V1 readiness, B4.)
 *
 * `ost_rank_source` has always *told* the agent to "name those results in
 * `reason`", and `rankHost` has always checked that `reason` is non-empty.
 * Between those two facts sat the whole of DEC-2's cause-and-effect: a promotion
 * is supposed to be EARNED by a first-party result, and the only thing standing
 * between "earned" and "asserted" was a sentence in a tool description.
 * `reason: 'looks solid'` promoted a host to `expert`, and from then on every
 * page read from that host entered the ladder a rung higher (`hostRung`), and
 * every node citing it inherited the lift.
 *
 * So the reason must RESOLVE: it names nodes as `[[wikilinks]]`, at least one of
 * them is on the tree, and that one has recorded an outcome.
 *
 * Three deliberate limits, each the difference between a guard and a wedge:
 *
 * - **Only promotions are held to it.** Demotion back to the floor stays free.
 *   A channel that keeps delivering plausible, wrong content is the expensive
 *   failure (B11), and a guard that demanded paperwork before the agent could
 *   stop trusting a bad host would be a wedge pointed at the safe direction.
 *   B4's claim is about a *promotion*; this enforces exactly that and no more.
 *
 * - **"Has an outcome" is `hasRecordedResult`, not a second opinion.** Reusing
 *   the definition already in the repo means that when B1 stops the agent from
 *   writing `## Results` on its own authority, this guard tightens with it and
 *   there is no second rule to find and update. That the definition is forgeable
 *   *today* is B1's criterion, not this one's: B4 closes the path where a
 *   promotion cites nothing at all. Writing a parallel "has a result" check here
 *   is the drift R4 was spent removing.
 *
 * - **An unrecognized rung is not this function's refusal to make.** `rankHost`
 *   already names the ceiling and why it exists; answering that call with a
 *   complaint about wikilinks would report the second-most-interesting thing
 *   wrong with it.
 */
import type { OstNode } from "../ost/node.js";
import { titlesMatch } from "../ost/sanitize.js";
import { FLOOR_RUNG } from "../knowledge/believability.js";
import { isHostRung } from "../knowledge/web-trust.js";
import { hasRecordedResult } from "./evidence-debt.js";

export interface CorroborationVerdict {
  ok: boolean;
  /** Why it was refused, naming what to go do about it. Absent when `ok`. */
  refusal?: string;
}

/**
 * Every `[[target]]` named in a piece of prose, in order, blanks dropped.
 *
 * `[^[\]]` inside the brackets stops an unclosed `[[` from swallowing the rest
 * of the reason and reporting one enormous phantom title — the same guard, and
 * for the same reason, as `wrappedLinkTargets` in `ost/node.ts`. That function
 * is not reused because it deliberately returns only the *wrapped* subset.
 */
export function namedNodes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[([^[\]]*)\]\]/g)) {
    const t = m[1].replace(/\s*\n\s*/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * May this host trust change be recorded? Pure — the caller does the throwing.
 *
 * Passing means: this is not a promotion, or it is one and some node it names
 * exists on the tree with a recorded outcome. One corroborating result is
 * enough; naming a second that has not run yet is a plan, not a defect.
 */
export function checkCorroboration(
  tree: readonly OstNode[],
  input: { rung: string; reason: string },
): CorroborationVerdict {
  if (!isHostRung(input.rung) || input.rung === FLOOR_RUNG) return { ok: true };

  const named = namedNodes(input.reason);
  if (named.length === 0) {
    return {
      ok: false,
      refusal:
        `a promotion to "${input.rung}" has to name the first-party result that earned it, as a [[wikilink]] — ` +
        `"${input.reason.trim()}" names none. Run an assumption test that corroborates the claim, record its ` +
        `result, then cite that test by title.`,
    };
  }

  const resolved = named.map((title) => ({ title, node: tree.find((n) => titlesMatch(n.title, title)) }));
  if (resolved.some((r) => r.node && hasRecordedResult(r.node))) return { ok: true };

  const quoted = (titles: readonly string[]) => titles.map((t) => `"${t}"`).join(", ");
  const missing = resolved.filter((r) => !r.node).map((r) => r.title);
  const resultless = resolved.filter((r) => r.node && !hasRecordedResult(r.node)).map((r) => r.title);

  const faults: string[] = [];
  if (missing.length) faults.push(`${quoted(missing)} ${missing.length === 1 ? "is" : "are"} not on the tree`);
  if (resultless.length) {
    faults.push(`${quoted(resultless)} recorded no outcome`);
  }
  return {
    ok: false,
    refusal:
      `a promotion to "${input.rung}" needs a corroborating result that exists and has an outcome — ` +
      `${faults.join("; and ")}. A promotion is earned by a result, not by naming one.`,
  };
}
