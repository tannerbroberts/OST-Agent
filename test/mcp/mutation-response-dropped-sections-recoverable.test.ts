/**
 * "Check every dropped section is reported with enough to restore it" — the
 * assumption test beneath "Being told a section was dropped is worth little to a
 * caller with no undo", and the build permit this file discharges.
 *
 * Its threshold, verbatim: *"Every entry in the response's `dropped` list carries
 * either the section's full prior text or a git ref at which it can be read. A
 * `dropped` entry with neither fails the test, and so does a mutating response
 * with no `dropped` key at all — absent must be distinguishable from none."*
 *
 * ## What is driven, and why it is the tool rather than the module
 *
 * The claim is about **the response a caller meets**, so every assertion below
 * runs the live tool through `buildOstTools` with its own schema check in front,
 * exactly as `edit-node-unacknowledged-section-guard.test.ts` drives the sibling
 * guard. A test that asserted on `censusOfWrite`'s return value would be measuring
 * a data structure nobody reads; the loss this branch exists to fix happened to a
 * caller reading a string.
 *
 * ## The `dropping` argument is not a way around the spec
 *
 * The sibling solution shipped first, so a rewrite can no longer silently drop a
 * section at all — an unaccounted one is refused by name before anything is
 * written. That does NOT make this test vacuous, and it is worth saying why,
 * because the two are easy to confuse:
 *
 *   - the guard stops the drops it can enumerate. This reports the drops nobody
 *     enumerated, because the census is computed from the node's body before the
 *     write against its body after, and never from the caller's arguments;
 *   - a DELIBERATE drop is still a drop. `dropping: ["## Provenance"]` succeeds by
 *     design, and the section is just as gone as if it had been an accident. The
 *     caller who meant to remove one paragraph of it and typed the heading is the
 *     ordinary case, and until now their only undo was `git log`.
 *
 * So the drops here are driven through `dropping`, which is the only door the
 * repository still leaves open — and the last describe block below drives one that
 * comes through no argument at all, to check the report is a census of the file
 * rather than an echo of the input.
 *
 * ## What a green run does not settle
 *
 * That a caller WOULD restore. The assumption this hangs beneath argues that a
 * report may convert a silent loss into a documented one without changing the loss
 * rate — that a team seeing a tool name its own damage concludes the damage is
 * handled. Nothing here measures that, no exit code can, and the solution node says
 * plainly that this should ship alongside a preventive sibling rather than instead
 * of one.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { MAX_INLINE_DROPPED_TEXT } from "../../src/ost/write-report.js";
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

const PROVENANCE_TEXT = "Recorded by a human on 2026-08-05, from an interview they ran themselves.";
const PROVENANCE = ["## Provenance", "", PROVENANCE_TEXT].join("\n");
const DONE_TEXT = "npx vitest run test/mcp/a-thing.test.ts";
const DONE = ["## Definition of done", "", DONE_TEXT].join("\n");

const STORED_BODY = ["An idea worth trying, stated as its author left it.", "", PROVENANCE, "", DONE].join("\n");
const REWRITE = "A sharper statement of the same idea.";

function node(title: string, layer: OstNode["layer"], body: string): OstNode {
  return { title, layer, body, tags: [], links: [], evidence: "assertion" };
}

/**
 * The `dropped` bucket as the response spells it, or undefined if the response
 * does not carry the key at all.
 *
 * The distinction the threshold's second half turns on: `undefined` means the
 * response said nothing about dropping, `[]` means it said nothing was dropped,
 * and those must not be the same value. Parsing the summary line rather than
 * asking the module is deliberate — the string is what a caller reads.
 */
function droppedIn(response: string): string[] | undefined {
  const line = response.split("\n").find((l) => l.startsWith("Sections after this write —"));
  if (!line) return undefined;
  const bucket = /dropped:\s*(.*)$/.exec(line)?.[1]?.trim();
  if (bucket === undefined) return undefined;
  if (bucket === "none") return [];
  return bucket.split(/,\s*/).map((h) => h.replace(/^`|`$/g, ""));
}

/** Every `git show <sha>:<path>` the response offers. */
function refsIn(response: string): string[] {
  return [...response.matchAll(/git show ([0-9a-f]{7,64}:[^`\s]+)/g)].map((m) => m[1]);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-write-report-"));
  vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "the mandate"));
  vault.createNode(node("Opp", "Opportunity", "a gap"));
  vault.createNode(node("Sol", "Solution", STORED_BODY));
  vault.linkNodes("Root", "Opp");
  vault.linkNodes("Opp", "Sol");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a rewrite that drops a stored section", () => {
  test("names the dropped section in the response, and the success string alone no longer answers", async () => {
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", DONE].join("\n"),
      why: "the provenance moved to the evidence record",
      dropping: ["## Provenance"],
    });

    expect(response).toContain("edited the body");
    expect(droppedIn(response)).toEqual(["## Provenance"]);

    // The property the 2026-08-05 loss turned on, asserted as a difference rather
    // than as a presence: the same tool, on the same node, answering a write that
    // preserved everything says something a caller can tell apart from this.
    const lossless = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", DONE].join("\n"),
      why: "no section moves this time",
    });
    expect(droppedIn(lossless)).toEqual([]);
    expect(lossless).not.toContain(PROVENANCE_TEXT);
  });

  test("carries the section's full prior text — the caller can paste it back", async () => {
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", DONE].join("\n"),
      why: "the provenance moved to the evidence record",
      dropping: ["## Provenance"],
    });

    // Verbatim, heading included, so what the response holds IS the section.
    expect(response).toContain(PROVENANCE);
    expect(response).toContain(PROVENANCE_TEXT);

    // And the control: the section really is gone from the file, so the response
    // is the only copy the caller is holding.
    expect(vault.read("Sol").body).not.toContain(PROVENANCE_TEXT);
  });

  test("EVERY dropped entry carries text or a ref, not just the first", async () => {
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: REWRITE,
      why: "cutting both sections",
      dropping: ["## Provenance", "## Definition of done"],
    });

    const dropped = droppedIn(response);
    expect(dropped).toEqual(["## Provenance", "## Definition of done"]);

    // The threshold's first sentence, asserted per entry rather than over the
    // response as a whole: a report that quoted one section and merely named the
    // other would pass a `toContain` and fail the caller holding the second one.
    for (const heading of dropped ?? []) {
      const block = response.slice(response.indexOf(`--- \`${heading}\` as it stood before this write ---`));
      expect(block, `\`${heading}\` arrived with no way back`).not.toBe("");
      expect(block.slice(0, block.indexOf(`--- end \`${heading}\` ---`))).toContain(heading);
    }
    expect(response).toContain(PROVENANCE_TEXT);
    expect(response).toContain(DONE_TEXT);
  });

  test("the reserved sections are in scope — a `## Results` leaving the body would be reported too", async () => {
    // Nothing on the tool surface can drop one, and that is the point: the census
    // is computed over the WHOLE body rather than over the rewritable region, so a
    // future write that lost a `## Results` would be named here rather than
    // arriving as the same success string the 2026-08-05 call did. What is
    // observable today is the other half of the same fact — `## History` is in the
    // census, and every write is reported as changing it.
    vault.setStatus("Sol", "in-discovery", "kicking off");
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", PROVENANCE, "", DONE].join("\n"),
      why: "a rewrite that keeps every rewritable section",
    });

    expect(droppedIn(response)).toEqual([]);
    expect(response).toMatch(/replaced:[^;]*`## History`/);
  });
});

describe("a lossless rewrite still carries the `dropped` key", () => {
  test("`dropped` is present and empty — absent is distinguishable from none", async () => {
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", PROVENANCE, "", DONE].join("\n"),
      why: "sharper framing, every section carried across",
    });

    expect(droppedIn(response)).toEqual([]);
    expect(response).toContain("dropped: none");
    // Not a report that only appears when there is bad news: a caller reading this
    // learns "nothing went", which is the belief the original loss punished.
    expect(vault.read("Sol").body).toContain(PROVENANCE_TEXT);
  });

  test("a node with no sections at all still gets the key", async () => {
    vault.createNode(node("Plain", "Solution", "Just prose, no headings."));
    const response = await call("ost_edit_node", { title: "Plain", prose: "Different prose.", why: "sharper" });
    expect(droppedIn(response)).toEqual([]);
  });

  test("every tool that writes a node body answers with the key", async () => {
    const responses = [
      await call("ost_append_to_node", { title: "Sol", section: "## Notes\n\nsomething more" }),
      await call("ost_annotate", { title: "Sol", issue: "possible duplicate" }),
      await call("ost_edit_node", {
        title: "Sol",
        prose: [REWRITE, "", PROVENANCE, "", DONE, "", "## Notes", "", "something more", "", "## Issues", "", "- possible duplicate"].join(
          "\n",
        ),
        why: "a rewrite that keeps everything",
      }),
    ];

    // The threshold's second half applied across the surface rather than to one
    // tool: a mutating response with no `dropped` key is a failure wherever it
    // comes from, because a caller learns "silence means safety" from any of them.
    for (const response of responses) {
      expect(droppedIn(response), response).toEqual([]);
    }
  });
});

describe("the git ref, when the vault is a repository", () => {
  /** A vault whose current state is committed, which is what every live MCP write leaves behind. */
  function commitAll(): void {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "state before the write"], { cwd: dir });
  }

  test("the ref resolves to the file as it stood BEFORE the write, section included", async () => {
    commitAll();
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", DONE].join("\n"),
      why: "dropping the provenance",
      dropping: ["## Provenance"],
    });

    const [ref] = refsIn(response);
    expect(ref, "the response offered no git ref on a committed vault").toBeDefined();

    // The assertion that makes the ref worth printing: run it, and the section is
    // there. A ref that resolved to the post-write file — which is what `HEAD`
    // would give, since every live mutation commits — would name a recovery that
    // recovers nothing.
    const shown = execFileSync("git", ["show", ref], { cwd: dir, encoding: "utf8" });
    expect(shown).toContain(PROVENANCE_TEXT);
    expect(shown).not.toContain(REWRITE);
  });

  test("a section too large to quote is carried by the ref, and the response says how much it left out", async () => {
    const huge = ["## Ledger", "", "x".repeat(MAX_INLINE_DROPPED_TEXT * 2)].join("\n");
    vault.createNode(node("Big", "Solution", ["An idea.", "", huge].join("\n")));
    commitAll();

    const response = await call("ost_edit_node", {
      title: "Big",
      prose: "A sharper idea.",
      why: "the ledger moved out",
      dropping: ["## Ledger"],
    });

    expect(droppedIn(response)).toEqual(["## Ledger"]);
    expect(response).toMatch(/more character\(s\) not shown/);
    expect(response.length).toBeLessThan(MAX_INLINE_DROPPED_TEXT * 2);

    const [ref] = refsIn(response);
    expect(ref).toBeDefined();
    expect(execFileSync("git", ["show", ref], { cwd: dir, encoding: "utf8" })).toContain("x".repeat(MAX_INLINE_DROPPED_TEXT * 2));
  });

  test("CONTROL — with no repository there is no ref, and the full text is carried instead", async () => {
    // `dir` is deliberately not a git repo here. An entry must still be
    // restorable: this is the case where truncating to save bytes would turn the
    // report into a name and nothing else.
    const huge = ["## Ledger", "", "y".repeat(MAX_INLINE_DROPPED_TEXT * 2)].join("\n");
    vault.createNode(node("Big", "Solution", ["An idea.", "", huge].join("\n")));

    const response = await call("ost_edit_node", {
      title: "Big",
      prose: "A sharper idea.",
      why: "the ledger moved out",
      dropping: ["## Ledger"],
    });

    expect(refsIn(response)).toEqual([]);
    expect(response).toContain("y".repeat(MAX_INLINE_DROPPED_TEXT * 2));
  });

  test("CONTROL — a ref is withheld when the committed blob is not what the write replaced", async () => {
    commitAll();
    // A hand edit in the working tree, uncommitted: HEAD no longer holds the bytes
    // this write is about to destroy. A ref emitted here would resolve to a
    // DIFFERENT past state, and a caller cannot tell that from the right one.
    const file = vault.pathFor("Sol");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(PROVENANCE_TEXT, "Recorded by somebody else entirely."));

    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", DONE].join("\n"),
      why: "dropping the provenance",
      dropping: ["## Provenance"],
    });

    expect(refsIn(response)).toEqual([]);
    // Withheld, not silently unrestorable: the text is still there, and it is the
    // text that was actually destroyed rather than the one HEAD remembers.
    expect(response).toContain("Recorded by somebody else entirely.");
  });
});

describe("the census reads the file, not the arguments", () => {
  test("a section that leaves the body without being named in `dropping` is still reported", async () => {
    // The whole claim of this solution over its two siblings: it covers losses
    // nobody predicted. `editProse` moves reserved sections to the END of the body
    // when it reattaches them, and a caller who reproduces a heading in `prose`
    // satisfies the accounting guard without reproducing the section — so the
    // guard passes this and the census is the only thing that sees the change.
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", "## Provenance", "", DONE].join("\n"),
      why: "kept the heading, lost the paragraph under it",
    });

    // Accounted for, so nothing was refused and nothing appears under `dropped` —
    // and the census still says the section is not what it was.
    expect(droppedIn(response)).toEqual([]);
    expect(response).toMatch(/replaced:[^;]*`## Provenance`/);
    expect(vault.read("Sol").body).not.toContain(PROVENANCE_TEXT);
  });

  test("a `dropping` entry naming a section the node never had drops nothing, and is not reported as a loss", async () => {
    // The cheapest wrong implementation is to echo `dropping` back. It would name
    // a section here that was never on the node and is not missing from it, which
    // is a report that manufactures the alarm it exists to raise.
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", PROVENANCE, "", DONE].join("\n"),
      why: "listing something that was never here",
      dropping: ["## Prior art"],
    });

    expect(droppedIn(response)).toEqual([]);
    expect(response).not.toContain("## Prior art");
  });

  test("a section the write did not touch is reported as kept, not as replaced", async () => {
    const response = await call("ost_edit_node", {
      title: "Sol",
      prose: [REWRITE, "", PROVENANCE, "", DONE].join("\n"),
      why: "only the opening paragraph changed",
    });

    expect(response).toMatch(/kept:[^;]*`## Provenance`/);
    expect(response).toMatch(/kept:[^;]*`## Definition of done`/);
  });
});
