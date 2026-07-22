/**
 * Bounded pass execution.
 *
 * runPass builds the process's allowlisted tool set, runs the fail-closed
 * destructive-tool guard BEFORE doing anything, executes the process, writes a
 * committed run-log, and creates exactly one new git commit capturing the pass
 * (pushing only if a remote is configured). Errors are caught and logged — a pass
 * never leaves a destructive state because there is no destructive operation.
 */
import fs from "node:fs";
import path from "node:path";
import { gitCommit, gitPush } from "../git/safe-git.js";
import { assertNoDestructiveTool } from "../security/policy.js";
import { buildOstTools } from "../security/tools.js";
import { emptyResult, type PassContext, type ProcessDef, type ProcessResult } from "../processes/types.js";
import type { PassDriver } from "./driver.js";

export interface PassOutcome {
  processId: string;
  result: ProcessResult;
  done: boolean;
  committed: boolean;
  sha: string;
  error?: string;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function commitMessage(p: ProcessDef, r: ProcessResult): string {
  const bits = [
    r.created ? `+${r.created} nodes` : "",
    r.linked ? `+${r.linked} links` : "",
    r.annotated ? `+${r.annotated} annotations` : "",
    r.evidence ? `+${r.evidence} evidence` : "",
  ].filter(Boolean);
  return `${p.id} ${p.title}: ${bits.length ? bits.join(", ") : "no changes"}`;
}

function writeRunLog(dir: string, entry: object): void {
  const runsDir = path.join(dir, ".ost-agent", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, `${nowStamp()}-${(entry as { processId: string }).processId}.json`), JSON.stringify(entry, null, 2), "utf8");
}

export async function runPass(process: ProcessDef, ctx: PassContext, driver: PassDriver): Promise<PassOutcome> {
  // Fail closed BEFORE any work: a process that even *declares* a tool outside
  // the allowlist is refused (not silently filtered), and the built set is
  // re-checked as belt-and-suspenders.
  assertNoDestructiveTool(process.allowedTools);
  const tools = buildOstTools({ vault: ctx.vault, dir: ctx.dir, remote: ctx.remote }, process.allowedTools);
  assertNoDestructiveTool(tools.map((t) => t.name));

  let result: ProcessResult = emptyResult();
  let error: string | undefined;
  try {
    result = await process.run(ctx, driver, tools);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const done = await process.isDone(ctx).catch(() => false);

  const entry = { processId: process.id, title: process.title, at: new Date().toISOString(), result, done, error: error ?? null };
  writeRunLog(ctx.dir, entry);

  const commit = await gitCommit(ctx.dir, commitMessage(process, result));
  if (ctx.remote.enabled && commit.committed) {
    await gitPush(ctx.dir).catch(() => undefined);
  }

  return { processId: process.id, result, done, committed: commit.committed, sha: commit.sha, error };
}
