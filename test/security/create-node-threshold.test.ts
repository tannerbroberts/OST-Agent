/**
 * `ost_create_node`'s `threshold` field — the AssumptionTest pre-commitment as
 * frontmatter instead of a bold lead-in scraped from the body.
 *
 * Scoped exactly as the proposing node's own Approach section: additive, and
 * backward-compatible by construction. `askedOf` (`src/eval/coverage.ts`)
 * prefers the field and falls back to the prose scan when it is absent, so
 * every AssumptionTest written before this field existed reads exactly as it
 * did before — this file pins the write boundary; `test/eval/unfixed-thresholds.test.ts`
 * pins the read side.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { askedOf, thresholdKindOf } from "../../src/eval/coverage.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";

let dir: string;
let vault: Vault;
let ctx: ToolContext;

function put(title: string, layer: OstNode["layer"]): void {
  vault.createNode({ title, layer, tags: [], links: [], evidence: "assertion", body: `prose for ${title}` } as OstNode);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-threshold-field-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:threshold-field" };
  put(OUTCOME, "Outcome");
  put(OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(SOLUTION, "Solution");
  vault.linkNodes(OPPORTUNITY, SOLUTION);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const create = (input: Record<string, unknown>): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

const GOOD_ASSUMPTION_TEST = {
  title: "At least 5 of 20 book a kickoff",
  layer: "AssumptionTest",
  parent: SOLUTION,
  body: "run the pilot with 20 invitees",
  evidence: "assertion",
} as const;

describe("ost_create_node — threshold field", () => {
  test("an AssumptionTest may carry a threshold, and the reader picks it up", async () => {
    await create({ ...GOOD_ASSUMPTION_TEST, threshold: "at least 5 of 20 book a kickoff." });

    const written = new Vault(dir).read(GOOD_ASSUMPTION_TEST.title);
    expect(written.threshold).toBe("at least 5 of 20 book a kickoff.");
    expect(askedOf(written)).toBe("at least 5 of 20 book a kickoff.");
    expect(thresholdKindOf(written)).toBe("bound");
  });

  test("an AssumptionTest created without a threshold gets none, and reads as before (absent, here)", async () => {
    await create({ ...GOOD_ASSUMPTION_TEST });

    const written = new Vault(dir).read(GOOD_ASSUMPTION_TEST.title);
    expect(written.threshold).toBeUndefined();
    expect(thresholdKindOf(written)).toBe("absent");
  });

  test("refused for a Solution — the field only means something on an AssumptionTest", async () => {
    const before = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());

    await expect(
      create({
        title: "A fresh idea",
        layer: "Solution",
        parent: OPPORTUNITY,
        body: "an idea",
        evidence: "assertion",
        threshold: "at least 5 of 20.",
      }),
    ).rejects.toThrow(/threshold is only meaningful for an AssumptionTest/);

    // Refused before anything is written, matching every other create-node guard.
    expect(fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())).toEqual(before);
  });

  test("refused for an Opportunity and an Unknown too, not only a Solution", async () => {
    await expect(
      create({ title: "An opportunity", layer: "Opportunity", parent: OUTCOME, body: "a gap", evidence: "assertion", threshold: "x" }),
    ).rejects.toThrow(/threshold is only meaningful for an AssumptionTest/);

    await expect(
      create({
        title: "An unknown",
        layer: "Unknown",
        parent: SOLUTION,
        body: "## Format\nx\n\n## Methodology\ny\n\n## Rationale\nz",
        evidence: "assertion",
        threshold: "x",
      }),
    ).rejects.toThrow(/threshold is only meaningful for an AssumptionTest/);
  });
});
