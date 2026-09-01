/**
 * Where a timed check actually runs, whether load could be controlled there,
 * and what share of runs would still be allowed to gate.
 *
 * This is the rule behind "Count how many timed checks would run somewhere that
 * cannot guarantee isolation", the assumption test beneath "Run the timed check
 * under isolation, or do not let it fail the build at all". The solution's two
 * clauses are a trade: run timed checks only where load is controlled, and
 * anywhere that guarantee does not hold, let the check report its number without
 * being able to fail anything. The assumption is that enough runs happen in the
 * first kind of place for the gate to still be a gate. If most runs are in the
 * second, nearly every timed check becomes an advisory number, and an advisory
 * number that cannot fail anything gets scrolled past for months while the
 * regression it watched for arrives — worse than the flaky gate it replaced, and
 * invisible until someone counts.
 *
 * **The bar is the node's, fixed on 2026-08-03: at least 50% of timed-check runs
 * happen somewhere isolation can be guaranteed.** {@link ISOLATION_SHARE_BAR}.
 *
 * **What "isolation can be guaranteed" means here, and why.** The assumption
 * test's own words are "determine whether load *could* be controlled" — a modal,
 * about the location's capacity rather than about today's configuration. So the
 * test applied below is: *can anything outside this run's control consume CPU on
 * this machine while the measurement is being taken?* Load the project itself
 * puts on the box — its own suite, run however it chooses to run it — is not
 * foreign load, because the project can choose otherwise; an editor, a browser,
 * a second agent session and a cron pass are, because nothing in the run can
 * stop them.
 *
 * That reading is the generous one for the assumption, and deliberately: it lets
 * an ephemeral CI runner count as isolable even though the suite currently runs
 * 348 files in parallel on its two cores. The narrow reading — a location counts
 * only if the timed check runs alone there today — makes the answer zero on this
 * repository before any counting starts, which is a definition returning a
 * verdict rather than a measurement producing one.
 *
 * **What that leaves unsettled, and it is the whole distance between this census
 * and a working gate.** "Could" is not "does". Realising the isolation an
 * ephemeral runner makes possible means pulling the timed checks out of the
 * parallel suite into their own serialised step — which in this repository is an
 * addition to `SUITE_EXCLUSIONS`, and `src/release/gate-coverage.ts` refuses a
 * machine-authored coverage reduction at `ost-agent ship` before the gates run.
 * The census can say the location is capable; only a person can make it actual.
 *
 * Nothing here opens a file or imports a corpus — the same property
 * `src/loop/replayable.ts` carries, and for the same reason: a rule with no way
 * to read the ledger it is scored against cannot have been fitted to it.
 */
import { SUITE_EXCLUSIONS } from "./gates.declared.js";

/** The node's bar, fixed by the assumption test before any of this was counted. */
export const ISOLATION_SHARE_BAR = 0.5;

/**
 * Whether work outside the run's own control can share the machine.
 *
 * `unknown` is not a third answer the share splits on — it resolves to "not
 * guaranteed" in {@link isolationGuaranteed}, on the same principle the sibling
 * censuses use: a case needing a human to decide counts against the rule rather
 * than for it. A guarantee nobody can check is not a guarantee.
 */
export type ForeignLoad = "impossible" | "possible" | "unknown";

/** One place a timed check runs, with the properties the rule reads. */
export interface RunLocation {
  /** Stable id, used by the corpus. */
  readonly id: string;
  /** What a reader would call it. */
  readonly label: string;
  readonly foreignLoad: ForeignLoad;
  /** Can two runs land on the same machine at once? */
  readonly concurrentRunsOnOneMachine: "impossible" | "possible" | "unknown";
  /** The evidence for the two answers above. */
  readonly why: string;
}

/**
 * The four places the assumption test named, kept as four even where the record
 * holds no runs for one of them.
 *
 * Dropping an empty location would hide the finding that it is empty, which on
 * this repository is the more interesting half: the census was designed around
 * four locations and the record contains runs at two.
 */
export const RUN_LOCATIONS: readonly RunLocation[] = [
  {
    id: "ci-github-hosted",
    label: "GitHub-hosted CI runner",
    foreignLoad: "impossible",
    concurrentRunsOnOneMachine: "impossible",
    why:
      "each job in .github/workflows/ci.yml gets a VM created for that job and destroyed after it, so the only workload on the box is the one the workflow puts there — the project's own choice, and therefore controllable",
  },
  {
    id: "operator-workstation-unattended",
    label: "the operator's workstation, unattended loop pass",
    foreignLoad: "possible",
    concurrentRunsOnOneMachine: "possible",
    why:
      "the loop's lock serialises loop passes against each other and nothing else: the same laptop carries the operator's editor, browser and interactive agent sessions while a pass measures, and this repository's own record contains a wall-clock check convicted at 2004ms inside the suite that passed by an enormous margin alone seconds later",
  },
  {
    id: "operator-workstation-interactive",
    label: "the operator's workstation, interactive session",
    foreignLoad: "possible",
    concurrentRunsOnOneMachine: "possible",
    why:
      "the same machine as the unattended pass, plus a person using it; an unattended pass can and does start while an interactive suite run is in flight, since the two hold no lock in common",
  },
  {
    id: "contributor-workstation",
    label: "a contributor's machine",
    foreignLoad: "unknown",
    concurrentRunsOnOneMachine: "unknown",
    why:
      "nothing about a machine this project does not own is knowable from here, and CONTRIBUTING.md asks a contributor to run `npm test` without saying anything about load",
  },
];

/** The rule, in one line: no foreign load, and no second run beside it. */
export function isolationGuaranteed(location: RunLocation): boolean {
  return location.foreignLoad === "impossible" && location.concurrentRunsOnOneMachine === "impossible";
}

/** One recorded execution of the suite, or of a named part of it. */
export interface RecordedRun {
  /** ISO timestamp. */
  readonly at: string;
  /** A {@link RunLocation} id. */
  readonly location: string;
  /**
   * The positional filters the invocation carried, or `null` for a whole-suite
   * run. Vitest matches a positional against a file's path as a substring, which
   * is what {@link checksRunBy} reproduces.
   */
  readonly filters: readonly string[] | null;
}

/** What one recorded run put on the clock. */
export function checksRunBy(
  run: RecordedRun,
  gatingChecks: readonly string[],
  suiteExclusions: readonly string[] = SUITE_EXCLUSIONS,
): string[] {
  if (run.filters === null) return gatingChecks.filter((c) => !suiteExclusions.includes(c));
  return gatingChecks.filter((check) =>
    run.filters!.some((f) => check.includes(f.replace(/^\.\//, "").replace(/\/$/, ""))),
  );
}

/**
 * Pull every suite invocation out of a recorded shell command.
 *
 * The record a run leaves on this machine is a shell string, not an argv — a
 * `Bash` tool call in a Claude Code transcript — so the corpus is only as honest
 * as the reading of that string. Three things in the real record make a naive
 * `indexOf("vitest run")` wrong, and each is handled below because each was
 * observed while cutting the corpus:
 *
 *   1. **Heredocs.** Commit messages are written as `git commit -F - <<'MSG'`,
 *      and the messages in this repository quote the commands they verified —
 *      `npx vitest run` at the start of a line, inside the body. Stripping
 *      heredoc bodies removed 8 phantom whole-suite runs from a 30-day cut.
 *   2. **Quoted prose.** The same sentence arrives as `-m "… npx vitest run
 *      green at 4,726 tests …"`.
 *   3. **Redirections.** `npx vitest run 2>&1 | tail -60` is a whole-suite run,
 *      but the token after `run` is `2>&1`. Reading positionals until the first
 *      token that is not a test path is what tells that apart from a real filter
 *      — the first draft read `2` as a filter and so counted the most common
 *      whole-suite invocation in the record as a filtered one, which is the
 *      direction that flatters the assumption.
 *
 * Returns one entry per invocation found: `null` for a whole-suite run, or the
 * positional filters it named.
 */
export function suiteInvocations(command: string): (string[] | null)[] {
  const scannable = stripQuoted(stripHeredocs(command));
  const found: (string[] | null)[] = [];
  const invocation =
    /(?:^|[\n;&|(]|&&|\|\|)\s*(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:npx\s+(?:--yes\s+)?|pnpm\s+dlx\s+)?(?:vitest\s+run|npm\s+(?:run\s+)?test)\b([^\n;&|]*)/g;
  for (const match of scannable.matchAll(invocation)) {
    const rest = match[1].replace(/^\s*--\s+/, "");
    const filters: string[] = [];
    for (const token of rest.trim().split(/\s+/)) {
      if (!token) continue;
      if (token.startsWith("-")) continue;
      if (!isTestPath(token)) break;
      filters.push(token);
    }
    found.push(filters.length > 0 ? filters : null);
  }
  return found;
}

/** A positional vitest takes as a file filter: a test file, or a directory under `test/`. */
function isTestPath(token: string): boolean {
  if (!/^[\w./@-]+$/.test(token)) return false;
  return token.endsWith(".test.ts") || /^\.?\/?test(\/[\w.-]+)*\/$/.test(token);
}

/** Drop `<<EOF … EOF` bodies, which carry commit prose quoting commands. */
function stripHeredocs(command: string): string {
  const kept: string[] = [];
  let delimiter: string | null = null;
  for (const line of command.split("\n")) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    kept.push(line);
    const opened = /<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_]\w*))/.exec(line);
    if (opened) delimiter = opened[1] ?? opened[2] ?? opened[3];
  }
  return kept.join("\n");
}

/** Drop quoted spans, which carry the same prose in `-m` form. */
function stripQuoted(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, ' "" ').replace(/'[^']*'/g, " '' ");
}

/** The census result. */
export interface IsolationShareReport {
  /** Timed-check executions in the corpus. */
  readonly total: number;
  /** Those at a location where isolation could be guaranteed. */
  readonly isolated: number;
  /** `isolated / total`, or 0 for an empty corpus. */
  readonly share: number;
  /** Executions per location id, including the locations with none. */
  readonly byLocation: Record<string, number>;
  /** Whether the corpus clears {@link ISOLATION_SHARE_BAR}. */
  readonly clearsBar: boolean;
}

/**
 * Fold recorded runs into the share the assumption test asks for.
 *
 * Weighted by executions rather than by locations, which the node makes the
 * load-bearing detail: four locations of which three cannot isolate sounds like
 * a failure, and is a pass if 90% of runs are in the fourth.
 */
export function isolationShare(
  runs: readonly RecordedRun[],
  gatingChecks: readonly string[],
  locations: readonly RunLocation[] = RUN_LOCATIONS,
  suiteExclusions: readonly string[] = SUITE_EXCLUSIONS,
): IsolationShareReport {
  const byLocation: Record<string, number> = {};
  for (const location of locations) byLocation[location.id] = 0;

  let total = 0;
  let isolated = 0;
  for (const run of runs) {
    const location = locations.find((l) => l.id === run.location);
    if (!location) throw new Error(`recorded run at unknown location: ${run.location}`);
    const count = checksRunBy(run, gatingChecks, suiteExclusions).length;
    byLocation[location.id] += count;
    total += count;
    if (isolationGuaranteed(location)) isolated += count;
  }

  const share = total === 0 ? 0 : isolated / total;
  return { total, isolated, share, byLocation, clearsBar: share >= ISOLATION_SHARE_BAR };
}
