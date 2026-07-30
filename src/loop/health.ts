/**
 * Loop health — the deterministic record of what each firing actually did.
 *
 * Append-only `runs.jsonl` per vault, one line per firing. The only writer is
 * this module, and the only inputs are exit codes, timestamps and commit shas
 * the CLI observed itself: there is no verdict flag anywhere, so the model
 * driving a firing can run the phases or not — it cannot claim health it did
 * not earn. An unsealed marker outliving its process is recorded as `crashed`
 * by the next firing; a firing that skipped a required phase seals `unhealthy`.
 *
 * **Nothing here is wrapped in a try/catch, and that is the design.** The
 * convention usually cited for swallowing a write failure is `recordUsageEvent`
 * ("a telemetry failure must cost an event, never a mutation") — but that
 * governs a ledger nothing decides on. This record IS the decider: the cadence
 * gate reads it to know whether the window has been consumed. A firing that
 * silently failed to record and still exited 0 would leave the window unconsumed
 * and the vault firing forever with nothing to show for it. So a failed write
 * throws, `loop start` refuses, and the pass does not run.
 */
import fs from "node:fs";
import path from "node:path";
import { requireLoopStateDir, loopStateDir } from "./state.js";

export type LoopVerdict = "healthy" | "unhealthy" | "no-op" | "crashed";

export interface LoopStepRecord {
  phase: string;
  /**
   * The command as one display string — `argv.join(" ")`. Lossy by
   * construction (it cannot tell one spaced argument from two), and kept
   * because it is what a human reads the ledger for.
   */
  command: string;
  /** The argv exactly as spawned, for a failure that has to be reproduced. */
  argv?: string[];
  /**
   * The working directory the command actually ran in.
   *
   * Without it a recorded failure cannot be reproduced from its own record —
   * observed live, when a `pnpm --filter …` step invoked from a vault
   * directory rather than the repo produced no output and recorded a line
   * indistinguishable from the same command run correctly.
   */
  cwd?: string;
  exit: number;
  durationMs: number;
  at: string;
}

export interface LoopRunRecord {
  runId: string;
  startedAt: string;
  endedAt?: string;
  loopVersion: string;
  cliVersion: string;
  /** The vault's HEAD when the firing opened, and when it sealed. */
  headBefore?: string;
  headAfter?: string;
  steps: LoopStepRecord[];
  verdict?: LoopVerdict;
}

/**
 * Phases a firing must show evidence of before it may seal `healthy`.
 *
 * The version of this file recovered from history required
 * `sense/decide/build/ost-pass` — the vocabulary of the API-key runner that was
 * deleted with the genome. The shipped firing is
 * `examples/automation/autonomous-pass.sh`, which has exactly two proving
 * steps: the pass itself and the deterministic checker that decides whether it
 * may push. Against the recovered list every real firing would have sealed
 * `unhealthy`, and a rule that fires on everything is a rule someone turns off.
 *
 * These two are the right pair for a different reason: dropping either is a
 * failure H4 exists to see. Without `pass` nothing was attempted; without
 * `check` nothing was proved, and `claude -p`'s own exit code reports Claude
 * Code's health rather than the tree's.
 */
export const REQUIRED_PHASES = ["pass", "check"] as const;

export function healthDir(dir: string): string {
  return requireLoopStateDir(dir);
}
export function openRunPath(dir: string): string {
  return path.join(healthDir(dir), "open-run.json");
}
export function runsPath(dir: string): string {
  return path.join(healthDir(dir), "runs.jsonl");
}

function appendRun(dir: string, run: LoopRunRecord): void {
  fs.appendFileSync(runsPath(dir), JSON.stringify(run) + "\n");
}

export function readOpenRun(dir: string): LoopRunRecord | null {
  const state = loopStateDir(dir);
  if (state === null) return null;
  const p = path.join(state, "open-run.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as LoopRunRecord;
  } catch {
    return null;
  }
}

/**
 * An unsealed marker means the previous firing died without sealing. Record it
 * as it stands — verdict `crashed` — so the run is visible, then clear the
 * marker. A corrupt marker still gets a line: invisibility is the one failure
 * mode this file exists to prevent.
 */
export function sweepCrashed(dir: string): LoopRunRecord | null {
  const p = openRunPath(dir);
  if (!fs.existsSync(p)) return null;
  const open = readOpenRun(dir);
  const now = new Date().toISOString();
  const crashed: LoopRunRecord = open
    ? { ...open, endedAt: now, verdict: "crashed" }
    : {
        runId: nextRunId(now),
        startedAt: now,
        endedAt: now,
        loopVersion: "unknown",
        cliVersion: "unknown",
        steps: [],
        verdict: "crashed",
      };
  appendRun(dir, crashed);
  fs.rmSync(p, { force: true });
  return crashed;
}

/**
 * Run ids derive from the start timestamp, which is only millisecond-resolved —
 * and a sweep plus a start is two small writes, so two firings can open inside
 * the same millisecond. A monotonic counter disambiguates within a process, and
 * the timestamp keeps ids sortable and readable across processes. Identity is
 * the one field a crashed run and its successor must not share.
 */
let idsIssuedThisMillisecond = 0;
let lastIdStamp = "";
function nextRunId(startedAt: string): string {
  const stamp = startedAt.replaceAll(":", "-");
  idsIssuedThisMillisecond = stamp === lastIdStamp ? idsIssuedThisMillisecond + 1 : 0;
  lastIdStamp = stamp;
  return idsIssuedThisMillisecond === 0 ? `${stamp}-loop` : `${stamp}-loop-${idsIssuedThisMillisecond}`;
}

export function startRun(
  dir: string,
  meta: { loopVersion: string; cliVersion: string; headBefore?: string },
): LoopRunRecord {
  sweepCrashed(dir);
  const startedAt = new Date().toISOString();
  const run: LoopRunRecord = {
    runId: nextRunId(startedAt),
    startedAt,
    loopVersion: meta.loopVersion,
    cliVersion: meta.cliVersion,
    ...(meta.headBefore ? { headBefore: meta.headBefore } : {}),
    steps: [],
  };
  fs.writeFileSync(openRunPath(dir), JSON.stringify(run, null, 2));
  return run;
}

function requireOpenRun(dir: string): LoopRunRecord {
  const open = readOpenRun(dir);
  if (!open) throw new Error(`no open loop run in ${dir} — run \`ost-agent loop start\` first`);
  return open;
}

export function appendStep(dir: string, step: Omit<LoopStepRecord, "at">): LoopRunRecord {
  const open = requireOpenRun(dir);
  open.steps.push({ ...step, at: new Date().toISOString() });
  fs.writeFileSync(openRunPath(dir), JSON.stringify(open, null, 2));
  return open;
}

/**
 * The verdict, derived only from things the firing could not assert about
 * itself: observed exit codes, which phases produced a step, and the vault's
 * commit before and after.
 *
 * `no-op` covers the unknown case as well as the equal-heads case. A firing
 * whose HEAD could not be read has not shown that it changed anything, and
 * `healthy` is a claim — an unobserved firing has not earned it. This is the
 * distinction S1 says the steady state hides: a dry pass over an already-clean
 * tree exits 0 and pushes nothing, and until now was indistinguishable from a
 * productive one.
 */
export function computeVerdict(run: LoopRunRecord): LoopVerdict {
  if (run.steps.some((s) => s.exit !== 0)) return "unhealthy";
  const phases = new Set(run.steps.map((s) => s.phase));
  if (!REQUIRED_PHASES.every((p) => phases.has(p))) return "unhealthy";
  if (!run.headBefore || !run.headAfter || run.headBefore === run.headAfter) return "no-op";
  return "healthy";
}

export function sealRun(dir: string, meta: { headAfter?: string } = {}): LoopRunRecord {
  const open = requireOpenRun(dir);
  const withHead: LoopRunRecord = { ...open, ...(meta.headAfter ? { headAfter: meta.headAfter } : {}) };
  const sealed: LoopRunRecord = {
    ...withHead,
    endedAt: new Date().toISOString(),
    verdict: computeVerdict(withHead),
  };
  appendRun(dir, sealed);
  fs.rmSync(openRunPath(dir), { force: true });
  return sealed;
}

const VERDICTS = new Set<LoopVerdict>(["healthy", "unhealthy", "no-op", "crashed"]);

/**
 * Every readable run, newest first. A corrupt line is skipped, never thrown on.
 *
 * A line is only admitted if its `startedAt` is a timestamp that parses. The
 * recovered version accepted any string, and the cadence gate sorts on this
 * field — so one line reading `"startedAt": "tomorrow"` sorted above every real
 * record and answered "when did this vault last fire" forever. Parsing it here
 * is the cheap half of that fix; ignoring records stamped in the *future* is
 * the other half, and it lives in `cadence.ts` where "now" is known.
 *
 * A verdict outside the vocabulary is dropped rather than trusted, so a reader
 * that groups by verdict cannot be handed a category the writer never emits.
 */
export function readRuns(dir: string): LoopRunRecord[] {
  const state = loopStateDir(dir);
  if (state === null) return [];
  const p = path.join(state, "runs.jsonl");
  if (!fs.existsSync(p)) return [];
  const runs: LoopRunRecord[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LoopRunRecord;
      if (typeof parsed?.runId !== "string") continue;
      if (typeof parsed?.startedAt !== "string" || !Number.isFinite(Date.parse(parsed.startedAt))) continue;
      if (parsed.verdict !== undefined && !VERDICTS.has(parsed.verdict)) delete parsed.verdict;
      if (!Array.isArray(parsed.steps)) parsed.steps = [];
      runs.push(parsed);
    } catch {
      /* corrupt line — skip it, never let it hide the runs around it */
    }
  }
  return runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
