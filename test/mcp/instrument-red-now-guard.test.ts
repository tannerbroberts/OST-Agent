/**
 * "Feed the guard three reds and one green and require it to sort them" — the
 * instrument for "Refuse an instrument that passes on arrival".
 *
 * ## The bar, and why three of four would not have been a pass
 *
 * The assumption test pre-committed **4 of 4**: the guard accepts the
 * red-because-unbuilt command, rejects the green one, and *declines to rule* on
 * the missing-spec and broken-environment reds rather than accepting them. The
 * middle two are the whole question. Every one of those four exits non-zero
 * except the green, so a guard that sorted on the exit code alone would score
 * three of four while enforcing nothing an author could not already claim — the
 * weak-red problem wearing an execution capability. What is measured here is the
 * *sort*, not the refusal.
 *
 * ## Nothing here invents what a runner says
 *
 * The classification reads the runner's wording, so a spec that fed it strings
 * somebody imagined would be checking that the classifier agrees with its
 * author. Every case below replays a recording of a real
 * `spawnSync("npx", ["vitest", "run", …])` from
 * `test/fixtures/instrument-red-now/` (see its `PROVENANCE.md`) through the real
 * `classifyRun` and the real tool. Only the process is faked; every branch that
 * decides anything is the shipping one.
 *
 * That capture is also what found the defect in the code this guard sits on:
 * vitest reports an existing-but-empty spec as `No test suite found in file …`,
 * which `collectedNothing` did not match, so a file that cannot fail was
 * classified `red` — the exact vacuous red the `no-spec` marker exists to
 * refuse, in the function whose own comment claimed to cover it.
 *
 * ## Two limits pinned here rather than left to be discovered
 *
 * - **Off unless the operator granted it.** Executing a command as part of a
 *   write is what `CONTRIBUTING.md` rules out, and `instruments.runOnWrite`
 *   defaults to false. With the grant absent the boundary keeps taking the
 *   author's word, and the last describe block requires exactly that — a green
 *   command lands, unchallenged, on an ungranted surface. That is the cost of
 *   the default, asserted so it stays visible.
 * - **A bound threshold still carries a spec nobody has written.** The waiver
 *   `confirmPermit` and `specResolves` already honour is honoured here too, and
 *   only for `no-spec`. A command that PASSES is refused whatever the threshold
 *   says.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools } from "../../src/security/tools.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { classifyRun, type Observation, type SpawnRunner, type SpawnedRun } from "../../src/ost/instrument.js";
import { ruleOnCandidate } from "../../src/ost/red-now.js";
import type { PassContext } from "../../src/runner/context.js";
import type { OstNode } from "../../src/ost/node.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Recording {
  why: string;
  target: string;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: { message: string };
}

const RECORDED: Record<string, Recording> = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "fixtures", "instrument-red-now", "runner-output.json"), "utf8"),
);

/** The recorded run, in the shape a live spawn hands the classifier. */
function recording(id: string): SpawnedRun {
  const r = RECORDED[id];
  if (!r) throw new Error(`no recording "${id}" — the fixture and this spec have drifted`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ...(r.error ? { error: r.error } : {}) };
}

const OUTCOME = "Retention";
const OPPORTUNITY = "Instruments are red on the author's word";
const SOLUTION = "Refuse an instrument that passes on arrival";
const BELIEF = "Running the command is what makes red-now true";
const TEST = "Whether the guard sorts the four exit codes";

let dir: string;
let repo: string;
let ctx: PassContext;

/**
 * One spec file per recorded case, in the repo the tool resolves against. The
 * *contents* never matter — nothing here runs them — but the file has to exist,
 * because `specResolves` is a separate guard and this one is not allowed to
 * borrow its refusal.
 */
const SPEC_FOR: Record<string, string> = {
  "assertion-fails": "test/red-because-unbuilt.test.ts",
  "unbuilt-local-module": "test/imports-an-unbuilt-module.test.ts",
  "empty-spec": "test/collects-nothing.test.ts",
  "missing-package": "test/needs-a-package-nobody-installed.test.ts",
  "passes": "test/already-true.test.ts",
  "runner-absent": "test/no-runner-here.test.ts",
  "spawn-failed": "test/nothing-to-spawn.test.ts",
};

/**
 * Call a tool with a spawn that replays `id` whatever it is asked to run.
 *
 * `granted: false` withholds `instrumentExecution` entirely, which is the
 * shipping default and the state the last describe block measures.
 */
function call(
  name: string,
  input: Record<string, unknown>,
  opts: { replay?: string; granted?: boolean; repos?: readonly string[] } = {},
): Promise<string> {
  const spawn: SpawnRunner = () => recording(opts.replay ?? "assertion-fails");
  const tools = buildOstTools(
    {
      ...ctx,
      productRepos: opts.repos ?? [repo],
      ...(opts.granted === false ? {} : { instrumentExecution: { spawn } }),
    },
    MCP_TOOL_NAMES,
  );
  const tool = tools.find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
}

/** A test written before instruments existed — the shape `ost_set_instrument` pays off. */
function legacyTest(threshold?: string): void {
  ctx.vault.createNode({
    title: TEST,
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "someone should check this",
    threshold,
    tags: [],
    links: [],
  } as unknown as OstNode);
  ctx.vault.linkNodes(BELIEF, TEST);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-red-now-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-red-now-repo-"));
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  for (const spec of Object.values(SPEC_FOR)) {
    fs.writeFileSync(path.join(repo, spec), "// a spec that exists; nothing in this suite runs it\n", "utf8");
  }
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  ctx = buildPassContext(dir);
  await call("ost_create_node", { title: OPPORTUNITY, layer: "Opportunity", parent: OUTCOME, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: SOLUTION, layer: "Solution", parent: OPPORTUNITY, body: "b", evidence: "assertion", ...KILL_CRITERIA });
  await call("ost_create_node", { title: BELIEF, layer: "Assumption", parent: SOLUTION, body: "b", evidence: "assertion" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * The bar itself: four commands, four verdicts, through the tool.
 *
 * Written as a table so the count in the threshold is a thing this file
 * computes rather than a thing a reader tallies. `expected` is the tool's
 * behaviour; `verdict` is what `ruleOnCandidate` called it, asserted alongside
 * so a tool that refused for some unrelated reason cannot pass as a sort.
 */
const MATRIX = [
  {
    replay: "assertion-fails",
    expected: "accepted",
    verdict: "accepted",
    because: "a spec was collected and an assertion in it failed — a red about behaviour",
  },
  {
    replay: "passes",
    expected: "refused",
    verdict: "already-built",
    matches: /PASSES against the repository right now/,
    because: "green on arrival: it cannot fail, so it measures nothing",
  },
  {
    replay: "empty-spec",
    expected: "refused",
    verdict: "declined",
    matches: /no spec was collected/,
    because: "the file is there and nothing in it can fail — a red about a filename",
  },
  {
    replay: "missing-package",
    expected: "refused",
    verdict: "declined",
    matches: /never reached the spec/,
    because: "the environment failed to ask the question; the repository said nothing",
  },
] as const;

describe("the guard sorts four planted exit codes — 4 of 4 is the bar", () => {
  for (const c of MATRIX) {
    test(`${c.replay} → ${c.expected} (${c.because})`, async () => {
      legacyTest();
      const command = `npx vitest run ${SPEC_FOR[c.replay]}`;
      const attempt = call(
        "ost_set_instrument",
        { test: TEST, instrument: command, why: "what the recorded run says it is" },
        { replay: c.replay },
      );
      if (c.expected === "accepted") {
        await attempt;
        expect(ctx.vault.read(TEST).instrument).toBe(command);
      } else {
        await expect(attempt).rejects.toThrow(c.matches);
        // Nothing is written on a refusal — the wrong answer cannot land.
        expect(ctx.vault.read(TEST).instrument).toBeUndefined();
      }
      // And the sort itself, named, so a refusal fired by some other guard
      // cannot be mistaken for this one having classified anything.
      const run = classifyRun(SPEC_FOR[c.replay]!, recording(c.replay));
      expect(ruleOnCandidate(run, TEST, command).verdict).toBe(c.verdict);
    });
  }

  test("all four are classified, and the three non-accepts are three distinct refusals", () => {
    const rulings = MATRIX.map((c) => {
      const run = classifyRun(SPEC_FOR[c.replay]!, recording(c.replay));
      return ruleOnCandidate(run, TEST, `npx vitest run ${SPEC_FOR[c.replay]}`);
    });
    expect(rulings.map((r) => r.verdict)).toEqual(["accepted", "already-built", "declined", "declined"]);
    // The two declines must not be the same message. A guard that lumps a
    // missing spec in with a broken box has answered "non-zero", which is the
    // failure mode the threshold refused to call a pass.
    expect(rulings[2]!.refusal).not.toBe(rulings[3]!.refusal);
    expect(rulings[2]!.refusal).toMatch(/Write the failing spec/);
    expect(rulings[3]!.refusal).toMatch(/Fix the environment/);
  });
});

describe("the classifier, against recorded runner output", () => {
  const CASES: [string, Observation][] = [
    ["assertion-fails", "red"],
    ["unbuilt-local-module", "red"],
    ["empty-spec", "no-spec"],
    ["missing-package", "unavailable"],
    ["passes", "green"],
    ["runner-absent", "unavailable"],
    ["spawn-failed", "unavailable"],
  ];
  for (const [id, observation] of CASES) {
    test(`${id} reads as ${observation} — ${RECORDED[id]!.why}`, () => {
      expect(classifyRun(RECORDED[id]!.target, recording(id)).observation).toBe(observation);
    });
  }

  test("a missing LOCAL module stays red while a missing PACKAGE does not", () => {
    // One character of difference in the runner's message, and the whole rule
    // turns on it: `../../src/not-built-yet.js` is the solution's own module and
    // its absence is what test-first work looks like, so treating it as a broken
    // environment would refuse the commonest honest instrument in the tree.
    expect(classifyRun("t.test.ts", recording("unbuilt-local-module")).observation).toBe("red");
    expect(classifyRun("t.test.ts", recording("missing-package")).observation).toBe("unavailable");
    // Both exited 1. The exit code decides nothing here, which is the point.
    expect(RECORDED["unbuilt-local-module"]!.status).toBe(1);
    expect(RECORDED["missing-package"]!.status).toBe(1);
  });
});

describe("what the guard does not do, pinned so it stays a stated limit", () => {
  test("without the operator's grant, a green command lands unchallenged", async () => {
    // `instruments.runOnWrite` is false by default. This is the cost of that
    // default, and it is the state every surface ships in until somebody
    // decides otherwise — see src/ost/red-now.ts on why the decision is not
    // this code's to make.
    legacyTest();
    const command = `npx vitest run ${SPEC_FOR["passes"]}`;
    await call("ost_set_instrument", { test: TEST, instrument: command, why: "nothing ran it" }, { granted: false });
    expect(ctx.vault.read(TEST).instrument).toBe(command);
  });

  test("with no product repo configured there is nothing to be red about, so it stands down", async () => {
    legacyTest();
    const command = `npx vitest run ${SPEC_FOR["passes"]}`;
    await call("ost_set_instrument", { test: TEST, instrument: command, why: "no repo to run against" }, { replay: "passes", repos: [] });
    expect(ctx.vault.read(TEST).instrument).toBe(command);
  });

  test("a bound threshold still carries a spec nobody has written — the waiver, unchanged", async () => {
    legacyTest("at least 5 of the 20 replayed sessions are refused before any work");
    const command = "npx vitest run test/not-written-yet.test.ts";
    await call("ost_set_instrument", { test: TEST, instrument: command, why: "new behaviour; the bar is pre-committed" }, { replay: "empty-spec" });
    expect(ctx.vault.read(TEST).instrument).toBe(command);
  });

  test("but a bound threshold does not carry a command that PASSES", async () => {
    // The waiver is about a file that is yet to be written, not about a
    // prediction that was already true when it was made.
    legacyTest("at least 5 of the 20 replayed sessions are refused before any work");
    await expect(
      call(
        "ost_set_instrument",
        { test: TEST, instrument: `npx vitest run ${SPEC_FOR["passes"]}`, why: "bar is bound, so surely this is fine" },
        { replay: "passes" },
      ),
    ).rejects.toThrow(/PASSES against the repository right now/);
    expect(ctx.vault.read(TEST).instrument).toBeUndefined();
  });
});

describe("ost_create_node applies the same rule at the other write boundary", () => {
  test("a new test carrying a command that already passes is refused, and nothing is written", async () => {
    await expect(
      call(
        "ost_create_node",
        {
          title: "A test born green",
          layer: "AssumptionTest",
          parent: BELIEF,
          body: "b",
          evidence: "assertion",
          instrument: `npx vitest run ${SPEC_FOR["passes"]}`,
        },
        { replay: "passes" },
      ),
    ).rejects.toThrow(/PASSES against the repository right now/);
    expect(ctx.vault.has("A test born green")).toBe(false);
  });

  test("a genuinely red one is created exactly as before", async () => {
    await call(
      "ost_create_node",
      {
        title: "A test born red",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "b",
        evidence: "assertion",
        instrument: `npx vitest run ${SPEC_FOR["assertion-fails"]}`,
      },
      { replay: "assertion-fails" },
    );
    expect(ctx.vault.read("A test born red").instrument).toBe(`npx vitest run ${SPEC_FOR["assertion-fails"]}`);
  });
});

describe("the refusal says which call it refused", () => {
  test("it names the test and the command, because a pass makes several", async () => {
    legacyTest();
    const command = `npx vitest run ${SPEC_FOR["passes"]}`;
    const err = await call(
      "ost_set_instrument",
      { test: TEST, instrument: command, why: "it will surely fail" },
      { replay: "passes" },
    ).catch((e: Error) => e.message);
    expect(err).toContain(TEST);
    expect(err).toContain(command);
    // And it points at the field that IS the right home for "already built".
    expect(err).toMatch(/status/);
  });
});
