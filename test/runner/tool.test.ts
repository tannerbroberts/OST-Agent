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
  await initVault(dir, "Reach 10,000 daily active users");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runTool — the agent-driving surface", () => {
  test("an agent can create and link nodes through the tool surface", async () => {
    await runTool(dir, "ost_create_node", {
      title: "I want a reason to come back every day",
      layer: "Opportunity",
      source: "INBOX:x",
      body: "Players want a daily reason to return.",
    });
    await runTool(dir, "ost_link_nodes", {
      parent: "Reach 10,000 daily active users",
      child: "I want a reason to come back every day",
    });
    const tree = buildPassContext(dir).vault.readTree();
    expect(tree.find((n) => n.layer === "Opportunity")?.title).toBe("I want a reason to come back every day");
    expect(tree.find((n) => n.layer === "Outcome")?.links).toContain("I want a reason to come back every day");
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
