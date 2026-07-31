/**
 * A corroboration names a first-party result that exists, has an outcome, and was
 * a test OF THIS SOURCE. (V1 readiness, B4 — and the replay B5 added to it.)
 *
 * The refusal rows are the criterion's, run through the tool rather than against
 * `checkCorroboration` directly — B4 is a claim about what an agent holding
 * `ost_rank_source` can do, and a guard that is unit-tested but unwired is the failure
 * B12 exists to name.
 *
 * **What changed with the actor ledger, and what did not.** The agent no longer names a
 * rung: the input is `{kind, id, direction, reason}` and the rung is computed. So the
 * fourth row — "an unrecognized rung refuses with the ceiling, not with corroboration" —
 * is now an enum/namespace refusal, and it keeps its meaning: the wrong *thing* is
 * complained about first. The other three rows are unchanged in substance. Two rows are
 * NEW, and they are the ones the ledger earns: a corroboration must be joined to a node
 * that cited this source, and the verdict is read off the named test rather than
 * supplied — so citing a REFUTED test lowers the source in the same call meant to raise
 * it.
 *
 * The rows that must PASS are here for the same reason as always: a guard that also
 * blocked withdrawal would be a wedge pointed at the safe direction, and nothing about
 * "refuses four bad calls" would have caught it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { readTrustLedger, rungOf, trustLedgerPath, actorKey } from "../../src/knowledge/actor-trust.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { Vault } from "../../src/ost/vault.js";
import { RESULTS_HEADING } from "../../src/ost/headings.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-b4-"));
  vault = new Vault(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Runnable = { name: string; run: (i: unknown) => Promise<string> };

function rankSource(): Runnable {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  return buildOstTools(ctx).find((t) => t.name === "ost_rank_source") as unknown as Runnable;
}

/** The wire half of the same rule — what `validateToolInput` would refuse before `run`. */
function rankSourceSchema(): { properties: { kind: { enum: string[] } } } {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const built = buildOstTools(ctx).find((t) => t.name === "ost_rank_source")!;
  return (built as unknown as { input_schema: { properties: { kind: { enum: string[] } } } }).input_schema;
}

function writeTest(title: string, body: string, source?: string): void {
  const node: OstNode = { title, layer: "AssumptionTest", body, tags: [], links: [], evidence: "assertion", source };
  vault.createNode(node);
}

/**
 * Record a result the way the only actor allowed to record one does.
 *
 * `## Results` is a reserved heading (`src/ost/headings.ts`), so a fixture that types it
 * into a body is writing something no caller on any surface can write — and a
 * corroboration test whose corroborating result was forged into place is testing a state
 * the tree cannot reach. This is the CLI's own write path.
 */
function recordOutcome(title: string, line: string): void {
  vault.appendUnderSection(title, RESULTS_HEADING, line);
}

/** A test that both carries a result and cites the host — the joined shape. */
function citedTestWithResult(title: string, verdict: string): void {
  writeTest(title, "## Method\nrun the funnel\n", "WEB:example.com");
  recordOutcome(title, `- 2026-01-01 **${verdict}** (ran by Tanner) — what happened`);
}

const corroborate = (reason: string, over: Record<string, unknown> = {}) => ({
  kind: "web",
  id: "example.com",
  direction: "corroborated",
  reason,
  ...over,
});

describe("ost_rank_source — a corroboration must name a result", () => {
  test("refuses a reason naming a node that is not on the tree", async () => {
    await expect(rankSource().run(corroborate("corroborated by [[No Such Test]]"))).rejects.toThrow(
      /"No Such Test" is not on the tree/,
    );
  });

  test("refuses a reason that names no node at all", async () => {
    await expect(rankSource().run(corroborate("looks solid"))).rejects.toThrow(
      /has to name the first-party result that earned it, as a \[\[wikilink\]\]/,
    );
  });

  test("refuses a reason naming a real test that recorded no outcome", async () => {
    writeTest("Real Test", "## Method\nrun the funnel for a week\n", "WEB:example.com");
    await expect(rankSource().run(corroborate("corroborated by [[Real Test]]"))).rejects.toThrow(
      /"Real Test" recorded no outcome/,
    );
  });

  test("refuses a test that recorded an outcome but was never a test OF THIS SOURCE", async () => {
    // The replay the ledger closes: any already-supported test would otherwise mint
    // standing for a source that predicted nothing.
    writeTest("Somebody else's test", "## Method\nran last sprint\n", "INBOX:note.md");
    recordOutcome("Somebody else's test", "- 2026-01-01 **supported** (ran by Tanner) — held");
    await expect(rankSource().run(corroborate("corroborated by [[Somebody else's test]]"))).rejects.toThrow(
      /was never cited on the test\(s\) named here/,
    );
  });

  test("nothing is written to the ledger by a refused corroboration", async () => {
    await expect(rankSource().run(corroborate("looks solid"))).rejects.toThrow();
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(false);
  });

  test("accepts a corroboration citing a test of this source, and the rung is COMPUTED", async () => {
    citedTestWithResult("Real Test", "supported");
    const out = await rankSource().run(corroborate("corroborated by [[Real Test]]"));
    expect(out).toContain("Real Test");
    expect(out).toMatch(/computed from its\s+whole history, never declared/);
    // The rung is not in the record; it is folded out of one.
    const rec = JSON.parse(fs.readFileSync(trustLedgerPath(dir), "utf8").trim());
    expect(rec).not.toHaveProperty("rung");
    expect(rec.verdict).toBe("supported");
    expect(rec.by).toBe("agent:test");
    expect(rungOf(readTrustLedger(dir), actorKey("web", "example.com"))).toBe("expert");
  });

  test("one corroborating result is enough — naming a second that has not run is a plan, not a defect", async () => {
    citedTestWithResult("Ran", "supported");
    writeTest("Queued", "## Method\nnext sprint\n", "WEB:example.com");
    const out = await rankSource().run(corroborate("corroborated by [[Ran]], and [[Queued]] should confirm it"));
    expect(out).toContain("Ran");
    expect(out).not.toContain("Queued"); // an unrun test records nothing
  });

  test("citing a REFUTED test lowers the source — its own promotion attempt is the evidence", async () => {
    citedTestWithResult("The one that failed", "refuted");
    const out = await rankSource().run(corroborate("corroborated by [[The one that failed]]"));
    // The verdict is read off the recorded result, never supplied by the caller.
    expect(out).toContain("refuted");
    expect(rungOf(readTrustLedger(dir), actorKey("web", "example.com"))).toBe("assertion");
  });

  // The safe direction stays free. A source publishing plausible, wrong content on
  // cadence is the expensive failure (B11); making the agent produce paperwork before
  // it could stop trusting one would be a new wedge.
  test("withdrawal needs no citation, and is not undone by a later corroboration", async () => {
    const out = await rankSource().run({
      kind: "web",
      id: "example.com",
      direction: "contradicted",
      reason: "their claim failed to replicate",
    });
    expect(out).toMatch(/struck/);
    expect(rungOf(readTrustLedger(dir), actorKey("web", "example.com"))).toBe("assertion");
    citedTestWithResult("Later test", "supported");
    await rankSource().run(corroborate("corroborated by [[Later test]]"));
    expect(rungOf(readTrustLedger(dir), actorKey("web", "example.com"))).toBe("assertion");
  });

  // The fourth row, transposed. Two spellings of "is this a legal source" was the drift
  // R4 was spent removing: a bad ACTOR must refuse with the namespace, not with a
  // complaint about wikilinks.
  test("an id the namespace refuses complains about the namespace, not about corroboration", async () => {
    await expect(rankSource().run(corroborate("looks solid", { id: "stripe-webhook-feed" }))).rejects.toThrow(
      /is not a hostname/,
    );
    await expect(rankSource().run(corroborate("looks solid", { kind: "money" }))).rejects.toThrow(/not a trust kind/);
  });

  /**
   * The two kinds that are off this surface are refused BY `run`, not only by the enum.
   *
   * The matcher is the point. `rejects.toThrow()` with no pattern passed here while
   * `run` enforced nothing at all — `checkCorroboration` threw about the missing
   * wikilink and the assertion could not tell the two refusals apart. So each row names
   * the sentence it expects, and the reason is one that WOULD be accepted for a rankable
   * kind, so nothing but the kind is left to refuse it.
   *
   * `run` and not just the schema, for the reason `ost_set_status` carries both:
   * `validateToolInput` guards the MCP wire, and every in-process caller walks past it.
   */
  test("the agent cannot file an observation about itself, on the schema OR in run", async () => {
    citedTestWithResult("Real Test", "supported");
    const good = "corroborated by [[Real Test]]";
    for (const kind of ["self", "unattributed"]) {
      await expect(rankSource().run(corroborate(good, { kind, id: kind }))).rejects.toThrow(
        /is not a kind this tool takes an observation about/,
      );
      // The schema half: the value has no argument position either.
      expect(rankSourceSchema().properties.kind.enum).not.toContain(kind);
    }
    // Non-vacuity: the SAME reason, on a rankable kind, is accepted — so the refusals
    // above are about the kind and about nothing else.
    await expect(rankSource().run(corroborate(good))).resolves.toContain("web:example.com");
    expect(rankSourceSchema().properties.kind.enum).toEqual(
      expect.arrayContaining(["web", "channel", "instrument", "sponsor"]),
    );
  });

  test("a channel's standing moves on evidence stamped by the surface, not on the id string", async () => {
    // The citation resolves through the STAMPED actor: this record's id says INBOX and
    // the ingesting surface says `inbox`, so the row is `channel:inbox`.
    writeEvidence(dir, { id: "INBOX:note.md", source: "INBOX:note.md", title: "n", timestamp: "", body: "b" }, "inbox");
    writeTest("Builder was right", "## Method\nchecked it\n", "INBOX:note.md");
    recordOutcome("Builder was right", "- 2026-01-01 **supported** (ran by Tanner) — held");
    const out = await rankSource().run({
      kind: "channel",
      id: "inbox",
      direction: "corroborated",
      reason: "corroborated by [[Builder was right]]",
    });
    expect(out).toContain("channel:inbox");
    // One supported test lifts a channel one rung — never to its 'stated' ceiling in a
    // single call, and never past it however many arrive.
    expect(rungOf(readTrustLedger(dir), actorKey("channel", "inbox"))).toBe("expert");
    expect(out).toContain("ceiling for a channel: 'stated'");
  });
});
