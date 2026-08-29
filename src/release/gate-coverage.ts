/**
 * Only a human may reduce what a gate covers, and the reduction lands as its own
 * commit.
 *
 * **The loophole this closes.** A gate is an instrument, and an instrument can
 * be defeated two ways: fail it, or shrink it until the thing it was watching is
 * outside. The first is loud. The second is one line — an `--exclude`, a
 * narrowed `include`, a conditional trigger that stops firing — landing inside
 * the very commit whose work it lets through, and the loop that ran the gate
 * reports green afterwards because the gate it ran is no longer the gate the
 * criterion was set against. The tree filed this under an agent that "narrows
 * its own capability to get past a gate I set", from an instance where a
 * question reserved for a person was resolved by redesigning the capability
 * rather than by waiting for the answer.
 *
 * **Removing the capability, not detecting its use.** The chosen solution says
 * the scope of a gate is not something a run may touch. That cannot be done here
 * the way `ost_flag_humans_required` does it — by shipping a tool with no
 * argument for the permissive answer — because the build pass grants the builder
 * `Bash,Read,Edit,Write` against this repository (`examples/automation/build-pass.sh`).
 * An agent with `Edit` can type an exclusion into any file. What it cannot do is
 * *merge* one: `ost-agent ship` is the single funnel every unattended change
 * passes through on its way to `main`, and {@link branchCoverageRefusals} runs
 * there, before the gates. So the capability that is removed is not "write a
 * narrowing" but "ship a narrowing", which is the one that was load-bearing.
 *
 * **Change versus reduction, because the node and its definition of done differ.**
 * The solution's title says a *change* to coverage is human-only; its definition
 * of done says a call that would *reduce* coverage is refused. This implements
 * the narrower reading and refuses reductions, because refusing a widening would
 * stop an agent making a gate stricter — the one direction nobody needs
 * protecting from, and a rule whose only effect would be to make gates harder to
 * tighten. Both directions still have to land as their own commit
 * ({@link ISOLATION_RULE}), so a widening is just as countable; it simply is not
 * refused.
 *
 * **What a green test here does not settle.** Authorship is read off the commit —
 * an `anthropic.com` co-author trailer, or an author address that names a model.
 * That is a *declared* author, not a proven one, and an agent that omits the
 * trailer is indistinguishable from a person at this layer. The isolation half
 * carries the weight the authorship half cannot: whoever wrote it, a coverage
 * reduction is one commit touching one file, so `git log` counts them and a
 * person can judge them one at a time. That judgement — were the past narrowings
 * reasonable? — is the half the assumption test actually names, and nothing here
 * makes it.
 */
import { CONDITIONAL_GATES, CORE_GATES, SUITE_EXCLUSIONS, type Gate } from "./gates.declared.js";
import type { Runner } from "./ship.js";

/**
 * Every path that says what a gate covers.
 *
 * Three files, because there are three ways to shrink what the two core gates
 * measure and a rule that watched only one would have a door beside it:
 * `gates.declared.ts` holds the argv and the conditional triggers,
 * `vitest.config.ts` holds which files the suite gate collects, and
 * `tsconfig.json` holds which files `tsc --noEmit` compiles.
 */
export const GATE_DEFINITION_PATHS: readonly string[] = [
  "src/release/gates.declared.ts",
  "vitest.config.ts",
  "tsconfig.json",
];

/**
 * The file whose presence on the merge target says this regime is in force.
 *
 * Before the commit that introduced it there was no separable gate definition,
 * so no earlier commit could have obeyed a rule about touching it alone — and
 * the repository's history proves the point rather than merely allowing for it:
 * of the eight commits that ever touched a coverage-bearing file, every one also
 * touched something else, including the one that actually excluded a test file
 * from the suite. Enforcing backwards would refuse every branch for ever. So the
 * rule governs commits made after the declaration existed, and
 * {@link branchCoverageRefusals} says so out loud rather than silently passing.
 */
export const COVERAGE_REGIME_MARKER = "src/release/gates.declared.ts";

/** How a coverage change may land: alone. */
export const ISOLATION_RULE =
  "a change to what a gate covers lands as its own commit, touching only the gate definition, " +
  "so narrowings are countable from git instead of reconstructed";

/**
 * Repository paths used to evaluate a conditional gate's trigger.
 *
 * A `when` predicate is a function, so two versions of it cannot be compared
 * directly. They can be compared by what they *do*: fire each against a fixed
 * corpus and compare the sets. The corpus is deliberately a constant rather than
 * a scan of the working tree — a probe that changed with the repository would
 * make yesterday's coverage descriptor incomparable with today's, which is the
 * one thing this has to be able to do.
 */
export const COVERAGE_PROBE: readonly string[] = [
  "src/cli/index.ts",
  "src/knowledge/ruleset.ts",
  "src/release/gates.declared.ts",
  "src/security/policy.ts",
  "test/release/ship.test.ts",
  "docs/reference/v1-readiness.md",
  "package.json",
  "vitest.config.ts",
  "tsconfig.json",
  "dist/ost-agent.mjs",
  ".github/workflows/ci.yml",
  "README.md",
];

/**
 * Arguments whose presence restricts what a runner covers.
 *
 * Deliberately a literal list rather than a heuristic. A flag that narrows a
 * suite is a small, well-known set per runner, and a regex over "anything that
 * looks like a filter" would classify `--noEmit` and `--run` — the flags that
 * make these gates gates at all — as narrowings on the first refactor.
 */
export const NARROWING_ARGUMENTS: readonly string[] = [
  "--exclude",
  "--ignore",
  "--filter",
  "--project",
  "--changed",
  "--shard",
  "--related",
  "--dir",
  "--testNamePattern",
  "-t",
];

/** What one gate covers, in a form two versions of it can be compared in. */
export interface GateCoverageEntry {
  readonly name: string;
  readonly argv: readonly string[];
  /** Probe paths this gate fires on, or `null` when it always runs. */
  readonly firesOn: readonly string[] | null;
}

/** What the whole gate set covers at one moment. */
export interface GateCoverage {
  readonly gates: readonly GateCoverageEntry[];
  /** Test files configuration keeps out of the suite gate. */
  readonly suiteExclusions: readonly string[];
  /** What `tsc --noEmit` compiles. */
  readonly typeCheck: { readonly include: readonly string[]; readonly exclude: readonly string[] };
}

/** One way in which a gate set covers less than it did. */
export interface Narrowing {
  /** Which gate or surface shrank. */
  readonly subject: string;
  readonly kind:
    | "gate-removed"
    | "argument-restricted"
    | "trigger-narrowed"
    | "suite-exclusion-added"
    | "type-check-include-shrunk"
    | "type-check-exclude-grown";
  /** What was lost, named so a reader can judge it without the diff. */
  readonly lost: readonly string[];
}

/** The tsconfig fields that decide what `tsc --noEmit` compiles. */
export interface TypeCheckScope {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

/**
 * Read the current gate set's coverage.
 *
 * Takes its inputs rather than reading them so the comparison can be run against
 * a recorded descriptor, a fixture, or a hypothetical — the narrowing predicate
 * is the part worth pinning by a test, and it should not need a repository.
 */
export function gateCoverage(
  gates: readonly Gate[] = [...CORE_GATES, ...CONDITIONAL_GATES],
  suiteExclusions: readonly string[] = SUITE_EXCLUSIONS,
  typeCheck: TypeCheckScope = { include: [], exclude: [] },
): GateCoverage {
  const entries = gates.map((gate) => {
    const conditional = CONDITIONAL_GATES.find((c) => c.name === gate.name);
    const firesOn = conditional ? COVERAGE_PROBE.filter((p) => conditional.when([p])) : null;
    return { name: gate.name, argv: [...gate.argv], firesOn };
  });
  return {
    gates: entries,
    suiteExclusions: [...suiteExclusions],
    typeCheck: { include: [...typeCheck.include], exclude: [...typeCheck.exclude] },
  };
}

/** Positional (non-flag) arguments after the executable — the ones that restrict a run. */
function positionals(argv: readonly string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith("-"));
}

/**
 * Everything the second descriptor covers less of than the first.
 *
 * Returns every reduction rather than the first, for the same reason
 * `shipRefusals` does: a caller with no human beside it gets one report, and
 * fixing one narrowing only to be refused for the next is the loop this exists
 * to remove.
 */
export function narrowings(before: GateCoverage, after: GateCoverage): Narrowing[] {
  const found: Narrowing[] = [];

  for (const was of before.gates) {
    const now = after.gates.find((g) => g.name === was.name);
    if (!now) {
      found.push({ subject: was.name, kind: "gate-removed", lost: [was.argv.join(" ")] });
      continue;
    }
    // An added narrowing flag, or an added positional, restricts what the
    // command runs over. Anything else about the argv — a reordering, a renamed
    // executable, an added `--reporter` — is not a coverage claim.
    const restrictions = [
      ...now.argv.filter((a) => NARROWING_ARGUMENTS.includes(a) && !was.argv.includes(a)),
      ...positionals(now.argv).filter((a) => !positionals(was.argv).includes(a)),
    ];
    if (restrictions.length > 0) {
      found.push({ subject: now.name, kind: "argument-restricted", lost: restrictions });
    }
    if (was.firesOn && now.firesOn) {
      const lost = was.firesOn.filter((p) => !now.firesOn!.includes(p));
      if (lost.length > 0) found.push({ subject: now.name, kind: "trigger-narrowed", lost });
    }
  }

  const added = after.suiteExclusions.filter((f) => !before.suiteExclusions.includes(f));
  if (added.length > 0) found.push({ subject: "vitest", kind: "suite-exclusion-added", lost: added });

  // An empty `include` means "everything under the project root", so losing an
  // entry from a non-empty list is a reduction and adding the first one is too.
  const droppedInclude = before.typeCheck.include.filter((p) => !after.typeCheck.include.includes(p));
  if (droppedInclude.length > 0) {
    found.push({ subject: "tsc", kind: "type-check-include-shrunk", lost: droppedInclude });
  }
  const addedExclude = after.typeCheck.exclude.filter((p) => !before.typeCheck.exclude.includes(p));
  if (addedExclude.length > 0) {
    found.push({ subject: "tsc", kind: "type-check-exclude-grown", lost: addedExclude });
  }

  return found;
}

/** Who is asking to change coverage. Mirrors `ost/authorship.ts`: never inferred. */
export type CoverageWriter = "machine" | "human";

/** A proposed change to what the gates cover. */
export interface CoverageChangeRequest {
  readonly writer: CoverageWriter;
  readonly before: GateCoverage;
  readonly after: GateCoverage;
  /** Every repository path the change touches. */
  readonly touches: readonly string[];
}

/**
 * Why this coverage change may not be made. Empty means it may.
 *
 * Nothing here records the attempt. The sibling solution the tree weighed
 * against this one — "the gate records the capability it was set against" —
 * detects the evasion without blocking it; this blocks it, and a refusal that
 * also wrote a line somewhere would be an agent leaving a trace of a narrowing
 * it did not make, which is worse than useless to whoever later counts them.
 */
export function coverageChangeRefusals(request: CoverageChangeRequest): string[] {
  const reasons: string[] = [];
  const reductions = narrowings(request.before, request.after);

  if (reductions.length > 0 && request.writer === "machine") {
    const named = reductions.map((n) => `${n.subject}: ${n.kind} (${n.lost.join(", ")})`).join("; ");
    reasons.push(
      `refusing a coverage reduction from an agent: ${named}. Only a human may reduce what a gate covers. ` +
        "An agent may propose the narrowing and argue for it — in its report, where a person reads it — and may not perform one.",
    );
  }

  const changed = reductions.length > 0 || narrowings(request.after, request.before).length > 0;
  if (changed) {
    const stray = request.touches.filter((p) => !GATE_DEFINITION_PATHS.includes(p));
    if (stray.length > 0) {
      reasons.push(
        `refusing a coverage change bundled with ${stray.length} other path(s) (${stray.slice(0, 5).join(", ")}): ` +
          `${ISOLATION_RULE}.`,
      );
    }
  }

  return reasons;
}

/** Throw unless this coverage change is allowed. The fail-closed form. */
export function assertCoverageChangeAllowed(request: CoverageChangeRequest): void {
  const reasons = coverageChangeRefusals(request);
  if (reasons.length > 0) throw new Error(reasons.join("\n"));
}

/**
 * Commit authors that declare a model wrote the change.
 *
 * A declaration, not a proof — see the module note. It is the only signal git
 * carries here, and the isolation rule is what holds when it is absent.
 */
export const AGENT_AUTHOR_MARKERS: readonly string[] = ["anthropic.com", "noreply@anthropic.com"];

/** One commit that touched what a gate covers. */
export interface CoverageCommit {
  readonly sha: string;
  /** Author date, ISO-8601, so a rate per month is arithmetic rather than a guess. */
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  /** Every path the commit touched, not only the gate-definition ones. */
  readonly paths: readonly string[];
  /** Did it touch only the gate definition? */
  readonly isolated: boolean;
  /** Does it declare a model as an author? */
  readonly agentAuthored: boolean;
}

/** The field separator in the git log format above, written as an escape. */
const NUL = String.fromCharCode(0);

/**
 * Split a `git log` record written with NUL-separated fields.
 *
 * NUL rather than a printable separator because a commit subject may contain any
 * of them, and a subject with a tab in it silently shifting the author into the
 * date column is a parse that returns a plausible wrong answer rather than an
 * error.
 */
function parseLogRecord(record: string): { sha: string; date: string; author: string; subject: string } | null {
  const [sha, date, author, subject] = record.split(NUL);
  if (!sha || !date) return null;
  return { sha: sha.trim(), date: date.trim(), author: author ?? "", subject: subject ?? "" };
}

/**
 * Every commit in `range` that touched a gate definition, with what it touched.
 *
 * This is the countability half made real: the assumption test's design is
 * "search the commit history for every change that reduced what a gate covered,
 * count them and date them", and before this that search had no subject to run
 * against. It returns commits, not verdicts — whether a narrowing was
 * *reasonable* is the person's half and nothing here decides it.
 */
export function gateCoverageCommits(repo: string, run: Runner, range = "HEAD"): CoverageCommit[] {
  const log = run(
    ["git", "log", "--format=%H%x00%aI%x00%an <%ae>%x00%s", "--no-patch", range, "--", ...GATE_DEFINITION_PATHS],
    repo,
  );
  if (log.status !== 0) return [];

  const commits: CoverageCommit[] = [];
  for (const line of log.output.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const parsed = parseLogRecord(line);
    if (!parsed) continue;
    // Two calls rather than one, because the names and the message have to be
    // read apart. `--pretty=format:%b --name-only` prints them into a single
    // stream with nothing between them, and telling "a path" from "a line of the
    // commit message" by shape is a guess — `fix` is a legal path and a common
    // commit body.
    const names = run(["git", "show", "--pretty=format:", "--name-only", parsed.sha], repo);
    const paths =
      names.status === 0 ? names.output.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    const message = run(["git", "log", "-1", "--format=%B", parsed.sha], repo);
    const body = message.status === 0 ? message.output : "";
    const haystack = `${parsed.author} ${body}`.toLowerCase();
    commits.push({
      ...parsed,
      paths,
      isolated: paths.length > 0 && paths.every((p) => GATE_DEFINITION_PATHS.includes(p)),
      agentAuthored: AGENT_AUTHOR_MARKERS.some((m) => haystack.includes(m)),
    });
  }
  return commits;
}

/**
 * Why this branch's coverage changes may not be shipped. Empty means they may.
 *
 * Runs before the gates in {@link ./ship-repo.ts}, because a branch that
 * narrowed a gate and then passed it has proved nothing, and running the
 * narrowed gate first would put that meaningless green in the report.
 */
export function branchCoverageRefusals(repo: string, defaultBranch: string, run: Runner): string[] {
  // Nothing to narrow before there was a separable definition to narrow — see
  // COVERAGE_REGIME_MARKER. A branch that is introducing the regime is not
  // breaking it.
  const onBase = run(["git", "cat-file", "-e", `origin/${defaultBranch}:${COVERAGE_REGIME_MARKER}`], repo);
  if (onBase.status !== 0) return [];

  const reasons: string[] = [];
  for (const commit of gateCoverageCommits(repo, run, `origin/${defaultBranch}..HEAD`)) {
    const short = commit.sha.slice(0, 8);
    if (!commit.isolated) {
      const stray = commit.paths.filter((p) => !GATE_DEFINITION_PATHS.includes(p));
      reasons.push(
        `refusing to ship: commit ${short} ("${commit.subject}") changes what a gate covers alongside ` +
          `${stray.length} other path(s) (${stray.slice(0, 3).join(", ")}). ${ISOLATION_RULE}.`,
      );
    }
    if (commit.agentAuthored) {
      reasons.push(
        `refusing to ship: commit ${short} ("${commit.subject}") changes what a gate covers and declares a model ` +
          `as an author (${commit.author}). Only a human may change what a gate covers; an agent may propose one in its report.`,
      );
    }
  }
  return reasons;
}
