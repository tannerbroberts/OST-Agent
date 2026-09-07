/**
 * The compute-only lane, run — and the four ways a runner like this fabricates
 * evidence, each pinned shut.
 *
 * Run against a SEEDED vault rather than the live one, deliberately. The lane's
 * runnable set is empty by construction on both live vaults — only a human's
 * `ost-agent lane --set` moves a test into `compute-only`, and nobody has — so a
 * spec pointed at real data would go green having executed nothing, which is the
 * vacuous pass this project has already been bitten by once (`no-spec`, and the
 * 260 reds that turned out to be missing files). The fixture below holds known
 * compute-only tests and known traps beside them, so "ran the right ones" and
 * "refused the wrong ones" are both assertions with something behind them.
 *
 * No process is spawned. `runInstrument` takes an injected `SpawnRunner`, so the
 * observations here are recordings and the sort over them is the same code a
 * live run goes through.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  draftComputeLane,
  renderComputeLane,
  resultCommand,
  shellQuote,
  type ComputeLaneRun,
} from "../../src/loop/compute-lane.js";
import { serialize, type OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import type { SpawnRunner, SpawnedRun } from "../../src/ost/instrument.js";

const node = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links: [],
  body: "b",
  evidence: "assertion",
  ...extra,
});

/** A spec file that exists, so `runInstrument` does not short-circuit to no-spec. */
const green: SpawnedRun = { status: 0, stdout: "Test Files  1 passed (1)\n", stderr: "" };
const red: SpawnedRun = {
  status: 1,
  stdout: "FAIL  test/audit.test.ts > every recorded red names a spec that exists\n",
  stderr: "",
};

/**
 * The seeded tree. Three tests compute may run and five traps it must not touch,
 * each trap a different reason.
 */
function seedVault(dir: string): void {
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: Seeded outcome\n", "utf8");

  const nodes: OstNode[] = [
    node("Seeded outcome", "Outcome", { links: ["An opportunity"] }),
    node("An opportunity", "Opportunity", { links: ["A solution"] }),
    node("A solution", "Solution", {
      links: [
        "Replay the run journals",
        "Audit the recorded reds",
        "Count what the inbox never carried",
        "Interview five real players",
        "Nobody classified this one",
        "Census the unfixed thresholds",
        "Already answered by a person",
        "A lane with no command under it",
      ],
    }),

    // --- the three compute may run ---
    node("Replay the run journals", "AssumptionTest", {
      lane: "compute-only",
      threshold: ">= 3 journals replay byte-identically",
      instrument: "npx vitest run test/replay.test.ts",
    }),
    node("Audit the recorded reds", "AssumptionTest", {
      lane: "compute-only",
      threshold: "every recorded red names a spec file that exists",
      instrument: "npx vitest run test/audit.test.ts",
    }),
    node("Count what the inbox never carried", "AssumptionTest", {
      lane: "compute-only",
      threshold: ">= 1 item reached the tree without a human carrying it",
      // The spec file is deliberately absent from the fake repo below.
      instrument: "npx vitest run test/never-written.test.ts",
    }),

    // --- the traps ---
    node("Interview five real players", "AssumptionTest", {
      lane: "humans-required",
      instrument: "npx vitest run test/replay.test.ts",
    }),
    node("Nobody classified this one", "AssumptionTest", {
      instrument: "npx vitest run test/replay.test.ts",
    }),
    node("Census the unfixed thresholds", "AssumptionTest", {
      lane: "compute-only",
      instrument: "npx vitest run test/replay.test.ts",
      body: "Lane: humans-required — somebody has to read each threshold and say whether it is a bar.",
    }),
    node("Already answered by a person", "AssumptionTest", {
      lane: "compute-only",
      instrument: "npx vitest run test/replay.test.ts",
      body: "b\n\n## Results\n- 2026-08-01 **supported** (ran by tanner) — it held\n",
    }),
    node("A lane with no command under it", "AssumptionTest", {
      lane: "compute-only",
      threshold: "somebody eventually writes one",
    }),
  ];

  for (const n of nodes) fs.writeFileSync(path.join(dir, `${n.title}.md`), serialize(n), "utf8");

  // A test carrying a lane nobody defined. Written as raw frontmatter because
  // `OstNode.lane` will not hold one — which is half the point: the reader drops
  // it, so the node arrives unclassified and the fail-closed rule catches it.
  fs.writeFileSync(
    path.join(dir, "A lane a future version invented.md"),
    [
      "---",
      "type: AssumptionTest",
      "status: unvalidated",
      "evidence: assertion",
      "lane: cheap-enough",
      "instrument: npx vitest run test/replay.test.ts",
      "---",
      "#AssumptionTest",
      "",
      "b",
      "",
    ].join("\n"),
    "utf8",
  );
}

/** A repo holding two of the three named spec files, so one run is genuinely no-spec. */
function seedRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "test", "replay.test.ts"), "// a spec\n", "utf8");
  fs.writeFileSync(path.join(dir, "test", "audit.test.ts"), "// a spec\n", "utf8");
}

/** Records what was asked for, and answers from a table keyed on the spec path. */
function recordingSpawn(answers: Record<string, SpawnedRun>): { spawn: SpawnRunner; asked: string[] } {
  const asked: string[] = [];
  const spawn: SpawnRunner = (argv) => {
    const target = argv[argv.length - 1];
    asked.push(target);
    const answer = answers[target];
    if (!answer) throw new Error(`the runner ran a command this spec never authorised: ${argv.join(" ")}`);
    return answer;
  };
  return { spawn, asked };
}

describe("the compute-only lane runner", () => {
  let vault: string;
  let repo: string;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-compute-lane-vault-"));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-compute-lane-repo-"));
    seedVault(vault);
    seedRepo(repo);
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const run = (): { result: ComputeLaneRun; asked: string[] } => {
    const { spawn, asked } = recordingSpawn({
      "test/replay.test.ts": green,
      "test/audit.test.ts": red,
    });
    return { result: draftComputeLane(new Vault(vault).readTree(), { repo, spawn }), asked };
  };

  test("executes every compute-only test in the tree, and nothing else", () => {
    const { result, asked } = run();

    // Two spawns: the third compute-only test names a spec that does not exist
    // and is answered from the filesystem without a runner start.
    expect(asked.sort()).toEqual(["test/audit.test.ts", "test/replay.test.ts"]);
    expect(result.drafts.map((d) => d.test).sort()).toEqual([
      "Audit the recorded reds",
      "Count what the inbox never carried",
      "Replay the run journals",
    ]);

    // Every trap, named, so a regression says which door opened.
    const touched = new Set([...result.drafts, ...result.declined].map((d) => d.test));
    expect(touched.has("Interview five real players")).toBe(false); // another lane
    expect(touched.has("Nobody classified this one")).toBe(false); // unclassified
    expect(touched.has("A lane a future version invented")).toBe(false); // unknown lane, dropped
    expect(touched.has("Already answered by a person")).toBe(false); // a human already answered it
  });

  test("a green run drafts supported, with the observation quoted inline", () => {
    const { result } = run();
    const draft = result.drafts.find((d) => d.test === "Replay the run journals")!;

    expect(draft.verdict).toBe("supported");
    expect(draft.observation).toBe("green");
    expect(draft.evidence).toContain("green (exit 0)");
    expect(draft.evidence).toContain("npx vitest run test/replay.test.ts");
    expect(draft.evidence).toContain("1 passed");
  });

  test("a red run drafts refuted — a kill is reachable by the same mechanism as a confirmation", () => {
    const { result } = run();
    const draft = result.drafts.find((d) => d.test === "Audit the recorded reds")!;

    expect(draft.verdict).toBe("refuted");
    expect(draft.evidence).toContain("red (exit 1)");
    expect(draft.evidence).toContain("every recorded red names a spec that exists");
    expect(result.kills).toBe(1);
  });

  test("a run that measured nothing drafts no verdict and no line to paste", () => {
    const { result } = run();
    const draft = result.drafts.find((d) => d.test === "Count what the inbox never carried")!;

    expect(draft.observation).toBe("no-spec");
    expect(draft.verdict).toBeUndefined();
    expect(draft.resultCommand).toBeUndefined();
    expect(draft.undecided).toMatch(/nothing was measured/i);
    // The exit was non-zero. Reading that as a refutation would let a file
    // nobody wrote kill a solution.
    expect(result.kills).toBe(1);
  });

  test("every decisive draft carries a pre-filled `ost-agent result` line, with attribution left blank", () => {
    const { result } = run();

    for (const draft of result.drafts.filter((d) => d.verdict)) {
      const line = draft.resultCommand!;
      expect(line.startsWith("ost-agent result ")).toBe(true);
      expect(line).toContain(shellQuote(draft.test));
      expect(line).toContain(`-v ${draft.verdict}`);
      // The one field compute must not supply: a result carries `by` precisely
      // so it can be told apart from a fabricated one.
      expect(line).toContain("-b <you>");
      expect(line).toContain("-n ");
      expect(line).toContain("-u ");
    }
    expect(result.decisive).toBe(2);
  });

  test("the pre-filled --uncovered names the bar the exit code could not see", () => {
    const { result } = run();

    const withBar = result.drafts.find((d) => d.test === "Replay the run journals")!;
    expect(withBar.uncovered).toContain(">= 3 journals replay byte-identically");
    expect(withBar.resultCommand).toContain(">= 3 journals replay byte-identically");
  });

  test("a test whose label contradicts its own prose is declined, not run", () => {
    const { result } = run();

    const declined = result.declined.find((d) => d.test === "Census the unfixed thresholds");
    expect(declined).toBeDefined();
    expect(declined!.why).toContain("humans-required");
    expect(declined!.why).toMatch(/label is what compute obeys/i);
    // Declined means declined: it produced no draft at all.
    expect(result.drafts.some((d) => d.test === "Census the unfixed thresholds")).toBe(false);
  });

  test("a compute-only test with no runnable instrument is declined rather than counted as run", () => {
    const { result } = run();

    const declined = result.declined.find((d) => d.test === "A lane with no command under it");
    expect(declined).toBeDefined();
    expect(declined!.why).toMatch(/no runnable instrument/i);
  });

  test("running the lane writes nothing to the vault — drafting is not recording", () => {
    const before = snapshot(vault);
    run();
    expect(snapshot(vault)).toEqual(before);
  });

  test("the report says so when every draft confirms", () => {
    const { spawn } = recordingSpawn({ "test/replay.test.ts": green, "test/audit.test.ts": green });
    const allGreen = draftComputeLane(new Vault(vault).readTree(), { repo, spawn });

    expect(allGreen.kills).toBe(0);
    expect(renderComputeLane(allGreen)).toMatch(/zero kills/i);
    expect(renderComputeLane(allGreen)).toMatch(/decoration/i);
  });

  test("an empty lane reports an empty lane rather than a pass", () => {
    const empty = draftComputeLane([node("Out", "Outcome")], { repo });

    expect(empty.drafts).toEqual([]);
    expect(empty.decisive).toBe(0);
    expect(renderComputeLane(empty)).toContain("0 test(s) run");
    expect(renderComputeLane(empty)).not.toMatch(/zero kills/i);
  });
});

describe("the pasted line", () => {
  test("quotes a title the shell would otherwise reinterpret", () => {
    const line = resultCommand('Does `npx vitest` see "anything"', "supported", "note", "uncovered");
    expect(line).toContain(`'Does \`npx vitest\` see "anything"'`);
    expect(line).not.toContain('"Does `npx');
  });

  test("keeps the readable form when there is nothing to escape", () => {
    expect(shellQuote("Replay the run journals")).toBe('"Replay the run journals"');
  });

  test("refuses a verdict that is not on the list", () => {
    expect(() => resultCommand("A test", "probably" as never, "n", "u")).toThrow(/probably/);
  });
});

/** Every file in the vault, by content — the check that nothing was written. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? dir, entry.name);
    out[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
  }
  return out;
}
