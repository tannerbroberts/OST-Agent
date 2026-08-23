/**
 * "An acknowledgement that records a decision not to act, and takes the item off the
 * sweep" — the instrument behind "Have a human review a pass's acknowledgements and
 * count how many were avoidance".
 *
 * Three consecutive sweeps of this project's own vault read their stranded evidence in
 * full and found the same shape: most items corroborate a need the tree already holds,
 * a small constant fraction is genuinely new, and near zero are "nobody should act on
 * this". The verb the surface lacked is therefore not plain dismissal — it is an
 * acknowledgement whose verdict is typed, because "read, counted toward [[X]]" and
 * "read, nothing here" are different claims and only the first should ever be able to
 * strengthen a node's evidence later. What this file pins, in that sharpened form:
 *
 *   - an acknowledged item leaves `unmappedEvidence` without being deleted and without
 *     being mapped — no record removed, no node created to carry a `source:`;
 *   - the reason persists append-only — later entries extend the history, nothing
 *     rewrites it;
 *   - `corroborates [[X]]` is stored as a verdict DISTINCT from "no genuine need", and
 *     only corroborations surface through the read that can strengthen a node.
 *
 * What a green here does not settle, and it is the node's own central worry: whether
 * the reason written into an acknowledgement was honest. That is the humans-required
 * review this instrument deliberately leaves standing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { byTitle, readEvidence, writeEvidence } from "../../src/processes/tree.js";
import {
  appendDisposition,
  corroborationsFor,
  dispositionLedgerPath,
  readDispositionLedger,
} from "../../src/knowledge/dispositions.js";

const OUTCOME = "Retention";
const NEED = "Users churn after week one";
const CORROBORATING = "TRANSCRIPT:ninth-session-with-the-same-stall.md";
const EMPTY = "USAGE:2026-08-02-a-clean-day.md";

let dir: string;

const CLOCK = (): Date => new Date("2026-08-08T10:00:00.000Z");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-acknowledge-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A vault holding one existing need and two unmapped evidence records: one that
 * corroborates the need, one that reveals nothing anyone should act on. */
function vaultWithStrandedEvidence() {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);
  writeEvidence(
    dir,
    { id: CORROBORATING, source: CORROBORATING, title: "Same stall, ninth session", timestamp: "2026-08-01", body: "b" },
    "transcript",
  );
  writeEvidence(dir, { id: EMPTY, source: EMPTY, title: "A clean day", timestamp: "2026-08-02", body: "b" }, "usage");
  return v;
}

/** The tree an acknowledgement is filed against — read fresh, the way every caller does. */
const treeIndex = () => byTitle(buildPassContext(dir).vault.readTree());

/** Acknowledge one evidence item with a typed verdict, the way the CLI write path does. */
function acknowledge(subject: string, verdict: "corroborates" | "no-genuine-need", reason: string): void {
  appendDisposition(
    dir,
    { subject, kind: "evidence", state: "closed", reason, by: "operator", verdict, node: verdict === "corroborates" ? NEED : undefined },
    treeIndex(),
    CLOCK,
  );
}

describe("an acknowledged item leaves the sweep without being deleted and without being mapped", () => {
  test("both verdicts take the item off unmappedEvidence; neither erases or maps it", () => {
    const v = vaultWithStrandedEvidence();

    // Non-vacuity: both records are outstanding before anything is acknowledged.
    const before = computeNextWork(v, dir, 3);
    expect(before.unmappedEvidence.map((e) => e.id)).toEqual(expect.arrayContaining([CORROBORATING, EMPTY]));
    const nodesBefore = v.readTree().length;

    acknowledge(CORROBORATING, "corroborates", "ninth independent session with the stall the need already names");
    acknowledge(EMPTY, "no-genuine-need", "a clean day reveals no need of its own");

    const after = computeNextWork(v, dir, 3);
    expect(after.unmappedEvidence.map((e) => e.id)).not.toContain(CORROBORATING);
    expect(after.unmappedEvidence.map((e) => e.id)).not.toContain(EMPTY);

    // Not deleted: both records are still on disk, bodies intact, readable by id.
    expect(readEvidence(dir).map((e) => e.id)).toEqual(expect.arrayContaining([CORROBORATING, EMPTY]));

    // Not mapped: mapping is a node whose `source:` frontmatter carries the id, and
    // acknowledging created no node at all.
    expect(v.readTree().length).toBe(nodesBefore);
    expect(v.readTree().some((n) => n.source === CORROBORATING || n.source === EMPTY)).toBe(false);

    // And not hidden silently: the withdrawal is named on the response that made it.
    const withheld = after.withheldByDisposition.filter((w) => w.list === "unmappedEvidence");
    expect(withheld.map((w) => w.subject).sort()).toEqual([CORROBORATING, EMPTY].sort());
  });
});

describe("the reason persists append-only", () => {
  test("later entries extend the file; nothing rewrites the acknowledgement already on it", () => {
    vaultWithStrandedEvidence();
    acknowledge(CORROBORATING, "corroborates", "ninth independent session with the same stall");
    const file = dispositionLedgerPath(dir);
    const first = fs.readFileSync(file, "utf8");

    acknowledge(EMPTY, "no-genuine-need", "a clean day reveals no need of its own");
    appendDisposition(
      dir,
      { subject: CORROBORATING, kind: "evidence", state: "reopened", reason: "read it again — it is new after all", by: "operator" },
      treeIndex(),
      CLOCK,
    );

    // Byte-level: the file only ever grew. The first acknowledgement is still there
    // verbatim, and the dispute that reversed it sits beside it rather than over it.
    expect(fs.readFileSync(file, "utf8").startsWith(first)).toBe(true);
    const history = readDispositionLedger(dir).histories.get(CORROBORATING);
    expect(history).toHaveLength(2);
    expect(history?.[0].reason).toBe("ninth independent session with the same stall");
    expect(history?.[1].state).toBe("reopened");
  });
});

describe('"corroborates [[X]]" is a distinct verdict from "no genuine need"', () => {
  test("the two verdicts are stored typed, not as prose a reader would have to parse", () => {
    vaultWithStrandedEvidence();
    acknowledge(CORROBORATING, "corroborates", "ninth session");
    acknowledge(EMPTY, "no-genuine-need", "clean day");

    const ledger = readDispositionLedger(dir);
    const counted = ledger.histories.get(CORROBORATING)?.[0];
    const empty = ledger.histories.get(EMPTY)?.[0];
    expect(counted?.verdict).toBe("corroborates");
    expect(counted?.node).toBe(NEED);
    expect(empty?.verdict).toBe("no-genuine-need");
    expect(empty?.node).toBeUndefined();
  });

  test("only a corroboration can strengthen a node later — the other verdict surfaces for no node", () => {
    vaultWithStrandedEvidence();
    acknowledge(CORROBORATING, "corroborates", "ninth session");
    acknowledge(EMPTY, "no-genuine-need", "clean day");

    const ledger = readDispositionLedger(dir);
    const strengthening = corroborationsFor(ledger, NEED);
    expect(strengthening.map((c) => c.subject)).toEqual([CORROBORATING]);
    expect(strengthening[0].reason).toBe("ninth session");
  });

  test("a reopened corroboration stops strengthening — the dispute wins until it is re-closed", () => {
    vaultWithStrandedEvidence();
    acknowledge(CORROBORATING, "corroborates", "ninth session");
    expect(corroborationsFor(readDispositionLedger(dir), NEED)).toHaveLength(1);

    appendDisposition(
      dir,
      { subject: CORROBORATING, kind: "evidence", state: "reopened", reason: "the filing looks wrong", by: "operator" },
      treeIndex(),
      CLOCK,
    );
    expect(corroborationsFor(readDispositionLedger(dir), NEED)).toHaveLength(0);
  });

  test("the funnel refuses the writes that would blur the two verdicts", () => {
    // A corroboration that names no node cannot strengthen anything, which is the
    // entire point of the verdict — refused, not stored degraded.
    expect(() =>
      appendDisposition(dir, { subject: CORROBORATING, kind: "evidence", state: "closed", reason: "r", by: "o", verdict: "corroborates" }, treeIndex(), CLOCK),
    ).toThrow(/needs the node/);
    // And "no genuine need" naming a node is a contradiction wearing a verdict.
    expect(() =>
      appendDisposition(
        dir,
        { subject: EMPTY, kind: "evidence", state: "closed", reason: "r", by: "o", verdict: "no-genuine-need", node: NEED },
        treeIndex(),
        CLOCK,
      ),
    ).toThrow(/corroborates/);
    expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);
  });

  test("a hand-mangled verdict fails closed in both directions: no work removed, no node strengthened", () => {
    const v = vaultWithStrandedEvidence();
    fs.mkdirSync(path.dirname(dispositionLedgerPath(dir)), { recursive: true });
    fs.appendFileSync(
      dispositionLedgerPath(dir),
      `${JSON.stringify({ ts: "2026-08-08T10:00:00.000Z", subject: CORROBORATING, kind: "evidence", state: "closed", reason: "r", by: "o", verdict: "definitely-fine" })}\n`,
    );

    const ledger = readDispositionLedger(dir);
    expect(ledger.damaged).toBe(1);
    expect(corroborationsFor(ledger, NEED)).toHaveLength(0);
    expect(computeNextWork(v, dir, 3).unmappedEvidence.map((e) => e.id)).toContain(CORROBORATING);
  });
});
