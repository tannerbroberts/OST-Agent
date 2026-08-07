/**
 * The required-tool precondition: does a pass refuse to begin, before writing
 * anything, when a tool it declared it cannot work without is not on the surface?
 *
 * The pre-committed bar for the assumption this settles ("Declare a required tool
 * set and check a pass refuses before doing any work") is two halves, and BOTH
 * have to hold or the mechanism is not worth having:
 *
 *   1. required-missing ⇒ **zero vault writes**, and the absent tool named in the
 *      exit message;
 *   2. would-use-missing ⇒ the pass **completes normally**.
 *
 * The second half is the load-bearing one. A check that refuses whenever any
 * declared tool is absent satisfies (1) perfectly and is worthless: this repo's
 * own unattended surface withholds `ost_check`, `ost_flag_humans_required` and
 * `ost_rank_source` ON PURPOSE (`test/release/examples-allowlist.test.ts`,
 * CONTAINED_ON_PURPOSE), so a blanket requirement list would stop every scheduled
 * firing over a containment somebody chose — and a gate that reads as an obstacle
 * is a gate that gets switched off, after which nothing checks anything.
 *
 * The vault-write half is asserted against a real vault rather than a spy. The
 * `begin` callback creates a node file and commits it through `enqueueCommit` —
 * the same path the MCP server writes on — and the refusal case asserts the
 * vault's file list and commit count are byte-identical to what they were before.
 * A pure resolver could not write either way; what is being pinned is the
 * ORDERING, which is the only thing that distinguishes a precondition from a
 * message printed next to a run that started regardless.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { initVault } from "../../src/runner/init.js";
import { enqueueCommit } from "../../src/mcp/commit.js";
import {
  REQUIRED_TOOLS_EXIT,
  beginPass,
  checkRequiredTools,
  isDeclarationProblem,
  parseToolDeclaration,
  resolveRequiredTools,
  unnamespacedTool,
} from "../../src/mcp/required-tools.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLUGIN = "mcp__plugin_ost-agent_ost-agent__";
const DIRECT = "mcp__ost-agent__";

/** The three the shipped declaration calls required, and the ones the halves below turn on. */
const REQUIRED = ["ost_next_work", "ost_read_tree", "ost_create_node"];
const WOULD_USE = ["ost_ingest_inbox", "ost_append_to_node", "ost_read_repo"];

let dir: string;
let passFile: string;

/** A declaration file in the shape the skill and the command files ship. */
function writeDeclaration(opts: { required: readonly string[]; wouldUse: readonly string[] }): string {
  const file = path.join(dir, "pass.md");
  const allowed = [...opts.required, ...opts.wouldUse].map((t) => `${PLUGIN}${t}`).join(", ");
  const required = opts.required.map((t) => `${PLUGIN}${t}`).join(", ");
  fs.writeFileSync(file, `---\nname: a-pass\nallowed-tools: ${allowed}\nrequired-tools: ${required}\n---\n\nbody\n`);
  return file;
}

/** Everything a vault write would change, in one comparable value. */
async function vaultState(vault: string): Promise<{ files: string[]; commits: number }> {
  const files = fs.readdirSync(vault, { recursive: true, encoding: "utf8" }).filter((f) => !f.startsWith(".git/")).sort();
  return { files, commits: (await simpleGit(vault).log()).total };
}

/** The work a pass does. Real writes on the real path, so "zero writes" means something. */
async function writeANode(vault: string): Promise<string> {
  fs.writeFileSync(path.join(vault, "Some opportunity.md"), "---\ntype: Opportunity\n---\n#Opportunity\n");
  await enqueueCommit(vault, "mcp: ost_create_node");
  return "the pass ran";
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-required-tools-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
  // Same reason as test/mcp/commit.test.ts: this file commits and then deletes the
  // repository within one tick, and a detached `gc --auto` racing the teardown is
  // an ENOTEMPTY that only reproduces on a slow machine.
  await simpleGit(dir).addConfig("gc.auto", "0");
  passFile = writeDeclaration({ required: REQUIRED, wouldUse: WOULD_USE });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe("half one — a required tool is absent", () => {
  /** The whole surface except `ost_read_tree`, which the declaration calls required. */
  const surface = [...REQUIRED.filter((t) => t !== "ost_read_tree"), ...WOULD_USE].map((t) => `${DIRECT}${t}`);

  test("the pass exits before performing any vault write", async () => {
    const before = await vaultState(dir);
    const start = beginPass({ passFile, available: surface, begin: () => writeANode(dir) });

    expect(start.started).toBe(false);
    expect(start.result).toBeUndefined();
    expect(await vaultState(dir)).toEqual(before);
  });

  test("the exit message names the absent tool, and exits non-zero", () => {
    const check = checkRequiredTools({ passFile, available: surface });

    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.missingRequired);
    expect(check.report).toContain("ost_read_tree");
    expect(check.report).toContain("REFUSING TO BEGIN");
    // Named individually rather than counted: "1 tool missing" sends the operator
    // back to the two lists to work out which, which is the whole saving.
    expect(check.resolution!.missingRequired.map((g) => unnamespacedTool(g.demand.tool))).toEqual(["ost_read_tree"]);
  });

  test("it does not silently indict the tools that ARE there", () => {
    const check = checkRequiredTools({ passFile, available: surface });
    expect(check.resolution!.missingRequired).toHaveLength(1);
    expect(check.resolution!.missingWouldUse).toHaveLength(0);
  });
});

describe("half two — only a would-use tool is absent", () => {
  /** Everything required, and one would-use tool withheld the way this repo withholds `ost_check`. */
  const surface = [...REQUIRED, ...WOULD_USE.filter((t) => t !== "ost_read_repo")].map((t) => `${DIRECT}${t}`);

  test("the pass completes normally", async () => {
    const before = await vaultState(dir);
    const start = beginPass({ passFile, available: surface, begin: () => writeANode(dir) });

    expect(start.started).toBe(true);
    expect(start.exitCode).toBe(REQUIRED_TOOLS_EXIT.cleared);
    await expect(start.result!).resolves.toBe("the pass ran");
    // It really did the work, rather than being cleared to do nothing.
    expect((await vaultState(dir)).commits).toBe(before.commits + 1);
  });

  test("the narrowing is reported rather than swallowed", () => {
    const check = checkRequiredTools({ passFile, available: surface });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.cleared);
    expect(check.report).toContain("Narrower than declared");
    expect(check.report).toContain("ost_read_repo");
  });
});

describe("the check is not vacuous in either direction", () => {
  const full = [...REQUIRED, ...WOULD_USE].map((t) => `${DIRECT}${t}`);

  test("a complete surface clears with nothing reported missing", async () => {
    const start = beginPass({ passFile, available: full, begin: () => writeANode(dir) });
    expect(start.started).toBe(true);
    await start.result!;
    expect(start.report).toContain("CLEARED");
    expect(start.report).not.toContain("Narrower than declared");
  });

  test("an empty surface refuses and names every required tool, not just the first", () => {
    const check = checkRequiredTools({ passFile, available: [] });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.missingRequired);
    for (const tool of REQUIRED) expect(check.report).toContain(tool);
  });

  test("a declaration checked against itself clears — the comparison is not just counting", () => {
    const declaration = parseToolDeclaration(fs.readFileSync(passFile, "utf8"));
    expect(isDeclarationProblem(declaration)).toBe(false);
    if (isDeclarationProblem(declaration)) return;
    const self = [...declaration.required, ...declaration.wouldUse];
    const resolved = resolveRequiredTools(declaration, self);
    expect(resolved.missingRequired).toEqual([]);
    expect(resolved.missingWouldUse).toEqual([]);
  });
});

describe("the namespace trap — the same tool has two names on the two surfaces this repo ships", () => {
  /*
   * The declaration is written under the PLUGIN prefix, because that is what a
   * Claude Code plugin session mints. `examples/automation/autonomous-pass.sh`
   * registers the server itself and grants the DIRECT prefix. Compared literally,
   * every required tool is a gap and the gate refuses every firing — a false stop,
   * which is worse than no gate because it converts a working configuration into a
   * refusal nobody can clear.
   */
  test("a plugin-named declaration clears against a directly-mounted grant", () => {
    const check = checkRequiredTools({ passFile, available: [...REQUIRED, ...WOULD_USE].map((t) => `${DIRECT}${t}`) });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.cleared);
  });

  test("and against a plugin-named grant, so neither prefix is privileged", () => {
    const check = checkRequiredTools({ passFile, available: [...REQUIRED, ...WOULD_USE].map((t) => `${PLUGIN}${t}`) });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.cleared);
  });

  test("a server-level grant reaches the tools beneath it, within its own namespace", () => {
    // `permissions.allow: ["mcp__plugin_ost-agent_ost-agent"]` means every tool
    // that server exposes — inherited from `ruleCovers` rather than re-decided here.
    const check = checkRequiredTools({ passFile, available: ["mcp__plugin_ost-agent_ost-agent"] });
    expect(check.exitCode, check.report).toBe(REQUIRED_TOOLS_EXIT.cleared);
  });

  test("a server-level grant for some OTHER server does not clear", () => {
    /*
     * The limit of the namespace-stripping above, pinned so it is a decision
     * rather than a hole. Individual tool names are compared on the capability
     * because the two surfaces this repo ships mint two names for the same tool.
     * A bare server grant carries no tool segment, so there is nothing to compare
     * a capability against — and reading it as "any MCP server will do" would
     * clear a run whose required tools live on a server nobody granted. Between a
     * false stop and a false clear, this one takes the stop.
     */
    const check = checkRequiredTools({ passFile, available: ["mcp__some-other-server"] });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.missingRequired);
  });

  test("the namespace is stripped, not guessed — a different tool is still a gap", () => {
    const check = checkRequiredTools({
      passFile,
      available: [...REQUIRED, ...WOULD_USE].map((t) => `${DIRECT}not_${t}`),
    });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.missingRequired);
    expect(check.resolution!.missingRequired).toHaveLength(REQUIRED.length);
  });
});

describe("an unreadable declaration is not a cleared run", () => {
  test("a file with no `required-tools` line refuses rather than assuming nothing is required", () => {
    const file = path.join(dir, "no-required.md");
    fs.writeFileSync(file, `---\nallowed-tools: ${PLUGIN}ost_next_work\n---\n`);
    const check = checkRequiredTools({ passFile: file, available: [`${DIRECT}ost_next_work`] });

    // The fail-open reading — "no line, so nothing is required" — would make this
    // check clear every run including the ones it exists to stop, which is the
    // exact silence the degraded-firing verdict was written to end.
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.undeclared);
    expect(check.report).toContain("required-tools");
  });

  test("a required tool the declaration never asked to be granted is incoherent, and says which", () => {
    const file = path.join(dir, "incoherent.md");
    fs.writeFileSync(file, `---\nallowed-tools: ${PLUGIN}ost_next_work\nrequired-tools: ${PLUGIN}ost_read_tree\n---\n`);
    const check = checkRequiredTools({ passFile: file, available: [`${DIRECT}ost_read_tree`] });

    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.undeclared);
    expect(check.report).toContain("ost_read_tree");
  });

  test("a missing file refuses rather than clearing", () => {
    const check = checkRequiredTools({ passFile: path.join(dir, "nope.md"), available: [] });
    expect(check.exitCode).toBe(REQUIRED_TOOLS_EXIT.undeclared);
  });

  test("beginPass never reaches the work on any of those", async () => {
    const before = await vaultState(dir);
    const start = beginPass({ passFile: path.join(dir, "nope.md"), available: [], begin: () => writeANode(dir) });
    expect(start.started).toBe(false);
    expect(await vaultState(dir)).toEqual(before);
  });
});

describe("the shipped declaration, against the surface that actually fires", () => {
  const SKILL = path.join(REPO, ".claude/skills/opportunity-solution-tree/SKILL.md");

  /** `$OST_TOOLS` out of the runner itself, so this compares the real pair. */
  function unattendedGrant(): string[] {
    const sh = fs.readFileSync(path.join(REPO, "examples/automation/autonomous-pass.sh"), "utf8");
    const line = sh.match(/^OST_TOOLS="([^"]+)"$/m);
    if (!line) throw new Error("examples/automation/autonomous-pass.sh no longer declares OST_TOOLS");
    return line[1].split(",").map((t) => t.trim()).filter(Boolean);
  }

  test("the skill declares a required set at all", () => {
    const declaration = parseToolDeclaration(fs.readFileSync(SKILL, "utf8"));
    expect(isDeclarationProblem(declaration) ? declaration.problem : "").toBe("");
    if (isDeclarationProblem(declaration)) return;
    expect(declaration.required.map(unnamespacedTool).sort()).toEqual([...REQUIRED].sort());
    // Far more would-use than required is the property that keeps this from being
    // a blanket refusal wearing a split's clothes.
    expect(declaration.wouldUse.length).toBeGreaterThan(declaration.required.length * 2);
  });

  test("the unattended surface clears it — the gate cannot stop a firing that is configured correctly", () => {
    const check = checkRequiredTools({ passFile: SKILL, available: unattendedGrant() });
    expect(check.exitCode, check.report).toBe(REQUIRED_TOOLS_EXIT.cleared);
  });

  test("and it still reports the tools that surface withholds on purpose, without refusing over them", () => {
    const check = checkRequiredTools({ passFile: SKILL, available: unattendedGrant() });
    const withheld = check.resolution!.missingWouldUse.map((g) => unnamespacedTool(g.demand.tool));
    // The three CONTAINED_ON_PURPOSE tools are exactly the case that would break a
    // blanket requirement list. They come out as narrowing, which is the finding.
    expect(withheld).toContain("ost_check");
    expect(withheld).toContain("ost_flag_humans_required");
    expect(withheld).toContain("ost_rank_source");
    expect(check.report).toContain("Narrower than declared");
  });
});
