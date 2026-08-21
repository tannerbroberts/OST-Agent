/**
 * Shared pieces for tests that time real work on a deliberately busy machine.
 *
 * Three things every such test needs and none should reinvent: a vault of a
 * fixed shape to time against (`bench`), a way to make the box busy that is
 * the real article rather than a stand-in (`spinners` — forked processes that
 * do nothing but burn CPU, which is what a CI runner executing test files in
 * parallel does to a benchmark sharing it), and the two statistics a
 * contention experiment reads (`median`, `spread`).
 *
 * Not under `src/`: the only callers are instruments, and a `src/` module with
 * only test callers is the dead-code shape `test/release/module-reachability.test.ts`
 * exists to catch. Not collected by vitest either — `vitest.config.ts` includes
 * `test/**\/*.test.ts` and this is not one.
 *
 * `scripts/harvest-perf-noise-corpus.ts` and
 * `test/telemetry/same-run-baseline-ratio.test.ts` each carry their own copy of
 * these; they predate this file and are left as they are.
 */
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import type { OstNode } from "../../src/ost/node.js";
import type { Vault } from "../../src/ost/vault.js";
import { buildLargeTree, type LargeTreeShape } from "../ost/fixture-vault.js";

export interface Bench {
  vault: Vault;
  dir: string;
  tree: OstNode[];
}

/** A fresh vault under a temp dir, filled by `buildLargeTree` with a fixed seed. */
export async function bench(shape: LargeTreeShape, outcome: string, prefix = "ost-contention-"): Promise<Bench> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  await initVault(dir, "Reach ten thousand daily active users", outcome);
  const ctx = buildPassContext(dir);
  buildLargeTree(ctx.vault, outcome, shape);
  return { vault: ctx.vault, dir, tree: ctx.vault.readTree() };
}

export function removeBench(b: Bench | undefined): void {
  if (b) fs.rmSync(b.dir, { recursive: true, force: true });
}

// ── the busy machine ─────────────────────────────────────────────────────────

const SPINNER_SRC = "let x = 0;\nfor (;;) { x = (x + Math.sqrt(x % 1e6)) % 1e9; }\n";

/** `count` child processes that each pin one core until killed. Zero forks nothing. */
export function spinners(count: number): ChildProcess[] {
  if (count <= 0) return [];
  const file = path.join(os.tmpdir(), `ost-contention-spinner-${process.pid}.mjs`);
  fs.writeFileSync(file, SPINNER_SRC, "utf8");
  return Array.from({ length: count }, () => fork(file, { stdio: "ignore" }));
}

export function stopSpinners(children: ChildProcess[]): void {
  for (const c of children) c.kill("SIGKILL");
}

/** Let forked spinners actually get scheduled (or actually die) before timing anything. */
export function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── statistics ───────────────────────────────────────────────────────────────

export function median(xs: number[]): number {
  if (xs.length === 0) throw new Error("median of nothing");
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * How far the largest reading sits above the smallest, as a fraction: 0 when
 * every reading is equal, 0.5 when the largest is 1.5× the smallest.
 */
export function spread(xs: number[]): number {
  if (xs.length === 0) throw new Error("spread of nothing");
  return Math.max(...xs) / Math.min(...xs) - 1;
}
