/**
 * B3 — a declared rung is refused when it exceeds what the node's provenance and
 * results support.
 *
 * B8 made the ceiling computable and put it on the READ side: a label that
 * outruns its provenance was reported by `ost_check`, never refused when
 * written. This is the same ceiling asked at the write boundary — the same
 * function, not a second derivation of the rule, which is R4's lesson applied at
 * the moment a second caller appeared.
 *
 * Two scope decisions are pinned here because both are places this could have
 * become a wedge instead of a guard:
 *
 * 1. **Only the two measurement rungs are policed**, matching B8 exactly. The
 *    criterion's second row reads, strictly, as "every rung above the floor needs
 *    a source" — and that reading is unshippable: no allowlisted tool can add a
 *    `source` to an existing node, so it would refuse a write while naming a
 *    remedy the agent cannot perform. Recorded as considered and rejected; the
 *    prerequisite is a source-setting write path, which is its own criterion.
 * 2. **Both write boundaries, or neither.** `ost_create_node` takes a rung AND a
 *    source in one call and is granted on both surfaces, so a refusal on
 *    `ost_set_evidence` alone would have been a fake fix.
 *
 * What it is worth, stated plainly: B1 and B2 closed the two paths by which the
 * agent could manufacture what this ceiling reads (`## Results` and
 * `status: validated`), so unlike B4 and B8 when they landed, this guard is not
 * standing on a forgeable predicate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { RESULTS_HEADING } from "../../src/ost/headings.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

function call(name: string, input: Record<string, unknown>): Promise<string> {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const built = (buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[]).find((t) => t.name === name)!;
  const problems = validateToolInput(built.input_schema, input);
  if (problems.length > 0) return Promise.reject(new Error(problems.join("; ")));
  return built.run(input);
}

function put(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void {
  vault.createNode({ title, layer, body: "prose", tags: [], links: [], evidence: "assertion", ...extra });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ceiling-"));
  vault = new Vault(dir);
  put("Root", "Outcome");
  put("Opp", "Opportunity");
  put("Sol", "Solution");
  vault.linkNodes("Root", "Opp");
  vault.linkNodes("Opp", "Sol");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("B3 — the ceiling is enforced where the label is written", () => {
  // The criterion's first row, verbatim.
  test("ost_set_evidence money on an INBOX-sourced node is refused, and it names the ceiling", async () => {
    put("Noted gap", "Solution", { source: "INBOX:note.md" });
    vault.linkNodes("Opp", "Noted gap");
    // Non-vacuity: nothing about this fixture is already red for another reason,
    // so a refusal below is about the rung and not about a fixture that was
    // never legal — the way an accidentally result-backed fixture would make a
    // refusal test pass for the wrong reason.
    expect(checkInvariants(vault.readTree())).toEqual([]);

    const err = await call("ost_set_evidence", { title: "Noted gap", evidence: "money" }).catch((e: Error) => e.message);
    expect(err).toMatch(/cannot declare 'money'/);
    expect(err).toMatch(/supports 'assertion'/); // the derived ceiling, named
    expect(vault.read("Noted gap").evidence).toBe("assertion"); // and nothing was written
  });

  // The criterion's second row, at the scope this ships: a measurement rung on a
  // node with no source at all is refused, and the ceiling named is the floor.
  test("a node with no source at all is refused to the floor", async () => {
    put("Sourceless", "Solution");
    const err = await call("ost_set_evidence", { title: "Sourceless", evidence: "observed" }).catch((e: Error) => e.message);
    expect(err).toMatch(/cannot declare 'observed'/);
    expect(err).toMatch(/supports 'assertion'/);
  });

  test("the other write boundary is closed too — a node cannot be born over its ceiling", async () => {
    await expect(
      call("ost_create_node", {
        title: "Paid idea",
        layer: "Solution",
        parent: "Opp",
        body: "people will pay",
        source: "INBOX:note.md",
        evidence: "money",
        // Carried so the call reaches the ceiling at all: a Solution with no kill
        // criteria is refused earlier, and this row is about the rung.
        ...KILL_CRITERIA,
      }),
    ).rejects.toThrow(/cannot declare 'money'/);
    expect(vault.has("Paid idea")).toBe(false);
  });

  test("the refusal never tells the agent to go record a result", async () => {
    put("Sourceless", "Solution");
    const err = await call("ost_set_evidence", { title: "Sourceless", evidence: "money" }).catch((e: Error) => e.message);
    // `UnearnedRung.missing` says "record one (a `## Results` section …)", which
    // is right for a human reading ost_check and is, here, addressed to the one
    // actor forbidden to record results — and names the path B1 closed.
    expect(err).not.toMatch(/record one \(a/);
    expect(err).toMatch(/ost-agent result/); // a human does, and the command is named
  });
});

describe("what the ceiling still permits — a guard, not a wall", () => {
  test("provenance that IS a recording licenses observed", async () => {
    put("Watched", "Solution", { source: "TRANSCRIPT:session-1" });
    await expect(call("ost_set_evidence", { title: "Watched", evidence: "observed" })).resolves.toMatch(/set to observed/);
  });

  test("but a source string cannot put a price on a measurement", async () => {
    put("Watched", "Solution", { source: "TRANSCRIPT:session-1" });
    await expect(call("ost_set_evidence", { title: "Watched", evidence: "money" })).rejects.toThrow(/cannot declare 'money'/);
  });

  test("a result one level beneath licenses both — and only a human can write one", async () => {
    put("Tested", "Solution");
    put("Asm", "AssumptionTest", { body: "## Method\nrun it" });
    vault.linkNodes("Tested", "Asm");
    await expect(call("ost_set_evidence", { title: "Tested", evidence: "money" })).rejects.toThrow(/cannot declare 'money'/);

    // The heading travels as `appendUnderSection`'s argument — the position no
    // tool call reaches (B1). This is the human's `ost-agent result` path.
    vault.appendUnderSection("Asm", RESULTS_HEADING, "- 2026-07-30 **supported** (ran by Tanner) — 6 of 20 paid");
    await expect(call("ost_set_evidence", { title: "Tested", evidence: "money" })).resolves.toMatch(/set to money/);
  });

  test("the three non-measurement rungs are not policed — a rule that fired on every hand-authored node is a rule someone turns off", async () => {
    put("Plain", "Solution");
    for (const rung of ["stated", "expert", "assertion"]) {
      await expect(call("ost_set_evidence", { title: "Plain", evidence: rung })).resolves.toMatch(new RegExp(`set to ${rung}`));
    }
  });

  // The way out, executed. A guard the agent cannot clear on its own is R2.
  test("demotion is never gated, so a node can always get out from under a claim", async () => {
    put("Overclaimed", "Solution", { evidence: "money" });
    expect(checkInvariants(vault.readTree()).some((v) => v.rule === "rung-unearned")).toBe(true);
    await expect(call("ost_set_evidence", { title: "Overclaimed", evidence: "assertion", note: "founder theory" })).resolves.toMatch(
      /set to assertion/,
    );
    expect(checkInvariants(vault.readTree()).some((v) => v.rule === "rung-unearned")).toBe(false);
  });

  test("the detector still reports legacy nodes the guard could never have caught", () => {
    // Written by hand, by an import, or before the guard existed. The refusal is
    // prospective; the rule stays a detector for everything already on disk.
    put("Legacy", "Solution", { evidence: "money" });
    expect(checkInvariants(vault.readTree()).some((v) => v.rule === "rung-unearned" && v.node === "Legacy")).toBe(true);
  });
});
