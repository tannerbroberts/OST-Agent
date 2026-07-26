import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runTool } from "../../src/runner/tool.js";
import { buildOstTools } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";

/**
 * A tool call the vault cannot read must be refused, not written.
 *
 * Found by using the product. A pass called `ost_annotate` with `note` instead
 * of the declared `issue`. The tool's own schema says
 * `required: ["title","issue"]` and `additionalProperties: false`, so the call
 * was invalid on its face — and `runTool` handed the object straight to `run`,
 * which read `input.issue` as `undefined` and appended the literal string
 * "undefined" to the node's Issues section. The call reported success.
 *
 * The vault is append-only by design, so the damage is permanent: the note is
 * gone, and the line that replaced it can only ever be annotated, never
 * removed. Fourteen such lines exist across the two live vaults, from several
 * passes, each one an annotation somebody wrote and nobody can read.
 *
 * This is the product's central claim under strain — "incapable of destructive
 * action by construction". No destructive *tool* exists, and that was never the
 * whole surface: an unvalidated argument to a constructive tool destroyed the
 * content it was given. The allowlist answered "which tool may run" and nothing
 * answered "with what".
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-toolvalidation-"));
  fs.writeFileSync(
    path.join(dir, "ost.config.yaml"),
    ['outcome: "Reach ten returning operators."', 'outcomeTitle: "Reach ten returning operators"', ""].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "Reach ten returning operators.md"),
    ["---", "type: Outcome", "evidence: assertion", "---", "#Outcome", "", "The mandate."].join("\n"),
    "utf8",
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const node = (): string => path.join(dir, "Reach ten returning operators.md");

describe("runTool validates input against the tool's own declared schema", () => {
  test("refuses a call missing a required property instead of writing undefined", async () => {
    await expect(runTool(dir, "ost_annotate", { title: "Reach ten returning operators" })).rejects.toThrow(
      /issue/,
    );

    expect(fs.readFileSync(node(), "utf8")).not.toContain("undefined");
  });

  test("refuses the exact call that caused this — a plausible wrong field name", async () => {
    // `note` is what a caller reaches for; `issue` is what the schema says.
    // Before this guard the difference was silent and permanent.
    await expect(
      runTool(dir, "ost_annotate", { title: "Reach ten returning operators", note: "an orphan" }),
    ).rejects.toThrow();

    const body = fs.readFileSync(node(), "utf8");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("## Issues");
  });

  test("names the offending property so the caller can fix it in one read", async () => {
    const err = await runTool(dir, "ost_annotate", {
      title: "Reach ten returning operators",
      note: "an orphan",
    }).catch((e: Error) => e);

    expect(String(err)).toMatch(/note/);
    expect(String(err)).toMatch(/ost_annotate/);
  });

  test("rejects a required property present but of the wrong type", async () => {
    await expect(
      runTool(dir, "ost_annotate", { title: "Reach ten returning operators", issue: 42 }),
    ).rejects.toThrow(/issue/);
  });

  test("a valid call still works, and writes what it was given", async () => {
    const out = await runTool(dir, "ost_annotate", {
      title: "Reach ten returning operators",
      issue: "orphan opportunity: not linked under the outcome",
    });

    expect(out).toContain("Reach ten returning operators");
    const body = fs.readFileSync(node(), "utf8");
    expect(body).toContain("orphan opportunity: not linked under the outcome");
    expect(body).not.toContain("undefined");
  });

  test("an unknown tool is still refused by name", async () => {
    await expect(runTool(dir, "ost_delete_node", { title: "x" })).rejects.toThrow(/unknown tool/);
  });

  test("a read-only tool taking no arguments is unaffected", async () => {
    const out = await runTool(dir, "ost_read_tree", {});

    expect(out).toContain("Reach ten returning operators");
  });
});

/**
 * The guard is only worth what it covers. If a tool ships without a readable
 * schema, `validateToolInput` finds nothing to check and the call sails through
 * exactly as before — and the failure is invisible, because "0 problems" and
 * "nothing to look at" are the same answer.
 */
describe("every allowlisted tool declares a schema this can actually read", () => {
  test("no tool reaches the vault unchecked", () => {
    const tools = buildOstTools({
      vault: new Vault(dir),
      dir,
      remote: { enabled: false },
      surface: "cli-tool",
    }) as unknown as { name: string; input_schema?: { type?: string; properties?: unknown } }[];

    const unchecked = tools
      .filter((t) => {
        const s = t.input_schema;
        return !s || (s.type !== "object" && !s.properties);
      })
      .map((t) => t.name);

    expect(unchecked).toEqual([]);
    expect(tools.length).toBeGreaterThan(5);
  });
});
