/**
 * Shipping on locally-earned evidence.
 *
 * The property under test is not "the gates pass" — it is that a merge is
 * IMPOSSIBLE without an exit code something watched, and that the watching
 * cannot be laundered. The failure this replaces was the opposite shape: a
 * merge conditional on `gh pr checks --watch`, which on 2026-08-06 left four
 * finished branches open for four hours because GitHub acquired no runner, and
 * which the tree records being polled across fourteen distinct pull requests.
 *
 * Everything here drives an injected runner, so no test spawns a process, runs
 * a suite, or touches a repository.
 */
import { describe, expect, test } from "vitest";
import {
  CONDITIONAL_GATES,
  CORE_GATES,
  gatesFor,
  redGate,
  runGates,
  shipRefusals,
  summarize,
  tail,
  type Gate,
  type Runner,
} from "../../src/release/ship.js";

/** A runner that answers from a table and records what it was asked to run. */
function fakeRunner(answers: Record<string, { status: number | null; output: string }>) {
  const calls: string[][] = [];
  const run: Runner = (argv) => {
    calls.push([...argv]);
    const key = argv.join(" ");
    return answers[key] ?? { status: 0, output: "" };
  };
  return { run, calls };
}

describe("no gate can be laundered", () => {
  test("every gate is argv, never a shell string", () => {
    for (const gate of [...CORE_GATES, ...CONDITIONAL_GATES]) {
      expect(gate.argv.length).toBeGreaterThan(1);
      // The laundering failure this repository actually suffered was
      // `bash -c "npx vitest run 2>&1 | tail -25"`, which recorded exit 0 while
      // vitest was not installed. No gate may be handed to an interpreter.
      expect(["sh", "bash", "zsh", "dash", "ksh", "ash"]).not.toContain(gate.argv[0]);
      for (const arg of gate.argv) {
        expect(arg).not.toContain("|");
        expect(arg).not.toContain("&&");
        expect(arg).not.toContain(";");
      }
    }
  });

  test("a command that never started is red, not green", () => {
    // spawn failure gives a null status. Read as "not non-zero" that would pass.
    const { run } = fakeRunner({ "npx tsc --noEmit": { status: null, output: "spawn ENOENT" } });
    const [first] = runGates(CORE_GATES, "/repo", run);
    expect(first!.passed).toBe(false);
    expect(first!.exitCode).toBeNull();
  });
});

describe("which gates apply", () => {
  test("a docs-only branch runs the core gates and no generator", () => {
    const gates = gatesFor(["README.md", "docs/reference/v1-readiness.md"]);
    expect(gates.map((g) => g.name)).toEqual(["tsc", "vitest"]);
  });

  test("touching src/ adds the bundle-drift gate, because the plugin launches the committed bundle", () => {
    const gates = gatesFor(["src/ost/search.ts"]);
    expect(gates.map((g) => g.name)).toEqual(["tsc", "vitest", "bundle-drift"]);
  });

  test("touching the ruleset adds the skill gate too", () => {
    const gates = gatesFor(["src/knowledge/ruleset.ts"]);
    expect(gates.map((g) => g.name)).toEqual(["tsc", "vitest", "bundle-drift", "skill-drift"]);
  });

  test("the gates are the same commands CI runs, so local gating is not a weaker bar", () => {
    // If CI's commands and these ever diverge, one of the two is measuring
    // something nobody asked for. Pinning the strings is how that gets noticed.
    expect(CORE_GATES.map((g) => g.argv.join(" "))).toEqual(["npx tsc --noEmit", "npx vitest run"]);
  });
});

describe("what refuses before any gate runs", () => {
  const base = { branch: "feature", defaultBranch: "main", dirty: false, ahead: 2 };

  test("a clean branch with commits is eligible", () => {
    expect(shipRefusals(base)).toEqual([]);
  });

  test("main may not be shipped into itself", () => {
    const reasons = shipRefusals({ ...base, branch: "main" });
    expect(reasons.join(" ")).toContain("IS the default branch");
  });

  test("a dirty tree refuses, because the gates would measure what does not merge", () => {
    const reasons = shipRefusals({ ...base, dirty: true });
    expect(reasons.join(" ")).toContain("uncommitted changes");
  });

  test("a branch with nothing to merge refuses", () => {
    const reasons = shipRefusals({ ...base, ahead: 0 });
    expect(reasons.join(" ")).toContain("nothing to merge");
  });

  test("every reason is reported at once, not just the first", () => {
    // An unattended caller gets one report. Fixing one precondition only to be
    // refused for the next is the loop this whole change exists to remove.
    const reasons = shipRefusals({ ...base, branch: "main", dirty: true });
    expect(reasons.length).toBe(2);
  });
});

describe("running the gates", () => {
  const gates: Gate[] = [
    { name: "one", argv: ["cmd", "one"], why: "first" },
    { name: "two", argv: ["cmd", "two"], why: "second" },
  ];

  test("stops at the first red, so the report names one thing to fix", () => {
    const { run, calls } = fakeRunner({ "cmd one": { status: 1, output: "boom" } });
    const runs = runGates(gates, "/repo", run);
    expect(runs).toHaveLength(1);
    expect(calls).toEqual([["cmd", "one"]]);
  });

  test("runs everything when everything is green", () => {
    const { run } = fakeRunner({});
    const runs = runGates(gates, "/repo", run);
    expect(runs.map((r) => r.passed)).toEqual([true, true]);
    expect(redGate(runs)).toBeUndefined();
  });

  test("keeps the TAIL of output, because a failing suite reports at the end", () => {
    const output = [...Array(60)].map((_, i) => `line ${i}`).join("\n");
    const { run } = fakeRunner({ "cmd one": { status: 1, output } });
    const [first] = runGates(gates, "/repo", run);
    expect(first!.excerpt).toContain("line 59");
    expect(first!.excerpt).not.toContain("line 5\n");
  });
});

describe("the summary a loop report carries", () => {
  test("a green run says it waited on nothing external", () => {
    const { run } = fakeRunner({});
    const runs = runGates(CORE_GATES, "/repo", run);
    const line = summarize("feature", [], runs);
    expect(line).toContain("shipped");
    expect(line).toContain("without waiting on any external check");
  });

  test("a red gate is named with its exit code and why it exists", () => {
    const { run } = fakeRunner({ "npx vitest run": { status: 1, output: "2 failed" } });
    const runs = runGates(CORE_GATES, "/repo", run);
    const line = summarize("feature", [], runs);
    expect(line).toContain("vitest");
    expect(line).toContain("exit 1");
    expect(line).toContain("not shipped");
  });

  test("a refusal outranks the gates in the summary", () => {
    const line = summarize("main", ["refusing to ship: it IS the default branch."], []);
    expect(line).toContain("not shipped");
    expect(line).toContain("default branch");
  });
});

describe("tail", () => {
  test("returns everything when the output is short", () => {
    expect(tail("a\nb")).toBe("a\nb");
  });
  test("drops trailing blank lines rather than counting them as content", () => {
    expect(tail("a\nb\n\n\n", 2)).toBe("a\nb");
  });
});
