/**
 * Cut the timed-check run corpus: every recorded execution of this suite, and
 * where it ran.
 *
 *   npx tsx scripts/harvest-timed-check-run-corpus.ts \
 *     ~/.claude/projects tannerbroberts/OST-Agent test/fixtures/timed-check-runs 2026-09-01
 *
 * The census beneath "Run the timed check under isolation, or do not let it fail
 * the build at all" asks what share of timed-check runs happen somewhere
 * isolation could be guaranteed. That needs a denominator nobody chose, so this
 * keeps every suite invocation it can see in the window — whole-suite and
 * filtered, passing and failing, interactive and unattended — and leaves the
 * classifying to `src/release/timed-check-isolation.ts`.
 *
 * Two records, because there are two places this project's suite runs:
 *
 *   - **GitHub Actions.** `gh api` for every run of `.github/workflows/ci.yml`.
 *     One run is one execution of the `test` job, which is `npm test`, which is
 *     the whole suite. Runs that were cancelled are kept rather than dropped:
 *     dropping them would shrink the isolable side, and every discretionary
 *     choice here is made in the direction that flatters the assumption.
 *   - **This workstation.** Every `Bash` tool call in a Claude Code transcript
 *     for this repository, read by `suiteInvocations`. A session's `entrypoint`
 *     says which kind of local run it was: `sdk-cli` is the unattended loop
 *     firing `claude -p`, anything else is a person at the keyboard.
 *
 * **What it cannot see, and the direction that error runs.** Suite runs the
 * operator types into a terminal leave no transcript, and `ost-agent ship` runs
 * both gates as subprocesses of itself, so the loop's own pre-merge suite run is
 * invisible here too. Both are workstation runs, so the corpus undercounts
 * exactly the side that cannot isolate — the share this produces is an upper
 * bound on the real one.
 *
 * Nothing here classifies anything. The rule is in `src/release/`, and this
 * script calls it at cut time so the verdict is printed beside the artefact it
 * was cut from.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GATING_TIMED_CHECKS } from "../src/release/timed-checks.declared.js";
import { isolationShare, suiteInvocations, type RecordedRun } from "../src/release/timed-check-isolation.js";

const [, , projectsArg, repoArg, outArg, cutArg] = process.argv;
if (!projectsArg || !repoArg || !outArg || !cutArg) {
  console.error(
    "usage: harvest-timed-check-run-corpus.ts <projects-dir> <owner/repo> <out-dir> <YYYY-MM-DD>",
  );
  process.exit(2);
}

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COMMAND_CHARS = 160;

const endMs = Date.parse(`${cutArg}T00:00:00.000Z`);
if (Number.isNaN(endMs)) {
  console.error(`unparseable cut date: ${cutArg}`);
  process.exit(2);
}
const startMs = endMs - WINDOW_DAYS * DAY_MS;
const inWindow = (iso: string): boolean => {
  const at = Date.parse(iso);
  return !Number.isNaN(at) && at >= startMs && at < endMs;
};

/** Every `.jsonl` under the projects root, at any depth — worktrees nest. */
function transcripts(dir: string): string[] {
  const found: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) found.push(...transcripts(full));
    else if (name.endsWith(".jsonl")) found.push(full);
  }
  return found;
}

/** Workflow runs, one page at a time, until the window is behind us. */
function workflowRuns(repo: string): { id: number; created_at: string; conclusion: string | null }[] {
  const all: { id: number; created_at: string; conclusion: string | null }[] = [];
  for (let page = 1; page <= 20; page++) {
    const raw = execFileSync(
      "gh",
      ["api", `/repos/${repo}/actions/workflows/ci.yml/runs?per_page=100&page=${page}`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const runs = (JSON.parse(raw) as { workflow_runs: typeof all }).workflow_runs;
    if (runs.length === 0) break;
    all.push(...runs.map((r) => ({ id: r.id, created_at: r.created_at, conclusion: r.conclusion })));
    if (Date.parse(runs[runs.length - 1].created_at) < startMs) break;
  }
  return all;
}

const runs: RecordedRun[] = [];
const sources: Record<string, number> = {};

for (const run of workflowRuns(repoArg)) {
  if (!inWindow(run.created_at)) continue;
  runs.push({ at: run.created_at, location: "ci-github-hosted", filters: null });
  sources["github-actions"] = (sources["github-actions"] ?? 0) + 1;
}

/** Which local location a session's own header says it was. */
function localLocation(entrypoint: string | undefined): string {
  return entrypoint === "sdk-cli" ? "operator-workstation-unattended" : "operator-workstation-interactive";
}

interface LocalRun extends RecordedRun {
  readonly session: string;
  readonly command: string;
}
const local: LocalRun[] = [];

for (const file of transcripts(path.resolve(projectsArg))) {
  if (!/OST-Agent|ost-agent-meta|ost-agent-vault/i.test(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let entrypoint: string | undefined;
  const pending: { at: string; command: string }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entrypoint === undefined && typeof entry.entrypoint === "string") entrypoint = entry.entrypoint;
    const at = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (!inWindow(at)) continue;
    const message = entry.message as { content?: unknown } | undefined;
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content as Record<string, unknown>[]) {
      if (block.type !== "tool_use" || block.name !== "Bash") continue;
      const command = (block.input as { command?: unknown } | undefined)?.command;
      if (typeof command !== "string") continue;
      pending.push({ at, command });
    }
  }
  const location = localLocation(entrypoint);
  for (const { at, command } of pending) {
    for (const filters of suiteInvocations(command)) {
      local.push({
        at,
        location,
        filters,
        session: path.basename(file, ".jsonl"),
        command: command.replace(/\s+/g, " ").slice(0, MAX_COMMAND_CHARS),
      });
    }
  }
}

local.sort((a, b) => a.at.localeCompare(b.at));
for (const run of local) {
  runs.push(run);
  sources[run.location] = (sources[run.location] ?? 0) + 1;
}

const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "runs.json"),
  `${JSON.stringify(
    {
      windowStart: new Date(startMs).toISOString(),
      windowEnd: new Date(endMs).toISOString(),
      repo: repoArg,
      runs,
    },
    null,
    1,
  )}\n`,
);

const report = isolationShare(runs, GATING_TIMED_CHECKS);
console.log(`runs: ${runs.length}`, sources);
console.log(
  `timed-check executions: ${report.total}; isolable: ${report.isolated} (${(report.share * 100).toFixed(1)}%)`,
);
console.log(report.byLocation);
console.log(report.clearsBar ? "CLEARS the 50% bar" : "REFUTES the 50% bar");
