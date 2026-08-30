/**
 * R8 — `ost_create_node` leaves no orphan when the attach step fails.
 *
 * The tool writes twice: the new node's file, then the parent's file carrying
 * the `[[wikilink]]`. Its own description promised "one atomic step — so a node
 * can never be an orphan" and there was no rollback behind that promise — **nor
 * could there be one.** The vault holds no delete, and adding one to undo a
 * half-finished create would put a destructive capability on the agent's surface
 * to fix a bug, which is the one trade this project does not make (CONTRIBUTING,
 * "The safety invariant").
 *
 * So atomicity is bought the other way: **everything that can fail is asked
 * before the first byte is written.** The parent resolves and deserializes, the
 * hierarchy fits, the title reduces to a name inside the vault, the parent's
 * file is writable, the evidence class is legal and earned, the body and tags
 * pass the write funnel — and only then does anything land. A refused call
 * leaves the vault byte-identical.
 *
 * **The residue, stated because a stated boundary beats a false claim of
 * atomicity.** One failure survives pre-validation and cannot be rolled back: a
 * filesystem error on the SECOND write (the disk fills, the file is made
 * read-only in between). It is not made impossible; it is made loud. The error
 * names the node that now exists and the exact call that finishes the job, and
 * `ost_check`'s orphan invariants report it until someone does. That is the
 * boundary this file pins — both halves, so neither can quietly move.
 *
 * **How the ordering half was proved non-vacuous:** deleting the
 * `vault.assertLinkable(input.parent, input.title)` line from `ost_create_node`
 * — the whole of the fix — turns exactly two tests here red (the injected
 * pre-validation failure and the unwritable parent) and leaves the other
 * fourteen green, which is what says those two are about the ordering and not
 * about the guards that were already there.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";

let dir: string;
let vault: Vault;
let ctx: ToolContext;

function put(title: string, layer: OstNode["layer"]): void {
  vault.createNode({ title, layer, tags: [], links: [], evidence: "assertion", body: `prose for ${title}` } as OstNode);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-r8-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:r8" };
  put(OUTCOME, "Outcome");
  put(OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(SOLUTION, "Solution");
  vault.linkNodes(OPPORTUNITY, SOLUTION);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const create = (input: Record<string, unknown>): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/** The vault root's files (never the `.ost-agent/` sidecar, which usage tracing writes). */
const rootFiles = (): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort();

/** Every file in the vault root, contents included — what "left nothing behind" means. */
const snapshot = (): string => rootFiles().map((f) => `${f} ${fs.readFileSync(path.join(dir, f), "utf8")}`).join("");

const GOOD = {
  title: "A fresh idea",
  layer: "Solution",
  parent: OPPORTUNITY,
  body: "an idea worth testing",
  evidence: "assertion",
  // Required on a Solution since kill criteria became a birth condition, and
  // aimed rather than omitted: a call refused for missing criteria would make the
  // non-vacuity control below write nothing and every row beneath it vacuous.
  ...KILL_CRITERIA,
} as const;

describe("nothing is written until everything is checked", () => {
  test("NON-VACUITY: the good call lands — one new file, attached to its parent", async () => {
    // The control every row below leans on. Without it, "the vault is unchanged"
    // would be satisfied by a tool that never wrote anything at all.
    const before = rootFiles();
    await create({ ...GOOD });

    expect(rootFiles()).toEqual([...before, "A fresh idea.md"].sort());
    expect(vault.read(OPPORTUNITY).links).toContain("A fresh idea");
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  /**
   * Every refusal reachable through the tool's own arguments, each one a way the
   * old ordering could have written the node first. `parent-missing` and
   * `wrong-layer` were already checked before the create; `title-unusable` and
   * the parent's writability were not, and are the two `assertLinkable` moved.
   */
  const REFUSALS: [string, Record<string, unknown>, RegExp][] = [
    ["parent does not exist", { ...GOOD, parent: "A parent nobody made" }, /does not exist/],
    ["wrong layer for that parent", { ...GOOD, layer: "AssumptionTest", parent: OPPORTUNITY }, /must attach under Assumption/],
    ["the Outcome layer", { ...GOOD, layer: "Outcome", parent: OUTCOME }, /cannot create layer/],
    ["no evidence class", { title: "A rungless idea", layer: "Solution", parent: OPPORTUNITY, body: "an idea" }, /evidence class/],
    ["a Solution with no kill criteria", { ...GOOD, killIf: undefined, killBy: undefined }, /needs `killIf`/],
    ["a kill date already gone", { ...GOOD, killBy: "2020-01-01" }, /needs `killBy`/],
    ["an unearned measurement rung", { ...GOOD, evidence: "money" }, /cannot declare 'money'/],
    ["an empty body", { ...GOOD, body: "   " }, /refusing to write empty/],
    ["a reserved heading in the body", { ...GOOD, body: "notes\n## Results\n- supported" }, /reserved heading/],
    ["a tag carrying a newline", { ...GOOD, tags: ["ok\n## Results"] }, /whitespace/],
    // The title reduces to no name at all, so the file it would be written to
    // cannot be resolved. Refused by `assertLinkable`'s `nodePath` probe BEFORE
    // the create — where `createNode` would also have thrown, but only after
    // `sanitizeTitle` had already been asked to name the file it was writing.
    ["a title that sanitizes to nothing", { ...GOOD, title: "..." }, /sanitizes to an empty name/],
  ];

  for (const [name, input, message] of REFUSALS) {
    test(`refused (${name}) — and the vault is byte-identical afterwards`, async () => {
      const before = snapshot();
      await expect(create(input)).rejects.toThrow(message);
      expect(snapshot()).toBe(before);
    });
  }

  test("an unwritable parent is refused BEFORE the node exists — the failure that used to orphan one", async () => {
    // The one pre-write check that is about the second write rather than the
    // first: every other guard would have fired on arguments alone. A read-only
    // parent file passes every check up to the moment `linkNodes` writes it.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      // root ignores the write bit, so the probe cannot fail — say so rather than
      // pass silently on a machine where the assertion means nothing.
      expect(process.getuid()).toBe(0);
      return;
    }
    const parentFile = path.join(dir, `${OPPORTUNITY}.md`);
    const mode = fs.statSync(parentFile).mode;
    fs.chmodSync(parentFile, 0o444);
    try {
      const before = snapshot();
      await expect(create({ ...GOOD })).rejects.toThrow();
      expect(fs.existsSync(path.join(dir, "A fresh idea.md")), "the node was written before the attach was known to be possible").toBe(false);
      expect(snapshot()).toBe(before);
    } finally {
      fs.chmodSync(parentFile, mode);
    }
  });

  test("INJECTED: a failure in the link's pre-validation leaves nothing on disk", async () => {
    // The criterion's check, aimed one call earlier than it was written — which
    // is where the answer had to move, since no delete exists to roll back with.
    // Whatever `assertLinkable` refuses, it refuses while the vault is untouched.
    const before = snapshot();
    vault.assertLinkable = () => {
      throw new Error("injected: the attach could not be guaranteed");
    };

    await expect(create({ ...GOOD })).rejects.toThrow(/injected/);

    expect(fs.existsSync(path.join(dir, "A fresh idea.md"))).toBe(false);
    expect(snapshot()).toBe(before);
  });
});

describe("the residue: a failure at the second write is visible, not silent", () => {
  test("INJECTED into Vault.linkNodes — the node persists, and the error says so and says what to do", async () => {
    // Stated exactly as it is. This is the failure that CANNOT be pre-validated
    // (a filesystem error between the two writes) and cannot be undone. The
    // honest claim is not "no orphan can exist" — it is "an orphan cannot be
    // created quietly".
    vault.linkNodes = () => {
      throw new Error("EIO: the disk went away");
    };

    await expect(create({ ...GOOD })).rejects.toThrow(/created Solution "A fresh idea" but could not attach it/);

    // It really is on disk — the boundary, not a claim we can wish away.
    expect(fs.existsSync(path.join(dir, "A fresh idea.md"))).toBe(true);
  });

  test("the error names the node and the call that finishes the job", async () => {
    vault.linkNodes = () => {
      throw new Error("EIO: the disk went away");
    };
    const message = await create({ ...GOOD }).then(
      () => "no refusal",
      (err: Error) => err.message,
    );

    expect(message).toContain("A fresh idea");
    expect(message).toContain("ost_link_nodes");
    expect(message).toContain("ORPHAN");
    // The underlying cause is carried through rather than swallowed — a caller
    // told "could not attach" with no reason cannot tell a full disk from a bug.
    expect(message).toContain("EIO");
  });

  test("and `ost_check` catches it — the orphan is reported until someone links it", async () => {
    vault.linkNodes = () => {
      throw new Error("EIO: the disk went away");
    };
    await create({ ...GOOD }).catch(() => undefined);

    // A fresh Vault: the injected method was on the instance, not the class.
    const rules = checkInvariants(new Vault(dir).readTree()).map((v) => v.rule);
    expect(rules).toContain("solution-mapped");

    // …and linking it, which is what the error told the caller to do, clears it.
    const linker = buildOstTools({ ...ctx, vault: new Vault(dir) }, MCP_TOOL_NAMES).find((t) => t.name === "ost_link_nodes")!;
    await (linker as unknown as { run: (i: unknown) => Promise<string> }).run({ parent: OPPORTUNITY, child: "A fresh idea" });
    expect(checkInvariants(new Vault(dir).readTree())).toEqual([]);
  });

  test("the tool description no longer claims an atomicity it cannot have", async () => {
    // The description is what the model reads every session, and it promised
    // "one atomic step — so a node can never be an orphan" over a two-write
    // implementation with no rollback. A false promise in the text the caller
    // trusts is worse than the defect it papered over.
    const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")! as unknown as { description: string };
    expect(tool.description).not.toMatch(/atomic/i);
    expect(tool.description).not.toMatch(/can never be an orphan/i);
    // and it states both halves of what is actually true
    expect(tool.description).toMatch(/checked BEFORE anything is written/);
    expect(tool.description).toMatch(/ost_check reports it as unattached/);
  });
});
