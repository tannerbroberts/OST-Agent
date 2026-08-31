/**
 * "Check the guard refuses an unaccounted-for section drop and permits an
 * acknowledged one" — the assumption test beneath "A guard can catch the
 * unacknowledged drop without refusing honest rewriting", and the build permit
 * this file discharges.
 *
 * Its threshold, verbatim: *"Both directions must hold. Refuses when a stored
 * section appears in neither `prose` nor `dropping:`, and the refusal message
 * names the section by heading. Permits when the section appears in either. A
 * guard that satisfies only one direction fails."*
 *
 * ## One deliberate departure from the test node's fixture, stated up front
 *
 * The node body illustrates both directions with `## History`: omit it and be
 * refused, name it in `dropping` and have it removed. That fixture is no longer
 * available and its second half is no longer something this repository should
 * do. `## History` joined `RESERVED_HEADINGS` (`src/ost/headings.ts`) after the
 * test node was written — that was the sibling solution's answer to the same
 * 2026-08-05 observation — so History is now held aside and reattached verbatim
 * by every rewrite. It cannot be dropped by anybody, and a `dropping:
 * ["## History"]` that SUCCEEDED would mean an agent had acquired the power to
 * delete a reserved section, which is a stronger claim than this solution was
 * ever cleared for and one several other specs exist to prevent.
 *
 * So the two directions are driven on an ordinary section instead —
 * `## Provenance`, which the live vault puts on most of its nodes and which
 * nothing reserves — and the History case is pinned separately, in the shape it
 * actually holds now: the omission is harmless because the section survives, and
 * the drop is REFUSED. That is the same guard measured on the case that is still
 * live, plus the reason the node's own example went stale.
 *
 * ## What a green run here does not buy
 *
 * The false-positive rate on real rewrites, which is what the assumption above
 * actually turns on. This file constructs its cases. A consolidation, a retitle
 * or a fold-into-prose is a legitimate rewrite that now costs a refusal and a
 * retry, and the last test below asserts that cost EXISTS rather than pretending
 * it away — measuring how often it is paid means replaying this vault's recorded
 * edits with someone judging which were legitimate, and that is a different test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { RESERVED_HEADINGS } from "../../src/ost/headings.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordResult } from "../../src/ost/results.js";
import { Vault } from "../../src/ost/vault.js";
import { CALL_PRECONDITIONS, checkCall, publishCallPreconditions } from "../../src/security/call-preconditions.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

/** Drive the LIVE tool, schema check included — the surface a caller actually meets. */
function call(tool: string, input: Record<string, unknown>): Promise<string> {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const built = (buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[]).find((t) => t.name === tool);
  if (!built) throw new Error(`${tool} is not on the MCP surface`);
  const problems = validateToolInput(built.input_schema, input);
  if (problems.length > 0) throw new Error(`refused the call: ${problems.join("; ")}`);
  return built.run(input);
}

const PROVENANCE = ["## Provenance", "", "Recorded by a human on 2026-08-05, from an interview they ran themselves."].join("\n");

/** The fixture: a Solution carrying one ordinary `## Provenance` section, exactly as the live vault's nodes do. */
const STORED_BODY = ["An idea worth trying, stated as its author left it.", "", PROVENANCE].join("\n");

/** The rewrite a caller composes from the title alone — it accounts for nothing it never read. */
const BLIND_REWRITE = "A sharper statement of the same idea.";

function node(title: string, layer: OstNode["layer"], body: string): OstNode {
  return { title, layer, body, tags: [], links: [], evidence: "assertion" };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-section-guard-"));
  vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "the mandate"));
  vault.createNode(node("Opp", "Opportunity", "a gap"));
  vault.createNode(node("Sol", "Solution", STORED_BODY));
  vault.linkNodes("Root", "Opp");
  vault.linkNodes("Opp", "Sol");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the refuse direction — a stored section in neither `prose` nor `dropping`", () => {
  test("is refused, and the refusal names the section by heading", async () => {
    await expect(call("ost_edit_node", { title: "Sol", prose: BLIND_REWRITE, why: "sharper framing" })).rejects.toThrow(
      /## Provenance/,
    );
  });

  test("leaves the node exactly as it was — the refusal arrives before the damage", async () => {
    const before = vault.read("Sol").body;
    await expect(call("ost_edit_node", { title: "Sol", prose: BLIND_REWRITE, why: "sharper framing" })).rejects.toThrow();

    const after = vault.read("Sol").body;
    expect(after).toBe(before);
    expect(after).toContain("Recorded by a human on 2026-08-05");
    // Not merely "unchanged": the old prose is still the prose, so nothing about
    // the attempted rewrite reached the file.
    expect(after).not.toContain(BLIND_REWRITE);
  });

  test("tells the caller both ways out, and where to read what it compared against", async () => {
    const refusal = await call("ost_edit_node", { title: "Sol", prose: BLIND_REWRITE, why: "x" }).catch(
      (e: Error) => e.message,
    );
    expect(refusal).toContain("`prose`");
    expect(refusal).toContain("`dropping`");
    expect(refusal).toContain('ost_read_tree({ node: "Sol" })');
    expect(refusal).toContain("Nothing was written");
  });

  test("names it in full, so what the refusal prints can be pasted straight into `dropping`", async () => {
    // The refusal's whole product is a name the caller can act on, and `dropping`
    // matches the whole name — so a clipped heading would be a refusal that tells
    // you how to proceed in a form that does not work. Driven with a heading well
    // past the length any display cap on this codebase's other echo paths uses.
    const long = `## Provenance, and every reason this section is here rather than in the evidence record beside it`;
    vault.createNode(node("Long", "Solution", ["An idea.", "", long, "", "the reasons."].join("\n")));

    const refusal = await call("ost_edit_node", { title: "Long", prose: BLIND_REWRITE, why: "x" }).catch(
      (e: Error) => e.message,
    );
    expect(refusal).toContain(long);

    await expect(
      call("ost_edit_node", { title: "Long", prose: BLIND_REWRITE, why: "x", dropping: [long] }),
    ).resolves.toContain("edited the body");
  });

  test("names EVERY unaccounted section at once, not the first of them", async () => {
    vault.createNode(
      node("Many", "Solution", ["An idea.", "", PROVENANCE, "", "## Definition of done", "", "some command"].join("\n")),
    );
    const refusal = await call("ost_edit_node", { title: "Many", prose: BLIND_REWRITE, why: "x" }).catch(
      (e: Error) => e.message,
    );
    expect(refusal).toContain("## Provenance");
    expect(refusal).toContain("## Definition of done");
  });
});

describe("the permit direction — a section the caller accounted for", () => {
  test("`dropping` removes it, and the removal is recorded in the node's History", async () => {
    const result = await call("ost_edit_node", {
      title: "Sol",
      prose: BLIND_REWRITE,
      why: "the provenance moved to the evidence record",
      dropping: ["## Provenance"],
    });

    expect(result).toContain("edited the body");
    const after = vault.read("Sol").body;
    expect(after).toContain(BLIND_REWRITE);
    expect(after).not.toContain("Recorded by a human on 2026-08-05");
    // Every removal writes the line that explains it — the vault's own rule, and
    // the only thing that makes a deliberate drop auditable from the node itself.
    expect(after).toMatch(/body edited, dropping `## Provenance`/);
  });

  test("reproducing the heading in `prose` keeps it, with no `dropping` at all", async () => {
    await call("ost_edit_node", {
      title: "Sol",
      prose: [BLIND_REWRITE, "", "## Provenance", "", "Same source, restated."].join("\n"),
      why: "sharper framing, provenance carried across",
    });

    const after = vault.read("Sol").body;
    expect(after).toContain("## Provenance");
    expect(after).toContain("Same source, restated.");
    expect(after).not.toMatch(/dropping/);
  });

  test("a node with no sections at all is edited exactly as before — the guard is silent", async () => {
    vault.createNode(node("Plain", "Solution", "Just prose, no headings."));
    await expect(call("ost_edit_node", { title: "Plain", prose: "Different prose.", why: "sharper" })).resolves.toContain(
      "edited the body",
    );
  });

  test("naming a section in BOTH keeps it, and History does not claim a removal that did not happen", async () => {
    await call("ost_edit_node", {
      title: "Sol",
      prose: [BLIND_REWRITE, "", "## Provenance", "", "Same source, restated."].join("\n"),
      why: "belt and braces",
      dropping: ["## Provenance"],
    });

    const after = vault.read("Sol").body;
    expect(after).toContain("Same source, restated.");
    expect(after).not.toMatch(/dropping `## Provenance`/);
  });
});

describe("the section the test node's own fixture used — `## History`, now reserved", () => {
  // The node body proposed `dropping: ["## History"]` as the permit case. Between
  // that being written and this being built, `## History` joined the reserved set,
  // so both halves have moved: the omission no longer loses anything, and the drop
  // is refused rather than honoured. Pinned here so the divergence from the spec's
  // illustration is a recorded decision rather than a silent one.
  test("History is reserved, so an omission cannot lose it and does not need accounting", async () => {
    vault.setStatus("Sol", "in-discovery", "kicking off");
    await call("ost_edit_node", {
      title: "Sol",
      prose: BLIND_REWRITE,
      why: "no mention of history anywhere",
      dropping: ["## Provenance"],
    });

    const after = vault.read("Sol").body;
    expect(after).toContain("## History");
    expect(after).toContain("status: (none) → in-discovery");
  });

  test("`dropping: [\"## History\"]` is REFUSED — no tool may remove a reserved section", async () => {
    const refusal = await call("ost_edit_node", {
      title: "Sol",
      prose: BLIND_REWRITE,
      why: "trying to take the history with it",
      dropping: ["## Provenance", "## History"],
    }).catch((e: Error) => e.message);

    expect(refusal).toMatch(/reserved/i);
    expect(refusal).toContain("## History");
    expect(vault.read("Sol").body).toContain("Recorded by a human on 2026-08-05");
  });

  test("every reserved heading is refused in `dropping`, not just the one this node carries", async () => {
    for (const heading of RESERVED_HEADINGS) {
      const refusal = await call("ost_edit_node", {
        title: "Sol",
        prose: BLIND_REWRITE,
        why: "probing the reserved set",
        dropping: ["## Provenance", heading],
      }).catch((e: Error) => e.message);
      expect(refusal, `dropping ${heading}`).toMatch(/reserved/i);
    }
  });

  test("a reserved section the node HOLDS is not accountable — an edit that ignores it still lands", async () => {
    // Written through the human's CLI path, because that is the only path that
    // can author one — which is itself the reason these are exempt here.
    vault.createNode(node("Measured", "AssumptionTest", "What the run would settle."));
    recordResult(dir, {
      test: "Measured",
      verdict: "supported",
      note: "ran it on the pilot cohort",
      by: "Tanner",
      uncovered: "nothing outside the pilot cohort",
      on: "2026-08-05",
    });

    await expect(
      call("ost_edit_node", { title: "Measured", prose: "A sharper statement of the test.", why: "rewrite" }),
    ).resolves.toContain("edited the body");

    const after = vault.read("Measured").body;
    expect(after).toContain("ran it on the pilot cohort");
    expect(after).toContain("nothing outside the pilot cohort");
  });
});

describe("the published precondition says what the tool does", () => {
  // The anti-drift control `refusal-precondition-coverage.test.ts` applies to
  // every other published rule: a precondition that answers differently from the
  // tool is a confidently-wrong contract, and it must fail here rather than in a
  // caller's pass.
  test("`sections-accounted-for` is published for ost_edit_node", () => {
    const published = CALL_PRECONDITIONS.find((p) => p.id === "sections-accounted-for");
    expect(published?.tools).toContain("ost_edit_node");
  });

  test("it refuses the same call the tool refuses, and passes the same call the tool passes", async () => {
    const published = publishCallPreconditions({ vault, dir });
    const blind = { title: "Sol", prose: BLIND_REWRITE, why: "sharper framing" };
    const accounted = { ...blind, dropping: ["## Provenance"] };

    expect(checkCall(published, "ost_edit_node", blind).map((v) => v.id)).toContain("sections-accounted-for");
    expect(checkCall(published, "ost_edit_node", accounted).map((v) => v.id)).not.toContain("sections-accounted-for");

    // And the tool agrees, in that order.
    await expect(call("ost_edit_node", { title: "Sol", prose: BLIND_REWRITE, why: "sharper framing" })).rejects.toThrow();
    await expect(
      call("ost_edit_node", { title: "Sol", prose: BLIND_REWRITE, why: "sharper framing", dropping: ["## Provenance"] }),
    ).resolves.toContain("edited the body");
  });
});

describe("the cost this guard charges, asserted rather than assumed away", () => {
  // The assumption node states the risk plainly: a guard that fires on
  // consolidation, retitling and folding-into-prose is noise, and a refusal that
  // mostly fires on honest work is one callers learn to route around. All three
  // are legitimate rewrites. All three are refused here. That is the price of the
  // guard, and a reader of this file should meet it as a fact rather than
  // discover it in a pass.
  test("a retitle is refused — `## Provenance and sources` does not account for `## Provenance`", async () => {
    await expect(
      call("ost_edit_node", {
        title: "Sol",
        prose: [BLIND_REWRITE, "", "## Provenance and sources", "", "Same content, better name."].join("\n"),
        why: "retitling the section",
      }),
    ).rejects.toThrow(/## Provenance/);
  });

  test("folding a section's content into running prose is refused, and `dropping` is the way through", async () => {
    const folded = `${BLIND_REWRITE} Recorded by a human on 2026-08-05, from an interview they ran themselves.`;
    await expect(call("ost_edit_node", { title: "Sol", prose: folded, why: "folding it in" })).rejects.toThrow(
      /## Provenance/,
    );
    await expect(
      call("ost_edit_node", { title: "Sol", prose: folded, why: "folding it in", dropping: ["## Provenance"] }),
    ).resolves.toContain("edited the body");
  });
});
