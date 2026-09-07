/**
 * Running the compute-only lane, and drafting what it found.
 *
 * This is the clause `src/ost/lanes.ts` shipped the vocabulary for and then
 * deliberately left unbuilt for two releases: *the ambient agent runs the
 * compute-only lane unprompted*. The lane model said which tests cost nobody
 * anything; nothing went and ran them.
 *
 * **The proposer/disposer boundary is the whole design, and it is drawn between
 * running and recording.** Compute may run a test whose inputs are already on
 * disk and may write out what the run said — that is an observation, and nobody's
 * judgement is in it. Compute may not decide the test was answered. So this
 * module returns *drafts*: a proposed verdict, the observation it came from
 * quoted inline, and the exact `ost-agent result` line a human would run to
 * record it. It writes nothing, anywhere, ever. `ost-agent result` stays CLI-only
 * and human-only, and a draft is a sentence, not a permit.
 *
 * Three refusals, each closing a way a runner like this fabricates evidence:
 *
 * 1. **Only `compute-only` is run**, via {@link runnableByCompute}'s fail-closed
 *    rule — an unclassified test, a lane a future version invents, a typo, all
 *    answer no. Nothing here re-decides that; a lane is a human's call and this
 *    module has no way to express one.
 * 2. **A test whose frontmatter lane contradicts its own prose is declined**,
 *    not run. `lanes.ts` already reports that contradiction and names this exact
 *    direction as the expensive one — "an unattended pass may run this one, the
 *    label is what compute obeys". This is the pass declining to be that hazard.
 *    The contradiction is not resolved here either; it is left for the human who
 *    can fix the sentence.
 * 3. **A run that measured nothing drafts no verdict.** `no-spec` and
 *    `unavailable` exit non-zero and mean the spec was never collected or the box
 *    could not answer. Folding either into `refuted` would let a missing file
 *    kill a solution, so they come out as undecided entries with no pre-filled
 *    line at all.
 *
 * **Why a red drafts `refuted`, stated because the alternative is the failure the
 * assumption test behind this module was written to detect.** That test warns
 * that a runner emitting nothing but confident supported-verdicts would satisfy
 * its instrument while being pure decoration — "zero kills means compute-only
 * tests only ever confirm". A verdict derived from the observation rather than
 * from a disposition makes a kill reachable by the same mechanism that makes a
 * confirmation reachable, which is the only honest way to make one possible.
 *
 * **What a draft can never carry, and says so in its own `--uncovered`.** An
 * instrument observes an exit code. A test's `threshold` is what it committed to,
 * and no exit code sees it. Every draft therefore pre-fills the limit as well as
 * the verdict, quoting the test's own bar — so a draft recorded unchanged still
 * lands in the tree carrying the gap between what ran and what was promised.
 */
import { VERDICTS, type Verdict } from "../ost/headings.js";
import { nodeInstrument, runInstrument, type Observation, type SpawnRunner } from "../ost/instrument.js";
import { laneConflicts, runnableByCompute } from "../ost/lanes.js";
import type { OstNode } from "../ost/node.js";
import type { ParsedInstrument } from "../knowledge/instruments.js";

/**
 * How an observation reads as a proposed verdict.
 *
 * Only the two observations that measured something map to anything. `no-spec`
 * and `unavailable` are deliberately absent rather than mapped to
 * `inconclusive`: an inconclusive result is a finding about the world, and
 * "nobody wrote the spec" is a finding about the repository.
 */
const VERDICT_OF: Partial<Record<Observation, Verdict>> = {
  green: "supported",
  red: "refuted",
};

/** One test the runner ran, and the verdict it is proposing to a human. */
export interface VerdictDraft {
  test: string;
  /** The command that was run, so the draft can be reproduced by hand. */
  command: string;
  observation: Observation;
  /**
   * The proposed verdict, or absent when the run measured nothing. Absent is
   * the honest state and is never rendered as a recordable line.
   */
  verdict?: Verdict;
  /** The observation, quoted — what a reader checks the proposal against. */
  evidence: string;
  /** What the run does NOT cover, pre-filled from the test's own threshold. */
  uncovered: string;
  /**
   * The exact `ost-agent result` line that records this draft, with `--by` left
   * as a placeholder because attribution is the one field compute must not
   * supply. Absent whenever {@link verdict} is.
   */
  resultCommand?: string;
  /** Why no verdict was drafted. Present exactly when {@link verdict} is absent. */
  undecided?: string;
}

/** A compute-only test the runner refused to run, and what it wants instead. */
export interface DeclinedTest {
  test: string;
  why: string;
}

/** What one pass over the compute-only lane produced. */
export interface ComputeLaneRun {
  drafts: VerdictDraft[];
  declined: DeclinedTest[];
  /** Drafts carrying a verdict — the ones a human could record. */
  decisive: number;
  /** Of those, the refutations. Zero kills is the decoration signal. */
  kills: number;
}

export interface ComputeLaneOptions {
  /** The repository the instruments are measured against. */
  repo: string;
  /**
   * How a command is executed. Injected by specs so the lane can be run against
   * recorded output without a process; production leaves it unset and gets the
   * real `npx` spawn.
   */
  spawn?: SpawnRunner;
}

/**
 * Run the compute-only lane over a tree the caller already read. Records nothing.
 *
 * **Takes a tree rather than a vault directory on purpose.** `Vault.readTree` is
 * the one door that turns a file into a node, and the set of modules that walk
 * through it is enumerated and capped at twelve by
 * `test/ost/retraction-consumers.test.ts` — every reader has to honour a
 * retraction, so every reader has to be argued for. A thirteenth would have been
 * this module needing an argument it does not have: it has no opinion about which
 * nodes exist, only about which of the ones handed to it may be run. So the read
 * stays with the caller, which is already a reader.
 */
export function draftComputeLane(tree: readonly OstNode[], options: ComputeLaneOptions): ComputeLaneRun {
  const conflicted = new Map(laneConflicts(tree).map((c) => [c.test, c]));
  const drafts: VerdictDraft[] = [];
  const declined: DeclinedTest[] = [];

  for (const test of runnableByCompute(tree)) {
    const conflict = conflicted.get(test.title);
    if (conflict) {
      declined.push({
        test: test.title,
        why:
          `labelled ${conflict.labelled} but its own text says "${conflict.quote}" — the label is what compute obeys, ` +
          `so running it would be an unattended pass acting on the reading the node itself disputes. ` +
          `Full sentence: "${conflict.sentence}". A human settles which is stale.`,
      });
      continue;
    }

    const instrument = nodeInstrument(test);
    if (!instrument) {
      declined.push({
        test: test.title,
        why:
          "declares no runnable instrument, so there is nothing for compute to execute against existing data. " +
          "The lane says it costs nobody anything; without a command that is a claim rather than a run.",
      });
      continue;
    }

    drafts.push(draftFor(test, instrument, options));
  }

  return {
    drafts,
    declined,
    decisive: drafts.filter((d) => d.verdict).length,
    kills: drafts.filter((d) => d.verdict === "refuted").length,
  };
}

function draftFor(test: OstNode, instrument: ParsedInstrument, options: ComputeLaneOptions): VerdictDraft {
  const run = runInstrument(instrument, options.repo, { spawn: options.spawn });
  const evidence = `${run.observation} (exit ${run.exitCode ?? "none"}) \`${instrument.command}\` — ${run.excerpt}`;
  const uncovered = uncoveredBy(test, instrument);
  const verdict = VERDICT_OF[run.observation];

  if (!verdict) {
    return {
      test: test.title,
      command: instrument.command,
      observation: run.observation,
      evidence,
      uncovered,
      undecided:
        run.observation === "no-spec"
          ? `nothing was measured — ${instrument.target} collected no test case, so the non-zero exit is a fact about a missing file rather than about the assumption. Write the spec; there is no verdict to draft.`
          : "nothing was measured — the box could not produce a run, so the non-zero exit says nothing whatever about this repository. Fix the environment and run the lane again.",
    };
  }

  const note =
    `compute-lane run of \`${instrument.command}\` against the repository observed ${run.observation} ` +
    `(exit ${run.exitCode ?? "none"}): ${run.excerpt}`;
  return {
    test: test.title,
    command: instrument.command,
    observation: run.observation,
    verdict,
    evidence,
    uncovered,
    resultCommand: resultCommand(test.title, verdict, note, uncovered),
  };
}

/**
 * What the run left untested, in the shape `ost-agent result --uncovered` wants.
 *
 * Two cases, and the second is the more useful one to read. A test with a
 * threshold gets its own bar quoted back beside the observation that did not
 * measure it. A test with no threshold gets told so plainly: there is nothing for
 * the exit code to be compared against, which means the draft below cannot come
 * out a failure on the bar because no bar was ever fixed.
 */
function uncoveredBy(test: OstNode, instrument: ParsedInstrument): string {
  const threshold = (test.threshold ?? "").trim();
  const observed = `\`${instrument.command}\` observed an exit code and nothing else`;
  return threshold
    ? `${observed}. The bar this test committed to — "${threshold}" — is not something an exit code can see, and this run did not check it.`
    : `${observed}, and this test fixes no threshold for it to be measured against. Nothing here can come out a failure on the bar, because there is no bar.`;
}

/**
 * The pre-filled line, with `--by` left as a placeholder on purpose.
 *
 * Every other field is derived from what the run observed and can be checked
 * against the evidence printed beside it. Attribution cannot be: a result carries
 * `by` precisely so it can be told apart from a fabricated one, and a machine
 * filling that field in a line a human pastes unread is how the distinction stops
 * meaning anything.
 */
export function resultCommand(test: string, verdict: Verdict, note: string, uncovered: string): string {
  if (!VERDICTS.includes(verdict)) throw new Error(`"${verdict}" is not a verdict — use one of: ${VERDICTS.join(", ")}`);
  return [
    "ost-agent result",
    shellQuote(test),
    `-v ${verdict}`,
    `-n ${shellQuote(note)}`,
    "-b <you>",
    `-u ${shellQuote(uncovered)}`,
  ].join(" ");
}

/**
 * One argument, quoted so the pasted line runs as written.
 *
 * The double-quoted form is kept for the common case because a paste-ready
 * command a person has to squint at is a command they retype. But node titles in
 * this vault routinely carry backticks and quotes — every instrument name does —
 * and a `"` or a `` ` `` inside double quotes does not fail loudly, it silently
 * runs against a different title or executes a substitution. So anything shell
 * would reinterpret falls back to the POSIX single-quoted form, which has no
 * escapes inside it at all.
 */
export function shellQuote(text: string): string {
  if (!/["`$\\]/.test(text)) return `"${text}"`;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The pass, written out for a person. Nothing here is recorded anywhere. */
export function renderComputeLane(run: ComputeLaneRun): string {
  const out: string[] = [];
  out.push(`Compute-only lane: ${run.drafts.length} test(s) run, ${run.declined.length} declined.`);
  out.push("Nothing below is recorded. A draft is a proposal; `ost-agent result` is still yours.");

  for (const d of run.drafts) {
    out.push("");
    out.push(`- ${d.test}`);
    out.push(`    evidence: ${d.evidence}`);
    if (d.verdict) {
      out.push(`    draft verdict: ${d.verdict}`);
      out.push(`    does not cover: ${d.uncovered}`);
      out.push(`    ${d.resultCommand}`);
    } else {
      out.push(`    no verdict drafted — ${d.undecided}`);
    }
  }

  for (const d of run.declined) {
    out.push("");
    out.push(`- ${d.test}  DECLINED`);
    out.push(`    ${d.why}`);
  }

  out.push("");
  out.push(`${run.decisive} draft(s) a human could record, ${run.kills} of them a refutation.`);
  if (run.decisive > 0 && run.kills === 0) {
    // The assumption test this lane was built for names zero kills as its own
    // failure signal, so the report says it rather than leaving it to be counted.
    out.push("Zero kills: every draft in this pass confirms. That is the decoration signal — worth reading before recording any of them.");
  }
  return out.join("\n");
}
