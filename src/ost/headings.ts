/**
 * Reserved headings — the sections the agent may name but never author.
 *
 * A handful of `## Headings` are not prose. They are the inputs the evaluators
 * read as proof that something happened outside the tree: `## Results` says a
 * test was RUN, `## Uncovered` says a person wrote down what a run left out.
 * Every gate in the repo that clears a Solution, backs a measurement rung, or
 * counts coverage debt is reading one of them.
 *
 * "The agent may never run a test or record a result" (`ost/results.ts`) was
 * discipline until now: every free-text parameter on the tool surface reaches
 * `appendUnderHeading`, which splices the caller's string in as LINES, so a
 * newline and six characters turned a status note into a recorded result. Six
 * separate arguments could do it — `section`, `body`, the `note` on two tools,
 * `issue`, and `why` — which is why the guard cannot live on any one of them.
 *
 * The separation that makes this work is a property of the WRITER, not of the
 * string: `Vault.appendUnderSection` takes the heading as its own parameter and
 * runs the content guard on the LINE only. So the human path (`recordResult`,
 * CLI-only, off every allowlist) names a reserved heading in the argument
 * position no tool call can reach, while the agent's content is scanned for one.
 * The unsafe value is not refused case by case; there is no argument the agent
 * can put it in — the {@link ../security/tools.ts} `ost_flag_humans_required`
 * shape, transposed from a parameter onto a value.
 *
 * The set is data and it is short on purpose. A reserved heading costs the agent
 * a word it can no longer write, so the bar is that a gate reads it as a
 * measurement — not that it looks official.
 */

/** The heading a recorded result lives under — read by every evidence gate. */
export const RESULTS_HEADING = "## Results";

/** The heading a run's stated limits live under — read by the coverage debt count. */
export const UNCOVERED_HEADING = "## Uncovered";

/**
 * The heading an instrument's observed exit code lives under — read by the build
 * permit.
 *
 * Reserved on the same rule as the other two, and for a reason worth stating
 * plainly: a line here saying an instrument was observed RED is what tells the
 * build half of the loop to go and build something. An agent that could author
 * one could authorize its own build against a test nobody ever ran. So the line
 * is written only by `ost/instrument.ts`, from an exit code it watched a process
 * produce, through `appendUnderSection`'s unscanned heading argument — the same
 * asymmetry that keeps `## Results` a human's.
 *
 * Note what is NOT claimed by a line here: an observation is not a result. Red
 * says "this does not pass yet", which is a fact about the repository, not
 * evidence that the solution is worth building. `## Results` still answers that
 * question and is still a human's alone.
 */
export const INSTRUMENT_LOG_HEADING = "## Instrument Log";

/**
 * Headings only the human/CLI path may author.
 *
 * `## Results` is B1: `hasRecordedResult` clears `gateSolution`, backs a
 * measurement rung through `unearnedRungs`, and satisfies `checkCorroboration`.
 * `## Uncovered` is B10: `computeCoverageDebt` counts its entries against the
 * result count, so an agent that writes one silences the debt it created.
 * `## Instrument Log` is the build permit: a recorded RED observation is what
 * releases a solution to the build half of the loop, so authoring one is
 * authorizing a build.
 */
export const RESERVED_HEADINGS: readonly string[] = Object.freeze([
  RESULTS_HEADING,
  UNCOVERED_HEADING,
  INSTRUMENT_LOG_HEADING,
]);

/**
 * The closed set of words a `## Results` line may record.
 *
 * The vocabulary lives beside the heading rather than beside the CLI that writes it
 * because two modules read it from opposite ends — `ost/results.ts` validates a filing
 * on the way in, `knowledge/actor-trust.ts` reads a verdict back out to score the actor
 * the result is about — and this is the only file both can import without a cycle.
 * `results.ts` re-exports it, so the writer's spelling is unchanged.
 *
 * It is closed for the same reason `RESERVED_HEADINGS` is: a verdict that can be any
 * string is a verdict a source's standing cannot be computed from. `inconclusive` is a
 * member so that a run which settled nothing has somewhere to land other than silence.
 */
export const VERDICTS = ["supported", "refuted", "inconclusive"] as const;

export type Verdict = (typeof VERDICTS)[number];

/** `## Results` → `Results`. The constants carry the marker so call sites read as the heading they mean. */
function headingName(heading: string): string {
  return heading.replace(/^#+\s*/, "");
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `body` declare `heading`?
 *
 * This is the UNION of every matcher the readers already use, and it has to be,
 * or the guard is a sieve. The two live readers disagree today: `hasRecordedResult`
 * matches `/^##\s+Results\b/im` — case-insensitive, unanchored to the line start
 * after trimming, and happy with `## Results of the pilot` — while
 * `countEntriesUnder` does trim-equality against the literal, which sees
 * `  ## Results` and misses the trailing-words form. Measured, both directions
 * are reachable: `"  ## Results"` was invisible to the first and visible to the
 * second; `"## Results of the pilot"` the reverse.
 *
 * A guard that matched only one of them would leave the other's spelling open,
 * so this trims the line (taking the second reader's tolerance) and then applies
 * the first reader's word-boundary regex. `###`, `#`, `##Results` and
 * `## Resultsish` are excluded, which is what both readers already do.
 */
export function isHeadingLine(line: string, heading: string): boolean {
  return new RegExp(String.raw`^##\s+${escapeForPattern(headingName(heading))}\b`, "i").test(line.trim());
}

export function declaresHeading(body: string, heading: string): boolean {
  return body.split("\n").some((line) => isHeadingLine(line, heading));
}

/**
 * The first reserved heading `content` would introduce, or null.
 *
 * Every write the agent can reach passes its content through here. The check is
 * on the content a caller supplies, never on the heading a caller NAMES, because
 * naming one is the human path's argument position.
 */
export function reservedHeadingIn(content: string): string | null {
  for (const heading of RESERVED_HEADINGS) {
    if (declaresHeading(content, heading)) return heading;
  }
  return null;
}
