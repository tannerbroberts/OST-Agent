/**
 * The instrument for the meta vault's assumption test "Resume three handed-off
 * passes from their recorded state and check they continue correctly".
 *
 * Threshold, verbatim: *all three resumed passes take the same next action the
 * original took, with no work repeated and no state silently invented.*
 *
 * Three things about how that is measured here, because each of them is a way the
 * test could have been made easier than the question:
 *
 *   - **The three passes are the three waits in the corpus**, not three invented
 *     ones. Each plan is built around `WAITING_CASES` from `src/loop/wait.ts`,
 *     whose `blocked` strings are copied byte-for-byte out of refused `Bash` calls
 *     in `test/fixtures/corrections/`. The condition each pass parks on is
 *     `probeOf` of that string — the thing the session was actually waiting for.
 *   - **The original and the resumed pass run through the same driver.** If they
 *     did not, "it took the same next action" would be two implementations
 *     agreeing rather than the record being sufficient.
 *   - **The resumed pass is handed a record read back off disk and nothing else.**
 *     `resumePass` takes a `HandoffRecord` and has no other parameter; the record
 *     it gets here has been through `JSON.stringify` and a file.
 *
 * The last describe block is the part that makes green mean something. The node
 * this serves says the expensive failure "will not announce itself" — so the
 * comparison is shown to actually catch a resumed pass that starts from a
 * different understanding, rather than being asserted to.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  HandoffGapError,
  appendHandoff,
  captureHandoff,
  drivePass,
  handoffWake,
  markResumed,
  nextAction,
  pendingHandoff,
  renderHandoff,
  resumePass,
  type HandoffRecord,
  type PassStep,
} from "../../src/loop/handoff.js";
import { WAITING_CASES, probeOf, SHIM_NAME } from "../../src/loop/wait.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-handoff-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const AT = "2026-08-06T12:00:00.000Z";
const RESUMED_AT = "2026-08-06T12:41:00.000Z";

/** One of the three passes, with the wait it parks on taken from the corpus. */
interface PassFixture {
  id: string;
  plan: PassStep[];
  holding: Record<string, string>;
}

const waitingCase = (id: (typeof WAITING_CASES)[number]["id"]) => WAITING_CASES.find((c) => c.id === id)!;

/**
 * The three passes. Each is the work the session in the corpus was doing around
 * its wait — a build pass parked on CI, a discovery pass parked on a workflow it
 * launched, a sweep parked on the tree settling — and each carries facts after
 * the wait that a resumed pass has no other way to know. `merge` needs the PR
 * number the push produced; there is no honest default for it, which is what
 * makes these worth resuming rather than restarting.
 */
function fixtures(): PassFixture[] {
  const ci = waitingCase("ci-check");
  const task = waitingCase("started-task");
  const condition = waitingCase("condition");
  return [
    {
      id: "build pass parked on CI",
      plan: [
        { id: "build:retry-classifier", command: "implement the solution on a branch", needs: ["solution"] },
        { id: "push:pass-handoff", command: "push the branch and open the PR", needs: ["branch", "solution"] },
        {
          id: "checks:17",
          command: "read the check result",
          needs: ["pr"],
          waitsFor: { id: "ci:17", condition: probeOf(ci.blocked), why: ci.intent },
        },
        { id: "merge:17", command: "merge the PR and delete the branch", needs: ["pr", "branch"] },
        { id: "report:17", command: "write the build report", needs: ["pr", "solution"] },
      ],
      holding: { solution: "The pass ends at the handoff", branch: "pass-handoff-record", pr: "17" },
    },
    {
      id: "discovery pass parked on a workflow it launched",
      plan: [
        { id: "launch:wf_a51c57d4-bc9", command: "launch the review workflow", needs: ["workflow"] },
        {
          id: "output:wf_a51c57d4-bc9",
          command: "read the workflow's journal",
          needs: ["workflow", "session"],
          waitsFor: { id: "task:wf_a51c57d4-bc9", condition: probeOf(task.blocked), why: task.intent },
        },
        { id: "fold:wf_a51c57d4-bc9", command: "fold the findings into the node", needs: ["workflow", "findingsNode"] },
      ],
      holding: {
        workflow: "wf_a51c57d4-bc9",
        session: "4ff7b605-da1d-4f2e-8c05-ec6408118837",
        findingsNode: "A sweep that cannot read its subject reports a clean result",
      },
    },
    {
      id: "sweep parked on the tree settling",
      plan: [
        { id: "dispatch:sweep", command: "dispatch the unattended sweep", needs: ["sweep"] },
        {
          id: "settle:tree",
          command: "read what the sweep committed",
          needs: ["sweep"],
          waitsFor: { id: "tree:clean", condition: probeOf(condition.blocked), why: condition.intent },
        },
        { id: "seal:sweep", command: "seal the run with the verdict", needs: ["sweep", "verdict"] },
      ],
      holding: { sweep: "unattended-sweep-2026-08-29", verdict: "healthy" },
    },
  ];
}

/** The pass as it runs today: it holds the wait open in-process and carries on. */
function original(f: PassFixture) {
  return drivePass(f.plan, f.holding, { runId: "original", at: AT, onUnfinishedWait: "hold" });
}

/** The pass ending at the wait, with its record written to and read back off disk. */
function handOff(f: PassFixture): { actions: readonly { stepId: string }[]; recovered: HandoffRecord } {
  const stopped = drivePass(f.plan, f.holding, { runId: "stopped", at: AT, onUnfinishedWait: "handoff" });
  expect(stopped.handoff, "the pass reached a wait and left a record").toBeDefined();
  appendHandoff(dir, stopped.handoff!);
  const recovered = pendingHandoff(dir);
  expect(recovered, "the record is on disk and nothing has taken it up").not.toBeNull();
  return { actions: stopped.actions, recovered: recovered! };
}

describe("three handed-off passes resume from the record alone", () => {
  for (const f of fixtures()) {
    describe(f.id, () => {
      test("the resumed pass takes the same next action the original took after its wait", () => {
        const before = original(f);
        const { actions: beforeHandoff, recovered } = handOff(f);

        const waitIndex = beforeHandoff.length;
        expect(nextAction(recovered)).toEqual(before.actions[waitIndex]);

        const after = resumePass(recovered, { runId: "resumed", at: RESUMED_AT });
        expect(after.actions[0]).toEqual(before.actions[waitIndex]);
      });

      test("the two halves reconstruct the original pass exactly — nothing repeated, nothing dropped", () => {
        const before = original(f);
        const { actions: beforeHandoff, recovered } = handOff(f);
        const after = resumePass(recovered, { runId: "resumed", at: RESUMED_AT });

        expect([...beforeHandoff, ...after.actions]).toEqual(before.actions);
        // Stated separately from the concatenation because "no work repeated" is
        // its own clause of the threshold and a reader should see it checked.
        const repeated = after.actions.filter((a) => beforeHandoff.some((b) => b.stepId === a.stepId));
        expect(repeated, "a step finished before the handoff must not run again").toEqual([]);
        expect(after.handoff, "the remainder had one wait and it is the one that woke this pass").toBeUndefined();
      });

      test("nothing the resumed pass reads comes from the process that stopped", () => {
        const { recovered } = handOff(f);
        // The record was copied at capture, so mutating what the stopped pass was
        // holding cannot reach the resumed one. If the record aliased live state,
        // a green run here would be proving nothing about a fresh process.
        for (const key of Object.keys(f.holding)) f.holding[key] = "MUTATED AFTER CAPTURE";

        const after = resumePass(recovered, { runId: "resumed", at: RESUMED_AT });
        expect(after.actions.length).toBeGreaterThan(0);
        expect(Object.values(recovered.holding)).not.toContain("MUTATED AFTER CAPTURE");
      });

      test("the record names a real wait from the corpus, and renders the command that wakes it", () => {
        const { recovered } = handOff(f);
        const blocked = WAITING_CASES.find((c) => probeOf(c.blocked) === recovered.wait.condition);

        expect(blocked, "the condition is one a session was actually refused for").toBeDefined();
        expect(handoffWake(recovered, "ost-agent loop start")).toBe(
          `${SHIM_NAME} '${recovered.wait.condition.split("'").join("'\\''")}' && ost-agent loop start`,
        );
      });

      test("taking the handoff up retires it, so the pass after this one does not take it again", () => {
        const { recovered } = handOff(f);
        resumePass(recovered, { runId: "resumed", at: RESUMED_AT });
        markResumed(dir, recovered, { runId: "resumed", at: RESUMED_AT });

        expect(pendingHandoff(dir)).toBeNull();
      });
    });
  }
});

describe("state the pass never wrote down is refused, never supplied", () => {
  test("a record missing a fact its next step reads refuses to resume, naming the fact", () => {
    const f = fixtures()[0];
    const { recovered } = handOff(f);
    // A record that lost the PR number — a kill mid-append, an older writer, an
    // edit. The resumed pass must not merge whatever `gh` hands back first.
    const { pr: _dropped, ...rest } = recovered.holding;
    const gapped: HandoffRecord = { ...recovered, holding: rest };

    expect(() => resumePass(gapped, { runId: "resumed", at: RESUMED_AT })).toThrow(HandoffGapError);
    expect(() => nextAction(gapped)).toThrow(/needs `pr`/);
  });

  test("the refusal happens before any action is taken, not partway through the remainder", () => {
    const f = fixtures()[0];
    const { recovered } = handOff(f);
    // `merge:17` reads `branch`; `checks:17` does not. A resumer that ran until
    // it hit the hole would have merged nothing but would have read the checks,
    // and a half-run remainder is work to undo rather than work to redo.
    const { branch: _dropped, ...rest } = recovered.holding;
    const gapped: HandoffRecord = { ...recovered, holding: rest };

    let thrown: unknown;
    try {
      resumePass(gapped, { runId: "resumed", at: RESUMED_AT });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HandoffGapError);
    expect((thrown as HandoffGapError).stepId).toBe("merge:17");
  });

  test("an unresumable handoff is refused at capture, while the pass that knows the answer is alive", () => {
    const f = fixtures()[0];
    const holding = { ...f.holding };
    delete (holding as Record<string, string>).pr;

    expect(() =>
      drivePass(f.plan, holding, { runId: "stopped", at: AT, onUnfinishedWait: "handoff" }),
    ).toThrow(HandoffGapError);
  });

  test("a record this build cannot read announces itself rather than reading as nothing to do", () => {
    const f = fixtures()[2];
    const { recovered } = handOff(f);
    const future: HandoffRecord = { ...recovered, version: recovered.version + 1 };

    expect(() => nextAction(future)).toThrow(/resumes version/);
    expect(renderHandoff(future).join("\n")).toContain("UNRESUMABLE");
  });
});

describe("the comparison catches a pass that starts from a different understanding", () => {
  test("a resumed pass that silently believes it already merged does not error — the comparison is what fails", () => {
    const f = fixtures()[0];
    const before = original(f);
    const { actions: beforeHandoff, recovered } = handOff(f);

    // The failure the node names: not a crash, a wrong belief. This record says
    // the merge is already done. Everything after it proceeds confidently.
    const wrong: HandoffRecord = { ...recovered, completed: [...recovered.completed, "merge:17"] };
    const after = resumePass(wrong, { runId: "resumed", at: RESUMED_AT });

    expect(after.actions.length, "it did not crash — it just skipped the merge").toBeGreaterThan(0);
    expect(after.actions.some((a) => a.stepId === "merge:17")).toBe(false);
    // And this is the assertion the honest runs above rely on: it fails here.
    expect([...beforeHandoff, ...after.actions]).not.toEqual(before.actions);
  });

  test("redoing finished work is prevented by where the remainder starts, not by the bookkeeping", () => {
    const f = fixtures()[1];
    const before = original(f);
    const { actions: beforeHandoff, recovered } = handOff(f);

    // Losing `completed` entirely changes nothing, because `remaining` begins at
    // the wait: the launch is not in the record to be re-run. Worth pinning — it
    // means "no work repeated" rests on the record's shape rather than on a list
    // that a truncated write or a hand edit could shorten.
    const forgetful: HandoffRecord = { ...recovered, completed: [] };
    const after = resumePass(forgetful, { runId: "resumed", at: RESUMED_AT });

    expect(after.actions[0].stepId).toBe("output:wf_a51c57d4-bc9");
    expect([...beforeHandoff, ...after.actions]).toEqual(before.actions);
  });

  test("a record that serialised the whole plan instead of the remainder does redo work, and is caught", () => {
    const f = fixtures()[1];
    const before = original(f);
    const { actions: beforeHandoff, recovered } = handOff(f);

    // The shape a naive writer would produce — the entire plan as the remainder,
    // leaning on `completed` alone to stop the repeat — with that list lost.
    const naive: HandoffRecord = { ...recovered, remaining: f.plan, completed: [] };
    const after = resumePass(naive, { runId: "resumed", at: RESUMED_AT });

    expect(after.actions[0].stepId, "it re-ran the launch it had already done").toBe("launch:wf_a51c57d4-bc9");
    expect([...beforeHandoff, ...after.actions]).not.toEqual(before.actions);
  });
});

describe("a plan with two waits hands off twice rather than blocking on the second", () => {
  test("the wake proves only its own check finished, so the next wait parks the pass again", () => {
    const ci = waitingCase("ci-check");
    const task = waitingCase("started-task");
    const plan: PassStep[] = [
      { id: "push", command: "push the branch", needs: ["branch"] },
      {
        id: "checks",
        command: "read the check result",
        needs: ["pr"],
        waitsFor: { id: "ci:17", condition: probeOf(ci.blocked), why: ci.intent },
      },
      {
        id: "review",
        command: "read the review workflow's findings",
        needs: ["workflow"],
        waitsFor: { id: "task:wf", condition: probeOf(task.blocked), why: task.intent },
      },
      { id: "merge", command: "merge the PR", needs: ["pr", "branch"] },
    ];
    const holding = { branch: "pass-handoff-record", pr: "17", workflow: "wf_a51c57d4-bc9" };

    const first = drivePass(plan, holding, { runId: "one", at: AT, onUnfinishedWait: "handoff" });
    expect(first.actions.map((a) => a.stepId)).toEqual(["push"]);
    const second = resumePass(first.handoff!, { runId: "two", at: RESUMED_AT });

    expect(second.actions.map((a) => a.stepId), "it read the checks and parked on the workflow").toEqual(["checks"]);
    expect(second.handoff?.wait.id).toBe("task:wf");
    expect(second.handoff?.completed).toContain("push");

    const third = resumePass(second.handoff!, { runId: "three", at: RESUMED_AT });
    expect(third.actions.map((a) => a.stepId)).toEqual(["review", "merge"]);
    expect(third.handoff).toBeUndefined();
  });
});

describe("the handoff log", () => {
  test("a truncated final line does not cost the record before it", () => {
    const f = fixtures()[2];
    const { recovered } = handOff(f);
    fs.appendFileSync(path.join(dir, ".git/ost-agent/handoff.jsonl"), '{"kind":"resumed","runId":"hal');

    expect(pendingHandoff(dir)?.runId, "a kill mid-append must not orphan a parked pass").toBe(recovered.runId);
  });

  test("the newest unclaimed handoff is the live one", () => {
    const f = fixtures()[0];
    const older = captureHandoff({
      runId: "older",
      at: AT,
      wait: { id: "ci:9", condition: "gh pr checks 9", why: "an earlier pass" },
      completed: [],
      remaining: [],
      holding: {},
    });
    appendHandoff(dir, older);
    const { recovered } = handOff(f);

    expect(pendingHandoff(dir)?.runId).toBe(recovered.runId);
    markResumed(dir, recovered, { runId: "resumed", at: RESUMED_AT });
    expect(pendingHandoff(dir)?.runId, "the older one was never taken up and is still parked").toBe("older");
  });

  test("a vault with no handoff reports none rather than throwing", () => {
    expect(pendingHandoff(dir)).toBeNull();
  });
});
