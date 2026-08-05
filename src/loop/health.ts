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
// Type-only, so nothing at runtime imports back into this file: `degraded.ts`
// reads the run record it classifies, and this file only needs the shape of what
// it hands back.
import type { Degradation } from "./degraded.js";

/**
 * `degraded` is the newest and the only one that is not about the tree.
 *
 * The other four answer "what did this firing do to the vault?" — it advanced it,
 * it broke, it died, it found nothing to do. `degraded` answers "could this firing
 * have done anything at all?", and it exists because for twenty-two consecutive
 * firings the answer was no and the record said `no-op`, which a reader correctly
 * takes to mean the tree was already fine. See `degraded.ts`.
 */
export type LoopVerdict = "healthy" | "unhealthy" | "no-op" | "crashed" | "degraded";

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
  /**
   * What this firing could not attempt, observed from outside it and stamped at
   * seal.
   *
   * Carried in the record rather than only printed, because the reader this is for
   * is the one who was not there: a `degraded` verdict with no list beside it is a
   * second way of saying nothing. Absent on a firing that was not degraded, and on
   * every record written before this field existed.
   */
  degradations?: Degradation[];
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
 *
 * **Where `degraded` sits in the order, and why there.** Below `unhealthy` and
 * `crashed`: those are firings that failed, and softening a red step into
 * "degraded" would launder a failure into an excuse. Above `healthy` AND above
 * `no-op`, which is the half that matters — a firing that could not do its job
 * may not report either that it did (`healthy`) or that there was nothing to do
 * (`no-op`). Both of those are claims about the tree, and a degraded firing has
 * no standing to make one. That is the whole of "not allowed to report a clean
 * run", expressed where a caller cannot route around it.
 */
export function computeVerdict(run: LoopRunRecord): LoopVerdict {
  if (run.steps.some((s) => s.exit !== 0)) return "unhealthy";
  const phases = new Set(run.steps.map((s) => s.phase));
  if (!REQUIRED_PHASES.every((p) => phases.has(p))) return "unhealthy";
  if (run.degradations && run.degradations.length > 0) return "degraded";
  if (!run.headBefore || !run.headAfter || run.headBefore === run.headAfter) return "no-op";
  return "healthy";
}

export function sealRun(
  dir: string,
  meta: { headAfter?: string; degradations?: readonly Degradation[] } = {},
): LoopRunRecord {
  const open = requireOpenRun(dir);
  const withHead: LoopRunRecord = {
    ...open,
    ...(meta.headAfter ? { headAfter: meta.headAfter } : {}),
    // Stamped before the verdict is computed, so the verdict is derived from the
    // same list the record carries — a reader can always re-run `computeVerdict`
    // over a sealed line and get the verdict it was sealed with.
    ...(meta.degradations && meta.degradations.length > 0 ? { degradations: [...meta.degradations] } : {}),
  };
  const sealed: LoopRunRecord = {
    ...withHead,
    endedAt: new Date().toISOString(),
    verdict: computeVerdict(withHead),
  };
  appendRun(dir, sealed);
  fs.rmSync(openRunPath(dir), { force: true });
  return sealed;
}

const VERDICTS = new Set<LoopVerdict>(["healthy", "unhealthy", "no-op", "crashed", "degraded"]);

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
      // Same rule as `steps`: a field a reader folds over must be an array or
      // absent, never a shape that throws in the fold. A malformed list is
      // dropped rather than repaired — the verdict on the line stands, because
      // it was computed at seal by the process that observed the firing.
      if (parsed.degradations !== undefined && !Array.isArray(parsed.degradations)) delete parsed.degradations;
      runs.push(parsed);
    } catch {
      /* corrupt line — skip it, never let it hide the runs around it */
    }
  }
  return runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
