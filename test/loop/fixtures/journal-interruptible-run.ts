/**
 * A real run that can be killed at an exact point, for the interruption spec.
 *
 * Argv: <vault> <killAt> <steps> <chunks>. The run opens through the real
 * `startRun`, does per-step "work" (appending `chunks` lines to an artifact
 * file, so a step's completion is checkable from disk afterwards), records
 * each step through the real `appendStep`, and seals through the real
 * `sealRun`. Before every atomic operation it counts, and when the counter
 * reaches `killAt` it SIGKILLs its own process — an uncatchable, no-cleanup
 * death at a point the parent chose, which is what makes ten "random" kills
 * reproducible under a seed.
 *
 * The operation grid the parent indexes into:
 *   op 0                      startRun
 *   ops 21(k-1)+1 … 21k-1     the k-th step's `chunks` artifact writes
 *   op 21k                    appendStep for step k   ← the understate window
 *   op 21·steps + 1           sealRun
 * (with chunks = 20; generally a step spans chunks+1 ops.)
 */
import fs from "node:fs";
import path from "node:path";
import { appendStep, sealRun, startRun } from "../../../src/loop/health.js";

const [vault, killAtArg, stepsArg, chunksArg] = process.argv.slice(2);
const killAt = Number(killAtArg);
const steps = Number(stepsArg);
const chunks = Number(chunksArg);
if (!vault || !Number.isInteger(killAt) || !Number.isInteger(steps) || !Number.isInteger(chunks)) {
  console.error("usage: journal-interruptible-run.ts <vault> <killAt> <steps> <chunks>");
  process.exit(2);
}

let op = 0;
/** Die before performing the op whose index is `killAt` — SIGKILL, no cleanup. */
function tick(): void {
  if (op === killAt) process.kill(process.pid, "SIGKILL");
  op += 1;
}

const artifactDir = path.join(vault, "steps");
fs.mkdirSync(artifactDir, { recursive: true });

tick();
startRun(vault, { loopVersion: "test", cliVersion: "test" });

for (let k = 1; k <= steps; k += 1) {
  const artifact = path.join(artifactDir, `step-${k}.txt`);
  for (let c = 1; c <= chunks; c += 1) {
    tick();
    fs.appendFileSync(artifact, `chunk ${c}\n`);
  }
  tick();
  appendStep(vault, { phase: `step-${k}`, command: `write artifact ${k}`, exit: 0, durationMs: 1 });
}

tick();
sealRun(vault, {});
