/**
 * Pass shape — did this pass move the tree, or talk about it?
 *
 * The loop's termination problem has never had an honest answer. A tree is
 * "done" only when evidence stops arriving, which for a live product is never, so
 * every attempt to make `done: true` reachable has been a way of making the
 * agent's own bookkeeping say the thing the world does not. The operator's actual
 * question was always cheaper than that: **is another pass worth the tokens.**
 *
 * This module answers the detection half of it, and only that half. It reads a
 * commit's *subject* — nothing else — and says whether that commit built
 * structure (a node, an edge, a declared field) or wrote commentary about
 * structure that already existed. {@link classifyPassShape} folds a pass's
 * commits into one verdict. Nothing here throttles anything, and that omission is
 * deliberate: see "What this does not decide" below.
 *
 * **Why the subject alone.** The signal was first read off a vault's git log by
 * hand — one run of the tetrix vault decayed visibly across two hours, thirty
 * `ost_create_node` calls at 14:37 giving way to four `ost_append_to_node` calls
 * at 16:44 and two `ost_annotate` calls on the root at 16:45, the second a
 * 400-word essay. The transition was legible from the subject lines with no
 * semantic analysis, no judge model and no new instrumentation, and that cheapness
 * is the whole reason idle-down is buildable at all. A classifier that had to read
 * diffs would be a second instrument to install and keep correct.
 *
 * **What the corpus says about that.** `test/loop/pass-shape-classifier.test.ts`
 * measures this rule against 2,950 commits of the OST-Agent meta vault, labelled
 * from their *diffs* — the expensive signal the cheap one is supposed to stand in
 * for. Agreement is 91.1%, against a bar of 90% pre-committed before the corpus
 * was cut. Two things about that number are worth carrying:
 *
 *   - **The margin is one tool.** `ost_append_to_node` is 617 of the 2,950
 *     commits and its subject is silent about whether the append carried a
 *     wikilink; 199 of them moved an edge and 418 did not, and no subject-only
 *     rule can separate those. The best any rule reading only subjects could do
 *     on this corpus is 91.80%, so the rule is within 0.7 points of everything
 *     its input can support and the remaining error is not a tuning problem —
 *     it is 199 commits that look identical from outside and are not.
 *   - **Coherence matters more than the cut.** {@link STRUCTURE_CALLS} counts
 *     `ost_set_instrument` and `ost_set_evidence` as structure. A stricter
 *     reading — only nodes, links and `status:` — is equally defensible and
 *     scores 91.97% *once the rule is re-cut to match it*. Mixing the two
 *     readings costs six points. Whoever builds the throttle may pick either
 *     definition of "the tree moved"; what they may not do is let the classifier
 *     and the thing it is judged against disagree about it.
 *
 * **What this does not decide.** Detection is not value. The solution this serves
 * names its own counter-example: the most useful artefact of the tetrix run was a
 * builder briefing, it was commentary-only, and it was the last commit of the run
 * — a classifier at 100% agreement would still have throttled immediately after
 * the best thing the agent did. So the honest rule for spend is not "commentary is
 * worthless" but something nearer "commentary that repeats the previous pass's
 * commentary is worthless", which needs a pass compared against its own last
 * output and is not built here. This module reports a shape. Deciding what to do
 * with a run of them is a judgement about value, and nothing in this file or in
 * the corpus behind it licenses making it automatically.
 */

/** What a commit, or a whole pass, did to the tree. */
export type PassShape = "structure" | "commentary";

/**
 * Tool calls that move the tree, by the name that lands in the commit subject.
 *
 * The assumption under test defines structure as "new nodes/links/status", and
 * each of these changes one of the three: a node (`create`), an edge (`merge`,
 * `detach`, and `create`'s parent link), or a declared field that governs how the
 * tree reads (`status`, `instrument`, `evidence`).
 *
 * The last two are the arguable members and are included on purpose. An
 * `instrument:` is what makes an assumption test runnable — before it the test is
 * a sentence, after it the test can come out red — and an `evidence:` rung is what
 * makes a node believable rather than merely present. Both change what the tree
 * claims without adding to it. `test/fixtures/pass-shape/PROVENANCE.md` records
 * what excluding them does to the measured agreement, and the answer is: nothing,
 * provided the labels are re-cut the same way.
 */
export const STRUCTURE_CALLS: readonly string[] = [
  "ost_create_node",
  "ost_set_status",
  "ost_set_instrument",
  "ost_set_evidence",
  "ost_merge_nodes",
  "ost_detach_nodes",
];

/**
 * Tool calls that write about the tree without moving it.
 *
 * `ost_edit_node` sits here rather than with the structural calls, which reads
 * wrong until you look at what it does: it rewrites a node's body in place. On the
 * corpus 16 of its 19 commits changed no node, no edge and no field. `ost_append_to_node`
 * and `ost_annotate` are the two the original hand-reading named. `ost_ingest_inbox`
 * writes evidence records under `.ost-agent/`, which are input to the tree rather
 * than part of it — and the solution this serves already treats new inbox evidence
 * as a *reset* signal, separately from pass shape, so counting ingest as structure
 * here would double-count it.
 *
 * Listed rather than inferred from the absence of {@link STRUCTURE_CALLS} so that
 * a tool added to the MCP surface and to neither list is visible as unhandled
 * instead of silently commentary.
 */
export const COMMENTARY_CALLS: readonly string[] = [
  "ost_append_to_node",
  "ost_annotate",
  "ost_edit_node",
  "ost_ingest_inbox",
];

/**
 * The tool name a `mcp:` commit subject carries, if it is one.
 *
 * The loop writes these subjects itself (`mcp: <tool> — <what it did>`), so the
 * shape is a contract with this repository rather than a guess about git. A
 * subject from any other writer — a human, a `chore(instruments)` run, a merge —
 * returns undefined and falls to the default in {@link classifyCommitShape}.
 */
export function toolFromSubject(subject: string): string | undefined {
  return /^mcp:\s+(ost_[a-z_]+)\b/.exec(subject)?.[1];
}

/**
 * Classify one commit from its subject line.
 *
 * **Unrecognised subjects are commentary**, and that default is the one place
 * this rule trades safety for accuracy, so it is worth being explicit about which
 * way. Reading structure as commentary is the dangerous error — it is the one
 * that idles a tree that is still learning — and the conservative default would
 * therefore be `structure`. It is not the default because the unrecognised class
 * is not the small residue it sounds like: on the corpus it is 581 of 2,950
 * commits, 541 of them genuinely commentary. Most are `chore(instruments)` runs
 * appending a result line to an instrument log (409), the rest merge commits,
 * ingest-phase reports and narrative pass write-ups. Defaulting to `structure`
 * costs 17 points and takes the rule to 74.14%, nowhere near its bar.
 *
 * That trade is only tolerable because of what consumes this: a *pass*, not a
 * commit ({@link classifyPassShape}), where one structural commit is enough to
 * call the whole pass structural. A misread hand-written commit inside a pass that
 * also created a node changes nothing. The exposure is a pass whose only tree
 * movement arrived in a subject this function has never seen, which is a real
 * hole and is why {@link toolFromSubject} returning undefined is worth logging at
 * the call site rather than swallowing.
 */
export function classifyCommitShape(subject: string): PassShape {
  const tool = toolFromSubject(subject);
  if (tool === undefined) return "commentary";
  return STRUCTURE_CALLS.includes(tool) ? "structure" : "commentary";
}

/** What a pass was made of, kept so a caller can see the vote as well as the verdict. */
export interface PassShapeAssessment {
  shape: PassShape;
  /** Commits read as structural. */
  structure: number;
  /** Commits read as commentary. */
  commentary: number;
  /** Commits whose subject matched no known tool — see {@link classifyCommitShape}. */
  unrecognised: number;
}

/**
 * Fold a pass's commits into one shape.
 *
 * **Any structure makes the pass structural**, rather than a majority vote, and
 * the asymmetry is the point. A pass that created one node and then wrote nine
 * appends about it has moved the tree; a majority rule would call that pass
 * commentary and, run twice, would back the schedule off while the agent was
 * still building. The failure this whole line of work exists to avoid is paying
 * after learning stopped, and the failure it must not introduce is stopping while
 * learning continues — so the fold is biased against the second.
 *
 * A pass with no commits at all is commentary: it spent its schedule and produced
 * nothing, which is the strongest form of the signal rather than an absence of it.
 */
export function classifyPassShape(subjects: readonly string[]): PassShapeAssessment {
  let structure = 0;
  let commentary = 0;
  let unrecognised = 0;
  for (const subject of subjects) {
    if (toolFromSubject(subject) === undefined) unrecognised++;
    if (classifyCommitShape(subject) === "structure") structure++;
    else commentary++;
  }
  return {
    shape: structure > 0 ? "structure" : "commentary",
    structure,
    commentary,
    unrecognised,
  };
}

/**
 * Agreement between this rule and a set of labels cut some other way.
 *
 * Exists in `src/` rather than in the test because the number is the assumption
 * test's whole result, and a measurement that lives only inside its own assertion
 * cannot be re-run against a different corpus by anyone who doubts it.
 */
export function agreementRate(
  cases: readonly { subject: string; label: PassShape }[],
): { agreed: number; total: number; rate: number } {
  const agreed = cases.filter((c) => classifyCommitShape(c.subject) === c.label).length;
  return {
    agreed,
    total: cases.length,
    rate: cases.length === 0 ? 0 : agreed / cases.length,
  };
}
