import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";

const OUTCOME = "Reach 10,000 daily active users";
const OUTCOME_TITLE = "Retention";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-unknown-"));
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

describe("creating an Unknown", () => {
  test("darkness may attach under any layer it darkens", async () => {
    await call("ost_create_node", {
      title: "Opp", layer: "Opportunity", parent: OUTCOME_TITLE, body: "b", evidence: "assertion",
    });
    await call("ost_create_node", {
      title: "Sol", layer: "Solution", parent: "Opp", body: "b", evidence: "assertion",
    });

    for (const [title, parent] of [
      ["Dark under the outcome", OUTCOME_TITLE],
      ["Dark under the opportunity", "Opp"],
      ["Dark under the solution", "Sol"],
    ]) {
      const out = await call("ost_create_node", {
        title, layer: "Unknown", parent, body: "## Format\nx", evidence: "assertion",
      });
      expect(out).toContain("Unknown");
      expect(buildPassContext(dir).vault.read(title).layer).toBe("Unknown");
    }
  });

  test("an unknown still needs an evidence class like every other node", async () => {
    await expect(
      call("ost_create_node", { title: "Unrunged", layer: "Unknown", parent: OUTCOME_TITLE, body: "## Format\nx" }),
    ).rejects.toThrow(/evidence class/);
  });
});

describe("ost_create_node schema validation", () => {
  test("the tool schema accepts Unknown as a valid layer", () => {
    const tools = buildOstTools(buildPassContext(dir)) as unknown as {
      name: string;
      input_schema?: ToolSchema;
    }[];
    const tool = tools.find((t) => t.name === "ost_create_node");
    if (!tool || !tool.input_schema) throw new Error("ost_create_node tool not found");

    const testInput = {
      title: "Test Unknown",
      layer: "Unknown",
      parent: OUTCOME_TITLE,
      body: "## Format\ntest",
      evidence: "assertion",
    };

    const problems = validateToolInput(tool.input_schema, testInput);
    expect(problems).toEqual([]);
  });
});
