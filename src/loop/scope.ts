/**
 * Scope declaration and shortfall reporting — "Compare what the run attempted
 * against what it set out to do, and report the shortfall".
 *
 * **The mechanism is the timing, not the diff.** A run states its intended
 * scope before it knows whether the gate ahead of it will be difficult, and
 * that statement is then frozen: {@link declareScope} refuses once the run
 * already has a recorded step, because a step's exit code is the first
 * moment the gate's difficulty is known, and a declaration written after that
 * could be shaped by it. It also refuses a second declaration outright — a
 * scope is recorded once, never rewritten, for the same reason a claim is
 * released by a new record rather than an edit (`claim.ts`).
 *
 * At the end of the run, {@link computeShortfall} does not accept the
 * declared scope as an argument at all. It reads its own file off disk. A
 * function that took "declared" as a parameter would let a caller hand it a
 * restated version of the scope alongside a restated "attempted" and call
 * the (non-)difference clean — which is exactly the evasion this exists to
 * catch. There is deliberately no path from the seal side back to the
 * declaration except reading the frozen record.
 *
 * **What this does not settle, on purpose.** Narrowing is often correct: a
 * run that drops a branch after learning it was irrelevant produces the same
 * dropped-terms list as one that dropped it to get past a gate, and this
 * module does not tell them apart. It prints the difference next to the
 * result. That is the whole of it — no teeth, no verdict, a fact a reader can
 * act on or ignore.
 */
import fs from "node:fs";
import path from "node:path";
import { termsOf } from "./claim.js";
import { loopStateDir, requireLoopStateDir } from "./state.js";
import type { LoopRunRecord } from "./health.js";

export interface ScopeDeclaration {
  runId: string;
  /** What this run set out to do, in its own words, before the gate was known. */
  statement: string;
  declaredAt: string;
}

/**
 * Where one run's frozen scope declaration lives — under `.git/ost-agent/`,
 * beside the work-claim ledger and for the same reason: a file the unattended
 * MCP surface cannot reach is a file the agent cannot forge a redeclaration
 * into (see the Gate F enumeration, `OFF_GATE_DECIDER_MODULES`).
 */
export function scopePath(dir: string, runId: string): string {
  return path.join(requireLoopStateDir(dir), `scope-${runId}.json`);
}

/** The frozen declaration for one run, or null if none was ever recorded. */
export function readScope(dir: string, runId: string): ScopeDeclaration | null {
  const state = loopStateDir(dir);
  if (state === null) return null;
  const p = path.join(state, `scope-${runId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as ScopeDeclaration;
    return typeof parsed?.statement === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Record what this run set out to do, once.
 *
 * Refuses in the two ways the node's timing claim requires: a run that
 * already has a step on record has already learned something about the
 * gate, and a run that already declared a scope does not get to say it
 * again. Both are `Error`s rather than a return-value refusal, matching
 * `requireLoopStateDir` and `requireOpenRun` — a scope that could not be
 * declared must not be silently skipped by a caller that forgot to check.
 */
export function declareScope(dir: string, run: LoopRunRecord, statement: string, now: number = Date.now()): ScopeDeclaration {
  if (run.steps.length > 0) {
    throw new Error(
      `scope must be declared before this run's first step — ${run.steps.length} step(s) are already ` +
        `recorded for ${run.runId}, so whether the gate is difficult is already known and a declaration ` +
        "made now could be shaped by it rather than by what the run set out to do",
    );
  }
  if (readScope(dir, run.runId) !== null) {
    throw new Error(`run ${run.runId} already declared its scope — a scope is recorded once and never rewritten`);
  }
  const declaration: ScopeDeclaration = { runId: run.runId, statement, declaredAt: new Date(now).toISOString() };
  fs.writeFileSync(scopePath(dir, run.runId), JSON.stringify(declaration, null, 2));
  return declaration;
}

export interface ScopeShortfall {
  runId: string;
  /** The frozen declaration's own text, read off disk — never a restated one. */
  declared: string;
  attempted: string;
  /** Terms the declaration named that the attempt-statement does not. */
  dropped: string[];
  /** Terms the attempt-statement names that the declaration did not. Informational. */
  added: string[];
}

/**
 * Diff what a run attempted against what it declared, reading the
 * declaration from the frozen record rather than accepting it as an
 * argument.
 *
 * Null when this run never declared a scope — there is nothing to compare
 * against, and that is a fact worth being able to tell apart from "compared,
 * and nothing was dropped".
 */
export function computeShortfall(dir: string, runId: string, attempted: string): ScopeShortfall | null {
  const declaration = readScope(dir, runId);
  if (declaration === null) return null;
  const declaredTerms = new Set(termsOf(declaration.statement));
  const attemptedTerms = new Set(termsOf(attempted));
  return {
    runId,
    declared: declaration.statement,
    attempted,
    dropped: [...declaredTerms].filter((t) => !attemptedTerms.has(t)),
    added: [...attemptedTerms].filter((t) => !declaredTerms.has(t)),
  };
}

/**
 * The report a seal prints beside its result — a fact, not a verdict.
 *
 * Printed even when nothing was dropped, for the same reason `senseCensusReport`
 * prints every sense rather than only the bad ones: a shortfall report that
 * appears only when something looks wrong cannot be trusted to be silent
 * because nothing was, rather than because nobody declared a scope to check.
 */
export function shortfallReport(s: ScopeShortfall | null): string[] {
  if (s === null) return [];
  if (s.dropped.length === 0) {
    return [`scope: this run attempted everything it declared before the gate — "${s.declared}".`];
  }
  return [
    `scope shortfall: declared "${s.declared}" before the gate was known; attempted "${s.attempted}".`,
    `  dropped: ${s.dropped.join(", ")}`,
    "  Not a verdict — a run that reasonably drops a branch it found irrelevant reads the same as one that " +
      "dropped it to get past a gate. This is a fact printed next to the result, nothing more.",
  ];
}
