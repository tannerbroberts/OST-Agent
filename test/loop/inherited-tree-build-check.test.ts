/**
 * A run checks that the tree it inherited actually builds before it plans any
 * work on it — and what that check costs.
 *
 * The observed failure behind this file: a merge conflict was committed,
 * markers and all, into `src/cli/index.ts`. The run that inherited it did not
 * inherit a disagreement to settle — it inherited a repository that does not
 * compile, formed a plan, began work, and only then found the hole. The
 * expensive part was never the conflict; it was a session's planning spent on
 * ground nobody had checked.
 *
 * Three claims, each pinned separately:
 *
 *  1. **The check itself** (`inheritedTreeBuildCheck`) answers builds / broken /
 *     unknown, names the commit the run inherited, and is fail-closed: a check
 *     that could not run is `unknown`, never `builds`. The gate is faked in
 *     these rows (the `Runner` is injectable, same as `runGates`), so what is
 *     under test is the verdict logic and the refusal text, not tsc.
 *  2. **The run refuses to plan on a red check.** The build loop
 *     (`examples/automation/build-pass.sh`) calls `build-check` after taking
 *     its lock and exits before the instrument preflight and before the model
 *     call. Asserted structurally against the script, the same way the rest of
 *     that script's invariants are pinned (`test/automation/
 *     build-pass-reports.test.ts`) — an end-to-end firing against a broken
 *     fixture repo would need `npx tsc` resolvable in a hermetic temp dir,
 *     which means a network install inside the suite.
 *  3. **The cost.** The tree's viability test bounds the tax at 30 seconds per
 *     run ("The check costs under 30 seconds…"). The final row runs the real
 *     check against this repository and holds it to that number. What this file
 *     deliberately does NOT settle is the other half of that threshold — the
 *     base rate of broken starts per 50 runs comes from history, not from a
 *     guard, and no committed test can observe it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  BUILD_CHECK_EXIT,
  TYPECHECK,
  formatBuildCheck,
  inheritedHead,
  inheritedTreeBuildCheck,
} from "../../src/release/inherited-tree.js";
import type { Runner } from "../../src/release/ship.js";

const root = path.resolve(__dirname, "../..");

let dir: string;
let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-inherited-tree-"));
  repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n", "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "the commit the run inherited");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A runner that never spawns — the gate's answer is the row's premise. */
const answers = (status: number | null, output = ""): Runner => () => ({ status, output });

describe("the check: builds / broken / unknown, with the inherited commit named", () => {
  test("a gate that exits 0 is `builds`, and the report says so in one green line", async () => {
    const r = await inheritedTreeBuildCheck(repo, answers(0));
    expect(r.verdict).toBe("builds");
    expect(r.exitCode).toBe(0);
    expect(r.head?.sha).toBe(git("rev-parse", "HEAD").trim());
    const report = formatBuildCheck(repo, r);
    expect(report).toMatch(/^inherited tree builds:/);
    expect(report).toContain('"the commit the run inherited"');
  });

  test("a gate that exits non-zero is `broken`, and the refusal names the commit and carries the output", async () => {
    const r = await inheritedTreeBuildCheck(repo, answers(2, "src/cli/index.ts(108,26): error TS2552: Cannot find name 'reconcileWithUsage'."));
    expect(r.verdict).toBe("broken");
    const report = formatBuildCheck(repo, r);
    // The three things the solution node says the refusal must say: this is
    // broken, here is what is broken, here is the commit it arrived at.
    expect(report).toMatch(/^inherited tree does not build/);
    expect(report).toContain("error TS2552");
    expect(report).toContain(git("rev-parse", "HEAD").trim().slice(0, 7));
    expect(report).toContain('"the commit the run inherited"');
  });

  test("a gate that never ran is `unknown`, never `builds` — fail-closed", async () => {
    // `runGates`' spawn contract: a command that could not start (ENOENT) has a
    // null status. Folding that into "builds" would clear a run against a tree
    // nothing vouched for, which is the same false clean `workingTreeStatus`
    // refuses at the working-tree level.
    const r = await inheritedTreeBuildCheck(repo, answers(null, "spawn npx ENOENT"));
    expect(r.verdict).toBe("unknown");
    expect(formatBuildCheck(repo, r)).toMatch(/could not be checked/);
    expect(formatBuildCheck(repo, r)).toMatch(/never assumed to build/);
  });

  test("a directory that is not a repository still refuses without throwing, head and all", async () => {
    const bare = path.join(dir, "not-a-repo");
    fs.mkdirSync(bare);
    expect(await inheritedHead(bare)).toBeNull();
    const r = await inheritedTreeBuildCheck(bare, answers(1, "error"));
    expect(r.verdict).toBe("broken");
    expect(formatBuildCheck(bare, r)).toMatch(/commit that could not be read/);
  });

  test("the gate is the typecheck — the cheapest useful form, not the suite", () => {
    // The viability test's own design: "time the check at its cheapest useful
    // form — a typecheck rather than a full build". A drift to `vitest run`
    // here would multiply the per-firing tax without anyone re-deciding it.
    expect(TYPECHECK.argv).toEqual(["npx", "tsc", "--noEmit"]);
  });

  test("only `builds` exits 0, so a wrapper gating on non-zero is fail-closed for free", () => {
    expect(BUILD_CHECK_EXIT.builds).toBe(0);
    expect(BUILD_CHECK_EXIT.broken).not.toBe(0);
    expect(BUILD_CHECK_EXIT.unknown).not.toBe(0);
    expect(BUILD_CHECK_EXIT.broken).not.toBe(BUILD_CHECK_EXIT.unknown);
  });
});

describe("the run refuses to plan work on a tree that fails its own check", () => {
  const script = fs.readFileSync(path.join(root, "examples/automation/build-pass.sh"), "utf8");
  const code = script
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  test("the build loop runs the check, and gates on its exit code rather than its prose", () => {
    expect(code).toMatch(/if ! BUILD_CHECK="\$\(node "\$CLI" build-check --repo "\$OST_AGENT_DIR"/);
  });

  test("the check runs before the instrument preflight, not just before the model call", () => {
    // The subtler half of the ordering: `verify` runs the repo's test runner,
    // and every instrument run against a repository that cannot compile comes
    // back red — a false red, recorded into the vault as a build permit nobody
    // issued. The check must therefore precede the first `verify`, not merely
    // the `claude` invocation.
    const check = code.indexOf('build-check --repo "$OST_AGENT_DIR"');
    const lock = code.indexOf('LOCK="$STATE/lock"');
    const preflight = code.indexOf("buildable --pending");
    const model = code.indexOf('claude -p "$(cat "$PROMPT_FILE")"');
    expect(check).toBeGreaterThan(lock);
    expect(preflight).toBeGreaterThan(check);
    expect(model).toBeGreaterThan(check);
  });

  test("the refusal reports, consumes the firing's window, and exits before anything is planned", () => {
    const from = code.indexOf('if ! BUILD_CHECK="$(node "$CLI" build-check');
    const to = code.indexOf("buildable --pending");
    const block = code.slice(from, to);
    // The report is the run's whole product on this path: this is broken, and
    // here is the named commit — the model is never invoked to say it better.
    expect(block).toMatch(/report "Build loop refused this firing: the repository it inherited does not build/);
    expect(block).toMatch(/\$BUILD_CHECK/);
    // The stamp: a broken repo has consumed its window, same as a crashing
    // build — without this the loop retries every tick and turns a bug into a bill.
    expect(block).toMatch(/echo "\$NOW" >"\$STAMP"/);
    expect(block).toMatch(/^\s*exit 0$/m);
  });
});

describe("what the check costs, measured rather than asserted", () => {
  test(
    "the real check on this repository clears — and comes in under the 30-second bound the tree recorded",
    async () => {
      // This row is the timing half of the tree's viability threshold ("The
      // check costs under 30 seconds"), run for real: tsc, this repo, wall
      // clock. It doubles as the check running on its own home — a broken main
      // reddens this row, which is precisely the state the check exists to name.
      const r = await inheritedTreeBuildCheck(root);
      expect(r.verdict).toBe("builds");
      expect(r.seconds).toBeLessThan(30);
    },
    45_000,
  );
});
