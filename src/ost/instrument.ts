/**
 * Running an assumption test's instrument, and recording what was observed.
 *
 * This is the half of a test that reality answers. `results.ts` records what a
 * *person* saw when they ran a test on the world; this records what a *process*
 * did when it ran a spec against the repository, and the difference between the
 * two is kept sharp on purpose:
 *
 * - A result is evidence about whether a solution is worth building. It needs
 *   judgement, it needs attribution to a person, and it stays human-only.
 * - An observation is a fact about the repository: this command exited 1 today.
 *   Nobody's judgement is involved, which is exactly why a machine may file it —
 *   and why filing one claims nothing about desirability, viability or worth.
 *
 * **Red-before-green is the validity rule, and it is what makes an agent-authored
 * test worth anything.** A test whose instrument already passes against the
 * current repository has not been tested — it has been described. It would go
 * green the moment it was written, tell the builder nothing about what to build,
 * and tell discovery nothing about reality. So the first observation of an
 * instrument must be RED, and a green first observation is refused rather than
 * recorded. What that buys: the agent stakes a falsifiable prediction, the
 * builder gets a definition of done it owns, and the transition from red to
 * green is a thing that happened rather than a thing that was asserted.
 *
 * One case is deliberately exempted: a test answering for a solution
 * {@link ../eval/shipped-audit.ts#trustsShippedStatus trusted as shipped} has
 * no unbuilt behaviour left to stake a claim about, so a first-run green is not
 * a failed prediction — it is the observation the solution owes instead
 * ({@link ../eval/buildable.ts#solutionsAwaitingObservation}). Nothing else
 * changes: a test under a solution that is not trusted-shipped still cannot
 * pass on its first run, no matter what the caller believes about it.
 *
 * Nothing here uses a shell. The command is argv, assembled by the form that
 * matched it ({@link ../knowledge/instruments.ts}), so there is no interpreter
 * for a metacharacter to reach even if one survived the parse.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isInstrument, parseInstrument, type ParsedInstrument } from "../knowledge/instruments.js";
import { testAnswersForShippedSolution } from "../eval/shipped-audit.js";
import { INSTRUMENT_LOG_HEADING } from "./headings.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

/**
 * How an instrument's exit code reads.
 *
 * `no-spec` is a third answer, and adding it is the point of this distinction.
 * A command that exits non-zero because the runner found nothing to collect has
 * not measured the behaviour — it has measured the absence of a file. Both look
 * like "exit 1" and only one of them is a test.
 */
export type Observation = "red" | "green" | "no-spec";

export interface InstrumentRun {
  observation: Observation;
  exitCode: number | null;
  /** First meaningful line of output, for the log line. Never the whole run. */
  excerpt: string;
}

/**
 * Did this run fail because no spec was collected, rather than because one
 * failed?
 *
 * **This is the difference between a falsifiable prediction and a filename.** An
 * instrument is supposed to be red because the behaviour it names does not exist
 * yet — the agent stakes a claim and the repository refutes it. But `npx vitest
 * run test/thing.test.ts` against a repository with no `test/thing.test.ts` also
 * exits non-zero, for a reason that has nothing to do with the node: swap the
 * test's title, its threshold, its whole question, and the command stays exactly
 * as red. Every question is equally "refuted" by a file that was never written,
 * which means the observation distinguishes nothing and the red is vacuous.
 *
 * That is not hypothetical either. Of 266 recorded reds in the meta vault on
 * 2026-08-09, 260 read "No test files found" — the tree's entire stock of
 * evidence that its tests could fail was, on inspection, evidence that 241 spec
 * files had never been written. {@link ../knowledge/instruments.ts} justifies the
 * closed form on the grounds that "an agent cannot author the outcome — only name
 * the file", and that argument holds only while the file exists. Naming a file
 * that does not authors the outcome completely.
 *
 * Kept deliberately narrow, so it fails toward treating a red as genuine: only
 * "the runner collected no spec at all" counts. A spec that exists and throws on
 * import — because it imports a module the solution has not created yet — is a
 * real red, and the commonest honest one in test-first work.
 */
function collectedNothing(output: string): boolean {
  return /no test files found/i.test(output);
}

/**
 * The tree's instruments counted by the sight of the pass that wrote them.
 *
 * Three figures, not two, and the third is the honest one: an instrument
 * written before the flag existed carries no `sight` field, and folding those
 * into either verdict would manufacture provenance nobody recorded. One place
 * computes this and both reports (`debt`, `status`) read it — a second place
 * to compute it is a second place for it to be wrong.
 */
export interface SightCensus {
  /** AssumptionTests carrying an instrument declaration, parseable or not. */
  total: number;
  grounded: number;
  blind: number;
  /** Instruments written before sight was recorded. */
  unlabelled: number;
}

export function sightCensus(tree: readonly OstNode[]): SightCensus {
  const carriers = tree.filter((n) => n.layer === "AssumptionTest" && typeof n.instrument === "string");
  const grounded = carriers.filter((n) => n.sight === "grounded").length;
  const blind = carriers.filter((n) => n.sight === "blind").length;
  return { total: carriers.length, grounded, blind, unlabelled: carriers.length - grounded - blind };
}

/** The declared instrument on a node, or undefined when there is none that parses. */
export function nodeInstrument(node: OstNode): ParsedInstrument | undefined {
  const parsed = parseInstrument(node.instrument);
  return isInstrument(parsed) ? parsed : undefined;
}

/**
 * Observations of the command the node names TODAY.
 *
 * Every log line carries the command it ran, in backticks, and this filters on
 * it. That is not bookkeeping — it is what stops an instrument swap from
 * inheriting a permit. `ost_set_instrument` can replace the field, and the
 * append-only log keeps the older runs (a run that happened, happened), so
 * without this filter a test could be observed red on one command, quietly
 * re-pointed at another, and hand the builder a permit backed by an observation
 * of something else entirely.
 *
 * A node with no parseable instrument has no current observations by
 * definition, which is the fail-closed direction.
 */
function currentObservations(node: OstNode): string[] {
  const instrument = nodeInstrument(node);
  if (!instrument) return [];
  return instrumentLog(node).filter((l) => l.includes(`\`${instrument.command}\``));
}

/**
 * Has the CURRENT instrument been observed red? The precondition for a green
 * being meaningful, and the signal the build permit reads.
 *
 * A `no-spec` line is deliberately not a red here, and the marker is what keeps
 * the two apart in an append-only log that cannot be rewritten: a vacuous run
 * files `**no-spec**`, which this pattern does not match, so it never mints a
 * permit. Reds recorded before that distinction existed still say `**red**` and
 * still match — {@link ../eval/buildable.ts#confirmPermit} is what catches those,
 * by re-running the command before anything is spent on it.
 */
export function observedRed(node: OstNode): boolean {
  return currentObservations(node).some((l) => /\*\*red\*\*/i.test(l));
}

/**
 * Has the CURRENT instrument been observed to collect nothing? The state where a
 * test names a spec that nobody has written, which is work rather than a fault.
 */
export function observedNoSpec(node: OstNode): boolean {
  return currentObservations(node).some((l) => /\*\*no-spec\*\*/i.test(l));
}

/** Has the CURRENT instrument been observed green — i.e. is it already built? */
export function observedGreen(node: OstNode): boolean {
  return currentObservations(node).some((l) => /\*\*green\*\*/i.test(l));
}

/** The recorded observation lines, in the order they were filed. */
export function instrumentLog(node: OstNode): string[] {
  const body = node.body ?? "";
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(INSTRUMENT_LOG_HEADING.toLowerCase()));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    if (line.trim().startsWith("- ")) out.push(line.trim());
  }
  return out;
}

/**
 * Does the spec an instrument names exist in any of these repo roots?
 *
 * The set-time half of the `no-spec` rule, sharing {@link runInstrument}'s
 * resolution exactly so the two cannot disagree about where a target lives. The
 * run-time half files a vacuous red after the fact; this lets a write boundary
 * refuse to mint one in the first place. Callers decide what a miss means —
 * an empty `repos` is their case to handle, not this function's, because only
 * the caller knows whether "nothing to resolve against" should stand down or
 * refuse.
 */
export function specResolves(repos: readonly string[], target: string): boolean {
  return repos.some((repo) => existsSync(path.resolve(repo, target)));
}

/** Run an instrument against a repository. Never through a shell. */
export function runInstrument(instrument: ParsedInstrument, repoDir: string): InstrumentRun {
  // Short-circuit the commonest vacuous red without paying for a runner start.
  // A missing spec file is answerable from the filesystem, and answering it here
  // means a queue full of un-written specs costs nothing to re-check every pass —
  // which matters, because that queue is meant to be re-checked until somebody
  // writes them.
  const target = path.resolve(repoDir, instrument.target);
  if (!existsSync(target)) {
    return {
      observation: "no-spec",
      exitCode: null,
      excerpt: `${instrument.target} does not exist — no spec was collected, so nothing was measured`,
    };
  }

  const run = spawnSync("npx", instrument.argv, {
    cwd: path.resolve(repoDir),
    encoding: "utf8",
    // A spec suite that hangs would otherwise hang the loop that called it.
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  const exitCode = run.status;
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (exitCode === 0) {
    return { observation: "green", exitCode, excerpt: firstMeaningfulLine(output, run.error?.message) };
  }
  // The file is there but the runner still collected nothing from it — an empty
  // spec, or one whose cases are all skipped. Non-zero, and still not a measurement.
  if (collectedNothing(output)) {
    return {
      observation: "no-spec",
      exitCode,
      excerpt: `${instrument.target} collected no test cases — nothing in it can fail, so nothing was measured`,
    };
  }
  return { observation: "red", exitCode, excerpt: firstMeaningfulLine(output, run.error?.message) };
}

/**
 * One line of evidence for the log — enough to recognise the failure, never
 * enough to turn a node into a build log. A recorded observation is a pointer to
 * a run, not a copy of it.
 */
function firstMeaningfulLine(output: string, spawnError?: string): string {
  if (spawnError) return spawnError.slice(0, 200);
  const interesting = output
    .split("\n")
    .map((l) => l.replace(/\[[0-9;]*m/g, "").trim())
    .filter((l) => l.length > 0)
    .find((l) => /(FAIL|Error|✕|×|error TS|failed)/i.test(l));
  const fallback = output
    .split("\n")
    .map((l) => l.replace(/\[[0-9;]*m/g, "").trim())
    .filter((l) => l.length > 0)
    .pop();
  return (interesting ?? fallback ?? "no output").slice(0, 200);
}

export interface VerifyFiling {
  /** Title of the AssumptionTest whose instrument to run. */
  test: string;
  /** The repository the instrument is measured against. */
  repo: string;
  /** ISO date; defaults to today. */
  on?: string;
}

export interface VerifyOutcome {
  line: string;
  run: InstrumentRun;
  instrument: ParsedInstrument;
  /** True when this run is the red→green transition — the solution got built. */
  transitioned: boolean;
}

/**
 * Run one test's instrument and file the observation.
 *
 * CLI-only, beside `recordResult`, and off every agent surface for the same
 * reason: the line it writes is what releases a solution to the builder. The
 * refusals below are the whole of the safety argument, so each says what it is
 * protecting rather than just that it said no.
 */
export function verifyInstrument(vaultDir: string, filing: VerifyFiling): VerifyOutcome {
  const dir = path.resolve(vaultDir);
  const vault = new Vault(dir);
  const node = vault.read(filing.test);
  if (node.layer !== "AssumptionTest") {
    throw new Error(`"${filing.test}" is a ${node.layer} — an instrument belongs to an AssumptionTest`);
  }

  const parsed = parseInstrument(node.instrument);
  if (!isInstrument(parsed)) {
    throw new Error(
      `"${filing.test}" declares no runnable instrument: ${parsed.reason}. ` +
        `Add an \`instrument:\` field naming one spec file, e.g. \`npx vitest run test/thing.test.ts\`.`,
    );
  }

  const run = runInstrument(parsed, filing.repo);
  const alreadyRed = observedRed(node);

  // A vacuous run is filed, not refused. Refusing would throw away the one fact
  // worth having — that this test's spec has never been written — and leave the
  // node looking un-run, which is a different and less actionable state. Filed
  // under its own marker, it stays visible, stays in the verification queue, and
  // mints no permit, so the next pass re-checks it the moment somebody writes the
  // spec. The message says what to do rather than what went wrong, because
  // writing that spec IS the work: a failing assertion is the definition of done
  // a builder can act on, and a missing file is not.
  if (run.observation === "no-spec") {
    const on = filing.on ?? new Date().toISOString().slice(0, 10);
    const line = `- ${on} **no-spec** (exit ${run.exitCode ?? "none"}) \`${parsed.command}\` — ${run.excerpt}`;
    vault.appendUnderSection(filing.test, INSTRUMENT_LOG_HEADING, line);
    return { line, run, instrument: parsed, transitioned: false };
  }

  // The validity rule. A first observation that is green means the instrument
  // does not measure the solution — it measures something that was already true,
  // so recording it would let a test that was never capable of failing count as
  // one that passed. Waived for a test answering a solution trusted as shipped:
  // there is no unbuilt behaviour left to stake a claim about, so a first-run
  // green is the observation the solution owes rather than a failed prediction.
  if (run.observation === "green" && !alreadyRed && !testAnswersForShippedSolution(vault.readTree(), filing.test)) {
    throw new Error(
      `refusing to record "${filing.test}": its instrument passed on the first run, against a repository where ` +
        `the solution has not been built. A test that is green before anything was built cannot fail, so it ` +
        `measures nothing and gives the builder no definition of done. Point the instrument at behaviour that ` +
        `does not exist yet — the command should FAIL today and pass once the solution is real.`,
    );
  }

  const on = filing.on ?? new Date().toISOString().slice(0, 10);
  const line =
    `- ${on} **${run.observation}** (exit ${run.exitCode ?? "none"}) \`${parsed.command}\` — ${run.excerpt}`;
  // The heading travels as its own argument, which is the position the content
  // guard does not scan — that asymmetry is this path's exclusivity (ost/headings.ts).
  vault.appendUnderSection(filing.test, INSTRUMENT_LOG_HEADING, line);

  return { line, run, instrument: parsed, transitioned: run.observation === "green" && alreadyRed };
}
