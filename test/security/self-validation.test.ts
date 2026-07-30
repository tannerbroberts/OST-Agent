/**
 * B2 — an agent cannot move a node to `validated`, and `ost_check` catches one
 * that appears.
 *
 * `validated` is not one status among five. It is the value `hasRecordedResult`
 * reads as "a human ran this", so declaring it clears the evidence gate on the
 * strength of the declaration — B1's forgery with no heading required. The
 * `no-self-validation` invariant was supposed to catch it and could not: it
 * fires on the contradiction between the `unvalidated` tag and the status, and
 * `ost_create_node` passed `tags` straight through, so an agent that omitted the
 * tag was permanently exempt from the rule the README sells as the guarantee.
 *
 * Both halves are closed here. The value is inexpressible in both schemas that
 * carried it (`ost_set_status` AND `ost_create_node` — closing only the first
 * would leave "born validated" open and make the criterion's sentence true while
 * its intent was defeated in one call), the marker is stamped server-side and no
 * allowlisted tool can remove it, and the detector still fires on a node that
 * arrives from outside the surface.
 *
 * Calls go through `validateToolInput` first, the clearability harness's shape,
 * so a schema refusal here is a refusal for the reason it would be on the wire.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { hasRecordedResult } from "../../src/eval/evidence-debt.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { AGENT_IDEATED_TAG, type OstNode } from "../../src/ost/node.js";
import { promoteNode } from "../../src/ost/results.js";
import { Vault } from "../../src/ost/vault.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

function tools(): RawTool[] {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  return buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[];
}

function call(name: string, input: Record<string, unknown>): Promise<string> {
  const built = tools().find((t) => t.name === name);
  if (!built) throw new Error(`${name} is not on the MCP surface`);
  const problems = validateToolInput(built.input_schema, input);
  if (problems.length > 0) return Promise.reject(new Error(`refused the call: ${problems.join("; ")}`));
  return built.run(input);
}

function node(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode {
  return { title, layer, body: "prose", tags: [], links: [], evidence: "assertion", ...extra };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-selfval-"));
  vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome"));
  vault.createNode(node("Opp", "Opportunity"));
  vault.linkNodes("Root", "Opp");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("B2 — the agent cannot declare a node validated", () => {
  // The criterion's Check, verbatim — with four assertions the Check itself does
  // not name, because `checkInvariants(tree) === []` passed before this change
  // too. That is the vacuity trap this file exists on the other side of.
  test("ost_create_node with tags: [], then ost_set_status validated, then checkInvariants", async () => {
    await expect(
      call("ost_create_node", { title: "A win", layer: "Solution", parent: "Opp", body: "an idea", evidence: "assertion", tags: [] }),
    ).resolves.toMatch(/created Solution/);

    // The stamp landed despite `tags: []` — the rule's precondition is no longer
    // the caller's to withhold.
    expect(vault.read("A win").tags).toContain(AGENT_IDEATED_TAG);

    const err = await call("ost_set_status", { title: "A win", status: "validated", note: "it went well" }).catch(
      (e: Error) => e.message,
    );
    // Refused on the wire, by the schema, before `run` — the value has no
    // argument position rather than a validator behind one. The message names
    // the four statuses that ARE available, which is the agent's actionable set.
    expect(err).toMatch(/not one of/);
    expect(err).toContain("in-discovery");

    expect(vault.read("A win").status).not.toBe("validated");
    expect(hasRecordedResult(vault.read("A win"))).toBe(false);
    // Nothing bad happened, rather than nothing being checked.
    expect(checkInvariants(vault.readTree()).filter((v) => v.rule === "no-self-validation")).toEqual([]);
  });

  test("the second door: a node cannot be born validated", async () => {
    await expect(
      call("ost_create_node", {
        title: "Born validated",
        layer: "Solution",
        parent: "Opp",
        body: "an idea",
        evidence: "assertion",
        status: "validated",
      }),
    ).rejects.toThrow(/not one of|not a status the agent can set/);
    expect(vault.has("Born validated")).toBe(false);
  });

  // The schema assertion, not just the behavioural one: this fails if someone
  // re-adds the value, rather than only when a call changes what it does.
  test("'validated' is absent from both status enums, and the other four are present", () => {
    for (const name of ["ost_create_node", "ost_set_status"]) {
      const schema = tools().find((t) => t.name === name)!.input_schema as unknown as {
        additionalProperties: boolean;
        properties: { status: { enum: string[] } };
      };
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.status.enum).not.toContain("validated");
      expect(schema.properties.status.enum).toEqual(
        expect.arrayContaining(["unvalidated", "in-discovery", "shipped", "deferred"]),
      );
    }
  });

  /**
   * The way out has three readers and it has to reach each of them where they
   * look. The schema refusal (above) names what the AGENT can do next; the tool
   * description names the human path in the text the model is handed every
   * session; and `run`'s own guard names it for any in-process caller that
   * reaches the write without the validator in front. A guard whose message
   * named no path at all is the R2 shape this repo keeps re-learning.
   */
  test("the human path is named in the description the model reads", () => {
    const setStatus = tools().find((t) => t.name === "ost_set_status")! as unknown as { description: string };
    expect(setStatus.description).toMatch(/ost-agent promote/);
    expect(setStatus.description).toMatch(/not a status you can set|NOT a status you can set/);
  });

  test("run refuses it too, for the caller that never met the schema", async () => {
    const setStatus = tools().find((t) => t.name === "ost_set_status")!;
    await expect(setStatus.run({ title: "Opp", status: "validated", note: "n" })).rejects.toThrow(/ost-agent promote/);
  });

  test("the stamp is unremovable from the agent's surface", async () => {
    await call("ost_create_node", { title: "Marked", layer: "Solution", parent: "Opp", body: "an idea", evidence: "assertion" });
    await call("ost_append_to_node", { title: "Marked", section: "## Notes\nmore" });
    await call("ost_annotate", { title: "Marked", issue: "possible duplicate" });
    await call("ost_set_evidence", { title: "Marked", evidence: "assertion", note: "still founder theory" });
    await call("ost_set_status", { title: "Marked", status: "in-discovery", note: "a test is running" });
    await call("ost_link_nodes", { parent: "Opp", child: "Marked" });
    expect(vault.read("Marked").tags).toContain(AGENT_IDEATED_TAG);
  });

  test("no tool on any surface is named for promotion — the human path is off the allowlist", () => {
    for (const name of [...ALLOWED_TOOL_NAMES, ...MCP_TOOL_NAMES]) {
      expect(name).not.toMatch(/promote|validate/i);
    }
  });
});

describe("B2's second half — ost_check catches one that appears", () => {
  /** A human in Obsidian, an import, or a vault written before this guard. */
  function plantSelfValidated(): void {
    vault.createNode(node("A planted win", "Solution", { tags: [AGENT_IDEATED_TAG], status: "validated" }));
    vault.linkNodes("Opp", "A planted win");
  }

  test("checkInvariants names it, and it turns done false rather than only reddening check", () => {
    plantSelfValidated();
    const violations = checkInvariants(vault.readTree());
    expect(violations.some((v) => v.rule === "no-self-validation" && v.node === "A planted win")).toBe(true);
    expect(computeNextWork(vault, dir, 0).done).toBe(false);
  });

  // THE WAY OUT, executed. Without this the refusal above is an R2 wedge: a
  // human who cannot promote has only a text editor.
  test("ost-agent promote clears it — the marker comes off and the status stays", () => {
    plantSelfValidated();
    const line = promoteNode(dir, { node: "A planted win", by: "Tanner", why: "the pilot converted 6 of 20" });

    const promoted = vault.read("A planted win");
    expect(promoted.tags).not.toContain(AGENT_IDEATED_TAG);
    expect(promoted.status).toBe("validated");
    expect(line).toMatch(/promoted by Tanner/);
    expect(promoted.body).toContain("the pilot converted 6 of 20");
    expect(checkInvariants(vault.readTree()).filter((v) => v.rule === "no-self-validation")).toEqual([]);
  });

  test("promotion is idempotent, and leaves every other tag alone", () => {
    vault.createNode(node("Twice", "Solution", { tags: [AGENT_IDEATED_TAG, "billing"], status: "validated" }));
    promoteNode(dir, { node: "Twice", by: "T", why: "first" });
    promoteNode(dir, { node: "Twice", by: "T", why: "again" });
    const n = vault.read("Twice");
    expect(n.tags).toContain("billing");
    expect(n.tags).not.toContain(AGENT_IDEATED_TAG);
    expect(n.status).toBe("validated");
  });

  test("an unattributed or unexplained promotion is refused — results.ts's own rule", () => {
    plantSelfValidated();
    expect(() => promoteNode(dir, { node: "A planted win", by: "  ", why: "because" })).toThrow(/attribution/);
    expect(() => promoteNode(dir, { node: "A planted win", by: "T", why: "" })).toThrow(/reason/);
  });

  // The rule has never had a negative control, and a detector that fires on
  // everything proves nothing about the case it was written for.
  test("the marker alone is not a violation — only the contradiction is", () => {
    vault.createNode(node("Still running", "Solution", { tags: [AGENT_IDEATED_TAG], status: "in-discovery" }));
    vault.linkNodes("Opp", "Still running");
    expect(checkInvariants(vault.readTree()).filter((v) => v.rule === "no-self-validation")).toEqual([]);
  });
});
