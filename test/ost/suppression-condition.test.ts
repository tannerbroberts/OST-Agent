/**
 * "Write four real suppression conditions and check each evaluates without judgement"
 * — the instrument behind "An item a pass declined is suppressed until the reason it
 * was declined stops holding".
 *
 * The assumption under test is feasibility, and it is the whole solution: suppression
 * is safe only if the reviving condition is evaluable without judgement. The
 * pre-committed threshold, verbatim: all four real declines express as conditions
 * that evaluate to a boolean against the tree alone, and all four revive when
 * flipped; one prose-only condition refutes.
 *
 * The four declines are ones this product's own vault actually produced, not
 * invented ones: a solution declined because it is shipped, a test declined because
 * it needs people outside the building, an item declined because the surface lacked
 * the tool to classify it (the 2026-08-06 sweep, `ost_flag_humans_required`
 * ungranted), and an unknown declined for want of a Format.
 *
 * What a green here does NOT settle, verbatim from the assumption test: whether
 * agents choose honest conditions when unobserved. This file proves an evaluable
 * condition revives; a condition chosen because it will never flip is the actual
 * abuse, and it needs a human reading suppressions over time — which is why the
 * write path is the CLI's, not any agent tool's.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { Vault } from "../../src/ost/vault.js";
import {
  appendSuppression,
  conditionHolds,
  parseSuppressionCondition,
  readSuppressionLedger,
  suppressionLedgerPath,
  PROSE_REFUSAL,
} from "../../src/knowledge/suppressions.js";
import type { OstNode } from "../../src/ost/node.js";

const OUTCOME = "OST-Agent (meta)";
const OPPORTUNITY = "Each pass leaves me more to check than it started with";
const SHIPPED_SOLUTION = "A briefing generator that already shipped";
const HUMANS_TEST = "Show five operators the dismissed-work list";
const UNLABELLED_TEST = "A test the ungranted sweep could not classify";
const UNKNOWN = "What a maintainer would pay per month";

const CLOCK = (): Date => new Date("2026-08-12T10:00:00.000Z");

let dir: string;
let v: Vault;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-suppress-"));
  await initVault(dir, "Pour thinking power onto problems", OUTCOME);
  v = buildPassContext(dir).vault;

  v.createNode({ title: OPPORTUNITY, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
  v.linkNodes(OUTCOME, OPPORTUNITY);

  // Decline 1's subject: a shipped solution with no assumption tests, which every
  // sweep re-meets on `solutionsMissingAssumptions` and re-declines on its status.
  v.createNode({ title: SHIPPED_SOLUTION, layer: "Solution", evidence: "observed", body: "b", tags: [], links: [] });
  v.linkNodes(OPPORTUNITY, SHIPPED_SOLUTION);
  v.setStatus(SHIPPED_SOLUTION, "shipped");

  // Decline 2's subject: a test whose lane says real outside people are the measurement.
  v.createNode({ title: HUMANS_TEST, layer: "AssumptionTest", evidence: "assertion", lane: "humans-required", body: "b", tags: [], links: [] });

  // Decline 3's subject: a test with no lane label at all — what the 2026-08-06 sweep
  // left behind when `ost_flag_humans_required` was not granted on its surface. The
  // fail-closed lane rule files it under needsHumans until somebody can label it.
  v.createNode({ title: UNLABELLED_TEST, layer: "AssumptionTest", evidence: "assertion", body: "b", tags: [], links: [] });

  // Decline 4's subject: an unknown that cannot say what an answer looks like.
  v.createNode({ title: UNKNOWN, layer: "Unknown", evidence: "assertion", body: "b", tags: [], links: [] });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const index = (): Map<string, OstNode> => new Map(v.readTree().map((n) => [n.title, n]));

/** The titles a lane bucket is offering — each entry is a row, not a bare title. */
function offered(rows: readonly { test: string }[]): string[] {
  return rows.map((r) => r.test);
}

test("decline 1 — a solution declined because it is shipped: suppressed while shipped, offered again when the status flips", () => {
  // The condition is a typed object, and it evaluates to a boolean against the tree alone.
  const condition = parseSuppressionCondition({ holdsWhile: "status-is", node: SHIPPED_SOLUTION, status: "shipped" });
  expect(conditionHolds(condition, index())).toBe(true);

  // Non-vacuity: the demand is real before the suppression.
  expect(computeNextWork(v, dir, 1).solutionsMissingAssumptions.map((s) => s.title)).toContain(SHIPPED_SOLUTION);

  appendSuppression(
    dir,
    { subject: SHIPPED_SOLUTION, condition: { holdsWhile: "status-is", node: SHIPPED_SOLUTION, status: "shipped" }, reason: "shipped — every sweep that reads its body re-declines it", by: "unattended-pass" },
    CLOCK,
  );

  // Suppressed: off the list, disclosed on the response that withheld it, and not a
  // delete — the node is still on disk and still in the tree.
  const during = computeNextWork(v, dir, 1);
  expect(during.solutionsMissingAssumptions.map((s) => s.title)).not.toContain(SHIPPED_SOLUTION);
  const disclosed = during.suppressedByCondition.find((s) => s.subject === SHIPPED_SOLUTION);
  expect(disclosed?.list).toBe("solutionsMissingAssumptions");
  expect(during.summary).toContain(SHIPPED_SOLUTION);
  expect(v.readTree().some((n) => n.title === SHIPPED_SOLUTION)).toBe(true);

  // Flip the fact. The condition stops holding and the item is offered again on the
  // next call — no write to the ledger, nothing cleared, the tree changing is the clear.
  v.setStatus(SHIPPED_SOLUTION, "in-discovery");
  expect(conditionHolds(condition, index())).toBe(false);
  const after = computeNextWork(v, dir, 1);
  expect(after.solutionsMissingAssumptions.map((s) => s.title)).toContain(SHIPPED_SOLUTION);
  expect(after.suppressedByCondition.find((s) => s.subject === SHIPPED_SOLUTION)).toBeUndefined();
});

test("decline 2 — a test declined because it needs people outside the building: suppressed while the lane says so", () => {
  const condition = parseSuppressionCondition({ holdsWhile: "lane-is", node: HUMANS_TEST, lane: "humans-required" });
  expect(conditionHolds(condition, index())).toBe(true);
  expect(offered(computeNextWork(v, dir, 1).assumptionWork.needsHumans)).toContain(HUMANS_TEST);

  appendSuppression(
    dir,
    { subject: HUMANS_TEST, condition: { holdsWhile: "lane-is", node: HUMANS_TEST, lane: "humans-required" }, reason: "needs recruiting; an unattended sweep can never act on it", by: "unattended-pass" },
    CLOCK,
  );
  const during = computeNextWork(v, dir, 1);
  expect(offered(during.assumptionWork.needsHumans)).not.toContain(HUMANS_TEST);
  expect(during.suppressedByCondition.find((s) => s.subject === HUMANS_TEST)?.list).toBe("assumptionWork.needsHumans");
  // The person's own queue is deliberately not muted by a pass's decline.
  expect(during.outstandingAsks.map((a) => a.test)).toContain(HUMANS_TEST);

  // A human re-classifies the test; the reason for the decline stops holding and the
  // test is offered again — in the lane it now belongs to.
  v.setLane(HUMANS_TEST, "compute-only");
  expect(conditionHolds(condition, index())).toBe(false);
  const after = computeNextWork(v, dir, 1);
  expect(offered(after.assumptionWork.runnable)).toContain(HUMANS_TEST);
  expect(after.suppressedByCondition.find((s) => s.subject === HUMANS_TEST)).toBeUndefined();
});

test("decline 3 — an item declined because the surface lacked the tool to classify it: suppressed while unlabelled, revives on the label", () => {
  const condition = parseSuppressionCondition({ holdsWhile: "lane-unlabelled", node: UNLABELLED_TEST });
  expect(conditionHolds(condition, index())).toBe(true);
  expect(offered(computeNextWork(v, dir, 1).assumptionWork.needsHumans)).toContain(UNLABELLED_TEST);

  appendSuppression(
    dir,
    { subject: UNLABELLED_TEST, condition: { holdsWhile: "lane-unlabelled", node: UNLABELLED_TEST }, reason: "ost_flag_humans_required was not granted on this surface; nothing here can label it", by: "unattended-pass" },
    CLOCK,
  );
  expect(offered(computeNextWork(v, dir, 1).assumptionWork.needsHumans)).not.toContain(UNLABELLED_TEST);

  // Somebody with the tool labels it. The condition flips and the test is offered again.
  v.setLane(UNLABELLED_TEST, "one-command");
  expect(conditionHolds(condition, index())).toBe(false);
  expect(offered(computeNextWork(v, dir, 1).assumptionWork.awaitingOneCommand)).toContain(UNLABELLED_TEST);
});

test("decline 4 — an unknown declined for want of a Format: suppressed while the section is missing, revives when it is declared", () => {
  const condition = parseSuppressionCondition({ holdsWhile: "section-missing", node: UNKNOWN, section: "Format" });
  expect(conditionHolds(condition, index())).toBe(true);
  const before = computeNextWork(v, dir, 1);
  expect(before.openUnknowns.map((u) => u.title)).toContain(UNKNOWN);
  expect(before.openUnknowns.find((u) => u.title === UNKNOWN)?.gaps).toContain("Format");

  appendSuppression(
    dir,
    { subject: UNKNOWN, condition: { holdsWhile: "section-missing", node: UNKNOWN, section: "Format" }, reason: "cannot say what an answer looks like, so there is no stopping condition to work toward", by: "unattended-pass" },
    CLOCK,
  );
  expect(computeNextWork(v, dir, 1).openUnknowns.map((u) => u.title)).not.toContain(UNKNOWN);

  v.appendToNode(UNKNOWN, "## Format\nA dollar figure with a date.");
  expect(conditionHolds(condition, index())).toBe(false);
  expect(computeNextWork(v, dir, 1).openUnknowns.map((u) => u.title)).toContain(UNKNOWN);
});

test("a prose-only condition refutes: refused at the write funnel, nothing lands on the ledger, the item stays offered", () => {
  // The condition the failure paragraph warns about — a promise nobody can check.
  expect(() =>
    appendSuppression(dir, { subject: SHIPPED_SOLUTION, condition: "until the team has bandwidth to revisit this", reason: "r", by: "unattended-pass" }, CLOCK),
  ).toThrow(PROSE_REFUSAL);
  // Prose with a field name is still prose.
  expect(() =>
    appendSuppression(dir, { subject: SHIPPED_SOLUTION, condition: { holdsWhile: "when it feels ready", node: SHIPPED_SOLUTION }, reason: "r", by: "unattended-pass" }, CLOCK),
  ).toThrow(PROSE_REFUSAL);

  // Refused means refused: no ledger file was written, and the item is still offered.
  expect(fs.existsSync(suppressionLedgerPath(dir))).toBe(false);
  expect(readSuppressionLedger(dir).histories.size).toBe(0);
  expect(computeNextWork(v, dir, 1).solutionsMissingAssumptions.map((s) => s.title)).toContain(SHIPPED_SOLUTION);
});

test("fail-open, both directions: a hand-damaged ledger line suppresses nothing, and a condition whose node left the tree stops holding", () => {
  // A truncated line — the ledger was edited by hand or half-written. It must
  // surface MORE work, never less.
  fs.mkdirSync(path.dirname(suppressionLedgerPath(dir)), { recursive: true });
  fs.appendFileSync(suppressionLedgerPath(dir), `{"ts":"2026-08-12T00:00:00.000Z","subject":"${SHIPPED_SOLUTION}","condition":"until things calm down"}\n`);
  const work = computeNextWork(v, dir, 1);
  expect(work.solutionsMissingAssumptions.map((s) => s.title)).toContain(SHIPPED_SOLUTION);
  expect(work.summary).toContain("suppression ledger line(s) would not parse");

  // A condition over a node nobody can find evaluates to not-holding: a fact that
  // can no longer be checked must not be the thing keeping work off a list.
  const orphaned = parseSuppressionCondition({ holdsWhile: "status-is", node: "A node that does not exist", status: "shipped" });
  expect(conditionHolds(orphaned, index())).toBe(false);
});
