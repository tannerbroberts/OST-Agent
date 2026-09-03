/**
 * The standing queue of pending asks — the instrument for the solution node
 * "A standing queue of pending asks the operator clears at whatever cadence
 * suits them".
 *
 * The two properties that separate this from what already shipped, per the
 * node's definition of done:
 *
 *   1. An ask raised MID-PASS by one run is still in the queue on a later run.
 *      Before this, only a `pending-permission` lane call persisted an ask; a
 *      run that flagged a test humans-required — the one surface an unattended
 *      pass actually holds for "I cannot answer this" — left nothing behind,
 *      so the queue showed the test ageless or not at all.
 *   2. The entry carries a NON-NULL age plus the command that would clear it.
 *      Age is what makes this a queue rather than a second inbox: the run that
 *      filed the ask was gone before the days elapsed, and only the queue can
 *      tell the operator how long silence has lasted.
 *
 * Every test is offline and clock-injected, like `test/knowledge/asks.test.ts`:
 * an assertion about "days waiting" cannot afford to race the wall clock.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { flagHumansRequired, setLane } from "../../src/ost/lanes.js";
import { recordResult } from "../../src/ost/results.js";
import { readPendingAskQueue } from "../../src/ost/pending-asks.js";

let dir: string;
const T0 = new Date("2026-01-01T00:00:00.000Z");
const daysLater = (n: number) => () => new Date(T0.getTime() + n * 86_400_000);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ask-queue-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
  const ctx = buildPassContext(dir);
  ctx.vault.createNode({ title: "Users churn after week one", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  ctx.vault.createNode({ title: "Onboarding checklist", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  ctx.vault.createNode({
    title: "Five operators try the checklist",
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "Watch five operators work through the checklist unprompted.",
    tags: [],
    links: [],
    instrument: "npx vitest run test/checklist.test.ts",
  });
  ctx.vault.linkNodes("Retention", "Users churn after week one");
  ctx.vault.linkNodes("Users churn after week one", "Onboarding checklist");
  ctx.vault.linkNodes("Onboarding checklist", "Five operators try the checklist");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("an ask raised mid-pass survives into later runs", () => {
  test("a humans-required flag filed by one run is still in the queue when a later run reads it, aged and actionable", () => {
    // Run one: mid-pass, the agent hits a test it cannot answer itself and
    // flags it — the only "I cannot do this" surface an unattended pass holds.
    flagHumansRequired(dir, {
      test: "Five operators try the checklist",
      by: "run-one",
      why: "a person's reaction is the measurement",
    }, daysLater(0));

    // A later run, eleven days on: a FRESH context over the same vault — run
    // one is long gone, so everything here must come off disk.
    const work = computeNextWork(buildPassContext(dir).vault, dir, 3, daysLater(11));
    const entry = work.outstandingAsks.find((a) => a.test === "Five operators try the checklist");
    expect(entry).toBeDefined();
    // The two load-bearing properties: a non-null age — eleven days is a
    // different object from an hour, and only the queue can say so — and the
    // command that clears the entry, so the operator gets an action, not a title.
    expect(entry!.ageDays).toBe(11);
    expect(entry!.askedAt).toBe(T0.toISOString());
    expect(entry!.command).toContain('ost-agent result "Five operators try the checklist"');
  });

  test("a pending-permission classification lands in the queue the same way, command included", () => {
    setLane(
      dir,
      { test: "Five operators try the checklist", lane: "pending-permission", by: "run-one", why: "needs the recruiting budget signed off" },
      daysLater(0),
    );
    const work = computeNextWork(buildPassContext(dir).vault, dir, 3, daysLater(4));
    expect(work.outstandingAsks).toEqual([
      {
        test: "Five operators try the checklist",
        instrument: "npx vitest run test/checklist.test.ts",
        askedAt: T0.toISOString(),
        ageDays: 4,
        command: expect.stringContaining('ost-agent result "Five operators try the checklist"'),
      },
    ]);
  });
});

describe("the queue clears itself — nothing is ever marked answered", () => {
  test("recording a result drops the entry, however the ask was raised", () => {
    flagHumansRequired(dir, {
      test: "Five operators try the checklist",
      by: "run-one",
      why: "a person's reaction is the measurement",
    }, daysLater(0));
    recordResult(dir, {
      test: "Five operators try the checklist",
      verdict: "supported",
      note: "five operators worked the list unprompted",
      by: "tanner",
      uncovered: "only this cohort",
    });
    const work = computeNextWork(buildPassContext(dir).vault, dir, 3, daysLater(11));
    expect(work.outstandingAsks).toEqual([]);
  });

  test("an unlabelled test is triage backlog, not an ask — the queue never mirrors needsHumans", () => {
    // Nobody classified it and nobody asked; putting it here would make the
    // queue the second inbox the solution node warns against.
    const work = computeNextWork(buildPassContext(dir).vault, dir, 3, daysLater(1));
    expect(work.assumptionWork.needsHumans.map((t) => t.test)).toContain("Five operators try the checklist");
    expect(work.outstandingAsks).toEqual([]);
  });
});

describe("the operator's own surface reads the same queue", () => {
  test("readPendingAskQueue returns the entry oldest-first with lane, why and the clearing command", () => {
    flagHumansRequired(dir, {
      test: "Five operators try the checklist",
      by: "run-one",
      why: "a person's reaction is the measurement",
    }, daysLater(0));
    const queue = readPendingAskQueue(dir, buildPassContext(dir).vault.readTree(), daysLater(11));
    expect(queue).toEqual([
      {
        test: "Five operators try the checklist",
        lane: "humans-required",
        askedAt: T0.toISOString(),
        ageDays: 11,
        why: "a person's reaction is the measurement",
        command: expect.stringContaining('ost-agent result "Five operators try the checklist"'),
      },
    ]);
  });
});
