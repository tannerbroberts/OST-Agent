import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { runTool } from "../../src/runner/tool.js";
import { buildPassContext } from "../../src/runner/context.js";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tool-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runTool — the agent-driving surface", () => {
  test("creating a node attaches it under its parent in one step (no floaters)", async () => {
    await runTool(dir, "ost_create_node", {
      title: "I want a reason to come back every day",
      layer: "Opportunity",
      parent: "Retention",
      source: "INBOX:x",
      body: "Players want a daily reason to return.",
    });
    const tree = buildPassContext(dir).vault.readTree();
    expect(tree.find((n) => n.layer === "Opportunity")?.title).toBe("I want a reason to come back every day");
    // the outcome already links the new opportunity — attachment was atomic
    expect(tree.find((n) => n.layer === "Outcome")?.links).toContain("I want a reason to come back every day");
  });

  test("the hierarchy is enforced and the Outcome cannot be created", async () => {
    // a Solution cannot attach directly under the Outcome
    await expect(
      runTool(dir, "ost_create_node", { title: "S", layer: "Solution", parent: "Retention", body: "b" }),
    ).rejects.toThrow(/must attach under Opportunity/);
    // a missing parent is refused
    await expect(
      runTool(dir, "ost_create_node", { title: "O", layer: "Opportunity", parent: "nope", body: "b" }),
    ).rejects.toThrow(/does not exist/);
    // Outcome is not a creatable layer (schema enum excludes it; run also guards)
    await expect(
      runTool(dir, "ost_create_node", { title: "O2", layer: "Outcome", parent: "x", body: "b" }),
    ).rejects.toThrow();
  });

  test("ost_read_tree returns the current tree as JSON", async () => {
    const out = await runTool(dir, "ost_read_tree", {});
    expect(JSON.parse(out).count).toBeGreaterThanOrEqual(1);
  });

  test("an unknown or destructive tool name is refused", async () => {
    await expect(runTool(dir, "ost_delete_node", {})).rejects.toThrow(/unknown tool/);
    await expect(runTool(dir, "bash", {})).rejects.toThrow(/unknown tool/);
  });
});
