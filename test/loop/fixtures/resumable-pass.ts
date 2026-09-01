/**
 * A real pass over a real vault that can be killed at an exact instant, and
 * re-run to finish what it started.
 *
 * Argv: `<vault> <killAt>`. Every code path here is the shipping one — the
 * firing lock, `startRun`/`sealRun`, `runResumableSteps`, and `Vault`'s own
 * `createNode`/`linkNodes`/`appendToNode`. The only thing the test controls is
 * WHEN the process dies: an operation counter ticks at each instant the pass
 * can be interrupted at, and when it reaches `killAt` the process SIGKILLs
 * itself. Uncatchable, no cleanup, no handler — the same death a `kill -9` from
 * outside produces, at a point that is the same on every machine. `killAt` of
 * -1 never kills, which is the restart.
 *
 * The operation grid the test indexes into (6 steps, 3 instants each):
 *
 *   op 0                  before the lock is taken and the run opened
 *   op 3k+1               step k+1: entering `applied()` — nothing attempted yet
 *   op 3k+2               step k+1: entering `apply()` — intent journaled, no write
 *   op 3k+3               step k+1: leaving `apply()` — WRITTEN, not yet journaled
 *   op 19                 every step done, before the seal
 *   op 20                 sealed, before the lock is released
 *
 * `3k+3` is the interesting one and the reason the grid is shaped this way: it
 * is the instant between a step's effect landing on disk and the journal line
 * that records it. A resumer that trusts the journal alone re-runs that step —
 * which is a duplicated section for an append and a throw for a create. Six of
 * the twenty interruption points land there on purpose.
 *
 * Nothing here simulates a partial write. Every step is one atomic vault
 * effect, so the vault at any instant is before that effect or after it.
 */
import { acquireFiringLock, releaseFiringLock } from "../../../src/loop/lock.js";
import { sealRun, startRun } from "../../../src/loop/health.js";
import { runResumableSteps, resumeState, resumeSummary, type ResumableStep } from "../../../src/loop/resume.js";
import { Vault } from "../../../src/ost/vault.js";
import type { OstNode } from "../../../src/ost/node.js";
import { APPENDED_FILLER, APPENDED_SECTION, OPPORTUNITY, OUTCOME, SOLUTION } from "./resumable-pass-shape.js";

/** How long a firing lock may be held before it is assumed dead — well past this pass. */
const LOCK_TTL_MS = 15 * 60 * 1000;

const [vaultDir, killAtArg] = process.argv.slice(2);
const killAt = Number(killAtArg);
if (!vaultDir || !Number.isInteger(killAt)) {
  console.error("usage: resumable-pass.ts <vault> <killAt>");
  process.exit(2);
}

let op = 0;
function tick(): void {
  if (op === killAt) process.kill(process.pid, "SIGKILL");
  op += 1;
}

const vault = new Vault(vaultDir);

function node(title: string, layer: OstNode["layer"], body: string): OstNode {
  return { title, layer, status: "unvalidated", evidence: "assertion", tags: ["unvalidated"], links: [], body };
}

/**
 * One step, with its `applied()` and `apply()` wrapped in the counter so a kill
 * can land at either boundary. `applied()` ticks only on its first call: the
 * runner asks a second time as a post-condition, and a step whose grid moved
 * depending on how many times it was asked would make the twenty points mean
 * different instants on the restart than on the run that died.
 */
function step(id: string, applied: () => boolean, apply: () => void): ResumableStep {
  let asked = false;
  return {
    id,
    phase: "pass",
    command: id,
    applied() {
      if (!asked) {
        asked = true;
        tick();
      }
      return applied();
    },
    apply() {
      tick();
      apply();
      tick();
    },
  };
}

const steps: ResumableStep[] = [
  step(
    `create:${OPPORTUNITY}`,
    () => vault.has(OPPORTUNITY),
    () => vault.createNode(node(OPPORTUNITY, "Opportunity", "A need the scratch pass writes.")),
  ),
  step(
    `link:${OUTCOME}->${OPPORTUNITY}`,
    () => vault.read(OUTCOME).links.includes(OPPORTUNITY),
    () => vault.linkNodes(OUTCOME, OPPORTUNITY),
  ),
  step(
    `create:${SOLUTION}`,
    () => vault.has(SOLUTION),
    () => vault.createNode(node(SOLUTION, "Solution", "A candidate the scratch pass writes.")),
  ),
  step(
    `link:${OPPORTUNITY}->${SOLUTION}`,
    () => vault.read(OPPORTUNITY).links.includes(SOLUTION),
    () => vault.linkNodes(OPPORTUNITY, SOLUTION),
  ),
  step(
    `append:${SOLUTION}#finding`,
    () => vault.read(SOLUTION).body.includes(APPENDED_SECTION),
    () => vault.appendToNode(SOLUTION, `${APPENDED_SECTION}\n\n${APPENDED_FILLER}`),
  ),
  step(
    `append:${OPPORTUNITY}#finding`,
    () => vault.read(OPPORTUNITY).body.includes(APPENDED_SECTION),
    () => vault.appendToNode(OPPORTUNITY, `${APPENDED_SECTION}\n\n${APPENDED_FILLER}`),
  ),
];

tick();

const before = resumeState(vaultDir);
const lock = acquireFiringLock(vaultDir, { ttlMs: LOCK_TTL_MS, holderPid: process.pid });
if (!lock.ok) {
  console.error(`could not take the firing lock: ${lock.reason}`);
  process.exit(3);
}
const run = startRun(vaultDir, { loopVersion: "test", cliVersion: "test" });

const outcomes = runResumableSteps(vaultDir, steps);

tick();
sealRun(vaultDir, {});
tick();
releaseFiringLock(vaultDir, { pid: lock.record.pid, acquiredAt: lock.record.acquiredAt });

// One line of stdout the parent parses, written last so a killed run cannot
// emit one. Nothing is written into the vault: a scratch file beside the nodes
// would be residue this test then has to explain away.
console.log(JSON.stringify({ runId: run.runId, resumedFrom: before, summary: resumeSummary(before), outcomes }));
