/**
 * The Format contract is load-bearing, not advisory.
 *
 * `ost_create_node`'s description told a caller to write `## Format`,
 * `## Methodology` and `## Rationale` on every Unknown, but nothing enforced
 * it: an Unknown with no Format section — or a bare `## Format` heading with
 * nothing under it — was accepted exactly like a fully-specified one. That
 * makes the discriminator the module's own docs claim ("an unknown that
 * cannot say what an answer looks like is not an unknown") unreachable from
 * the only door an agent has into creating one.
 *
 * These tests hold both halves of the fix: the tool boundary refuses a
 * Format-less Unknown, and — for one that predates the refusal or was
 * written straight to disk — `ost_next_work` still names the gap rather than
 * counting the node as contract-complete.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools } from "../../src/security/tools.js";
import { computeNextWork } from "../../src/mcp/next-work.js";

const OUTCOME = "Reach 10,000 daily active users";
const OUTCOME_TITLE = "Retention";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-unknown-format-"));
  await initVault(dir, OUTCOME, OUTCOME_TITLE);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function call(name: string, input: unknown): Promise<string> {
  const tools = buildOstTools(buildPassContext(dir)) as unknown as {
    name: string;
    run: (i: unknown) => Promise<string>;
  }[];
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool.run(input);
}

describe("ost_create_node refuses a Format-less Unknown", () => {
  test("no ## Format section at all is refused", async () => {
    await expect(
      call("ost_create_node", {
        title: "How many users hit the export path",
        layer: "Unknown",
        parent: OUTCOME_TITLE,
        body: "## Methodology\nquery the log\n\n## Rationale\nserves [[Retention]]",
        evidence: "assertion",
      }),
    ).rejects.toThrow(/Format/);

    expect(buildPassContext(dir).vault.has("How many users hit the export path")).toBe(false);
  });

  test("a bare ## Format heading with nothing under it is refused too", async () => {
    await expect(
      call("ost_create_node", {
        title: "How many users hit the export path",
        layer: "Unknown",
        parent: OUTCOME_TITLE,
        body: "## Format\n\n## Methodology\nquery the log",
        evidence: "assertion",
      }),
    ).rejects.toThrow(/non-empty/);
  });

  test("NON-VACUITY: the same call with real content under Format succeeds", async () => {
    const out = await call("ost_create_node", {
      title: "How many users hit the export path",
      layer: "Unknown",
      parent: OUTCOME_TITLE,
      body: "## Format\na count per day\n\n## Methodology\nquery the log",
      evidence: "assertion",
    });
    expect(out).toContain("Unknown");
    expect(buildPassContext(dir).vault.read("How many users hit the export path").layer).toBe("Unknown");
  });

  test("the refusal is scoped to Unknown — a Solution with no Format section is untouched", async () => {
    await call("ost_create_node", {
      title: "Some opportunity",
      layer: "Opportunity",
      parent: OUTCOME_TITLE,
      body: "b",
      evidence: "assertion",
    });
    await expect(
      call("ost_create_node", {
        title: "Some solution",
        layer: "Solution",
        parent: "Some opportunity",
        body: "no Format section here",
        evidence: "assertion",
      }),
    ).resolves.toContain("Solution");
  });
});

describe("ost_next_work still names the gap on a Format-less Unknown already on disk", () => {
  test("an Unknown written straight to the vault without Format reports it in gaps", () => {
    // Bypasses the tool boundary the way a pre-existing node or an Obsidian
    // edit would — the case the refusal above cannot reach after the fact.
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "How many users hit the export path",
      layer: "Unknown",
      body: "## Methodology\nquery the log\n\n## Rationale\nserves [[Retention]]",
      tags: [],
      links: [],
      evidence: "assertion",
    });
    ctx.vault.linkNodes(OUTCOME_TITLE, "How many users hit the export path");

    const work = computeNextWork(buildPassContext(dir).vault, dir, 1);
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].klass).toBe("unbounded");
    expect(work.openUnknowns[0].gaps).toContain("Format");
  });
});
