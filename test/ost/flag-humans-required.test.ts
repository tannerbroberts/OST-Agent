/**
 * The restrictive half of lane classification.
 *
 * v0.6.0 shipped lanes but gave the agent no way to set one, because the
 * permissive call — labelling a test `compute-only` — is the call that decides
 * what an unattended pass may go run on its own authority. An agent that can
 * make that call can authorize itself, and every safety mechanism in the lane
 * design becomes decoration.
 *
 * The consequence was that the whole backlog stayed unclassified, which by the
 * fail-closed rule means nothing is runnable at all: correct, and useless.
 *
 * The way out is not a rule the agent is trusted to follow. It is a capability
 * that can only point one way. `flagHumansRequired` takes no lane argument, so
 * "which lane" is not a decision it is able to make; the only classification
 * reachable from it is the one that *removes* work from compute's reach. These
 * tests exist to keep it that way — most of them would still pass if the
 * function grew a lane parameter, so the first one is the one that matters.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CAUTIOUS_LANE, computeMayRun, LANES } from "../../src/knowledge/lanes.js";
import { cautionBacklog, flagHumansRequired, laneConflicts, runnableByCompute, setLane } from "../../src/ost/lanes.js";
import { serialize, type OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";

const node = (title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links,
  body: "b",
  evidence: "assertion",
  ...extra,
});

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-flag-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(n: OstNode): void {
  fs.writeFileSync(path.join(dir, `${n.title}.md`), serialize(n), "utf8");
}

describe("flagHumansRequired — restrictive by construction", () => {
  test("the only lane it can reach is the one compute may NOT run", () => {
    // The whole safety argument in one assertion. `flagHumansRequired` has no
    // lane parameter; the lane it writes is pinned to CAUTIOUS_LANE, and
    // CAUTIOUS_LANE is not runnable. So no sequence of inputs — hostile,
    // confused, or injected — reaches a permissive lane through this door.
    expect(computeMayRun(CAUTIOUS_LANE)).toBe(false);

    write(node("A test", "AssumptionTest"));
    flagHumansRequired(dir, { test: "A test", by: "agent", why: "names an outside person" });

    expect(new Vault(dir).read("A test").lane).toBe(CAUTIOUS_LANE);
  });

  test("flagging can only ever shrink what an unattended pass may run", () => {
    write(node("Cheap", "AssumptionTest", [], { lane: "compute-only" }));
    write(node("Costly", "AssumptionTest"));

    const before = runnableByCompute(new Vault(dir).readTree()).map((t) => t.title);
    flagHumansRequired(dir, { test: "Cheap", by: "agent", why: "on reflection this needs a person" });
    const after = runnableByCompute(new Vault(dir).readTree()).map((t) => t.title);

    expect(before).toEqual(["Cheap"]);
    expect(after).toEqual([]);
    // and the direction is one-way: nothing became runnable
    expect(after.every((t) => before.includes(t))).toBe(true);
  });

  test("the call is attributed and recorded in History, like any other lane filing", () => {
    write(node("A test", "AssumptionTest"));
    flagHumansRequired(dir, { test: "A test", by: "agent:P4_assumptions", why: 'names an outside person: "interview"' });

    const body = new Vault(dir).read("A test").body;
    expect(body).toContain("## History");
    expect(body).toContain("lane: (none) → humans-required");
    expect(body).toContain("by agent:P4_assumptions");
    expect(body).toContain("interview");
  });

  test("refuses an unattributed or unexplained flag", () => {
    write(node("A test", "AssumptionTest"));
    expect(() => flagHumansRequired(dir, { test: "A test", by: "  ", why: "x" })).toThrow(/attribution/i);
    expect(() => flagHumansRequired(dir, { test: "A test", by: "agent", why: "  " })).toThrow(/why/i);
  });

  test("refuses a node that is not an assumption test", () => {
    write(node("An idea", "Solution"));
    expect(() => flagHumansRequired(dir, { test: "An idea", by: "agent", why: "x" })).toThrow(/AssumptionTest/);
  });

  test("re-flagging an already-flagged test is a no-op in effect, and still leaves a trail", () => {
    write(node("A test", "AssumptionTest", [], { lane: CAUTIOUS_LANE }));
    flagHumansRequired(dir, { test: "A test", by: "agent", why: "second look, same call" });

    const after = new Vault(dir).read("A test");
    expect(after.lane).toBe(CAUTIOUS_LANE);
    expect(after.body).toContain("lane: humans-required → humans-required");
  });
});

/**
 * R2 — the flag cannot manufacture a permanent `lane-conflict`.
 *
 * Flagging a test whose own prose says `Lane: compute-only.` used to write the
 * contradiction and leave it there forever: the label moves one way by
 * construction, the prose cannot be shrunk out of an append-only vault, and
 * re-flagging, annotating, appending a correction and `set_status` were all
 * measured failing to clear it. **A safety mechanism that turns into a permanent
 * red when used exactly as intended gets routed around, and the way an agent
 * routes around this one is by not flagging** — which costs the operator the
 * whole capability.
 *
 * The fix is a refusal at the boundary rather than a permissive lane setter:
 * adding one would hand the agent the call that decides what compute may run on
 * its own authority, which is the product's central safety argument and is not
 * for sale. The first test below is the one that matters — the rest would still
 * pass if the guard were removed.
 *
 * **Non-vacuity is proved twice, both times by running something.** The third
 * test authors the conflict through the writer the guard delegates to, so the
 * thing being prevented is demonstrated rather than described; and disabling the
 * guard's condition in `src/ost/lanes.ts` turns four tests red — two here, the
 * `lane-conflict` create cell in `test/eval/clearability.test.ts`, and P10's
 * closed-create row — while every other test in those files stays green.
 */
describe("R2 — flagging refuses to author a conflict it could never clear", () => {
  const withProse = (title: string, lane: string, extra: Partial<OstNode> = {}) =>
    node(title, "AssumptionTest", [], { body: `Compare two build manifests offline. Lane: ${lane}.`, ...extra });

  test("refuses when the test's own prose declares a different lane", () => {
    write(withProse("A cheap test", "compute-only"));

    expect(() => flagHumansRequired(dir, { test: "A cheap test", by: "agent", why: "someone has to read it" })).toThrow(
      /already declares a lane/,
    );

    // Nothing was written: no label, and no History line claiming one.
    const after = new Vault(dir).read("A cheap test");
    expect(after.lane).toBeUndefined();
    expect(after.body).not.toContain("## History");
    // And the tree it refused to make is the one `laneConflicts` reports.
    expect(laneConflicts([after])).toEqual([]);
  });

  test("NON-VACUITY: the same call on the same test WITHOUT the declaration writes the label", () => {
    // The control. Without it, the refusal above would also be satisfied by a
    // function that refused everything — including the flag this capability
    // exists to make. Same title, same filing, one sentence different.
    write(node("A cheap test", "AssumptionTest", [], { body: "Compare two build manifests offline." }));

    flagHumansRequired(dir, { test: "A cheap test", by: "agent", why: "someone has to read it" });

    expect(new Vault(dir).read("A cheap test").lane).toBe(CAUTIOUS_LANE);
  });

  test("PROOF THE ASSERTION CAN FAIL: with the guard's condition inverted, the conflict is authored", () => {
    // How the refusal was proved non-vacuous, executed rather than described.
    // This is what `flagHumansRequired` did before R2, reconstructed through the
    // writer it delegates to — the same `setLane` call, with the prose check
    // skipped. It authors exactly the `lane-conflict` the guard now refuses, so
    // the guard is preventing something that really happens.
    write(withProse("A cheap test", "compute-only"));
    setLane(dir, { test: "A cheap test", lane: CAUTIOUS_LANE, by: "the pre-R2 code path", why: "no prose check" });

    const conflicts = laneConflicts(new Vault(dir).readTree());
    expect(conflicts.map((c) => c.test)).toEqual(["A cheap test"]);
    expect(conflicts[0]).toMatchObject({ declared: "compute-only", labelled: CAUTIOUS_LANE });
  });

  test("agreeing prose is not a conflict, so the flag still lands on it", () => {
    // The refusal is about a DIFFERENT lane, not about prose mentioning one. A
    // test whose sentence already says humans-required is the easy case, and
    // refusing it would make the capability unusable on the tests it is for.
    write(withProse("A costly test", CAUTIOUS_LANE));

    flagHumansRequired(dir, { test: "A costly test", by: "agent", why: "the prose agrees" });

    expect(new Vault(dir).read("A costly test").lane).toBe(CAUTIOUS_LANE);
  });

  test("a sentence naming two lanes is not a declaration, so it does not block the flag either", () => {
    // `proseLaneAmbiguity`'s case: "compute-only for the census, humans-required
    // for the fixing" answers nothing, produces no `lane-conflict` (the reader
    // requires exactly one name), and so has nothing for this guard to protect.
    // Blocking on it would refuse the flag on precisely the split tests where
    // putting the human half out of compute's reach is the right call.
    write(withProse("A split test", "compute-only for the census, humans-required for the fixing"));

    flagHumansRequired(dir, { test: "A split test", by: "agent", why: "the human half is the measurement" });

    const after = new Vault(dir).read("A split test");
    expect(after.lane).toBe(CAUTIOUS_LANE);
    expect(laneConflicts([after])).toEqual([]);
  });

  test("prose under a `## ` section is commentary, not the node speaking — and does not block", () => {
    // `ownProse` stops at the first heading, and every lane write files a
    // `## History` line saying `lane: <prev> → <next>`. If the guard read the
    // whole body, a re-flag would read the tool's own paper trail as a prose
    // declaration and refuse — the tool arguing with its own record.
    write(node("A test", "AssumptionTest", [], { body: "Compare two manifests.\n\n## History\n- 2026-01-01 lane: (none) → compute-only" }));

    flagHumansRequired(dir, { test: "A test", by: "agent", why: "second look" });

    expect(new Vault(dir).read("A test").lane).toBe(CAUTIOUS_LANE);
  });

  test("the refusal names what to do instead — a wall with no door is the thing R2 is about", () => {
    write(withProse("A cheap test", "compute-only"));
    try {
      flagHumansRequired(dir, { test: "A cheap test", by: "agent", why: "someone has to read it" });
      throw new Error("expected a refusal");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("ost_annotate");
      expect(message).toContain("ost-agent lane");
    }
  });

  test("the human's setter is NOT guarded — the asymmetry survives the fix", () => {
    // The whole design is that the permissive/contradictory call belongs to a
    // person. If this guard had been put on `setLane` instead, R2 would have been
    // closed by taking the decision away from the only actor entitled to make it.
    write(withProse("A cheap test", "compute-only"));

    expect(() =>
      setLane(dir, { test: "A cheap test", lane: CAUTIOUS_LANE, by: "Tanner", why: "the sentence is stale, I will fix it" }),
    ).not.toThrow();
  });
});

describe("cautionBacklog — what a pass would flag, before it flags anything", () => {
  test("lists unlabelled tests whose text names an outside person, and quotes the phrase", () => {
    const tree = [
      node("Interview five real players", "AssumptionTest"),
      node("Replay the recorded runs", "AssumptionTest"),
      node("Two-week recruiting test", "AssumptionTest"),
    ];

    const backlog = cautionBacklog(tree);

    expect(backlog.map((b) => b.test)).toEqual(["Interview five real players", "Two-week recruiting test"]);
    expect(backlog[0].why).toContain("Interview");
  });

  test("never re-touches a test that already carries a lane — including a permissive one", () => {
    // The one case that would be a safety regression rather than mere noise: a
    // human's `compute-only` call must not be quietly reversed by a bulk pass.
    const tree = [
      node("Interview five real players", "AssumptionTest", [], { lane: "compute-only" }),
      node("Recruit a cohort", "AssumptionTest", [], { lane: CAUTIOUS_LANE }),
    ];

    expect(cautionBacklog(tree)).toEqual([]);
  });

  test("stays silent on a test with no marker — silence is 'no marker found', not 'safe'", () => {
    expect(cautionBacklog([node("Replay the recorded runs", "AssumptionTest")])).toEqual([]);
  });

  test("ignores every layer that is not an assumption test", () => {
    expect(cautionBacklog([node("Interview five real players", "Solution")])).toEqual([]);
  });
});

describe("the vocabulary this rests on", () => {
  test("exactly one lane is runnable, and CAUTIOUS_LANE is not it", () => {
    // If a future version makes a second lane runnable, or makes the cautious
    // one runnable, the argument above stops holding — fail here, loudly.
    expect(LANES.filter((l) => l.computeMayRun).map((l) => l.id)).toEqual(["compute-only"]);
    expect(CAUTIOUS_LANE).not.toBe("compute-only");
  });
});
