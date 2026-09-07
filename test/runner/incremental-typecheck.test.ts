/**
 * Time a single-file check against the whole-project run it would replace.
 *
 * The assumption test beneath "Typecheck the files just touched, at the moment
 * they are touched" fixed its bar before anything was built, and this file is
 * held to it verbatim ({@link INCREMENTAL_TYPECHECK_BAR.threshold}):
 *
 *   *A single-file check over `src/security/tools.ts` reports the TS2339 on
 *   `configProblem` and returns in under 2 seconds, while the whole-project
 *   `tsc --noEmit` it replaces takes longer than 10 seconds on the same machine.*
 *
 * ## The subject, and why it is manufactured rather than found
 *
 * `configProblem` is on `ToolContext` today — `3c21e4d` put it there, which is
 * the commit that closed the failure the transcript recorded. So the mid-edit
 * state has to be reconstructed, and it is reconstructed by one deterministic
 * textual operation on the committed file: delete the member declaration and keep
 * every use of it. That is an ordinary edit — a member removed, a use site
 * forgotten — and it produces the same compiler error the session hit from the
 * other direction (a use written, the member not yet declared). The test asserts
 * the committed file is clean before the edit, so the diagnostic it then finds
 * belongs to the edit and to nothing else.
 *
 * The recorded error was `src/security/tools.ts(744,63)`. The file is 2545 lines
 * now and the use site is at 2416; the identity being reproduced is the code, the
 * type and the member, not the line number, and the spec pins those three.
 *
 * ## The half of the bar measurement refuted
 *
 * **The whole-project run does not take longer than 10 seconds on this machine.**
 * `npx tsc --noEmit` over this repository's 262 files takes 1.6–2.1 s (three runs
 * on 2026-09-03: 2.05, 1.67, 1.64), and the same program built in-process takes
 * ~1.3 s. The node's threshold named 10 s as the thing to beat and the margin it
 * assumed does not exist: the check is ~1.6× cheaper cold and ~5× cheaper warm,
 * not five to ten times cheaper. That number is *reported* by this spec and not
 * asserted — an `expect()` that a machine is slow is a check a fast machine fails
 * — and what is asserted instead is the same-run ratio, which is what the node's
 * own reasoning says survives a busy box.
 *
 * So the argument that survives for moving the check earlier is **attribution**,
 * not speed: the same second of compute, spent per edit instead of per batch,
 * buys a diagnostic that names the edit that caused it. A reader deciding whether
 * to adopt this should decide on that, and the tree should hear it.
 *
 * ## Why the 2000 ms is scaled and not a stopwatch
 *
 * The first version of this spec asserted the node's 2000 ms flat. It passed
 * alone (909 ms) and failed inside a full `npx vitest run` at 3194 ms — while the
 * whole-project program in the same process took 8366 ms against 1300 ms idle. A
 * 6× slower box convicted a check that had not changed, which is this
 * repository's most expensive recurring mistake and has its own branch of the
 * tree. The budget below is therefore the node's number multiplied by that
 * measured contention factor and never narrowed below it: an idle machine is held
 * to 2000 ms exactly, a demonstrably six-times-slower machine gets six times the
 * budget, and a regression in the check itself fails either way.
 *
 * ## What a green run here does NOT settle
 *
 * The node says it, and it is worth repeating where the numbers are: this
 * settles cost and detection. It does not show that a run handed the diagnostic
 * does anything different, and it says nothing about the false-positive rate
 * mid-refactor — a run legitimately broken between two edits — which is the
 * failure most likely to make this unbearable. That needs a batch of real edits
 * observed end to end. It is also why `scripts/typecheck-touched.ts` exists and
 * is not wired into `.claude/settings.json`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import {
  formatVerdict,
  INCREMENTAL_TYPECHECK_BAR,
  TouchedFileChecker,
  type TypecheckVerdict,
} from "../../src/runner/incremental-typecheck.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const subject = path.join(repoRoot, INCREMENTAL_TYPECHECK_BAR.file);

/** The committed file, and the same file with the member declaration deleted. */
const committed = fs.readFileSync(subject, "utf8");
const DECLARATION = `  ${INCREMENTAL_TYPECHECK_BAR.member}?: string;\n}`;
const edited = committed.replace(DECLARATION, "}");

/** How many times a timing is taken before the fastest one is believed. */
const SAMPLES = 3;

// ── the bar, before anything is measured ─────────────────────────────────────

describe("the threshold is the node's, pinned in source rather than retyped here", () => {
  test("the error being reproduced is the one the transcript recorded", () => {
    expect(INCREMENTAL_TYPECHECK_BAR.file).toBe("src/security/tools.ts");
    expect(INCREMENTAL_TYPECHECK_BAR.code).toBe(2339);
    expect(INCREMENTAL_TYPECHECK_BAR.type).toBe("ToolContext");
    expect(INCREMENTAL_TYPECHECK_BAR.member).toBe("configProblem");
    expect(INCREMENTAL_TYPECHECK_BAR.budgetMs).toBe(2000);
  });

  test("the mid-edit state is one deterministic deletion from the committed file", () => {
    // If this stops matching, the subject has moved and every number below is
    // measuring something else. Failing here is the honest outcome.
    expect(committed).toContain(DECLARATION);
    expect(edited).not.toBe(committed);
    expect(edited.length).toBe(committed.length - `  ${INCREMENTAL_TYPECHECK_BAR.member}?: string;\n`.length);
    // The use site is kept: the edit removes the declaration, not the reference.
    expect(edited).toContain(`ctx.${INCREMENTAL_TYPECHECK_BAR.member}`);
  });
});

// ── THE INSTRUMENT ───────────────────────────────────────────────────────────

describe("a check scoped to the touched file, against the whole-project run it replaces", () => {
  let cold: TypecheckVerdict;
  let coldMs: number;
  let clean: TypecheckVerdict;
  let warmMs: number;
  let whole: TypecheckVerdict;
  let wholeMs: number;
  /** The warm checker, reused by the tests below rather than rebuilt. */
  let checker: TouchedFileChecker;

  beforeAll(() => {
    // Cold: a checker that has parsed nothing, which is what a hook spawning a
    // fresh process per edit gets on every single edit. Fastest of
    // {@link SAMPLES}, because this suite runs on a contended laptop two thirds
    // of the time and the number under test is the cost of the work, not the
    // cost of whatever else the box was doing during one sample.
    coldMs = Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      const verdict = new TouchedFileChecker({ projectRoot: repoRoot }).check([{ path: subject, source: edited }]);
      if (i === 0) cold = verdict;
      coldMs = Math.min(coldMs, verdict.elapsedMs);
    }

    checker = new TouchedFileChecker({ projectRoot: repoRoot });
    clean = checker.check([{ path: subject, source: committed }]);

    // Warm: the steady state of a checker that stays alive across edits.
    warmMs = Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      warmMs = Math.min(warmMs, checker.check([{ path: subject, source: edited }]).elapsedMs);
    }

    // The whole-project run: same process, same overlay, same host, and warm on
    // both sides — the parses the narrow checks just did are the ones it needs.
    //
    // ONCE, not fastest-of-N, and the reason is this file's obligation to the
    // suite it runs inside rather than a shortcut. A whole-project program is the
    // largest allocation anything here makes, and this file is a load spike in a
    // pool of workers where other files are timing themselves. A second run
    // moved the figure by 5% (1323 ms → 1259 ms) and cost another one of them.
    whole = checker.checkWholeProject([{ path: subject, source: edited }]);
    wholeMs = whole.elapsedMs;
  }, 180_000);

  test("DETECTION — the TS2339 the transcript recorded, attached to the edit", () => {
    const found = cold.diagnostics.find((d) => d.code === INCREMENTAL_TYPECHECK_BAR.code);
    expect(found, `no TS2339 in: ${cold.diagnostics.map((d) => d.text).join(" | ") || "(nothing)"}`).toBeDefined();
    expect(found?.file).toBe(INCREMENTAL_TYPECHECK_BAR.file);
    expect(found?.message).toBe(
      `Property '${INCREMENTAL_TYPECHECK_BAR.member}' does not exist on type '${INCREMENTAL_TYPECHECK_BAR.type}'.`,
    );
    expect(found?.category).toBe("error");
  });

  test("the committed file is clean, so the diagnostic belongs to the edit", () => {
    // Without this the detection above proves nothing: a check that reports the
    // same error before and after has found a property of the repository, not a
    // consequence of the edit.
    expect(clean.diagnostics).toEqual([]);
  });

  test("COMPLETENESS — it reports what the whole-project run reports, no more and no less", () => {
    // The assumption is "quick AND complete enough": it has to report the same
    // error the batch-end run would have. Both sides are the same overlay in the
    // same process, so this is the comparison and not an approximation of it.
    //
    // The identity is file and code, not file and line: a line number here would
    // put this spec into every future diff that touches the top of either file,
    // and the next run to see it red would be reading a real failure as
    // maintenance. Where the diagnostic lands is asserted below, derived from the
    // source rather than typed in.
    const identity = (d: { file: string; code: number }) => `${d.file} TS${d.code}`;
    expect(cold.diagnostics.map(identity).sort()).toEqual(whole.diagnostics.map(identity).sort());
    // Two, not one: the edit breaks the file it touched and one of its importers.
    expect(whole.diagnostics.map(identity).sort()).toEqual(["src/mcp/server.ts TS2353", "src/security/tools.ts TS2339"]);
  });

  test("the diagnostic lands on the use site the edit orphaned", () => {
    // Derived from the buffer that was checked, so it stays true as the file
    // grows: the transcript's error was at line 744 of a file that is 2545 lines
    // now, and what is being reproduced is the use site, not the line number.
    const useSite = edited.split("\n").findIndex((l) => l.includes(`ctx.${INCREMENTAL_TYPECHECK_BAR.member}`)) + 1;
    expect(useSite).toBeGreaterThan(0);
    const found = cold.diagnostics.find((d) => d.code === INCREMENTAL_TYPECHECK_BAR.code);
    expect(found?.line).toBe(useSite);
    expect(found?.text).toContain(`${INCREMENTAL_TYPECHECK_BAR.file}(${useSite},`);
  });

  test("the immediate importers are load-bearing — without them the check reads half-clean", () => {
    // This is why "the file just touched" is not the whole scope. Scoped to the
    // touched file alone the check finds the TS2339 and misses the TS2353 in
    // `src/mcp/server.ts` entirely, which is a sweep reporting a clean result
    // over a subject it did not read.
    // On the warm checker, deliberately: a fresh one would say the same thing
    // and cost another cold program, and this file already builds more of them
    // than anything else in the suite.
    const narrow = checker.check([{ path: subject, source: edited }], { dependents: false });
    expect(narrow.dependents).toEqual([]);
    expect(narrow.diagnostics.map((d) => d.code)).toEqual([INCREMENTAL_TYPECHECK_BAR.code]);
    expect(cold.dependents).toContain("src/mcp/server.ts");
  });

  test(`COST — the check returns inside the node's ${INCREMENTAL_TYPECHECK_BAR.budgetMs} ms budget, scaled by this machine's contention`, () => {
    // The node's affordability half, applied to a cold checker: "a check that
    // adds seconds to every edit will be turned off within a week".
    //
    // The scaling is not a softened bar, and this is the place to say exactly
    // what it is. A bare 2000 ms ceiling here failed inside a full `npx vitest
    // run` — 3194 ms cold, while the whole-project program in the same process
    // took 8366 ms against 1300 ms idle — so what the ceiling convicted was the
    // other 379 test files, not this check. This repository has been round that
    // loop before and wrote down the answer (`test/telemetry/same-run-baseline-ratio.test.ts`):
    // make the measurement robust to contention rather than move away from it.
    // So the budget is multiplied by how much slower the whole-project run is
    // here than on the machine the node's number was stated for, and never
    // narrowed below it — an idle machine is held to 2000 ms exactly, and a 3×
    // regression on an idle machine still fails.
    const contention = Math.max(1, wholeMs / INCREMENTAL_TYPECHECK_BAR.wholeProjectReferenceMs);
    expect(
      coldMs,
      `fastest of ${SAMPLES} cold checks took ${Math.round(coldMs)} ms against a budget of ` +
        `${Math.round(INCREMENTAL_TYPECHECK_BAR.budgetMs * contention)} ms ` +
        `(${INCREMENTAL_TYPECHECK_BAR.budgetMs} ms × ${contention.toFixed(1)} contention, from a whole-project run of ` +
        `${Math.round(wholeMs)} ms against ${INCREMENTAL_TYPECHECK_BAR.wholeProjectReferenceMs} ms idle)`,
    ).toBeLessThan(INCREMENTAL_TYPECHECK_BAR.budgetMs * contention);
  });

  test(`MARGIN — warm, it beats the whole-project run by at least ${INCREMENTAL_TYPECHECK_BAR.minSpeedup}x in the same run`, () => {
    const speedup = wholeMs / warmMs;
    expect(
      speedup,
      `warm ${Math.round(warmMs)} ms vs whole project ${Math.round(wholeMs)} ms = ${speedup.toFixed(1)}x. ` +
        `The node claimed the whole-project run takes >${INCREMENTAL_TYPECHECK_BAR.wholeProjectFloorMsClaimed} ms; ` +
        `it took ${Math.round(wholeMs)} ms, which is the half of its threshold measurement refuted.`,
    ).toBeGreaterThanOrEqual(INCREMENTAL_TYPECHECK_BAR.minSpeedup);
  });

  test("REPORTED, NOT ASSERTED — what the whole-project run actually costs here", () => {
    // The node's threshold said >10 s. Nothing asserts that, in either
    // direction: a ceiling on somebody else's machine is a check contention
    // decides. What is asserted is that the baseline is slow enough to be worth
    // measuring against at all, which is true at any speed the ratio is real at.
    expect(wholeMs).toBeGreaterThan(warmMs);
    // eslint-disable-next-line no-console
    console.log(
      `[incremental-typecheck] cold ${Math.round(coldMs)} ms, warm ${Math.round(warmMs)} ms, ` +
        `whole project ${Math.round(wholeMs)} ms (node claimed >${INCREMENTAL_TYPECHECK_BAR.wholeProjectFloorMsClaimed} ms), ` +
        `speed-up ${(wholeMs / warmMs).toFixed(1)}x warm, ${(wholeMs / coldMs).toFixed(1)}x cold`,
    );
  });

  test("the verdict a run is handed names the diagnostics, the scope and the limit", () => {
    const text = formatVerdict(cold);
    expect(text).toContain("advisory, not a gate");
    expect(text).toContain("Property 'configProblem' does not exist on type 'ToolContext'.");
    expect(text).toContain("immediate dependent(s)");
    expect(text).toContain("transitive dependent");
    // A clean edit says nothing at all — a per-edit check that narrates its own
    // success on every write is one somebody turns off.
    expect(formatVerdict(clean)).toBe("");
  });
});

// ── the command a write boundary calls ───────────────────────────────────────

describe("the hook entry point", () => {
  test("it prints the advisory verdict and still exits 0", () => {
    // Advisory, not a refusal: the node's shape, and the reason `tsc --noEmit`
    // stays the gate. Run against the committed tree, so it must be silent.
    const out = execFileSync("npx", ["tsx", "scripts/typecheck-touched.ts", "--always", INCREMENTAL_TYPECHECK_BAR.file], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toContain("clean");
    expect(out).toContain(INCREMENTAL_TYPECHECK_BAR.file);
  }, 120_000);

  test("a path outside the TypeScript project is not checked and not an error", () => {
    const out = execFileSync("npx", ["tsx", "scripts/typecheck-touched.ts", "--always", "README.md"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toContain("no named file is in the TypeScript project");
  }, 120_000);
});
