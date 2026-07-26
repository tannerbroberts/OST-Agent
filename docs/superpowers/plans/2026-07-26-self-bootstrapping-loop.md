# Self-Bootstrapping Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the loop structure as a versioned package artifact (`ost-agent loop` prints it), with a deterministic CLI-stamped health system, so every scheduled loop auto-adopts the latest structure and the engineer vault evolves it behind a canary gate.

**Architecture:** New `src/loop/` module family (health records, preflight directive, ruleset, renderer, fleet aggregation, promote gate) plus a `loop` command group registered from `src/cli/loop.ts`. Health truth lives in append-only `.ost-agent/health/runs.jsonl` per vault, written only by the CLI from exit codes. The prompt the LLM follows is rendered per-vault from `LOOP_RULESET` + `ost.config.yaml`'s new `loop:` block.

**Tech Stack:** TypeScript (ESM, Node >=20), commander, zod v3, vitest. CLI tests exec `npx tsx src/cli/index.ts` against a temp vault (existing pattern in `test/cli/friction.test.ts`).

**Spec:** `docs/superpowers/specs/2026-07-26-self-bootstrapping-loop-design.md`

## Global Constraints

- The spec's prerequisite bug ("failed pass exits 0") is **already fixed** (commit `f091b04`; `run` sets `process.exitCode = 1` on `outcome.error`). No task needed — do not re-implement.
- `runs.jsonl` is **append-only**: never rewrite or delete lines. The in-progress marker file (`open-run.json`) is the only mutable/deletable health file.
- The LLM never asserts health: there is **no `--verdict` flag anywhere**. Verdicts are computed from recorded exit codes only.
- Verdict values, exactly: `"healthy" | "unhealthy" | "no-op" | "crashed"`.
- Loop config values, exactly: `role: "consumer" | "engineer"` (default `"consumer"`), `channel: "latest" | "next"` (default `"latest"`), optional `pin` (semver string), optional `productRepo` (path), `fleetVaults` (string[], default `[]`).
- Promotion gate K = 2 consecutive healthy engineer runs on the candidate version.
- Phase ids, exactly: `preflight`, `sense`, `decide`, `build`, `ost-pass`, `seal`, `fleet` (engineer only).
- Follow repo conventions: comments state constraints, not narration; tests use `mkdtempSync` temp vaults with `defaultConfigYaml(...)`; CLI test timeout 30_000.
- Commit messages: `feat(loop): ...` / `test(loop): ...`, ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Before starting: `git pull --rebase` (a cloud routine pushes to main every 5h). Push after each task's commit.

---

### Task 1: `loop:` config block

**Files:**
- Modify: `src/config/schema.ts` (add `LoopSchema`, wire into `ConfigSchema`, extend `defaultConfigYaml`)
- Test: `test/config/loop.test.ts` (create; `test/config/` already exists — follow its style if files are present)

**Interfaces:**
- Consumes: existing `ConfigSchema`, `defaultConfigYaml(outcome, outcomeTitle?)`.
- Produces: `Config["loop"]` with shape `{ role: "consumer" | "engineer"; channel: "latest" | "next"; pin?: string; productRepo?: string; fleetVaults: string[] }`; export type `LoopConfig = Config["loop"]`. Later tasks read `ctx.config.loop`.

- [ ] **Step 1: Write the failing test**

```ts
// test/config/loop.test.ts
import { describe, expect, test } from "vitest";
import { ConfigSchema, defaultConfigYaml } from "../../src/config/schema.js";
import { parse } from "yaml";

describe("loop config block", () => {
  test("defaults: consumer on latest, no pin, no fleet", () => {
    const cfg = ConfigSchema.parse({ outcome: "x" });
    expect(cfg.loop).toEqual({ role: "consumer", channel: "latest", fleetVaults: [] });
  });

  test("engineer vault can set role, channel, productRepo, fleetVaults", () => {
    const cfg = ConfigSchema.parse({
      outcome: "x",
      loop: { role: "engineer", channel: "next", productRepo: "../OST-Agent", fleetVaults: ["../tetrix-ost"] },
    });
    expect(cfg.loop.role).toBe("engineer");
    expect(cfg.loop.channel).toBe("next");
    expect(cfg.loop.productRepo).toBe("../OST-Agent");
    expect(cfg.loop.fleetVaults).toEqual(["../tetrix-ost"]);
  });

  test("rejects an unknown role instead of guessing", () => {
    expect(() => ConfigSchema.parse({ outcome: "x", loop: { role: "manager" } })).toThrow();
  });

  test("scaffolded config documents the loop block", () => {
    const cfg = parse(defaultConfigYaml("Reach 10k DAU"));
    expect(ConfigSchema.parse(cfg).loop.role).toBe("consumer");
    expect(defaultConfigYaml("x")).toContain("loop:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/loop.test.ts`
Expected: FAIL — `cfg.loop` is `undefined` (no schema field yet).

- [ ] **Step 3: Implement `LoopSchema`**

In `src/config/schema.ts`, after `SlackSchema`:

```ts
// The loop block steers the self-bootstrapping loop (`ost-agent loop`). `role:
// engineer` belongs to exactly one vault — the OST-Agent meta tree — and is what
// unlocks the fleet-review phase and the promote gate. `pin` opts a vault out of
// auto-adoption; `productRepo` names the repo this vault's loop builds in.
const LoopSchema = z
  .object({
    role: z.enum(["consumer", "engineer"]).default("consumer"),
    channel: z.enum(["latest", "next"]).default("latest"),
    pin: z.string().optional(),
    productRepo: z.string().optional(),
    fleetVaults: z.array(z.string()).default([]),
  })
  .default({ role: "consumer", channel: "latest", fleetVaults: [] });
```

Add to `ConfigSchema`: `loop: LoopSchema,` and export `export type LoopConfig = Config["loop"];`

In `defaultConfigYaml`, append after the `remote:` block:

```yaml
loop:
  role: consumer            # exactly one vault (the OST-Agent meta tree) is "engineer"
  channel: latest           # engineer runs "next" — it canaries loop changes on itself
  # pin: "0.13.0"           # uncomment to freeze this loop on one version (opt-out of auto-adopt)
  # productRepo: ""         # repo this vault's loop builds in (path, relative to the vault)
  fleetVaults: []           # engineer only: vault dirs whose health records fleet review reads
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/loop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite (schema default snapshots elsewhere may reference `defaultConfigYaml`)**

Run: `npx vitest run`
Expected: PASS. If a first-run/init test asserts on the scaffolded YAML text, update its expectation to include the new block.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts test/config/loop.test.ts
git commit -m "feat(loop): loop config block — role, channel, pin, productRepo, fleetVaults"
```

---

### Task 2: Health records core (`src/loop/health.ts`)

**Files:**
- Create: `src/loop/health.ts`
- Test: `test/loop/health.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (fs + path only).
- Produces (later tasks call these exact signatures):

```ts
export type LoopVerdict = "healthy" | "unhealthy" | "no-op" | "crashed";
export type LoopDirective = "restore" | "work" | "no-op";
export interface LoopStepRecord { phase: string; command: string; exit: number; durationMs: number; at: string }
export interface LoopRunRecord {
  runId: string;            // `${startedAt}-loop` with colons replaced by dashes
  startedAt: string;        // ISO
  endedAt?: string;         // ISO, set by seal/sweep
  loopVersion: string;      // package VERSION that rendered the prompt
  cliVersion: string;       // VERSION of the CLI stamping this record
  directive?: LoopDirective;
  workItem?: string;        // node title picked in the decide phase
  steps: LoopStepRecord[];
  verdict?: LoopVerdict;    // set only by seal/sweep — never passed in
}
export function healthDir(dir: string): string;                       // <vault>/.ost-agent/health
export function openRunPath(dir: string): string;                     // <healthDir>/open-run.json
export function runsPath(dir: string): string;                        // <healthDir>/runs.jsonl
export function sweepCrashed(dir: string): LoopRunRecord | null;      // unsealed marker → append verdict:"crashed" line, delete marker
export function startRun(dir: string, meta: { loopVersion: string; cliVersion: string }): LoopRunRecord; // sweeps first, then writes marker
export function readOpenRun(dir: string): LoopRunRecord | null;
export function updateOpenRun(dir: string, patch: Partial<Pick<LoopRunRecord, "directive" | "workItem">>): LoopRunRecord;
export function appendStep(dir: string, step: Omit<LoopStepRecord, "at">): LoopRunRecord; // stamps `at`, rewrites marker
export function computeVerdict(run: LoopRunRecord): LoopVerdict;
export function sealRun(dir: string): LoopRunRecord;                  // computes verdict, appends to runs.jsonl, deletes marker
export function readRuns(dir: string): LoopRunRecord[];               // newest first; corrupt lines skipped
```

**Verdict rules (the whole point — implement exactly):**

1. Any step with `exit !== 0` → `"unhealthy"`.
2. Else `directive === "no-op"` → `"no-op"`.
3. Else `directive === "restore"` → `"healthy"` if `steps.length >= 1`, otherwise `"unhealthy"` (a restore run that ran nothing restored nothing).
4. Else (`"work"` or directive missing): `"healthy"` iff the set of `steps[].phase` contains all of `sense`, `decide`, `build`, `ost-pass`; any missing → `"unhealthy"`. (Omission is visible: skipping the health system is itself unhealthy.)

- [ ] **Step 1: Write the failing tests**

```ts
// test/loop/health.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  appendStep, computeVerdict, readRuns, runsPath, sealRun, startRun, sweepCrashed, updateOpenRun,
  type LoopRunRecord,
} from "../../src/loop/health.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-loop-health-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const meta = { loopVersion: "0.14.0", cliVersion: "0.14.0" };
const step = (phase: string, exit = 0) => ({ phase, command: `cmd-${phase}`, exit, durationMs: 5 });

describe("loop health records", () => {
  test("a full work run with all phases seals healthy", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work", workItem: "Fix the door" });
    for (const p of ["sense", "decide", "build", "ost-pass"]) appendStep(dir, step(p));
    const sealed = sealRun(dir);
    expect(sealed.verdict).toBe("healthy");
    expect(readRuns(dir)[0].workItem).toBe("Fix the door");
  });

  test("one non-zero exit poisons the run: unhealthy", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    for (const p of ["sense", "decide"]) appendStep(dir, step(p));
    appendStep(dir, step("build", 1));
    appendStep(dir, step("ost-pass"));
    expect(sealRun(dir).verdict).toBe("unhealthy");
  });

  test("a skipped required phase is unhealthy — omission is visible", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    for (const p of ["sense", "decide", "build"]) appendStep(dir, step(p)); // no ost-pass
    expect(sealRun(dir).verdict).toBe("unhealthy");
  });

  test("a no-op directive seals no-op without required phases", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "no-op" });
    expect(sealRun(dir).verdict).toBe("no-op");
  });

  test("a restore run needs at least one step to count as healthy", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "restore" });
    expect(sealRun(dir).verdict).toBe("unhealthy");
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "restore" });
    appendStep(dir, step("build"));
    expect(sealRun(dir).verdict).toBe("healthy");
  });

  test("an unsealed marker from a dead process is swept as crashed on the next start", () => {
    startRun(dir, meta);
    appendStep(dir, step("sense"));
    // process dies here — no seal. Next firing:
    const next = startRun(dir, meta);
    const runs = readRuns(dir);
    expect(runs.some((r) => r.verdict === "crashed")).toBe(true);
    expect(next.runId).not.toBe(runs.find((r) => r.verdict === "crashed")!.runId);
  });

  test("sweepCrashed with no marker is a no-op returning null", () => {
    expect(sweepCrashed(dir)).toBe(null);
  });

  test("runs.jsonl is append-only and survives a corrupt line", () => {
    startRun(dir, meta); updateOpenRun(dir, { directive: "no-op" }); sealRun(dir);
    fs.appendFileSync(runsPath(dir), "not json\n");
    startRun(dir, meta); updateOpenRun(dir, { directive: "no-op" }); sealRun(dir);
    expect(readRuns(dir)).toHaveLength(2); // corrupt line skipped, both real runs read
  });

  test("there is no way to assert a verdict from outside", () => {
    const run: LoopRunRecord = {
      runId: "r", startedAt: "2026-07-26T00:00:00Z", loopVersion: "x", cliVersion: "x",
      directive: "work", steps: [], verdict: "healthy", // lies in the marker...
    };
    expect(computeVerdict(run)).toBe("unhealthy"); // ...are recomputed away at seal
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/loop/health.test.ts`
Expected: FAIL — module `src/loop/health.ts` does not exist.

- [ ] **Step 3: Implement `src/loop/health.ts`**

```ts
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
  const crashed: LoopRunRecord = open
    ? { ...open, endedAt: new Date().toISOString(), verdict: "crashed" }
    : {
        runId: `unreadable-${Date.now()}`, startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(), loopVersion: "unknown", cliVersion: "unknown",
        steps: [], verdict: "crashed",
      };
  appendRun(dir, crashed);
  fs.rmSync(p, { force: true });
  return crashed;
}

export function startRun(dir: string, meta: { loopVersion: string; cliVersion: string }): LoopRunRecord {
  sweepCrashed(dir);
  const startedAt = new Date().toISOString();
  const run: LoopRunRecord = {
    runId: `${startedAt.replaceAll(":", "-")}-loop`,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/loop/health.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/health.ts test/loop/health.test.ts
git commit -m "feat(loop): deterministic health records — CLI-stamped runs.jsonl, crash sweep, computed verdicts"
```

---

### Task 3: CLI `loop start` / `loop step` / `loop seal`

**Files:**
- Create: `src/cli/loop.ts` (command group; keeps `src/cli/index.ts` from growing past focus)
- Modify: `src/cli/index.ts` (two lines: import + `registerLoopCommands(program)`)
- Test: `test/cli/loop.test.ts`

**Interfaces:**
- Consumes: Task 2's `startRun/appendStep/sealRun/readRuns/updateOpenRun`, `VERSION` from `../index.js`, `checkInvariants` from `../eval/invariants.js`, `buildPassContext` from `../runner/context.js`.
- Produces: `export function registerLoopCommands(program: Command): void` registering:
  - `ost-agent loop start [--vault DIR]` — sweeps crashes, opens a run, prints last sealed verdict.
  - `ost-agent loop step --phase <id> [--vault DIR] -- <command...>` — spawns the command (`shell: false`), records `{phase, command, exit, durationMs}`, **propagates the child's exit code**, streams child stdio through.
  - `ost-agent loop seal [--vault DIR]` — first records a synthetic `check` step by running `checkInvariants` (exit 1 on violations), then seals; prints the computed verdict; exits non-zero iff verdict is `unhealthy` or `crashed`.
  - `ost-agent loop decide <workItem> [--vault DIR]` — records the picked work item title onto the open run (`updateOpenRun`) AND appends a zero-exit `decide` step. (The pick itself comes from `ost_next_work`; this records it.)

- [ ] **Step 1: Write the failing tests**

```ts
// test/cli/loop.test.ts
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaultConfigYaml } from "../../src/config/schema.js";
import { readOpenRun, readRuns } from "../../src/loop/health.js";

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-loop-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), defaultConfigYaml("Reach 10k DAU"), "utf8");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function cli(args: string[]) {
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent loop start/step/seal", () => {
  test("start opens a run; step records the wrapped command's exit; seal computes the verdict", async () => {
    await cli(["loop", "start", "--vault", dir]);
    expect(readOpenRun(dir)).not.toBe(null);

    await cli(["loop", "step", "--phase", "sense", "--vault", dir, "--", "node", "-e", "process.exit(0)"]);
    await cli(["loop", "decide", "Fix the door", "--vault", dir]);
    await cli(["loop", "step", "--phase", "build", "--vault", dir, "--", "node", "-e", "process.exit(0)"]);
    await cli(["loop", "step", "--phase", "ost-pass", "--vault", dir, "--", "node", "-e", "process.exit(0)"]);

    const { stdout } = await cli(["loop", "seal", "--vault", dir]);
    expect(stdout).toContain("healthy");
    const [sealed] = readRuns(dir);
    expect(sealed.verdict).toBe("healthy");
    expect(sealed.workItem).toBe("Fix the door");
    expect(sealed.steps.map((s) => s.phase)).toContain("check"); // seal ran the invariants itself
  }, 60_000);

  test("a failing wrapped command propagates its exit code and poisons the run", async () => {
    await cli(["loop", "start", "--vault", dir]);
    await expect(
      cli(["loop", "step", "--phase", "build", "--vault", dir, "--", "node", "-e", "process.exit(3)"]),
    ).rejects.toMatchObject({ code: 3 });

    await expect(cli(["loop", "seal", "--vault", dir])).rejects.toMatchObject({ code: 1 });
    expect(readRuns(dir)[0].verdict).toBe("unhealthy");
  }, 60_000);

  test("step without an open run refuses loudly", async () => {
    await expect(
      cli(["loop", "step", "--phase", "sense", "--vault", dir, "--", "node", "-e", "0"]),
    ).rejects.toThrow(/loop start/);
  }, 30_000);

  test("a crashed prior run is swept and visible after the next start", async () => {
    await cli(["loop", "start", "--vault", dir]); // opened, never sealed — "the process died"
    await cli(["loop", "start", "--vault", dir]);
    expect(readRuns(dir).some((r) => r.verdict === "crashed")).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cli/loop.test.ts`
Expected: FAIL — `error: unknown command 'loop'`.

- [ ] **Step 3: Implement `src/cli/loop.ts`**

```ts
/**
 * `ost-agent loop …` — the self-bootstrapping loop's CLI surface.
 *
 * `step` is the deterministic bookend: it wraps whatever command a phase runs,
 * records the observed exit code into the open run, and propagates that exit
 * code. `seal` re-runs the tree invariants itself before computing the verdict,
 * so a run cannot end healthy over a broken tree. Nothing here accepts a
 * verdict from the caller.
 */
import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import { buildPassContext } from "../runner/context.js";
import { checkInvariants } from "../eval/invariants.js";
import { appendStep, readRuns, sealRun, startRun, updateOpenRun } from "../loop/health.js";
import { VERSION } from "../index.js";

export function registerLoopCommands(program: Command): void {
  const loop = program.command("loop").description("self-bootstrapping loop: prompt, health bookends, fleet review");

  loop
    .command("start")
    .description("open a health-tracked loop run (sweeps any crashed prior run first)")
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const runs = readRuns(opts.vault);
      const opened = startRun(opts.vault, { loopVersion: VERSION, cliVersion: VERSION });
      console.log(`loop run ${opened.runId} open`);
      const last = runs[0];
      if (last) console.log(`  last sealed run: ${last.verdict} (${last.startedAt}, v${last.loopVersion})`);
    });

  loop
    .command("step")
    .description("run one phase command and record its observed exit code")
    .requiredOption("-p, --phase <id>", "phase id (sense, decide, build, ost-pass, fleet, …)")
    .option("--vault <dir>", "vault directory", ".")
    .argument("<command...>", "the command to run (after --)")
    .action((command: string[], opts: { phase: string; vault: string }) => {
      const startedAt = Date.now();
      const child = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
      const exit = child.status ?? 1;
      appendStep(opts.vault, {
        phase: opts.phase,
        command: command.join(" "),
        exit,
        durationMs: Date.now() - startedAt,
      });
      process.exitCode = exit;
    });

  loop
    .command("decide")
    .description("record the work item the tree surfaced for this run")
    .argument("<workItem>", "title of the node ost_next_work surfaced")
    .option("--vault <dir>", "vault directory", ".")
    .action((workItem: string, opts: { vault: string }) => {
      updateOpenRun(opts.vault, { workItem });
      appendStep(opts.vault, { phase: "decide", command: `decide ${JSON.stringify(workItem)}`, exit: 0, durationMs: 0 });
      console.log(`decided: ${workItem}`);
    });

  loop
    .command("seal")
    .description("run the tree invariants, compute the verdict from recorded exits, append to runs.jsonl")
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const startedAt = Date.now();
      const ctx = buildPassContext(opts.vault);
      const violations = checkInvariants(ctx.vault.readTree());
      appendStep(opts.vault, {
        phase: "check",
        command: "checkInvariants",
        exit: violations.length === 0 ? 0 : 1,
        durationMs: Date.now() - startedAt,
      });
      const sealed = sealRun(opts.vault);
      console.log(`loop run ${sealed.runId} sealed: ${sealed.verdict}`);
      for (const v of violations) console.log(`  ✗ [${v.rule}] ${v.detail}`);
      if (sealed.verdict === "unhealthy" || sealed.verdict === "crashed") process.exitCode = 1;
    });
}
```

In `src/cli/index.ts`: add `import { registerLoopCommands } from "./loop.js";` with the other imports, and `registerLoopCommands(program);` immediately before `program.parseAsync()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/cli/loop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/loop.ts src/cli/index.ts test/cli/loop.test.ts
git commit -m "feat(loop): CLI bookends — loop start/step/decide/seal with propagated exits and invariant check at seal"
```

---

### Task 4: Preflight directive (`src/loop/preflight.ts` + CLI)

**Files:**
- Create: `src/loop/preflight.ts`
- Modify: `src/cli/loop.ts` (add `loop preflight` subcommand)
- Test: `test/loop/preflight.test.ts`, extend `test/cli/loop.test.ts`

**Interfaces:**
- Consumes: `computeNextWork(vault, dir, min)` from `src/mcp/next-work.ts` (returns `{ done: boolean, ... }`); `readRuns` + `updateOpenRun` from Task 2; `PassContext` from `src/runner/types.js` (check the actual import path used by `src/mcp/next-work.ts` callers — `src/mcp/server.ts` shows it).
- Produces:

```ts
export interface PreflightResult { directive: "restore" | "work" | "no-op"; reason: string }
export function computeDirective(ctx: PassContext, lastRun: LoopRunRecord | undefined): PreflightResult;
```

**Directive rules (deterministic, in priority order):**

1. `lastRun` exists and its verdict is `"unhealthy"` or `"crashed"` → `restore` ("last run ended <verdict> — this firing restores health before new work").
2. `computeNextWork(ctx.vault, ctx.dir, min).done === true` → `no-op` ("backlog dry — nothing surfaced; churn prevention is structural"). Use `min = ctx.config.processes["P3_ideate"]?.minSolutionsPerOpportunity ?? 3`.
3. Otherwise → `work`.

(Note: inbox contents need no separate check — unmapped inbox evidence already makes `computeNextWork().done` false.)

- [ ] **Step 1: Write the failing unit tests**

```ts
// test/loop/preflight.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computeDirective } from "../../src/loop/preflight.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import type { LoopRunRecord } from "../../src/loop/health.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-loop-preflight-"));
  await initVault(dir, "Reach 10k DAU");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const sealedRun = (verdict: LoopRunRecord["verdict"]): LoopRunRecord => ({
  runId: "r", startedAt: "2026-07-26T00:00:00Z", endedAt: "2026-07-26T00:10:00Z",
  loopVersion: "0.14.0", cliVersion: "0.14.0", steps: [], verdict,
});

describe("preflight directive", () => {
  test("an unhealthy last run forces restore before any new work", () => {
    const ctx = buildPassContext(dir);
    expect(computeDirective(ctx, sealedRun("unhealthy")).directive).toBe("restore");
    expect(computeDirective(ctx, sealedRun("crashed")).directive).toBe("restore");
  });

  test("a fresh outcome-only vault is legitimately no-op, not work", () => {
    const ctx = buildPassContext(dir);
    expect(computeDirective(ctx, sealedRun("healthy")).directive).toBe("no-op");
    expect(computeDirective(ctx, undefined).directive).toBe("no-op");
  });

  test("unmapped inbox evidence makes it a work run", () => {
    const inbox = path.join(dir, ".ost-agent", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "note.md"), "Users cannot find the vault from the repo.");
    const ctx = buildPassContext(dir);
    const r = computeDirective(ctx, sealedRun("healthy"));
    expect(r.directive).toBe("work");
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/loop/preflight.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/loop/preflight.ts`**

```ts
/**
 * Preflight — the deterministic gate that decides what kind of run this firing
 * is allowed to be. Computed from the vault and the last sealed record, never
 * from the LLM's opinion: a broken base forbids new work, and a dry backlog
 * forbids churn.
 */
import type { PassContext } from "../runner/types.js"; // ← use the same import path src/mcp/server.ts uses for PassContext
import { computeNextWork } from "../mcp/next-work.js";
import type { LoopRunRecord } from "./health.js";

export interface PreflightResult {
  directive: "restore" | "work" | "no-op";
  reason: string;
}

export function computeDirective(ctx: PassContext, lastRun: LoopRunRecord | undefined): PreflightResult {
  if (lastRun && (lastRun.verdict === "unhealthy" || lastRun.verdict === "crashed")) {
    return {
      directive: "restore",
      reason: `last run ${lastRun.runId} sealed ${lastRun.verdict} — restore health before any new work`,
    };
  }
  const min = ctx.config.processes["P3_ideate"]?.minSolutionsPerOpportunity ?? 3;
  const next = computeNextWork(ctx.vault, ctx.dir, min);
  if (next.done) {
    return { directive: "no-op", reason: "backlog dry — nothing surfaced; seal a no-op and exit cleanly" };
  }
  return { directive: "work", reason: "the tree has surfaced work — one item this firing" };
}
```

(If `PassContext` lives elsewhere, mirror the import used in `src/mcp/next-work.ts`'s call sites; do not invent a new type.)

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx vitest run test/loop/preflight.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the CLI subcommand and its test**

In `src/cli/loop.ts`, inside `registerLoopCommands`, add:

```ts
  loop
    .command("preflight")
    .description("compute this run's directive (restore | work | no-op) and record it on the open run")
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const ctx = buildPassContext(opts.vault);
      const last = readRuns(opts.vault)[0];
      const r = computeDirective(ctx, last);
      updateOpenRun(opts.vault, { directive: r.directive });
      appendStep(opts.vault, { phase: "preflight", command: "loop preflight", exit: 0, durationMs: 0 });
      console.log(`directive: ${r.directive}`);
      console.log(`  ${r.reason}`);
    });
```

Add the import: `import { computeDirective } from "../loop/preflight.js";`

Append to `test/cli/loop.test.ts`:

```ts
describe("ost-agent loop preflight", () => {
  test("records the directive on the open run; a dry fresh vault is no-op", async () => {
    await cli(["loop", "start", "--vault", dir]);
    const { stdout } = await cli(["loop", "preflight", "--vault", dir]);
    expect(stdout).toContain("directive: no-op");
    const { stdout: sealOut } = await cli(["loop", "seal", "--vault", dir]);
    expect(sealOut).toContain("no-op");
  }, 60_000);
});
```

Note: the temp vault in this test file is created from `defaultConfigYaml` only (no tree nodes), so `computeNextWork` may report not-done for a missing outcome node. If so, switch this test's `beforeEach` to use `initVault` (as `test/loop/preflight.test.ts` does) for a well-formed empty vault.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/cli/loop.test.ts test/loop/preflight.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/loop/preflight.ts src/cli/loop.ts test/loop/preflight.test.ts test/cli/loop.test.ts
git commit -m "feat(loop): deterministic preflight — restore beats work beats no-op, recorded on the open run"
```

---

### Task 5: `LOOP_RULESET` knowledge module

**Files:**
- Create: `src/loop/ruleset.ts`
- Test: `test/loop/ruleset.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface LoopPhase {
  id: string;                       // "preflight" | "sense" | "decide" | "build" | "ost-pass" | "seal" | "fleet"
  title: string;
  roles: ("consumer" | "engineer")[];
  instructions: string[];           // imperative lines the rendered prompt prints verbatim
}
export const LOOP_RULESET: { principles: string[]; phases: LoopPhase[] };
```

This is the spec's `LOOP_RULESET.md` realized in the codebase's own pattern: a TS knowledge module (like `src/knowledge/ruleset.ts`), shipped in the package, versioned by the package version. The "ruleset linter" from the spec is this task's test file.

- [ ] **Step 1: Write the failing linter tests**

```ts
// test/loop/ruleset.test.ts
import { describe, expect, test } from "vitest";
import { LOOP_RULESET } from "../../src/loop/ruleset.js";

const REQUIRED_PHASES = ["preflight", "sense", "decide", "build", "ost-pass", "seal", "fleet"];

describe("LOOP_RULESET linter", () => {
  test("every required phase exists exactly once, in order", () => {
    expect(LOOP_RULESET.phases.map((p) => p.id)).toEqual(REQUIRED_PHASES);
  });

  test("no placeholders survive into a shipped prompt", () => {
    const text = JSON.stringify(LOOP_RULESET);
    for (const bad of ["TBD", "TODO", "FIXME", "placeholder"]) expect(text).not.toContain(bad);
  });

  test("every phase carries at least one instruction and a role", () => {
    for (const p of LOOP_RULESET.phases) {
      expect(p.instructions.length, p.id).toBeGreaterThan(0);
      expect(p.roles.length, p.id).toBeGreaterThan(0);
    }
  });

  test("fleet is the only engineer-only phase; all others reach consumers", () => {
    for (const p of LOOP_RULESET.phases) {
      if (p.id === "fleet") expect(p.roles).toEqual(["engineer"]);
      else expect(p.roles).toContain("consumer");
    }
  });

  test("phase instructions route their commands through the health bookends", () => {
    const build = LOOP_RULESET.phases.find((p) => p.id === "build")!;
    expect(build.instructions.join(" ")).toContain("ost-agent loop step");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/loop/ruleset.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/loop/ruleset.ts`**

```ts
/**
 * LOOP_RULESET — the loop structure itself, shipped in the package so every
 * scheduled loop runs the latest version the engineer promoted. This module is
 * the artifact the engineer vault evolves; the package version is the loop
 * version. Edit deliberately — changing a line changes every robot's next
 * firing. Rendered per-vault by src/loop/render.ts.
 */

export interface LoopPhase {
  id: string;
  title: string;
  roles: ("consumer" | "engineer")[];
  instructions: string[];
}

const BOTH: LoopPhase["roles"] = ["consumer", "engineer"];

export const LOOP_RULESET: { principles: string[]; phases: LoopPhase[] } = {
  principles: [
    "One work item per firing. The tree is the only source of what to build: ideation happens in the OST pass, selection is ost_next_work, and the loop never freelances.",
    "Every phase ends with a CLI command whose exit code is the truth. Run phase commands through `ost-agent loop step --phase <id> --vault <vault> -- <command…>` so the run's health record reflects what actually happened. You cannot assert health; you can only earn it.",
    "If any step fails, keep going where recovery is plausible, stop where it is not — but ALWAYS finish with `ost-agent loop seal`. A sealed unhealthy run is respectable; an unsealed run is a crash.",
  ],
  phases: [
    {
      id: "preflight",
      title: "Preflight",
      roles: BOTH,
      instructions: [
        "Bring the vault and the product repo current: `git pull --rebase` in both. Push conflicts are handled at the end of the run, not by forcing now.",
        "Open the run: `ost-agent loop start --vault <vault>`, then `ost-agent loop preflight --vault <vault>`.",
        "Obey the printed directive. `restore`: this firing's only job is returning the vault and repo to health (tests green, invariants pass) — skip sense/decide/build and go to the OST pass only if restoration touched the tree. `no-op`: run `ost-agent loop seal` immediately and stop. `work`: continue.",
      ],
    },
    {
      id: "sense",
      title: "Sense",
      roles: BOTH,
      instructions: [
        "Harvest whatever evidence accumulated since the last firing (inbox notes, transcript harvest, friction filings) and map it into the tree: `ost-agent loop step --phase sense --vault <vault> -- ost-agent run P1_ingest --vault <vault>` followed by the mapping pass if evidence landed.",
      ],
    },
    {
      id: "decide",
      title: "Decide",
      roles: BOTH,
      instructions: [
        "Ask the tree what is next (ost_next_work via MCP, or `ost-agent tool next_work`). Whatever single item it surfaces — a feature, an assumption test the lanes say compute may run, a hygiene fix — is this firing's work item.",
        "Record it: `ost-agent loop decide \"<work item title>\" --vault <vault>`. If the surfaced item is a solution to build, first clear the evidence gate: `ost-agent gate \"<solution>\" --vault <vault>` — a BLOCKED gate turns this firing into assumption-test work instead.",
      ],
    },
    {
      id: "build",
      title: "Build",
      roles: BOTH,
      instructions: [
        "Implement the one item in the product repo, test-driven: failing test first, minimal code, green suite. Commit and push the product repo.",
        "Run the proof through the bookend so the record shows it: `ost-agent loop step --phase build --vault <vault> -- <the product repo's test command>`.",
      ],
    },
    {
      id: "ost-pass",
      title: "OST pass",
      roles: BOTH,
      instructions: [
        "Bring the tree current so the NEXT firing has a real backlog: run the full maintenance pass (map, ideate, assumptions, hygiene) until ost_next_work reports done, wrapping the deterministic check: `ost-agent loop step --phase ost-pass --vault <vault> -- ost-agent check --vault <vault>`.",
      ],
    },
    {
      id: "fleet",
      title: "Fleet review (engineer only)",
      roles: ["engineer"],
      instructions: [
        "Pull every fleet vault and read the deterministic record: `ost-agent loop step --phase fleet --vault <vault> -- ost-agent loop fleet --vault <vault> --file-evidence`. The written evidence note enters this tree through the normal sense phase next firing — loop-structure changes are made only when ost_next_work surfaces them, never on a whim.",
        "If a version is sitting unpromoted on the `next` dist-tag, check the gate: `ost-agent loop promote --vault <vault>`. Promote when it clears; while it is blocked, no new loop-structure work item may be picked.",
      ],
    },
    {
      id: "seal",
      title: "Seal",
      roles: BOTH,
      instructions: [
        "Push the vault (pull-rebase-push; an unresolvable conflict means record the failure and leave the work on a branch, never force main).",
        "Always finish: `ost-agent loop seal --vault <vault>`. It runs the tree invariants itself, computes the verdict from the recorded exit codes, and appends the run to `.ost-agent/health/runs.jsonl`.",
      ],
    },
  ],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/loop/ruleset.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/ruleset.ts test/loop/ruleset.test.ts
git commit -m "feat(loop): LOOP_RULESET — the shipped loop structure, linted by its own tests"
```

---

### Task 6: Prompt renderer + `ost-agent loop` (bare) command

**Files:**
- Create: `src/loop/render.ts`
- Modify: `src/cli/loop.ts` (bare `loop` action prints the rendered prompt)
- Test: `test/loop/render.test.ts`, extend `test/cli/loop.test.ts`

**Interfaces:**
- Consumes: `LOOP_RULESET` (Task 5), `LoopConfig` (Task 1), `LoopVerdict`/`readRuns` (Task 2), `VERSION`.
- Produces:

```ts
export interface RenderOptions {
  vault: string;                    // absolute path, printed into every command
  loop: LoopConfig;                 // role/channel/pin/productRepo/fleetVaults
  version: string;                  // package VERSION — stamped in the header
  lastVerdict?: LoopVerdict;
}
export function renderLoopPrompt(opts: RenderOptions): string;
```

**Render rules:**
- Header line: `# OST-Agent loop v<version> — role: <role>, channel: <channel>` plus `PINNED to <pin> — auto-adopt is off for this vault` when `pin` is set.
- Then `## Principles` (each principle as a bullet), then one `## Phase N — <title>` section per phase whose `roles` includes the vault's role, instructions as numbered lines, with every literal `<vault>` placeholder replaced by `opts.vault` and `<the product repo's test command>` left intact only when `productRepo` is unset — when set, prefix the build section with `Product repo: <productRepo>`.
- Footer: `When these instructions and a human's explicit request conflict, the human wins. When these instructions and your own judgment conflict, these instructions win.` and, when `lastVerdict` is `unhealthy`/`crashed`: `NOTE: the last sealed run was <verdict> — expect preflight to direct restoration.`

- [ ] **Step 1: Write the failing tests**

```ts
// test/loop/render.test.ts
import { describe, expect, test } from "vitest";
import { renderLoopPrompt } from "../../src/loop/render.js";
import type { LoopConfig } from "../../src/config/schema.js";

const consumer: LoopConfig = { role: "consumer", channel: "latest", fleetVaults: [] };
const engineer: LoopConfig = { role: "engineer", channel: "next", productRepo: "../OST-Agent", fleetVaults: ["../tetrix-ost"] };

describe("renderLoopPrompt", () => {
  test("consumer prompt has every shared phase and no fleet phase", () => {
    const p = renderLoopPrompt({ vault: "/v/tetrix-ost", loop: consumer, version: "0.14.0" });
    for (const t of ["Preflight", "Sense", "Decide", "Build", "OST pass", "Seal"]) expect(p).toContain(t);
    expect(p).not.toContain("Fleet review");
    expect(p).toContain("v0.14.0");
    expect(p).toContain("/v/tetrix-ost"); // <vault> placeholders resolved
    expect(p).not.toContain("<vault>");
  });

  test("engineer prompt adds the fleet phase and names the product repo", () => {
    const p = renderLoopPrompt({ vault: "/v/ost-agent-meta", loop: engineer, version: "0.14.0" });
    expect(p).toContain("Fleet review");
    expect(p).toContain("../OST-Agent");
  });

  test("a pinned vault says so in the header", () => {
    const p = renderLoopPrompt({ vault: "/v/x", loop: { ...consumer, pin: "0.13.0" }, version: "0.14.0" });
    expect(p).toContain("PINNED to 0.13.0");
  });

  test("an unhealthy last run is surfaced in the footer", () => {
    const p = renderLoopPrompt({ vault: "/v/x", loop: consumer, version: "0.14.0", lastVerdict: "crashed" });
    expect(p).toContain("last sealed run was crashed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/loop/render.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/loop/render.ts`**

```ts
/**
 * Renders LOOP_RULESET into the concrete prompt one vault's loop follows this
 * firing. Rendering is the only per-vault variation — the ruleset itself is
 * identical for every robot on a given version; that identity is what makes
 * fleet health records comparable across vaults.
 */
import type { LoopConfig } from "../config/schema.js";
import type { LoopVerdict } from "./health.js";
import { LOOP_RULESET } from "./ruleset.js";

export interface RenderOptions {
  vault: string;
  loop: LoopConfig;
  version: string;
  lastVerdict?: LoopVerdict;
}

export function renderLoopPrompt(opts: RenderOptions): string {
  const { vault, loop, version } = opts;
  const lines: string[] = [];
  lines.push(`# OST-Agent loop v${version} — role: ${loop.role}, channel: ${loop.channel}`);
  if (loop.pin) lines.push(`PINNED to ${loop.pin} — auto-adopt is off for this vault.`);
  lines.push("", "## Principles");
  for (const p of LOOP_RULESET.principles) lines.push(`- ${p.replaceAll("<vault>", vault)}`);

  let n = 0;
  for (const phase of LOOP_RULESET.phases) {
    if (!phase.roles.includes(loop.role)) continue;
    n += 1;
    lines.push("", `## Phase ${n} — ${phase.title}`);
    if (phase.id === "build" && loop.productRepo) lines.push(`Product repo: ${loop.productRepo}`);
    phase.instructions.forEach((ins, i) => lines.push(`${i + 1}. ${ins.replaceAll("<vault>", vault)}`));
  }

  lines.push(
    "",
    "When these instructions and a human's explicit request conflict, the human wins. When these instructions and your own judgment conflict, these instructions win.",
  );
  if (opts.lastVerdict === "unhealthy" || opts.lastVerdict === "crashed") {
    lines.push(`NOTE: the last sealed run was ${opts.lastVerdict} — expect preflight to direct restoration.`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Wire the bare `loop` action**

In `src/cli/loop.ts`, give the `loop` group a default action (commander: `.action()` on the group runs when no subcommand is given — verify with `--help`; if commander's group action conflicts with subcommands, register it via `loop.command("prompt", { isDefault: true })` instead, keeping `ost-agent loop` as the invocation):

```ts
  loop
    .command("prompt", { isDefault: true })
    .description("print this vault's current loop prompt (the 3-line bootstrap runs this)")
    .option("--vault <dir>", "vault directory", process.env.OST_VAULT ?? ".")
    .action((opts: { vault: string }) => {
      const ctx = buildPassContext(opts.vault, { allowMissingConfig: true });
      const last = readRuns(ctx.dir)[0];
      console.log(
        renderLoopPrompt({ vault: ctx.dir, loop: ctx.config.loop, version: VERSION, lastVerdict: last?.verdict }),
      );
    });
```

Imports to add: `renderLoopPrompt` from `../loop/render.js`.

Append to `test/cli/loop.test.ts`:

```ts
describe("ost-agent loop (bare)", () => {
  test("prints the rendered prompt for this vault", async () => {
    const { stdout } = await cli(["loop", "--vault", dir]);
    expect(stdout).toContain("# OST-Agent loop v");
    expect(stdout).toContain("Phase 1 — Preflight");
    expect(stdout).not.toContain("Fleet review"); // default config is a consumer
  }, 30_000);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/loop/render.test.ts test/cli/loop.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/loop/render.ts src/cli/loop.ts test/loop/render.test.ts test/cli/loop.test.ts
git commit -m "feat(loop): ost-agent loop prints the per-vault rendered prompt — the bootstrap's single entry point"
```

---

### Task 7: Fleet aggregation (`src/loop/fleet.ts` + CLI `loop fleet`)

**Files:**
- Create: `src/loop/fleet.ts`
- Modify: `src/cli/loop.ts` (add `loop fleet` subcommand)
- Test: `test/loop/fleet.test.ts`

**Interfaces:**
- Consumes: `readRuns` (Task 2), `LoopConfig.fleetVaults` (Task 1), inbox path from `ctx.config.adapters.inbox.path`.
- Produces:

```ts
export interface VersionStats {
  loopVersion: string;
  runs: number; healthy: number; unhealthy: number; noop: number; crashed: number;
  medianDurationMs: number;         // from startedAt→endedAt; runs missing endedAt excluded
}
export interface FleetStats { vaults: string[]; byVersion: VersionStats[] } // byVersion sorted newest-version-first (semver-ish string desc is fine)
export function aggregateFleet(vaultDirs: string[]): FleetStats;
export function renderFleetEvidence(stats: FleetStats): string;   // markdown note for the inbox
```

- [ ] **Step 1: Write the failing tests**

```ts
// test/loop/fleet.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { aggregateFleet, renderFleetEvidence } from "../../src/loop/fleet.js";
import { runsPath, healthDir, type LoopRunRecord } from "../../src/loop/health.js";

let a: string, b: string;
beforeEach(() => {
  a = fs.mkdtempSync(path.join(os.tmpdir(), "ost-fleet-a-"));
  b = fs.mkdtempSync(path.join(os.tmpdir(), "ost-fleet-b-"));
});
afterEach(() => { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); });

function seed(dir: string, runs: Partial<LoopRunRecord>[]) {
  fs.mkdirSync(healthDir(dir), { recursive: true });
  const lines = runs.map((r, i) =>
    JSON.stringify({
      runId: `r${i}`, startedAt: `2026-07-2${i}T00:00:00Z`, endedAt: `2026-07-2${i}T00:10:00Z`,
      loopVersion: "0.14.0", cliVersion: "0.14.0", steps: [], verdict: "healthy", ...r,
    }),
  );
  fs.writeFileSync(runsPath(dir), lines.join("\n") + "\n");
}

describe("fleet aggregation", () => {
  test("folds runs.jsonl across vaults into per-version stats", () => {
    seed(a, [{ verdict: "healthy" }, { verdict: "unhealthy" }]);
    seed(b, [{ verdict: "no-op" }, { verdict: "crashed" }, { loopVersion: "0.13.0", verdict: "healthy" }]);
    const stats = aggregateFleet([a, b]);
    const v14 = stats.byVersion.find((v) => v.loopVersion === "0.14.0")!;
    expect(v14).toMatchObject({ runs: 4, healthy: 1, unhealthy: 1, noop: 1, crashed: 1 });
    expect(stats.byVersion.find((v) => v.loopVersion === "0.13.0")!.healthy).toBe(1);
  });

  test("a vault with no health file contributes nothing but does not throw", () => {
    seed(a, [{}]);
    expect(aggregateFleet([a, b]).byVersion[0].runs).toBe(1);
  });

  test("evidence note is deterministic markdown naming versions and counts", () => {
    seed(a, [{}, { verdict: "unhealthy" }]);
    const md = renderFleetEvidence(aggregateFleet([a]));
    expect(md).toContain("0.14.0");
    expect(md).toContain("healthy 1");
    expect(md).toContain("unhealthy 1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/loop/fleet.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/loop/fleet.ts`**

```ts
/**
 * Fleet review input — folds every reachable vault's runs.jsonl into
 * per-loop-version stats. "Did version N+1 beat version N" becomes a
 * computable question. The rendered note goes into the engineer vault's inbox
 * and enters discovery through the normal sense phase: the numbers are
 * evidence, and the tree — not this module — decides what they mean.
 */
import { readRuns, type LoopRunRecord } from "./health.js";

export interface VersionStats {
  loopVersion: string;
  runs: number;
  healthy: number;
  unhealthy: number;
  noop: number;
  crashed: number;
  medianDurationMs: number;
}

export interface FleetStats {
  vaults: string[];
  byVersion: VersionStats[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((p, q) => p - q);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function aggregateFleet(vaultDirs: string[]): FleetStats {
  const all: LoopRunRecord[] = vaultDirs.flatMap((d) => readRuns(d));
  const byVersion = new Map<string, LoopRunRecord[]>();
  for (const r of all) {
    const list = byVersion.get(r.loopVersion) ?? [];
    list.push(r);
    byVersion.set(r.loopVersion, list);
  }
  const stats: VersionStats[] = [...byVersion.entries()]
    .map(([loopVersion, runs]) => ({
      loopVersion,
      runs: runs.length,
      healthy: runs.filter((r) => r.verdict === "healthy").length,
      unhealthy: runs.filter((r) => r.verdict === "unhealthy").length,
      noop: runs.filter((r) => r.verdict === "no-op").length,
      crashed: runs.filter((r) => r.verdict === "crashed").length,
      medianDurationMs: median(
        runs
          .filter((r) => r.endedAt)
          .map((r) => new Date(r.endedAt as string).getTime() - new Date(r.startedAt).getTime()),
      ),
    }))
    .sort((p, q) => q.loopVersion.localeCompare(p.loopVersion, undefined, { numeric: true }));
  return { vaults: vaultDirs, byVersion: stats };
}

export function renderFleetEvidence(stats: FleetStats): string {
  const lines = [
    `# Fleet health — loop versions across ${stats.vaults.length} vault(s)`,
    "",
    "Deterministic rollup of `.ost-agent/health/runs.jsonl` (CLI-stamped; no self-report).",
    "",
  ];
  for (const v of stats.byVersion) {
    lines.push(
      `- v${v.loopVersion}: ${v.runs} run(s) — healthy ${v.healthy}, unhealthy ${v.unhealthy}, ` +
        `no-op ${v.noop}, crashed ${v.crashed}; median duration ${Math.round(v.medianDurationMs / 1000)}s`,
    );
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Add the CLI subcommand**

In `src/cli/loop.ts`:

```ts
  loop
    .command("fleet")
    .description("fold fleet vaults' health records into per-version stats (engineer's evidence)")
    .option("--vault <dir>", "engineer vault directory", ".")
    .option("--file-evidence", "write the rollup into this vault's inbox so the sense phase maps it")
    .action((opts: { vault: string; fileEvidence?: boolean }) => {
      const ctx = buildPassContext(opts.vault);
      const vaults = [ctx.dir, ...ctx.config.loop.fleetVaults.map((v) => path.resolve(ctx.dir, v))];
      const stats = aggregateFleet(vaults);
      const md = renderFleetEvidence(stats);
      console.log(md);
      if (opts.fileEvidence) {
        const inbox = path.join(ctx.dir, ctx.config.adapters.inbox.path);
        fs.mkdirSync(inbox, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10);
        const file = path.join(inbox, `${stamp}-fleet-health.md`);
        fs.writeFileSync(file, md);
        console.log(`evidence filed: ${file}`);
      }
    });
```

Imports to add at the top of `src/cli/loop.ts`: `import fs from "node:fs";`, `import path from "node:path";`, `import { aggregateFleet, renderFleetEvidence } from "../loop/fleet.js";`

Append a CLI test to `test/loop/fleet.test.ts` only if quick; the module tests above cover the logic — the CLI wiring is exercised by Task 9's end-to-end test.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/loop/fleet.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/loop/fleet.ts src/cli/loop.ts test/loop/fleet.test.ts
git commit -m "feat(loop): fleet rollup — per-version health stats, filed as inbox evidence for the engineer's tree"
```

---

### Task 8: Promote gate (`src/loop/promote.ts` + CLI `loop promote`)

**Files:**
- Create: `src/loop/promote.ts`
- Modify: `src/cli/loop.ts` (add `loop promote` subcommand)
- Test: `test/loop/promote.test.ts`

**Interfaces:**
- Consumes: `readRuns`, `LoopRunRecord` (Task 2); `VERSION`.
- Produces:

```ts
export interface PromoteVerdict { cleared: boolean; reason: string }
// K consecutive most-recent runs ON `version` must be healthy or no-op; fewer than K runs on it → blocked.
export function promoteGate(runs: LoopRunRecord[], version: string, k?: number): PromoteVerdict; // k defaults to 2
```

CLI behavior: `ost-agent loop promote [--vault DIR] [--version <v>] [--execute]`.
`--version` defaults to `VERSION` (the CLI running is the candidate — the engineer's bootstrap resolves `@next`). Dry-run by default: print the gate verdict, exit 1 when blocked. With `--execute` and a cleared gate: `spawnSync("npm", ["dist-tag", "add", `ost-agent@${version}`, "latest"], { stdio: "inherit" })` and propagate its exit code (missing npm auth fails visibly here — nothing wedges, per spec).

- [ ] **Step 1: Write the failing tests**

```ts
// test/loop/promote.test.ts
import { describe, expect, test } from "vitest";
import { promoteGate } from "../../src/loop/promote.js";
import type { LoopRunRecord } from "../../src/loop/health.js";

const run = (loopVersion: string, verdict: LoopRunRecord["verdict"], i: number): LoopRunRecord => ({
  runId: `r${i}`, startedAt: `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
  loopVersion, cliVersion: loopVersion, steps: [], verdict,
});
// readRuns returns newest first — build fixtures the same way.
const newestFirst = (...rs: LoopRunRecord[]) => rs;

describe("promoteGate", () => {
  test("clears on K=2 consecutive healthy runs on the candidate", () => {
    const v = promoteGate(newestFirst(run("0.14.0", "healthy", 2), run("0.14.0", "healthy", 1)), "0.14.0");
    expect(v.cleared).toBe(true);
  });

  test("a no-op run counts as healthy for promotion — a dry backlog is not a regression", () => {
    const v = promoteGate(newestFirst(run("0.14.0", "no-op", 2), run("0.14.0", "healthy", 1)), "0.14.0");
    expect(v.cleared).toBe(true);
  });

  test("blocked while any of the K most recent candidate runs is unhealthy or crashed", () => {
    const v = promoteGate(newestFirst(run("0.14.0", "healthy", 3), run("0.14.0", "crashed", 2)), "0.14.0");
    expect(v.cleared).toBe(false);
    expect(v.reason).toContain("crashed");
  });

  test("blocked with fewer than K runs on the candidate — silence is not evidence", () => {
    const v = promoteGate(newestFirst(run("0.14.0", "healthy", 1), run("0.13.0", "healthy", 0)), "0.14.0");
    expect(v.cleared).toBe(false);
  });

  test("runs on other versions are ignored, not counted against the candidate", () => {
    const v = promoteGate(
      newestFirst(run("0.14.0", "healthy", 3), run("0.13.0", "unhealthy", 2), run("0.14.0", "healthy", 1)),
      "0.14.0",
    );
    expect(v.cleared).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/loop/promote.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/loop/promote.ts`**

```ts
/**
 * The canary gate. A version reaches consumers only after the engineer — the
 * one vault running the `next` channel — has sealed K consecutive healthy (or
 * no-op) runs on it. Computed from runs.jsonl alone: the same records a bad
 * loop prompt cannot forge. Fewer than K runs is a block, not a pass; silence
 * is not evidence.
 */
import type { LoopRunRecord } from "./health.js";

export interface PromoteVerdict {
  cleared: boolean;
  reason: string;
}

export function promoteGate(runs: LoopRunRecord[], version: string, k = 2): PromoteVerdict {
  const onVersion = runs.filter((r) => r.loopVersion === version); // runs is newest-first
  if (onVersion.length < k) {
    return { cleared: false, reason: `only ${onVersion.length}/${k} sealed run(s) on v${version} — keep canarying` };
  }
  const window = onVersion.slice(0, k);
  const bad = window.find((r) => r.verdict !== "healthy" && r.verdict !== "no-op");
  if (bad) {
    return { cleared: false, reason: `run ${bad.runId} on v${version} sealed ${bad.verdict} — not promotable` };
  }
  return { cleared: true, reason: `${k} consecutive healthy run(s) on v${version}` };
}
```

- [ ] **Step 4: Add the CLI subcommand**

In `src/cli/loop.ts`:

```ts
  loop
    .command("promote")
    .description("check (and with --execute, apply) the canary gate: move the latest dist-tag to this version")
    .option("--vault <dir>", "engineer vault directory", ".")
    .option("--version <v>", "candidate version", VERSION)
    .option("--execute", "run `npm dist-tag add` when the gate clears (needs npm auth)")
    .action((opts: { vault: string; version: string; execute?: boolean }) => {
      const verdict = promoteGate(readRuns(opts.vault), opts.version);
      if (!verdict.cleared) {
        console.error(`promote: BLOCKED — ${verdict.reason}`);
        process.exitCode = 1;
        return;
      }
      console.log(`promote: CLEARED — ${verdict.reason}`);
      if (opts.execute) {
        const r = spawnSync("npm", ["dist-tag", "add", `ost-agent@${opts.version}`, "latest"], { stdio: "inherit" });
        process.exitCode = r.status ?? 1;
      }
    });
```

Import to add: `promoteGate` from `../loop/promote.js` (`spawnSync` is already imported for `step`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/loop/promote.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/loop/promote.ts src/cli/loop.ts test/loop/promote.test.ts
git commit -m "feat(loop): promote gate — K consecutive healthy canary runs move latest, silence blocks"
```

---

### Task 9: Full-firing integration test, docs, and rollout notes

**Files:**
- Create: `test/loop/firing.test.ts`
- Create: `docs/reference/loop-bootstrap.md`
- Modify: `README.md` (add a "Self-bootstrapping loop" section), `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above, through the CLI only (this is the spec's integration test: a scripted firing against a temp vault, including a failed phase and a simulated crash — the crash and failure cases already live in `test/cli/loop.test.ts`, so this file covers the happy no-op firing plus the engineer surface).

- [ ] **Step 1: Write the integration test**

```ts
// test/loop/firing.test.ts
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { readRuns } from "../../src/loop/health.js";

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-loop-firing-"));
  await initVault(dir, "Reach 10k DAU");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function cli(args: string[]) {
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("a full scripted firing", () => {
  test("dry vault: prompt → start → preflight(no-op) → seal, health record tells the story", async () => {
    const { stdout: prompt } = await cli(["loop", "--vault", dir]);
    expect(prompt).toContain("Phase 1 — Preflight");

    await cli(["loop", "start", "--vault", dir]);
    const { stdout: pre } = await cli(["loop", "preflight", "--vault", dir]);
    expect(pre).toContain("no-op");
    await cli(["loop", "seal", "--vault", dir]);

    const [sealed] = readRuns(dir);
    expect(sealed.verdict).toBe("no-op");
    expect(sealed.loopVersion).toBeTruthy();
  }, 120_000);

  test("engineer vault renders fleet phase and the fleet rollup files evidence", async () => {
    const cfgPath = path.join(dir, "ost.config.yaml");
    fs.appendFileSync(cfgPath, `\nloop:\n  role: engineer\n  channel: next\n  fleetVaults: []\n`);

    const { stdout: prompt } = await cli(["loop", "--vault", dir]);
    expect(prompt).toContain("Fleet review");

    await cli(["loop", "fleet", "--vault", dir, "--file-evidence"]);
    const inbox = path.join(dir, ".ost-agent", "inbox");
    expect(fs.readdirSync(inbox).some((f) => f.includes("fleet-health"))).toBe(true);
  }, 120_000);
});
```

- [ ] **Step 2: Run it, then the whole suite**

Run: `npx vitest run test/loop/firing.test.ts && npx vitest run`
Expected: PASS everywhere. Fix anything the full suite surfaces before continuing (e.g., an init/first-run test asserting the exact scaffolded YAML).

- [ ] **Step 3: Write `docs/reference/loop-bootstrap.md`**

```markdown
# The 3-line bootstrap

Every scheduled loop — cloud routine, cron, any harness — gets this prompt and
nothing else. It never changes again; the loop structure it fetches does.

> Run `npx -y ost-agent@latest loop --vault <vault-repo-or-path>`.
> Follow the instructions it prints exactly, then stop.
> If the command itself fails, report the error and stop.

A vault pinned via `loop.pin` in `ost.config.yaml` swaps `@latest` for the pin.
The engineer vault (role: engineer, channel: next) uses `@next` instead — it
canaries every loop change on itself before `ost-agent loop promote` moves the
`latest` dist-tag (gate: 2 consecutive healthy sealed runs on the candidate).

## Health is CLI-stamped

Loop firings bracket themselves with `loop start` / `loop seal` and wrap phase
commands in `loop step`, which records observed exit codes into
`.ost-agent/health/runs.jsonl` (append-only). There is no verdict flag: seal
computes it. A firing that dies mid-run is recorded as `crashed` by the next
one; a skipped phase seals `unhealthy`. `loop fleet` folds these records across
vaults into the per-version evidence the engineer's tree decides from.

## Operator rollout (one-time, per fleet)

1. Replace each scheduled loop's prompt with the 3 lines above (engineer and
   consumers as separate schedules).
2. Add the `loop:` block to each vault's `ost.config.yaml`; exactly one vault
   is `role: engineer` / `channel: next` and lists the others in `fleetVaults`.
3. Publish loop changes to the `next` dist-tag; `loop promote --execute` moves
   `latest` only through the gate.
```

- [ ] **Step 4: Update README and CHANGELOG**

README: add a short "Self-bootstrapping loop" section after the existing CLI/usage docs — the 3-line bootstrap verbatim, one paragraph on CLI-stamped health, one on the canary gate, link to `docs/reference/loop-bootstrap.md`. Match the README's existing tone and heading style.

CHANGELOG: add an entry under the next version heading listing: `loop` command group (prompt/start/step/decide/preflight/seal/fleet/promote), `loop:` config block, append-only health records, canary promote gate.

- [ ] **Step 5: Commit**

```bash
git add test/loop/firing.test.ts docs/reference/loop-bootstrap.md README.md CHANGELOG.md
git commit -m "feat(loop): full-firing integration test + bootstrap and rollout docs"
```

---

### Post-merge operator steps (not code — for Tanner or a session acting with his approval)

1. Release: version bump, publish to npm under the `next` dist-tag first (see RELEASING.md; cloud runs without npm auth leave the release commit for local publish).
2. Vault config: add `loop:` blocks — `~/ost-agent-meta` gets `role: engineer`, `channel: next`, `productRepo` pointing at the OST-Agent clone, `fleetVaults: [<tetrix-ost path>]`; `~/dev/tetrix-ost` gets `productRepo` pointing at the tetrix monorepo. `git pull` both vaults before editing, push after.
3. Routines: replace cloud routine `trig_01NnXjz73ckYf9miea3FF1X9` with two routines (engineer + Tetrix consumer) whose entire prompt is the 3-line bootstrap. Manage at https://claude.ai/code/routines.
4. First promotion: after 2 healthy engineer firings, `ost-agent loop promote --vault ~/ost-agent-meta --execute`.

## Self-review notes

- Spec coverage: config/pin (T1), health + crash + omission (T2/T3), preflight gates incl. churn-prevention no-op (T4), shipped versioned ruleset + linter (T5), per-role rendering + bare `loop` entry point (T6), fleet aggregation → evidence (T7), canary/promote/rollback lever (T8; rollback itself is `npm dist-tag add` back — documented, no code), integration + docs + rollout (T9). The spec's "failed pass exits 0" prerequisite is verified already fixed (`f091b04`).
- Spec deviation, deliberate: `LOOP_RULESET` is a TS knowledge module (repo pattern: `src/knowledge/ruleset.ts`), not a literal `.md` file; the spec's intent (versioned, shipped, linted, rendered) is preserved.
- E2E-against-published-package is intentionally left to the existing release verification pattern rather than CI (needs a registry fetch); the integration test drives the same surface via tsx.
