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
import { cautionBacklog, flagHumansRequired, runnableByCompute } from "../../src/ost/lanes.js";
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
