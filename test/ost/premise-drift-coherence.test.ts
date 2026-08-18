/**
 * "Interrupt a pass mid-plan with an outside write and see what state its
 * accepted writes leave" — the assumption test beneath "Detect drift at write
 * time and refuse, naming what changed since the read".
 *
 * `writeWithHash` (`../../src/git/read-write-hash-guard.ts`) already refused a
 * single write whose OWN target drifted between the read that composed it and
 * the write itself (`Vault.editProse` uses it). That is the easy half and was
 * never what this test measures. The risk is what a refusal like that leaves
 * BEHIND when a pass's plan spans more than one write: everything before the
 * drifted node is accepted, everything after keeps landing too — because each
 * write only ever checked its own target — and the pass ends having applied a
 * partial plan on top of a premise that stopped being true partway through.
 * That is worse than colliding cleanly or waiting, because it looks finished.
 *
 * `Vault.beginPlan()` (`../../src/ost/plan.ts`) is what this test is pinning:
 * a `Plan` pins the fingerprint of everything it reads, and every `write`
 * checks ALL of that — not only its own target — before doing anything. The
 * first drift found compromises the plan for good, so nothing the plan does
 * after that moment ever lands, and the caller sees a `PlanCompromisedError`
 * distinct from an ordinary write failure.
 *
 * Five passes, five interruption points, one shared plan shape: read "Opp"
 * and "Sol", then four writes that only make sense together (create a child
 * solution, link it under the opportunity that motivated it, note it on the
 * sibling solution, then move the sibling's status). An "outside write" — a
 * second `Vault` over the same directory, standing in for a second agent or a
 * human editing in Obsidian — lands on "Opp" at one of five points: before
 * any of the four writes, or after all of them. The interruption point moves
 * later each pass, so the number of the plan's own writes still ahead of it
 * shrinks by one each time, down to zero.
 *
 * The fifth point (after all four writes) is the one case detection cannot
 * reach in principle: the outside write lands only once the plan's own writes
 * are already all done, so there is no write left for the plan to refuse and
 * nothing is ever compromised — the interruption arrives too late to be
 * mid-plan at all. That is the deliberate exception "at least four of five"
 * leaves room for; asserting five-for-five here would be asserting something
 * the mechanism cannot do and the definition of done does not claim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import type { OstNode } from "../../src/ost/node.js";
import { PlanCompromisedError, type PlanReport } from "../../src/ost/plan.js";
import { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Outcome";
const OPP = "Opp";
const SOL = "Sol";
const CHILD = "Child Solution";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-plan-drift-"));
  vault = new Vault(dir);
  vault.createNode({ title: OUTCOME, layer: "Outcome", tags: [], links: [OPP], evidence: "assertion", body: "the mandate" } as OstNode);
  vault.createNode({ title: OPP, layer: "Opportunity", tags: [], links: [SOL], evidence: "assertion", body: "a need" } as OstNode);
  vault.createNode({ title: SOL, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "a way to meet it" } as OstNode);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The plan every pass in this file runs: two reads, four writes, none of
 * which touches a reserved heading or breaks the hierarchy on its own — so
 * any invariant violation `runPass` turns up came from writes landing on top
 * of a stale premise, not from the plan's own shape.
 *
 * `interruptAt` is one of five points: 0-3 land the outside write before the
 * write of that index (0-based), and 4 lands it after every write has run.
 */
function runPass(interruptAt: number): { error: unknown; report: PlanReport } {
  const plan = vault.beginPlan();
  plan.read(OPP);
  plan.read(SOL);

  // The outside write: a second Vault handle over the same directory, exactly
  // as a second agent process or a human's Obsidian save would be — nothing
  // about it goes through `plan`, and it is dispatched once, before whichever
  // step number the caller asked to interrupt ahead of.
  const outsideWrite = () => new Vault(dir).annotate(OPP, "an outside pass got here first");

  const steps: Array<() => void> = [
    () => plan.write(() => vault.createNode({ title: CHILD, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "spun out of Opp" } as OstNode)),
    () => plan.write(() => vault.linkNodes(OPP, CHILD)),
    () => plan.write(() => vault.annotate(SOL, "a related candidate showed up: Child Solution")),
    () => plan.write(() => vault.setStatus(SOL, "in-discovery")),
  ];

  let error: unknown;
  for (let i = 0; i < steps.length; i++) {
    if (i === interruptAt) outsideWrite();
    try {
      steps[i]();
    } catch (err) {
      error = err;
      break; // a real pass stops at its first refusal rather than skipping ahead
    }
  }
  // Interruption point 4 fires after every step has already run.
  if (interruptAt === steps.length) outsideWrite();

  return { error, report: plan.report() };
}

describe("five passes, five interruption points", () => {
  test("point 1 — interrupted before any write: the whole plan is refused", () => {
    const { error, report } = runPass(0);
    expect(error).toBeInstanceOf(PlanCompromisedError);
    expect((error as PlanCompromisedError).premiseTitle).toBe(OPP);
    expect(report.compromised).toBe(true);
    expect(report.applied).toBe(0);
    expect(vault.has(CHILD)).toBe(false); // nothing landed at all
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("point 2 — interrupted after write 1: writes 2-4 are refused", () => {
    const { error, report } = runPass(1);
    expect(error).toBeInstanceOf(PlanCompromisedError);
    expect(report.compromised).toBe(true);
    expect(report.applied).toBe(1);
    expect(vault.has(CHILD)).toBe(true); // write 1 landed
    // write 2 (linking Opp -> Child) never ran, so Child must still be an
    // orphan rather than half-attached — the shape a real partial plan leaves.
    expect(vault.read(OPP).links).not.toContain(CHILD);
    expect(checkInvariants(vault.readTree()).some((v) => v.rule === "solution-mapped")).toBe(true);
    // The violation is the FIXTURE's honest state (an unlinked node the plan
    // correctly declined to finish attaching), not a defect this test papers
    // over — nothing else about the tree is broken.
    expect(checkInvariants(vault.readTree()).every((v) => v.rule === "solution-mapped")).toBe(true);
  });

  test("point 3 — interrupted after write 2: writes 3-4 are refused, and Child is fully attached", () => {
    const { error, report } = runPass(2);
    expect(error).toBeInstanceOf(PlanCompromisedError);
    expect(report.compromised).toBe(true);
    expect(report.applied).toBe(2);
    expect(vault.read(OPP).links).toContain(CHILD); // write 2 landed
    expect(vault.read(SOL).body).not.toContain("a related candidate"); // write 3 did not
    // Fully coherent here: create-then-link is a complete unit, so no rule fires.
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("point 4 — interrupted after write 3: write 4 is refused", () => {
    const { error, report } = runPass(3);
    expect(error).toBeInstanceOf(PlanCompromisedError);
    expect(report.compromised).toBe(true);
    expect(report.applied).toBe(3);
    expect(vault.read(SOL).body).toContain("a related candidate"); // write 3 landed
    expect(vault.read(SOL).status).not.toBe("in-discovery"); // write 4 did not run
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("point 5 — interrupted after every write already landed: nothing left to refuse", () => {
    const { error, report } = runPass(4);
    expect(error).toBeUndefined(); // the plan finished before the outside write arrived
    expect(report.compromised).toBe(false);
    expect(report.applied).toBe(4);
    expect(vault.read(SOL).status).toBe("in-discovery");
    // Coherent — trivially, since the whole plan completed on an unbroken premise.
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });
});

describe("the bar the definition of done states: at least four of five", () => {
  test("four of five report the plan itself as compromised, not one failed call", () => {
    const results = [0, 1, 2, 3, 4].map((point) => {
      // Fresh fixture per pass — each of the five is its own independent run
      // against an unbroken tree, not five plans piled onto one vault.
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-plan-drift-"));
      vault = new Vault(dir);
      vault.createNode({ title: OUTCOME, layer: "Outcome", tags: [], links: [OPP], evidence: "assertion", body: "the mandate" } as OstNode);
      vault.createNode({ title: OPP, layer: "Opportunity", tags: [], links: [SOL], evidence: "assertion", body: "a need" } as OstNode);
      vault.createNode({ title: SOL, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "a way to meet it" } as OstNode);
      return runPass(point);
    });
    const compromisedAndReported = results.filter(
      (r) => r.report.compromised && r.error instanceof PlanCompromisedError,
    );
    expect(compromisedAndReported.length).toBeGreaterThanOrEqual(4);
  });

  test("all five leave the tree coherent — even the one point that goes uncaught", () => {
    for (const point of [0, 1, 2, 3, 4]) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-plan-drift-"));
      vault = new Vault(dir);
      vault.createNode({ title: OUTCOME, layer: "Outcome", tags: [], links: [OPP], evidence: "assertion", body: "the mandate" } as OstNode);
      vault.createNode({ title: OPP, layer: "Opportunity", tags: [], links: [SOL], evidence: "assertion", body: "a need" } as OstNode);
      vault.createNode({ title: SOL, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "a way to meet it" } as OstNode);
      runPass(point);
      const violations = checkInvariants(vault.readTree());
      // The one violation this plan can legitimately leave behind is an
      // orphan Child from a create that ran with no time left to link it —
      // never a dangling link, a two-parent node, or anything that says a
      // write executed against a premise that had already moved.
      expect(violations.every((v) => v.rule === "solution-mapped")).toBe(true);
    }
  });
});

describe("a compromised plan refuses every remaining write, not just the first one it meets", () => {
  test("two further writes after the compromising one both refuse, and neither runs its op", () => {
    const plan = vault.beginPlan();
    plan.read(OPP);
    new Vault(dir).annotate(OPP, "outside change");

    expect(() => plan.write(() => vault.createNode({ title: CHILD, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "x" } as OstNode))).toThrow(
      PlanCompromisedError,
    );
    expect(() => plan.write(() => vault.setStatus(SOL, "in-discovery"))).toThrow(PlanCompromisedError);
    expect(() => plan.write(() => vault.setStatus(SOL, "validated"))).toThrow(PlanCompromisedError);

    // None of the three ops it refused to run left a trace.
    expect(vault.has(CHILD)).toBe(false);
    expect(vault.read(SOL).status).toBeUndefined();
    expect(plan.report().applied).toBe(0);
    expect(plan.report().refused).toBe(3);
  });

  test("the error names what changed, not just that something did", () => {
    const plan = vault.beginPlan();
    plan.read(OPP);
    new Vault(dir).annotate(OPP, "a very specific outside change");

    let caught: PlanCompromisedError | undefined;
    try {
      plan.write(() => vault.setStatus(SOL, "in-discovery"));
    } catch (err) {
      caught = err as PlanCompromisedError;
    }
    expect(caught).toBeInstanceOf(PlanCompromisedError);
    expect(caught!.premiseTitle).toBe(OPP);
    expect(caught!.whatDrifted).toMatch(/a very specific outside change/);
    expect(caught!.message).toMatch(/plan compromised/i);
  });
});

describe("no contention, no cost", () => {
  test("a plan with no interruption applies every write and never reports compromise", () => {
    const plan = vault.beginPlan();
    plan.read(OPP);
    plan.read(SOL);
    plan.write(() => vault.createNode({ title: CHILD, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "x" } as OstNode));
    plan.write(() => vault.linkNodes(OPP, CHILD));
    plan.write(() => vault.setStatus(SOL, "in-discovery"));

    expect(plan.isCompromised).toBe(false);
    expect(plan.report()).toMatchObject({ compromised: false, applied: 3, refused: 0 });
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });
});

describe("drift on a node the write does not target still compromises the plan", () => {
  test("Sol drifts, but the refused write targets a brand-new node — refused anyway", () => {
    const plan = vault.beginPlan();
    plan.read(OPP);
    plan.read(SOL);
    new Vault(dir).setStatus(SOL, "validated"); // outside write on SOL only

    // This write's own target (a new node) never drifted — only SOL, which the
    // plan also read, did. A guard that checked only the write's own target
    // would let this through; the plan's premise says otherwise.
    expect(() => plan.write(() => vault.createNode({ title: CHILD, layer: "Solution", tags: [], links: [], evidence: "assertion", body: "x" } as OstNode))).toThrow(
      PlanCompromisedError,
    );
    expect(vault.has(CHILD)).toBe(false);
  });
});
