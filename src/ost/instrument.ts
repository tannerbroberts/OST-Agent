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
import {
  attributeRerun,
  describeFlakeAttribution,
  type FlakeAttribution,
} from "../runner/flake-attribution.js";
import { testAnswersForShippedSolution } from "../eval/shipped-audit.js";
import { INSTRUMENT_LOG_HEADING } from "./headings.js";
import { digestSpecFile, formatSpecDigest, withheldObservations } from "./rearm.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

/**
 * How an instrument's exit code reads.
 *
 * `no-spec` is a third answer, and adding it is the point of this distinction.
 * A command that exits non-zero because the runner found nothing to collect has
 * not measured the behaviour — it has measured the absence of a file. Both look
 * like "exit 1" and only one of them is a test.
 *
 * `unavailable` is the fourth, and it separates the *repository* failing from
 * the *environment* failing. A spec that could not be loaded because a package
 * is not installed, a runner npx could not produce, a run killed by a timeout —
 * each exits non-zero without any assertion in the spec having been reached. The
 * exit code is identical to a real red and it answers a different question, so
 * folding it into `red` mints permits out of broken machines. Kept apart from
 * `no-spec` because the two suggest different work: `no-spec` says write the
 * spec, `unavailable` says fix the box.
 */
export type Observation = "red" | "green" | "no-spec" | "unavailable";

export interface InstrumentRun {
  observation: Observation;
  exitCode: number | null;
  /** First meaningful line of output, for the log line. Never the whole run. */
  excerpt: string;
  /**
   * What a second run of the same command said, when one was asked for and the
   * first came back red. Absent when no re-run happened.
   */
  attribution?: FlakeAttribution;
}

/** Knobs on a single run. Everything here costs something, so nothing here is on by default. */
export interface RunInstrumentOptions {
  /**
   * On red, run the command once more and record whether the two runs agree.
   *
   * Off by default because it doubles the cost of every red, and only the path
   * that *records* an observation is worth paying that on. A pre-flight that
   * just wants to know whether a permit is still live
   * ({@link ../eval/buildable.ts}'s `confirmPermit`) gets the same answer out of
   * one run and should not wait for two.
   */
  rerunOnRed?: boolean;
  /**
   * How the command is executed. Defaults to a real `npx` spawn; a spec passes a
   * recording so the four-way sort in {@link classifyRun} is exercised for real
   * while the process is not. Nothing in production sets this.
   */
  spawn?: SpawnRunner;
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
  // Two spellings, and the second was found by running the case rather than by
  // reading the runner's source. Vitest 2.1.9 says "No test files found" when the
  // *filter matched no file at all* — a path outside the `include` glob, or one
  // that is not there. A file that IS collected and holds no test case says
  // something else entirely: "No test suite found in file <path>", reported as a
  // failed suite. The paragraph above claimed the empty-spec case was covered
  // here; until this line it was classified `red`, which is the vacuous red this
  // whole distinction exists to refuse. Captured output for both is in
  // `test/fixtures/instrument-red-now/`.
  return /no test files found/i.test(output) || /no test suite found in file/i.test(output);
}

/**
 * A bare package specifier — `vitest`, `@scope/pkg` — as opposed to a path.
 *
 * This one character is the whole of the distinction below, so it is named:
 * `../src/thing.js` is a module of the repository under test, and `some-package`
 * is a thing the environment was supposed to have installed.
 */
function isBareSpecifier(specifier: string): boolean {
  return specifier.length > 0 && !specifier.startsWith(".") && !specifier.startsWith("/");
}

/**
 * Did this run fail because the environment could not produce a measurement,
 * rather than because the repository failed one?
 *
 * **The line drawn here is bare-versus-relative, and it is drawn that way to
 * keep test-first work red.** A spec that throws on import because it imports a
 * module the solution has not created yet is the commonest honest red there is,
 * and {@link runInstrument}'s contract has always said so. But the runner
 * reports both kinds of missing import in one sentence:
 *
 *     Failed to load url ../../src/not-built-yet.js (resolved id: …) in …
 *     Failed to load url totally-missing-package (resolved id: …) in …
 *
 * The first is the solution's own module and the red is about this repository.
 * The second is a dependency nobody installed and the red is about this box —
 * swap the spec's every assertion and it stays exactly as red. So the specifier
 * decides: a path is a red, a package name is an absence of measurement.
 *
 * Deliberately narrow in the same direction as {@link collectedNothing}, and the
 * direction is worth stating because it is not the safe one at every caller: an
 * environment failure this misses reads as a genuine red, which understates
 * breakage for the observation log and *over-accepts* at the write boundary
 * ({@link ./red-now.ts}). Widening it is the opposite risk — a real red misread
 * as a broken box silently drops a permit the builder had earned — and the
 * patterns below are therefore only ones observed coming out of the runner, each
 * with a captured sample under `test/fixtures/instrument-red-now/`.
 */
function environmentBroke(output: string): string | undefined {
  // npx could not produce the runner at all: the command never reached a spec.
  // Three spellings, all captured rather than guessed — npm declines to install
  // without a TTY to say yes to, npm cannot reach the registry, and the older
  // wording. `npm error code E…` is the family that covers the second: an
  // offline box answers ENOTCACHED, an unreachable one ENETUNREACH, a typo E404,
  // and all of them mean the same thing here.
  if (
    /npx canceled due to missing packages/i.test(output) ||
    /could not determine executable to run/i.test(output) ||
    /npm (?:error|ERR!) code E[A-Z]+/.test(output)
  ) {
    return "the test runner could not be resolved — npx produced no `vitest` to run, so no spec was executed";
  }
  for (const [, specifier] of output.matchAll(/Failed to load url (\S+) \(resolved id:/g)) {
    if (isBareSpecifier(specifier)) {
      return `\`${specifier}\` is not installed — the spec could not be loaded, so none of its assertions ran`;
    }
  }
  for (const [, specifier] of output.matchAll(/Cannot find package '([^']+)'/g)) {
    if (isBareSpecifier(specifier)) {
      return `\`${specifier}\` is not installed — the spec could not be loaded, so none of its assertions ran`;
    }
  }
  return undefined;
}

/**
 * One completed process, in the shape {@link classifyRun} reads.
 *
 * Named as its own type so the classification can be exercised against captured
 * output from a real runner without a spawn: the fixtures under
 * `test/fixtures/instrument-red-now/` are recordings of this struct, and the
 * code that reads them in a spec is the same code that reads a live process.
 */
export interface SpawnedRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process never ran, or was killed — a missing binary, a timeout. */
  error?: { message: string };
}

/** How a command is executed. Injectable so a spec can replay a recording. */
export type SpawnRunner = (argv: readonly string[], cwd: string) => SpawnedRun;

const spawnThroughNpx: SpawnRunner = (argv, cwd) => {
  const run = spawnSync("npx", [...argv], {
    cwd,
    encoding: "utf8",
    // A spec suite that hangs would otherwise hang the loop that called it.
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    ...(run.error ? { error: { message: run.error.message } } : {}),
  };
};

/**
 * Read one finished process as an observation. Pure, so the four-way sort is
 * checkable against recorded output rather than only against a live box.
 *
 * The order of the branches is the argument: anything that says the process did
 * not complete outranks its exit code, a zero exit is unambiguous, and the two
 * "exited non-zero without measuring anything" cases are separated before the
 * remaining non-zero exit is allowed to mean `red`.
 */
export function classifyRun(target: string, r: SpawnedRun): { observation: Observation; exitCode: number | null; excerpt: string } {
  const output = `${r.stdout}\n${r.stderr}`;
  // The process did not finish: spawn failed, or the timeout killed it. Either
  // way nothing in the spec was reached, and `status` is meaningless.
  if (r.error) {
    return { observation: "unavailable", exitCode: r.status, excerpt: r.error.message.slice(0, 200) };
  }
  if (r.status === 0) {
    return { observation: "green", exitCode: 0, excerpt: firstMeaningfulLine(output) };
  }
  if (r.status === null) {
    return { observation: "unavailable", exitCode: null, excerpt: "the runner was killed before it reported — nothing was measured" };
  }
  // The file is there but the runner still collected nothing from it — a path
  // outside the suite's `include`, or a spec with no case in it. Non-zero, and
  // still not a measurement.
  if (collectedNothing(output)) {
    return {
      observation: "no-spec",
      exitCode: r.status,
      excerpt: `${target} collected no test cases — nothing in it can fail, so nothing was measured`,
    };
  }
  const broke = environmentBroke(output);
  if (broke) {
    return { observation: "unavailable", exitCode: r.status, excerpt: broke };
  }
  return { observation: "red", exitCode: r.status, excerpt: firstMeaningfulLine(output) };
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
 *
 * The filter is symmetric, and that is a feature with an edge on it: restore a
 * displaced command byte-for-byte and its old lines match again, so the permit
 * re-arms. {@link ./rearm.ts} is where that is made conditional — a restore that
 * could not show the spec file was unchanged writes down how many observations
 * it refused to re-arm, and those are dropped here. Nothing is rewritten; the
 * lines stay in the log, because a run that happened, happened.
 */
function currentObservations(node: OstNode): string[] {
  const instrument = nodeInstrument(node);
  if (!instrument) return [];
  const lines = instrumentLog(node).filter((l) => l.includes(`\`${instrument.command}\``));
  const withheld = withheldObservations(node, instrument.command);
  return withheld > 0 ? lines.slice(withheld) : lines;
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

/**
 * One spawn of the command, and how long it took. Never through a shell.
 *
 * Split out from {@link runInstrument} so the same command can be run twice
 * without the second run re-deciding anything the first already settled — the
 * `no-spec` short-circuit in particular, which is a fact about the filesystem
 * and does not change between two runs seconds apart.
 */
function spawnOnce(
  instrument: ParsedInstrument,
  repoDir: string,
  spawn: SpawnRunner,
): { observation: Observation; exitCode: number | null; excerpt: string; elapsedMs: number } {
  const started = Date.now();
  const run = spawn(instrument.argv, path.resolve(repoDir));
  const elapsedMs = Date.now() - started;
  return { ...classifyRun(instrument.target, run), elapsedMs };
}

/**
 * Run an instrument against a repository, and — with `rerunOnRed` — run it once
 * more when it comes back red, so the record carries whether the two runs agreed.
 *
 * **The second run is a repetition, not an isolation, and that bound is why the
 * verdict here is never `contention`.** An instrument names one spec file, so
 * the command already runs that file alone; running it again samples the same
 * conditions a second time rather than removing anything from beside it. And
 * the parent is blocked in `spawnSync` for the whole of each run, so it cannot
 * interleave a control workload with the child the way an in-process caller
 * can ({@link ../runner/flake-attribution.ts} explains why a load average
 * sampled around the child is not a substitute). So exactly two answers are
 * reachable from here: the runs agree and the red is solid, or they disagree
 * and the cause is **undetermined** — which is the honest half of the
 * mechanism, and still strictly more than the bare red this recorded before.
 *
 * A `no-spec` run is never re-run. It is a fact about a missing file, and a
 * second look at the same filesystem is a second look at the same fact.
 */
export function runInstrument(
  instrument: ParsedInstrument,
  repoDir: string,
  options: RunInstrumentOptions = {},
): InstrumentRun {
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

  const spawn = options.spawn ?? spawnThroughNpx;
  const { elapsedMs, ...first } = spawnOnce(instrument, repoDir, spawn);
  if (first.observation !== "red" || !options.rerunOnRed) return first;

  const second = spawnOnce(instrument, repoDir, spawn);
  // A second run that collects nothing is not a disagreement about the
  // behaviour — the spec vanished or the runner broke between the two, and
  // reading that as "passed on the re-run" would acquit on an absence. An
  // `unavailable` second run is the same case wearing the other marker: the box
  // stopped being able to answer, which is not the spec changing its mind.
  if (second.observation === "no-spec" || second.observation === "unavailable") return first;

  const attribution = attributeRerun(
    { failed: true, elapsedMs },
    { failed: second.observation === "red", elapsedMs: second.elapsedMs },
  );
  // The observation stays red either way. The first result is what was observed
  // and the log is append-only; what the re-run buys is the attribution beside
  // it, not a licence to overwrite the verdict with the luckier of two runs.
  return { ...first, attribution, excerpt: `${first.excerpt} [${describeFlakeAttribution(attribution)}]` };
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

  // The recording path is the one that pays for the re-run, because it is the
  // one that writes a line somebody will later read as the whole verdict. Two
  // reds recorded on 2026-08-01 said "exit 1" and nothing else, and the work of
  // telling a busy box from a broken change fell on a human twice.
  const run = runInstrument(parsed, filing.repo, { rerunOnRed: true });
  const alreadyRed = observedRed(node);

  // WHAT was measured, beside the fact that something was. The command names a
  // path and the path is not the file: the same command run either side of an
  // edit is two different measurements, and until this was recorded the log had
  // no way to say so. It is what lets a restored command's observations be
  // checked for identity rather than merely for string equality
  // ({@link ./rearm.ts}) — and it costs one hash of one file per filing.
  //
  // Absent on a `no-spec` run whose file does not exist, which is correct: there
  // was nothing to digest, and a missing digest withholds.
  const digest = digestSpecFile([filing.repo], parsed.target);
  const stamp = digest ? ` ${formatSpecDigest(digest)}` : "";

  // A vacuous run is filed, not refused. Refusing would throw away the one fact
  // worth having — that this test's spec has never been written — and leave the
  // node looking un-run, which is a different and less actionable state. Filed
  // under its own marker, it stays visible, stays in the verification queue, and
  // mints no permit, so the next pass re-checks it the moment somebody writes the
  // spec. The message says what to do rather than what went wrong, because
  // writing that spec IS the work: a failing assertion is the definition of done
  // a builder can act on, and a missing file is not.
  //
  // An `unavailable` run is filed on the same terms and for a sharper reason: it
  // is the one outcome that says nothing whatever about this repository. Recorded
  // under its own marker it mints no permit (`observedRed` matches `**red**` and
  // nothing else), stays in the verification queue, and tells whoever reads the
  // node that the box could not answer rather than that the code failed.
  if (run.observation === "no-spec" || run.observation === "unavailable") {
    const on = filing.on ?? new Date().toISOString().slice(0, 10);
    const line = `- ${on} **${run.observation}** (exit ${run.exitCode ?? "none"}) \`${parsed.command}\` — ${run.excerpt}${stamp}`;
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
    `- ${on} **${run.observation}** (exit ${run.exitCode ?? "none"}) \`${parsed.command}\` — ${run.excerpt}${stamp}`;
  // The heading travels as its own argument, which is the position the content
  // guard does not scan — that asymmetry is this path's exclusivity (ost/headings.ts).
  vault.appendUnderSection(filing.test, INSTRUMENT_LOG_HEADING, line);

  return { line, run, instrument: parsed, transitioned: run.observation === "green" && alreadyRed };
}
