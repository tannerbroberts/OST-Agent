/**
 * First run asks the human exactly ONE question — never two.
 *
 * The claim under test is the mechanical half of "a first-run branch that walks
 * a stranger to a vault in one question": an empty directory reports
 * `bootstrap: true`, exactly one thing is asked of the human, and answering that
 * one thing alone produces a vault whose root Outcome carries their words
 * verbatim.
 *
 * The second question this is guarding against is not a second sentence — it is
 * **the folder**. `ost_next_work` already knows which directory the server is
 * pointed at (`OST_VAULT: ${CLAUDE_PROJECT_DIR}` in the plugin manifest) and
 * bakes it into `nextStep`. Every *instruction* that told a session to compose
 * the command itself — `init <folder> --outcome "<their words>"` — handed back a
 * hole the tool had already filled. A session whose shell cwd is a subdirectory
 * fills that hole with the wrong path, scaffolds a vault the server never reads,
 * and `ost_next_work` still answers `bootstrap: true` — so the human is asked
 * the same question a second time, having already answered it correctly. One
 * placeholder in a rendered command is one question; two is two.
 *
 * What this does NOT settle: whether a *stranger* gets there. That is a person's
 * reaction to the product, it needs a real outside participant, and it stays
 * with a human — see the assumption test "Does a first-run branch actually get a
 * stranger to a working vault", whose threshold (a committed root Outcome in
 * their own words inside 30 minutes, zero questions asked) no exit code can
 * observe. Green here means the branch cannot ask twice; it does not mean anyone
 * wanted to be asked once.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer } from "../../src/mcp/server.js";
import { firstRunSkillSection } from "../../src/mcp/setup.js";
import { OST_RULESET } from "../../src/knowledge/ruleset.js";

const run = promisify(execFile);
const REPO = path.resolve(__dirname, "../..");
/** The artifact the plugin actually launches, and the one `nextStep` names. */
const BUNDLE = path.join(REPO, "dist", "ost-agent.mjs");
const SKILL = path.join(REPO, ".claude", "skills", "opportunity-solution-tree", "SKILL.md");
const SETUP_COMMAND = path.join(REPO, ".claude", "commands", "ost-setup.md");

/** The sentence a human types. Kept awkward on purpose: it must survive verbatim. */
const THEIR_WORDS = "Help freelance designers get paid on time, without chasing anyone";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-one-question-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function nextWork(vaultDir: string): Promise<Record<string, unknown>> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(vaultDir, { allowMissingConfig: true }));
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  const res = (await client.callTool({ name: "ost_next_work", arguments: {} })) as {
    content: Array<{ text?: string }>;
  };
  return JSON.parse(res.content.map((c) => c.text ?? "").join("\n")) as Record<string, unknown>;
}

/** Every `<…>` hole in a string — the count of things whoever reads it must supply. */
function placeholders(s: string): string[] {
  return s.match(/<[^<>\n]+>/g) ?? [];
}

/** A hole asking for a directory: the one value the tool already knows. */
const DIRECTORY_HOLE = /<[^<>\n]*\b(folder|dir|directory|path|vault|project)\b[^<>\n]*>/i;

/** Every line naming an `ost-agent.mjs` invocation, wherever it appears. */
function commandLines(text: string): string[] {
  return text.split("\n").filter((l) => l.includes("ost-agent.mjs "));
}

/** The `## 2. No vault …` step of the generated front door, up to the next heading. */
function noVaultSection(setupCommand: string): string {
  const start = setupCommand.indexOf("## 2.");
  expect(start, "the front door must still have a step 2").toBeGreaterThan(-1);
  const rest = setupCommand.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the no-vault branch asks one question", () => {
  test("an empty directory reports bootstrap with a single, already-complete command", async () => {
    const work = await nextWork(dir);

    expect(work.bootstrap).toBe(true);
    expect(work.done).toBe(false);
    expect(work.reason).toBe("no-vault");
    expect(work.vault).toBe(path.resolve(dir));

    // One command, not a sequence: two chained commands are two chances to stop.
    const nextStep = work.nextStep as string;
    expect(typeof nextStep).toBe("string");
    expect(nextStep).not.toMatch(/\n|&&|;/);

    // The folder is already filled in. This is what makes the count one.
    expect(nextStep).toContain(path.resolve(dir));
    const holes = placeholders(nextStep);
    expect(holes, `nextStep should ask for exactly one thing, asked for: ${holes.join(", ")}`).toHaveLength(1);
    expect(holes[0]).toMatch(/outcome/i);
    expect(holes[0]).not.toMatch(DIRECTORY_HOLE);
  });

  /**
   * The tool layer having filled the folder in is worth nothing if the
   * instructions tell the session to compose its own command anyway. These are
   * the three surfaces a session can read the no-vault branch off — the ruleset
   * rule, the skill section, and the generated `/ost-setup` front door — and all
   * three have to leave the same single hole.
   */
  test("every no-vault instruction leaves the same one hole, and it is never the folder", () => {
    const noVaultRule = OST_RULESET.firstRun.find((r) => r.includes("`no-vault`"));
    expect(noVaultRule, "the ruleset must still carry a no-vault rule").toBeDefined();

    const skillSection = firstRunSkillSection();
    const setupStep = noVaultSection(fs.readFileSync(SETUP_COMMAND, "utf8"));

    const surfaces: Array<[string, string]> = [
      ["OST_RULESET.firstRun (no-vault rule)", noVaultRule as string],
      ["firstRunSkillSection()", skillSection],
      [".claude/commands/ost-setup.md step 2", setupStep],
      [".claude/skills/…/SKILL.md first-run section", firstRunSectionOf(fs.readFileSync(SKILL, "utf8"))],
    ];

    for (const [name, text] of surfaces) {
      for (const line of commandLines(text)) {
        expect(line, `${name} tells the session to supply the folder itself: ${line.trim()}`).not.toMatch(
          DIRECTORY_HOLE,
        );
        const holes = placeholders(line);
        expect(
          holes.length,
          `${name} leaves ${holes.length} holes to fill (${holes.join(", ")}) — one question means one hole: ${line.trim()}`,
        ).toBeLessThanOrEqual(1);
      }
      // Composing the command by hand is the defect; the payload's own
      // `nextStep` is the thing that already carries the answer.
      expect(text, `${name} must send the session to the payload's nextStep`).toMatch(/nextStep/);
    }
  });

  /**
   * End-to-end, through the exact command `nextStep` names, run from a cwd that
   * is NOT the vault — because a session's shell cwd is not guaranteed to be the
   * directory the server was pointed at, and that mismatch is the whole reason
   * the folder must not be a hole.
   */
  test("answering that one question alone produces a vault carrying the words verbatim", async () => {
    const work = await nextWork(dir);
    const nextStep = work.nextStep as string;

    // Substitute exactly two things: the plugin root the session already knows,
    // and the human's sentence. Nothing else is ours to supply.
    const argv = nextStep
      .replace("${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs", BUNDLE)
      .replace(/<[^<>\n]+>/, THEIR_WORDS);
    const parts = argv.match(/"[^"]*"|\S+/g) ?? [];
    const args = parts.slice(1).map((p) => (p.startsWith('"') ? p.slice(1, -1) : p));
    expect(parts[0]).toBe("node");

    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "ost-elsewhere-"));
    try {
      await run(process.execPath, args, { cwd: elsewhere });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }

    // The vault landed where the tool said it would, not where the shell was.
    const root = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    expect(root, "exactly one node — the root Outcome — should exist").toHaveLength(1);
    expect(root[0]).toMatch(/^type: Outcome$/m);
    // Verbatim: their sentence, character for character, not paraphrased or titled over.
    expect(root[0]).toContain(THEIR_WORDS);

    // And the question is not asked again.
    const after = await nextWork(dir);
    expect(after.bootstrap).toBeUndefined();
  }, 30_000);
});

/** The skill's first-run section, up to the next `## ` heading. */
function firstRunSectionOf(skill: string): string {
  const start = skill.indexOf("## First run — if the vault is not initialized");
  expect(start, "SKILL.md must still carry its first-run section").toBeGreaterThan(-1);
  const rest = skill.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}
