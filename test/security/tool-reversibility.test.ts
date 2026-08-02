/**
 * P1 — every action carries a declared reversibility class, from a closed
 * fail-closed vocabulary with a cautious default.
 *
 * `reversibility.test.ts` pins the vocabulary itself (the pure `reversibilityOf`
 * fold). This file pins the half that makes it an action property rather than a
 * fact sitting in a file nothing reads: every tool `buildOstTools` actually
 * constructs carries a resolved class, and a tool that forgets to declare one
 * reads as the least forgiving class rather than as unclassified.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { isReversibility } from "../../src/knowledge/reversibility.js";
import { Vault } from "../../src/ost/vault.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { tool } from "../../src/security/tool.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

function makeContext(): ToolContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-p1-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  return { vault: new Vault(dir), dir, remote: { enabled: false } };
}

describe("every built tool carries a resolved reversibility class", () => {
  const tools = buildOstTools(makeContext()) as unknown as Array<{ name: string; reversibility: string }>;

  test("the driver built the whole allowlist, not a filtered subset", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([...ALLOWED_TOOL_NAMES].sort());
  });

  test("every tool's reversibility is a real member of the vocabulary", () => {
    for (const t of tools) {
      expect(isReversibility(t.reversibility), `${t.name} carries an unrecognised class: ${t.reversibility}`).toBe(
        true,
      );
    }
  });

  test("git_push is the one tool that is not cheaply reversible — it leaves the vault", () => {
    const push = tools.find((t) => t.name === "git_push");
    expect(push?.reversibility).toBe("costly");
    for (const t of tools) {
      if (t.name === "git_push") continue;
      expect(t.reversibility, `${t.name} should be as cheap to undo as an append — check it wasn't reclassified`).toBe(
        "reversible",
      );
    }
  });
});

describe("the tool() helper fails closed on reversibility, same as reversibilityOf itself", () => {
  test("a spec that omits reversibility resolves to the cautious class, not to undefined", () => {
    const undeclared = tool({
      name: "test_undeclared",
      description: "a tool that forgot to say how expensive it is to undo",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => "ok",
    });
    expect(undeclared.reversibility).toBe("irreversible");
  });

  test("a spec that invents a class also resolves to the cautious class", () => {
    const invented = tool({
      name: "test_invented",
      description: "a tool that names a class this repo has never defined",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => "ok",
      reversibility: "mostly-fine-probably",
    });
    expect(invented.reversibility).toBe("irreversible");
  });

  test("a spec that declares a real class keeps it", () => {
    const declared = tool({
      name: "test_declared",
      description: "a tool that said so",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => "ok",
      reversibility: "reversible",
    });
    expect(declared.reversibility).toBe("reversible");
  });
});
