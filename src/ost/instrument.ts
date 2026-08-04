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
 * Nothing here uses a shell. The command is argv, assembled by the form that
 * matched it ({@link ../knowledge/instruments.ts}), so there is no interpreter
 * for a metacharacter to reach even if one survived the parse.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { isInstrument, parseInstrument, type ParsedInstrument } from "../knowledge/instruments.js";
import { INSTRUMENT_LOG_HEADING } from "./headings.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

/** How an instrument's exit code reads. */
export type Observation = "red" | "green";

export interface InstrumentRun {
  observation: Observation;
  exitCode: number | null;
  /** First meaningful line of output, for the log line. Never the whole run. */
  excerpt: string;
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
 */
export function observedRed(node: OstNode): boolean {
  return currentObservations(node).some((l) => /\*\*red\*\*/i.test(l));
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

/** Run an instrument against a repository. Never through a shell. */
export function runInstrument(instrument: ParsedInstrument, repoDir: string): InstrumentRun {
  const run = spawnSync("npx", instrument.argv, {
    cwd: path.resolve(repoDir),
    encoding: "utf8",
    // A spec suite that hangs would otherwise hang the loop that called it.
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  const exitCode = run.status;
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  return {
    observation: exitCode === 0 ? "green" : "red",
    exitCode,
    excerpt: firstMeaningfulLine(output, run.error?.message),
  };
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

  // The validity rule. A first observation that is green means the instrument
  // does not measure the solution — it measures something that was already true,
  // so recording it would let a test that was never capable of failing count as
  // one that passed.
  if (run.observation === "green" && !alreadyRed) {
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
