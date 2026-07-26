/**
 * Loop health — the deterministic record of what each loop firing actually did.
 *
 * Append-only `runs.jsonl` per vault, one line per firing. The only writer is
 * this module, and the only inputs are exit codes and timestamps the CLI
 * observed itself: there is no verdict flag anywhere, so the LLM driving a
 * loop can run commands or not — it cannot claim health it didn't earn.
 * An unsealed marker outliving its process is recorded as `crashed` by the
 * next firing; a run that skipped required phases seals `unhealthy`.
 */
import fs from "node:fs";
import path from "node:path";

export type LoopVerdict = "healthy" | "unhealthy" | "no-op" | "crashed";
export type LoopDirective = "restore" | "work" | "no-op";

export interface LoopStepRecord {
  phase: string;
  command: string;
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
  directive?: LoopDirective;
  workItem?: string;
  steps: LoopStepRecord[];
  verdict?: LoopVerdict;
}

/** Phases a work run must show evidence of; anything less seals unhealthy. */
const REQUIRED_WORK_PHASES = ["sense", "decide", "build", "ost-pass"] as const;

export function healthDir(dir: string): string {
  return path.join(dir, ".ost-agent", "health");
}
export function openRunPath(dir: string): string {
  return path.join(healthDir(dir), "open-run.json");
}
export function runsPath(dir: string): string {
  return path.join(healthDir(dir), "runs.jsonl");
}

function appendRun(dir: string, run: LoopRunRecord): void {
  fs.mkdirSync(healthDir(dir), { recursive: true });
  fs.appendFileSync(runsPath(dir), JSON.stringify(run) + "\n");
}

export function readOpenRun(dir: string): LoopRunRecord | null {
  const p = openRunPath(dir);
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
        runId: nextRunId(now), startedAt: now,
        endedAt: now, loopVersion: "unknown", cliVersion: "unknown",
        steps: [], verdict: "crashed",
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

export function startRun(dir: string, meta: { loopVersion: string; cliVersion: string }): LoopRunRecord {
  sweepCrashed(dir);
  const startedAt = new Date().toISOString();
  const run: LoopRunRecord = {
    runId: nextRunId(startedAt),
    startedAt,
    loopVersion: meta.loopVersion,
    cliVersion: meta.cliVersion,
    steps: [],
  };
  fs.mkdirSync(healthDir(dir), { recursive: true });
  fs.writeFileSync(openRunPath(dir), JSON.stringify(run, null, 2));
  return run;
}

function requireOpenRun(dir: string): LoopRunRecord {
  const open = readOpenRun(dir);
  if (!open) throw new Error(`no open loop run in ${dir} — run \`ost-agent loop start\` first`);
  return open;
}

export function updateOpenRun(
  dir: string,
  patch: Partial<Pick<LoopRunRecord, "directive" | "workItem">>,
): LoopRunRecord {
  const next = { ...requireOpenRun(dir), ...patch };
  fs.writeFileSync(openRunPath(dir), JSON.stringify(next, null, 2));
  return next;
}

export function appendStep(dir: string, step: Omit<LoopStepRecord, "at">): LoopRunRecord {
  const open = requireOpenRun(dir);
  open.steps.push({ ...step, at: new Date().toISOString() });
  fs.writeFileSync(openRunPath(dir), JSON.stringify(open, null, 2));
  return open;
}

export function computeVerdict(run: LoopRunRecord): LoopVerdict {
  if (run.steps.some((s) => s.exit !== 0)) return "unhealthy";
  if (run.directive === "no-op") return "no-op";
  if (run.directive === "restore") return run.steps.length >= 1 ? "healthy" : "unhealthy";
  const phases = new Set(run.steps.map((s) => s.phase));
  return REQUIRED_WORK_PHASES.every((p) => phases.has(p)) ? "healthy" : "unhealthy";
}

export function sealRun(dir: string): LoopRunRecord {
  const open = requireOpenRun(dir);
  const sealed: LoopRunRecord = { ...open, endedAt: new Date().toISOString(), verdict: computeVerdict(open) };
  appendRun(dir, sealed);
  fs.rmSync(openRunPath(dir), { force: true });
  return sealed;
}

/** Every readable run, newest first. A corrupt line is skipped, never thrown on. */
export function readRuns(dir: string): LoopRunRecord[] {
  const p = runsPath(dir);
  if (!fs.existsSync(p)) return [];
  const runs: LoopRunRecord[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LoopRunRecord;
      if (typeof parsed?.runId === "string" && typeof parsed?.startedAt === "string") runs.push(parsed);
    } catch {
      /* corrupt line — skip it, never let it hide the runs around it */
    }
  }
  return runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}
