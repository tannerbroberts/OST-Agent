/**
 * A promotion names a corroborating result that exists and has an outcome.
 * (V1 readiness, B4.)
 *
 * The three refusal rows are the criterion's, run through the tool rather than
 * against `checkCorroboration` directly — B4 is a claim about what an agent
 * holding `ost_rank_source` can do, and a guard that is unit-tested but unwired
 * is the failure B12 exists to name. `host` is supplied on every row because the
 * schema requires it (`additionalProperties: false`); omitting it would throw
 * for the wrong reason and prove nothing.
 *
 * The rows that must PASS are here for the same reason: a guard that also blocks
 * demotion would be a wedge pointed at the safe direction, and nothing about
 * "refuses three bad calls" would have caught it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { hostTrustPath } from "../../src/knowledge/web-trust.js";
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

function writeTest(title: string, body: string): void {
  const node: OstNode = { title, layer: "AssumptionTest", body, tags: [], links: [], evidence: "assertion" };
  vault.createNode(node);
}

/**
 * Record a result the way the only actor allowed to record one does.
 *
 * `## Results` is a reserved heading (`src/ost/headings.ts`), so a fixture that
 * types it into a body is writing something no caller on any surface can write —
 * and a corroboration test whose corroborating result was forged into place is
 * testing a state the tree cannot reach. This is the CLI's own write path.
 */
function recordOutcome(title: string, line: string): void {
  vault.appendUnderSection(title, RESULTS_HEADING, line);
}

describe("ost_rank_source — a promotion must name a result", () => {
  test("refuses a reason naming a node that is not on the tree", async () => {
    await expect(
      rankSource().run({ host: "example.com", rung: "expert", reason: "corroborated by [[No Such Test]]" }),
    ).rejects.toThrow(/"No Such Test" is not on the tree/);
  });

  test("refuses a reason that names no node at all", async () => {
    await expect(rankSource().run({ host: "example.com", rung: "expert", reason: "looks solid" })).rejects.toThrow(
      /has to name the first-party result that earned it, as a \[\[wikilink\]\]/,
    );
  });

  test("refuses a reason naming a real test that recorded no outcome", async () => {
    writeTest("Real Test", "## Method\nrun the funnel for a week\n");
    await expect(
      rankSource().run({ host: "example.com", rung: "expert", reason: "corroborated by [[Real Test]]" }),
    ).rejects.toThrow(/"Real Test" recorded no outcome/);
  });

  test("nothing is written to the trust ledger by a refused promotion", async () => {
    await expect(
      rankSource().run({ host: "example.com", rung: "expert", reason: "looks solid" }),
    ).rejects.toThrow();
    expect(fs.existsSync(hostTrustPath(dir))).toBe(false);
  });

  test("accepts a promotion citing a test that recorded a result", async () => {
    writeTest("Real Test", "## Method\nrun the funnel\n");
    recordOutcome("Real Test", "- supported: lift held at 4%");
    const out = await rankSource().run({ host: "example.com", rung: "expert", reason: "corroborated by [[Real Test]]" });
    expect(out).toContain("expert");
    const rec = JSON.parse(fs.readFileSync(hostTrustPath(dir), "utf8").trim());
    expect(rec.rung).toBe("expert");
  });

  test("one corroborating result is enough — naming a second that has not run is a plan, not a defect", async () => {
    writeTest("Ran", "## Method\nran last sprint\n");
    recordOutcome("Ran", "- supported");
    writeTest("Queued", "## Method\nnext sprint\n");
    const out = await rankSource().run({
      host: "example.com",
      rung: "expert",
      reason: "corroborated by [[Ran]], and [[Queued]] should confirm it",
    });
    expect(out).toContain("expert");
  });

  // The safe direction stays free. A source publishing plausible, wrong content
  // on cadence is the expensive failure (B11); making the agent produce
  // paperwork before it could stop trusting one would be a new wedge.
  test("demotion to the floor needs no citation", async () => {
    const out = await rankSource().run({ host: "example.com", rung: "assertion", reason: "their claim failed to replicate" });
    expect(out).toContain("assertion");
  });

  // Two spellings of "is this a rung" is the drift R4 was spent removing: an
  // invalid rung must still produce rankHost's ceiling refusal, not a
  // complaint about wikilinks.
  test("an invalid rung still refuses with the ceiling, not with corroboration", async () => {
    await expect(rankSource().run({ host: "example.com", rung: "money", reason: "looks solid" })).rejects.toThrow(
      /can hold only "assertion" or "expert"/,
    );
  });
});
